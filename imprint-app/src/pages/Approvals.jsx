/**
 * 买买申请：她交申请（想要什么、多少钱、为什么），他自己审批，盖章、写回应，每一步都进审批轨迹。
 * 网址：#/approvals   ?id=xxx 看某一张
 * 数据：GET /api/purchases、POST /api/purchases、POST /api/purchases/:id/withdraw|review
 */
import { useEffect, useState } from 'react';
import Icon from '../design/icons.jsx';
import Sheet from '../design/Sheet.jsx';
import AuthImg from '../design/AuthImg.jsx';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/useLoad.js';
import { ago } from '../lib/home.js';
import '../components/approvals/approvals.css';

const CATEGORIES = ['想买的东西', '想吃的', '想玩的', '其他'];
const STAMP = { pending: ['审批中', 'wait'], approved: ['通过', 'ok'], rejected: ['不通过', 'no'], withdrawn: ['已撤回', 'off'] };
const STEP = { submit: '发起申请', approve: '通过', reject: '暂不通过', withdraw: '撤回申请' };
const BANNER = {
  pending: '他正在看你的申请，稍等一下。',
  approved: '这张申请通过啦，去买吧。',
  rejected: '这张申请暂时没有通过，意见也值得被好好收下。',
  withdrawn: '你撤回了这张申请。',
};
const FILTERS = [['', '全部'], ['pending', '审批中'], ['approved', '通过'], ['rejected', '不通过']];
const money = (n) => `¥${Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;

function Face({ src, name }) {
  return <span className="ap-face">{src ? <AuthImg src={src} alt="" /> : <span>{name?.[0] || '·'}</span>}</span>;
}

function Stamp({ status }) {
  const [text, tone] = STAMP[status] || STAMP.pending;
  return <span className={`ap-stamp ${tone}`}>{text}</span>;
}

export default function Approvals({ query }) {
  const { data, setData, reload } = useLoad('/api/purchases');
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const items = data?.items || [];
  const open = query.id ? items.find((x) => x.id === query.id) : null;
  const waiting = items.some((x) => x.status === 'pending');
  const now = new Date();

  // 有申请在审时，每几秒看一眼他审完没有
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setInterval(reload, 4000);
    return () => clearInterval(timer);
  }, [waiting, reload]);

  const go = (id) => { location.hash = id ? `#/approvals?id=${encodeURIComponent(id)}` : '#/approvals'; window.scrollTo(0, 0); };
  const submit = async () => {
    setBusy('submit'); setNote('');
    try {
      const item = await api('/api/purchases', { method: 'POST', body: { ...form, price: Number(form.price) } });
      setData((d) => ({ ...d, items: [item, ...(d?.items || [])] }));
      setForm(null); go(item.id);
    } catch (e) { setNote(e?.message || '没交上，再试一次'); }
    setBusy('');
  };
  const act = async (kind, item) => {
    setBusy(kind); setNote('');
    try {
      const next = await api(`/api/purchases/${item.id}/${kind}`, { method: 'POST' });
      setData((d) => ({ ...d, items: d.items.map((x) => (x.id === next.id ? next : x)) }));
    } catch (e) { setNote(e?.message || '没成功'); }
    setBusy('');
  };

  const names = data?.names || { me: '我', him: '他' };
  const avatars = data?.avatars || {};
  const shown = filter ? items.filter((x) => x.status === filter) : items;

  return (
    <main className="ap">
      <header className="ap-head">
        <a href={open ? '#/approvals' : '#/'} className="rbtn" aria-label="返回"><Icon name="back" size={18} stroke={1.5} /></a>
        <h1><span className="hand">approvals</span><span>买买申请</span></h1>
        {!open && <p>想要什么就交一张申请，他来批。</p>}
      </header>

      {!data && <div className="card ap-pad">正在翻…</div>}
      {data?.available === false && <div className="card ap-pad">暂时连不上，过一会儿再来。</div>}

      {open ? (
        <Detail item={open} names={names} avatars={avatars} now={now} busy={busy} note={note}
          onWithdraw={() => act('withdraw', open)} onReview={() => act('review', open)}
          onRedo={() => setForm({ category: open.category, title: open.title, price: String(open.price), reason: open.reason })} />
      ) : data && (
        <>
          <button type="button" className="btn-main ap-new" onClick={() => setForm({ category: CATEGORIES[0], title: '', price: '', reason: '' })}>
            <Icon name="plus" size={15} />交一张申请
          </button>
          <div className="ap-filters" role="tablist" aria-label="筛选">
            {FILTERS.map(([k, n]) => <button key={k} type="button" role="tab" aria-selected={filter === k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{n}</button>)}
          </div>
          {!shown.length && <div className="card ap-pad">{items.length ? '这一类还没有' : '还没有申请。想要什么，交一张试试？'}</div>}
          <div className="ap-list">
            {shown.map((x) => (
              <button key={x.id} type="button" className="card ap-row" onClick={() => go(x.id)}>
                <span className="ap-row-t"><em className="ap-tag">{x.category}</em><b>{x.title}</b><small>{x.comment || x.reason || ' '}</small></span>
                <span className="ap-row-r"><span className="ap-row-price">{money(x.price)}</span><Stamp status={x.status} /></span>
              </button>
            ))}
          </div>
        </>
      )}

      {form && (
        <Sheet open onClose={() => setForm(null)} label="交一张申请" seed={61}>
          <div className="ap-form">
            <h3>交一张申请</h3>
            <div className="ap-cats" role="radiogroup" aria-label="类别">
              {CATEGORIES.map((c) => <button key={c} type="button" role="radio" aria-checked={form.category === c} className={`chip ${form.category === c ? 'on' : ''}`} onClick={() => setForm({ ...form, category: c })}>{c}</button>)}
            </div>
            <label className="pill"><span>想要</span><input value={form.title} maxLength={40} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="比如：冰淇淋" /></label>
            <label className="pill"><span>价格</span><input value={form.price} inputMode="decimal" onChange={(e) => setForm({ ...form, price: e.target.value.replace(/[^\d.]/g, '') })} placeholder="¥" /></label>
            <textarea className="card ap-reason" value={form.reason} maxLength={500} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="申请说明：为什么想要～" />
            {note && <p className="ap-note">{note}</p>}
            <button type="button" className="btn-main" disabled={busy === 'submit' || !form.title.trim() || form.price === ''} onClick={submit}>{busy === 'submit' ? '交上去…' : '交给他审批'}</button>
          </div>
        </Sheet>
      )}
    </main>
  );
}

