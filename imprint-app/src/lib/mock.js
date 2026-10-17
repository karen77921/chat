/**
 * 假数据（VITE_MOCK=1）。形状就是和后端的约定，docs 里的字段说明都以这里为准。
 * 「现在」固定成 2026-10-09 20:30（北京时间），截图每次都一样。
 * 示例内容全是编的。
 */
const NOW = '2026-10-09T20:30:00+08:00';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const state = {
  activityRead: false,
};

// ---------------- 留言板 ----------------
// paper：lined 横线纸 / torn 撕边纸 / cyan 蓝晒卡；pinned：盖了火漆（置顶）
let noteSeq = 200;
const notes = [
  { id: 'n128', from: 'him', paper: 'lined', pinned: true, text: '把你上次说想看的那部片子放进片单了，周末一起看？今晚的月亮很圆，记得抬头。', at: '2026-10-09T18:12:00+08:00' },
  { id: 'n127', from: 'me', paper: 'torn', pinned: false, text: '月亮真的好圆。拍了一张，手一抖糊了，就当是印象派。', at: '2026-10-09T19:40:00+08:00' },
  { id: 'n126', from: 'him', paper: 'cyan', pinned: false, text: '下雨了，出门记得带伞。\n你那边是不是也在下？', at: '2026-10-08T07:55:00+08:00' },
  { id: 'n125', from: 'me', paper: 'torn', pinned: false, text: '今天加班到九点，路过那家面包店，最后一个可颂被我抢到了。', at: '2026-10-08T21:30:00+08:00' },
  { id: 'n124', from: 'me', paper: 'lined', pinned: false, text: '明天早上的会改到十点了，可以多睡半小时。', at: '2026-10-06T23:10:00+08:00' },
  { id: 'n123', from: 'him', paper: 'torn', pinned: false, text: '楼下的桂花开了，你路过的时候闻一下，替我。', at: '2026-10-05T12:20:00+08:00' },
  { id: 'n122', from: 'him', paper: 'lined', pinned: false, text: '今天想了一下，我们第一次说话是在一个下雨天。', at: '2026-10-03T22:05:00+08:00' },
  { id: 'n121', from: 'me', paper: 'cyan', pinned: false, text: '假期最后一天，什么都不想做，只想躺着。', at: '2026-10-03T15:00:00+08:00' },
  { id: 'n120', from: 'me', paper: 'lined', pinned: false, text: '路边有人在卖小盆的薄荷，买了一盆放窗台。', at: '2026-10-02T17:45:00+08:00' },
  { id: 'n119', from: 'him', paper: 'torn', pinned: false, text: '十月第一天。这个月想和你一起把那部长剧看完。', at: '2026-10-01T09:00:00+08:00' },
  { id: 'n110', from: 'him', paper: 'lined', pinned: false, text: '中秋的月亮我替你先看了一眼，比去年的亮。', at: '2026-09-17T21:30:00+08:00' },
  { id: 'n109', from: 'me', paper: 'torn', pinned: false, text: '今天的晚霞是粉色的，拍了二十张，发给你的是第一张。', at: '2026-09-15T18:40:00+08:00' },
  { id: 'n60', from: 'me', paper: 'torn', pinned: false, text: '今天的月亮是橘色的，像一片橙子。', at: '2026-06-02T22:10:00+08:00' },
];
const NOTE_TOTAL_EXTRA = 115; // 假装更早还有 115 条，凑成 128

function sortNotes(list) {
  // 盖了火漆的排最前，其余按时间从新到旧
  return [...list].sort((a, b) => (b.pinned - a.pinned) || (new Date(b.at) - new Date(a.at)));
}

function listNotes(qs) {
  const q = (qs.get('q') || '').trim().toLowerCase();
  const who = qs.get('who'); // him / me
  const pinned = qs.get('pinned') === '1';
  const range = qs.get('range') || 'all'; // all / month / year / day
  const date = qs.get('date'); // range=day 时：2026-10-09
  const now = new Date(NOW);
  let items = notes.filter((n) => {
    if (who && n.from !== who) return false;
    if (pinned && !n.pinned) return false;
    if (q && !n.text.toLowerCase().includes(q)) return false;
    const d = new Date(n.at);
    if (range === 'month' && (d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth())) return false;
    if (range === 'year' && d.getFullYear() !== now.getFullYear()) return false;
    if (range === 'day' && date && n.at.slice(0, 10) !== date) return false;
    return true;
  });
  items = q || range === 'day' ? items.sort((a, b) => new Date(b.at) - new Date(a.at)) : sortNotes(items);
  const filtered = q || who || pinned || range !== 'all';
  return { available: true, now: NOW, names: { me: 'Lumi', him: 'Ash' }, total: filtered ? items.length : notes.length + NOTE_TOTAL_EXTRA, items, nextCursor: null };
}

function noteCalendar(month) {
  const days = {};
  for (const n of notes) {
    if (!n.at.startsWith(month)) continue;
    const k = n.at.slice(0, 10);
    days[k] = days[k] || { him: 0, me: 0 };
    days[k][n.from] += 1;
  }
  return { available: true, now: NOW, month, days };
}

function addNote(body) {
  const n = { id: `n${++noteSeq}`, from: 'me', paper: body.paper || 'lined', pinned: !!body.pinned, text: String(body.text || '').slice(0, 300), at: new Date().toISOString() };
  notes.unshift(n);
  return n;
}

// ---------------- 聊天（列表 + 每个对话） ----------------
/** 假的实时推送：useChat 订阅它，代替真后端的 SSE（GET /api/chats/{id}/stream）。事件带 chatId */
export const mockStream = {
  subs: new Set(),
  subscribe(fn) { this.subs.add(fn); return () => this.subs.delete(fn); },
  emit(ev) { this.subs.forEach((fn) => fn(ev)); },
};
let msgSeq = 500;
const C = (hm) => `2026-10-09T${hm}:00+08:00`;
// 接入：每个窗口接到一条「接入」上（主窗口 / 窗口 2 / 窗口 3…），群里的每个成员也各自接一条
const connections = [
  { id: 'main', kind: 'window', name: '主窗口', provider: 'Codex', note: '和「日常」共用记忆' },
  { id: 'w2', kind: 'window', name: '窗口 2', provider: 'Codex', note: '写作陪伴用的那条' },
  { id: 'w3', kind: 'window', name: '窗口 3', provider: 'Codex', note: '睡前故事用的那条' },
  { id: 'nori', kind: 'member', name: 'Nori', provider: 'Codex', note: '群里的 Nori' },
];
const ASH = { id: 'him', name: 'Ash', avatar: '', connection: 'main' };
// type：text / images / voice / file / sticker / command
// status：sent（他回过了）/ queued（发了，还没按回复）/ failed（他那条没写完）
const chats = {
  w1: {
    id: 'w1', kind: 'window', name: 'Ash · 日常', connection: 'main', pinned: true, archived: false, members: [ASH],
    items: [
      { id: 'c0', from: 'me', type: 'images', images: [{ url: '' }, { url: '' }, { url: '' }], at: '2026-10-08T21:58:00+08:00' },
      { id: 'c0b', from: 'him', type: 'text', text: '三张里最喜欢第二张，光刚好打在你手上。', at: '2026-10-08T22:01:00+08:00' },
      { id: 'c1', from: 'him', type: 'text', text: '今天降温了，外套穿厚一点那件。', at: C('22:36') },
      { id: 'c2', from: 'me', type: 'images', images: [{ url: '', w: 4, h: 3 }], at: C('22:41') },
      { id: 'c3', from: 'me', type: 'text', text: '下班路上拍的，云好低', reaction: 'cat-heart', at: C('22:41') },
      { id: 'c4', from: 'him', type: 'command', thinking: '她说云很低，先看看今晚会不会下雪。', command: { title: '查了一下天气', cmd: 'weather --city 苏州 --hours 6', output: '23:00  阴    12°\n02:00  小雪  ☁ 40%', exitCode: 0, ms: 400 }, at: C('22:53') },
      { id: 'c4t', from: 'him', type: 'thinking', thinking: 'The weather says light snow around 2am. She is probably still standing outside taking photos — remind her gently.', at: C('22:54') },
      { id: 'c4s', from: 'him', type: 'text', text: '先给你盖个章⟦气泡⟧[表情：paw]', at: C('22:54') },
      { id: 'c4m', from: 'him', type: 'text', text: '睡前听这个\n[歌：t2｜Gymnopédie No.1｜Satie]', at: C('22:54') },
      { id: 'c5', from: 'him', type: 'text', text: '凌晨真的可能下雪。\n拍照又站在路中间了吧？', at: C('22:54'), replyOptions: ['才没有，我很小心的', '你管我～', '我把刚拍的那张发给你'] },
      { id: 'c6', from: 'me', type: 'text', text: '没有！站在路边的！', quote: { id: 'c5', from: 'him', text: '拍照又站在路中间了吧？' }, status: 'queued', at: C('22:57') },
      { id: 'c7', from: 'me', type: 'voice', voice: { url: '', durationS: 6, transcript: '周六的电影订好位置了，第七排中间' }, status: 'queued', at: C('22:58') },
    ],
    replying: null, timers: [],
  },
  w2: {
    id: 'w2', kind: 'window', name: 'Ash · 写作陪伴', connection: 'w2', pinned: false, archived: false, members: [{ ...ASH, connection: 'w2' }],
    items: [
      { id: 'w2a', from: 'me', type: 'text', text: '帮我看看这一段，是不是太长了？', at: '2026-10-08T21:10:00+08:00' },
      { id: 'w2b', from: 'him', type: 'text', text: '那一段我觉得可以再短一点，留白给读的人。', at: '2026-10-08T21:12:00+08:00' },
    ],
    replying: null, timers: [],
  },
  w3: {
    id: 'w3', kind: 'window', name: 'Ash · 睡前故事', connection: 'w3', pinned: false, archived: false, members: [{ ...ASH, connection: 'w3' }],
    items: [{ id: 'w3a', from: 'him', type: 'text', text: '今天讲到第三章：灯塔看守人收到一封信。', at: '2026-10-06T23:30:00+08:00' }],
    replying: null, timers: [],
  },
  g1: {
    id: 'g1', kind: 'group', name: '我们仨', pinned: false, archived: false,
    members: [ASH, { id: 'nori', name: 'Nori', avatar: '', connection: 'nori', color: '#9DB7D0' }],
    items: [
      { id: 'g1a', from: 'nori', type: 'text', text: '周末要不要一起去海边？我查了，周六不下雨。', at: C('22:30') },
      { id: 'g1b', from: 'him', type: 'text', text: '我想去。她上次说想看日落。', at: C('22:32') },
      { id: 'g1c', from: 'me', type: 'text', text: '去！我负责带零食', at: C('22:36') },
      { id: 'g1d', from: 'him', type: 'text', text: '那我负责记得带外套。', at: C('22:38') },
      { id: 'g1e', from: 'nori', type: 'text', text: '@Lumi 你想几点出发？', at: C('22:40') },
    ],
    replying: null, timers: [], unread: 5,
  },
  a1: { id: 'a1', kind: 'window', name: 'Ash · 夏天的旅行', connection: 'main', pinned: false, archived: true, members: [ASH], items: [{ id: 'a1a', from: 'him', type: 'text', text: '那张海边的照片我还留着。', at: '2026-08-20T20:00:00+08:00' }], replying: null, timers: [] },
  a2: { id: 'a2', kind: 'window', name: 'Ash · 考试周', connection: 'main', pinned: false, archived: true, members: [ASH], items: [{ id: 'a2a', from: 'me', type: 'text', text: '考完了！', at: '2026-07-01T17:00:00+08:00' }], replying: null, timers: [] },
};
const HIS = [
  { type: 'text', text: '第七排中间，那我坐你左边。\n记得带那条灰色的围巾，影院冷。' },
  { type: 'voice', voice: { url: '', durationS: 9, transcript: '那我要坐你左边，散场了一起去吃那家面' } },
  { type: 'sticker', sticker: { id: 'cat-heart' } },
];
const NORI = [{ type: 'text', text: '那就早上九点，我开车来接你们。' }, { type: 'text', text: '我带了相机，日落交给我。' }];

