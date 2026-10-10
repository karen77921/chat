/**
 * 悬浮小窗：收起时是一枚胶囊（小唱片 + 歌名 + 暂停），可以拖到别处；点一下展开成小播放器。
 * 在「一起」页、聊天页不出现；没在放、或者点了 × 也不出现（重新开始放会再出来）。
 */
import { useEffect, useRef, useState } from 'react';
import Icon from '../../design/icons.jsx';
import { Vinyl } from '../../design/paper.jsx';
import { useListen, mmss } from '../../lib/listen.jsx';
import './together.css';

const HIDE_ON = ['/together', '/chat/t'];
const KEY = 'imprint.mini';

export default function MiniPlayer({ path, tabbar }) {
  const L = useListen();
  const [open, setOpen] = useState(false);
  const [closedFor, setClosedFor] = useState(null);
  const [pos, setPos] = useState(() => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } });
  const drag = useRef(null);
  const s = L?.state;

  useEffect(() => { setOpen(false); }, [path]);
  if (!s?.track || HIDE_ON.includes(path)) return null;
  if (closedFor && closedFor === s.track.id && !s.playing) return null;
  if (!s.playing && !open && closedFor === 'all') return null;

  const bottom = tabbar ? 96 : 24;
  const style = pos ? { left: pos.x, top: pos.y } : { right: 16, bottom: `calc(env(safe-area-inset-bottom, 0px) + ${bottom}px)` };
  const onDown = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false, x0: e.clientX, y0: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    const d = drag.current; if (!d) return;
    if (Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) > 6) d.moved = true;
    if (d.moved) setPos({ x: Math.max(8, Math.min(innerWidth - 220, e.clientX - d.dx)), y: Math.max(60, Math.min(innerHeight - 70, e.clientY - d.dy)) });
  };
  const onUp = () => {
    const d = drag.current; drag.current = null;
    if (d?.moved) { try { localStorage.setItem(KEY, JSON.stringify(pos)); } catch { /* 隐私模式 */ } return; }
    setOpen(true);
  };
  const close = () => { setOpen(false); if (s.playing) L.toggle(); setClosedFor(s.track.id); };
  const note = (s.notes || []).filter((n) => n.atS <= L.pos).pop();

  if (open) {
    return (
      <div className="mini-open glass m-settle" role="dialog" aria-label="一起听小播放器">
        <div className="mo-top">
          <Vinyl size={60} spinning={s.playing} />
          <div className="mo-t"><b className="serif">{s.track.title}</b><span>{s.track.artist} · {s.synced ? '同步中' : '只有你在听'}</span></div>
          <a href="#/together" className="mo-ic" aria-label="回到一起"><Icon name="expand" size={18} stroke={1.4} /></a>
          <button type="button" className="mo-ic" aria-label="关掉小窗" onClick={close}><Icon name="close" size={18} stroke={1.4} /></button>
        </div>
        <div className="mo-bar"><i style={{ width: `${(L.pos / (s.track.durationS || 1)) * 100}%` }} /></div>
        <div className="mo-time serif"><span>{mmss(L.pos)}</span><span>{mmss(s.track.durationS)}</span></div>
        <div className="mo-ctl">
          <button type="button" aria-label="上一首" onClick={L.prev}><Icon name="prev" size={20} stroke={1} /></button>
          <button type="button" className="mo-play" aria-label={s.playing ? '暂停' : '播放'} onClick={L.toggle}><Icon name={s.playing ? 'pause' : 'play'} size={20} stroke={2} /></button>
          <button type="button" aria-label="下一首" onClick={L.next}><Icon name="next" size={20} stroke={1} /></button>
        </div>
        {note && <div className="hand-cn mo-note">{mmss(note.atS)}　{note.text}</div>}
        <button type="button" className="mo-fold" onClick={() => setOpen(false)}>收起</button>
      </div>
    );
  }
  return (
    <div className="mini glass" style={style} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} role="button" tabIndex={0}
      aria-label={`一起听：${s.track.title}，点一下展开`} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(true); }}>
      <Vinyl size={40} spinning={s.playing} />
      <span className="mini-t"><b className="serif">{s.track.title}</b><span>一起听 · {mmss(L.pos)}</span></span>
      <button type="button" className="mini-play" aria-label={s.playing ? '暂停' : '播放'} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); L.toggle(); }}>
        <Icon name={s.playing ? 'pause' : 'play'} size={14} stroke={2} />
      </button>
    </div>
  );
}
