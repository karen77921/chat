// 表情在消息里只记 id（[表情：id]）。自定义表情的图片地址记在这里，渲染时按 id 找回来。
export const stickerUrls = new Map();

export function rememberStickers(...lists) {
  for (const list of lists) for (const s of list || []) if (s?.id && s.url) stickerUrls.set(String(s.id), s.url);
}

const TOKEN = /^\[表情：([^\]\s]{1,80})\]$/;
/** 一段文字刚好是一个表情标记时返回它的 id */
export const stickerToken = (text) => TOKEN.exec(String(text || '').trim())?.[1] || null;
