/**
 * 一起听的全局状态：正在放什么、在不在放、放到哪、队列、播放模式、他留的便签。
 * 一起页和悬浮小窗共用这一份；切页面也不会断。
 * 数据：GET /api/together/listen；控制都走 POST /api/together/listen（播放 / 暂停 / 上一首 / 下一首 / 跳到某秒 / 放某一首 / 模式）。
 * 搜到的歌：POST /api/music/queue（现在放 / 下一首 / 排队）。
 * 有地址（track.url）时用 <audio> 真的放，进度跟着音频走；放完按模式接下一首。锁屏和耳机按钮也能控制。
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

const Ctx = createContext(null);

export function ListenProvider({ children }) {
  const [s, setS] = useState(null);
  const [pos, setPos] = useState(0);
  const [error, setError] = useState('');
  const [lyrics, setLyrics] = useState(null); // { id, lines: [{ t, text }], plain, preview } | { id, loading } | { id, none }
  const audio = useRef(null);
  const sRef = useRef(null);
  sRef.current = s;

  const apply = useCallback((d) => { if (d) { setS(d); setPos(d.positionS || 0); } }, []);
  const load = useCallback(() => api('/api/together/listen').then((d) => {
    // 正在放的时候轮询回来的进度比本地旧，别让进度条往回跳
    const a = audio.current;
    if (d && a && !a.paused && d.track?.id === sRef.current?.track?.id) { setS({ ...d, positionS: a.currentTime }); return; }
    apply(d);
  }).catch(() => {}), [apply]);
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]);

  const control = useCallback(async (body) => {
    setError('');
    if (typeof body.playing === 'boolean') setS((x) => (x ? { ...x, playing: body.playing } : x));
    if (typeof body.mode === 'string') setS((x) => (x ? { ...x, mode: body.mode } : x));
    if (typeof body.positionS === 'number') { setPos(body.positionS); if (audio.current) audio.current.currentTime = body.positionS; }
    try { apply(await api('/api/together/listen', { method: 'POST', body })); } catch { load(); }
  }, [apply, load]);

  // 没有音频地址（老数据）就只走进度
  useEffect(() => {
    if (!s?.playing || s.track?.url) return undefined;
    const t = setInterval(() => setPos((p) => {
      const d = s.track?.durationS || 0;
      if (d && p + 1 >= d) { control({ action: 'next' }); return d; }
      return p + 1;
    }), 1000);
    return () => clearInterval(t);
  }, [s?.playing, s?.track?.id, s?.track?.url, control]);

  // 有地址就真的放；进度、放完、出错都听音频的
  useEffect(() => {
    const a = audio.current;
    if (!a || !s?.track?.url) return;
    if (a.src !== s.track.url) { a.src = s.track.url; try { a.currentTime = s.positionS || 0; } catch { /* 还没加载 */ } }
    if (s.playing) a.play().catch((e) => { if (e?.name === 'NotAllowedError') { setS((x) => (x ? { ...x, playing: false } : x)); setError('再点一下播放'); } });
    else a.pause();
  }, [s?.track?.url, s?.playing]);

  useEffect(() => {
    const a = audio.current;
    if (!a) return undefined;
    const onTime = () => setPos(a.currentTime || 0);
    const onEnded = () => {
      const cur = sRef.current;
      if (cur?.mode === 'one') { a.currentTime = 0; a.play().catch(() => {}); return; }
      control({ action: 'next', playing: true });
    };
    const onError = () => { if (sRef.current?.track?.url) setError('这首放不出来，换一首试试'); };
    // 锁屏 / 耳机暂停：同步给后端，他就知道你停了
    const onPause = () => { const cur = sRef.current; if (cur?.playing && !a.ended && a.src) control({ playing: false, positionS: a.currentTime }); };
    const onPlay = () => { const cur = sRef.current; if (cur && !cur.playing) control({ playing: true, positionS: a.currentTime }); };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('ended', onEnded);
    a.addEventListener('error', onError);
    a.addEventListener('pause', onPause);
    a.addEventListener('play', onPlay);
    return () => {
      a.removeEventListener('timeupdate', onTime); a.removeEventListener('ended', onEnded); a.removeEventListener('error', onError);
      a.removeEventListener('pause', onPause); a.removeEventListener('play', onPlay);
    };
  }, [control]);

  // 放着的时候每分钟报一次进度：他那边「唱到哪」就不会越算越偏
  useEffect(() => {
    if (!s?.playing || !s.track?.url) return undefined;
    const t = setInterval(() => { const a = audio.current; if (a && !a.paused) api('/api/together/listen', { method: 'POST', body: { playing: true, positionS: a.currentTime } }).catch(() => {}); }, 60000);
    return () => clearInterval(t);
  }, [s?.playing, s?.track?.id, s?.track?.url]);

  // 歌词：换歌就去拿（后端会存在这首歌上，他那边「唱到哪一句」也靠这个）
  useEffect(() => {
    const id = s?.track?.id;
    if (!id) { setLyrics(null); return undefined; }
    let live = true;
    setLyrics({ id, loading: true });
    api(`/api/together/lyrics/${id}`)
      .then((d) => { if (live) setLyrics({ id, lines: parseLrc(d.lrc), plain: d.plain || '', preview: Boolean(d.preview) }); })
      .catch(() => { if (live) setLyrics({ id, none: true }); });
    return () => { live = false; };
  }, [s?.track?.id]);

  // 锁屏界面：封面、歌名，上一首 / 下一首
  useEffect(() => {
    const ms = navigator.mediaSession;
    const t = s?.track;
    if (!ms || !t || typeof window.MediaMetadata !== 'function') return;
    try {
      ms.metadata = new window.MediaMetadata({ title: t.title, artist: t.artist, album: t.album || '一起听', artwork: t.cover ? [{ src: t.cover, sizes: '600x600' }] : [] });
      ms.setActionHandler('nexttrack', () => control({ action: 'next', playing: true }));
      ms.setActionHandler('previoustrack', () => control({ action: 'prev', playing: true }));
    } catch { /* 有的浏览器不支持某个按钮 */ }
  }, [s?.track?.id, control]);

  const toggle = () => {
    const a = audio.current;
    const playing = !s?.playing;
    // iOS 只认手指点下去那一刻的 play()：先在这里直接放，再告诉后端
    if (a && s?.track?.url) { if (playing) a.play().catch(() => {}); else a.pause(); }
    control({ playing, positionS: a && s?.track?.url ? a.currentTime : pos });
  };

  const value = {
    state: s, pos, error, lyrics: lyrics?.id === s?.track?.id ? lyrics : null,
    toggle,
    next: () => control({ action: 'next' }),
    prev: () => control({ action: 'prev' }),
    seek: (sec) => control({ positionS: sec }),
    playTrack: (id) => control({ trackId: id, positionS: 0, playing: true }),
    setMode: (mode) => control({ mode }),
    queue: async (body) => { setError(''); apply(await api('/api/music/queue', { method: 'POST', body })); },
    setPlaylist: (playlist) => setS((x) => (x ? { ...x, playlist } : x)),
    apply,
  };
  return (
    <Ctx.Provider value={value}>
      {children}
      <audio ref={audio} preload="metadata" playsInline />
    </Ctx.Provider>
  );
}

