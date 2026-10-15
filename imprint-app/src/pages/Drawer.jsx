/**
 * 抽屉：封好的纸条。封面谁都看得到，正文只有写的人看得到；封了就改不了，封存时间和指纹证明没被偷偷换过。
 * 拆开有三种：写的人自己拆、到点自动拆、对方点「想看」（拆不拆写的人决定）。
 * 网址：#/drawer    数据：GET/POST /api/drawer、POST /api/drawer/:id/reveal|ask
 */
import { useState } from 'react';
import Icon from '../design/icons.jsx';
import Sheet from '../design/Sheet.jsx';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/useLoad.js';
import { ago } from '../lib/home.js';
import '../components/piggy/piggy.css';
import '../components/drawer/drawer.css';

const stamp = (iso) => (iso ? new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

export default function Drawer() {
  const { data, setData } = useLoad('/api/drawer');
  const [form, setForm] = useState(null); // { cover, body, at }
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const names = data?.names || { me: '我', him: '他' };
  const items = data?.items || [];
  const now = new Date();
  const who = (x) => (x.by === 'me' ? names.me : names.him);
  const swap = (it) => { setData((d) => ({ ...d, items: d.items.map((x) => (x.id === it.id ? it : x)) })); setPicked(it); };

  const seal = async () => {
    setBusy(true); setNote('');
    try {
      const { item } = await api('/api/drawer', { method: 'POST', body: { cover: form.cover.trim(), body: form.body.trim(), reveal_at: form.at || undefined } });
      setData((d) => ({ ...d, items: [item, ...(d.items || [])] }));
      setForm(null);
    } catch (e) { setNote(e?.message || '没封上，再试一次'); }
    setBusy(false);
  };
  const act = async (it, op) => {
    setBusy(true); setNote('');
    try { swap((await api(`/api/drawer/${it.id}/${op}`, { method: 'POST' })).item); if (op === 'ask') setNote(`告诉${names.him}了，拆不拆他决定`); }
    catch (e) { setNote(e?.message || '没成功，再试一次'); }
    setBusy(false);
  };

  return (
    <main className="pg dr">
      <header className="pg-head">
        <a href="#/" className="rbtn" aria-label="返回"><Icon name="back" size={18} stroke={1.5} /></a>
        <h1><span className="hand">the drawer</span><span>抽屉</span></h1>
        <p>封好的纸条。封面都看得到，里面写了什么只有写的人知道；封了就谁也改不了，拆开时对一下指纹，就知道没被偷偷换过。</p>
      </header>

      {!data && <div className="card pg-pad">正在拉开抽屉…</div>}
      {data?.available === false && <div className="card pg-pad">暂时连不上，过一会儿再来。</div>}
      {data && data.available !== false && (
        <>
          <div className="pg-acts dr-acts">
            <button type="button" className="btn-main" onClick={() => { setNote(''); setForm({ cover: '', body: '', at: '' }); }}><Icon name="plus" size={15} />封一张给{names.him}</button>
          </div>
          {!items.length && <div className="card pg-pad">抽屉还是空的。</div>}
          <div className="dr-list">
            {items.map((it) => (
              <button key={it.id} type="button" className={`card dr-env ${it.status}`} onClick={() => { setNote(''); setPicked(it); }}>
                <span className="dr-seal" aria-hidden="true">{it.status === 'sealed' ? '封' : '拆'}</span>
                <span className="dr-env-t">
                  <b>{it.cover}</b>
                  <small>{who(it)} · {ago(it.sealed_at, now)}封的{it.status === 'sealed' && it.reveal_at ? ` · ${stamp(it.reveal_at)} 自动拆` : ''}{it.asked_at && it.status === 'sealed' ? ' · 有人想看' : ''}</small>
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {form && (
        <Sheet open onClose={() => setForm(null)} label="封一张纸条" seed={91}>
          <div className="pg-form">
            <h3>封一张给{names.him}</h3>
            <label className="pill"><span>封面</span><input value={form.cover} maxLength={60} autoFocus onChange={(e) => setForm({ ...form, cover: e.target.value })} placeholder={`${names.him}看得到的一句话`} /></label>
            <textarea className="card pg-reason dr-body" value={form.body} maxLength={5000} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder={`里面写的，${names.him}拆开前看不到`} />
            <label className="pill"><span>到点拆</span><input type="datetime-local" value={form.at} onChange={(e) => setForm({ ...form, at: e.target.value })} /></label>
            <p className="pg-note dr-warn">封上以后，谁都改不了，包括你自己。</p>
            {note && <p className="pg-note">{note}</p>}
            <button type="button" className="btn-main" disabled={busy || !form.cover.trim() || !form.body.trim()} onClick={seal}>{busy ? '封上…' : '封上'}</button>
          </div>
        </Sheet>
      )}

      {picked && (
        <Sheet open onClose={() => setPicked(null)} label={picked.cover} seed={92}>
          <div className="pg-form">
            <h3>{picked.cover}</h3>
            {picked.body != null ? <p className="pg-why dr-text">{picked.body}</p> : <p className="pg-why dr-locked">封着，看不到里面。</p>}
            <small className="pg-when">{who(picked)} {stamp(picked.sealed_at)} 封的{picked.revealed_at ? ` · ${stamp(picked.revealed_at)} 拆开` : picked.reveal_at ? ` · ${stamp(picked.reveal_at)} 自动拆` : ''}</small>
            <small className="pg-when">指纹 {picked.fingerprint}</small>
            {note && <p className="pg-note">{note}</p>}
            {picked.status === 'sealed' && picked.by === 'me' && <button type="button" className="btn-main" disabled={busy} onClick={() => act(picked, 'reveal')}>现在拆开给{names.him}看</button>}
            {picked.status === 'sealed' && picked.by === 'him' && <button type="button" className="btn-main" disabled={busy || !!picked.asked_at} onClick={() => act(picked, 'ask')}>{picked.asked_at ? '已经说想看了' : '想看'}</button>}
          </div>
        </Sheet>
      )}
    </main>
  );
}
