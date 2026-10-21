/**
 * 手机推送：注册 service worker → 订阅 → 把订阅交给后端；App 开着时每 25 秒报一次「我在看」，后端就不推。
 * iPhone 只有「添加到主屏幕」后从桌面图标打开，才有推送（Safari 网页里没有）。
 */
import { api } from './api.js';

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function registerSW() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
  // 服务器慢的时候先用了手机里存的旧版：知道有新版以后，等她下次切回 App 再刷新（不打断正在打的字）
  let stale = false;
  let checking = false;
  const currentEntry = () => document.querySelector('script[src*="assets/index-"]')?.getAttribute('src') || '';
  let latest = '';
  const markLatest = (entry) => { if (entry && currentEntry() && !currentEntry().endsWith(entry)) { stale = true; latest = entry; } };
  const checkLatest = async () => {
    if (checking) return;
    checking = true;
    try {
      const url = new URL('./', location.href);
      url.searchParams.set('_imprint_version', Date.now());
      const html = await fetch(url, { cache: 'no-store' }).then((res) => res.ok ? res.text() : '');
      markLatest(html.match(/assets\/index-[\w-]+\.js/)?.[0]);
    } catch { /* 离线时继续用手机里存的版本 */ }
    checking = false;
  };
  navigator.serviceWorker.addEventListener('message', (event) => {
    const entry = event.data?.type === 'imprint-latest' && event.data.entry;
    markLatest(entry);
  });
  // 每个新版本最多替她刷新一次：手机上要是拿到的页面和服务器对不上（缓存、网络慢），
  // 不加这道闸就会开一次刷一次，iPhone 最后会报「重复出现问题」
  const refreshWhenVisible = async () => {
    if (document.visibilityState !== 'visible') return;
    await checkLatest();
    if (!stale || !latest) return;
    let tried = '';
    try { tried = sessionStorage.getItem('imprint.reloadedFor') || ''; } catch { /* 无痕模式 */ }
    if (tried === latest) return;
    try { sessionStorage.setItem('imprint.reloadedFor', latest); } catch { return; }
    location.reload();
  };
  document.addEventListener('visibilitychange', refreshWhenVisible);
  window.addEventListener('pageshow', (event) => { if (event.persisted) refreshWhenVisible(); });
  setTimeout(checkLatest, 1500);
}

function keyBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** → { state, text }：state = unsupported | install | blocked | off | on | server */
export async function pushStatus() {
  if (!supported()) {
    if (isIOS() && !standalone()) return { state: 'install', text: '先用 Safari 打开，点分享 →「添加到主屏幕」，再从桌面图标进来开启。' };
    return { state: 'unsupported', text: '这个浏览器不支持推送。' };
  }
  if (isIOS() && !standalone()) return { state: 'install', text: '要从桌面图标打开才能开推送：Safari 分享 →「添加到主屏幕」，再从那个图标进来。' };
  const info = await api('/api/push').catch(() => null);
  if (!info?.available) return { state: 'server', text: info?.reason || '后端还没准备好推送。' };
  if (Notification.permission === 'denied') return { state: 'blocked', text: '通知被关掉了：去手机「设置 → 通知 → Imprint」打开。' };
  const reg = await navigator.serviceWorker.getRegistration('./');
  const sub = await reg?.pushManager.getSubscription();
  return sub ? { state: 'on', text: `已开启 · 一共 ${info.devices} 台设备会收到` } : { state: 'off', text: '还没开。开了以后他找你，手机就会弹通知。' };
}

export async function enablePush() {
  const info = await api('/api/push');
  if (!info?.available) throw new Error(info?.reason || '后端还没准备好推送');
  const perm = await Notification.requestPermission(); // 必须在点按钮的那一下里调用
  if (perm !== 'granted') throw new Error('没有允许通知');
  const reg = (await navigator.serviceWorker.getRegistration('./')) || (await navigator.serviceWorker.register('./sw.js', { scope: './' }));
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(info.key) }));
  await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), origin: location.origin, ua: navigator.userAgent } });
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration('./');
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
    await sub.unsubscribe();
  }
}

export const testPush = () => api('/api/push/test', { method: 'POST' });

/** App 开着、在前台时，告诉后端「她在看」，他回的消息就不再推（免得一边看一边弹） */
export function startPresence() {
  if (typeof document === 'undefined') return () => {};
  const ping = () => { if (document.visibilityState === 'visible') api('/api/push/seen', { method: 'POST' }).catch(() => {}); };
  ping();
  const timer = setInterval(ping, 25000);
  document.addEventListener('visibilitychange', ping);
  return () => { clearInterval(timer); document.removeEventListener('visibilitychange', ping); };
}
