/** 小屋的各块：此刻、一起入口、照片墙、独处、表情包、看一张照片 */
import { useRef, useState } from 'react';
import Icon from '../../design/icons.jsx';
import { Torn, Tape, Cyanotype, Vinyl } from '../../design/paper.jsx';
import Sheet from '../../design/Sheet.jsx';
import { Sticker } from '../chat/stickers.jsx';
import { api } from '../../lib/api.js';
import { hm } from '../../lib/chat.js';

/* ---------- 此刻：他现在在做什么 ---------- */
export function NowCard({ current, now }) {
  if (!current) return null;
  const mins = Math.max(0, Math.round((now - new Date(current.since)) / 60000));
  return (
    <div className="rm-now-wrap">
      <Torn w={342} h={120} seed={101} className="rm-now" style={{ rotate: '-0.8deg' }}>
        <div className="rm-window" aria-hidden="true">
          <Cyanotype w={96} h={96} seed={8} variant="sprig" develop={false} />
          <svg width="96" height="96"><g stroke="var(--sheet)" strokeWidth="3" fill="none"><rect x="1.5" y="1.5" width="93" height="93" /><path d="M48 0V96M0 48H96" /></g></svg>
        </div>
        <div className="rm-now-t">
          <div className="kicker">NOW · 此刻</div>
          <div className="rm-now-a">{current.activity}</div>
          {current.line && <div className="hand-cn rm-now-l">{current.line}</div>}
          <div className="rm-now-s">{hm(current.since)} 起 · 已经 {mins < 60 ? `${mins} 分钟` : `${Math.floor(mins / 60)} 小时`}</div>
        </div>
      </Torn>
      <Tape w={64} h={20} seed={102} style={{ right: 52, top: -8, rotate: '5deg' }} />
    </div>
  );
}

/* ---------- 一起入口 ---------- */
export function TogetherRow({ listen, watch }) {
  const d = watch ? new Date(watch.at) : null;
  return (
    <div className="rm-tg">
      {listen && (
        <a href="#/together" className="card rm-tg-c">
          <Vinyl size={38} spinning={listen.playing} />
          <span className="rm-tg-t"><span className="kicker">一起听</span><b className="serif">{listen.title}</b></span>
          <span className="rm-tg-p"><Icon name={listen.playing ? 'pause' : 'play'} size={12} stroke={1.6} /></span>
        </a>
      )}
      {watch && (
        <a href="#/together?tab=watch" className="card rm-tg-c rm-tg-w">
          <span className="rm-tg-t"><span className="kicker">一起看 · 周{'日一二三四五六'[d.getDay()]} {hm(watch.at)}</span><b>《{watch.title}》</b></span>
        </a>
      )}
    </div>
  );
}

/* ---------- 照片墙 ---------- */
const FILTERS = [['', '全部'], ['him', '他贴的'], ['me', '我贴的'], ['chat', '聊天里的'], ['fav', '♡ 收藏']];
export function PhotoWall({ data, filter, setFilter, onOpen, names }) {
  return (
    <>
      <div className="rm-filter" role="group" aria-label="筛选照片">
        {FILTERS.map(([k, n], i) => (
          <span key={k}>{i > 0 && <i aria-hidden="true">·</i>}<button type="button" className={filter === k ? 'on' : ''} aria-pressed={filter === k} onClick={() => setFilter(k)}>{n}</button></span>
        ))}
      </div>
      {!data && <div className="card rm-empty">正在翻照片…</div>}
      {data?.available === false && <div className="card rm-empty">暂时连不上，过一会儿再来看看。</div>}
      {data?.items?.length === 0 && <div className="card rm-empty">这里还没有照片</div>}
      <div className="rm-wall">
        {data?.items?.map((p, i) => (
          <button key={p.id} type="button" className="rm-pol drop" style={{ rotate: `${[-3, 2.5, 1.6, -2, -1, 2][i % 6]}deg` }} onClick={() => onOpen(p)} aria-label={`看照片：${p.caption || '没有说明'}`}>
            <Tape w={50} h={16} seed={i + 7} style={{ left: 'calc(50% - 25px)', top: -7, rotate: `${i % 2 ? 5 : -6}deg` }} />
            <span className="rm-pol-img">{p.url ? <img src={p.thumb || p.url} alt="" loading="lazy" /> : <Cyanotype w={144} h={128} seed={11 + i * 12} variant={i % 2 ? 'fern' : 'sprig'} />}</span>
            <span className="rm-pol-cap"><span className="hand-cn">{p.caption}</span><em>{p.from === 'him' ? '他贴的' : '我贴的'}</em></span>
            {p.fav && <span className="rm-pol-fav" aria-label="收藏了"><Icon name="heart" size={12} stroke={1.6} /></span>}
          </button>
        ))}
      </div>
    </>
  );
}

