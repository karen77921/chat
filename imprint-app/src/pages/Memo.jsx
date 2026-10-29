/**
 * 小本本：名字、昵称、东西的来历、约定、她的口味——小而具体、忘了会让她失望的事。
 * 他听到就记一行，她也能加、改、删；整本每一轮都给他看。
 * 网址：#/memo    数据：GET/POST /api/memo、POST /api/memo/:id/edit、DELETE /api/memo/:id
 */
import { useState } from 'react';
import Icon from '../design/icons.jsx';
import Sheet from '../design/Sheet.jsx';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/useLoad.js';
import { ago } from '../lib/home.js';
import '../components/piggy/piggy.css';

const HINTS = ['小山羊叫山羊二号，是我起的', '我不吃香菜', '我们约好周末一起看电影', '叫我宝宝的时候不许笑'];

export default function Memo() {
  const { data, setData } = useLoad('/api/memo');
  const [form, setForm] = useState(null); // { id?, text }
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const names = data?.names || { me: '我', him: '他' };
  const items = data?.items || [];
  const now = new Date();

  const save = async () => {
    setBusy(true); setNote('');
    try {
      const text = form.text.trim();
      if (form.id) {
        const r = await api(`/api/memo/${form.id}/edit`, { method: 'POST', body: { text } });
        setData((d) => ({ ...d, items: d.items.map((x) => (x.id === form.id ? r.item : x)) }));
      } else {
        const r = await api('/api/memo', { method: 'POST', body: { text } });
        if (!r.duplicate) setData((d) => ({ ...d, items: [...(d.items || []), r.item] }));
      }
      setForm(null);
    } catch (e) { setNote(e?.message || '没记上，再试一次'); }
    setBusy(false);
  };
  const remove = async () => {
    setBusy(true);
    try {
      await api(`/api/memo/${form.id}`, { method: 'DELETE' });
      setData((d) => ({ ...d, items: d.items.filter((x) => x.id !== form.id) }));
      setForm(null);
    } catch (e) { setNote(e?.message || '没删掉'); }
    setBusy(false);
  };

  return (
    <main className="pg">
      <header className="pg-head">
        <a href="#/" className="rbtn" aria-label="返回"><Icon name="back" size={18} stroke={1.5} /></a>
        <h1><span className="hand">little notebook</span><span>小本本</span></h1>
        <p>{names.him}记着的小事：名字、昵称、东西的来历、你们的约定。他每说一句话之前都会翻一遍，记错了你可以直接改。</p>
      </header>

      {!data && <div className="card pg-pad">正在翻…</div>}
      {data?.available === false && <div className="card pg-pad">暂时连不上，过一会儿再来。</div>}

      {data && data.available !== false && (
        <>
          <div className="pg-acts" style={{ gridTemplateColumns: '1fr' }}>
            <button type="button" className="btn-main" onClick={() => { setNote(''); setForm({ text: '' }); }}><Icon name="plus" size={15} />记一条</button>
          </div>
          <h2 className="pg-sec">记着的 {items.length ? `· ${items.length}${data.max ? ` / ${data.max}` : ''}` : ''}</h2>
          {!items.length && <div className="card pg-pad">还是空的。{names.him}听到名字、约定这种事会自己记上；你也可以先写几条。</div>}
          {items.length > 0 && (
            <div className="card pg-list">
              {items.map((it) => (
                <button key={it.id} type="button" className="pg-row" onClick={() => { setNote(''); setForm({ id: it.id, text: it.text, by: it.by, at: it.at }); }}>
                  <span className={`pg-sign ${it.by === 'him' ? 'in' : 'out'}`}>{it.by === 'him' ? '他' : '我'}</span>
                  <span className="pg-row-t"><b style={{ whiteSpace: 'normal', lineHeight: 1.6 }}>{it.text}</b><small>{ago(it.edited || it.at, now)}{it.edited ? ' · 改过' : ''}</small></span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {form && (
        <Sheet open onClose={() => setForm(null)} label={form.id ? '这一条' : '记一条'} seed={77}>
          <div className="pg-form">
            <h3>{form.id ? (form.by === 'him' ? `${names.him}记的` : '你记的') : `让${names.him}记住`}</h3>
            {!form.id && <div className="pg-quick">{HINTS.map((q) => <button key={q} type="button" className="chip" onClick={() => setForm({ ...form, text: q })}>{q}</button>)}</div>}
            <textarea className="card pg-reason" value={form.text} maxLength={160} autoFocus onChange={(e) => setForm({ ...form, text: e.target.value })}
              placeholder="一句话写清楚：是什么、谁起的、什么时候" />
            {note && <p className="pg-note">{note}</p>}
            <button type="button" className="btn-main" disabled={busy || !form.text.trim()} onClick={save}>{busy ? '记上…' : form.id ? '改好了' : '记上'}</button>
            {form.id && <button type="button" className="cl-link st-delmcp" disabled={busy} onClick={remove}><Icon name="trash" size={15} stroke={1.5} />不对了，划掉这条</button>}
          </div>
        </Sheet>
      )}
    </main>
  );
}