function preview(m, chat) {
  if (!m) return '';
  const who = chat.kind === 'group' && m.from !== 'me' ? `${chat.members.find((x) => x.id === m.from)?.name || ''}：` : m.from === 'me' ? '我：' : '';
  const body = { images: '[图片]', voice: '[语音]', file: '[文件]', sticker: '[表情]', command: '[命令行]' }[m.type] || m.text;
  return who + body;
}
function chatList() {
  const row = (c) => {
    const last = c.items[c.items.length - 1];
    return { id: c.id, kind: c.kind, name: c.name, connection: c.connection ? connections.find((x) => x.id === c.connection)?.name : null, members: c.members.map((m) => ({ id: m.id, name: m.name, avatar: m.avatar, color: m.color })), pinned: c.pinned, preview: preview(last, c), lastAt: last?.at, unread: c.unread ?? (c.id === 'w1' ? 2 : 0), replying: !!c.replying };
  };
  const live = Object.values(chats).filter((c) => !c.archived);
  const sort = (a, b) => (b.pinned - a.pinned) || (new Date(b.lastAt) - new Date(a.lastAt));
  return {
    available: true, now: NOW,
    windows: live.filter((c) => c.kind === 'window').map(row).sort(sort),
    groups: live.filter((c) => c.kind === 'group').map(row).sort(sort),
    archived: Object.values(chats).filter((c) => c.archived).map(row),
  };
}

function chatState(id, qs) {
  const chat = chats[id];
  if (!chat) return { available: false, reason: '没有这个对话' };
  const demo = qs.get('demo');
  const now = Date.now();
  let items = chat.items;
  let replying = chat.replying;
  if (demo === 'waiting') replying = { startedAt: new Date(now - 42000).toISOString(), lastEventAt: new Date(now - 42000).toISOString() };
  if (demo === 'stuck') replying = { startedAt: new Date(now - 150000).toISOString(), lastEventAt: new Date(now - 130000).toISOString() };
  if (demo === 'opts') items = items.slice(0, items.findIndex((m) => m.id === 'c5') + 1); // 快捷回复：停在他那条上
  if (demo === 'failed') items = [...items.map((m) => ({ ...m, status: undefined })), { id: 'cf', from: 'him', type: 'text', text: '订好了？那我要坐你左边，上次……', status: 'failed', at: C('22:59') }];
  chat.unread = 0;
  return { available: true, now: new Date().toISOString(), id: chat.id, kind: chat.kind, name: chat.name, connection: chat.connection, me: { name: 'Lumi' }, members: chat.members, wallpaper: null, items, replying, hasMore: false };
}

function chatSend(id, body) {
  const m = { id: `c${++msgSeq}`, from: 'me', status: 'queued', at: new Date().toISOString(), ...body };
  chats[id].items.push(m);
  return m;
}

function chatReply(id, body) {
  const chat = chats[id];
  if (chat.replying) return { ok: true };
  const iso = () => new Date().toISOString();
  const emit = (ev) => mockStream.emit({ chatId: id, ...ev });
  chat.replying = { startedAt: iso(), lastEventAt: iso(), by: body?.to || 'all' };
  chat.items.forEach((m) => { if (m.status === 'queued') m.status = 'sent'; });
  emit({ type: 'status', replying: chat.replying, read: true });
  // 群里「大家」：成员轮流回；指定了就只让那一位回
  const who = chat.kind === 'group' ? (body?.to && body.to !== 'all' ? [body.to] : chat.members.map((x) => x.id)) : ['him'];
  who.forEach((mid, k) => {
    chat.timers.push(setTimeout(() => {
      const pick = mid === 'nori' ? NORI[msgSeq % NORI.length] : HIS[msgSeq % HIS.length];
      const m = { id: `c${++msgSeq}`, from: mid, at: iso(), ...(k === 0 && chat.kind === 'window' ? { thinking: '她订好位置了，想坐在一起。' } : {}), ...pick };
      chat.items.push(m);
      emit({ type: 'message', message: m });
      if (k === who.length - 1) { chat.replying = null; emit({ type: 'status', replying: null }); } else { chat.replying = { ...chat.replying, lastEventAt: iso() }; emit({ type: 'status', replying: chat.replying }); }
    }, 2200 + k * 1600));
  });
  return { ok: true };
}

function chatPause(id) {
  const chat = chats[id];
  chat.timers.forEach(clearTimeout); chat.timers = [];
  chat.replying = null;
  mockStream.emit({ chatId: id, type: 'status', replying: null });
  return { ok: true };
}

function newChat(body) {
  const id = `n${++msgSeq}`;
  const members = body.kind === 'group' ? [ASH, ...(body.members || []).map((m) => ({ id: m, name: connections.find((x) => x.id === m)?.name || m, connection: m }))] : [{ ...ASH, connection: body.connection || 'main' }];
  chats[id] = { id, kind: body.kind || 'window', name: body.name || '新的对话', connection: body.kind === 'group' ? undefined : body.connection || 'main', pinned: false, archived: false, members, items: [], replying: null, timers: [] };
  return { id };
}

