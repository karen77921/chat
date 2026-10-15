/**
 * 书房（共读）：书架 → 读书页。她和他各有一枚书签；划线、批注、生词、问他都挂在某一句话上。
 * 网址：#/study（书架）、#/study/read?id=…&ch=…（读书）
 * 数据：GET /api/books、GET /api/books/:id/ch/:n、POST /api/books/:id/progress|mark|update、
 *       DELETE /api/books/:id、DELETE /api/books/marks/:id、POST /api/books/import|gutenberg/:n|ask
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRoute } from '../lib/router.js';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/useLoad.js';
import '../components/study/study.css';

const CLASSICS = [
  [1342, 'Pride and Prejudice', 'Jane Austen'], [1260, 'Jane Eyre', 'Charlotte Brontë'],
  [158, 'Emma', 'Jane Austen'], [514, 'Little Women', 'Louisa May Alcott'],
];
const SIZES = [15.5, 17, 18.5, 20];

const go = (hash) => { location.hash = hash; };
const initial = (name, fallback) => { const s = [...String(name || '').trim()]; return s.length ? s[s.length - 1] : fallback; };
const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
function inkOn(hex) {
  const n = parseInt(String(hex || '#777777').slice(1), 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#4f4740' : '#efe6d4';
}
function roman(n) {
  if (n > 100) return String(n);
  const t = [[100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of t) while (n >= v) { out += s; n -= v; }
  return out;
}
function hours(min) {
  if (!min) return '刚开始';
  return min < 60 ? `${min} 分钟` : `${(min / 60).toFixed(min < 600 ? 1 : 0).replace(/\.0$/, '')} 小时`;
}
function when(iso) {
  const t = new Date(iso);
  if (Number.isNaN(+t)) return '';
  const mins = (Date.now() - t) / 60000;
  if (mins < 2) return '刚刚';
  if (mins < 60) return `${Math.floor(mins)} 分钟前`;
  const hm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (t >= today) return `今天 ${hm}`;
  if (t >= today - 86400000) return `${t.getHours() >= 21 || t.getHours() < 4 ? '昨夜' : '昨天'} ${hm}`;
  return `${t.getMonth() + 1}.${t.getDate()}`;
}
const quoted = (q) => (/^["“'‘「]/.test(q) ? q : `“${q}”`);
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

/** 一段拆成句子（Mr. / Mrs. 不断开） */
function sentences(text) {
  const parts = String(text).match(/[^.!?。！？…；;]+(?:[.!?。！？…；;]+["'”’」』）)\]]*\s*|$)/g) || [text];
  const out = [];
  for (const p of parts) {
    if (!p) continue;
    if (out.length && /\b(Mr|Mrs|Ms|Dr|St|Jr|Sr|Mme|Mlle|Messrs)\.\s*$/.test(out[out.length - 1])) out[out.length - 1] += p;
    else out.push(p);
  }
  return out.length ? out : [text];
}
const hits = (quote, sentence) => {
  const q = norm(quote), s = norm(sentence);
  return q.length > 1 && s.length > 1 && (q.includes(s) || s.includes(q));
};

/* ——————————————— 书的样子 ——————————————— */

function Cover({ book }) {
  const ink = inkOn(book.color);
  const m = String(book.title).match(/^(.+?)\s+(and|&)\s+(.+)$/i);
  return (
    <div className="st-book" style={{ '--cloth': book.color, '--ink': ink }}>
      <div className="st-face">
        <div className="st-frame" />
        <div className={`st-ct ${book.title.length > 22 ? 'long' : ''}`}>
          {m ? <>{m[1]}<i>{m[2]}</i>{m[3]}</> : book.title}
        </div>
        <div className="st-rule" />
        <div className="st-ca">{(book.author || '').toUpperCase()}</div>
      </div>
      <div className="st-edge" />
    </div>
  );
}

function Spine({ book, onClick, h, w }) {
  const ink = inkOn(book.color);
  return (
    <button type="button" className="st-spine" onClick={onClick} aria-label={book.title}
      style={{ background: book.color, color: ink, height: h, width: w }}>
      <span className="st-sp-t">{book.title}</span>
      <span className="st-band" />
    </button>
  );
}
const spineSize = (b, base = 92) => ({ h: base - 10 + (hash(b.id) % 14), w: 17 + (hash(b.title) % 8) });

/* ——————————————— 书架 ——————————————— */

function Shelf() {
  const { data, reload } = useLoad('/api/books');
  const [sheet, setSheet] = useState(null); // 'import' | 'menu'
  const books = data?.books || [];
  const names = data?.names || { me: '我', him: '他' };
  const cur = books.find((b) => b.status === 'reading') || books[0];
  const rest = books.filter((b) => b !== cur);
  const rows = [];
  for (let i = 0; i < rest.length + 1; i += 11) rows.push(rest.slice(i, i + 11));
  const me = cur?.progress.me, him = cur?.progress.him;
  const meI = initial(names.me, '我'), himI = initial(names.him, '他');

  return (
    <main className="st st-shelf">
      <header className="st-head">
        <a href="#/" className="st-back" aria-label="返回">‹</a>
        <div><div className="st-eyebrow">The Study</div><h1>书房</h1></div>
        <button type="button" className="st-ghost" onClick={() => setSheet('import')}>导入</button>
      </header>

      {!data && <p className="st-quiet">正在把书搬上架…</p>}
      {data?.available === false && <p className="st-quiet">暂时连不上，过一会儿再来。</p>}

      {data && data.available !== false && !cur && (
        <section className="st-empty">
          <div className="st-stage"><button type="button" className="st-add big" onClick={() => setSheet('import')}>＋</button><div className="st-ledge" /></div>
          <p>书架还空着。<br />传一本 txt / epub / pdf，或者从公版书库拿一本。</p>
          <button type="button" className="st-black" onClick={() => setSheet('import')}>放第一本书</button>
        </section>
      )}

      {cur && (
        <>
          <section className="st-stage">
            <button type="button" className="st-hero" onClick={() => go(`#/study/read?id=${cur.id}`)} aria-label={`读《${cur.title}》`}>
              <Cover book={cur} />
              <i className="st-ribbon her" /><i className="st-ribbon him" />
            </button>
            {rest.slice(0, 3).map((b, i) => (
              <div key={b.id} className="st-stand" style={{ left: 196 + i * 27 }}>
                <Spine book={b} {...spineSize(b, 186)} w={20 + (hash(b.id) % 6)} onClick={() => go(`#/study/read?id=${b.id}`)} />
              </div>
            ))}
            <i className="st-flat" style={{ left: 196 + Math.min(rest.length, 3) * 27 + 10, background: rest[3]?.color || '#6d7d84' }} />
            <i className="st-flat two" style={{ left: 196 + Math.min(rest.length, 3) * 27 + 14, background: rest[4]?.color || '#cdbfae' }} />
            <div className="st-ledge" />
          </section>

          <section className="st-now">
            <div className="st-row">
              <h2 className={cur.title.length > 24 ? 'long' : ''}>{cur.title}</h2>
              <button type="button" className="st-meta" onClick={() => setSheet('menu')} aria-label="这本书">{roman(me.ch + 1)} / {roman(cur.chapters)} ···</button>
            </div>
            <div className="st-sub">{me.title} · 一起读了 {hours(cur.minutes)}</div>
            <Progress me={me} him={him} meI={meI} himI={himI} labels />
            <div className="st-cta">
              <small>
                {!him.started ? <>{names.him}还没翻开<br />等你先读</>
                  : him.pct > me.pct + 0.4 ? <>{names.him}读到了「{him.title}」<br />在前面等你</>
                    : <>{names.him}在你后面一点<br />读到「{him.title}」</>}
              </small>
              <button type="button" className="st-black" onClick={() => go(`#/study/read?id=${cur.id}`)}>{me.started ? '继续阅读' : '开始读'}</button>
            </div>
          </section>

          <div className="st-label"><h3>书架</h3><span>{books.length} {books.length === 1 ? 'volume' : 'volumes'}</span></div>
          {rows.map((row, ri) => (
            <div key={ri} className="st-shelfrow">
              <div className="st-spines">
                {row.map((b) => <Spine key={b.id} book={b} {...spineSize(b)} onClick={() => go(`#/study/read?id=${b.id}`)} />)}
                {ri === rows.length - 1 && <button type="button" className="st-add" onClick={() => setSheet('import')} aria-label="导入">＋</button>}
              </div>
              <div className="st-ledge" />
            </div>
          ))}

          {(data.recent || []).filter((n, i, all) => all.findIndex((x) => x.book === n.book && x.quote === n.quote) === i).slice(0, 2).map((n) => (
            <button key={n.id} type="button" className={`st-quote ${n.by}`} onClick={() => go(`#/study/read?id=${n.book}&ch=${n.ch}&para=${n.para}`)}>
              <p>{quoted(n.quote.length > 120 ? `${n.quote.slice(0, 120)}…` : n.quote)}</p>
              <div><b>{n.by === 'him' ? himI : meI}</b>　{n.text}</div>
            </button>
          ))}
        </>
      )}

      {sheet === 'import' && <ImportSheet onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />}
      {sheet === 'menu' && cur && <BookMenu book={cur} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />}
    </main>
  );
}

function Progress({ me, him, meI, himI, labels }) {
  return (
    <div className="st-prog">
      <div className="st-done" style={{ width: `${me.pct}%` }} />
      <div className="st-tick her" style={{ left: `${me.pct}%` }}><span>{meI}{labels ? ` ${Math.round(me.pct)}%` : ''}</span></div>
      {him.started && <div className="st-tick him" style={{ left: `${him.pct}%` }}><span>{himI}{labels ? ` ${Math.round(him.pct)}%` : ''}</span></div>}
    </div>
  );
}

function Panel({ onClose, children, label }) {
  return (
    <div className="st-layer" role="dialog" aria-modal="true" aria-label={label}>
      <button type="button" className="st-veil" aria-label="关闭" onClick={onClose} />
      <div className="st-sheet"><i className="st-grab" />{children}</div>
    </div>
  );
}

function ImportSheet({ onClose, onDone }) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const file = useRef(null);
  const run = async (label, fn) => {
    setBusy(label); setErr('');
    try { await fn(); onDone(); } catch (e) { setErr(e?.message || '没放上去，再试一次'); } finally { setBusy(''); }
  };
  return (
    <Panel onClose={onClose} label="导入">
      <div className="st-pad">
        <div className="st-eyebrow">Add a book</div>
        <h4 className="st-h4">放一本书上架</h4>
        <button type="button" className="st-line-btn" disabled={!!busy} onClick={() => file.current?.click()}>
          <b>从手机里选</b><span>txt · epub · pdf，40MB 以内</span>
        </button>
        <input ref={file} type="file" hidden accept=".txt,.epub,.pdf,text/plain,application/epub+zip,application/pdf"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) run(`正在拆《${f.name}》的章节…`, () => api('/api/books/import', { method: 'POST', body: { file: f, readNow: true } })); }} />
        <div className="st-eyebrow" style={{ marginTop: 22 }}>Public domain</div>
        {CLASSICS.map(([n, t, a]) => (
          <button key={n} type="button" className="st-line-btn" disabled={!!busy}
            onClick={() => run(`正在从古登堡书库取《${t}》…`, () => api(`/api/books/gutenberg/${n}`, { method: 'POST' }))}>
            <b className="en">{t}</b><span>{a}</span>
          </button>
        ))}
        {busy && <p className="st-note">{busy}</p>}
        {err && <p className="st-note err">{err}</p>}
      </div>
    </Panel>
  );
}

