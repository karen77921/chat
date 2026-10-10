/**
 * 纸张材质：撕边、纸带、蓝晒印相、邮票、火漆、纸胶带、邮戳、回形针、黑胶、叶子标本、纸面颗粒。
 * 撕边和植物都由随机种子生成，同一个 seed 每次画出来一样。
 */
import { useId, useMemo } from 'react';

/* ---------- 随机 ---------- */
function rng(seed) {
  let a = (seed * 2654435761) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const uni = (r, a, b) => a + (b - a) * r();
const f = (n) => n.toFixed(1);

/** 四边撕开的多边形（px），给固定尺寸的纸片用 */
export function tornPolygon(w, h, { sides = 'tblr', amp = 3, seed = 1, step = [4, 9] } = {}) {
  const r = rng(seed);
  const pts = [];
  for (let x = 0; x < w; x += uni(r, ...step)) pts.push([x, sides.includes('t') ? uni(r, 0, amp) : 0]);
  for (let y = 0; y < h; y += uni(r, ...step)) pts.push([w - (sides.includes('r') ? uni(r, 0, amp) : 0), y]);
  for (let x = w; x > 0; x -= uni(r, ...step)) pts.push([x, h - (sides.includes('b') ? uni(r, 0, amp) : 0)]);
  for (let y = h; y > 0; y -= uni(r, ...step)) pts.push([sides.includes('l') ? uni(r, 0, amp) : 0, y]);
  return `polygon(${pts.map(([x, y]) => `${f(x)}px ${f(y)}px`).join(',')})`;
}

/** 整条纸带只撕上边，横向用 %，宽度随屏幕变 */
export function bandPolygon(seed, amp = 7) {
  const r = rng(seed);
  const pts = [];
  for (let x = 0; x <= 100; x += uni(r, 0.8, 1.8)) {
    const y = amp + Math.sin(x / 11 + seed) * amp * 0.6 + uni(r, -amp * 0.5, amp * 0.5);
    pts.push(`${f(x)}% ${f(Math.max(0, y))}px`);
  }
  return `polygon(${pts.join(',')},100% 100%,0% 100%)`;
}

/** 宽度不固定的撕边纸（四边都撕，横向用 %，纵向用 %，抖动用 px） */
export function tornBoxPolygon(seed, amp = 3) {
  const r = rng(seed);
  const pts = [];
  for (let x = 0; x < 100; x += uni(r, 1.2, 2.6)) pts.push(`${f(x)}% ${f(uni(r, 0, amp))}px`);
  for (let y = 0; y < 100; y += uni(r, 1.6, 3.4)) pts.push(`calc(100% - ${f(uni(r, 0, amp))}px) ${f(y)}%`);
  for (let x = 100; x > 0; x -= uni(r, 1.2, 2.6)) pts.push(`${f(x)}% calc(100% - ${f(uni(r, 0, amp))}px)`);
  for (let y = 100; y > 0; y -= uni(r, 1.6, 3.4)) pts.push(`${f(uni(r, 0, amp))}px ${f(y)}%`);
  return `polygon(${pts.join(',')})`;
}

export function TornBox({ seed = 1, amp = 3, bg = 'var(--sheet)', shadow = 'drop', className = '', style, innerStyle, children }) {
  const clip = useMemo(() => tornBoxPolygon(seed, amp), [seed, amp]);
  return (
    <div className={`${shadow || ''} ${className}`} style={style}>
      <div style={{ background: bg, clipPath: clip, position: 'relative', ...innerStyle }}>{children}</div>
    </div>
  );
}

/** 撕边纸片。shadow: 'drop' | 'drop2' | null */
export function Torn({ w, h, seed = 1, sides, amp, bg = 'var(--sheet)', shadow = 'drop', className = '', style, children, ...rest }) {
  const clip = useMemo(() => tornPolygon(w, h, { sides, amp, seed }), [w, h, seed, sides, amp]);
  return (
    <div className={`${shadow || ''} ${className}`} style={style} {...rest}>
      <div style={{ width: w, height: h, background: bg, clipPath: clip, position: 'relative' }}>{children}</div>
    </div>
  );
}

/** 一层纸带：上边撕开，叠在上一层上面（负 margin 盖住接缝） */
export function Band({ tone = 'l1', seed = 1, className = '', children, style }) {
  const clip = useMemo(() => bandPolygon(seed), [seed]);
  return (
    <section className={`band ${className}`} style={{ '--band': `var(--${tone})`, ...style }}>
      <div className="band-bg" style={{ clipPath: clip }} aria-hidden="true" />
      <div className="band-in">{children}</div>
    </section>
  );
}

/* ---------- 蓝晒植物（白色剪影） ---------- */
export const qpt = (p0, p1, p2, t) => [
  (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
  (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1],
];
export const qang = (p0, p1, p2, t) => Math.atan2(
  2 * (1 - t) * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]),
  2 * (1 - t) * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]),
);
export function leafPath(bx, by, ang, L, wd) {
  const tx = bx + Math.cos(ang) * L, ty = by + Math.sin(ang) * L;
  const nx = -Math.sin(ang), ny = Math.cos(ang);
  const mx = bx + Math.cos(ang) * L * 0.45, my = by + Math.sin(ang) * L * 0.45;
  return `M${f(bx)} ${f(by)}Q${f(mx + nx * wd)} ${f(my + ny * wd)} ${f(tx)} ${f(ty)}Q${f(mx - nx * wd)} ${f(my - ny * wd)} ${f(bx)} ${f(by)}Z`;
}
function fern(p0, p1, p2, n, maxL, seed) {
  const r = rng(seed);
  let leaves = '';
  for (let i = 0; i < n; i++) {
    const t = 0.06 + (0.9 * i) / (n - 1);
    const [x, y] = qpt(p0, p1, p2, t);
    const base = qang(p0, p1, p2, t);
    const L = maxL * Math.sin(Math.PI * (0.15 + 0.85 * (1 - t))) * (1 - t * 0.35) + 3;
    for (const s of [-1, 1]) leaves += leafPath(x, y, base + s * (1.05 + uni(r, -0.1, 0.1)), L * uni(r, 0.85, 1.05), L * 0.22);
  }
  return (
    <>
      <path d={`M${p0}Q${p1} ${p2}`} fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      <path d={leaves} fill="#fff" />
    </>
  );
}
function flower(cx, cy, rad, key) {
  return (
    <g key={key} fill="#fff">
      {[0, 1, 2, 3, 4].map((k) => {
        const a = (k * 2 * Math.PI) / 5 - Math.PI / 2;
        return <circle key={k} cx={f(cx + Math.cos(a) * rad * 0.9)} cy={f(cy + Math.sin(a) * rad * 0.9)} r={f(rad * 0.62)} />;
      })}
      <circle cx={f(cx)} cy={f(cy)} r={f(rad * 0.28)} style={{ fill: 'var(--print-b)' }} />
    </g>
  );
}
function sprig(x0, y0, x1, y1, bend, n, seed) {
  const r = rng(seed);
  const p0 = [x0, y0], p2 = [x1, y1], p1 = [(x0 + x1) / 2 + bend, (y0 + y1) / 2];
  const out = [<path key="s" d={`M${p0}Q${p1} ${p2}`} fill="none" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />];
  for (let i = 0; i < n; i++) {
    const [x, y] = qpt(p0, p1, p2, 0.55 + (0.45 * i) / Math.max(1, n - 1));
    const ox = uni(r, -11, 11), oy = uni(r, -9, 5);
    out.push(<path key={`b${i}`} d={`M${f(x)} ${f(y)}L${f(x + ox)} ${f(y + oy)}`} stroke="#fff" strokeWidth=".9" />);
    out.push(flower(x + ox, y + oy, uni(r, 3.2, 4.6), `f${i}`));
  }
  for (let i = 0; i < 3; i++) {
    const t = 0.2 + i * 0.13;
    const [x, y] = qpt(p0, p1, p2, t);
    out.push(<path key={`l${i}`} d={leafPath(x, y, qang(p0, p1, p2, t) + (i % 2 ? 0.9 : -0.9), 15, 4)} fill="#fff" opacity=".92" />);
  }
  return out;
}
function grass(x, y, h, lean, seed) {
  const r = rng(seed);
  return [0, 1, 2, 3].map((i) => {
    const dx = uni(r, -6, 6);
    return (
      <path key={i} fill="none" stroke="#fff" strokeLinecap="round" opacity=".85" strokeWidth={f(uni(r, 0.8, 1.4))}
        d={`M${f(x + dx)} ${f(y)}Q${f(x + dx + lean * 0.3)} ${f(y - h * 0.6)} ${f(x + dx + lean + uni(r, -8, 8))} ${f(y - h * uni(r, 0.75, 1.05))}`} />
    );
  });
}

