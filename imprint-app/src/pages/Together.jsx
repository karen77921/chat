/**
 * 05 一起：一起听 / 一起看 / 一起读（书房）三个分页。一起听能直接搜歌（30 秒试听），队列两个人一起攒。
 * 网址：#/together   ?tab=listen|watch   ?playlist=1 打开歌单
 * 一起听的状态在 src/lib/listen.jsx（和悬浮小窗共用）；一起看：GET /api/together/watch。
 * 一起看的同步播放用「共影」，前端只放共影房间的入口，见 docs/05-一起.md。
 */
import { useEffect, useRef, useState } from 'react';
import Icon from '../design/icons.jsx';
import { Band, Cyanotype, TornBox, Vinyl } from '../design/paper.jsx';
import Sheet from '../design/Sheet.jsx';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/useLoad.js';
import { replaceQuery } from '../lib/router.js';
import { useListen, mmss, fullLinks, lineAt } from '../lib/listen.jsx';
import { Avatar } from './Chat.jsx';
import '../components/chat/chat.css';
import '../components/chat/chatlist.css';
import '../components/together/together.css';
import { Shelf } from './Study.jsx';

const ME = { id: 'me', name: '我', color: '#AED0EE' };

export default function Together({ query }) {
  const tabOf = (x) => (x === 'watch' || x === 'read' ? x : 'listen');
  const [tab, setTab] = useState(tabOf(query.tab));
  const [listOpen, setListOpen] = useState(query.playlist === '1');
  useEffect(() => { if (query.tab) setTab(tabOf(query.tab)); }, [query.tab]);
  const pick = (k) => { setTab(k); replaceQuery({ tab: k }); };
  const back = () => (history.length > 1 ? history.back() : (location.hash = '#/'));
  return (
    <main className="together">
      <header className="tp-head">
        <button type="button" className="rbtn" aria-label="返回" onClick={back}><Icon name="back" size={18} stroke={1.5} /></button>
        <h1><span className="hand">together</span><span>一起</span></h1>
      </header>
      <div className="tp-seg" role="tablist" aria-label="一起听 / 一起看 / 一起读">
        <button type="button" role="tab" aria-selected={tab === 'listen'} className={tab === 'listen' ? 'on' : ''} onClick={() => pick('listen')}>一起听</button>
        <button type="button" role="tab" aria-selected={tab === 'watch'} className={tab === 'watch' ? 'on' : ''} onClick={() => pick('watch')}>一起看</button>
        <button type="button" role="tab" aria-selected={tab === 'read'} className={tab === 'read' ? 'on' : ''} onClick={() => pick('read')}>一起读</button>
      </div>
      {tab === 'listen' ? <Listen onList={() => { setListOpen(true); replaceQuery({ tab: 'listen', playlist: '1' }); }} /> : tab === 'watch' ? <Watch /> : <Shelf embedded />}
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
// 播放模式：顺序 → 随机 → 单曲循环
const MODES = { order: '顺序播放', shuffle: '随机播放', one: '单曲循环' };
const NEXT_MODE = { order: 'shuffle', shuffle: 'one', one: 'order' };
function ModeIcon({ mode }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (mode === 'shuffle') return <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path {...p} d="M3 7h3.5c2 0 3.2 1 4.3 2.7l2.4 4.6c1.1 1.7 2.3 2.7 4.3 2.7H21M3 17h3.5c1.4 0 2.4-.5 3.2-1.4M14.3 8.4C15.1 7.5 16.1 7 17.5 7H21M18.5 4.5 21 7l-2.5 2.5M18.5 14.5 21 17l-2.5 2.5" /></svg>;
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path {...p} d="M4 11V9a3 3 0 0 1 3-3h13M17 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H4M7 21l-3-3 3-3" />
      {mode === 'one' && <text x="12" y="14.5" textAnchor="middle" fontSize="7" fill="currentColor" stroke="none">1</text>}
    </svg>
  );
}

function Cover({ t, size, className = '' }) {
  const [bad, setBad] = useState(false);
  if (!t?.cover || bad) return <span className={`tp-cover none ${className}`} style={{ width: size, height: size }}><Vinyl size={Math.round(size * 0.7)} /></span>;
  return <img className={`tp-cover ${className}`} src={t.cover} alt="" width={size} height={size} loading="lazy" onError={() => setBad(true)} />;
}

// 滚动歌词：正在唱的那句亮着、停在中间；点一句跳过去。试听片段对不上时间轴，只给看词
function Lyrics({ L }) {
  const ly = L.lyrics;
  const box = useRef(null);
  const synced = Boolean(ly?.lines?.length) && !ly.preview;
  const cur = synced ? lineAt(ly.lines, L.pos) : -1;
  useEffect(() => {
    const el = box.current?.querySelector(`[data-i="${Math.max(0, cur)}"]`);
    if (el && box.current) box.current.scrollTop = el.offsetTop - box.current.clientHeight / 2 + el.clientHeight / 2;
  }, [cur]);
  if (!ly || ly.loading) return <div className="tp-lyrics"><div className="tp-ly-empty">在找歌词…</div></div>;
  if (synced) {
    return (
      <div className="tp-lyrics" ref={box}>
        {ly.lines.map((l, i) => (
          <button key={`${l.t}-${i}`} type="button" data-i={i} className={`tp-ly ${i === cur ? 'on' : i < cur ? 'past' : ''}`} onClick={() => L.seek(l.t)}>{l.text}</button>
        ))}
      </div>
    );
  }
  const plain = (ly.plain || ly.lines?.map((l) => l.text).join('\n') || '').split('\n').filter((x) => x.trim());
  if (!plain.length) return <div className="tp-lyrics"><div className="tp-ly-empty">没找到这首的歌词</div></div>;
  return (
    <div className="tp-lyrics plain">
      {ly.preview && <p className="tp-ly-note">试听是从歌中间截的一段，对不上时间，先看词</p>}
      {plain.map((x, i) => <div key={i} className="tp-ly">{x}</div>)}
    </div>
  );
}

function Listen({ onList }) {
  const L = useListen();
  const s = L?.state;
  const bar = useRef(null);
  const [showLy, setShowLy] = useState(false);
  const [q, setQ] = useState('');
  const [qd, setQd] = useState('');
  const [found, setFound] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => { const t = setTimeout(() => setQd(q.trim()), 450); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    if (!qd) { setFound(null); return undefined; }
    let live = true;
    setFound({ loading: true, items: [] });
    api(`/api/music/find?q=${encodeURIComponent(qd)}`)
      .then((d) => { if (live) setFound({ items: d.items || [] }); })
      .catch((e) => { if (live) setFound({ items: [], error: e?.message || '没搜到' }); });
    return () => { live = false; };
  }, [qd]);
  useEffect(() => { if (!msg) return undefined; const t = setTimeout(() => setMsg(''), 2200); return () => clearTimeout(t); }, [msg]);

  if (!s) return <div className="card cl-empty tp-pad">正在找歌…</div>;
  if (s.available === false) return <div className="card cl-empty tp-pad">一起听暂时连不上后端。</div>;

  const put = async (song, at) => {
    setBusy(`${song.appleId}:${at}`);
    try {
      await L.queue({ song, at });
      setMsg(at === 'now' ? '在放了' : at === 'next' ? '排在下一首' : '加到队列了');
      if (at === 'now') setQ('');
    } catch (e) { setMsg(e?.message || '没加上'); } finally { setBusy(''); }
  };

  const search = (
    <label className="pill tp-search"><Icon name="search" size={16} /><span className="sr">搜歌</span>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜歌名、歌手" enterKeyHint="search" />
      {q && <button type="button" className="tp-search-x" aria-label="清空" onClick={() => setQ('')}><Icon name="close" size={13} stroke={1.5} /></button>}
    </label>
  );
  const toast = msg && <div className="tp-toast glass" role="status">{msg}</div>;

  if (qd) {
    return (
      <>
        {search}
        <div className="tp-results">
          {found?.loading && <div className="card cl-empty">在搜…</div>}
          {found?.error && <div className="card cl-empty">{found.error}</div>}
          {found && !found.loading && !found.error && !found.items.length && <div className="card cl-empty">没搜到，换个写法试试</div>}
          {(found?.items || []).map((t) => (
            <div key={t.appleId} className="tp-res">
              <button type="button" className="tp-res-main" onClick={() => put(t, 'now')} aria-label={`现在放 ${t.title}`}>
                <Cover t={t} size={48} /><span className="pl-t"><b>{t.title}</b><em>{t.artist}{t.album ? ` · ${t.album}` : ''}</em></span>
              </button>
              <button type="button" className="tp-res-b" disabled={!!busy} onClick={() => put(t, 'next')} aria-label={`下一首放 ${t.title}`}><Icon name="next" size={16} stroke={1.4} /></button>
              <button type="button" className="tp-res-b" disabled={!!busy} onClick={() => put(t, 'end')} aria-label={`把 ${t.title} 加到队列`}><Icon name="plus" size={16} stroke={1.6} /></button>
            </div>
          ))}
          {!!found?.items?.length && <p className="tp-fine">搜到的歌能试听 30 秒；想听整首，放的时候点下面「听整首」去别的 App，或者在队列里上传自己的音频。</p>}
        </div>
        {toast}
      </>
    );
  }

  if (!s.track) {
    return (
      <>
        {search}
        <div className="card cl-empty tp-pad">搜一首歌开始，或者上传自己的音频。<br /><button type="button" className="btn-main" style={{ marginTop: 16 }} onClick={onList}>打开队列</button></div>
        {toast}
      </>
    );
  }

  const t = s.track;
  const him = { id: 'him', name: s.names?.him };
  const dur = t.durationS || 1;
  const mode = s.mode || 'order';
  const seek = (e) => {
    const r = bar.current.getBoundingClientRect();
    L.seek(Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur));
  };
  return (
    <>
      {search}
      {showLy ? <Lyrics L={L} /> : (
        <button type="button" className={`tp-art ${s.playing ? 'on' : ''}`} onClick={() => setShowLy(true)} aria-label="看歌词"><Cover t={t} size={264} /></button>
      )}
      <div className="tp-now">
        <div className="tp-now-t">
          <b className="serif">{t.title}</b>
          <span>{t.artist}{t.by === 'him' ? ` · ${s.names?.him || '他'}点的` : ''}{t.source === 'apple' ? ' · 试听' : ''}</span>
        </div>
        <button type="button" className={`tp-ly-btn ${showLy ? 'on' : ''}`} aria-label={showLy ? '收起歌词' : '看歌词'} aria-pressed={showLy} onClick={() => setShowLy((x) => !x)}><Icon name="quote" size={17} stroke={1.5} /></button>
      </div>
      {t.himNote?.text && <div className="tp-himnote hand-cn">{s.names?.him || '他'}：{t.himNote.text}</div>}
      <div className="tp-bar" ref={bar} role="slider" tabIndex={0} aria-label="进度" aria-valuemin={0} aria-valuemax={dur} aria-valuenow={Math.round(L.pos)} onClick={seek}
        onKeyDown={(e) => { if (e.key === 'ArrowRight') L.seek(Math.min(dur, L.pos + 10)); if (e.key === 'ArrowLeft') L.seek(Math.max(0, L.pos - 10)); }}>
        <i className="fill" style={{ width: `${Math.min(100, (L.pos / dur) * 100)}%` }} />
        <i className="knob" style={{ left: `${Math.min(100, (L.pos / dur) * 100)}%` }} />
        {(s.notes || []).map((n) => <i key={n.atS} className="tick" style={{ left: `${(n.atS / dur) * 100}%` }} title={n.text} />)}
      </div>
      <div className="tp-time serif"><span>{mmss(L.pos)}</span><span>{mmss(dur)}</span></div>
      <div className="tp-ctl">
        <button type="button" className={`tp-side ${mode !== 'order' ? 'lit' : ''}`} aria-label={`${MODES[mode]}，点一下换`} onClick={() => { L.setMode(NEXT_MODE[mode]); setMsg(MODES[NEXT_MODE[mode]]); }}><ModeIcon mode={mode} /></button>
        <button type="button" aria-label="上一首" onClick={L.prev}><Icon name="prev" size={24} stroke={1} /></button>
        <button type="button" className="tp-play" aria-label={s.playing ? '暂停' : '播放'} onClick={L.toggle}><Icon name={s.playing ? 'pause' : 'play'} size={26} stroke={2.2} /></button>
        <button type="button" aria-label="下一首" onClick={L.next}><Icon name="next" size={24} stroke={1} /></button>
        <button type="button" className="tp-side" aria-label={`队列 · ${s.playlist.length} 首`} onClick={onList}><Icon name="more" size={20} stroke={1.5} /></button>
      </div>
      {L.error && <div className="tp-err" role="alert">{L.error}</div>}
      {t.source === 'apple' && (
        <div className="tp-full"><span>听整首</span>{fullLinks(t).map((x) => <a key={x.name} href={x.href} target="_blank" rel="noreferrer">{x.name}</a>)}</div>
      )}
      <Sync text={s.playing ? `${s.names?.him || '他'}知道你在听这首` : '放起来他就知道你在听什么'} him={him} />
      <Band tone="l1" seed={61} className="tp-band">
        <div className="sec-head"><span className="en" style={{ fontSize: 22 }}>his notes</span><h2 className="zh" style={{ margin: 0, fontSize: 13.5 }}>他边听边写</h2>
          <button type="button" className="go" onClick={onList}>队列 · {s.playlist.length} 首<Icon name="arrow" size={13} /></button></div>
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
      {toast}
    </>
  );
}