export const useListen = () => useContext(Ctx);

const STAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const CREDIT = /^(作词|作曲|编曲|制作人|词|曲|Lyricist|Composer)\s*[:：]/i;
export function parseLrc(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const words = line.replace(STAMP, '').trim();
    if (!words || CREDIT.test(words)) continue;
    for (const m of line.matchAll(STAMP)) out.push({ t: Number(m[1]) * 60 + Number(m[2]) + Number(`0.${m[3] || 0}`), text: words });
  }
  return out.sort((a, b) => a.t - b.t);
}
/** 正在唱的那一句的下标；还没开唱是 -1 */
export const lineAt = (lines, pos) => { let i = -1; for (let k = 0; k < (lines || []).length && lines[k].t <= pos + 0.3; k += 1) i = k; return i; };

export const mmss = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, '0')}`;

/** 去别的 App 听整首：Apple Music 有这首的直达链接；网易云、QQ 音乐用搜索页 */
export function fullLinks(t) {
  const q = encodeURIComponent(`${t.title} ${t.artist || ''}`.trim());
  return [
    t.appleUrl && { name: 'Apple Music', href: t.appleUrl },
    { name: '网易云', href: `https://music.163.com/#/search/m/?s=${q}&type=1` },
    { name: 'QQ 音乐', href: `https://y.qq.com/n/ryqq/search?w=${q}` },
  ].filter(Boolean);
}
