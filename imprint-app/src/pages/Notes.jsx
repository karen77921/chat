/**
 * 02 留言板：两个人都能留；按关键词搜、按时间范围筛、按日期找；写一条可以选纸、盖火漆置顶。
 * 网址：#/notes  ?q=关键词  ?search=1（直接进搜索）  ?date=1（打开日历）  ?day=2026-10-09（只看这天）  ?new=1（写一条）
 * 数据：GET /api/notes、GET /api/notes/calendar、POST /api/notes（字段见 src/lib/mock.js 和 docs/02-留言板.md）
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../design/icons.jsx';
import { Band } from '../design/paper.jsx';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/useLoad.js';
import { replaceQuery } from '../lib/router.js';
import { groupByMonth, shortDate, splitByQuery } from '../lib/notes.js';
import NoteCard from '../components/notes/NoteCard.jsx';
import CalendarSheet from '../components/notes/CalendarSheet.jsx';
import WriteSheet from '../components/notes/WriteSheet.jsx';
import '../components/notes/notes.css';

const WHO = [['all', '全部'], ['him', '他留的'], ['me', '我留的'], ['pinned', '盖了火漆']];
const RANGE = [['all', '全部时间'], ['month', '这个月'], ['year', '今年']];

export default function Notes({ query }) {
  const [q, setQ] = useState(query.q || '');
  const [searching, setSearching] = useState(!!query.q || query.search === '1');
  const [who, setWho] = useState('all');
  const [range, setRange] = useState('all');
  const [day, setDay] = useState(query.day || '');
  const [calOpen, setCalOpen] = useState(query.date === '1');
  const [writeOpen, setWriteOpen] = useState(query.new === '1');
  const [fresh, setFresh] = useState(null);
  const inputRef = useRef(null);

  // 停顿 300ms 再搜，别每个字都请求
  const [qDebounced, setQD] = useState(q);
  useEffect(() => { const t = setTimeout(() => setQD(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { if (searching) inputRef.current?.focus(); }, [searching]);
  useEffect(() => { setCalOpen(query.date === '1'); setWriteOpen(query.new === '1'); }, [query.date, query.new]);

  const path = useMemo(() => {
    const p = new URLSearchParams();
    if (searching && qDebounced) p.set('q', qDebounced);
    if (day) { p.set('range', 'day'); p.set('date', day); }
    else if (searching) p.set('range', range);
    if (!searching && who === 'him') p.set('who', 'him');
    if (!searching && who === 'me') p.set('who', 'me');
    if (!searching && who === 'pinned') p.set('pinned', '1');
    const s = p.toString();
    return `/api/notes${s ? `?${s}` : ''}`;
  }, [searching, qDebounced, range, who, day]);
  const { data, setData } = useLoad(path);
  const now = data?.now ? new Date(data.now) : new Date();
  const ok = data && data.available !== false;

  const openCal = () => { setCalOpen(true); replaceQuery({ date: '1' }); };
  const openWrite = () => { setWriteOpen(true); replaceQuery({ new: '1' }); };
  const closeSheets = () => { setCalOpen(false); setWriteOpen(false); replaceQuery({}); };
  const stopSearch = () => { setSearching(false); setQ(''); setRange('all'); };

  const submit = async (body) => {
    const note = await api('/api/notes', { method: 'POST', body });
    setData((d) => ({ ...d, total: (d?.total || 0) + 1, items: [note, ...(d?.items || [])] }));
    setFresh(note.id);
    closeSheets();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const back = () => (history.length > 1 ? history.back() : (location.hash = '#/'));
  const dayLabel = day ? `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日` : '';

  return (
    <main className="notes">
      <header className="nt-head">
        <button type="button" className="rbtn" aria-label="返回" onClick={back}><Icon name="back" size={18} stroke={1.5} /></button>
        <h1><span className="hand">notes</span><span>留言板</span></h1>
        {!searching ? <button type="button" className="rbtn" aria-label="写一条" disabled={data?.recording === false} onClick={openWrite}><Icon name="plus" size={18} stroke={1.5} /></button> : <span style={{ width: 42 }} />}
      </header>

      <div className="nt-tools">
        <label className={`pill nt-search ${searching ? 'on' : ''}`}>
          <Icon name="search" size={16} />
          <span className="sr">搜留言</span>
          <input ref={inputRef} type="search" value={q} placeholder={searching ? '输入关键词' : '搜留言：关键词…'}
            onFocus={() => setSearching(true)} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" />
          {searching && <button type="button" className="nt-x" aria-label="退出搜索" onClick={stopSearch}><Icon name="close" size={12} stroke={1.6} /></button>}
        </label>
        {!searching && <button type="button" className="rbtn" aria-label="按日期找" onClick={openCal}><Icon name="calendar" size={18} /></button>}
      </div>

      <div className="nt-chips" role="group" aria-label="筛选">
        {day ? (
          <button type="button" className="chip on" onClick={() => setDay('')} aria-label={`只看${dayLabel}，点一下取消`}>{dayLabel}<Icon name="close" size={11} stroke={1.6} /></button>
        ) : searching ? (
          <>
            {RANGE.map(([k, n]) => <button key={k} type="button" className={`chip ${range === k ? 'on' : ''}`} aria-pressed={range === k} onClick={() => setRange(k)}>{n}</button>)}
            <button type="button" className="chip" onClick={openCal}>选日期…</button>
          </>
        ) : (
          WHO.map(([k, n]) => <button key={k} type="button" className={`chip ${who === k ? 'on' : ''}`} aria-pressed={who === k} onClick={() => setWho(k)}>{n}</button>)
        )}
        {!searching && ok && <span className="nt-total">{data.total} 条</span>}
      </div>

      <Band tone="l1" seed={3} className="nt-band">
        {!data && <div className="card nt-empty">正在翻…</div>}
        {data?.available === false && <div className="card nt-empty">暂时连不上，过一会儿再来看看。</div>}
        {ok && searching && qDebounced && (
          <>
            <div className="nt-found">找到 <b>{data.items.length}</b> 条 · 按时间从新到旧</div>
            {data.items.map((n) => <SearchRow key={n.id} n={n} q={qDebounced} names={data.names} now={now} />)}
          </>
        )}
        {ok && searching && !qDebounced && <div className="nt-found">输入关键词，按回车或停一下就会开始找</div>}
        {ok && !searching && groupByMonth(data.items).map((g) => (
          <section key={g.key} className="nt-month">
            <h2 className="nt-mh"><span className="serif">{g.label}</span>{g.key === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}` && <span className="hand">this month</span>}</h2>
            {g.items.map((n, i) => <NoteCard key={n.id} note={n} names={data.names} now={now} index={i} fresh={n.id === fresh} />)}
          </section>
        ))}
        {ok && !searching && !data.items.length && <div className="card nt-empty">这里还没有你们的留言。{data.recording === false && <small style={{ display: 'block', marginTop: 12 }}>真实保存尚未接入，暂不开放写入；不会显示参考数据。</small>}</div>}
      </Band>

      {!searching && data?.recording !== false && <button type="button" className="btn-main nt-write" onClick={openWrite}><Icon name="pen" size={17} stroke={1.5} />写一条</button>}

      {calOpen && <CalendarSheet open onClose={closeSheets} today={now} names={data?.names}
        onPick={(k) => { setDay(k); setSearching(false); setQ(''); closeSheets(); }} />}
      <WriteSheet open={writeOpen} onClose={closeSheets} onSubmit={submit} myName={data?.names?.me} />
    </main>
  );
}

function SearchRow({ n, q, names, now }) {
  const d = shortDate(n.at, now);
  return (
    <article className="card nt-row">
      <div className="nr-d"><span className="serif">{d.md}</span><span>{d.sub}</span></div>
      <div className="nr-b">
        <p>{splitByQuery(n.text, q).map((p, i) => (p.hit ? <mark key={i}>{p.t}</mark> : p.t))}</p>
        <span className="hand">— {n.from === 'him' ? names?.him : names?.me}</span>
      </div>
    </article>
  );
}