/** 植物组合：按尺寸自动摆一株蕨、一枝小花、几根草 */
function Plants({ w, h, seed, variant }) {
  if (variant === 'sprig') return <>{sprig(w * 0.3, h, w * 0.55, h * 0.2, w * 0.1, 4, seed)}{grass(w * 0.78, h, h * 0.42, 6, seed + 3)}</>;
  return (
    <>
      {fern([w * 0.19, h * 0.95], [w * 0.34, h * 0.53], [w * 0.73, h * 0.1], 15, Math.min(w, h) * 0.13, seed)}
      {sprig(w * 0.58, h, w * 0.82, h * 0.35, w * 0.1, 6, seed + 5)}
      {grass(w * 0.86, h, h * 0.27, 12, seed + 1)}
    </>
  );
}

/** 只有白色植物剪影（叠在任意蓝底上用，比如蓝晒卡留言） */
export function PlantSprite({ w, h, seed = 5, variant, opacity = 0.55, className, style }) {
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={className} style={style} aria-hidden="true">
      <g opacity={opacity}><Plants w={w} h={h} seed={seed} variant={variant} /></g>
    </svg>
  );
}

/**
 * 蓝晒印相。没有 src 时画白色植物剪影；有 src 时把照片处理成蓝晒效果（去色 + 主题色叠加）。
 * develop：第一次出现时播放「显影」动效。
 */
