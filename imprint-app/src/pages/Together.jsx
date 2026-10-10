/**
 * 05 一起：一起听 / 一起看两个分页，加一份两个人一起攒的歌单。
 * 网址：#/together   ?tab=listen|watch   ?playlist=1 打开歌单
 * 一起听的状态在 src/lib/listen.jsx（和悬浮小窗共用）；一起看：GET /api/together/watch。
 * 一起看的同步播放用「共影」，前端只放共影房间的入口，见 docs/05-一起.md。
 */
import { useEffect, useRef, useState } from 'react';
import Icon from '../design/icons.jsx';
import { Band, Cyanotype, TornBox, Tape, Vinyl } from '../design/paper.jsx';
import Sheet from '../design/Sheet.jsx';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/useLoad.js';
import { replaceQuery } from '../lib/router.js';
import { useListen, mmss } from '../lib/listen.jsx';
import { Avatar } from './Chat.jsx';
import '../components/chat/chat.css';
import '../components/chat/chatlist.css';
import '../components/together/together.css';

const ME = { id: 'me', name: '我', color: '#AED0EE' };

export default function Together({ query }) {
  const [tab, setTab] = useState(query.tab === 'watch' ? 'watch' : 'listen');
  const [listOpen, setListOpen] = useState(query.playlist === '1');
  useEffect(() => { if (query.tab) setTab(query.tab === 'watch' ? 'watch' : 'listen'); }, [query.tab]);
  const pick = (k) => { setTab(k); replaceQuery({ tab: k }); };
  const back = () => (history.length > 1 ? history.back() : (location.hash = '#/'));
  return (
    <main className="together">
      <header className="tp-head">
        <button type="button" className="rbtn" aria-label="返回" onClick={back}><Icon name="back" size={18} stroke={1.5} /></button>
        <h1><span className="hand">together</span><span>一起</span></h1>
      </header>
      <div className="tp-seg" role="tablist" aria-label="一起听 / 一起看">
        <button type="button" role="tab" aria-selected={tab === 'listen'} className={tab === 'listen' ? 'on' : ''} onClick={() => pick('listen')}>一起听</button>
        <button type="button" role="tab" aria-selected={tab === 'watch'} className={tab === 'watch' ? 'on' : ''} onClick={() => pick('watch')}>一起看</button>
      </div>
      {tab === 'listen' ? <Listen onList={() => { setListOpen(true); replaceQuery({ tab: 'listen', playlist: '1' }); }} /> : <Watch />}
      {listOpen && <Playlist onClose={() => { setListOpen(false); replaceQuery({ tab }); }} />}
    </main>
  );
}

function Sync({ text, him }) {
  return (
    <div className="card tp-sync">
      <span className="tp-avs"><span><Avatar m={ME} size={24} /></span><span><Avatar m={him} size={24} /></span></span>
      <Icon name="sync" size={14} stroke={1.5} />{text}
    </div>
  );
}

/* ---------- 一起听 ---------- */
function Listen({ onList }) {
  const L = useListen();
  const s = L?.state;
  const bar = useRef(null);
  if (!s) return <div className="card cl-empty tp-pad">正在找歌…</div>;
  if (s.available === false) return <div className="card cl-empty tp-pad">一起听还没有连接音乐来源。等你选定音乐服务后才能搜索、播放和同步；这里不会放示例歌曲。</div>;
  const him = { id: 'him', name: s.names?.him };
  const dur = s.track.durationS || 1;
  const seek = (e) => {
    const r = bar.current.getBoundingClientRect();
    L.seek(Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur));
  };
  return (
    <>
      <div className="tp-deck">
        <Vinyl size={200} spinning={s.playing} className="tp-disc" />
        <div className="tp-sleeve drop2"><Cyanotype w={196} h={196} seed={21} /></div>
        <Tape w={66} h={20} seed={131} className="m-breeze-tape" style={{ left: 64, top: -10, rotate: '-8deg' }} />
      </div>
      <Sync text={s.synced ? '同步中 · 你们听到同一秒' : '只有你在听'} him={him} />
      <div className="tp-title"><div className="serif">{s.track.title}</div><span>{s.track.artist} · {s.track.by === 'him' ? '他选的' : '你选的'}</span></div>
      <div className="tp-bar" ref={bar} role="slider" tabIndex={0} aria-label="进度" aria-valuemin={0} aria-valuemax={dur} aria-valuenow={Math.round(L.pos)} onClick={seek}
        onKeyDown={(e) => { if (e.key === 'ArrowRight') L.seek(Math.min(dur, L.pos + 10)); if (e.key === 'ArrowLeft') L.seek(Math.max(0, L.pos - 10)); }}>
        <i className="fill" style={{ width: `${(L.pos / dur) * 100}%` }} />
        <i className="knob" style={{ left: `${(L.pos / dur) * 100}%` }} />
        {(s.notes || []).map((n) => <i key={n.atS} className="tick" style={{ left: `${(n.atS / dur) * 100}%` }} title={n.text} />)}
      </div>
      <div className="tp-time serif"><span>{mmss(L.pos)}</span><span>{mmss(dur)}</span></div>
      <div className="tp-ctl">
        <button type="button" aria-label="上一首" onClick={L.prev}><Icon name="prev" size={24} stroke={1} /></button>
        <button type="button" className="tp-play" aria-label={s.playing ? '暂停' : '播放'} onClick={L.toggle}><Icon name={s.playing ? 'pause' : 'play'} size={26} stroke={2.2} /></button>
        <button type="button" aria-label="下一首" onClick={L.next}><Icon name="next" size={24} stroke={1} /></button>
      </div>
      <Band tone="l1" seed={61} className="tp-band">
        <div className="sec-head"><span className="en" style={{ fontSize: 22 }}>his notes</span><h2 className="zh" style={{ margin: 0, fontSize: 13.5 }}>他边听边写</h2>
          <button type="button" className="go" onClick={onList}>歌单 · {s.playlist.length} 首<Icon name="arrow" size={13} /></button></div>
        <div className="tp-notes">
          {(s.notes || []).map((n, i) => (
            <button key={n.atS} type="button" className={`tp-note ${n.atS <= L.pos ? 'past' : ''}`} style={{ rotate: `${i % 2 ? 1.6 : -2}deg` }} onClick={() => L.seek(n.atS)} aria-label={`跳到 ${mmss(n.atS)}：${n.text}`}>
              <TornBox seed={70 + i} amp={2.5} innerStyle={{ padding: '8px 10px' }}>
                <span className="serif">{mmss(n.atS)}</span><span className="hand-cn">{n.text}</span>
              </TornBox>
            </button>
          ))}
          {!s.notes?.length && <div className="card cl-empty">这首他还没写什么</div>}
        </div>
      </Band>
    </>
  );
}

