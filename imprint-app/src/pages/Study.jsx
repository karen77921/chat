/**
 * 书房（共读）：书架 → 读书页。她和他各有一枚书签；划线、批注、生词、问他都挂在某一句话上。
 * 入口：一起 → 一起读（#/together?tab=read，书架嵌在里面）；#/study 是单独的书架页
 * 网址：#/study（书架）、#/study/read?id=…&ch=…（读书）
 * 数据：GET /api/books、GET /api/books/:id/ch/:n、POST /api/books/:id/progress|mark|update、
 *       DELETE /api/books/:id、DELETE /api/books/marks/:id、POST /api/books/import|gutenberg/:n|ask
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRoute } from '../lib/router.js';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/useLoad.js';
import '../components/study/study.css';
import Companion from '../components/study/Companion.jsx';

const CLASSICS = [
  [1342, 'Pride and Prejudice', 'Jane Austen'], [1260, 'Jane Eyre', 'Charlotte Brontë'],
  [158, 'Emma', 'Jane Austen'], [514, 'Little Women', 'Louisa May Alcott'],
];
const SIZES = [15.5, 17, 18.5, 20];

const go = (hash) => { location.hash = hash; };
const SHELF = '#/together?tab=read';
const FROM_SHELF = 'st-from-shelf';
// 从书架点进书时记一笔；退出时退回书架那条历史记录，而不是再压一条「一起读」进去——
// 否则「一起」页的返回（history.back）会把人又送回书里，怎么都退不出去
const openBook = (hash) => { try { sessionStorage.setItem(FROM_SHELF, '1'); } catch { /* 无痕模式 */ } go(hash); };
function leaveTo(e) {
  e?.preventDefault();
  let fromShelf = false;
  try { fromShelf = sessionStorage.getItem(FROM_SHELF) === '1'; sessionStorage.removeItem(FROM_SHELF); } catch { /* 无痕模式 */ }
  if (fromShelf && history.length > 1) history.back();
  else location.replace(SHELF);
}
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

