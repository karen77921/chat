/** 留言板的小工具：按月分组、时间显示、关键词拆段 */

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** [{ key:'2026-10', label:'OCT · 2026', items:[...] }] */
export function groupByMonth(items) {
  const out = [];
  for (const n of items) {
    const d = new Date(n.at);
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    let g = out[out.length - 1];
    if (!g || g.key !== key) out.push((g = { key, label: `${MON[d.getMonth()]} · ${d.getFullYear()}`, items: [] }));
    g.items.push(n);
  }
  return out;
}

/** 今天 18:12 / 昨天 22:40 / 10/08 07:55 */
export function noteTime(iso, now) {
  const d = new Date(iso);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (ymd(d) === ymd(now)) return `今天 ${hm}`;
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (ymd(d) === ymd(y)) return `昨天 ${hm}`;
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${hm}`;
}

export function shortDate(iso, now) {
  const d = new Date(iso);
  return { md: `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`, sub: ymd(d) === ymd(now) ? '今天' : `周${'日一二三四五六'[d.getDay()]}` };
}

/** 把文字按关键词切开，给 <mark> 用 */
export function splitByQuery(text, q) {
  if (!q) return [{ t: text }];
  const parts = [];
  const lower = text.toLowerCase(), k = q.toLowerCase();
  let i = 0;
  for (;;) {
    const j = lower.indexOf(k, i);
    if (j < 0) { parts.push({ t: text.slice(i) }); break; }
    if (j > i) parts.push({ t: text.slice(i, j) });
    parts.push({ t: text.slice(j, j + k.length), hit: true });
    i = j + k.length;
  }
  return parts;
}

/** 某月的日历格子：前面补空，2026-10-01 是周四 → 补 4 格 */
export function monthCells(year, month) {
  const first = new Date(year, month - 1, 1).getDay();
  const days = new Date(year, month, 0).getDate();
  return [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
}
