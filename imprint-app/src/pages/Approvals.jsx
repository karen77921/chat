/**
 * 买买申请：她交申请（想要什么、多少钱、为什么），他自己审批，盖章、写回应，每一步都进审批轨迹。
 * 网址：#/approvals   ?id=xxx 看某一张
 * 他也能从她发的购物截图起草一张（status: draft），她在这里看过、改好再交：?draft=xxx 直接打开那张草稿。
 * 数据：GET /api/purchases、POST /api/purchases、POST /api/purchases/:id/withdraw|review|submit|discard
 */
import { useEffect, useState } from 'react';
import Icon from '../design/icons.jsx';
import Sheet from '../design/Sheet.jsx';
import AuthImg from '../design/AuthImg.jsx';
import { api, uploadFile } from '../lib/api.js';
import { useLoad } from '../lib/useLoad.js';
import { shrinkImage } from '../lib/image.js';
import { ago } from '../lib/home.js';
import '../components/approvals/approvals.css';

const CATEGORIES = ['想买的东西', '想吃的', '想玩的', '其他'];
const WHEN = ['今天', '本周', '这个月', '不急'];
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
  const drafts = items.filter((x) => x.status === 'draft');
  const fromDraft = (x) => ({ draftId: x.id, category: x.category, title: x.title, price: String(x.price), reason: x.reason || '', channel: x.channel || '', when: x.when || '', image: x.image || '', imageUrl: x.imageUrl || '', note: x.draft_note || '' });
  // 聊天里点「查看并提交」过来：直接打开那张草稿
  useEffect(() => {
    const d = query.draft && items.find((x) => x.id === query.draft && x.status === 'draft');
    if (d) { setForm(fromDraft(d)); location.hash = '#/approvals'; }
  }, [query.draft, data]); // eslint-disable-line react-hooks/exhaustive-deps
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
      const { draftId, imageUrl, note: _n, ...body } = form;
      const item = await api(draftId ? `/api/purchases/${draftId}/submit` : '/api/purchases', { method: 'POST', body: { ...body, price: Number(form.price) } });
      await reload();
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
  const listed = items.filter((x) => x.status !== 'draft');
  const shown = filter ? listed.filter((x) => x.status === filter) : listed;
  const discard = async (x) => {
    setBusy(`discard-${x.id}`);
    try { await api(`/api/purchases/${x.id}/discard`, { method: 'POST' }); setData((d) => ({ ...d, items: d.items.filter((y) => y.id !== x.id) })); }
    catch (e) { setNote(e?.message || '没丢掉'); }
    setBusy('');
  };
  const pickImage = async (file) => {
    if (!file) return;
    setBusy('image'); setNote('');
    try {
      const small = await shrinkImage(file);
      const up = await uploadFile(small);
      setForm((f) => ({ ...f, image: up.url, imageUrl: URL.createObjectURL(small) }));
    } catch (e) { setNote(e?.message || '图没传上'); }
    setBusy('');
  };

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
          onRedo={() => setForm({ category: open.category, title: open.title, price: String(open.price), reason: open.reason, channel: open.channel || '', when: open.when || '', image: open.image || '', imageUrl: open.imageUrl || '' })} />
      ) : data && (
        <>
          {!!drafts.length && (
            <section className="ap-drafts">
              <h3>{names.him}帮你起草的 · {drafts.length}</h3>
              {drafts.map((x) => (
                <div key={x.id} className="card ap-draft">
                  {x.imageUrl && <img src={x.imageUrl} alt="" />}
                  <span className="ap-row-t"><b>{x.title}</b><small>{money(x.price)}{x.channel ? ` · ${x.channel}` : ''}</small></span>
                  <span className="ap-draft-a">
                    <button type="button" className="chip on" onClick={() => setForm(fromDraft(x))}>查看并提交</button>
                    <button type="button" className="chip" disabled={busy === `discard-${x.id}`} onClick={() => discard(x)}>不要了</button>
                  </span>
                </div>
              ))}
            </section>
          )}
          <button type="button" className="btn-main ap-new" onClick={() => setForm({ category: CATEGORIES[0], title: '', price: '', reason: '', channel: '', when: '', image: '' })}>
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
            <h3>{form.draftId ? `${names.him}帮你起草的申请` : '交一张申请'}</h3>
            {form.draftId && <p className="ap-tip">看一眼对不对，改好再交；交上去他就开始审。{form.note ? `他说：${form.note}` : ''}</p>}
            <div className="ap-cats" role="radiogroup" aria-label="类别">
              {CATEGORIES.map((c) => <button key={c} type="button" role="radio" aria-checked={form.category === c} className={`chip ${form.category === c ? 'on' : ''}`} onClick={() => setForm({ ...form, category: c })}>{c}</button>)}
            </div>
            <label className="pill"><span>想要</span><input value={form.title} maxLength={40} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="比如：冰淇淋" /></label>
            <label className="pill"><span>价格</span><input value={form.price} inputMode="decimal" onChange={(e) => setForm({ ...form, price: e.target.value.replace(/[^\d.]/g, '') })} placeholder="¥" /></label>
            <label className="pill"><span>店铺</span><input value={form.channel || ''} maxLength={40} onChange={(e) => setForm({ ...form, channel: e.target.value })} placeholder="店铺 / 平台（可以不填）" /></label>
            <div className="ap-cats" role="radiogroup" aria-label="想什么时候买">
              <span className="ap-k">什么时候买</span>
              {WHEN.map((w) => <button key={w} type="button" role="radio" aria-checked={form.when === w} className={`chip ${form.when === w ? 'on' : ''}`} onClick={() => setForm({ ...form, when: form.when === w ? '' : w })}>{w}</button>)}
            </div>
            <div className="ap-img">
              {form.imageUrl ? <img src={form.imageUrl} alt="商品图" /> : null}
              <label className="chip">{busy === 'image' ? '传图中…' : form.image ? '换一张图' : '＋ 商品图 / 截图'}
                <input type="file" accept="image/*" hidden onChange={(e) => { pickImage(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              {form.image && <button type="button" className="chip" onClick={() => setForm({ ...form, image: '', imageUrl: '' })}>去掉图</button>}
            </div>
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
        {(item.channel || item.when) && <div className="ap-facts">{item.channel && <span>在 {item.channel}</span>}{item.when && <span>想{item.when === '不急' ? '慢慢' : item.when}买</span>}</div>}
        {item.imageUrl && <img className="ap-pic" src={item.imageUrl} alt="商品图" />}
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