export function Shelf({ embedded = false }) {
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
    <main className={`st st-shelf ${embedded ? 'embedded' : ''}`}>
      {embedded ? (
        <header className="st-head"><div><div className="st-eyebrow">The Study</div></div>
          <button type="button" className="st-ghost" onClick={() => setSheet('import')}>导入</button></header>
      ) : (
        <header className="st-head">
          <a href={SHELF} className="st-back" aria-label="返回" onClick={(e) => { e.preventDefault(); location.replace(SHELF); }}>‹</a>
          <div><div className="st-eyebrow">The Study</div><h1>书房</h1></div>
          <button type="button" className="st-ghost" onClick={() => setSheet('import')}>导入</button>
        </header>
      )}

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
            <button type="button" className="st-hero" onClick={() => openBook(`#/study/read?id=${cur.id}`)} aria-label={`读《${cur.title}》`}>
              <Cover book={cur} />
              <i className="st-ribbon her" /><i className="st-ribbon him" />
            </button>
            {rest.slice(0, 3).map((b, i) => (
              <div key={b.id} className="st-stand" style={{ left: 196 + i * 27 }}>
                <Spine book={b} {...spineSize(b, 186)} w={20 + (hash(b.id) % 6)} onClick={() => openBook(`#/study/read?id=${b.id}`)} />
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
              <button type="button" className="st-black" onClick={() => openBook(`#/study/read?id=${cur.id}`)}>{me.started ? '继续阅读' : '开始读'}</button>
            </div>
          </section>

          <div className="st-label"><h3>书架</h3><span>{books.length} {books.length === 1 ? 'volume' : 'volumes'}</span></div>
          {rows.map((row, ri) => (
            <div key={ri} className="st-shelfrow">
              <div className="st-spines">
                {row.map((b) => <Spine key={b.id} book={b} {...spineSize(b)} onClick={() => openBook(`#/study/read?id=${b.id}`)} />)}
                {ri === rows.length - 1 && <button type="button" className="st-add" onClick={() => setSheet('import')} aria-label="导入">＋</button>}
              </div>
              <div className="st-ledge" />
            </div>
          ))}

          {(data.recent || []).filter((n, i, all) => all.findIndex((x) => x.book === n.book && x.quote === n.quote) === i).slice(0, 2).map((n) => (
            <button key={n.id} type="button" className={`st-quote ${n.by}`} onClick={() => openBook(`#/study/read?id=${n.book}&ch=${n.ch}&para=${n.para}`)}>
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
  try { return { size: 1, night: false, mode: 'page', ...JSON.parse(localStorage.getItem('imprint.study') || '{}') }; } catch { return { size: 1, night: false, mode: 'page' }; }
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
  const [company, setCompany] = useState(false);
  const [toc, setToc] = useState(false);
  const [pick, setPick] = useState(null); // { para, si, text, top, left }
  const [thread, setThread] = useState(null); // { mode:'view'|'note'|'ask'|'word', root?, para, quote }
  const [toast, setToast] = useState('');
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const [slide, setSlide] = useState(false); // 换章、改字号时不要动画
  const [flip, setFlip] = useState(null); // 仿真翻页：{ dir, show: 正在翻的那一页, angle, anim }
  const flipping = useRef(false);
  const ready = useRef(false);
  const lastSaved = useRef('');
  const target = useRef(paraParam != null ? Number(paraParam) : null);
  const vp = useRef(null), cols = useRef(null);
  const anchor = useRef(0);
  const touch = useRef(null);
  // 这一章真排不了左右翻页时临时上下滑；只管这一章，不改她存的设置
  const [fallback, setFallback] = useState(false);
  const paged = prefs.mode !== 'scroll' && !fallback;

  const say = (t) => { setToast(t); setTimeout(() => setToast(''), 2200); };
  const load = useCallback((which) => api(`/api/books/${id}/ch/${which}`).then((d) => { setData(d); return d; }), [id]);

  // —— 翻页模式：一章排成横向的很多栏，一栏一页 ——
  const stride = () => vp.current?.clientWidth || window.innerWidth;
  const span = (el) => {
    const rects = el?.getClientRects();
    if (!rects?.length || !cols.current) return [0, 0];
    const base = cols.current.getBoundingClientRect().left, w = stride();
    return [Math.floor((rects[0].left - base + 2) / w), Math.floor((rects[rects.length - 1].left - base + 2) / w)];
  };
  const paraEls = () => [...(cols.current?.querySelectorAll('[data-i]') || [])];
  const pageOfPara = (i) => span(cols.current?.querySelector(`[data-i="${i}"]`))[0];
  const paraOfPage = (p) => { const el = paraEls().find((e) => span(e)[1] >= p); return el ? Number(el.dataset.i) : 0; };
  // 一共几页：两种量法取大的（iPhone 的 Safari 有时量不准最后一段在哪一栏）
  const measure = () => {
    const el = cols.current, w = stride();
    const last = el?.lastElementChild;
    const bySpan = last ? span(last)[1] + 1 : 1;
    const byWidth = el ? Math.ceil((el.scrollWidth - 2) / w) : 1;
    const n = Math.max(1, bySpan, byWidth);
    setPages(n);
    return n;
  };
  const settle = (para) => {
    if (!paged) {
      const el = para > 0 && document.querySelector(`.st-text [data-i="${para}"]`);
      if (el) el.scrollIntoView({ block: 'start' }); else window.scrollTo(0, 0);
      return;
    }
    setSlide(false);
    const el = cols.current;
    if (el && el.scrollHeight > el.clientHeight + 24) {
      // 这台手机没把一章排成一栏一栏（字被截在底下了）：换成上下滑，至少一个字都不会漏。
      // 刚打开时字体和排版还没稳，量出来常常是错的：等排好（ready）那一次还这样才换，而且只换这一章
      if (!ready.current) return;
      setFallback(true);
      say('这一章排不了左右翻页，先上下滑着读（你的设置没改）');
      return;
    }
    const n = measure();
    const p = para === 'end' ? n - 1 : Math.min(n - 1, Math.max(0, pageOfPara(para)));
    setPage(p);
    anchor.current = para === 'end' ? paraOfPage(p) : para;
  };

  useEffect(() => { api('/api/books').then((d) => d?.names && setNames(d.names)).catch(() => {}); }, []);
  useEffect(() => {
    ready.current = false;
    setData(null); setPick(null); setFallback(false);
    load(ch).then((d) => {
      if (ch < 0) { setCh(d.ch); return; }
      const me = d.book.progress.me;
      const para = target.current != null ? target.current : (me.ch === d.ch ? me.para : 0);
      target.current = null;
      requestAnimationFrame(() => requestAnimationFrame(() => { settle(para); setTimeout(() => { ready.current = true; if (paged) settle(anchor.current); }, 400); }));
    }).catch((e) => setData({ error: e?.message || '打不开这本书' }));
  }, [ch, load]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { localStorage.setItem('imprint.study', JSON.stringify(prefs)); } catch { /* 无痕模式 */ } }, [prefs]);
  // 改字号、换模式、转屏：停在原来那一段
  useEffect(() => {
    if (!data?.paras) return undefined;
    const keep = anchor.current;
    const id2 = requestAnimationFrame(() => settle(keep));
    const on = () => settle(anchor.current);
    addEventListener('resize', on);
    return () => { cancelAnimationFrame(id2); removeEventListener('resize', on); };
  }, [prefs.size, prefs.mode, fallback]); // eslint-disable-line react-hooks/exhaustive-deps

  // 字体晚到、地址栏收起导致页面高度变了：重新排一次页，停在原来那段
  useEffect(() => {
    if (!paged || !data?.paras || !vp.current) return undefined;
    let raf = 0;
    const again = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (ready.current && !flipping.current) settle(anchor.current); }); };
    document.fonts?.ready?.then(again);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(again) : null;
    ro?.observe(vp.current);
    return () => { cancelAnimationFrame(raf); ro?.disconnect(); };
  }, [paged, data?.paras]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveAt = useCallback((para) => {
    if (!ready.current || !data) return;
    const key = `${data.ch}.${para}`;
    if (key === lastSaved.current) return;
    lastSaved.current = key;
    api(`/api/books/${id}/progress`, { method: 'POST', body: { ch: data.ch, para } })
      .then((r) => setData((d) => (d && d.ch === data.ch ? { ...d, book: { ...d.book, progress: r.progress, minutes: r.minutes } } : d))).catch(() => {});
  }, [data, id]);

  // 书签（翻页）：这一页开头那一段
  useEffect(() => {
    if (!paged || !data?.paras) return undefined;
    const timer = setTimeout(() => {
      const para = page >= pages - 1 ? data.paras.length - 1 : paraOfPage(page);
      anchor.current = paraOfPage(page);
      saveAt(para);
    }, 700);
    return () => clearTimeout(timer);
  }, [page, pages, paged, data?.paras, saveAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // 书签（滚动）：顶上第一段看得见的
  useEffect(() => {
    if (paged || !data?.paras) return undefined;
    let timer = 0;
    const save = () => {
      const ps = [...document.querySelectorAll('.st-text [data-i]')];
      const atEnd = window.innerHeight + window.scrollY >= document.body.scrollHeight - 40;
      const top = atEnd ? ps[ps.length - 1] : ps.find((p) => p.getBoundingClientRect().bottom > 90);
      if (!top) return;
      anchor.current = Number(top.dataset.i);
      saveAt(Number(top.dataset.i));
    };
    const on = () => { clearTimeout(timer); timer = setTimeout(save, 1200); setPick(null); };
    addEventListener('scroll', on, { passive: true });
    return () => { removeEventListener('scroll', on); clearTimeout(timer); };
  }, [paged, data?.paras, saveAt]);

  // —— 仿真翻页：翻起来的那一页绕着书脊转过去，底下露出下一页 ——
  const FLIP_MS = 430, FLAT = 0, GONE = -92;
  const twoFrames = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));
  const finish = (angle, after) => {
    setFlip((f) => f && { ...f, angle, anim: true });
    setTimeout(() => { after?.(); setFlip(null); flipping.current = false; }, FLIP_MS + 30);
  };
  const startFlip = (dir) => {
    if (dir > 0) { setFlip({ dir, show: page, angle: FLAT, anim: false }); setPage(page + 1); } else setFlip({ dir, show: page - 1, angle: GONE, anim: false });
    setSlide(false);
    flipping.current = true;
  };
  const flipTo = (dir) => {
    const to = page + dir;
    startFlip(dir);
    twoFrames(() => finish(dir > 0 ? GONE : FLAT, dir < 0 ? () => setPage(to) : null));
  };
  const turn = (dir) => {
    setPick(null);
    if (!data?.paras || flipping.current) return;
    if (dir > 0) {
      if (page < pages - 1) flipTo(1); else if (data.ch < data.toc.length - 1) { target.current = 0; setCh(data.ch + 1); } else say('这本读完啦');
    } else if (page > 0) flipTo(-1); else if (data.ch > 0) { target.current = 'end'; setCh(data.ch - 1); }
  };
  const jump = (i) => { target.current = 0; setToc(false); if (i === data?.ch) settle(0); else setCh(i); };
  useEffect(() => {
    if (!paged) return undefined;
    const on = (e) => { if (e.key === 'ArrowRight') turn(1); if (e.key === 'ArrowLeft') turn(-1); };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  });
  // 手指拖着翻：页跟着手走，松手过了四分之一就翻过去，不然弹回来
  const onTouchStart = (e) => {
    if (flipping.current && !touch.current) return;
    const p = e.touches[0];
    touch.current = { x: p.clientX, y: p.clientY, t: Date.now(), mode: '', from: page };
  };
  const onTouchMove = (e) => {
    const s = touch.current;
    if (!s) return;
    const p = e.touches[0], dx = p.clientX - s.x, dy = p.clientY - s.y;
    if (!s.mode) {
      if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      s.dir = dx < 0 ? 1 : -1;
      s.mode = (s.dir > 0 ? page < pages - 1 : page > 0) ? 'flip' : 'chapter';
      if (s.mode === 'flip') { setPick(null); startFlip(s.dir); }
    }
    if (s.mode === 'flip') {
      const prog = Math.max(0, Math.min(1, (s.dir > 0 ? -dx : dx) / (stride() * 0.75)));
      setFlip((f) => f && { ...f, angle: s.dir > 0 ? GONE * prog : GONE * (1 - prog), anim: false });
    }
  };
  const onTouchEnd = (e) => {
    const s = touch.current; touch.current = null;
    if (!s?.mode) return;
    const dx = e.changedTouches[0].clientX - s.x;
    if (s.mode === 'chapter') { if (Math.abs(dx) > 40) turn(s.dir); return; }
    const prog = Math.abs(dx) / (stride() * 0.75), fast = Math.abs(dx) / Math.max(1, Date.now() - s.t) > 0.45;
    const done = (s.dir > 0 ? dx < 0 : dx > 0) && (prog > 0.22 || (fast && prog > 0.05));
    if (s.dir > 0) finish(done ? GONE : FLAT, done ? null : () => setPage(s.from));
    else finish(done ? FLAT : GONE, done ? () => setPage(s.from - 1) : null);
  };
  // 点书页左右两边翻页（中间点句子）
  const onEdgeTap = (e) => {
    if (!paged || e.target.closest('button')) return;
    const r = vp.current.getBoundingClientRect(), x = e.clientX - r.left;
    const dir = x < r.width * 0.24 ? -1 : x > r.width * 0.76 ? 1 : 0;
    if (!dir) return;
    e.stopPropagation(); e.preventDefault();
    turn(dir);
  };

  if (data?.error) return <main className="st st-reader"><p className="st-quiet">{data.error}　<a href={SHELF} onClick={leaveTo}>回书架</a></p></main>;
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

  const articleBody = data?.paras ? (
        <>
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
            {data.ch > 0 ? <button type="button" onClick={() => jump(data.ch - 1)}>← 上一章</button> : <span />}
            {data.ch < data.toc.length - 1
              ? <button type="button" className="st-black" onClick={() => jump(data.ch + 1)}>下一章 →</button>
              : <button type="button" className="st-black" onClick={() => api(`/api/books/${id}/progress`, { method: 'POST', body: { ch: data.ch, para: data.paras.length - 1, done: true } }).then(() => say('读完了。去书架上看看你们留下的批注吧'))}>读完了</button>}
          </nav>
        </>
  ) : null;

  return (
    <main className={`st st-reader ${prefs.night ? 'night' : ''} ${paged ? 'paged' : ''}`} style={{ '--fs': `${SIZES[prefs.size]}px` }} onClick={() => { setPick(null); setAa(false); }}>
      <header className="st-rbar">
        <a href={SHELF} className="st-x" aria-label="回书架" onClick={leaveTo}>×</a>
        <button type="button" className="st-c" onClick={(e) => { e.stopPropagation(); setToc(true); }}>{book?.title || ''}</button>
        <button type="button" className="st-tocb" onClick={(e) => { e.stopPropagation(); setToc(true); }} aria-label="目录">目录</button>
        <button type="button" className="st-tocb st-cob" onClick={(e) => { e.stopPropagation(); setCompany((v) => !v); }} aria-pressed={company}>陪读</button>
        <button type="button" className="st-aa" onClick={(e) => { e.stopPropagation(); setAa((v) => !v); }}>Aa</button>
      </header>
      {company && data?.paras && (
        <Companion him={names.him} onClose={() => setCompany(false)}
          page={() => ({ book: data.book.title, chapter: data.title, text: data.paras.slice(Math.max(0, anchor.current), anchor.current + 5).join('\n') })} />
      )}
      {aa && (
        <div className="st-aa-pop" onClick={(e) => e.stopPropagation()}>
          <div className="st-aa-row"><span>字号</span>
            <button type="button" disabled={prefs.size === 0} onClick={() => setPrefs((p) => ({ ...p, size: p.size - 1 }))}>A−</button>
            <button type="button" disabled={prefs.size === SIZES.length - 1} onClick={() => setPrefs((p) => ({ ...p, size: p.size + 1 }))}>A+</button></div>
          <div className="st-aa-row"><span>翻书</span>
            <button type="button" className={paged ? 'on' : ''} onClick={() => { setFallback(false); setPrefs((p) => ({ ...p, mode: 'page' })); }}>左右翻</button>
            <button type="button" className={!paged ? 'on' : ''} onClick={() => setPrefs((p) => ({ ...p, mode: 'scroll' }))}>上下滑</button></div>
          <div className="st-aa-row"><span>夜读</span><button type="button" className={prefs.night ? 'on' : ''} onClick={() => setPrefs((p) => ({ ...p, night: !p.night }))}>{prefs.night ? '开' : '关'}</button></div>
          <button type="button" className="st-aa-toc" onClick={() => { setAa(false); setToc(true); }}>目录 · {data?.toc?.length || 0} 章</button>
        </div>
      )}

      {!data && <p className="st-quiet">翻开中…</p>}
      {data?.paras && (
        <div className={paged ? 'st-vp' : ''} ref={vp} onClickCapture={onEdgeTap}
          onTouchStart={paged ? onTouchStart : undefined} onTouchMove={paged ? onTouchMove : undefined} onTouchEnd={paged ? onTouchEnd : undefined}>
        <article className={`st-text ${slide ? 'slide' : ''}`} ref={cols} style={paged ? { transform: `translateX(${-page * stride()}px)`, columnWidth: `${stride() - 60}px`, columnGap: '60px' } : undefined}>
          {articleBody}
        </article>
        {paged && flip && (
          <div className={`st-flip ${flip.anim ? 'anim' : ''}`} style={{ '--a': `${flip.angle}deg`, '--p': Math.min(1, Math.abs(flip.angle) / 90) }} aria-hidden="true">
            <article className="st-text" style={{ transform: `translateX(${-flip.show * stride()}px)`, columnWidth: `${stride() - 60}px`, columnGap: '60px' }}>{articleBody}</article>
            <i className="st-flip-shade" />
          </div>
        )}
        </div>
      )}

      {book && (
        <footer className="st-rfoot">
          <Progress me={book.progress.me} him={book.progress.him} meI={meI} himI={himI} />
          <div className="st-row">
            <button type="button" className="st-fch" onClick={(e) => { e.stopPropagation(); setToc(true); }}>{roman(data.ch + 1)} · {Math.round(book.progress.me.pct)}%</button>
            {paged ? (
              <span className="st-turn">
                <button type="button" aria-label="上一页" onClick={(e) => { e.stopPropagation(); turn(-1); }}>‹</button>
                <em>{page + 1} / {pages}</em>
                <button type="button" aria-label="下一页" onClick={(e) => { e.stopPropagation(); turn(1); }}>›</button>
              </span>
            ) : <span>批注 {roots.filter((m) => m.text).length}　·　生词 {roots.filter((m) => m.kind === 'word').length}</span>}
          </div>
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
              <button key={i} type="button" className={i === data.ch ? 'on' : ''} onClick={() => jump(i)} ref={i === data.ch ? (el) => el?.scrollIntoView({ block: 'center' }) : undefined}>
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