/* ---------- 队列 ---------- */
function Playlist({ onClose }) {
  const L = useListen();
  const s = L.state;
  const [dragIdx, setDragIdx] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const audioIn = useRef(null);
  const dragY = useRef(0);
  const list = s?.playlist || [];

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
  const pickAudio = async (file) => {
    if (!file) return;
    setError('');
    let durationS = 0;
    try {
      durationS = await new Promise((resolve) => {
        const audio = document.createElement('audio');
        const url = URL.createObjectURL(file);
        audio.preload = 'metadata';
        audio.onloadedmetadata = () => { const duration = Number.isFinite(audio.duration) ? audio.duration : 0; URL.revokeObjectURL(url); resolve(duration); };
        audio.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
        audio.src = url;
      });
    } catch { /* duration is optional */ }
    setDraft({ file, title: file.name.replace(/\.[^.]+$/, ''), artist: '', durationS });
  };
  const uploadTrack = async () => {
    if (!draft?.file || !draft.title.trim()) return;
    setBusy(true); setError('');
    try {
      const form = new FormData(); form.append('file', draft.file); form.append('kind', 'audio');
      const uploaded = await api('/api/chat/upload', { method: 'POST', form, timeout: 120000 });
      L.apply(await api('/api/music/tracks', { method: 'POST', body: { title: draft.title.trim(), artist: draft.artist.trim(), durationS: draft.durationS, url: uploaded.url } }));
      setDraft(null);
    } catch (e) { setError(e?.message || '音频没有上传成功'); } finally { setBusy(false); }
  };
  const nowId = s?.track?.id;

  return (
    <Sheet open onClose={onClose} label="队列" seed={63}>
      <div className="sec-head"><span className="en">up next</span><h2 className="zh" style={{ margin: 0 }}>队列</h2><button type="button" className="go" onClick={onClose}>收起</button></div>
      <button type="button" className="btn-main" style={{ width: '100%', marginBottom: 12 }} onClick={() => audioIn.current?.click()}>＋ 上传整首（本地音频）</button>
      <input ref={audioIn} hidden type="file" accept="audio/*" onChange={(e) => { pickAudio(e.target.files?.[0]); e.target.value = ''; }} />
      {draft && <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <label className="pill nc-in"><span className="sr">歌名</span><input value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} placeholder="歌名" /></label>
        <label className="pill nc-in" style={{ marginTop: 8 }}><span className="sr">歌手</span><input value={draft.artist} onChange={(e) => setDraft((d) => ({ ...d, artist: e.target.value }))} placeholder="歌手（可以不填）" /></label>
        <button type="button" className="btn-main" style={{ width: '100%', marginTop: 10 }} disabled={busy || !draft.title.trim()} onClick={uploadTrack}>{busy ? '正在上传…' : '放进队列'}</button>
      </div>}
      {error && <div className="ws-err" role="alert">{error}</div>}
      <div className="nc-k">{list.length} 首 · {MODES[s?.mode || 'order']} · 拖右边换顺序</div>
      <ol className="pl-list" onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {list.map((t, i) => (
          <li key={t.id} className={`card pl-row ${dragIdx === i ? 'drag' : ''} ${nowId === t.id ? 'now' : ''}`}>
            <Cover t={t} size={40} />
            <button type="button" className="pl-t" onClick={() => L.playTrack(t.id)} aria-label={`放 ${t.title}`}>
              <b>{nowId === t.id && <span className="dots"><i /><i /><i /></span>}{t.title}</b>
              <em>{t.artist} · {t.by === 'him' ? '他点的' : '我点的'}{t.source === 'apple' ? ' · 试听' : ''}</em>
            </button>
            <button type="button" className="pl-x" aria-label={`从队列拿掉 ${t.title}`} onClick={() => remove(t)}><Icon name="close" size={13} stroke={1.5} /></button>
            <span className="pl-drag" aria-label="拖动换顺序" onPointerDown={(e) => onDown(i, e)}><i /><i /><i /></span>
          </li>
        ))}
      </ol>
      {!list.length && <div className="card cl-empty">队列是空的，回去搜一首吧。</div>}
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
