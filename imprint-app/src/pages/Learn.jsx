/**
 * Study：单词本 + 笔记 + 练习，一个书桌上的三本本子。
 *   单词：原来的单词本（艾宾浩斯复习、错词、待学）。
 *   笔记：她拍的笔记，或者在聊天里发给他、他整理好放进来的；也按第 1、2、4、7、15、30 天排复习。
 *   练习：他拿笔记考她、让她造句，每一道题（她怎么答、他怎么点评、对不对）都记在这里。
 * 网址：#/words?tab=words|notes|practice
 * 数据：GET /api/study/notes/:view、GET /api/study/note/:id、POST /api/study/notes、POST /api/study/note/:id/edit、
 *      DELETE /api/study/note/:id、GET /api/study/practice/:view、POST /api/study/practice/:id/fix、DELETE /api/study/practice/:id
 */
import { useMemo, useState } from 'react';
import Icon from '../design/icons.jsx';
import Sheet from '../design/Sheet.jsx';
import AuthImg from '../design/AuthImg.jsx';
import { api, uploadFile } from '../lib/api.js';
import { shrinkImage } from '../lib/image.js';
import { useLoad } from '../lib/useLoad.js';
import { replaceQuery } from '../lib/router.js';
import Vocab from './Vocab.jsx';
import '../components/vocab/vocab.css';
import '../components/vocab/study.css';

const TABS = [['words', '单词', 'WORDS'], ['notes', '笔记', 'NOTES'], ['practice', '练习', 'PRACTICE']];
const WEEK = '日一二三四五六';
const TAPE = ['-3deg', '2deg', '-1.5deg', '3deg'];

function tabFromUrl() {
  const t = new URLSearchParams(location.hash.split('?')[1] || '').get('tab');
  return TABS.some(([k]) => k === t) ? t : 'words';
}

function dueText(n, today) {
  if (n.mastered) return '记牢了';
  if (!n.due) return '';
  const days = Math.round((new Date(n.due) - new Date(today)) / 86400000);
  if (days <= 0) return '今天复习';
  return days === 1 ? '明天复习' : `${days} 天后复习`;
}