function BookMenu({ book, onClose, onDone }) {
  const [sure, setSure] = useState(false);
  const set = (status) => api(`/api/books/${book.id}/update`, { method: 'POST', body: { status } }).then(onDone);
  return (
    <Panel onClose={onClose} label="这本书">
      <div className="st-pad">
        <div className="st-eyebrow">{book.author || 'Book'}</div>
        <h4 className="st-h4 en">{book.title}</h4>
        {book.status !== 'done' && <button type="button" className="st-line-btn" onClick={() => set('done')}><b>读完了</b><span>放到书架上，留着你们的批注</span></button>}
        {book.status !== 'shelf' && <button type="button" className="st-line-btn" onClick={() => set('shelf')}><b>先放回书架</b><span>不在读了，书签还留着</span></button>}
        <button type="button" className="st-line-btn danger" onClick={() => (sure ? api(`/api/books/${book.id}`, { method: 'DELETE' }).then(onDone) : setSure(true))}>
          <b>{sure ? '再点一次：连批注一起删掉' : '删掉这本'}</b><span>划线和批注也会一起没</span>
        </button>
      </div>
    </Panel>
  );
}

/* ——————————————— 读书页 ——————————————— */

function loadPrefs() {
  try { return { size: 1, night: false, ...JSON.parse(localStorage.getItem('imprint.study') || '{}') }; } catch { return { size: 1, night: false }; }
}