/* ---------- 看一张照片 ---------- */
export function PhotoView({ photo, names, onClose, onChange, onDelete }) {
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const fav = async () => { onChange({ ...photo, fav: !photo.fav }); api(`/api/room/photos/${photo.id}/fav`, { method: 'POST' }).catch(() => onChange(photo)); };
  const note = async () => {
    const t = text.trim(); if (!t) return;
    try {
      const n = await api(`/api/room/photos/${photo.id}/notes`, { method: 'POST', body: { text: t } });
      onChange({ ...photo, notes: [...(photo.notes || []), n] }); setText(''); setWriting(false); setError('');
    } catch (e) { setError(e?.message || '保存失败'); }
  };
  const del = async () => {
    if (!confirm('删掉这张照片？')) return;
    try { await api(`/api/room/photos/${photo.id}`, { method: 'DELETE' }); onDelete(photo.id); }
    catch (e) { setError(e?.message || '删除失败'); }
  };
  const d = new Date(photo.at);
  return (
    <div className="rm-view" role="dialog" aria-label="看照片">
      <button type="button" className="rm-view-mask" aria-label="关闭" onClick={onClose} />
      <div className="rm-view-in">
        <div className="rm-big drop2 m-settle">
          <span className="rm-big-img">{photo.url ? <img src={photo.url} alt="" /> : <Cyanotype w={296} h={296} seed={31} />}</span>
          <div className="hand-cn rm-big-cap">{photo.caption}</div>
          <div className="rm-big-meta">{photo.from === 'him' ? '他贴的' : '我贴的'} · {d.getMonth() + 1}月{d.getDate()}日{photo.source === 'chat' ? ' · 来自聊天' : ''}</div>
        </div>
        {(photo.notes || []).map((n, i) => (
          <div key={i} className="rm-note m-settle"><p>{n.text}</p><span className="hand">— {n.from === 'him' ? names?.him : names?.me}</span></div>
        ))}
        <div className="rm-acts">
          <button type="button" onClick={fav} aria-pressed={!!photo.fav}><span><Icon name="heart" size={20} stroke={1.4} /></span>{photo.fav ? '已收藏' : '收藏'}</button>
          <button type="button" onClick={() => setWriting(true)}><span><Icon name="pen" size={20} stroke={1.4} /></span>写一句</button>
          <button type="button" onClick={del}><span><Icon name="trash" size={20} stroke={1.4} /></span>删掉</button>
        </div>
        {error && <div className="ws-err" role="alert">{error}</div>}
      </div>
      <button type="button" className="rbtn rm-view-x" aria-label="关闭" onClick={onClose}><Icon name="close" size={16} stroke={1.5} /></button>
      <Sheet open={writing} onClose={() => setWriting(false)} label="给这张照片写一句">
        <div className="sec-head"><span className="en">a line</span><h2 className="zh" style={{ margin: 0 }}>写一句</h2></div>
        <label className="pill rm-in"><span className="sr">写一句</span><input autoFocus value={text} maxLength={100} onChange={(e) => setText(e.target.value)} placeholder="关于这张照片…" /></label>
        <button type="button" className="btn-main rm-go" disabled={!text.trim()} onClick={note}>贴在下面</button>
      </Sheet>
    </div>
  );
}

