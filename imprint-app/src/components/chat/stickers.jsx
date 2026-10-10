/** 内置表情：蓝色简笔画。前端自带，不需要后端；发送时只发 id。 */
const st = { fill: 'none', stroke: 'var(--print-c)', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' };
const fl = { fill: 'color-mix(in srgb, var(--l1) 80%, #fff)' };
const face = <path d="M14 30l4-16 10 10q8-3 16 0l10-10 4 16q4 8 0 16q-8 14-22 14T14 46q-4-8 0-16z" {...st} {...fl} />;
const whisk = <path d="M10 40h8M10 45l8-2M62 40h-8M62 45l-8-2" {...st} strokeWidth="1.4" />;

const ART = {
  'cat-smile': <>{face}{whisk}<path d="M27 36h.01M45 36h.01" {...st} strokeWidth="4" /><path d="M32 43q4 3 8 0" {...st} /></>,
  'cat-heart': <>{face}{whisk}<path d="M24 36q3-3 6 0M42 36q3-3 6 0M32 43q4 3 8 0" {...st} /><path d="M56 12c-3-4-8 0-4 4l4 4 4-4c4-4-1-8-4-4z" style={{ fill: 'var(--print-a)' }} stroke="var(--print-c)" strokeWidth="1.6" /></>,
  'cat-sleep': <>{face}{whisk}<path d="M24 37q3 2 6 0M42 37q3 2 6 0M34 44h4" {...st} /><path d="M52 14h6l-6 6h6" {...st} strokeWidth="1.6" /></>,
  'cat-cry': <>{face}{whisk}<path d="M27 35h.01M45 35h.01" {...st} strokeWidth="4" /><path d="M32 45q4-3 8 0" {...st} /><path d="M27 39v6M45 39v6" stroke="var(--print-b)" strokeWidth="2" strokeLinecap="round" /></>,
  paw: <><ellipse cx="36" cy="44" rx="11" ry="9" {...st} {...fl} />{[[22, 30], [31, 23], [41, 23], [50, 30]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="4.5" {...st} {...fl} />)}</>,
  cloud: <><path d="M18 50h36a11 11 0 0 0 0-22 15 15 0 0 0-28-2 12 12 0 0 0-8 24z" {...st} {...fl} /><path d="M30 40h.01M42 40h.01" {...st} strokeWidth="4" /></>,
  star: <path d="M36 12l6.5 14 15 2-11 10.5 3 15L36 46l-13.5 7.5 3-15L14.5 28l15-2z" {...st} {...fl} />,
  moon: <><path d="M46 52A20 20 0 0 1 30 16a20 20 0 1 0 16 36z" {...st} {...fl} /><path d="M50 18v6M47 21h6" {...st} strokeWidth="1.6" /></>,
};
export const BUILTIN = Object.keys(ART).map((id) => ({ id, name: { 'cat-smile': '笑', 'cat-heart': '喜欢', 'cat-sleep': '困了', 'cat-cry': '哭哭', paw: '爪爪', cloud: '云', star: '星星', moon: '晚安' }[id] }));

/** 内置的画 SVG；后端给的（我的 / 他画的）用图片地址 */
export function Sticker({ sticker, size = 72 }) {
  if (sticker?.url) return <img src={sticker.url} alt={sticker.name || '表情'} width={size} height={size} style={{ objectFit: 'contain' }} />;
  const art = ART[sticker?.id] || ART['cat-smile'];
  return <svg width={size} height={size} viewBox="0 0 72 72" role="img" aria-label={BUILTIN.find((b) => b.id === sticker?.id)?.name || '表情'}>{art}</svg>;
}
