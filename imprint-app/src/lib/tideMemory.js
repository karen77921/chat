const CATALOG_ROW = /^(?:[-*•]\s*|\d+[.)]\s*)?(\d{4}-\d{2}-\d{2})[ T](\d{2})[-:](\d{2})[-:](\d{2})\s+(.+)$/;

const cleanText = (value) => String(value || '').trim();
const localDay = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

function stableId(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `ombre-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function parseTideMemoryText(raw, query = '') {
  const clean = cleanText(raw).replace(/\r/g, '');
  if (!clean) return [];
  const rows = [];
  const seen = new Set();
  for (const original of clean.split('\n')) {
    const match = original.trim().match(CATALOG_ROW);
    if (!match) continue;
    const parts = match[5].split('|').map((part) => part.trim());
    const text = cleanText(parts[0]).replace(/^[-—\s]+|[-—\s]+$/g, '');
    if (!text) continue;
    const at = `${match[1]}T${match[2]}:${match[3]}:${match[4]}+08:00`;
    const key = `${at}\n${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const tagPart = parts[1] && !/^\d+(?:\.\d+)?$/.test(parts[1]) ? parts[1] : '';
    rows.push({ id: stableId(key), at, text, tag: tagPart.split(/[,，]/).map((x) => x.trim()).filter(Boolean).join(' · ') || (query ? '搜索' : '心潮'), by: 'him' });
  }
  if (rows.length) return rows;

  let blocks = clean.split(/\n\s*\n+/).map((x) => x.trim()).filter(Boolean);
  if (blocks.length === 1 && clean.includes('\n')) blocks = clean.split('\n').map((x) => x.trim()).filter(Boolean);
  const skip = /(记忆目录|先看目录|breath_search|动态（|relation)/i;
  return blocks.filter((x) => !skip.test(x)).slice(0, 120).map((block) => {
    const text = block.replace(/^\s*(?:[-*•]+|\d+[.)])\s*/, '').trim().slice(0, 2000);
    return { id: stableId(text), at: null, text, tag: query ? '搜索' : '心潮', by: 'him' };
  }).filter((item) => item.text);
}

function heatFor(items, now) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - 118);
  const counts = new Map();
  for (const item of items) {
    const day = localDay(item.at);
    if (day) counts.set(day, (counts.get(day) || 0) + 1);
  }
  return Array.from({ length: 119 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    const date = localDay(day);
    return { date, count: counts.get(date) || 0 };
  });
}

export function normalizeTideMemories(result, meta = {}, query = '', now = new Date()) {
  const remote = Array.isArray(result?.items) && result.items.length
    ? result.items.map((item) => ({ ...item }))
    : parseTideMemoryText(result?.text, query);
  const local = (meta.items || []).filter((item) => !query || item.text?.includes(query) || item.tag?.includes(query));
  const localByText = new Map(local.map((item) => [cleanText(item.text), item]));
  const seenIds = new Set();
  const merged = remote.map((item) => {
    const saved = localByText.get(cleanText(item.text));
    if (!saved) return item;
    seenIds.add(saved.id);
    return { ...item, id: saved.id, at: saved.at || item.at, tag: saved.tag || item.tag, by: saved.by || item.by };
  });
  merged.push(...local.filter((item) => !seenIds.has(item.id)));
  merged.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  const items = merged.map((item, index) => ({ ...item, no: merged.length - index }));

  const observedAt = new Date(now);
  const current = new Date(observedAt);
  current.setHours(0, 0, 0, 0);
  const weekStart = new Date(current);
  weekStart.setDate(current.getDate() - ((current.getDay() + 6) % 7));
  const weekWrites = items.filter((item) => {
    if (!item.at) return false;
    const date = new Date(item.at);
    return !Number.isNaN(date.getTime()) && date >= weekStart;
  }).length;
  const recent = items.filter((item) => item.at).slice(0, 8).map((item) => ({ at: item.at, text: item.text }));
  return {
    available: true,
    now: observedAt.toISOString(),
    stats: {
      longTerm: items.length,
      weekWrites,
      manual: items.filter((item) => item.by === 'me').length,
    },
    heat: heatFor(items, current),
    items,
    recent,
  };
}