function Para({ text, idx, marks, sel, onPick, first }) {
  const sents = useMemo(() => sentences(text), [text]);
  const words = marks.filter((m) => m.kind === 'word' && !m.parent).map((m) => m.quote);
  const lines = marks.filter((m) => m.kind !== 'word' && !m.parent);
  return (
    <p className={first ? 'first' : ''} data-i={idx}>
      {sents.map((s, i) => {
        const on = lines.filter((m) => hits(m.quote, s));
        const cls = ['st-s', on.some((m) => m.by === 'me') && 'wh', on.some((m) => m.by === 'him') && 'wm', sel === i && 'sel'].filter(Boolean).join(' ');
        return <span key={i} className={cls} onClick={(e) => { e.stopPropagation(); onPick(idx, i, s, e.currentTarget); }}>{withWords(s, words)}</span>;
      })}
    </p>
  );
}
function withWords(s, words) {
  if (!words.length) return s;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return s.split(re).map((part, i) => (i % 2 ? <span key={i} className="st-dw">{part}</span> : part));
}

function Reader({ id, chParam, paraParam }) {
  const [ch, setCh] = useState(chParam != null ? Number(chParam) : -1);
  const [data, setData] = useState(null);
  const [names, setNames] = useState({ me: '我', him: '他' });
  const [prefs, setPrefs] = useState(loadPrefs);
  const [aa, setAa] = useState(false);
  const [toc, setToc] = useState(false);
  const [pick, setPick] = useState(null); // { para, si, text, top, left }
  const [thread, setThread] = useState(null); // { mode:'view'|'note'|'ask'|'word', root?, para, quote }
  const [toast, setToast] = useState('');
  const ready = useRef(false);
  const lastSaved = useRef('');
  const target = useRef(paraParam != null ? Number(paraParam) : null);

  const say = (t) => { setToast(t); setTimeout(() => setToast(''), 2200); };
  const load = useCallback((which) => api(`/api/books/${id}/ch/${which}`).then((d) => { setData(d); return d; }), [id]);

  useEffect(() => { api('/api/books').then((d) => d?.names && setNames(d.names)).catch(() => {}); }, []);
  useEffect(() => {
    ready.current = false;
    setData(null); setPick(null);
    load(ch).then((d) => {
      if (ch < 0) { setCh(d.ch); return; }
      const me = d.book.progress.me;
      const para = target.current != null ? target.current : (me.ch === d.ch ? me.para : 0);
      target.current = null;
      requestAnimationFrame(() => {
        const el = para > 0 && document.querySelector(`.st-text [data-i="${para}"]`);
        if (el) el.scrollIntoView({ block: 'start' }); else window.scrollTo(0, 0);
        setTimeout(() => { ready.current = true; }, 400);
      });
    }).catch((e) => setData({ error: e?.message || '打不开这本书' }));
  }, [ch, load]);
  useEffect(() => { try { localStorage.setItem('imprint.study', JSON.stringify(prefs)); } catch { /* 无痕模式 */ } }, [prefs]);

  // 书签：停下来的那一段（顶上第一段看得见的）
  useEffect(() => {
    if (!data?.paras) return undefined;
    let timer = 0;
    const save = () => {
      if (!ready.current) return;
      const ps = [...document.querySelectorAll('.st-text [data-i]')];
      const atEnd = window.innerHeight + window.scrollY >= document.body.scrollHeight - 40;
      const top = atEnd ? ps[ps.length - 1] : ps.find((p) => p.getBoundingClientRect().bottom > 90);
      if (!top) return;
      const para = Number(top.dataset.i);
      const key = `${data.ch}.${para}`;
      if (key === lastSaved.current) return;
      lastSaved.current = key;
      api(`/api/books/${id}/progress`, { method: 'POST', body: { ch: data.ch, para } })
        .then((r) => setData((d) => (d && d.ch === data.ch ? { ...d, book: { ...d.book, progress: r.progress, minutes: r.minutes } } : d))).catch(() => {});
    };
    const on = () => { clearTimeout(timer); timer = setTimeout(save, 1200); setPick(null); };
    addEventListener('scroll', on, { passive: true });
    return () => { removeEventListener('scroll', on); clearTimeout(timer); };
  }, [data?.ch, data?.paras, id]);

  if (data?.error) return <main className="st st-reader"><p className="st-quiet">{data.error}　<a href="#/study">回书架</a></p></main>;
  const book = data?.book;
  const marks = data?.marks || [];
  const roots = marks.filter((m) => !m.parent);
  const replies = (rid) => marks.filter((m) => m.parent === rid);
  const meI = initial(names.me, '我'), himI = initial(names.him, '他');
  const nameOf = (by) => (by === 'him' ? himI : meI);
  const head = data?.title?.match(/^(chapter|letter|book|part|volume|stave)\s+(.+)$/i);
  const himAt = book?.progress.him.started && book.progress.him.ch === data?.ch ? book.progress.him.para : -1;

  const onPick = (para, si, text, el) => {
    if (pick && pick.para === para && pick.si === si) { setPick(null); return; }
    const r = el.getBoundingClientRect();
    const top = r.top > 120 ? r.top - 52 : r.bottom + 12;
    setPick({ para, si, text: text.trim(), top, below: r.top <= 120 });
  };
  const myLine = pick && roots.find((m) => m.by === 'me' && m.kind === 'line' && m.para === pick.para && norm(m.quote) === norm(pick.text));
  const addMark = (body) => api(`/api/books/${id}/mark`, { method: 'POST', body: { ch: data.ch, ...body } })
    .then((r) => { setData((d) => ({ ...d, marks: [...d.marks, r.mark] })); return r.mark; });
  const line = async () => {
    const p = pick; setPick(null);
    try {
      if (myLine) { await api(`/api/books/marks/${myLine.id}`, { method: 'DELETE' }); setData((d) => ({ ...d, marks: d.marks.filter((m) => m.id !== myLine.id) })); }
      else await addMark({ para: p.para, quote: p.text, kind: 'line' });
    } catch (e) { say(e?.message || '没划上'); }
  };

  return (
    <main className={`st st-reader ${prefs.night ? 'night' : ''}`} style={{ '--fs': `${SIZES[prefs.size]}px` }} onClick={() => { setPick(null); setAa(false); }}>
      <header className="st-rbar">
        <a href="#/study" className="st-x" aria-label="回书架">×</a>
        <span className="st-c">{book?.title || ''}</span>
        <button type="button" className="st-aa" onClick={(e) => { e.stopPropagation(); setAa((v) => !v); }}>Aa</button>
      </header>
      {aa && (
        <div className="st-aa-pop" onClick={(e) => e.stopPropagation()}>
          <div className="st-aa-row"><span>字号</span>
            <button type="button" disabled={prefs.size === 0} onClick={() => setPrefs((p) => ({ ...p, size: p.size - 1 }))}>A−</button>
            <button type="button" disabled={prefs.size === SIZES.length - 1} onClick={() => setPrefs((p) => ({ ...p, size: p.size + 1 }))}>A+</button></div>
          <div className="st-aa-row"><span>夜读</span><button type="button" className={prefs.night ? 'on' : ''} onClick={() => setPrefs((p) => ({ ...p, night: !p.night }))}>{prefs.night ? '开' : '关'}</button></div>
          <button type="button" className="st-aa-toc" onClick={() => { setAa(false); setToc(true); }}>目录 · {data?.toc?.length || 0} 章</button>
        </div>
      )}

      {!data && <p className="st-quiet">翻开中…</p>}
      {data?.paras && (
        <article className="st-text">
          <div className="st-num">{head ? head[1].toUpperCase() : `${data.ch + 1} / ${data.toc.length}`}</div>
          <h1 className={`st-chapter ${head ? '' : 'long'}`}>{head ? head[2] : data.title}</h1>
          {data.paras.map((text, i) => {
            const here = roots.filter((m) => m.para === i);
            const notes = here.filter((m) => m.text);
            const who = [...new Set(here.filter((m) => m.kind !== 'word').map((m) => m.by))];
            return (
              <div key={i} className="st-pw">
                <Para text={text} idx={i} marks={here} first={i === 0} sel={pick?.para === i ? pick.si : -1} onPick={onPick} />
                {who.length > 0 && <span className="st-mk">{who.map((b) => <i key={b} className={b}>{nameOf(b)}</i>)}</span>}
                {notes.map((m) => {
                  const n = replies(m.id).length;
                  return (
                    <button key={m.id} type="button" className={`st-annot ${m.by}`} onClick={(e) => { e.stopPropagation(); setThread({ mode: 'view', root: m, key: m.id }); }}>
                      <small>{nameOf(m.by)}{m.kind === 'ask' ? ' 问' : ''} · {when(m.at)}{n ? ` · ${n} 条回复` : ''}</small>{m.text}
                    </button>
                  );
                })}
                {himAt === i && i !== data.paras.length - 1 && <div className="st-here">— {names.him}读到这里 —</div>}
              </div>
            );
          })}
          <nav className="st-chnav">
            {data.ch > 0 ? <button type="button" onClick={() => setCh(data.ch - 1)}>← 上一章</button> : <span />}
            {data.ch < data.toc.length - 1
              ? <button type="button" className="st-black" onClick={() => setCh(data.ch + 1)}>下一章 →</button>
              : <button type="button" className="st-black" onClick={() => api(`/api/books/${id}/progress`, { method: 'POST', body: { ch: data.ch, para: data.paras.length - 1, done: true } }).then(() => say('读完了。去书架上看看你们留下的批注吧'))}>读完了</button>}
          </nav>
        </article>
      )}

      {book && (
        <footer className="st-rfoot">
          <Progress me={book.progress.me} him={book.progress.him} meI={meI} himI={himI} />
          <div className="st-row"><span>{roman(data.ch + 1)} · {Math.round(book.progress.me.pct)}%</span>
            <span>批注 {roots.filter((m) => m.text).length}　·　生词 {roots.filter((m) => m.kind === 'word').length}</span></div>
        </footer>
      )}

      {pick && (
        <div className={`st-menu ${pick.below ? 'below' : ''}`} style={{ top: pick.top }} onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={line}>{myLine ? '擦掉' : '划线'}</button>
          <button type="button" onClick={() => { setThread({ mode: 'note', para: pick.para, quote: pick.text, key: Date.now() }); setPick(null); }}>批注</button>
          <button type="button" onClick={() => { setThread({ mode: 'word', para: pick.para, quote: pick.text, key: Date.now() }); setPick(null); }}>生词</button>
          <button type="button" className="ask" onClick={() => { setThread({ mode: 'ask', para: pick.para, quote: pick.text, key: Date.now() }); setPick(null); }}>问他</button>
        </div>
      )}

      {thread && (
        <Thread key={thread.key} t={thread} names={names} nameOf={nameOf} book={book} data={data}
          replies={thread.root ? replies(thread.root.id) : []} addMark={addMark} say={say}
          reload={() => load(data.ch)} onClose={() => setThread(null)} setThread={setThread}
          onDelete={async (m) => { await api(`/api/books/marks/${m.id}`, { method: 'DELETE' }); await load(data.ch); if (!m.parent) setThread(null); }} />
      )}

      {toc && (
        <Panel onClose={() => setToc(false)} label="目录">
          <div className="st-pad st-toc">
            <div className="st-eyebrow">Contents</div>
            {data?.toc?.map((t, i) => (
              <button key={i} type="button" className={i === data.ch ? 'on' : ''} onClick={() => { setToc(false); setCh(i); }}>
                <span>{t}</span>
                {book.progress.me.ch === i && <i className="her">{meI}</i>}
                {book.progress.him.started && book.progress.him.ch === i && <i className="him">{himI}</i>}
              </button>
            ))}
          </div>
        </Panel>
      )}
      {toast && <div className="st-toast">{toast}</div>}
    </main>
  );
}

