/**
 * 主题切换。颜色全在 src/design/tokens.css 的变量里，这里只负责给 <html> 换 data-theme / data-skin。
 *   - 网址带 ?theme=cream 时优先（截图用）
 *   - 否则读本地记住的 imprint.theme3
 *   - 默认 'ballet'（芭蕾）：它在奶油玻璃上面再套一层（data-theme="cream" + data-skin="ballet"，样子在 theme/ballet.css）
 * 设置 · 美化 里调用 setTheme(name)。
 */
import { useEffect, useState } from 'react';

// 芭蕾（默认）和奶油玻璃两套。base：在哪套底子上套；sub/swatches：美化里主题卡片上的说明和色块
export const THEMES = [
  { id: 'ballet', name: '芭蕾', base: 'cream', skin: 'ballet', sub: '淡粉 · 浅银 · 芭蕾小画', swatches: ['#F8E9EA', '#E9A6B6', '#ECECEF'] },
  { id: 'cream', name: '奶油玻璃', sub: '雾蓝天空 · 奶油磨砂', swatches: ['#C9DBE8', '#F8F4EE', '#B98079'] },
];
const KEY = 'imprint.theme3'; // 换了新键：加了芭蕾以后大家先看到芭蕾，想换回去在美化里选
const subs = new Set();

let current = null;
function apply(id) {
  const t = THEMES.find((x) => x.id === id);
  current = t ? t.id : null;
  const html = document.documentElement;
  if (t) html.dataset.theme = t.base || t.id; else delete html.dataset.theme;
  if (t?.skin) html.dataset.skin = t.skin; else delete html.dataset.skin;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() || '#F6FAFC';
}

export function currentTheme() {
  return current || document.documentElement.dataset.theme || 'cyan';
}

/** 启动时调用一次 */
export function initTheme() {
  const fromUrl = new URLSearchParams(location.search).get('theme');
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch { /* 隐私模式 */ }
  const id = THEMES.some((t) => t.id === fromUrl) ? fromUrl : saved;
  apply(THEMES.some((t) => t.id === id) ? id : THEMES[0].id);
}

export function setTheme(id) {
  apply(id);
  try { localStorage.setItem(KEY, id); } catch { /* 隐私模式 */ }
  subs.forEach((fn) => fn(id));
}

export function useTheme() {
  const [id, setId] = useState(currentTheme);
  useEffect(() => { subs.add(setId); return () => subs.delete(setId); }, []);
  return [id, setTheme];
}

/**
 * 气泡样式和透明度（设置 · 美化）。存在本地，同时 PUT 给后端（换设备也能带上）。
 * 套用方式：<html data-bubble="glass|paper|cyan" style="--bubble-alpha: .5">，聊天页的 CSS 按这两个值画气泡。
 */
const BKEY = 'imprint.beauty';
const bsubs = new Set();
function readBeauty() {
  try { return { bubble: 'glass', alpha: 0.5, wallpaper: null, ...JSON.parse(localStorage.getItem(BKEY) || '{}') }; } catch { return { bubble: 'glass', alpha: 0.5, wallpaper: null }; }
}
function applyBeauty(b) {
  document.documentElement.dataset.bubble = b.bubble;
  document.documentElement.style.setProperty('--bubble-alpha', String(b.alpha));
}
export function initBeauty() { applyBeauty(readBeauty()); }
export function useBeauty() {
  const [b, setB] = useState(readBeauty);
  useEffect(() => { bsubs.add(setB); return () => bsubs.delete(setB); }, []);
  const set = (next) => {
    applyBeauty(next);
    try { localStorage.setItem(BKEY, JSON.stringify(next)); } catch { /* 隐私模式 */ }
    bsubs.forEach((fn) => fn(next));
  };
  return [b, set];
}
