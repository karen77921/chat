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
  // 从相册选完图回来、键盘收起后，系统偶尔也会卡在「半屏」：背景只铺到一半、输入框浮在半空。
  // 记下见过的最大高度；不在打字却比它矮一截，就是卡住了，碰一下屏幕就推一下
  let tallest = window.innerHeight;
  const stuck = () => !typing() && window.innerHeight < tallest - 80;
  window.addEventListener('resize', () => { tallest = Math.max(tallest, window.innerHeight); if (stuck()) setTimeout(nudge, 120); });
  document.addEventListener('change', (e) => { if (e.target?.type === 'file') { setTimeout(nudge, 300); setTimeout(nudge, 900); } }, true);
  document.addEventListener('touchend', () => { if (stuck()) nudge(); }, { passive: true });
  window.addEventListener('focus', () => setTimeout(nudge, 100));
  window.visualViewport?.addEventListener('resize', () => { if (!typing()) nudge(); });
  window.addEventListener('orientationchange', () => setTimeout(nudge, 300));
  window.addEventListener('pageshow', nudge);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(nudge, 50); });
}
