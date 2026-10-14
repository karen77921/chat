/**
 * 单词本：录词 → 按艾宾浩斯（第 1、2、4、7、15、30 天）推到「今天复习」；记得往后推，忘了重新计时、进错词本。
 * 他也能看到今天该复习哪些，找机会抽查你，答对答错都记在这里。
 * 网址：#/words    数据：GET /api/vocab/:view、POST /api/vocab、POST /api/vocab/:id/review|edit、DELETE /api/vocab/:id
 */
import { useMemo, useState } from 'react';
import Icon from '../design/icons.jsx';
import Sheet from '../design/Sheet.jsx';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/useLoad.js';
import mochi from '../assets/mochi-him.png';
import '../components/vocab/vocab.css';

const VIEWS = [['due', '今天复习'], ['wrong', '错词本'], ['new', '待学'], ['all', '全部'], ['mastered', '记牢了']];
const DAILY = [10, 20, 30, 50];
const CHUNK = 400; // 一次传 400 行，几千词的单词书分几批传

/** 读文本文件：先按 UTF-8，乱码多就当 GBK（Windows 记事本、老单词书常见） */
async function readText(file) {
  const buf = await file.arrayBuffer();
  const utf = new TextDecoder('utf-8').decode(buf);
  if ((utf.match(/\uFFFD/g) || []).length <= 3) return utf;
  try { return new TextDecoder('gbk').decode(buf); } catch { return utf; }
}

function dueLabel(x, today) {
  if (x.mastered) return '记牢了';
  if (!x.due) return '';
  const days = Math.round((new Date(x.due) - new Date(today)) / 86400000);
  if (days <= 0) return days < 0 ? `该复习了 · 拖了 ${-days} 天` : '今天复习';
  return days === 1 ? '明天复习' : `${days} 天后复习`;
}

const NOTE_TILT = ['-2.5deg', '1.8deg', '-1.2deg', '2.4deg'];
const WEEK = '日一二三四五六';
/** 他那只年糕在旁边说的话（他的口气） */
const cheer = (left, done) => (left === 0 ? (done ? '全背完了？过来，奖励你。' : '今天放你一天假。') : left <= 5 ? `就剩 ${left} 个，背完我陪你。` : `${left} 个，慢慢来，我盯着。`);

function Level({ x, total }) {
  if (x.new) return <span className="vb-lv new">待学</span>;
  if (x.mastered) return <span className="vb-stamp sm">记牢</span>;
  return <span className="vb-lv" title={`第 ${x.stage || 0} 轮`}>Lv.{(x.stage || 0) + 1}<i style={{ width: `${(((x.stage || 0) + 1) / total) * 100}%` }} /></span>;
}