function Detail({ item, names, avatars, now, busy, note, onWithdraw, onReview, onRedo }) {
  const review = [...(item.timeline || [])].reverse().find((t) => t.kind === 'approve' || t.kind === 'reject');
  return (
    <div className="ap-detail">
      <section className="card ap-sheet">
        <div className="ap-top">
          <div><em className="ap-tag">{item.category}</em><h2>{item.title}</h2></div>
          <Stamp status={item.status} />
        </div>
        <div className="ap-price">{money(item.price)}</div>
        <hr />
        <h3>申请说明</h3>
        <p className="ap-text">{item.reason || '（没写说明）'}</p>
        <small className="ap-meta">{item.no} · {ago(item.at, now)}</small>
        <hr />
        <div className="ap-who"><Face src={avatars.me} name={names.me} /><b>{names.me}</b></div>
      </section>

      <div className={`ap-banner ${STAMP[item.status]?.[1] || ''}`}>· {BANNER[item.status] || ''}</div>

      {review && (
        <section className="card ap-block">
          <h3>审批回应</h3>
          <hr />
          <div className="ap-reply"><Face src={avatars.him} name={names.him} /><div><b>{names.him}</b><p>{review.text || (review.kind === 'approve' ? '准了。' : '先不批。')}</p></div></div>
        </section>
      )}

      <section className="card ap-block">
        <div className="ap-block-h"><h3>审批轨迹</h3><span>{item.timeline?.length || 0} 条</span></div>
        <ol className="ap-steps">
          {(item.timeline || []).map((t, i) => (
            <li key={i} className={t.kind}>
              <i />
              <div className="ap-step">
                <div className="ap-step-h"><b>{STEP[t.kind] || t.kind}</b><time>{ago(t.at, now)}</time></div>
                {t.by === 'him' && <div className="ap-step-who"><Face src={avatars.him} name={names.him} />{names.him}</div>}
                {t.text && t.kind !== 'submit' && <p>{t.text}</p>}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div className="ap-acts">
        {item.status === 'pending' && <button type="button" className="chip" disabled={!!busy} onClick={onWithdraw}>{busy === 'withdraw' ? '撤回中…' : '撤回申请'}</button>}
        {item.status === 'rejected' && <button type="button" className="chip" disabled={!!busy} onClick={onReview}>{busy === 'review' ? '他在重新看…' : '求他再看一次'}</button>}
        {item.status !== 'pending' && <button type="button" className="chip" disabled={!!busy} onClick={onRedo}>改一改重新申请</button>}
      </div>
      {note && <p className="ap-note">{note}</p>}
    </div>
  );
}