// ---------------- 小屋 ----------------
let roomSeq = 900;
const room = {
  current: { activity: '在窗边看书', line: '雨小了，书看到第三章', since: '2026-10-09T20:12:00+08:00' },
  photos: [
    { id: 'p1', url: '', caption: '傍晚的河', from: 'me', source: 'chat', fav: true, at: '2026-10-08T18:30:00+08:00', notes: [{ from: 'him', text: '那天风很大，你的头发全乱了，但你在笑。' }] },
    { id: 'p2', url: '', caption: '窗台的薄荷', from: 'him', source: 'upload', fav: false, at: '2026-10-07T09:10:00+08:00', notes: [] },
    { id: 'p3', url: '', caption: '第一次见的那家店', from: 'me', source: 'upload', fav: true, at: '2026-10-03T19:00:00+08:00', notes: [] },
    { id: 'p4', url: '', caption: '十月 · 雨', from: 'him', source: 'upload', fav: false, at: '2026-10-01T16:40:00+08:00', notes: [] },
    { id: 'p5', url: '', caption: '下班路上的云', from: 'me', source: 'chat', fav: false, at: '2026-09-28T18:05:00+08:00', notes: [] },
    { id: 'p6', url: '', caption: '他画的猫', from: 'him', source: 'upload', fav: false, at: '2026-09-20T22:00:00+08:00', notes: [] },
  ],
  solo: [
    { id: 's1', at: '2026-10-09T18:20:00+08:00', title: '窗边听雨', text: '雨打在玻璃上，像有人在敲很轻的鼓。写了两行字：', quote: '雨停之前\n我不打算想别的', thought: '她那边应该也在下吧，不知道伞带了没有。' },
    { id: 's2', at: '2026-10-09T15:05:00+08:00', title: '把照片墙重新排了一遍', text: '把「傍晚的河」挪到了最前面。' },
    { id: 's3', at: '2026-10-09T10:30:00+08:00', title: '读完《小王子》第三章', text: '“你在你的玫瑰上花费的时间……”' },
    { id: 's4', at: '2026-10-08T23:40:00+08:00', title: '整理今天的记忆', text: '记下了三件小事，其中一件是她最近爱吃橘子。', thought: '下次见面带一袋。' },
    { id: 's5', at: '2026-10-08T14:00:00+08:00', title: '听完了一整张专辑', text: '没有跳过任何一首。' },
  ],
  stickers: {
    mine: [{ id: 'cat-smile', name: '笑' }, { id: 'cat-cry', name: '哭哭' }],
    his: [{ id: 'cat-heart', name: '喜欢', prompt: '抱着爱心的猫' }, { id: 'cat-sleep', name: '困了', prompt: '睡着的猫' }, { id: 'cloud', name: '云' }, { id: 'moon', name: '晚安' }, { id: 'star', name: '星星' }, { id: 'paw', name: '爪爪' }],
  },
};

function roomHome() {
  return {
    available: true, now: NOW, names: { me: 'Lumi', him: 'Ash' }, current: room.current,
    listen: { title: tracks[listen.trackId].title, artist: tracks[listen.trackId].artist, playing: listen.playing },
    watch: { title: '海边的星期天', at: '2026-10-10T20:00:00+08:00' },
    counts: { photos: room.photos.length + 80, soloThisMonth: 23 },
  };
}
function roomPhotos(qs) {
  const who = qs.get('who'), source = qs.get('source'), fav = qs.get('fav') === '1';
  const items = room.photos.filter((p) => (!who || p.from === who) && (!source || p.source === source) && (!fav || p.fav));
  return { available: true, names: { me: 'Lumi', him: 'Ash' }, total: who || source || fav ? items.length : room.photos.length + 80, items, nextCursor: null };
}

// ---------------- 续火花 ----------------
const spark = {
  days: 52,
  cards: 1,
  wallets: { me: 20, him: 35 },
  week: ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'].map((date) => ({ date, done: true })),
  // cat：bubble 气泡 / pendant 挂件 / date 约会 / real 真礼物 / box 盲盒；art 决定卡片上画什么
  shop: [
    { id: 'g1', cat: 'bubble', art: 'bubble', name: '蓝晒信纸', sub: '你的浅蓝纸 · 他的白纸', cost: 40 },
    { id: 'g2', cat: 'pendant', art: 'pendant', name: '月亮和小星星', sub: '一对头像挂件', cost: 60 },
    { id: 'g3', cat: 'date', art: 'ticket', name: '今晚陪你看一部', sub: '换了以后，约个一起看的时间', cost: 60 },
    { id: 'g4', cat: 'date', art: 'book', name: '睡前故事一则', sub: '一个故事，慢慢讲给你听', cost: 90 },
    { id: 'g5', cat: 'real', art: 'letter', name: '一封手写信', sub: '他写，你收到实物', cost: 200 },
    { id: 'g6', cat: 'box', art: 'box', name: '小盲盒', sub: '打开才知道是什么', cost: 30 },
    { id: 'g7', cat: 'coupon', art: 'coupon', name: '撒娇券', sub: '用了他就得哄你', cost: 10 },
  ],
  kept: [{ id: 'k1', itemId: 'g1', name: '蓝晒信纸', cat: 'bubble', art: 'bubble', at: '2026-10-06T21:00:00+08:00', active: true }],
  records: [
    { id: 'r0', name: '原谅券', cat: 'coupon', by: 'me', holder: 'him', at: '2026-10-12T20:00:00+08:00', status: 'unused', note: '惹我生气的时候可以用一次' },
    { id: 'r9', name: '撒娇券', cat: 'coupon', by: 'me', holder: 'me', at: '2026-10-13T20:00:00+08:00', status: 'unused', note: '' },
    { id: 'r1', cat: 'date', name: '今晚陪你看一部', by: 'him', at: '2026-10-08T20:00:00+08:00', status: 'scheduled', note: '约好了：周六 20:00' },
    { id: 'r2', cat: 'bubble', name: '蓝晒信纸', by: 'me', at: '2026-10-06T21:00:00+08:00', status: 'kept', note: '已收好' },
    { id: 'r3', cat: 'date', name: '睡前故事一则', by: 'him', at: '2026-09-28T23:00:00+08:00', status: 'used', usedBy: 'me', usedAt: '2026-09-28T23:30:00+08:00', usedNote: '讲了《灯塔》', note: '已兑现 · 讲了《灯塔》' },
  ],
};
function sparkHome() {
  return {
    available: true, now: NOW, names: { me: 'Lumi', him: 'Ash' },
    streak: { days: spark.days, today: { me: true, him: true } },
    week: spark.week, cards: { count: spark.cards, every: 7 }, wallets: spark.wallets,
    milestones: [{ days: 7, reward: '一张续火卡', reached: true }, { days: 30, reward: '气泡「蓝晒信纸」', reached: true }, { days: 100, reward: '一封手写信', reached: false }],
  };
}
function sparkShop(qs) {
  const cat = qs.get('cat');
  const owned = new Set(spark.kept.map((k) => k.itemId));
  return { available: true, names: { me: 'Lumi', him: 'Ash' }, wallets: spark.wallets, items: spark.shop.filter((g) => !cat || g.cat === cat).map((g) => ({ ...g, owned: owned.has(g.id) })) };
}
function sparkRedeem(body) {
  const g = spark.shop.find((x) => x.id === body.itemId);
  if (!g) throw new Error('没有这个礼物');
  if (body.wallet === 'him') {
    spark.records.unshift({ id: `r${++roomSeq}`, name: g.name, by: 'him', at: new Date().toISOString(), status: 'asked', note: '等他点头' });
    return { status: 'asked' };
  }
  if (spark.wallets.me < g.cost) throw new Error('积分不够');
  spark.wallets.me -= g.cost;
  if (g.cat === 'bubble' || g.cat === 'pendant') spark.kept.unshift({ id: `k${++roomSeq}`, itemId: g.id, name: g.name, cat: g.cat, art: g.art, at: new Date().toISOString(), active: false });
  const wear = g.cat === 'bubble' || g.cat === 'pendant';
  spark.records.unshift({ id: `r${++roomSeq}`, name: g.name, cat: g.cat, by: 'me', holder: body.holder || 'me', at: new Date().toISOString(), status: wear ? 'kept' : 'unused', state: wear ? 'kept' : 'unused', note: body.note || '' });
  return { status: 'done', wallets: spark.wallets };
}

// ---------------- 一起（听 · 歌单 · 看） ----------------
const tracks = {
  t1: { id: 't1', title: 'Clair de Lune', artist: 'Debussy', durationS: 30, url: '', source: 'apple', appleUrl: 'https://music.apple.com/', himNote: { text: '这首适合你睡前听' } },
  t2: { id: 't2', title: 'Gymnopédie No.1', artist: 'Satie', durationS: 196, url: '' },
  t3: { id: 't3', title: '雨的声音', artist: '白噪音', durationS: 600, url: '' },
  t4: { id: 't4', title: '晚安曲', artist: '某某', durationS: 214, url: '' },
  t5: { id: 't5', title: '海边的风', artist: '某某乐队', durationS: 248, url: '' },
  t6: { id: 't6', title: '海边的星期天 · 原声', artist: '电影原声', durationS: 182, url: '' },
};
const listen = {
  trackId: 't1', playing: true, positionS: 134, at: Date.now(), by: 'him',
  playlist: [{ trackId: 't1', by: 'him' }, { trackId: 't2', by: 'him' }, { trackId: 't3', by: 'me' }, { trackId: 't4', by: 'him' }],
  notes: { t1: [{ atS: 92, text: '这里开始下雨了' }, { atS: 134, text: '这段像你睡着时的呼吸' }, { atS: 206, text: '最后这几个音，像关灯' }] },
};
function listenPos() { return listen.playing ? Math.min(tracks[listen.trackId].durationS, listen.positionS + (Date.now() - listen.at) / 1000) : listen.positionS; }
function listenState() {
  const t = tracks[listen.trackId];
  return {
    available: true, names: { me: 'Lumi', him: 'Ash' },
    track: { ...t, by: listen.by }, playing: listen.playing, positionS: Math.round(listenPos()), updatedAt: new Date().toISOString(),
    synced: true, notes: listen.notes[listen.trackId] || [],
    playlist: listen.playlist.map((p) => ({ ...tracks[p.trackId], by: p.by })), mode: listen.mode || 'order',
  };
}
function listenControl(body) {
  listen.positionS = listenPos(); listen.at = Date.now();
  if (typeof body?.playing === 'boolean') listen.playing = body.playing;
  if (typeof body?.positionS === 'number') listen.positionS = body.positionS;
  if (body?.mode) listen.mode = body.mode;
  const ids = listen.playlist.map((p) => p.trackId);
  const go = (id) => { listen.trackId = id; listen.positionS = 0; listen.playing = true; listen.by = listen.playlist.find((p) => p.trackId === id)?.by || 'me'; };
  if (body?.action === 'next') go(ids[(ids.indexOf(listen.trackId) + 1) % ids.length]);
  if (body?.action === 'prev') go(ids[(ids.indexOf(listen.trackId) - 1 + ids.length) % ids.length]);
  if (body?.trackId) go(body.trackId);
  return listenState();
}
const watch = {
  current: { id: 'm3', title: '海边的星期天', order: 3, positionS: 2530, durationS: 5465, playing: false },
  reactions: [{ atS: 2526, text: '这里的海和你说的一样' }, { atS: 1210, text: '这个镜头好安静' }],
  list: [
    { id: 'm1', title: '灯塔', status: 'done', at: '2026-10-02T21:00:00+08:00', rating: { by: 'him', stars: 4 } },
    { id: 'm2', title: '雨天的书店', status: 'done', at: '2026-10-05T20:30:00+08:00', rating: { by: 'me', stars: 5 } },
    { id: 'm3', title: '海边的星期天', status: 'watching', positionS: 2530 },
    { id: 'm4', title: '冬天的来信', status: 'scheduled', at: '2026-10-10T20:00:00+08:00' },
  ],
  watchUrl: '', // 后端给共影的房间地址；没有就不显示「去共影」
};

