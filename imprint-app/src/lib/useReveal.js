import { useEffect, useRef } from 'react';

/**
 * 「撕开进场」：元素滚进视口时加上 .in，触发 tokens.css 里的 .reveal 动效。只播一次。
 * 用法：const ref = useReveal();  <section ref={ref} className="reveal">
 */
export function useReveal() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!('IntersectionObserver' in window)) { el.classList.add('in'); return; }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { el.classList.add('in'); io.disconnect(); }
    }, { rootMargin: '0px 0px -8% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}