export default function Learn() {
  const [tab, setTabState] = useState(tabFromUrl);
  const notes = useLoad('/api/study/notes/all');
  const words = useLoad('/api/vocab/due');
  const setTab = (t) => { setTabState(t); replaceQuery(t === 'words' ? {} : { tab: t }); };
  const now = new Date();
  const ns = notes.data?.stats;
  const ws = words.data?.stats;
  const wordLeft = ws ? ws.due + Math.min(ws.learn_left, ws.new) : null;
  const count = { words: wordLeft, notes: ns?.due, practice: ns?.practice_today };
  const sub = { words: '个要背', notes: '篇要复习', practice: '道今天练过' };

  return (
    <main className="vb sd">
      <header className="vb-head sd-head">
        <a href="#/" className="vb-back" aria-label="返回"><Icon name="back" size={18} stroke={1.6} /></a>
        <span className="vb-date">{now.getMonth() + 1}.{now.getDate()} 周{WEEK[now.getDay()]}</span>
        <h1><mark>Study</mark><small>单词 · 笔记 · 练习</small></h1>
      </header>

      <nav className="sd-tabs" role="tablist">
        {TABS.map(([k, zh, en], i) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`sd-tab c${i} ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>
            <small>{en}</small>
            <b>{zh}</b>
            <em>{count[k] == null ? '·' : count[k] ? <><strong>{count[k]}</strong>{sub[k]}</> : k === 'practice' ? '今天还没练' : '都完成了 ✓'}</em>
          </button>
        ))}
      </nav>

      {tab === 'words' && <Vocab embedded />}
      {tab === 'notes' && <Notes load={notes} onChanged={() => notes.reload()} />}
      {tab === 'practice' && <Practice />}
    </main>
  );
}

/* ---------------- 笔记 ---------------- */
function Notes({ load, onChanged }) {
  const { data } = load;
  const [subject, setSubject] = useState(null);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState(null);
  const st = data?.stats;
  const him = data?.names?.him || '他';
  const items = useMemo(() => {
    const all = data?.items || [];
    const k = q.trim().toLowerCase();
    return all.filter((n) => (subject == null || n.subject === subject)
      && (!k || `${n.title}${n.text}${n.subject}`.toLowerCase().includes(k)));
  }, [data, subject, q]);
  const due = items.filter((n) => dueText(n, st?.today) === '今天复习');
  const rest = items.filter((n) => !due.includes(n));

  if (!data) return <div className="vb-paper vb-pad">正在翻笔记…</div>;
  if (data.available === false) return <div className="vb-paper vb-pad">暂时连不上，过一会儿再来。</div>;
  return (
    <section className="sd-notes">
      <div className="sd-bar">
        <button type="button" className="sd-add" onClick={() => setAdding(true)}><Icon name="camera" size={16} />拍笔记</button>
        <label className="vb-search sd-search"><Icon name="search" size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜笔记" /></label>
      </div>
      {st.subjects.length > 0 && (
        <div className="vb-books sd-subjects">
          <button type="button" className={subject == null ? 'on' : ''} onClick={() => setSubject(null)}>全部 · {st.total}</button>
          {st.subjects.map((s) => <button key={s.name} type="button" className={subject === s.name ? 'on' : ''} onClick={() => setSubject(s.name)}>{s.name} · {s.total}</button>)}
        </div>
      )}

      {due.length > 0 && (
        <>
          <h3 className="sd-h">今天该复习 <em>跟{him}说「考考我」，他会拿这几篇来问你</em></h3>
          <div className="sd-grid">{due.map((n, i) => <NoteCard key={n.id} n={n} i={i} today={st.today} him={him} onOpen={() => setOpenId(n.id)} />)}</div>
        </>
      )}
      {rest.length > 0 && (
        <>
          {due.length > 0 && <h3 className="sd-h">全部笔记</h3>}
          <div className="sd-grid">{rest.map((n, i) => <NoteCard key={n.id} n={n} i={i + due.length} today={st.today} him={him} onOpen={() => setOpenId(n.id)} />)}</div>
        </>
      )}
      {!items.length && (
        <div className="vb-paper sd-empty">
          <b>{st.total ? '没有对得上的笔记' : '还没有笔记'}</b>
          <p>点「拍笔记」自己存；或者在聊天里把笔记照片发给{him}，跟他说「整理进 Study」，他会把照片里的内容写出来放进这里。</p>
        </div>
      )}
      <p className="vb-foot">笔记也按第 1、2、4、7、15、30 天复习 · {him}考你的时候答对了往后推，没答好从头来</p>

      {adding && <AddNote subjects={st.subjects.map((s) => s.name)} onClose={() => setAdding(false)} onDone={() => { setAdding(false); onChanged(); }} />}
      {openId && <NoteSheet id={openId} him={him} today={st.today} onClose={() => setOpenId(null)} onChanged={() => { setOpenId(null); onChanged(); }} />}
    </section>
  );
}

function NoteCard({ n, i, today, him, onOpen }) {
  const img = n.images?.[0];
  const when = dueText(n, today);
  return (
    <button type="button" className={`sd-card ${img ? 'pic' : ''}`} style={{ '--tape': TAPE[i % TAPE.length] }} onClick={onOpen}>
      <i className="sd-tape" aria-hidden="true" />
      {img ? <AuthImg className="sd-thumb" src={img.url} alt="" loading="lazy" /> : <p className="sd-lines">{(n.text || '').slice(0, 90)}</p>}
      {n.images?.length > 1 && <span className="sd-count">{n.images.length} 张</span>}
      <span className="sd-meta">
        <b>{n.title}</b>
        <span>
          {n.subject && <em className="sd-subj">{n.subject}</em>}
          {when && <em className={`sd-due ${when === '今天复习' ? 'now' : ''}`}>{when}</em>}
        </span>
        {n.by === 'him' && <small>{him}整理的</small>}
        {n.by !== 'him' && img && !n.text && <small>只有照片</small>}
      </span>
    </button>
  );
}

function AddNote({ subjects, onClose, onDone }) {
  const [form, setForm] = useState({ title: '', subject: '', text: '' });
  const [pics, setPics] = useState([]); // { url, name, mime, preview }
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const pick = async (files) => {
    const list = [...(files || [])].slice(0, 12 - pics.length);
    for (const [i, f] of list.entries()) {
      setBusy(`上传第 ${i + 1}/${list.length} 张…`);
      try {
        const small = await shrinkImage(f);
        const up = await uploadFile(small);
        setPics((p) => [...p, { url: up.url, name: up.name || f.name, mime: small.type || f.type, preview: URL.createObjectURL(small) }]);
      } catch (e) { setNote(e?.message || '有一张没传上'); }
    }
    setBusy('');
  };
  const save = async () => {
    setBusy('存进去…'); setNote('');
    try {
      await api('/api/study/notes', { method: 'POST', body: { ...form, images: pics.map(({ preview, ...img }) => img) } });
      onDone();
    } catch (e) { setNote(e?.message || '没存上'); setBusy(''); }
  };
  return (
    <Sheet open onClose={onClose} label="拍笔记" seed={73}>
      <div className="vb-form sd-form">
        <div className="sd-pics">
          {pics.map((p, i) => (
            <span key={p.url} className="sd-pic"><img src={p.preview} alt="" /><button type="button" aria-label="去掉" onClick={() => setPics((all) => all.filter((_, j) => j !== i))}>×</button></span>
          ))}
          {pics.length < 12 && (
            <label className="sd-pic add">
              <input type="file" accept="image/*" multiple hidden onChange={(e) => { pick(e.target.files); e.target.value = ''; }} />
              <Icon name="camera" size={22} /><em>拍照 / 相册</em>
            </label>
          )}
        </div>
        <input className="card sd-in" value={form.title} onChange={set('title')} placeholder="标题，比如「定语从句」" />
        <div className="sd-subjrow">
          <input className="card sd-in" value={form.subject} onChange={set('subject')} placeholder="科目，比如 英语" />
          {subjects.slice(0, 5).map((s) => <button key={s} type="button" className={`chip ${form.subject === s ? 'on' : ''}`} onClick={() => setForm((f) => ({ ...f, subject: s }))}>{s}</button>)}
        </div>
        <textarea className="card vb-text sd-text" value={form.text} onChange={set('text')} placeholder="想补几句也可以写这里（不写也行）" />
        <p className="vb-tip">他看不到这里存的照片。想让他读懂、拿来考你，就把照片在聊天里发给他，说「整理进 Study」。</p>
        {note && <p className="vb-tip" role="status">{note}</p>}
        <button type="button" className="btn-main" disabled={!!busy || !(pics.length || form.title.trim() || form.text.trim())} onClick={save}>{busy || '存进 Study'}</button>
      </div>
    </Sheet>
  );
}

function NoteSheet({ id, him, today, onClose, onChanged }) {
  const { data } = useLoad(`/api/study/note/${id}`);
  const [big, setBig] = useState(null);
  const [sure, setSure] = useState(false);
  const n = data?.note;
  const remove = async () => {
    if (!sure) { setSure(true); return; }
    await api(`/api/study/note/${id}`, { method: 'DELETE' });
    onChanged();
  };
  return (
    <Sheet open onClose={onClose} label="笔记" seed={41}>
      <div className="vb-form sd-read">
        {!n ? <p className="vb-tip">翻开中…</p> : (
          <>
            <h2>{n.title}</h2>
            <p className="sd-sub">{[n.subject, n.by === 'him' ? `${him}整理的` : '', dueText(n, today), n.practiced ? `练过 ${n.practiced} 次` : ''].filter(Boolean).join(' · ')}</p>
            {n.images?.length > 0 && (
              <div className="sd-strip">{n.images.map((img) => <AuthImg key={img.url} src={img.url} alt="" onClick={() => setBig(img.url)} />)}</div>
            )}
            {n.text ? <div className="sd-body">{n.text}</div> : <p className="vb-tip">只有照片。在聊天里把照片发给{him}，他就能把内容写进来。</p>}
            {n.summary ? (
              <section className="sd-sum">
                <i className="sd-pin" aria-hidden="true" />
                <h3>{him}的总结</h3>
                <p>{n.summary}</p>
              </section>
            ) : n.text ? <p className="vb-tip">还没有总结。跟{him}说「把《{n.title}》总结一下」，他写好会贴在这里。</p> : null}
            {data.practice?.length > 0 && (
              <>
                <h3 className="sd-h">练过的题</h3>
                {data.practice.map((p) => <PracticeRow key={p.id} p={p} him={him} compact />)}
              </>
            )}
            <button type="button" className={`cl-link sd-del ${sure ? 'on' : ''}`} onClick={remove}><Icon name="trash" size={14} stroke={1.5} />{sure ? '再点一下，确定删掉' : '删掉这篇笔记'}</button>
          </>
        )}
      </div>
      {big && (
        <button type="button" className="sd-big" onClick={() => setBig(null)} aria-label="关掉大图"><AuthImg src={big} alt="" /></button>
      )}
    </Sheet>
  );
}

/* ---------------- 练习 ---------------- */
function Practice() {
  const [view, setView] = useState('all');
  const { data, setData } = useLoad(`/api/study/practice/${view}`);
  const him = data?.names?.him || '他';
  const fix = async (p) => {
    setData((d) => ({ ...d, items: view === 'missed' ? d.items.filter((x) => x.id !== p.id) : d.items.map((x) => (x.id === p.id ? { ...x, fixed: true } : x)) }));
    await api(`/api/study/practice/${p.id}/fix`, { method: 'POST', body: { fixed: true } }).catch(() => {});
  };
  const groups = useMemo(() => {
    const out = [];
    for (const p of data?.items || []) {
      const day = String(p.at || '').slice(0, 10);
      if (!out.length || out[out.length - 1].day !== day) out.push({ day, items: [] });
      out[out.length - 1].items.push(p);
    }
    return out;
  }, [data]);
  const st = data?.stats;

  return (
    <section className="sd-practice">
      <div className="vb-books sd-subjects">
        <button type="button" className={view === 'all' ? 'on' : ''} onClick={() => setView('all')}>全部{st ? ` · ${st.practice}` : ''}</button>
        <button type="button" className={view === 'missed' ? 'on' : ''} onClick={() => setView('missed')}>没答好的{st ? ` · ${st.missed}` : ''}</button>
      </div>
      {!data && <div className="vb-paper vb-pad">正在翻练习本…</div>}
      {data?.available === false && <div className="vb-paper vb-pad">暂时连不上，过一会儿再来。</div>}
      {groups.map((g) => (
        <div key={g.day} className="sd-day">
          <h3 className="sd-h">{g.day.slice(5).replace('-', '.')}</h3>
          {g.items.map((p) => <PracticeRow key={p.id} p={p} him={him} onFix={() => fix(p)} />)}
        </div>
      ))}
      {data?.items && !data.items.length && (
        <div className="vb-paper sd-empty">
          <b>{view === 'missed' ? '没答好的都清掉了 ✿' : '还没有练习'}</b>
          <p>跟{him}说「考考我」「拿今天的笔记问我」「让我用这个词造句」，他出的题、你的回答和他的点评都会记在这里。</p>
        </div>
      )}
    </section>
  );
}

function PracticeRow({ p, him, compact, onFix }) {
  const mark = p.good === true ? 'ok' : p.good === false ? (p.fixed ? 'fixed' : 'bad') : '';
  return (
    <article className={`sd-q ${mark} ${compact ? 'compact' : ''}`}>
      <header>
        <em className="sd-kind">{p.kind || '问答'}</em>
        {p.note_title && !compact && <span className="sd-from">《{p.note_title}》</span>}
        {mark && <span className={`sd-stamp ${mark}`}>{mark === 'ok' ? '对' : mark === 'fixed' ? '后来会了' : '再想想'}</span>}
      </header>
      <p className="sd-ask">{p.question}</p>
      {p.answer && <p className="sd-ans"><small>我</small>{p.answer}</p>}
      {p.feedback && <p className="sd-fb"><small>{him}</small>{p.feedback}</p>}
      {mark === 'bad' && onFix && <button type="button" className="sd-fix" onClick={onFix}>现在会了</button>}
    </article>
  );
}