/* ---------- 独处 ---------- */
export function Solo({ data, now }) {
  if (!data) return <div className="card rm-empty">正在翻…</div>;
  if (data.available === false) return <div className="card rm-empty">暂时连不上，过一会儿再来看看。</div>;
  if (!data.items.length) return <div className="card rm-empty">他还没有自己待过</div>;
  const groups = [];
  for (const it of data.items) {
    const d = new Date(it.at);
    const key = d.toDateString();
    if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, d, items: [] });
    groups[groups.length - 1].items.push(it);
  }
  const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const today = new Date(now).toDateString();
  return groups.map((g) => (
    <section key={g.key} className="rm-day">
      <h3 className="rm-day-h"><span className="serif">{MON[g.d.getMonth()]} · {String(g.d.getDate()).padStart(2, '0')}</span>{g.key === today && <span className="hand">today</span>}</h3>
      <ol className="rm-line">
        {g.items.map((it) => (
          <li key={it.id}>
            <span className="serif rm-t">{hm(it.at)}</span>
            <div className="card rm-entry">
              <b>{it.title}</b>
              {it.text && <p>{it.text}</p>}
              {it.quote && <blockquote className="hand-cn">{it.quote}</blockquote>}
              {it.thought && <div className="rm-thought"><span>想到的</span>{it.thought}</div>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  ));
}

/* ---------- 表情包 ---------- */
export function Stickers({ data, setData, onUpload }) {
  const [drawing, setDrawing] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [tip, setTip] = useState('');
  const fileIn = useRef(null);
  const press = useRef(null);
  const flash = (t) => { setTip(t); setTimeout(() => setTip(''), 1800); };
  if (!data) return <div className="card rm-empty">正在翻…</div>;
  if (data.available === false) return <div className="card rm-empty">暂时连不上，过一会儿再来看看。</div>;

  const add = async (f) => {
    if (!f) return;
    try {
      const u = await onUpload(f, 'sticker');
      const st = await api('/api/stickers', { method: 'POST', body: { url: u.url } });
      setData((d) => ({ ...d, mine: [...d.mine, st] }));
    } catch (error) { flash(error?.message || '上传失败'); }
  };
  const del = async (st) => {
    if (!confirm('删掉这个表情？')) return;
    try {
      await api(`/api/stickers/${st.id}`, { method: 'DELETE' });
      setData((d) => ({ ...d, mine: d.mine.filter((x) => x.id !== st.id) }));
    } catch (error) { flash(error?.message || '删除失败'); }
  };
  const ask = async () => {
    try {
      await api('/api/stickers/draw', { method: 'POST', body: { prompt: prompt.trim() } });
      setDrawing(false); setPrompt(''); flash('他收到了，画好会放在这里');
    } catch (error) { flash(error?.message || '暂时不能画表情'); }
  };
  const longPress = (st) => ({
    onPointerDown: () => { press.current = setTimeout(() => del(st), 520); },
    onPointerUp: () => clearTimeout(press.current), onPointerLeave: () => clearTimeout(press.current),
    onContextMenu: (e) => { e.preventDefault(); del(st); },
  });

  return (
    <>
      <div className="sec-head"><span className="en" style={{ fontSize: 24 }}>by him</span><h3 className="zh" style={{ margin: 0, fontSize: 14 }}>他画的</h3><span className="go">{data.his.length} 个</span></div>
      <div className="rm-stk">
        {data.his.map((s) => <span key={s.id} className="card rm-stk-c" title={s.prompt || s.name}><Sticker sticker={s} size={58} /></span>)}
        <button type="button" className="rm-stk-ask" onClick={() => setDrawing(true)}><Icon name="pen" size={15} stroke={1.5} />让他画一张</button>
      </div>
      <div className="sec-head" style={{ marginTop: 26 }}><span className="en" style={{ fontSize: 24 }}>mine</span><h3 className="zh" style={{ margin: 0, fontSize: 14 }}>我的</h3><span className="go">长按删除</span></div>
      <div className="rm-stk">
        {data.mine.map((s) => <button key={s.id} type="button" className="card rm-stk-c" aria-label={`表情${s.name ? `：${s.name}` : ''}，长按删除`} {...longPress(s)}><Sticker sticker={s} size={58} /></button>)}
        <button type="button" className="rm-stk-add" aria-label="上传表情" onClick={() => fileIn.current.click()}><Icon name="plus" size={22} stroke={1.4} /></button>
      </div>
      <input ref={fileIn} type="file" accept="image/*" hidden onChange={(e) => { add(e.target.files[0]); e.target.value = ''; }} />
      {tip && <div className="rm-tip" role="status">{tip}</div>}
      <Sheet open={drawing} onClose={() => setDrawing(false)} label="让他画一张表情">
        <div className="sec-head"><span className="en">draw me</span><h2 className="zh" style={{ margin: 0 }}>让他画一张</h2></div>
        <label className="pill rm-in"><span className="sr">想要什么样子</span><input autoFocus value={prompt} maxLength={100} onChange={(e) => setPrompt(e.target.value)} placeholder="比如：抱着枕头的猫" /></label>
        <button type="button" className="btn-main rm-go" disabled={!prompt.trim()} onClick={ask}>交给他</button>
      </Sheet>
    </>
  );
}