export function Cyanotype({ w, h, seed = 2, variant = 'fern', src, alt = '', develop = true, className = '', style }) {
  const id = useId().replace(/:/g, '');
  return (
    <div className={`cyano ${develop ? 'm-develop' : ''} ${className}`} style={{ width: w, height: h, ...style }}>
      {src ? (
        <>
          <img src={src} alt={alt} className="ink" />
          <i className="cyano-tint" />
        </>
      ) : (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role={alt ? 'img' : undefined} aria-label={alt || undefined} aria-hidden={alt ? undefined : 'true'}>
          <defs>
            <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" style={{ stopColor: 'var(--print-a)' }} />
              <stop offset=".5" style={{ stopColor: 'var(--print-b)' }} />
              <stop offset="1" style={{ stopColor: 'var(--print-c)' }} />
            </linearGradient>
            <filter id={`n${id}`}>
              <feTurbulence type="fractalNoise" baseFrequency=".75" numOctaves="2" seed="4" />
              <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .22 0" />
            </filter>
            <filter id={`s${id}`}><feGaussianBlur stdDeviation=".45" /></filter>
          </defs>
          <rect width={w} height={h} fill={`url(#g${id})`} />
          <rect width={w} height={h} filter={`url(#n${id})`} />
          <g className="ink" filter={`url(#s${id})`}><Plants w={w} h={h} seed={seed} variant={variant} /></g>
        </svg>
      )}
      {develop && <i className="veil" />}
    </div>
  );
}

