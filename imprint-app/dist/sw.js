/* Imprint 的 service worker：手机推送 + 把 App 本身存在手机上，打开时不用每次从服务器重新下载。
 * - assets/ 里的文件名带内容指纹，内容变了名字就变：存过的直接用，永远不会是旧版
 * - 页面本身先问服务器（拿到最新版）；服务器 3 秒还没回，先用存着的打开，新版在后台存好、下次打开就是
 * - 聊天、心潮这些数据（/relay/…）一律不经过这里 */
const SHELL = 'imprint-shell-v1';
const KEEP = 120;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key !== SHELL) await caches.delete(key);
  await self.clients.claim();
})()));

async function remember(req, res) {
  if (!res || !res.ok || res.type === 'opaque') return;
  const cache = await caches.open(SHELL);
  await cache.put(req, res);
  const keys = await cache.keys();
  for (const old of keys.slice(0, Math.max(0, keys.length - KEEP))) await cache.delete(old);
}

function assetFirst(event) {
  const fresh = caches.match(event.request).then((hit) => hit || fetch(event.request).then((res) => {
    event.waitUntil(remember(event.request, res.clone()));
    return res;
  }));
  event.waitUntil(fresh.catch(() => {}));
  return fresh;
}

function pageFirst(event) {
  const scope = self.registration.scope;
  const fresh = fetch(event.request);
  // 先登记「存新版」，保证在页面读走内容之前复制一份；顺便告诉页面现在最新的是哪一版，
  // 页面要是用的旧版（服务器慢时先拿了存着的），下次切回来就自己刷新
  event.waitUntil(fresh.then(async (res) => {
    const copy = res.clone();
    await remember(scope, res.clone());
    const entry = (await copy.text()).match(/assets\/index-[\w-]+\.js/)?.[0];
    if (!entry) return;
    for (const win of await self.clients.matchAll({ type: 'window' })) win.postMessage({ type: 'imprint-latest', entry });
  }).catch(() => {}));
  const slow = new Promise((ok) => setTimeout(ok, 3000)).then(() => caches.match(scope));
  return Promise.race([fresh, slow])
    .then((first) => first || fresh)
    .catch(() => caches.match(scope).then((hit) => hit || fresh));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const base = new URL(self.registration.scope);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return;
  const rel = url.pathname.slice(base.pathname.length);
  if (rel.startsWith('assets/')) event.respondWith(assetFirst(event));
  else if (req.mode === 'navigate' && (rel === '' || rel === 'index.html')) event.respondWith(pageFirst(event));
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'Imprint';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    tag: data.tag || 'imprint',
    renotify: true,
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    data: { url: data.url || './' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const win of wins) {
      if ('focus' in win) {
        await win.focus();
        if ('navigate' in win) { try { await win.navigate(target); } catch { /* 有的浏览器不让跳，就停在当前页 */ } }
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
