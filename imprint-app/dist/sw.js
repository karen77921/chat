/* Imprint 的 service worker：只管手机推送（不缓存页面，免得更新后还看到旧版） */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

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