/* ---------- 小物件 ---------- */
export function Tape({ w = 70, h = 20, seed = 4, className = '', style }) {
  const clip = useMemo(() => tornPolygon(w, h, { sides: 'lr', amp: 3, seed, step: [2, 4] }), [w, h, seed]);
  return <i aria-hidden="true" className={`tape ${className}`} style={{ width: w, height: h, clipPath: clip, ...style }} />;
}

export function Wax({ size = 56, className = '', style }) {
  const id = useId().replace(/:/g, '');
  const c = size / 2, R = size * 0.39;
  const blob = useMemo(() => {
    const r = rng(9);
    return 'M' + Array.from({ length: 28 }, (_, k) => {
      const a = (k * 2 * Math.PI) / 28, q = R * uni(r, 0.9, 1.04);
      return `${f(c + Math.cos(a) * q)} ${f(c + Math.sin(a) * q)}`;
    }).join('L') + 'Z';
  }, [c, R]);
  const star = 'M' + Array.from({ length: 8 }, (_, k) => {
    const a = (k * Math.PI) / 4 - Math.PI / 2, q = R * (k % 2 ? 0.12 : 0.42);
    return `${f(c + Math.cos(a) * q)} ${f(c + Math.sin(a) * q)}`;
  }).join('L') + 'Z';
  return (
    <svg width={size} height={size} className={`wax ${className}`} style={style} aria-hidden="true">
      <defs>
        <radialGradient id={`w${id}`} cx=".38" cy=".32" r=".8">
          <stop offset="0" style={{ stopColor: 'var(--l1)' }} />
          <stop offset=".5" style={{ stopColor: 'var(--print-b)' }} />
          <stop offset="1" style={{ stopColor: 'var(--print-c)' }} />
        </radialGradient>
      </defs>
      <path d={blob} fill={`url(#w${id})`} />
      <circle cx={c} cy={c} r={R * 0.68} fill="none" stroke="var(--print-c)" strokeWidth="1.2" opacity=".5" />
      <circle cx={c - 0.6} cy={c - 0.6} r={R * 0.68} fill="none" stroke="var(--l1)" strokeWidth=".7" opacity=".7" />
      <path d={star} fill="var(--l1)" opacity=".85" />
    </svg>
  );
}

export function Stamp({ seed = 11, className = '', style }) {
  const pts = [];
  const W = 66, H = 80, r = 2.6;
  for (let i = 0; i <= 9; i++) pts.push([(i * W) / 9, 0], [(i * W) / 9, H]);
  for (let i = 0; i <= 11; i++) pts.push([0, (i * H) / 11], [W, (i * H) / 11]);
  return (
    <div className={`stamp ${className}`} style={style} aria-hidden="true">
      <svg width={W} height={H}>
        <rect width={W} height={H} fill="var(--sheet)" />
        <foreignObject x="6" y="7" width="54" height="64"><Cyanotype w={54} h={64} seed={seed} variant="sprig" develop={false} /></foreignObject>
        <text x="10" y="77" fontFamily="Cormorant Garamond" fontSize="6.5" letterSpacing="1" fill="var(--ink)">POSTE · 2026</text>
        <g fill="var(--stamp-bg, var(--paper))">{pts.map(([x, y], i) => <circle key={i} cx={f(x)} cy={f(y)} r={r} />)}</g>
      </svg>
    </div>
  );
}

