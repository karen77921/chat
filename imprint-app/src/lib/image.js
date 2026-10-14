/**
 * 发图前先在手机上压一下：手机原图动辄 3–8 MB，原样上传慢、发给模型也慢（还可能超过单张 5 MB 的上限）。
 * 长边缩到 2048（模型看图最多也就用到 ~1568），转成 JPEG 0.85；动图和本来就小的图原样不动。
 */
const MAX_EDGE = 2048;
const SMALL = 600 * 1024;

export async function shrinkImage(file) {
  if (!file?.type?.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') return file;
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file; // 浏览器解不开（比如有的 HEIC）：原样传，后端照样收
  }
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size <= SMALL) return file;
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); // 透明 PNG 转 JPEG 不要变黑底
    ctx.drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.85));
    if (!blob || blob.size >= file.size) return file;
    const name = (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
  } finally {
    bmp.close?.();
  }
}

/** 一次最多同时传 2 张，手机网络不至于全部一起卡住；onEach(完成张数) 用来显示进度 */
export async function mapLimited(items, limit, fn, onEach) {
  const out = new Array(items.length);
  let next = 0, done = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
      onEach?.(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