/* ---------- 歌单 ---------- */
function Playlist({ onClose }) {
  const L = useListen();
  const s = L.state;
  const [q, setQ] = useState('');
  const [qd, setQd] = useState('');
  useEffect(() => { const t = setTimeout(() => setQd(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const { data: found } = useLoad(qd ? `/api/music/search?q=${encodeURIComponent(qd)}` : null);
  const [dragIdx, setDragIdx] = useState(null);
  const dragY = useRef(0);
  const list = s?.playlist || [];

  const add = async (t) => L.apply(await api('/api/together/playlist', { method: 'POST', body: { trackId: t.id } }));
  const remove = async (t) => L.apply(await api(`/api/together/playlist/${t.id}`, { method: 'DELETE' }));
  const save = async (next) => { L.setPlaylist(next); L.apply(await api('/api/together/playlist', { method: 'PUT', body: { ids: next.map((t) => t.id) } })); };
  const onDown = (i, e) => { setDragIdx(i); dragY.current = e.clientY; e.currentTarget.setPointerCapture(e.pointerId); };
  const onMove = (e) => {
    if (dragIdx == null) return;
    const steps = Math.round((e.clientY - dragY.current) / 60);
    if (!steps) return;
    const to = Math.max(0, Math.min(list.length - 1, dragIdx + steps));
    if (to === dragIdx) return;
    const next = list.slice(); const [it] = next.splice(dragIdx, 1); next.splice(to, 0, it);
    L.setPlaylist(next); setDragIdx(to); dragY.current = e.clientY;
  };
  const onUp = () => { if (dragIdx != null) { setDragIdx(null); save(list); } };

  if (!s?.track) return <Sheet open onClose={onClose} label="歌单"><div className="card cl-empty">音乐来源尚未接入，没有你们的歌单。</div></Sheet>;

  return (
    <Sheet open onClose={onClose} label="歌单" seed={63}>
      <div className="sec-head"><span className="en">playlist</span><h2 className="zh" style={{ margin: 0 }}>歌单</h2><button type="button" className="go" onClick={onClose}>收起</button></div>
      <label className="pill pl-search"><Icon name="search" size={16} /><span className="sr">搜歌</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜歌名、歌手，加进歌单" />
      </label>
      {qd && (
        <>
          <div className="nc-k">搜到的</div>
          {(found?.items || []).map((t) => {
            const inList = list.some((x) => x.id === t.id);
            return (
              <div key={t.id} className="card pl-row">
                <Vinyl size={34} /><span className="pl-t"><b>{t.title}</b><em>{t.artist}</em></span>
                <button type="button" className="pl-add" disabled={inList} aria-label={inList ? '已经在歌单里' : `把 ${t.title} 加进歌单`} onClick={() => add(t)}><Icon name={inList ? 'check' : 'plus'} size={15} stroke={1.6} /></button>
              </div>
            );
          })}
          {found && !found.items?.length && <div className="card cl-empty">没搜到</div>}
        </>
      )}
      <div className="nc-k">我们的歌单 · {list.length} 首 · 拖动换顺序</div>
      <ol className="pl-list" onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {list.map((t, i) => (
          <li key={t.id} className={`card pl-row ${dragIdx === i ? 'drag' : ''} ${s.track.id === t.id ? 'now' : ''}`}>
            <span className="serif pl-n">{s.track.id === t.id ? <span className="dots"><i /><i /><i /></span> : i + 1}</span>
            <button type="button" className="pl-t" onClick={() => L.playTrack(t.id)} aria-label={`放 ${t.title}`}><b>{t.title}</b><em>{t.artist} · {t.by === 'him' ? '他加的' : '我加的'}</em></button>
            <button type="button" className="pl-x" aria-label={`从歌单拿掉 ${t.title}`} onClick={() => remove(t)}><Icon name="close" size={13} stroke={1.5} /></button>
            <span className="pl-drag" aria-label="拖动换顺序" onPointerDown={(e) => onDown(i, e)}><i /><i /><i /></span>
          </li>
        ))}
      </ol>
    </Sheet>
  );
}

/* ---------- 一起看 ---------- */
function Watch() {
  const { data, setData } = useLoad('/api/together/watch');
  const [adding, setAdding] = useState(null); // { title, at }
  if (!data) return <div className="card cl-empty tp-pad">正在翻片单…</div>;
  if (data.available === false) return <div className="card cl-empty tp-pad">暂时连不上，过一会儿再来看看。</div>;
  if (data.recording === false) return <div className="card cl-empty tp-pad">片单还没有你们自己的记录。真实保存接入前，不会展示参考影片。</div>;
  const cur = data.current;
  const him = { id: 'him', name: data.names?.him };
  const react = cur ? [...(data.reactions || [])].sort((a, b) => b.atS - a.atS).find((r) => r.atS <= cur.positionS) : null;
  const save = async () => {
    const m = await api('/api/together/watch/list', { method: 'POST', body: { title: adding.title.trim(), at: adding.at ? new Date(adding.at).toISOString() : null } });
    setData((d) => ({ ...d, list: [...d.list, m] })); setAdding(null);
  };
  const STATUS = { done: '看完了', watching: '正在看', scheduled: '约好了', wish: '想看' };
  return (
    <>
      {cur && (
        <>
          <div className="tp-screen">
            <Cyanotype w={342} h={192} seed={9} variant="sprig" />
            <div className="tp-scr-bar serif">
              <Icon name={cur.playing ? 'pause' : 'play'} size={14} stroke={2} />
              <span>{mmss(cur.positionS)}</span><span className="tp-scr-p"><i style={{ width: `${(cur.positionS / cur.durationS) * 100}%` }} /></span><span>{mmss(cur.durationS)}</span>
            </div>
            <span className="tp-scr-tag">共影 · 同步播放</span>
          </div>
          {react && (
            <div className="tp-react m-settle"><TornBox seed={88} amp={2.5} innerStyle={{ padding: '8px 10px' }}><span className="serif">{mmss(react.atS)}</span><span className="hand-cn">{react.text}</span></TornBox></div>
          )}
          <Sync text="一起看中 · 进度对齐" him={him} />
          <div className="tp-movie"><b>《{cur.title}》</b><span>片单第 {cur.order} 部</span>
            {data.watchUrl && <a className="btn-main tp-go" href={data.watchUrl} target="_blank" rel="noreferrer">去共影接着看</a>}
          </div>
        </>
      )}
      <Band tone="l1" seed={62} className="tp-band">
        <div className="sec-head"><span className="en" style={{ fontSize: 22 }}>our list</span><h2 className="zh" style={{ margin: 0, fontSize: 13.5 }}>片单</h2>
          <button type="button" className="go" onClick={() => setAdding({ title: '', at: '' })}>＋ 加一部</button></div>
        {data.list.map((m, i) => (
          <div key={m.id} className={`card wl-row ${m.status}`}>
            <span className="serif wl-n">{i + 1}</span>
            <span className="wl-t"><b>《{m.title}》</b><em>{STATUS[m.status]}{m.status === 'watching' && m.positionS ? ` · ${Math.round(m.positionS / 60)} 分钟` : ''}{m.at && m.status !== 'watching' ? ` · ${fmt(m.at)}` : ''}</em></span>
            <span className="wl-r">{m.rating ? `${m.rating.by === 'him' ? '他' : '你'}打了 ${'★'.repeat(m.rating.stars)}` : m.status === 'scheduled' ? <Icon name="calendar" size={16} /> : ''}</span>
          </div>
        ))}
      </Band>
      {adding && (
        <Sheet open onClose={() => setAdding(null)} label="加一部" seed={64}>
          <div className="sec-head"><span className="en">a film</span><h2 className="zh" style={{ margin: 0 }}>加一部</h2></div>
          <div className="nc-k">片名</div>
          <label className="pill nc-in"><span className="sr">片名</span><input autoFocus value={adding.title} onChange={(e) => setAdding((a) => ({ ...a, title: e.target.value }))} placeholder="想一起看的片子" /></label>
          <div className="nc-k">约个时间（可以不填）</div>
          <label className="pill nc-in"><span className="sr">时间</span><input type="datetime-local" value={adding.at} onChange={(e) => setAdding((a) => ({ ...a, at: e.target.value }))} /></label>
          <button type="button" className="btn-main nc-go" disabled={!adding.title.trim()} onClick={save}>放进片单</button>
        </Sheet>
      )}
    </>
  );
}
const fmt = (iso) => { const d = new Date(iso); return `周${'日一二三四五六'[d.getDay()]} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