export default function Vocab() {
  const [view, setView] = useState('due');
  const [q, setQ] = useState('');
  const { data, setData, reload } = useLoad(`/api/vocab/${view}`);
  const [adding, setAdding] = useState(false);
  const [studying, setStudying] = useState(null);
  const [picked, setPicked] = useState(null);
  const [book, setBook] = useState(null);
  const st = data?.stats;
  const books = (st?.books || []).filter((b) => b.name);
  const items = useMemo(() => {
    const all = data?.items || [];
    const k = q.trim().toLowerCase();
    const inBook = book == null ? all : all.filter((x) => (x.book || '') === book);
    return k ? inBook.filter((x) => x.word.toLowerCase().includes(k) || (x.meaning || '').toLowerCase().includes(k)) : inBook;
  }, [data, q, book]);
  const him = data?.names?.him || '他';
  const now = new Date();

  const startReview = async () => {
    const got = view === 'due' ? data : await api('/api/vocab/due');
    if (got?.items?.length) setStudying({ list: got.items });
  };
  const startLearn = async () => {
    const got = await api('/api/vocab/do/learn', { method: 'POST', body: {} });
    if (got?.items?.length) setStudying({ list: got.items, learn: true });
  };
  const setDaily = (n) => {
    setData((d) => ({ ...d, stats: { ...d.stats, daily_new: n, learn_left: Math.max(0, n - d.stats.learned_today) } }));
    api('/api/vocab/do/settings', { method: 'POST', body: { daily_new: n } }).catch(() => reload());
  };
  const dropBook = async (name) => {
    if (!window.confirm(`把「${name}」整本删掉？里面的词和复习记录都会删。`)) return;
    await api('/api/vocab/do/delete_book', { method: 'POST', body: { book: name } });
    setBook(null); reload();
  };

  const newToday = st ? Math.min(st.learn_left, st.new) : 0;
  const left = st ? st.due + newToday : 0;
  const pct = st ? Math.round((st.done_today / Math.max(1, st.done_today + left)) * 100) : 0;

  return (
    <main className="vb">
      <header className="vb-head">
        <a href="#/" className="vb-back" aria-label="返回"><Icon name="back" size={18} stroke={1.6} /></a>
        <span className="vb-date">{now.getMonth() + 1}.{now.getDate()} 周{WEEK[now.getDay()]}</span>
        <h1><mark>单词本</mark><small>WORD BOOK</small></h1>
      </header>

      {!data && <div className="vb-paper vb-pad">正在翻本子…</div>}
      {data?.available === false && <div className="vb-paper vb-pad">暂时连不上，过一会儿再来。</div>}
      {st && (
        <>
          <section className="vb-today">
            <i className="vb-pin" aria-hidden="true" />
            <div className="vb-today-h">
              <b>今日任务</b>
              {st.streak > 0 && <span className="vb-streak">🔥 连续 {st.streak} 天</span>}
            </div>
            <div className="vb-bar" aria-label={`今天完成 ${pct}%`}><i style={{ width: `${pct}%` }} /><span>{st.done_today ? `今天已经过了 ${st.done_today} 个` : '今天还没开始'}</span></div>
            <div className="vb-tasks">
              <button type="button" className="vb-task sky" disabled={!st.due} onClick={startReview}>
                {st.due ? <><b>{st.due}</b><em>个要复习</em></> : <span className="vb-stamp">复习完成</span>}
              </button>
              <button type="button" className="vb-task pink" disabled={!newToday} onClick={startLearn}>
                {newToday ? <><b>{newToday}</b><em>个新词</em></> : <span className="vb-stamp">{st.new ? '新词学完' : '没有新词'}</span>}
              </button>
            </div>
            <div className="vb-mochi" aria-hidden="true">
              <span className="vb-say">{cheer(left, st.done_today)}</span>
              <img src={mochi} alt="" draggable="false" />
            </div>
          </section>

          <div className="vb-notes">
            {[['错词', st.wrong, 'coral'], ['一共', st.total, 'yellow'], ['记牢了', st.mastered, 'mint'], ['待学', st.new, 'sky']].map(([k, v, c], n) => (
              <div key={k} className={`vb-note ${c}`} style={{ '--tilt': NOTE_TILT[n] }}><b>{v}</b><em>{k}</em></div>
            ))}
          </div>

          {st.new > 0 && (
            <div className="vb-daily"><span>每天新学</span>{DAILY.map((n) => <button key={n} type="button" className={st.daily_new === n ? 'on' : ''} onClick={() => setDaily(n)}>{n}</button>)}</div>
          )}

          <section className="vb-book">
            <nav className="vb-index" role="tablist">
              {VIEWS.map(([k, n], i) => <button key={k} type="button" role="tab" aria-selected={view === k} className={`t${i} ${view === k ? 'on' : ''}`} onClick={() => setView(k)}>{n}</button>)}
            </nav>
            <div className="vb-page">
              <button type="button" className="vb-addline" onClick={() => setAdding(true)}><Icon name="plus" size={15} />录词 / 导入单词书</button>
              {books.length > 0 && view !== 'due' && (
                <div className="vb-books">
                  <button type="button" className={book == null ? 'on' : ''} onClick={() => setBook(null)}>全部本子</button>
                  {books.map((b) => <button key={b.name} type="button" className={book === b.name ? 'on' : ''} onClick={() => setBook(b.name)}>{b.name} · {b.total}</button>)}
                  {book != null && <button type="button" className="vb-del" onClick={() => dropBook(book)}><Icon name="trash" size={13} stroke={1.5} />删掉这本</button>}
                </div>
              )}
              {view !== 'due' && <label className="vb-search"><Icon name="search" size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜单词或释义" /></label>}
              {items.map((x) => (
                <button key={x.id} type="button" className={`vb-row ${x.wrong ? 'bad' : ''}`} onClick={() => setPicked(x)}>
                  <span className="vb-w"><b>{x.word}</b><em>{x.meaning || '（没写释义）'}{x.book ? <i> · {x.book}</i> : null}</em></span>
                  <span className="vb-meta">
                    <Level x={x} total={st.offsets.length} />
                    <small>{x.new ? '' : dueLabel(x, st.today)}</small>
                    {x.wrong > 0 && <small className="vb-x">{'✗'.repeat(Math.min(x.wrong, 5))}</small>}
                  </span>
                </button>
              ))}
              {!items.length && <p className="vb-empty">{view === 'due' ? '今天没有要复习的词 ✿' : view === 'wrong' ? '错词本是空的，厉害！' : view === 'new' ? '没有待学的词，导入一本单词书试试。' : '这一页还是空白的。'}</p>}
            </div>
          </section>
          <p className="vb-foot">第 1、2、4、7、15、30 天各复习一次 · 记得往后推，忘了重新计时 · {him}看得到今天的任务，会来抽查你</p>
        </>
      )}

      {adding && <AddWords onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />}
      {studying && <Study list={studying.list} learn={studying.learn} onClose={() => { setStudying(null); reload(); }} />}
      {picked && <WordSheet item={picked} today={st?.today} onClose={() => setPicked(null)}
        onChange={(it, gone) => { setPicked(null); setData((d) => ({ ...d, items: gone ? d.items.filter((x) => x.id !== it.id) : d.items.map((x) => (x.id === it.id ? it : x)) })); if (gone) reload(); }} />}
    </main>
  );
}

function AddWords({ onClose, onDone }) {
  const [tab, setTab] = useState('type');
  const [text, setText] = useState('');
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState(null); // { name, lines }
  const [bookName, setBookName] = useState('');
  const [queue, setQueue] = useState(true);
  const lines = text.split('\n').filter((l) => l.trim()).length;
  const save = async () => {
    setBusy('录进去…'); setNote('');
    try {
      const r = await api('/api/vocab', { method: 'POST', body: { text, wrong } });
      setNote(`录好了：新词 ${r.added.length} 个${r.updated.length ? `，已有的 ${r.updated.length} 个更新了` : ''}`);
      setTimeout(onDone, 700);
    } catch (e) { setNote(e?.message || '没录上，再试一次'); }
    setBusy('');
  };
  const pick = async (f) => {
    if (!f) return;
    setNote('');
    if (/\.(xlsx?|docx?|pdf)$/i.test(f.name)) { setNote('这个格式读不了。Excel 另存为 CSV，Word/PDF 复制成 txt 再导入。'); return; }
    const all = (await readText(f)).split(/\r?\n/).filter((l) => l.trim());
    setFile({ name: f.name, lines: all });
    setBookName(f.name.replace(/\.[^.]+$/, '').slice(0, 40));
  };
  const importFile = async () => {
    let added = 0, skipped = 0;
    setNote('');
    try {
      for (let i = 0; i < file.lines.length; i += CHUNK) {
        setBusy(`导入中 ${Math.min(i + CHUNK, file.lines.length)}/${file.lines.length}…`);
        try {
          const r = await api('/api/vocab', { method: 'POST', body: { text: file.lines.slice(i, i + CHUNK).join('\n'), queue, book: bookName.trim() } });
          added += r.added.length; skipped += r.updated.length;
        } catch (e) { if (!/没读到单词/.test(e?.message || '')) throw e; }
      }
      setNote(`导入好了：新词 ${added} 个${queue ? '，放进待学，每天学一点' : '，明天开始复习'}。`);
      setTimeout(onDone, 1200);
    } catch (e) { setNote(`导到一半停了（已导入 ${added} 个）：${e?.message || '网络不好'}，再点一次会跳过已经导进去的。`); }
    setBusy('');
  };
  return (
    <Sheet open onClose={onClose} label="录词" seed={91}>
      <div className="vb-form">
        <div className="vb-tabs">
          <button type="button" className={`chip ${tab === 'type' ? 'on' : ''}`} onClick={() => setTab('type')}>手动录</button>
          <button type="button" className={`chip ${tab === 'file' ? 'on' : ''}`} onClick={() => setTab('file')}>导入单词书 / txt</button>
        </div>
        {tab === 'type' ? (
          <>
            <textarea className="card vb-text" value={text} onChange={(e) => setText(e.target.value)} autoFocus
              placeholder={'一行一个，单词和释义中间空一格：\napple 苹果\ntake off 起飞\nabandon: 放弃'} />
            <div className="vb-tabs">
              <button type="button" className={`chip ${!wrong ? 'on' : ''}`} onClick={() => setWrong(false)}>背对了的</button>
              <button type="button" className={`chip ${wrong ? 'on' : ''}`} onClick={() => setWrong(true)}>这批是背错的</button>
            </div>
            <p className="vb-tip">明天开始第一次复习。已经在本子里的词不会重复；标成背错的会重新计时，进错词本。</p>
            {note && <p className="vb-tip" role="status">{note}</p>}
            <button type="button" className="btn-main" disabled={!!busy || !lines} onClick={save}>{busy || `录进去 · ${lines} 个`}</button>
          </>
        ) : (
          <>
            <label className="card vb-file">
              <input type="file" accept=".txt,.csv,.tsv,.md,text/plain,text/csv" hidden onChange={(e) => { pick(e.target.files[0]); e.target.value = ''; }} />
              <Icon name="file" size={22} />
              <b>{file ? file.name : '选一个文件'}</b>
              <em>{file ? `${file.lines.length} 行` : 'txt、csv、tsv 都行。Excel 先另存为 CSV'}</em>
            </label>
            {file && (
              <>
                <pre className="vb-preview">{file.lines.slice(0, 6).join('\n')}{file.lines.length > 6 ? '\n…' : ''}</pre>
                <label className="pill vb-field"><span>本子名</span><input value={bookName} maxLength={40} onChange={(e) => setBookName(e.target.value)} placeholder="比如：四级 / 雅思" /></label>
                <div className="vb-tabs">
                  <button type="button" className={`chip ${queue ? 'on' : ''}`} onClick={() => setQueue(true)}>放进待学，每天学一点</button>
                  <button type="button" className={`chip ${!queue ? 'on' : ''}`} onClick={() => setQueue(false)}>都背过了，直接排复习</button>
                </div>
              </>
            )}
            <p className="vb-tip">认得这些写法：「apple 苹果」「apple,苹果」「abandon /əˈbændən/ v. 放弃」，音标会收进备注，「Unit 1」这种标题会跳过。已经在本子里的词不会重复导入。</p>
            {note && <p className="vb-tip" role="status">{note}</p>}
            <button type="button" className="btn-main" disabled={!!busy || !file?.lines.length} onClick={importFile}>{busy || (file ? `导入 · ${file.lines.length} 行` : '先选文件')}</button>
          </>
        )}
      </div>
    </Sheet>
  );
}

/** 复习 / 学新词：一张索引卡，点一下翻面；连对有连击，做完撒花 */
function Study({ list, learn, onClose }) {
  const [i, setI] = useState(0);
  const [flip, setFlip] = useState(false);
  const [marks, setMarks] = useState([]);
  const [combo, setCombo] = useState(0);
  const [busy, setBusy] = useState(false);
  const done = i >= list.length;
  const x = list[i];
  const ok = marks.filter(Boolean).length;
  const answer = async (correct) => {
    setBusy(true);
    try { await api(`/api/vocab/${x.id}/review`, { method: 'POST', body: { correct } }); } catch { /* 记不上也让她往下翻 */ }
    setMarks((m) => [...m, correct]);
    setCombo((c) => (correct ? c + 1 : 0));
    setFlip(false);
    setTimeout(() => { setI((n) => n + 1); setBusy(false); }, 180);
  };
  return (
    <Sheet open onClose={onClose} label={learn ? '学新词' : '复习'} seed={92}>
      <div className="vb-study">
        {!done ? (
          <>
            <div className="vb-track">
              {list.map((_, n) => <i key={n} className={n < marks.length ? (marks[n] ? 'ok' : 'no') : n === i ? 'now' : ''} />)}
            </div>
            <div className="vb-study-h">
              <span>{learn ? '新词' : '复习'} {i + 1}/{list.length}</span>
              {combo >= 2 && <span key={combo} className="vb-combo">连对 ×{combo}</span>}
            </div>
            <button type="button" className={`vb-flip ${flip ? 'on' : ''}`} onClick={() => setFlip((f) => !f)} aria-label={flip ? '翻回去' : '翻面看释义'}>
              <span className="vb-face front">
                {x.wrong > 0 && <span className="vb-tag">错过 {x.wrong} 次</span>}
                <b>{x.word}</b>
                <em>{learn ? '认不认识？点我翻面' : '先想一想，再点我翻面'}</em>
              </span>
              <span className="vb-face back">
                <small>{x.word}</small>
                <b>{x.meaning || '（没写释义）'}</b>
                {x.note && <em>{x.note}</em>}
              </span>
            </button>
            <div className="vb-ans">
              <button type="button" className="vb-btn no" disabled={busy} onClick={() => answer(false)}>✗ {learn ? '不认识' : '忘了'}</button>
              <button type="button" className="vb-btn ok" disabled={busy} onClick={() => answer(true)}>✓ {learn ? '认识' : '记得'}</button>
            </div>
          </>
        ) : (
          <div className="vb-end">
            <div className="vb-confetti" aria-hidden="true">{Array.from({ length: 18 }, (_, n) => <i key={n} style={{ '--n': n }} />)}</div>
            <img src={mochi} alt="" className="vb-end-mochi" draggable="false" />
            <b>{ok} / {list.length}</b>
            <p>{learn ? `学了 ${list.length} 个新词，明天开始第一次复习。${marks.length - ok ? `不认识的 ${marks.length - ok} 个进了错词本，会多见几次。` : ''}`
              : marks.length - ok ? `忘了的 ${marks.length - ok} 个明天再来一遍，已经进错词本。` : '全记得！今天的复习完成了。'}</p>
            <button type="button" className="vb-btn ok wide" onClick={onClose}>收工</button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function WordSheet({ item, today, onClose, onChange }) {
  const [form, setForm] = useState({ word: item.word, meaning: item.meaning || '', note: item.note || '' });
  const [sure, setSure] = useState(false);
  const [note, setNote] = useState('');
  const save = async () => {
    try { onChange(await api(`/api/vocab/${item.id}/edit`, { method: 'POST', body: form })); } catch (e) { setNote(e?.message || '没改成'); }
  };
  const remove = async () => {
    try { await api(`/api/vocab/${item.id}`, { method: 'DELETE' }); onChange(item, true); } catch (e) { setNote(e?.message || '没删掉'); }
  };
  const when = (iso) => new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return (
    <Sheet open onClose={onClose} label={item.word} seed={93}>
      <div className="vb-form">
        <label className="pill vb-field"><span>单词</span><input value={form.word} onChange={(e) => setForm({ ...form, word: e.target.value })} /></label>
        <label className="pill vb-field"><span>释义</span><input value={form.meaning} onChange={(e) => setForm({ ...form, meaning: e.target.value })} /></label>
        <label className="pill vb-field"><span>备注</span><input value={form.note} placeholder="例句、搭配…" onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
        <p className="vb-tip">{dueLabel(item, today)} · 第一次出现 {item.start} · 记得 {item.right || 0} 次 · 忘了 {item.wrong || 0} 次</p>
        {(item.log || []).length > 0 && (
          <ul className="vb-log">{[...item.log].reverse().slice(0, 8).map((l, n) => <li key={n}>{when(l.at)} · {l.by === 'him' ? '他抽查' : '自己复习'} · {l.ok ? '记得' : '忘了'}</li>)}</ul>
        )}
        {note && <p className="vb-tip">{note}</p>}
        <button type="button" className="btn-main" onClick={save}>保存</button>
        {sure ? <button type="button" className="cl-link st-delmcp" onClick={remove}><Icon name="trash" size={15} stroke={1.5} />确定删掉「{item.word}」</button>
          : <button type="button" className="cl-link st-delmcp" onClick={() => setSure(true)}><Icon name="trash" size={15} stroke={1.5} />删掉这个词</button>}
      </div>
    </Sheet>
  );
}
