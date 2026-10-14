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

function Dots({ stage, total }) {
  return <span className="vb-dots" aria-label={`第 ${stage} 轮`}>{Array.from({ length: total }, (_, i) => <i key={i} className={i < stage ? 'on' : ''} />)}</span>;
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
  const him = data?.names?.him || '他';

  const startReview = async () => {
    const got = view === 'due' ? data : await api('/api/vocab/due');
    if (got?.items?.length) setStudying({ list: got.items });
  };

  return (
    <main className="vb">
      <header className="vb-head">
        <a href="#/" className="rbtn" aria-label="返回"><Icon name="back" size={18} stroke={1.5} /></a>
        <h1><span className="hand">words</span><span>单词本</span></h1>
        <p>按遗忘曲线排复习：第 1、2、4、7、15、30 天各过一遍。记得就往后推，忘了重新计时。{him}也看得到今天该复习哪些，会找机会抽你。</p>
      </header>

      {!data && <div className="card vb-pad">正在翻…</div>}
      {data?.available === false && <div className="card vb-pad">暂时连不上，过一会儿再来。</div>}
      {st && (
        <>
          <section className="card vb-stats">
            <div className="hot"><b className="serif">{st.due}</b><em>今天要复习</em></div>
            <div><b className="serif">{st.wrong}</b><em>错词</em></div>
            <div><b className="serif">{st.total}</b><em>一共</em></div>
            <div><b className="serif">{st.mastered}</b><em>记牢了</em></div>
          </section>
          <div className="vb-acts">
            <button type="button" className="btn-main" disabled={!st.due} onClick={startReview}>{st.due ? `开始复习 · ${st.due} 个` : '今天复习完啦'}</button>
            <button type="button" className="mini-btn" onClick={() => setAdding(true)}><Icon name="plus" size={14} />录词 / 导入</button>
          </div>
          {st.new > 0 && (
            <section className="card vb-learn">
              <div className="vb-learn-h"><b>单词书</b><em>待学 {st.new} 个 · 今天学了 {st.learned_today}/{st.daily_new}</em></div>
              <div className="vb-tabs vb-daily"><small>每天新学</small>{DAILY.map((n) => <button key={n} type="button" className={`chip ${st.daily_new === n ? 'on' : ''}`} onClick={() => setDaily(n)}>{n}</button>)}</div>
              <button type="button" className="btn-main" disabled={!st.learn_left} onClick={startLearn}>{st.learn_left ? `学今天的新词 · ${Math.min(st.learn_left, st.new)} 个` : '今天的新词学完啦'}</button>
            </section>
          )}
          <div className="vb-tabs" role="tablist">
            {VIEWS.map(([k, n]) => <button key={k} type="button" role="tab" aria-selected={view === k} className={`chip ${view === k ? 'on' : ''}`} onClick={() => setView(k)}>{n}</button>)}
          </div>
          {books.length > 0 && view !== 'due' && (
            <div className="vb-tabs vb-books">
              <button type="button" className={`chip ${book == null ? 'on' : ''}`} onClick={() => setBook(null)}>全部本子</button>
              {books.map((b) => <button key={b.name} type="button" className={`chip ${book === b.name ? 'on' : ''}`} onClick={() => setBook(b.name)}>{b.name} · {b.total}</button>)}
              {book != null && <button type="button" className="cl-link st-delmcp" onClick={() => dropBook(book)}><Icon name="trash" size={14} stroke={1.5} />删掉这本</button>}
            </div>
          )}
          {view !== 'due' && <label className="pill vb-search"><Icon name="search" size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜单词或释义" /></label>}
          <div className="card vb-list">
            {items.map((x) => (
              <button key={x.id} type="button" className={`vb-row ${x.wrong ? 'bad' : ''}`} onClick={() => setPicked(x)}>
                <span className="vb-w"><b>{x.word}</b><em>{x.meaning || '（没写释义）'}{x.book ? <i> · {x.book}</i> : null}</em></span>
                <span className="vb-meta">
                  <small>{x.new ? '待学' : dueLabel(x, st.today)}</small>
                  <Dots stage={x.mastered ? st.offsets.length : x.stage || 0} total={st.offsets.length} />
                  {x.wrong > 0 && <small className="vb-bad">错 {x.wrong} 次</small>}
                </span>
              </button>
            ))}
            {!items.length && <p className="vb-empty">{view === 'due' ? '今天没有要复习的词。' : view === 'wrong' ? '错词本是空的，厉害。' : view === 'new' ? '没有待学的词。导入一本单词书试试。' : '这里还没有词。点「录词」开始吧。'}</p>}
          </div>
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

/** 复习：一张一张翻，看释义前先自己想 */
function Study({ list, learn, onClose }) {
  const [i, setI] = useState(0);
  const [flip, setFlip] = useState(false);
  const [score, setScore] = useState({ ok: 0, bad: 0 });
  const [busy, setBusy] = useState(false);
  const done = i >= list.length;
  const x = list[i];
  const answer = async (correct) => {
    setBusy(true);
    try { await api(`/api/vocab/${x.id}/review`, { method: 'POST', body: { correct } }); } catch { /* 记不上也让她往下翻 */ }
    setScore((s) => ({ ok: s.ok + (correct ? 1 : 0), bad: s.bad + (correct ? 0 : 1) }));
    setFlip(false); setI((n) => n + 1); setBusy(false);
  };
  return (
    <Sheet open onClose={onClose} label="复习" seed={92}>
      <div className="vb-study">
        {!done ? (
          <>
            <small className="vb-prog">{learn ? '新词 · ' : ''}{i + 1} / {list.length}{x.wrong ? ` · 错过 ${x.wrong} 次` : ''}</small>
            <button type="button" className="card vb-card" onClick={() => setFlip(true)} aria-label={flip ? '释义' : '点一下看释义'}>
              <b className="serif">{x.word}</b>
              {flip ? <span>{x.meaning || '（没写释义）'}{x.note ? <i>{x.note}</i> : null}</span> : <em>{learn ? '认不认识？想一下再点开' : '先在心里想一下，再点我看释义'}</em>}
            </button>
            <div className="vb-ans">
              <button type="button" className="vb-no" disabled={busy} onClick={() => answer(false)}>{learn ? '不认识' : '忘了'}</button>
              <button type="button" className="btn-main" disabled={busy} onClick={() => answer(true)}>{learn ? '认识' : '记得'}</button>
            </div>
          </>
        ) : (
          <div className="vb-end">
            <b className="serif">{score.ok} / {list.length}</b>
            <p>{learn ? `学了 ${list.length} 个新词，明天开始第一次复习。${score.bad ? `不认识的 ${score.bad} 个进了错词本，会多看几遍。` : ''}`
              : score.bad ? `忘了的 ${score.bad} 个明天再来一遍，已经进错词本。` : '全记得，今天的复习完成了。'}</p>
            <button type="button" className="btn-main" onClick={onClose}>好</button>
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
