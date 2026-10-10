/**
 * 主题切换。颜色全在 src/design/tokens.css 的变量里，这里只负责给 <html> 换 data-theme。
 *   - 网址带 ?theme=lilac 时优先（截图、给甲方看用）
 *   - 否则读本地记住的 imprint.theme
 *   - 默认 'cyan'（蓝晒，写在 :root，不需要 data-theme）
 * 设置 · 美化 里调用 setTheme(name)。
 */
import { useEffect, useState } from 'react';

export const THEMES = [
  { id: 'cyan', name: '蓝晒', swatch: '#6E9BC5' },
  { id: 'lilac', name: '雾紫', swatch: '#8C7EBD' },
  { id: 'sage', name: '灰绿', swatch: '#739C86' },
];
const KEY = 'imprint.theme';
const subs = new Set();

function apply(id) {
  if (id && id !== 'cyan') document.documentElement.dataset.theme = id;
  else delete document.documentElement.dataset.theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() || '#F6FAFC';
}

export function currentTheme() {
  return document.documentElement.dataset.theme || 'cyan';
}

/** 启动时调用一次 */
export function initTheme() {
  const fromUrl = new URLSearchParams(location.search).get('theme');
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch { /* 隐私模式 */ }
  const id = THEMES.some((t) => t.id === fromUrl) ? fromUrl : saved;
  apply(THEMES.some((t) => t.id === id) ? id : 'cyan');
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
