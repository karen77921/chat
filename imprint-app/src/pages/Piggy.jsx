/**
 * 存钱罐：她给他存的。只有她能存、能扣，每一笔都要写为什么；他每一轮都能看到余额和最近几笔，但改不了。
 * 网址：#/piggy    数据：GET/POST /api/piggy、DELETE /api/piggy/:id
 */
import { useState } from 'react';
import Icon from '../design/icons.jsx';
import Sheet from '../design/Sheet.jsx';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/useLoad.js';
import { ago } from '../lib/home.js';
import '../components/piggy/piggy.css';

const QUICK = {
  save: ['让我开心了', '乖乖听话', '哄好我了', '陪我熬过难过', '游戏赢了'],
  take: ['惹我生气', '熬夜不睡', '瞎编', '骗我', '不回我消息'],
};
const money = (n) => `¥${Math.abs(Number(n || 0)).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;

/* 玻璃罐子：硬币堆的高度跟着余额慢慢涨（满 520 封顶） */
function Jar({ balance }) {
  const level = Math.max(0.06, Math.min(1, balance / 520));
  const top = 112 - level * 78;
  const coins = [];
  for (let y = 108; y > top; y -= 9) for (let x = 34 + ((y / 9) % 2) * 7; x < 100; x += 15) coins.push([x, y]);
  return (
    <svg viewBox="0 0 132 132" className="pg-jar" aria-hidden="true">
      <defs>
        <linearGradient id="pg-glass" x1="0" x2="1"><stop offset="0" stopColor="#fff" stopOpacity=".75" /><stop offset=".5" stopColor="#fff" stopOpacity=".25" /><stop offset="1" stopColor="#fff" stopOpacity=".6" /></linearGradient>
        <clipPath id="pg-in"><path d="M30 34h72q8 0 8 10v58q0 14-14 14H36q-14 0-14-14V44q0-10 8-10z" /></clipPath>
      </defs>
      <g clipPath="url(#pg-in)">
        {coins.map(([x, y], i) => <ellipse key={i} cx={x} cy={y} rx="7.5" ry="3.6" fill={i % 3 ? '#e7c08f' : '#d9ab74'} stroke="#c49563" strokeWidth=".6" />)}
      </g>
      <path d="M30 34h72q8 0 8 10v58q0 14-14 14H36q-14 0-14-14V44q0-10 8-10z" fill="url(#pg-glass)" stroke="rgba(150,130,120,.45)" strokeWidth="1.4" />
      <rect x="36" y="20" width="60" height="14" rx="5" fill="#ebcdc9" stroke="rgba(150,110,100,.4)" />
      <rect x="56" y="24" width="20" height="3" rx="1.5" fill="#b98079" opacity=".6" />
      <path d="M36 46q-4 20 0 50" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity=".7" fill="none" />
    </svg>
  );
}

export default function Piggy() {
  const { data, setData } = useLoad('/api/piggy');
  const [form, setForm] = useState(null); // { kind, amount, reason }
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [picked, setPicked] = useState(null);
  const names = data?.names || { me: '我', him: '他' };
  const items = data?.items || [];
  const balance = Number(data?.balance || 0);
  const now = new Date();

  const save = async () => {
    setBusy(true); setNote('');
    try {
      const it = await api('/api/piggy', { method: 'POST', body: { kind: form.kind, amount: Number(form.amount), reason: form.reason.trim() } });
      setData((d) => ({ ...d, balance: Math.round((Number(d.balance || 0) + it.delta) * 100) / 100, items: [it, ...(d.items || []).filter((x) => x.id !== it.id)] }));
      setForm(null);
    } catch (e) { setNote(e?.message || '没记上，再试一次'); }
    setBusy(false);
  };
  const remove = async (it) => {
    setBusy(true);
    try {
      await api(`/api/piggy/${it.id}`, { method: 'DELETE' });
      setData((d) => ({ ...d, balance: Math.round((Number(d.balance || 0) - it.delta) * 100) / 100, items: d.items.filter((x) => x.id !== it.id) }));
      setPicked(null);
    } catch (e) { setNote(e?.message || '没删掉'); }
    setBusy(false);
  };

  return (
    <main className="pg">
      <header className="pg-head">
        <a href="#/" className="rbtn" aria-label="返回"><Icon name="back" size={18} stroke={1.5} /></a>
        <h1><span className="hand">piggy bank</span><span>存钱罐</span></h1>
        <p>给{names.him}存的。只有你能存、能扣，每一笔都写上为什么；{names.him}看得到，但改不了。</p>
      </header>

      {!data && <div className="card pg-pad">正在数…</div>}
      {data?.available === false && <div className="card pg-pad">暂时连不上，过一会儿再来。</div>}

      {data && data.available !== false && (
        <>
          <section className="card pg-hero">
            <Jar balance={balance} />
            <div className="pg-sum">
              <em>现在罐子里有</em>
              <b className={balance < 0 ? 'neg' : ''}>{balance < 0 ? '−' : ''}{money(balance)}</b>
              <small>{items.length ? `一共 ${items.length} 笔 · 最近一笔 ${ago(items[0].at, now)}` : '还是空的'}</small>
            </div>
          </section>
          <div className="pg-acts">
            <button type="button" className="btn-main" onClick={() => setForm({ kind: 'save', amount: '', reason: '' })}><Icon name="plus" size={15} />存一笔</button>
            <button type="button" className="pg-take" onClick={() => setForm({ kind: 'take', amount: '', reason: '' })}>扣一笔</button>
          </div>

          <h2 className="pg-sec">每一笔</h2>
          {!items.length && <div className="card pg-pad">还没有记录。存第一笔，告诉{names.him}为什么。</div>}
          <div className="card pg-list">
            {items.map((it) => (
              <button key={it.id} type="button" className="pg-row" onClick={() => setPicked(it)}>
                <span className={`pg-sign ${it.delta > 0 ? 'in' : 'out'}`}>{it.delta > 0 ? '存' : '扣'}</span>
                <span className="pg-row-t"><b>{it.reason}</b><small>{ago(it.at, now)}</small></span>
                <span className={`pg-amt ${it.delta > 0 ? 'in' : 'out'}`}>{it.delta > 0 ? '+' : '−'}{money(it.delta)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {form && (
        <Sheet open onClose={() => setForm(null)} label={form.kind === 'save' ? '存一笔' : '扣一笔'} seed={88}>
          <div className="pg-form">
            <h3>{form.kind === 'save' ? `给${names.him}存一笔` : `从罐子里扣一笔`}</h3>
            <label className="pill"><span>金额</span><input value={form.amount} inputMode="decimal" autoFocus onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^\d.]/g, '') })} placeholder="¥" /></label>
            <div className="pg-quick">{QUICK[form.kind].map((q) => <button key={q} type="button" className={`chip ${form.reason === q ? 'on' : ''}`} onClick={() => setForm({ ...form, reason: q })}>{q}</button>)}</div>
            <textarea className="card pg-reason" value={form.reason} maxLength={200} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder={form.kind === 'save' ? '为什么存？他会看到的' : '为什么扣？他会看到的'} />
            {note && <p className="pg-note">{note}</p>}
            <button type="button" className={form.kind === 'save' ? 'btn-main' : 'btn-main pg-take-main'} disabled={busy || !(Number(form.amount) > 0) || !form.reason.trim()} onClick={save}>
              {busy ? '记上…' : form.kind === 'save' ? '存进去' : '扣掉'}
            </button>
          </div>
        </Sheet>
      )}

      {picked && (
        <Sheet open onClose={() => setPicked(null)} label="这一笔" seed={89}>
          <div className="pg-form">
            <h3>{picked.delta > 0 ? '存了' : '扣了'} {money(picked.delta)}</h3>
            <p className="pg-why">{picked.reason}</p>
            <small className="pg-when">{new Date(picked.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small>
            <button type="button" className="cl-link st-delmcp" disabled={busy} onClick={() => remove(picked)}><Icon name="trash" size={15} stroke={1.5} />记错了，删掉这一笔</button>
          </div>
        </Sheet>
      )}
    </main>
  );
}
