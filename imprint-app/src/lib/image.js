/**
 * 发图前先在手机上压一下：手机原图动辄 3–8 MB，原样上传慢、发给模型也慢（还可能超过单张 5 MB 的上限）。
 * 长边缩到 2048（模型看图最多也就用到 ~1568），转成 JPEG 0.85；动图和本来就小的图原样不动。
 */
const MAX_EDGE = 2048;
const SMALL = 600 * 1024;

// iPhone 上 createImageBitmap 偶尔解出一张「空的」图，画出来就是一张纯白，然后被当成照片传上去。
// 所以先用 <img> 解码（iOS 上最稳），压完再抽查几个点：一片空白就不用它，原图照传。
function decodeWithImg(file) {
  return new Promise((ok, fail) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => ok({ src: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) });
    img.onerror = () => { URL.revokeObjectURL(url); fail(new Error('decode')); };
    img.src = url;
  });
}

async function decode(file) {
  try { return await decodeWithImg(file); } catch { /* 下面再试一次 */ }
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  return { src: bmp, width: bmp.width, height: bmp.height, done: () => bmp.close?.() };
}

/** 抽查一个 8×8 的网格：全是刚铺的白底，说明照片根本没画上去 */
function looksBlank(ctx, w, h) {
  try {
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const [r, g, b] = ctx.getImageData(Math.floor(((x + 0.5) * w) / 8), Math.floor(((y + 0.5) * h) / 8), 1, 1).data;
        if (r < 250 || g < 250 || b < 250) return false;
      }
    }
    return true;
  } catch { return false; }
}

export async function shrinkImage(file) {
  if (!file?.type?.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') return file;
  let pic;
  try {
    pic = await decode(file);
  } catch {
    return file; // 浏览器解不开（比如有的 HEIC）：原样传，后端照样收
  }
  const canvas = document.createElement('canvas');
  try {
    if (!pic.width || !pic.height) return file;
    const scale = Math.min(1, MAX_EDGE / Math.max(pic.width, pic.height));
    if (scale === 1 && file.size <= SMALL) return file;
    const w = Math.round(pic.width * scale), h = Math.round(pic.height * scale);
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return file;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); // 透明 PNG 转 JPEG 不要变黑底
    ctx.drawImage(pic.src, 0, 0, w, h);
    if (looksBlank(ctx, w, h)) return file;
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.85));
    if (!blob || blob.size < 1024 || blob.size >= file.size) return file;
    const name = (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file;
  } finally {
    pic.done();
    canvas.width = 0; canvas.height = 0; // iPhone 不会自己回收画布内存，连发几张就会开始画出白图
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