export function Postmark({ date = 'OCT · 09', year = '2026', className = '', style }) {
  return (
    <svg width="96" height="80" className={className} style={style} fill="none" stroke="var(--ink)" aria-hidden="true">
      <circle cx="36" cy="40" r="30" strokeWidth="1.1" />
      <circle cx="36" cy="40" r="23" strokeWidth=".6" />
      <text x="36" y="37" textAnchor="middle" fontFamily="Cormorant Garamond" fontSize="8" letterSpacing="1.5" fill="var(--ink)" stroke="none">{date}</text>
      <text x="36" y="48" textAnchor="middle" fontFamily="Cormorant Garamond" fontSize="8" letterSpacing="1.5" fill="var(--ink)" stroke="none">{year}</text>
      <path d="M60 26q9-4 18 0t18 0M62 36q8-4 16 0t16 0M62 46q8-4 16 0t16 0M60 56q9-4 18 0t18 0" strokeWidth=".8" />
    </svg>
  );
}

export function PaperClip({ className = '', style }) {
  return (
    <svg width="22" height="62" className={className} style={style} fill="none" stroke="var(--postmark)" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M7 18V8a4 4 0 0 1 8 0v40a6 6 0 0 1-12 0V14" />
    </svg>
  );
}

export function Vinyl({ size = 92, spinning = false, className = '', style }) {
  const c = size / 2;
  const rings = [];
  for (let k = 6; k < c - 14; k += 3) rings.push(<circle key={k} cx={c} cy={c} r={c - k + 6} fill="none" stroke="#6b7f95" strokeWidth=".35" opacity=".7" />);
  return (
    <svg width={size} height={size} className={`${spinning ? 'spin' : ''} ${className}`} style={style} aria-hidden="true">
      <circle cx={c} cy={c} r={c} fill="#3a5570" />
      {rings}
      <path d={`M${c * 0.4} ${c * 0.4}A${c * 0.85} ${c * 0.85} 0 0 1 ${c * 1.2} ${c * 0.18}`} fill="none" stroke="#fff" strokeWidth="2" opacity=".14" />
      <circle cx={c} cy={c} r={c * 0.3} fill="var(--print-c)" />
      <circle cx={c} cy={c} r="2" fill="var(--paper)" />
    </svg>
  );
}

/** 叶子标本：一维情绪一片叶子，越强越长、颜色越深 */
export function Specimen({ values = [], width = 120, height = 186 }) {
  const p0 = [60, 176], p1 = [52, 96], p2 = [64, 10];
  const n = values.length;
  return (
    <svg width={width} height={height} viewBox="0 0 120 186" aria-hidden="true">
      <path d={`M${p0}Q${p1} ${p2}`} fill="none" stroke="var(--ink)" strokeWidth="1.2" strokeLinecap="round" opacity=".8" />
      {values.map((v, i) => {
        const t = 0.08 + (0.86 * i) / Math.max(1, n - 1);
        const [x, y] = qpt(p0, p1, p2, t);
        const a = qang(p0, p1, p2, t) + (i % 2 ? -1 : 1) * 1.15;
        const L = 10 + v * 38;
        const fill = v > 0.6 ? 'var(--print-c)' : v > 0.4 ? 'var(--print-a)' : 'var(--l1)';
        return (
          <g key={i}>
            <path d={leafPath(x, y, a, L, L * 0.2)} style={{ fill }} fillOpacity=".85" stroke="var(--ink)" strokeWidth=".8" strokeOpacity=".7" />
            <path d={`M${f(x)} ${f(y)}L${f(x + Math.cos(a) * L * 0.5)} ${f(y + Math.sin(a) * L * 0.5)}`} stroke="var(--ink)" strokeWidth=".4" opacity=".5" />
          </g>
        );
      })}
    </svg>
  );
}

/** 纸面颗粒：整页最上面一层，不挡点击 */
export function Grain() {
  return (
    <svg className="grain" aria-hidden="true">
      <filter id="grain-f">
        <feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="7" />
        <feColorMatrix values="0 0 0 0 .25  0 0 0 0 .31  0 0 0 0 .4  0 0 0 .09 0" />
      </filter>
      <rect width="100%" height="100%" filter="url(#grain-f)" />
    </svg>
  );
}