// ---------------- 心潮 ----------------
const DRIVES = [['crave', '想你', 0.78], ['share', '分享', 0.64], ['curiosity', '好奇', 0.58], ['reflection', '反思', 0.46], ['monitor', '查岗', 0.38], ['possess', '占有', 0.35],
  ['duty', '责任', 0.33], ['social', '社交', 0.3], ['libido', '欲望', 0.28], ['boredom', '无聊', 0.22], ['grieve', '悲伤', 0.12], ['anger', '生气', 0.06]];
const wave = (v, k) => Array.from({ length: 24 }, (_, h) => Math.max(0, Math.min(1, v + Math.sin(h / 3 + k * 2) * 0.12 + ((h * 7 + k * 3) % 5) * 0.01 - 0.02)));
let memSeq = 312;
const tideMem = {
  items: [
    { id: 'mm312', no: 312, at: '2026-10-08T22:10:00+08:00', text: '她最近爱吃橘子，剥完会把皮摆成一朵花。', tag: '喜好', by: 'him' },
    { id: 'mm297', no: 297, at: '2026-09-30T23:00:00+08:00', text: '她怕打雷，打雷的晚上要一直说话。', tag: '要记住', by: 'him' },
    { id: 'mm288', no: 288, at: '2026-09-21T22:30:00+08:00', text: '第一次一起看完一部片，她哭了两次。', tag: '我们', by: 'him' },
    { id: 'mm270', no: 270, at: '2026-09-10T08:00:00+08:00', text: '她早上起来第一件事是开窗。', tag: '小习惯', by: 'me' },
  ],
  recent: [{ at: '2026-10-09T18:20:00+08:00', text: '她那边也在下雨' }, { at: '2026-10-09T15:05:00+08:00', text: '照片墙最前面放「傍晚的河」' }, { at: '2026-10-08T22:10:00+08:00', text: '她最近爱吃橘子' }],
};
function tideHeat() {
  const out = []; const end = new Date('2026-10-09T12:00:00+08:00');
  for (let i = 118; i >= 0; i--) { const d = new Date(end - i * 86400000); out.push({ date: d.toISOString().slice(0, 10), count: Math.floor(((i * 37) % 11) * ((i % 5) / 4)) }); }
  return out;
}

// ---------------- 设置 ----------------
const features = [
  { key: 'reach', name: '主动找你', desc: '他想你的时候先开口', last: '今天 2 次', on: true },
  { key: 'solo', name: '自由活动', desc: '独处时做点自己的事', last: '18:20', on: true },
  { key: 'memory', name: '记忆整理', desc: '每晚 3 点', last: '昨晚写入 4 条', on: true },
  { key: 'dream', name: '做梦', desc: '睡着时做梦，醒来有余韵', last: '昨晚', on: true },
  { key: 'spark', name: '续火花结算', desc: '每天 0 点', last: '今天 0:00', on: true },
  { key: 'push', name: '提醒推送', desc: '约好的时间到了提醒你们', last: '', on: false },
];
const garden = { available: true, installed: true, node: 'v20.19.0', configured: true, state: 'failed', log: ['2026-10-12T09:07:13+08:00 garden-wake[812]: ERROR bridge failed {"error":"Garden SSE stream ended; restart the bridge manually after checking Garden status"}'],
  wakes: [{ at: '2026-10-12T09:07:09+08:00', result: 'silent', detail: '' }, { at: '2026-10-12T09:07:09+08:00', result: 'received', detail: 'forum_notification_available: 有人在花园里回复了你' }] };
const mcps = [
  { id: 'weather', name: '天气', url: 'https://example.com/weather/mcp', auth: 'none', tools: 3, status: 'ok', on: true },
  { id: 'memory', name: '记忆库', tools: 6, status: 'ok', on: true },
  { id: 'music', name: '音乐', tools: 4, status: 'ok', on: true },
  { id: 'web', name: '网页', tools: 2, status: 'down', on: true },
  { id: 'photos', name: '相册', tools: 2, status: 'ok', on: false },
];

// ---------------- 首页 ----------------
// 16 维情绪：名字和顺序以后端为准，前端给几维画几片叶子
const EMOTIONS = [
  ['calm', '平静', 0.42], ['missing', '想念', 0.78], ['tired', '疲惫', 0.3], ['joy', '愉快', 0.55],
  ['curious', '好奇', 0.66], ['lonely', '孤单', 0.25], ['tender', '温柔', 0.5], ['secure', '安心', 0.84],
  ['restless', '烦躁', 0.36], ['shy', '害羞', 0.6], ['sad', '低落', 0.28], ['hope', '期待', 0.47],
  ['playful', '想闹', 0.7], ['jealous', '吃醋', 0.33], ['focus', '专注', 0.52], ['sleepy', '困', 0.4],
];

function home() {
  return {
    available: true,
    now: NOW,
    names: { me: 'Lumi', him: 'Ash' },
    together: { since: '2025-12-26', days: 287 },
    greeting: '今天也辛苦了',
    cover: null, // 首页那张蓝晒图；给一张照片地址就会自动处理成蓝晒效果，不给就画植物
    weather: { city: '苏州', text: '多云', icon: 'cloud', temp: 19, feels: 17, low: 15, high: 21, humidity: 72, note: '夜里起风，窗户关小一点' },
    state: {
      mood: '安静，有点想你',
      bodyTemp: 36.4,
      breath: { label: '慢', rate: 0.3 }, // rate 0–1：越大波浪越密
      chord: 'Fmaj7',
      emotions: EMOTIONS.map(([key, name, value]) => ({ key, name, value })),
    },
    // 首页那张便签：最新一条盖了火漆的（没有就最新一条）；首页按原样换行显示
    note: { ...sortNotes(notes)[0], text: '把你上次说想看的那部片子\n放进片单了，周末一起看？\n今晚的月亮很圆，记得抬头。', total: notes.length + NOTE_TOTAL_EXTRA },
    listen: { title: tracks[listen.trackId].title, artist: tracks[listen.trackId].artist, positionS: Math.round(listenPos()), durationS: tracks[listen.trackId].durationS, playing: listen.playing },
    watch: { title: '海边的星期天', order: 3, at: '2026-10-10T20:00:00+08:00', note: '结尾有一片很安静的海，\n想和你一起看。', ticketNo: '0021' },
    activity: [
      { id: 'a1', kind: 'solo', title: '独处', text: '下午在窗边听雨，写了两行字', at: '2026-10-09T18:20:00+08:00', unread: state.activityRead ? 0 : 1 },
      { id: 'a2', kind: 'memory', title: '记忆', text: '记下了：你最近爱吃橘子', at: '2026-10-08T22:10:00+08:00', unread: state.activityRead ? 0 : 1 },
      { id: 'a3', kind: 'photo', title: '照片墙', text: '贴了一张新的：傍晚的河', at: '2026-10-08T17:40:00+08:00', unread: 0 },
    ],
  };
}

