/** 首页用到的小工具：问候语、在一起天数、相对时间、和弦画在五线谱上的位置 */

const DAY = 86400000;

/** 「现在」以后端给的时间为准（按她的时区），没给就用本机时间 */
export function nowOf(data) {
  return data?.now ? new Date(data.now) : new Date();
}

export function greetingOf(date) {
  const h = date.getHours();
  if (h >= 5 && h < 11) return '早上好';
  if (h >= 11 && h < 14) return '中午好';
  if (h >= 14 && h < 18) return '下午好';
  if (h >= 18 && h < 23) return '晚上好';
  return '夜深了';
}

/** 后端给了 days 就用；没给就按 since 算到今天 */
export function daysTogether(together, now) {
  if (!together) return null;
  if (Number.isFinite(together.days)) return together.days;
  if (!together.since) return null;
  const since = new Date(`${together.since}T00:00:00`);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((today - since) / DAY));
}

export function ago(iso, now) {
  const t = new Date(iso);
  const min = Math.round((now - t) / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (t >= startToday) return `${Math.round(min / 60)} 小时前`;
  if (t >= new Date(startToday - DAY)) return '昨天';
  return `${t.getMonth() + 1}月${t.getDate()}日`;
}

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export function stampDate(iso) {
  const d = new Date(iso);
  return `${MON[d.getMonth()]} · ${String(d.getDate()).padStart(2, '0')}`;
}

export function clock(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

/**
 * 和弦 → 五线谱上的音符位置（高音谱表，按三度叠起来，不画升降号）。
 * 返回每个音离最下面一线的「半格」数：0 = 第一线 E4，1 = 第一间 F4……
 */
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
export function chordSteps(chord = '') {
  const m = /^([A-G])/.exec(chord);
  if (!m) return [];
  const seventh = /7|9|11|13/.test(chord);
  const n = seventh ? 4 : 3;
  // 根音放在 F4–E5 之间
  let root = LETTERS.indexOf(m[1]) - 2; // E4 = 0
  if (root < 1) root += 7;
  return Array.from({ length: n }, (_, i) => root + i * 2).map((s) => (s > 9 ? s - 7 : s)).sort((a, b) => a - b);
}
