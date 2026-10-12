/**
 * 聊天的数据层：历史、实时推送、发送、让他回复、暂停、重新生成、编辑、删除、表情回应、上传。
 *
 * 每个对话一个 id（窗口或群聊），接口都在 /api/chats/{id} 下面。
 * 实时推送：真后端走 SSE（GET /api/chats/{id}/stream），每条事件是一段 JSON：
 *   { type: 'message', message }   新消息或更新（按 id 覆盖，他边写边推也用这个）
 *   { type: 'status', replying }    他在不在回：null 或 { startedAt, lastEventAt }；read: true 表示她的消息他看过了
 * 群聊里消息的 from 是成员 id，「他」在单聊里固定是 him。
 * 假数据模式下由 mock.js 的 mockStream 模拟。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, MOCK, streamUrl, adaptStreamEvent } from './api.js';
import { upsertMessage, settleSentMessage, mergeResync } from './chatItems.js';

/** 他那边的状态：回复中 → 超过 30 秒没新动静「仍在等待」→ 超过 2 分钟「卡住了」 */
export const WAIT_MS = 30000;
export const STUCK_MS = 120000;
export function replyState(replying, now) {
  if (!replying) return null;
  const quiet = now - new Date(replying.lastEventAt || replying.startedAt).getTime();
  if (quiet >= STUCK_MS) return { kind: 'stuck', quiet };
  if (quiet >= WAIT_MS) return { kind: 'waiting', since: now - new Date(replying.startedAt).getTime() };
  return { kind: 'replying' };
}