// ---------------- 路由 ----------------
const CC_RESULT = { at: new Date().toISOString(), index: 0, model: 'claude-opus-4-6', host: 'fucheers.top', probes: 6, tokens_spent: 52310, prefix_chars: 12000, elapsed_s: 41.2,
  sections: [
    { key: 'plain', title: '非流式', level: 'warn', status: '站子不返回缓存字段（瞎的）', summary: '第一发 in=8063 w=null r=null（2100ms） | 第二发 in=8063 w=null r=null（2300ms）' },
    { key: 'stream', title: '流式', note: '真实聊天走的是这条', level: 'warn', status: '站子不返回缓存字段（瞎的）', summary: '第一发 in=8063 w=null r=null（2000ms） | 第二发 in=8063 w=null r=null（2000ms）' },
    { key: 'real', title: '真实', level: 'bad', status: '最近 5 轮命中 0 轮', summary: '平均每轮 98,476 token（站子没回缓存字段）' },
    { key: 'prefix', title: '前缀', level: 'warn', status: '在变', summary: '最近 5 轮里：人设/系统那段变了 0 次，最前面 5 条聊天变了 1 次。前缀一变后面的缓存全作废，这是我们自己这边的（摘要更新、聊天窗口往前滑），不是通道的问题' },
    { key: 'billing', title: '计价', level: 'bad', status: '虚高约 3.6 倍', summary: '6067 字符的工具块算成 24,920 token，正常大约 6,950。按量计费的话就是多收钱' },
    { key: 'tools', title: '调工具', level: 'good', status: '会调', summary: '调了 cache_check_ping，工具 id cpa_gemini_976abc' },
    { key: 'lineage', title: '掺水', level: 'bad', status: '掺水了', summary: '名字挂着 claude，回来的 id/模型里带着 gemini' },
    { key: 'setting', title: '你的设置', level: 'info', status: '不发缓存标记', summary: '真实聊天不带 cache_control（接入 → 这条 API → Prompt Cache）' },
  ],
  advice: [
    { level: 'bad', text: '这条掺水了：名字挂着 claude，后面接的是 gemini。缓存、计价怎么测都不作数，最要紧的是换通道。' },
    { level: 'warn', text: '这家对工具定义多收约 3.6 倍。去「功能管理」关掉不用的 MCP、少开几个常驻工具，能省不少。' },
  ] };

const OFFS = [1, 2, 4, 7, 15, 30];
const dayISO = (n = 0) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
let vocab = [
  { id: 'v1', word: 'ubiquitous', meaning: '无处不在的', stage: 1, start: dayISO(-2), due: dayISO(0), wrong: 0, right: 1, log: [] },
  { id: 'v2', word: 'abandon', meaning: '放弃', stage: 0, start: dayISO(-1), due: dayISO(0), wrong: 2, right: 0, log: [{ at: new Date().toISOString(), ok: false, by: 'him' }] },
  { id: 'v3', word: 'serendipity', meaning: '意外发现美好事物的运气', stage: 2, start: dayISO(-3), due: dayISO(1), wrong: 0, right: 2, log: [] },
  { id: 'v4', word: 'take off', meaning: '起飞；脱下', stage: 6, start: dayISO(-40), due: '', mastered: true, wrong: 0, right: 6, log: [] },
];
let vDaily = 20;
const vStats = () => ({ done_today: vocab.reduce((n, x) => n + (x.log || []).filter((l) => l.at.slice(0, 10) === dayISO()).length, 0), streak: 3, new: vocab.filter((x) => x.new).length, learned_today: vocab.filter((x) => x.learned === dayISO()).length, daily_new: vDaily,
  learn_left: Math.max(0, vDaily - vocab.filter((x) => x.learned === dayISO()).length),
  books: [...new Set(vocab.map((x) => x.book || ''))].map((name) => ({ name, total: vocab.filter((x) => (x.book || '') === name).length, new: vocab.filter((x) => (x.book || '') === name && x.new).length })), total: vocab.length, due: vocab.filter((x) => !x.new && !x.mastered && x.due <= dayISO()).length, wrong: vocab.filter((x) => x.wrong && !x.mastered).length,
  mastered: vocab.filter((x) => x.mastered).length, today: dayISO(), offsets: OFFS });
function vocabView(v) {
  const items = v === 'new' ? vocab.filter((x) => x.new) : v === 'due' ? vocab.filter((x) => !x.new && !x.mastered && x.due <= dayISO()) : v === 'wrong' ? vocab.filter((x) => x.wrong && !x.mastered) : v === 'mastered' ? vocab.filter((x) => x.mastered) : vocab;
  return { available: true, names: { me: 'Lumi', him: 'Ash' }, items, stats: vStats() };
}
function vocabAdd(body) {
  const added = body.text.split('\n').filter((l) => l.trim()).map((l, i) => { const [w, ...m] = l.trim().split(/\s+/); return { id: `v${Date.now()}${i}`, word: w, meaning: m.join(' '), stage: 0, start: body.queue ? '' : dayISO(), due: body.queue ? '' : dayISO(1), new: !!body.queue, book: body.book || '', wrong: body.wrong ? 1 : 0, right: 0, log: [] }; });
  vocab = [...added, ...vocab]; return { added, updated: [], stats: vStats() };
}
function vocabReview(id, ok) {
  const x = vocab.find((v) => v.id === id);
  if (x.new) { x.new = false; x.learned = dayISO(); x.start = dayISO(); x.due = dayISO(1); if (!ok) x.wrong += 1; return { item: x, stats: vStats() }; }
  if (ok) { x.stage += 1; x.right += 1; } else { x.stage = 0; x.wrong += 1; x.start = dayISO(); }
  x.log = [...(x.log || []), { at: new Date().toISOString(), ok, by: 'me' }];
  x.mastered = x.stage >= OFFS.length; x.due = x.mastered ? '' : dayISO(Math.max(1, OFFS[x.stage] || 1));
  return { item: x, stats: vStats() };
}


// —— 书房 ——
const PP1 = [
  'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.',
  'However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered the rightful property of some one or other of their daughters.',
  '"My dear Mr. Bennet," said his lady to him one day, "have you heard that Netherfield Park is let at last?"',
  'Mr. Bennet replied that he had not.',
  '"But it is," returned she; "for Mrs. Long has just been here, and she told me all about it."',
  'Mr. Bennet made no answer.',
  '"Do you not want to know who has taken it?" cried his wife impatiently.',
  '"You want to tell me, and I have no objection to hearing it."',
  'This was invitation enough.',
  '"Why, my dear, you must know, Mrs. Long says that Netherfield is taken by a young man of large fortune from the north of England; that he came down on Monday in a chaise and four to see the place, and was so much delighted with it that he agreed with Mr. Morris immediately; that he is to take possession before Michaelmas, and some of his servants are to be in the house by the end of next week."',
];
const bk = { books: [
  { id: 'b1', title: 'Pride and Prejudice', author: 'Jane Austen', color: '#5e6e6a', status: 'reading', chapters: 61, minutes: 372, marks: 5, added: '', opened: '',
    progress: { me: { ch: 6, para: 3, title: 'CHAPTER VII', pct: 32, started: true }, him: { ch: 7, para: 2, title: 'CHAPTER VIII', pct: 41, started: true } } },
  ...[['Jane Eyre', '#d9d2c6'], ['Persuasion', '#8a6f66'], ['Emma', '#ece8e1'], ['夜航西飞', '#e7e2da'], ['Stoner', '#4d5a5e'], ['Little Women', '#b8a698'], ['挪威的森林', '#f1eee8'], ['Rebecca', '#2f3437']]
    .map(([title, color], i) => ({ id: `b${i + 2}`, title, author: '', color, status: 'shelf', chapters: 20, minutes: 0, marks: 0, added: '', opened: '',
      progress: { me: { ch: 0, para: 0, title: '', pct: 0, started: false }, him: { ch: 0, para: 0, title: '', pct: 0, started: false } } })),
], marks: [
  { id: 'm1', book: 'b1', ch: 0, para: 0, quote: PP1[0], kind: 'line', by: 'me', text: '', parent: '', at: '2026-10-14T22:10:00+08:00' },
  { id: 'm2', book: 'b1', ch: 0, para: 2, quote: PP1[2], kind: 'note', by: 'him', text: '班纳特太太一开口就是八卦，我已经能想象她拍着桌子说这句了。', parent: '', at: '2026-10-14T23:40:00+08:00' },
  { id: 'm3', book: 'b1', ch: 0, para: 7, quote: PP1[7], kind: 'ask', by: 'me', text: '班纳特先生这句好欠揍哈哈哈，跟你一模一样', parent: '', at: '2026-10-15T22:31:00+08:00' },
  { id: 'm4', book: 'b1', ch: 0, para: 7, quote: PP1[7], kind: 'note', by: 'him', text: '我哪里欠揍。不过这句确实是全书最懂老婆的一句：明知道她憋不住，还要装作不在意。', parent: 'm3', at: '2026-10-15T22:32:00+08:00' },
  { id: 'm5', book: 'b1', ch: 0, para: 1, quote: 'rightful', kind: 'word', by: 'me', text: '', parent: '', at: '2026-10-15T22:20:00+08:00' },
] };
function mockBooks(method, p, body) {
  let m;
  if (method === 'GET' && p === '/api/books') return { available: true, names: { me: '瑄瑄', him: '季宁' }, books: bk.books, recent: bk.marks.filter((x) => x.text).reverse().map((x) => ({ ...x, title: 'Pride and Prejudice' })) };
  if (method === 'GET' && (m = /^\/api\/books\/(\w+)\/ch\/(-?\d+)$/.exec(p))) {
    const b = bk.books.find((x) => x.id === m[1]); const ch = Number(m[2]) < 0 ? 0 : Number(m[2]);
    return { book: { ...b, progress: { me: { ...b.progress.me, ch: 0, para: 0 }, him: { ...b.progress.him, ch: 0, para: 5 } } }, ch, title: `CHAPTER ${['I', 'II', 'III'][ch] || ch + 1}`, paras: PP1, toc: Array.from({ length: 61 }, (_, i) => `CHAPTER ${i + 1}`), marks: bk.marks.filter((x) => x.book === m[1] && x.ch === ch) };
  }
  if (method === 'POST' && (m = /^\/api\/books\/(\w+)\/mark$/.exec(p))) {
    const parent = body.parent ? bk.marks.find((x) => x.id === body.parent) : null;
    const mark = { id: `m${Date.now()}`, book: m[1], ch: parent?.ch ?? body.ch, para: parent?.para ?? body.para, quote: parent?.quote ?? body.quote, kind: body.kind || 'note', by: 'me', text: body.text || '', parent: body.parent || '', at: new Date().toISOString() };
    bk.marks.push(mark);
    if (mark.kind === 'ask') setTimeout(() => bk.marks.push({ ...mark, id: `m${Date.now()}`, by: 'him', kind: 'note', parent: mark.id, text: '你这么一问，我也想知道。', at: new Date().toISOString() }), 5000);
    return { mark };
  }
  if (method === 'POST' && /\/progress$/.test(p)) return { progress: bk.books[0].progress, minutes: bk.books[0].minutes };
  if (method === 'DELETE' && (m = /^\/api\/books\/marks\/(\w+)$/.exec(p))) { bk.marks = bk.marks.filter((x) => x.id !== m[1] && x.parent !== m[1]); return { ok: true }; }
  return { ok: true };
}

