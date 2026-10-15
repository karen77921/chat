/**
 * iPhone「添加到主屏幕」的全屏 App 有个系统 bug：键盘收起后，整页的可视区域没恢复原高度，
 * 底部导航（position: fixed）就卡在半空，背景也只铺到一半，直到页面再滚一下才回去。
 * 这里在键盘收起、页面重新显示、可视区域变化时轻轻「推」一下滚动位置，让系统重新算一遍。
 */
const typing = () => {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
};

export function installViewportFix() {
  if (typeof window === 'undefined') return;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!ios) return;
  let pending = 0;
  const nudge = () => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      if (typing()) return;
      const { scrollX: x, scrollY: y } = window;
      window.scrollTo(x, y + 1);
      window.scrollTo(x, y);
      document.documentElement.style.minHeight = `${window.innerHeight}px`; // 背景重新铺满整屏
    });
  };
  document.addEventListener('focusout', () => { setTimeout(nudge, 80); setTimeout(nudge, 400); });
  window.visualViewport?.addEventListener('resize', () => { if (!typing()) nudge(); });
  window.addEventListener('orientationchange', () => setTimeout(nudge, 300));
  window.addEventListener('pageshow', nudge);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(nudge, 50); });
}