export function useChat(chatId, demo) {
  const base = `/api/chats/${encodeURIComponent(chatId)}`;
  const [data, setData] = useState(null);
  const [now, setNow] = useState(Date.now());
  const tick = useRef(null);
  const temporarySequence = useRef(0);

  const load = useCallback(() => api(`${base}${demo ? `?demo=${demo}` : ''}`)
    .then(setData)
    .catch((e) => setData({ available: false, reason: e.message })), [base, demo]);

  useEffect(() => { load(); }, [load]);

  // 每 5 秒刷新一次「现在」，让「仍在等待」「卡住了」能自己变
  useEffect(() => { tick.current = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(tick.current); }, []);

  /** 重新拉一次整段聊天，用来补上推送漏掉的消息；拉到他新的回复就不再显示「在回」 */
  const resync = () => api(base).then((fresh) => setData((prev) => mergeResync(prev, fresh))).catch(() => {});

  // 他可能顺手给她的消息贴了表情：他的新消息一到，就重新读一次表情回应
  const refreshReactions = () => api(`${base}/reactions`).then((r) => {
    const byId = new Map((r.items || []).map((x) => [String(x.messageId), x.stickerId]));
    setData((d) => (d?.items ? { ...d, items: d.items.map((m) => (byId.has(String(m.id)) && byId.get(String(m.id)) !== m.reaction ? { ...m, reaction: byId.get(String(m.id)) } : m)) } : d));
  }).catch(() => {});

  useEffect(() => {
    const on = (ev) => {
      if (ev.chatId && ev.chatId !== chatId) return;
      setNow(Date.now());
      setData((d) => {
        if (!d || d.available === false) return d;
        if (ev.type === 'message') {
          if (ev.message.from !== 'me' && !MOCK) refreshReactions();
          return { ...d, items: upsertMessage(d.items, ev.message) };
        }
        if (ev.type === 'status') {
          const items = ev.read ? d.items.map((m) => (m.status === 'queued' ? { ...m, status: 'sent' } : m)) : d.items;
          return { ...d, items, replying: ev.replying };
        }
        return d;
      });
    };
    if (MOCK) {
      let cancelled = false;
      let unsubscribe;
      import('./mock.js').then(({ mockStream }) => {
        if (!cancelled) unsubscribe = mockStream.subscribe(on);
      });
      return () => { cancelled = true; unsubscribe?.(); };
    }
    // 手机切到后台再回来，iOS 常常悄悄断掉推送：断了就重连，回到前台就重连并补拉一次
    let es = null;
    let retry = null;
    let closed = false;
    const connect = () => {
      clearTimeout(retry);
      es?.close();
      es = new EventSource(streamUrl());
      es.onmessage = (e) => {
        try {
          const adapted = adaptStreamEvent(JSON.parse(e.data), chatId);
          if (adapted) on(adapted);
        } catch { /* 忽略坏数据 */ }
      };
      es.onerror = () => {
        es?.close();
        if (!closed) retry = setTimeout(connect, 3000);
      };
    };
    const wake = () => {
      if (document.visibilityState !== 'visible') return;
      connect();
      resync();
    };
    connect();
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    window.addEventListener('pageshow', wake);
    return () => {
      closed = true;
      clearTimeout(retry);
      es?.close();
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
      window.removeEventListener('pageshow', wake);
    };
  }, [base, chatId]);

  // 他在回的时候，推送万一漏了，每 15 秒补拉一次，回复到了就停
  const waiting = Boolean(data?.replying);
  useEffect(() => {
    if (!waiting || MOCK) return undefined;
    const timer = setInterval(resync, 15000);
    return () => clearInterval(timer);
  }, [waiting, base]);

  const patch = (fn) => setData((d) => (d && d.available !== false ? fn(d) : d));

  /** 发一条（不会让他开始回）。body：{ type, text?, images?, voice?, file?, sticker?, quote? } */
  const send = async (body) => {
    const temp = { id: `tmp-${Date.now()}-${++temporarySequence.current}`, from: 'me', status: 'sending', at: new Date().toISOString(), ...body };
    patch((d) => ({ ...d, items: [...d.items, temp] }));
    try {
      const m = await api(`${base}/messages`, { method: 'POST', body });
      patch((d) => ({ ...d, items: settleSentMessage(d.items, temp.id, m) }));
      return m;
    } catch (e) {
      patch((d) => ({ ...d, items: d.items.map((x) => (x.id === temp.id ? { ...x, status: 'unsent' } : x)) }));
      throw e;
    }
  };
  const resend = async (m) => {
    patch((d) => ({ ...d, items: d.items.filter((x) => x.id !== m.id) }));
    const { id, status, at, from, ...body } = m;
    return send(body);
  };
  /** to：群聊里让谁回（成员 id），不给就是大家 */
  const reply = (to) => {
    const iso = new Date().toISOString();
    patch((d) => ({ ...d, replying: { startedAt: iso, lastEventAt: iso } }));
    return api(`${base}/reply`, { method: 'POST', body: to ? { to } : {} }).catch(() => patch((d) => ({ ...d, replying: null })));
  };
  const pause = () => { patch((d) => ({ ...d, replying: null })); return api(`${base}/pause`, { method: 'POST' }); };
  const regenerate = (id) => {
    const iso = new Date().toISOString();
    patch((d) => ({ ...d, items: d.items.filter((x) => x.id !== id), replying: { startedAt: iso, lastEventAt: iso } }));
    return api(`${base}/messages/${id}/regenerate`, { method: 'POST' });
  };
  const edit = (id, text) => {
    patch((d) => ({ ...d, items: d.items.map((x) => (x.id === id ? { ...x, text, edited: true } : x)) }));
    return api(`${base}/messages/${id}`, { method: 'PUT', body: { text } });
  };
  const remove = (id) => {
    patch((d) => ({ ...d, items: d.items.filter((x) => x.id !== id) }));
    return api(`${base}/messages/${id}`, { method: 'DELETE' });
  };
  const react = (id, stickerId) => {
    patch((d) => ({ ...d, items: d.items.map((x) => (x.id === id ? { ...x, reaction: stickerId } : x)) }));
    return api(`${base}/messages/${id}/react`, { method: 'POST', body: { stickerId } });
  };
  /** 上传图片 / 语音 / 文件，返回 { url } */
  const upload = (file, kind) => {
    const form = new FormData();
    form.append('file', file);
    form.append('kind', kind);
    return api('/api/chat/upload', { method: 'POST', form, timeout: 60000 });
  };

  return { data, now, reload: load, send, resend, reply, pause, regenerate, edit, remove, react, upload };
}

const pad = (n) => String(n).padStart(2, '0');
export const hm = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export function dayLabel(iso, now) {
  const d = new Date(iso), t = new Date(now);
  const key = (x) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  if (key(d) === key(t)) return '今天';
  const y = new Date(t); y.setDate(t.getDate() - 1);
  if (key(d) === key(y)) return '昨天';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
export function fileSize(b) {
  if (!b && b !== 0) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

/** 发消息的人叫什么：me / 成员 id */
export function nameOf(data, from) {
  if (from === 'me') return data?.me?.name || '我';
  return data?.members?.find((m) => m.id === from)?.name || '';
}
export function memberOf(data, from) {
  return data?.members?.find((m) => m.id === from);
}
