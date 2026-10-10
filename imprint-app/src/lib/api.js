/**
 * Live adapter for the private backend already installed on chat.jiningji.win.
 * The delivered UI targets a future `/api/*` contract; the current service
 * exposes `/relay/app/*` and `/relay/app/loop/*`. This file translates the
 * important chat/session/config/MCP operations without changing the design.
 */
const BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
const RELAY = `${BASE}/relay`;
// Demo fixtures are available only in the development server and are never
// shipped in the production bundle.
export const MOCK = import.meta.env.DEV && import.meta.env.VITE_MOCK === '1';

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function token() {
  try { return localStorage.getItem('imprint.token') || localStorage.getItem('companion_secret') || ''; }
  catch { return ''; }
}

export function saveToken(value) {
  try {
    const clean = String(value || '').trim();
    for (const key of ['imprint.token', 'companion_secret']) clean ? localStorage.setItem(key, clean) : localStorage.removeItem(key);
  } catch { /* private mode */ }
}
export function savedToken() { return token(); }

function withToken(url) {
  const value = token();
  return value ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(value)}` : url;
}

export function streamUrl() { return withToken(`${RELAY}/app/stream`); }

async function request(path, { method = 'GET', body, form, timeout = 30000, raw } = {}) {
  const headers = {};
  const value = token();
  if (value) headers.Authorization = `Bearer ${value}`;
  if (body !== undefined && !raw) headers['Content-Type'] = 'application/json';
  if (raw?.type) headers['Content-Type'] = raw.type;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(path.startsWith('http') ? path : BASE + path, {
      method, headers, body: raw ?? form ?? (body !== undefined ? JSON.stringify(body) : undefined), signal: ctrl.signal,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text ? { text } : null; }
    if (res.status === 401) window.dispatchEvent(new Event('imprint-auth-required'));
    if (!res.ok) throw new ApiError(res.status, data?.detail || data?.error || res.statusText);
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new ApiError(0, '请求超时');
    throw e;
  } finally { clearTimeout(timer); }
}

const loop = (path, opts) => request(`${RELAY}/app/loop/${path}`, opts);

function tideMemoryItems(text, query = '') {
  const clean = String(text || '').trim();
  if (!clean) return [];
  let blocks = clean.split(/\n\s*\n+/).map((x) => x.trim()).filter(Boolean);
  if (blocks.length === 1 && clean.includes('\n')) blocks = clean.split(/\n+/).map((x) => x.trim()).filter(Boolean);
  return blocks.slice(0, 120).map((block, index) => {
    const value = block.replace(/^\s*(?:[-*•]+|\d+[.)])\s*/, '').replace(/^#{1,6}\s*/, '').trim();
    return { id: `tide-${index}-${value.length}`, no: blocks.length - index, at: null, text: value.slice(0, 2000), tag: query ? '搜索' : '心潮', by: 'him' };
  });
}

function quoteParts(text) {
  const m = String(text || '').match(/^> 引用：([^\n]+)\n\n([\s\S]*)$/);
  return m ? { text: m[2], quote: { id: '', from: 'him', text: m[1] } } : { text: String(text || '') };
}

function attachmentUrl(a) {
  const url = String(a?.url || '');
  if (!url) return '';
  return withToken(url.startsWith('/') ? `${BASE}${url}` : url);
}

function listenPayload(data) {
  if (!data) return data;
  const track = data.track ? { ...data.track, url: attachmentUrl(data.track) } : null;
  const playlist = (data.playlist || []).map((item) => ({ ...item, url: attachmentUrl(item) }));
  return { ...data, track, playlist };
}

export function relayMessage(raw) {
  const mine = raw.from === 'human';
  const q = quoteParts(raw.text);
  const atts = raw?.meta?.attachments || raw.attachments || [];
  const images = atts.filter((a) => String(a.mime || '').startsWith('image/'));
  const file = atts.find((a) => !String(a.mime || '').startsWith('image/'));
  const out = {
    id: raw.id, from: mine ? 'me' : 'him', type: 'text', text: q.text, at: raw.ts || new Date().toISOString(), quote: q.quote,
    status: raw?.meta?.api?.error ? 'failed' : (mine && raw?.meta?.deferred && !raw?.meta?.reply_requested ? 'queued' : 'sent'),
    thinking: raw?.meta?.thinking || '', edited: Boolean(raw?.meta?.edited_at),
  };
  if (images.length) {
    out.type = 'images';
    out.images = images.map((a) => ({ url: attachmentUrl(a), thumb: attachmentUrl(a), w: a.w, h: a.h }));
  } else if (file) {
    out.type = 'file'; out.file = { name: file.name || '附件', size: file.size || 0, url: attachmentUrl(file) };
  } else if (raw.kind === 'act') {
    out.type = 'command'; out.command = { title: raw?.meta?.title || '使用工具', cmd: raw?.meta?.command || '', output: raw.text || '', exitCode: raw?.meta?.exit_code ?? 0, ms: raw?.meta?.ms || 0 };
  }
  return out;
}

function chatList(sessions) {
  const rows = [...(sessions || [])].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  const convert = (s) => ({ id: s.id, kind: 'window', name: s.title || '新对话', provider: '私人后端', members: [{ id: 'him', name: 'Ombre' }], pinned: Boolean(s.pinned), preview: '', lastAt: s.updated_at || s.created_at, unread: 0, replying: false });
  return { available: true, windows: rows.filter((x) => !x.archived).map(convert), groups: [], archived: rows.filter((x) => x.archived).map(convert) };
}

async function loadChat(id) {
  const [ss, hist, settings, reactions] = await Promise.all([
    request(`${RELAY}/app/sessions`),
    request(`${RELAY}/app/history?session_id=${encodeURIComponent(id)}&since=0&limit=500`),
    loop('imprint/settings').catch(() => ({ avatars: {} })),
    loop('imprint/chat/reactions').catch(() => ({ items: [] })),
  ]);
  const s = (ss.sessions || []).find((x) => x.id === id) || { id, title: '新对话' };
  const reactionById = new Map((reactions.items || []).map((item) => [String(item.messageId), item.stickerId]));
  return {
    available: true, id, kind: 'window', name: s.title,
    me: { id: 'me', name: '我', avatar: attachmentUrl({ url: settings.avatars?.me }) },
    members: [{ id: 'him', name: settings.contact?.himName || 'Ombre', avatar: attachmentUrl({ url: settings.avatars?.him }) }],
    presence: { online: true }, replying: null, beauty: settings.beauty || {},
    wallpaper: settings.beauty?.wallpaper ? attachmentUrl({ url: settings.beauty.wallpaper }) : null,
    items: (hist.messages || []).filter((m) => m?.meta?.visible !== false && m.kind !== 'thinking')
      .map((message) => ({ ...relayMessage(message), reaction: reactionById.get(String(message.id)) || null })),
  };
}

async function sendMessage(id, body) {
  const attachments = [];
  if (body.type === 'images') for (const image of body.images || []) attachments.push({ ...image, mime: 'image/jpeg', name: '图片' });
  if (body.type === 'file' && body.file) attachments.push({ ...body.file, mime: 'application/octet-stream' });
  if (body.type === 'voice' && body.voice) attachments.push({ ...body.voice, mime: 'audio/webm', name: '语音' });
  const prefix = body.quote?.text ? `> 引用：${body.quote.text.replace(/\s+/g, ' ').slice(0, 180)}\n\n` : '';
  const text = prefix + (body.text || (body.type === 'sticker' ? `[表情：${body.sticker?.id || '表情'}]` : ''));
  const result = await request(`${RELAY}/app/send`, { method: 'POST', body: { text, attachments, defer: true, api_session: id } });
  return relayMessage({ id: result.id, from: 'human', kind: 'user', text, ts: new Date().toISOString(), meta: result.meta || { api_session: id, deferred: true, reply_requested: false, attachments } });
}

async function liveFeatures() {
  const [cfg, mcp] = await Promise.all([loop('config'), loop('mcp')]);
  return {
    available: true,
    features: [
      { key: 'reach', name: '主动找你', desc: `Wake 2.0 · ${cfg.wake?.control?.mode || '低频'}`, last: cfg.wake?.state?.last_opportunity_at || '', on: cfg.wake?.control?.enabled !== false },
      { key: 'memory', name: '心潮记忆整理', desc: '上下文压缩后沉入心潮记忆', last: '', on: cfg.context_compaction !== false },
      { key: 'recall', name: '心潮自动回想', desc: '每轮按当前话题读取心潮记忆', last: '', on: cfg.ombre_auto_recall !== false },
      { key: 'time', name: '现实时间感知', desc: cfg.context_timezone || 'Asia/Shanghai', last: '', on: cfg.context_time !== false },
      { key: 'backup', name: '自动备份', desc: `每 ${cfg.backup_interval_hours || 24} 小时`, last: '', on: cfg.backup_enabled !== false },
    ],
    mcps: (mcp.servers || []).map((x) => ({ id: x.name, name: x.name, tools: x.tools?.length || 0, status: x.status === 'online' ? 'ok' : x.status === 'connecting' ? 'pending' : 'down', on: x.enabled !== false })),
  };
}

async function compat(path, opts) {
  const method = opts.method || 'GET';
  const [p] = path.split('?');
  const query = path.slice(p.length);
  let m;
  if (method === 'GET' && p === '/api/chats') return request(`${RELAY}/app/sessions`).then((x) => chatList(x.sessions));
  if (method === 'POST' && p === '/api/chats') {
    const x = await request(`${RELAY}/app/sessions`, { method: 'POST', body: { title: opts.body?.name || '新对话', activate: true } });
    return { id: x.created?.id || x.active_session };
  }
  if (method === 'GET' && p === '/api/connections') return { available: true, items: [{ id: 'main', name: '私人后端', kind: 'window', provider: 'Imprint API loop', note: '现有主窗口', status: 'ok', statusText: '在线', mode: 'OpenAI 兼容 API', workdir: 'VPS 私有目录', sandbox: '只访问已配置目录' }] };
  if (method === 'GET' && (m = /^\/api\/chats\/([^/]+)$/.exec(p))) return loadChat(decodeURIComponent(m[1]));
  if (method === 'PATCH' && (m = /^\/api\/chats\/([^/]+)$/.exec(p))) {
    const body = {};
    if (opts.body?.name !== undefined) body.title = opts.body.name;
    if (opts.body?.pinned !== undefined) body.pinned = opts.body.pinned;
    if (opts.body?.archived !== undefined) body.archived = opts.body.archived;
    if (opts.body?.active !== undefined) body.active = opts.body.active;
    return loop(`sessions/${m[1]}/patch`, { method: 'POST', body });
  }
  if (method === 'DELETE' && (m = /^\/api\/chats\/([^/]+)$/.exec(p))) return loop(`sessions/${m[1]}/delete`, { method: 'POST' });
  if (method === 'POST' && (m = /^\/api\/chats\/([^/]+)\/messages$/.exec(p))) return sendMessage(decodeURIComponent(m[1]), opts.body || {});
  if (method === 'POST' && (m = /^\/api\/chats\/([^/]+)\/reply$/.exec(p))) return request(`${RELAY}/app/trigger`, { method: 'POST', body: { api_session: decodeURIComponent(m[1]) } });
  if (method === 'POST' && (m = /^\/api\/chats\/([^/]+)\/pause$/.exec(p))) return loop('cancel', { method: 'POST', body: { session_id: decodeURIComponent(m[1]) } });
  if (method === 'POST' && (m = /^\/api\/chats\/([^/]+)\/messages\/([^/]+)\/regenerate$/.exec(p))) return loop('regenerate', { method: 'POST', body: { session_id: decodeURIComponent(m[1]), reply_message_id: Number(m[2]) } });
  if (method === 'PUT' && (m = /^\/api\/chats\/([^/]+)\/messages\/([^/]+)$/.exec(p))) return loop(`messages/${m[2]}`, { method: 'PATCH', body: { text: opts.body?.text } });
  if (method === 'DELETE' && (m = /^\/api\/chats\/([^/]+)\/messages\/([^/]+)$/.exec(p))) return loop(`messages/${m[2]}/delete`, { method: 'POST', body: { session_id: decodeURIComponent(m[1]) } });
  if (method === 'POST' && (m = /^\/api\/chats\/([^/]+)\/messages\/([^/]+)\/react$/.exec(p))) {
    return loop(`imprint/chat/messages/${m[2]}/reaction`, { method: 'POST', body: { stickerId: opts.body?.stickerId } });
  }
  if (method === 'POST' && p === '/api/chat/upload') {
    const file = opts.form?.get('file');
    const uploaded = await request(`${RELAY}/app/upload?name=${encodeURIComponent(file?.name || 'attachment')}`, { method: 'POST', raw: file, timeout: opts.timeout || 60000 });
    return { ...uploaded, url: uploaded.url, thumb: uploaded.thumb || uploaded.url };
  }
  if (method === 'GET' && p === '/api/stickers') {
    const data = await loop('imprint/stickers');
    return { ...data, mine: data.mine.map((s) => ({ ...s, url: attachmentUrl(s) })), his: data.his.map((s) => ({ ...s, url: attachmentUrl(s) })) };
  }
  if (method === 'POST' && p === '/api/stickers') {
    const sticker = await loop('imprint/stickers', opts);
    return { ...sticker, url: attachmentUrl(sticker) };
  }
  if (method === 'DELETE' && (m = /^\/api\/stickers\/([^/]+)$/.exec(p))) return loop(`imprint/stickers/${m[1]}`, opts);
  if (method === 'GET' && p === '/api/features') return liveFeatures();
  if (method === 'PUT' && (m = /^\/api\/features\/([^/]+)$/.exec(p))) {
    const key = m[1], on = Boolean(opts.body?.on);
    if (key === 'reach') return loop('wake/config', { method: 'POST', body: { enabled: on, mode: 'low-frequency', make_default: true } });
    const fields = { memory: 'context_compaction', recall: 'ombre_auto_recall', time: 'context_time', backup: 'backup_enabled' };
    return loop('config', { method: 'POST', body: { [fields[key]]: on } });
  }
  if (method === 'POST' && p === '/api/mcp') return loop('mcp', { method: 'POST', body: { name: opts.body?.name, transport: 'http', url: opts.body?.url, enabled: true } }).then((x) => ({ id: x.server?.name, name: x.server?.name, status: x.server?.status === 'online' ? 'ok' : 'pending', tools: x.server?.tools?.length || 0, on: true }));
  if (method === 'POST' && (m = /^\/api\/mcp\/([^/]+)\/reconnect$/.exec(p))) return loop(`mcp/${m[1]}/reconnect`, { method: 'POST' }).then((x) => ({ id: m[1], status: x.ok ? 'ok' : 'down', on: true }));
  if (method === 'PUT' && (m = /^\/api\/mcp\/([^/]+)$/.exec(p))) {
    const current = await loop('mcp');
    const server = (current.servers || []).find((row) => row.name === decodeURIComponent(m[1]));
    if (!server) throw new ApiError(404, '找不到这个 MCP');
    return loop('mcp', { method: 'POST', body: { ...server, enabled: Boolean(opts.body?.on) } });
  }
  if (method === 'GET' && p === '/api/settings/console') return loop('imprint/usage');
  if (method === 'GET' && p === '/api/logs/cache') return loop(`imprint/usage/cache${query}`);
  if (method === 'GET' && p === '/api/logs/tools') return loop('imprint/logs/tools');
  if (method === 'GET' && p === '/api/logs/backend') return { available: true, items: [] };
  if (method === 'GET' && p === '/api/settings/beauty') return loop('imprint/settings');
  if (method === 'PUT' && p === '/api/settings/contact') return loop('imprint/settings/contact', { ...opts, method: 'POST' });
  if (method === 'PUT' && p === '/api/settings/beauty') return loop('imprint/settings/beauty', { ...opts, method: 'POST' });
  if (method === 'PUT' && p === '/api/settings/avatar') return loop('imprint/settings/avatar', { ...opts, method: 'POST' });
  if (method === 'GET' && p === '/api/home') {
    const [notes, activity, settings, tide, listen, watch] = await Promise.all([
      loop('imprint/notes'), loop('imprint/activity'), loop('imprint/settings'), loop('tide/pulse').catch(() => null),
      loop('imprint/together/listen').catch(() => null), loop('imprint/together/watch').catch(() => null),
    ]);
    const track = listen?.track;
    const nextWatch = watch?.list?.find((item) => item.status === 'scheduled' && (item.at || item.scheduledAt));
    return { available: true, now: new Date().toISOString(),
      names: { me: '我', him: settings.contact?.himName || 'Ombre' }, together: { since: '2026-09-18' }, greeting: '',
      state: tide?.available === false ? null : tide?.state,
      listen: track ? { ...track, positionS: listen.positionS || 0, playing: listen.playing } : null,
      watch: nextWatch ? { title: nextWatch.title, order: 1, at: nextWatch.at || nextWatch.scheduledAt || nextWatch.createdAt, ticketNo: String(nextWatch.id || '').slice(0, 6) } : null,
      note: notes.items[0] ? { ...notes.items[0], total: notes.total } : null, activity: activity.items || [] };
  }
  if (method === 'POST' && p === '/api/activity/read') return loop('imprint/activity/read', { method: 'POST' });
  if (method === 'GET' && p === '/api/notes') return loop(`imprint/notes${query}`);
  if (method === 'GET' && p === '/api/notes/calendar') return loop(`imprint/notes/calendar${query}`);
  if (method === 'POST' && p === '/api/notes') return loop('imprint/notes', opts);
  if (method === 'GET' && p === '/api/room') return loop('imprint/room');
  if (method === 'GET' && p === '/api/room/photos') {
    const data = await loop(`imprint/room/photos${query}`);
    return { ...data, items: data.items.map((x) => ({ ...x, url: attachmentUrl(x), thumb: attachmentUrl({ url: x.thumb || x.url }) })) };
  }
  if (method === 'POST' && p === '/api/room/photos') {
    const x = await loop('imprint/room/photos', opts);
    return { ...x, url: attachmentUrl(x), thumb: attachmentUrl(x) };
  }
  if ((method === 'POST' || method === 'DELETE') && (m = /^\/api\/room\/photos\/([^/]+)(?:\/(fav|notes))?$/.exec(p))) {
    return loop(`imprint/room/photos/${m[1]}${m[2] ? `/${m[2]}` : ''}`, opts);
  }
  if (method === 'GET' && p === '/api/room/solo') return loop('imprint/room/solo');
  if (method === 'GET' && p === '/api/spark') return loop('imprint/spark');
  if (method === 'POST' && p === '/api/spark/cards/use') return loop('imprint/spark/cards/use', opts);
  if (method === 'GET' && p === '/api/spark/shop') return loop(`imprint/spark/shop${query}`);
  if (method === 'POST' && p === '/api/spark/shop') return loop('imprint/spark/shop', opts);
  if (method === 'POST' && p === '/api/spark/redeem') return loop('imprint/spark/redeem', opts);
  if (method === 'GET' && p === '/api/spark/kept') return loop('imprint/spark/kept');
  if (method === 'POST' && (m = /^\/api\/spark\/kept\/([^/]+)\/active$/.exec(p))) return loop(`imprint/spark/kept/${m[1]}/active`, opts);
  if (method === 'GET' && p === '/api/together/watch') return loop('imprint/together/watch');
  if (method === 'POST' && p === '/api/together/watch/list') return loop('imprint/together/watch/list', opts);
  if (method === 'GET' && p === '/api/music/search') return loop(`imprint/together/tracks${query}`).then((data) => ({ ...data, items: (data.items || []).map((item) => ({ ...item, url: attachmentUrl(item) })) }));
  if (method === 'POST' && p === '/api/music/tracks') return loop('imprint/together/tracks', opts).then(listenPayload);
  if (method === 'GET' && p === '/api/together/listen') return loop('imprint/together/listen').then(listenPayload);
  if (method === 'POST' && p === '/api/together/listen') return loop('imprint/together/listen', opts).then(listenPayload);
  if (method === 'POST' && p === '/api/together/playlist') return loop('imprint/together/playlist', opts).then(listenPayload);
  if (method === 'PUT' && p === '/api/together/playlist') return loop('imprint/together/playlist', opts).then(listenPayload);
  if (method === 'DELETE' && (m = /^\/api\/together\/playlist\/([^/]+)$/.exec(p))) return loop(`imprint/together/playlist/${m[1]}`, opts).then(listenPayload);
  if (method === 'GET' && p === '/api/tide') return loop('tide/pulse');
  if (method === 'GET' && p === '/api/tide/dreams') return loop('imprint/tide/dreams');
  if (method === 'GET' && p === '/api/tide/memory') {
    const query = new URL(path, window.location.origin).searchParams.get('q') || '';
    const [result, meta] = await Promise.all([
      loop('memories', { method: 'POST', body: { query } }),
      loop('imprint/tide/memory-meta').catch(() => ({ stats: {}, heat: [], items: [], recent: [] })),
    ]);
    const remote = tideMemoryItems(result.text, query);
    const local = (meta.items || []).filter((item) => !query || item.text?.includes(query) || item.tag?.includes(query));
    const localByText = new Map(local.map((item) => [String(item.text || '').trim(), item]));
    const seen = new Set();
    const items = remote.map((item) => {
      const saved = localByText.get(String(item.text || '').trim());
      if (!saved) return item;
      seen.add(saved.id);
      return { ...item, id: saved.id, at: saved.at, tag: saved.tag || item.tag, by: saved.by || item.by };
    });
    items.push(...local.filter((item) => !seen.has(item.id)).map((item, index) => ({ ...item, no: items.length + index + 1 })));
    return {
      available: true,
      now: new Date().toISOString(),
      stats: { longTerm: items.length, weekWrites: meta.stats?.weekWrites ?? 0, manual: meta.stats?.manual ?? 0 },
      heat: meta.heat || [],
      items,
      recent: meta.recent || [],
    };
  }
  if (method === 'POST' && p === '/api/tide/memory') {
    const text = String(opts.body?.text || '').trim();
    const tag = String(opts.body?.tag || '').trim();
    if (!text) throw new ApiError(400, '请先写下要记住的内容');
    await loop('memories/write', { method: 'POST', body: { text, tag, mode: text.length > 500 ? 'grow' : 'hold', tell_him: Boolean(opts.body?.tellHim) }, timeout: 60000 });
    return { id: `tide-${Date.now()}`, no: Date.now(), at: new Date().toISOString(), text, tag, by: 'me' };
  }
  // A missing live route must fail visibly instead of claiming a demo write
  // succeeded or silently inserting somebody else's reference material.
  throw new ApiError(501, '此功能尚未接入真实保存，示例数据不会写入。');
}

export async function api(path, opts = {}) {
  const options = { method: 'GET', ...opts };
  if (MOCK) return (await import('./mock.js')).mockFetch(path, options);
  if (path.startsWith('/api/')) return compat(path, options);
  return request(path, options);
}

export function adaptStreamEvent(raw, chatId) {
  const sid = String(raw?.api_session ?? raw?.meta?.api_session ?? '');
  if (sid && sid !== chatId) return null;
  if (raw.type === 'typing') {
    const iso = new Date().toISOString();
    return { type: 'status', chatId, replying: raw.active ? { startedAt: iso, lastEventAt: iso } : null };
  }
  if (raw.type === 'thinking_delta' || raw.type === 'reply_delta' || raw.kind === 'act') {
    const iso = new Date().toISOString();
    return { type: 'status', chatId, replying: raw.done ? null : { startedAt: iso, lastEventAt: iso } };
  }
  if (raw.id != null) return { type: 'message', chatId, message: relayMessage(raw) };
  return null;
}