function Thread({ t, names, nameOf, book, data, replies, addMark, say, reload, onClose, setThread, onDelete }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [word, setWord] = useState('');
  const [meaning, setMeaning] = useState('');
  const root = t.root;
  const quote = root?.quote || t.quote;
  const words = useMemo(() => [...new Set((quote.match(/[A-Za-z][A-Za-z'’-]{2,}/g) || []).map((w) => w.replace(/[’']s$/, '')))].slice(0, 24), [quote]);
  const himReplied = root && replies.some((m) => m.by === 'him');

  // 问了他：等他回（聊天那边回完，回答会抄到页边）
  useEffect(() => {
    if (!waiting || himReplied) { if (himReplied) setWaiting(false); return undefined; }
    const started = Date.now();
    const timer = setInterval(() => { if (Date.now() - started > 180000) { setWaiting(false); clearInterval(timer); } else reload().then((d) => {
      const fresh = d.marks.find((m) => m.id === root?.id);
      if (fresh) setThread((x) => ({ ...x, mode: 'view', root: fresh }));
    }); }, 4000);
    return () => clearInterval(timer);
  }, [waiting, himReplied, reload, root?.id, setThread]);

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      if (t.mode === 'view') {
        await addMark({ parent: root.id, text: body });
        setText('');
        await reload();
      } else {
        const mark = await addMark({ para: t.para, quote, kind: t.mode === 'ask' ? 'ask' : 'note', text: body });
        setText('');
        if (t.mode === 'ask') {
          setThread((x) => ({ ...x, mode: 'view', root: mark }));
          setWaiting(true);
          await api('/api/books/ask', { method: 'POST', body: { text: `📖《${book.title}》${data.title}\n「${quote}」\n${body}` } });
        } else setThread((x) => ({ ...x, mode: 'view', root: mark }));
      }
    } catch (e) { say(e?.message || '没寄出去，再试一次'); setWaiting(false); } finally { setBusy(false); }
  };
  const saveWord = async () => {
    const w = word.trim();
    if (!w || busy) return;
    setBusy(true);
    try {
      await api('/api/vocab', { method: 'POST', body: { words: [{ word: w, meaning: meaning.trim(), note: `${quote.slice(0, 150)}（《${book.title}》）` }] } });
      await addMark({ para: t.para, quote: w, kind: 'word' }).catch(() => null);
      say(`「${w}」收进单词本了`);
      onClose();
    } catch (e) { say(e?.message || '没收进去'); } finally { setBusy(false); }
  };
  const letters = root ? [root, ...replies] : [];
  return (
    <Panel onClose={onClose} label="批注">
      <div className="st-pad">
        <div className="st-q">{quoted(quote)}</div>
        <div className="st-qm">{data.title}</div>
        {t.mode === 'word' ? (
          <>
            {words.length > 0 && <div className="st-words">{words.map((w) => <button key={w} type="button" className={w === word ? 'on' : ''} onClick={() => setWord(w)}>{w}</button>)}</div>}
            <input className="st-in" value={word} onChange={(e) => setWord(e.target.value)} placeholder="生词" />
            <input className="st-in" value={meaning} onChange={(e) => setMeaning(e.target.value)} placeholder="意思（可以先空着）" />
            <div className="st-reply"><span>会连这句话一起收进单词本</span><button type="button" onClick={saveWord} disabled={!word.trim() || busy}>收下</button></div>
          </>
        ) : (
          <>
            {letters.map((m) => (
              <div key={m.id} className={`st-letter ${m.by}`}>
                <div className="st-who"><span>{m.by === 'him' ? names.him : names.me}{m.kind === 'ask' ? ' · 问' : ''}</span>
                  <span>{when(m.at)}{m.by === 'me' && <button type="button" onClick={() => onDelete(m)}>删掉</button>}</span></div>
                <p>{m.text || (m.kind === 'line' ? '（划了线）' : '')}</p>
              </div>
            ))}
            {waiting && !himReplied && <div className="st-letter him"><div className="st-who"><span>{names.him}</span><span>在想</span></div><div className="st-dots"><i /><i /><i /></div></div>}
            <div className="st-reply">
              <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) send(); }}
                placeholder={t.mode === 'ask' ? `问${names.him}…` : '写在页边…'} autoFocus={t.mode !== 'view'} />
              <button type="button" onClick={send} disabled={!text.trim() || busy}>{t.mode === 'ask' ? '问他' : '寄出'}</button>
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}

export default function Study() {
  const { path, query } = useRoute();
  if (path === '/study/read' && query.id) return <Reader key={query.id} id={query.id} chParam={query.ch} paraParam={query.para} />;
  return <Shelf />;
}
