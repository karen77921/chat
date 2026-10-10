/**
 * 一起听的全局状态：正在放什么、在不在放、放到哪、歌单、他留的便签。
 * 一起页和悬浮小窗共用这一份；切页面也不会断。
 * 数据：GET /api/together/listen；控制都走 POST /api/together/listen（播放 / 暂停 / 上一首 / 下一首 / 跳到某秒 / 放某一首）。
 * 后端有歌曲地址（track.url）时用 <audio> 真的放；没有就只走进度（假数据模式）。
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

const Ctx = createContext(null);

export function ListenProvider({ children }) {
  const [s, setS] = useState(null);
  const [pos, setPos] = useState(0);
  const audio = useRef(null);

  const apply = useCallback((d) => { if (d) { setS(d); setPos(d.positionS || 0); } }, []);
  const load = useCallback(() => api('/api/together/listen').then(apply).catch(() => {}), [apply]);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  // 本地走进度
  useEffect(() => {
    if (!s?.playing) return undefined;
    const t = setInterval(() => setPos((p) => {
      const d = s.track?.durationS || 0;
      if (d && p + 1 >= d) { control({ action: 'next' }); return d; }
      return p + 1;
    }), 1000);
    return () => clearInterval(t);
  }, [s?.playing, s?.track?.id]);

  // 有地址就真的放
  useEffect(() => {
    const a = audio.current;
    if (!a || !s?.track?.url) return;
    if (a.src !== s.track.url) { a.src = s.track.url; a.currentTime = s.positionS || 0; }
    if (s.playing) a.play().catch(() => {}); else a.pause();
  }, [s?.track?.url, s?.playing]);

  const control = useCallback(async (body) => {
    if (typeof body.playing === 'boolean') setS((x) => (x ? { ...x, playing: body.playing } : x));
    if (typeof body.positionS === 'number') { setPos(body.positionS); if (audio.current) audio.current.currentTime = body.positionS; }
    try { apply(await api('/api/together/listen', { method: 'POST', body })); } catch { load(); }
  }, [apply, load]);

  const value = {
    state: s, pos,
    toggle: () => control({ playing: !s?.playing }),
    next: () => control({ action: 'next' }),
    prev: () => control({ action: 'prev' }),
    seek: (sec) => control({ positionS: sec }),
    playTrack: (id) => control({ trackId: id }),
    setPlaylist: (playlist) => setS((x) => (x ? { ...x, playlist } : x)),
    apply,
  };
  return (
    <Ctx.Provider value={value}>
      {children}
      <audio ref={audio} preload="none" />
    </Ctx.Provider>
  );
}

export const useListen = () => useContext(Ctx);

export const mmss = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, '0')}`;