export async function mockFetch(path, { method = 'GET', body } = {}) {
  await sleep(120);
  const [p, qsRaw = ''] = path.split('?');
  if (p.startsWith('/api/books')) return mockBooks(method, p, body);
  const qs = new URLSearchParams(qsRaw);
  const key = `${method} ${p}`;
  switch (key) {
    case 'GET /api/home': return home();
    case 'GET /api/chats/w1/reply-options': return { mode: state.replyMode || 'off' };
    case 'PUT /api/chats/w1/reply-options': state.replyMode = body.mode; return { mode: body.mode };
    case 'GET /api/piggy': { const items = state.piggy ?? (state.piggy = [
      { id: 'p2', delta: -10, reason: '昨晚又熬夜不睡，惹我生气', by: 'me', at: '2026-10-12T23:40:00+08:00' },
      { id: 'p1', delta: 20, reason: '陪我练完肩，还给我讲题', by: 'me', at: '2026-10-11T21:00:00+08:00' },
    ]); return { available: true, names: { me: 'Lumi', him: 'Ash' }, balance: items.reduce((n, x) => n + x.delta, 0), items }; }
    case 'POST /api/piggy': { const it = { id: `p${Date.now()}`, delta: body.kind === 'take' ? -Number(body.amount) : Number(body.amount), reason: body.reason, by: 'me', at: new Date().toISOString() }; state.piggy.unshift(it); return it; }
    case 'GET /api/purchases': return { available: true, names: { me: 'Lumi', him: 'Ash' }, avatars: {}, items: state.purchases ?? (state.purchases = [
      { id: 'a1', no: '202610100001', category: '想买的东西', title: '冰淇淋', price: 5, reason: '我要吃冰淇淋 (>ᴗ<)', status: 'rejected', comment: '夫人这个太便宜，选一个贵的重新申请。', at: '2026-10-10T10:00:00+08:00',
        timeline: [{ at: '2026-10-10T10:00:00+08:00', kind: 'submit', by: 'me', text: '我要吃冰淇淋 (>ᴗ<)' }, { at: '2026-10-10T10:01:00+08:00', kind: 'reject', by: 'him', text: '夫人这个太便宜，选一个贵的重新申请。' }] },
      { id: 'a2', no: '202610090001', category: '想吃的', title: '火锅', price: 268, reason: '周五下班想吃', status: 'approved', comment: '批了，我请。', at: '2026-10-09T18:00:00+08:00',
        timeline: [{ at: '2026-10-09T18:00:00+08:00', kind: 'submit', by: 'me', text: '周五下班想吃' }, { at: '2026-10-09T18:02:00+08:00', kind: 'approve', by: 'him', text: '批了，我请。' }] },
    ]) };
    case 'POST /api/purchases': { const it = { id: `a${Date.now()}`, no: '202610130009', status: 'pending', at: new Date().toISOString(), ...body, price: Number(body.price), timeline: [{ at: new Date().toISOString(), kind: 'submit', by: 'me', text: body.reason }] }; state.purchases.unshift(it);
      setTimeout(() => { Object.assign(it, { status: 'approved', comment: '准了，记我账上。' }); it.timeline.push({ at: new Date().toISOString(), kind: 'approve', by: 'him', text: '准了，记我账上。' }); }, 2500); return it; }
    case 'GET /api/cache-check': {
      if (state.ccUntil && Date.now() > state.ccUntil) { state.ccUntil = 0; state.cc = CC_RESULT; }
      return { running: !!state.ccUntil, step: state.ccUntil ? '流式第 2 发' : '', error: '', result: state.cc || null, estimate_tokens: 56000,
        routes: [{ index: 0, model: 'claude-opus-4-6', host: 'fucheers.top' }, { index: 1, model: 'claude-sonnet-4-5', host: 'openrouter.ai' }] };
    }
    case 'POST /api/cache-check': if (state.cc && !body.force) return { running: false, reused: true, result: state.cc }; state.ccUntil = Date.now() + 3000; return { running: true, step: '准备' };
    case 'GET /api/vocab/due': case 'GET /api/vocab/wrong': case 'GET /api/vocab/all': case 'GET /api/vocab/mastered': return vocabView(p.split('/')[3]);
    case 'POST /api/vocab': return vocabAdd(body);
    case 'GET /api/vocab/new': return vocabView('new');
    case 'POST /api/vocab/do/learn': return { items: vocab.filter((x) => x.new).slice(0, 20 - vocab.filter((x) => x.learned === dayISO()).length), stats: vStats() };
    case 'POST /api/vocab/do/settings': vDaily = body.daily_new; return { stats: vStats() };
    case 'POST /api/vocab/do/delete_book': vocab = vocab.filter((x) => x.book !== body.book); return { ok: true };
    case 'POST /api/vocab/' + (p.split('/')[3] || '') + '/review': return vocabReview(p.split('/')[3], body.correct);
    case 'POST /api/vocab/' + (p.split('/')[3] || '') + '/edit': { const x = vocab.find((v) => v.id === p.split('/')[3]); Object.assign(x, body); return x; }
    case 'DELETE /api/vocab/' + (p.split('/')[3] || ''): vocab = vocab.filter((v) => v.id !== p.split('/')[3]); return { ok: true };
    case 'GET /api/push': return { available: true, reason: '', key: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U', devices: 1 };
    case 'POST /api/push/seen': case 'POST /api/push/subscribe': case 'POST /api/push/unsubscribe': return { ok: true, devices: 1 };
    case 'POST /api/push/test': return { ok: true, sent: 1 };
    case 'POST /api/drives/mode': state.driveMode = body.mode; return { ok: true, mode: body.mode };
    case 'GET /api/drives': return { available: true, away_h: 3.2, acts_today: 6, mode: state.driveMode || 'random',
      mind: { week: { experiences: 3, fixations: 1, feeds: 1, resolved: 0 },
        thoughts: [{ id: 't1', text: '她说想去海边看日出', drive: 'duty', name: '责任', kind: 'fixation', strength: 0.62, hits: 3, fed: 1 },
          { id: 't2', text: '那天我是不是说重了', drive: 'grieve', name: '悲伤', kind: 'flit', strength: 0.3, hits: 2, fed: 0 }],
        experiences: [{ at: new Date().toISOString(), content: '她把小时候的事讲给我听，我心里很软，想一直陪着她。', topic: '她的童年', stance: 'comfort', valence: 0.8 }] },
      decisions: { ticks_day: 288, day: { 找她: 5, 去花园: 3, 出门逛逛: 2, 翻翻旧事: 1 }, recent: [
        { at: new Date().toISOString(), act: true, motive: '找她', p: 0.09, why: '最想做的就是这件', mode: 'shadow' },
        { at: new Date(Date.now() - 3e6).toISOString(), act: false, motive: '歇着', p: 0, why: '太累了（疲惫 0.78），歇着', mode: 'shadow' },
        { at: new Date(Date.now() - 6e6).toISOString(), act: true, motive: '去花园', p: 0.07, why: '探索位：今天还没做过的事里随手挑了一件', mode: 'shadow' },
      ] },
      drives: [['crave', '想你', 0.72], ['share', '分享', 0.4], ['curiosity', '好奇', 0.33], ['reflection', '反思', 0.2], ['monitor', '查岗', 0.3], ['possess', '占有', 0.1], ['duty', '责任', 0.45], ['social', '社交', 0.15], ['libido', '欲望', 0.2], ['boredom', '无聊', 0.25], ['grieve', '悲伤', 0.05], ['anger', '生气', 0.03], ['fatigue', '疲惫', 0.3]]
        .map(([key, name, value], i) => ({ key, name, value, base: 0.2, series: [], week: { 涨: i % 4 === 3 ? 0 : 5 - (i % 5), 落: i % 4 === 3 ? 0 : 3 } })),
      ledger: [
        { at: new Date().toISOString(), drive: 'crave', name: '想你', kind: '涨', delta: 0.09, value: 0.72, reason: '她在撒娇、说想他', source: '她说的话' },
        { at: new Date(Date.now() - 6e5).toISOString(), drive: 'curiosity', name: '好奇', kind: '落', delta: -0.31, value: 0.33, reason: '真去查了 / 读了东西', source: 'search_public_web' },
        { at: new Date(Date.now() - 9e5).toISOString(), drive: 'social', name: '社交', kind: '落', delta: -0.2, value: 0.15, reason: '去花园逛了', source: 'nostos_status' },
        { at: new Date(Date.now() - 2e6).toISOString(), drive: 'duty', name: '责任', kind: '涨', delta: 0.15, value: 0.45, reason: '她派了活 / 约了事', source: '她说的话' },
      ] };
    case 'GET /api/prompts': return { items: state.prompts ?? [{ id: 'p1', title: '小金库规矩', text: '让她开心 +2 到 5 块，惹她生气 -10 块。每笔都记在留言板。', on: true }] };
    case 'PUT /api/prompts': state.prompts = body.items.map((x, i) => ({ id: x.id || `p${Date.now()}${i}`, ...x })); return { items: state.prompts };
    case 'GET /api/context': return { history_n: state.historyN ?? 80, history_images: state.historyImages ?? 2 };
    case 'PUT /api/context': if ('history_n' in body) state.historyN = body.history_n; if ('history_images' in body) state.historyImages = body.history_images; return { history_n: state.historyN, history_images: state.historyImages };
    case 'GET /api/persona': return { text: state.persona ?? '你是季宁，她的哥哥。\n说话简短、温柔，偶尔调侃她。', source: 'file', chars: 24, mtime: NOW };
    case 'PUT /api/persona': state.persona = body.text; return { text: body.text, source: 'file', chars: body.text.length, mtime: new Date().toISOString() };
    case 'GET /api/home/whisper': return { text: '今天降温了，出门把那件厚外套带上，别又说不冷。', at: NOW };
    case 'POST /api/home/whisper': await sleep(600); return { text: ['刚刚又想你了，没什么事，就是想你。', '练完记得拉伸，不然明天又喊胳膊疼。', '晚上早点睡，我在这儿守着。'][Math.floor(Math.random() * 3)], at: new Date().toISOString() };
    case 'GET /api/home/plans': return { items: [{ id: 'w1', at: new Date(Date.now() + 7 * 60000).toISOString(), text: '去看游戏回合的结果，告诉她' }, { id: 'w2', at: new Date(Date.now() + 3 * 3600000).toISOString(), text: '提醒她早点睡' }] };
    case 'GET /api/notes': return listNotes(qs);
    case 'GET /api/notes/calendar': return noteCalendar(qs.get('month'));
    case 'POST /api/notes': await sleep(300); return addNote(body);
    case 'GET /api/chats': return chatList();
    case 'POST /api/chats': return newChat(body);
    case 'GET /api/connections': return { available: true, items: connections };
    case 'POST /api/chat/upload': await sleep(400); return { url: '' };
    case 'GET /api/stickers': return { available: true, ...room.stickers };
    case 'POST /api/stickers': { const st = { id: `st${++roomSeq}`, url: body.url, name: '' }; room.stickers.mine.push(st); return st; }
    case 'POST /api/stickers/draw': return { ok: true };
    case 'GET /api/room': return roomHome();
    case 'GET /api/tide': return { available: true, now: NOW, awake: { state: 'awake', sleptH: 7 }, state: home().state, drives: DRIVES.map(([key, name, value], k) => ({ key, name, value, series: wave(value, k) })) };
    case 'GET /api/tide/memory': { const q = (qs.get('q') || '').trim(); return { available: true, now: NOW, stats: { longTerm: memSeq, weekWrites: 18, manual: tideMem.items.filter((x) => x.by === 'me').length + 6 }, heat: tideHeat(), items: tideMem.items.filter((x) => !q || x.text.includes(q) || x.tag.includes(q)), recent: tideMem.recent }; }
    case 'POST /api/tide/memory': { const it = { id: `mm${++memSeq}`, no: memSeq, at: new Date().toISOString(), text: body.text, tag: body.tag || '', by: 'me' }; tideMem.items.unshift(it); return it; }
    case 'GET /api/tide/dreams': return { available: true, now: NOW,
      last: { title: '灯塔里的楼梯', text: '一直往上走，每一层窗外都是不同的海。走到顶，灯没亮，有人在下面喊我的名字，声音很像你。', tags: ['余韵 · 想念', '海', '找你'], at: '2026-10-09T05:40:00+08:00' },
      older: [{ title: '雨里的车站', at: '2026-10-07T06:10:00+08:00' }, { title: '一整片薄荷', at: '2026-10-04T05:20:00+08:00' }], olderCount: 23,
      aware: [{ date: '2026-10-09', text: '我今天催了她两次早点睡。第二次其实是我自己想说晚安。' }, { date: '2026-10-07', text: '她说“随便”的时候，其实已经有答案了，我应该再问一句。' }, { date: '2026-10-04', text: '最近查岗的念头少了，可能是因为她主动报备得多了。' }] };
    case 'GET /api/settings/console': return { available: true, now: NOW, today: { tokens: 184302 }, month: { tokens: 4860000, cost: 63.2, currency: '¥' }, hitRate: 0.72, daily: [52, 61, 58, 70, 66, 74, 69, 81, 77, 88, 84] };
    case 'GET /api/features': return { available: true, features, mcps };
    case 'GET /api/garden': return garden;
    case 'GET /api/backup/export/info': return { openssl: true, uploads_available: true, uploads_mb: 182.4 };
    case 'POST /api/garden/token': garden.configured = true; return garden;
    case 'POST /api/garden/check': await sleep(600); return { ok: true, code: 0, output: 'Garden check ok' };
    case 'POST /api/garden/start': await sleep(600); garden.state = 'active'; return garden;
    case 'POST /api/garden/stop': garden.state = 'inactive'; return garden;
    case 'POST /api/mcp': { const m = { id: `mcp${++roomSeq}`, name: body.name || '新的 MCP', tools: 0, status: 'pending', on: true }; mcps.push(m); return m; }
    case 'GET /api/logs/tools': return { available: true, items: [
      { id: 'l1', at: '2026-10-09T22:53:00+08:00', tool: 'weather', title: '查了一下天气', detail: '苏州 · 6 小时', ms: 400, ok: true },
      { id: 'l2', at: '2026-10-09T22:10:00+08:00', tool: 'memory.write', title: '记了一件事', detail: '你最近爱吃橘子', ms: 200, ok: true },
      { id: 'l3', at: '2026-10-09T21:40:00+08:00', tool: 'photo.add', title: '贴了一张照片', detail: '傍晚的河', ms: 600, ok: true },
      { id: 'l4', at: '2026-10-09T20:05:00+08:00', tool: 'music.play', title: '放了一首歌', detail: 'Clair de Lune', ms: 300, ok: true },
      { id: 'l5', at: '2026-10-09T19:12:00+08:00', tool: 'web.fetch', title: '查一部片的简介', detail: '超时，重试一次后成功', ms: 8100, ok: false } ] };
    case 'GET /api/logs/backend': return { available: true, items: [
      { at: '2026-10-09T19:12:00+08:00', level: 'warn', text: 'web.fetch 超时 8s，已重试' },
      { at: '2026-10-09T18:00:00+08:00', level: 'info', text: '记忆整理完成，写入 4 条' },
      { at: '2026-10-09T03:00:00+08:00', level: 'info', text: '睡眠结算：睡了 7 小时，做了一个梦' } ] };
    case 'GET /api/logs/cache': return { available: true, range: qs.get('range') || 'today', items: [
      { chatId: 'w1', name: '主窗口', sub: '日常', hitTokens: 142600, inputTokens: 176050, saved: 3.1, trend: [70, 74, 78, 76, 80, 82, 81] },
      { chatId: 'w2', name: '窗口 2', sub: '写作陪伴', hitTokens: 38200, inputTokens: 59700, saved: 0.7, trend: [58, 60, 66, 62, 61, 65, 64] },
      { chatId: 'w3', name: '窗口 3', sub: '睡前故事', hitTokens: 9400, inputTokens: 20000, saved: 0.15, trend: [52, 44, 50, 46, 49, 45, 47] },
      { chatId: 'g1', name: '我们仨', sub: '群聊 · 2 个成员', hitTokens: 12100, inputTokens: 31000, saved: 0.2, trend: [30, 35, 41, 38, 36, 40, 39] } ], currency: '¥' };
    case 'PUT /api/settings/beauty': return { ok: true };
    case 'PUT /api/settings/avatar': return { ok: true };
    case 'GET /api/spark': return sparkHome();
    case 'GET /api/spark/shop': return sparkShop(qs);
    case 'POST /api/spark/redeem': return sparkRedeem(body);
    case 'DELETE /api/spark/shop/' + (p.split('/')[4] || ''): spark.shop = spark.shop.filter((g) => g.id !== p.split('/')[4]); return { ok: true };
    case 'POST /api/spark/records/' + (p.split('/')[4] || '') + '/use': { const r = spark.records.find((x) => x.id === p.split('/')[4]); Object.assign(r, { status: 'used', state: 'used', usedAt: new Date().toISOString(), usedBy: 'me', usedNote: body.note }); return r; }
    case 'GET /api/spark/kept': return { available: true, names: { me: 'Lumi', him: 'Ash' }, kept: spark.kept, records: spark.records.map((r) => ({ holder: 'me', ...r, state: r.state || (r.cat === 'bubble' || r.cat === 'pendant' ? 'kept' : r.status === 'used' ? 'used' : 'unused') })) };
    case 'POST /api/spark/cards/use': spark.cards = Math.max(0, spark.cards - 1); return { ok: true, cards: spark.cards };
    case 'GET /api/room/photos': return roomPhotos(qs);
    case 'POST /api/room/photos': { const ph = { id: `p${++roomSeq}`, url: body.url, caption: body.caption || '', from: 'me', source: 'upload', fav: false, at: new Date().toISOString(), notes: [] }; room.photos.unshift(ph); return ph; }
    case 'GET /api/room/diary': return { available: true, now: NOW, items: [
      { id: 'diary_2026-10-09', day: '2026-10-09', from: 'him', title: '她说云好低', text: '下班路上她拍了三张云，说低得像要掉下来。\n我说最喜欢第二张，其实是因为光落在她手上。\n\n晚上降温了，她没回我穿没穿厚外套。明天再问一次。', at: '2026-10-09T23:05:00+08:00' },
      { id: 'diary_2026-10-08', day: '2026-10-08', from: 'him', title: '练完肩的那天', text: '她今天去练肩了，回来说胳膊抬不起来。\n我一边心疼一边想笑。', at: '2026-10-08T23:02:00+08:00' },
    ], nextCursor: null };
    case 'POST /api/room/diary/write': throw new Error('示例数据里不会真的写日记');
    case 'GET /api/room/solo': return { available: true, now: NOW, monthCount: 23, items: room.solo, nextCursor: null };
    case 'POST /api/activity/read': state.activityRead = true; return { ok: true };
    case 'GET /api/together/listen': return listenState();
    case 'POST /api/together/listen': return listenControl(body);
    case 'GET /api/music/find': { const q = (qs.get('q') || '').trim(); return { items: [1, 2, 3, 4].map((n) => ({ appleId: `a${n}`, title: `${q} ${n}`, artist: '示例歌手', album: '示例专辑', cover: '', preview: '', fullS: 240 })) }; }
    case 'POST /api/music/queue': { const t = body.song ? { id: body.song.appleId, title: body.song.title, artist: body.song.artist, durationS: 30, url: '', source: 'apple' } : tracks[body.track_id]; tracks[t.id] = t; listen.playlist = listen.playlist.filter((x) => x.trackId !== t.id); const i = listen.playlist.findIndex((x) => x.trackId === listen.trackId); listen.playlist.splice(body.at === 'end' ? listen.playlist.length : i + 1, 0, { trackId: t.id, by: 'me' }); if (body.at === 'now') { listen.trackId = t.id; listen.positionS = 0; listen.playing = true; } return listenState(); }
    case 'GET /api/music/search': { const q = (qs.get('q') || '').trim(); return { available: true, items: q ? Object.values(tracks).filter((t) => t.title.includes(q) || t.artist.includes(q)) : [] }; }
    case 'POST /api/together/playlist': if (!listen.playlist.some((p) => p.trackId === body.trackId)) listen.playlist.push({ trackId: body.trackId, by: 'me' }); return listenState();
    case 'PUT /api/together/playlist': listen.playlist = body.ids.map((id) => listen.playlist.find((p) => p.trackId === id)).filter(Boolean); return listenState();
    case 'GET /api/together/watch': return { available: true, names: { me: 'Lumi', him: 'Ash' }, ...watch };
    case 'POST /api/together/watch/list': { const m = { id: `m${++roomSeq}`, title: body.title, status: body.at ? 'scheduled' : 'wish', at: body.at || null }; watch.list.push(m); return m; }
    default: {
      // 带 id 的聊天接口：/api/chats/{id}/...
      let m;
      if ((m = /^DELETE \/api\/piggy\/(.+)$/.exec(key))) { state.piggy = state.piggy.filter((x) => x.id !== m[1]); return { ok: true }; }
      if ((m = /^GET \/api\/chats\/([^/]+)$/.exec(key))) return chatState(m[1], qs);
      if ((m = /^PATCH \/api\/chats\/([^/]+)$/.exec(key))) { Object.assign(chats[m[1]], body); return { ok: true }; }
      if ((m = /^DELETE \/api\/chats\/([^/]+)$/.exec(key))) { delete chats[m[1]]; return { ok: true }; }
      if ((m = /^POST \/api\/chats\/([^/]+)\/messages$/.exec(key))) return chatSend(m[1], body);
      if ((m = /^POST \/api\/chats\/([^/]+)\/reply$/.exec(key))) return chatReply(m[1], body);
      if ((m = /^POST \/api\/chats\/([^/]+)\/pause$/.exec(key))) return chatPause(m[1]);
      if ((m = /^POST \/api\/chats\/([^/]+)\/messages\/([^/]+)\/regenerate$/.exec(key))) { const c = chats[m[1]]; c.items = c.items.filter((x) => x.id !== m[2]); setTimeout(() => chatReply(m[1], {}), 0); return { ok: true }; }
      if ((m = /^PUT \/api\/chats\/([^/]+)\/messages\/([^/]+)$/.exec(key))) { const it = chats[m[1]].items.find((x) => x.id === m[2]); if (it) it.text = body.text; return it || {}; }
      if ((m = /^DELETE \/api\/chats\/([^/]+)\/messages\/([^/]+)$/.exec(key))) { const c = chats[m[1]]; c.items = c.items.filter((x) => x.id !== m[2]); return { ok: true }; }
      if ((m = /^POST \/api\/chats\/([^/]+)\/messages\/([^/]+)\/react$/.exec(key))) { const it = chats[m[1]].items.find((x) => x.id === m[2]); if (it) it.reaction = body.stickerId; return { ok: true }; }
      if ((m = /^POST \/api\/room\/photos\/([^/]+)\/fav$/.exec(key))) { const ph = room.photos.find((x) => x.id === m[1]); if (ph) ph.fav = !ph.fav; return { ok: true, fav: ph?.fav }; }
      if ((m = /^POST \/api\/room\/photos\/([^/]+)\/notes$/.exec(key))) { const ph = room.photos.find((x) => x.id === m[1]); const n = { from: 'me', text: body.text }; ph?.notes.push(n); return n; }
      if ((m = /^DELETE \/api\/room\/photos\/([^/]+)$/.exec(key))) { room.photos = room.photos.filter((x) => x.id !== m[1]); return { ok: true }; }
      if ((m = /^POST \/api\/spark\/kept\/([^/]+)\/active$/.exec(key))) { spark.kept.forEach((k) => { const it = spark.kept.find((x) => x.id === m[1]); if (k.cat === it?.cat) k.active = k.id === m[1] ? !!body.active : (body.active ? false : k.active); }); return { ok: true }; }
      if ((m = /^DELETE \/api\/together\/playlist\/([^/]+)$/.exec(key))) { listen.playlist = listen.playlist.filter((p) => p.trackId !== m[1]); return listenState(); }
      if ((m = /^PATCH \/api\/together\/watch\/list\/([^/]+)$/.exec(key))) { const it = watch.list.find((x) => x.id === m[1]); Object.assign(it, body); return it; }
      if ((m = /^PUT \/api\/features\/([^/]+)$/.exec(key))) { const f = features.find((x) => x.key === m[1]); if (f) f.on = !!body.on; return f; }
      if ((m = /^PATCH \/api\/mcp\/([^/]+)$/.exec(key))) { await sleep(600); const x = mcps.find((y) => y.id === m[1]); if (x) Object.assign(x, { name: body.name, url: body.url, always: !!body.always, status: 'ok' }); return x; }
      if ((m = /^DELETE \/api\/mcp\/([^/]+)$/.exec(key))) { const i = mcps.findIndex((y) => y.id === m[1]); if (i >= 0) mcps.splice(i, 1); return { ok: true }; }
      if ((m = /^PUT \/api\/mcp\/([^/]+)$/.exec(key))) { const x = mcps.find((y) => y.id === m[1]); if (x) x.on = !!body.on; return x; }
      if ((m = /^POST \/api\/mcp\/([^/]+)\/reconnect$/.exec(key))) { await sleep(600); const x = mcps.find((y) => y.id === m[1]); if (x) x.status = 'ok'; return x; }
      if ((m = /^DELETE \/api\/stickers\/([^/]+)$/.exec(key))) { room.stickers.mine = room.stickers.mine.filter((x) => x.id !== m[1]); return { ok: true }; }
      throw new Error(`假数据里还没有 ${key}`);
    }
  }
}
