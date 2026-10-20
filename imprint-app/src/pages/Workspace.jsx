/**
 * 工作区：mousecrew（AI 施工队）的手机端。底栏第六个入口。
 *   - 队员：每只 AI 现在在干嘛（干活中 / 空闲 / 没启动 / 离线）
 *   - 群聊：所有人和所有 AI 一个群，@ 谁就叫醒谁
 *   - 工单：谁在做、卡在哪、过没过审；点开看经过，能派出、暂停、继续、通过、退回
 * mousecrew 另装在服务器上；Imprint 后端只做转接（GET/POST /api/crew/...），地址和令牌在这页底下填一次。
 * 网址：#/work?tab=chat|orders
 */
import { useEffect, useRef, useState } from 'react';
import Icon from '../design/icons.jsx';
import Sheet from '../design/Sheet.jsx';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/useLoad.js';
import { replaceQuery } from '../lib/router.js';
import '../components/piggy/piggy.css';
import '../components/work/work.css';

const STATE = {
  working: ['干活中', 'busy'], busy: ['干活中', 'busy'], queued: ['排队中', 'busy'], idle: ['空闲', 'idle'],
  unspawned: ['没启动', 'off'], offline: ['离线', 'off'], unknown: ['不清楚', 'off'],
};
const ORDER = {
  draft: '草稿', assigned: '已派出', in_progress: '进行中', submitted: '已提交', auditing: '审核中',
  pending_restart: '等重启', paused: '暂停', accepted: '已通过', rejected: '退回', closed: '已关闭',
};
const GROUPS = [
  ['open', '进行中', ['assigned', 'in_progress', 'submitted', 'auditing', 'pending_restart', 'paused', 'rejected']],
  ['draft', '草稿', ['draft']],
  ['done', '完成', ['accepted', 'closed']],
];
const time = (ts) => {
  const d = new Date(String(ts || '').includes('T') ? ts : `${String(ts).replace(' ', 'T')}Z`);
  return Number.isNaN(+d) ? '' : `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const senderOf = (m) => { try { return JSON.parse(m.metadata || '{}').sender || (m.role === 'user' ? 'human' : ''); } catch { return m.role === 'user' ? 'human' : ''; } };

export default function Workspace({ query }) {
  const [tab, setTabState] = useState(query.tab === 'orders' ? 'orders' : 'chat');
  const setTab = (t) => { setTabState(t); replaceQuery(t === 'orders' ? { tab: 'orders' } : {}); };
  const conf = useLoad('/api/crew/config');
  const agents = useLoad(conf.data?.configured ? '/api/crew/agents/status' : null);
  const list = Object.values(agents.data && agents.data.available !== false ? agents.data : {});
  useEffect(() => {
    if (!conf.data?.configured) return undefined;
    const t = setInterval(() => agents.reload(), 15000);
    return () => clearInterval(t);
  }, [conf.data?.configured, agents.reload]);

  return (
    <main className="pg wk">
      <header className="wk-head">
        <h1><span className="hand">the studio</span><span>工作区</span></h1>
        <p>和 AI 施工队一个群：@ 谁就叫醒谁，每件事一张工单。</p>
      </header>

      {!conf.data && <div className="card pg-pad">正在连工作区…</div>}
      {conf.data && !conf.data.configured && <Setup onDone={conf.reload} />}
      {conf.data?.configured && (
        <>
          <section className="wk-crew" aria-label="队员">
            {!agents.data && <span className="wk-hint">正在点名…</span>}
            {agents.data?.available === false && <span className="wk-hint">{agents.data.reason}</span>}
            {list.map((a) => {
              const [label, tone] = STATE[a.state] || [a.state || '—', 'off'];
              return (
                <span key={a.id} className={`wk-agent ${tone}`}>
                  <i aria-hidden="true" /><b>{a.id}</b><em>{label}{a.queueLength ? ` · 排队 ${a.queueLength}` : ''}</em>
                </span>
              );
            })}
          </section>
          <nav className="wk-tabs" aria-label="工作区">
            <button type="button" className={tab === 'chat' ? 'on' : ''} aria-pressed={tab === 'chat'} onClick={() => setTab('chat')}>群聊</button>
            <button type="button" className={tab === 'orders' ? 'on' : ''} aria-pressed={tab === 'orders'} onClick={() => setTab('orders')}>工单</button>
          </nav>
          {tab === 'chat' ? <Group agents={list} /> : <Orders agents={list} />}
          <Setup compact url={conf.data.url} onDone={conf.reload} />
        </>
      )}
    </main>
  );
}

/* ---------- 群聊：每 4 秒拉一次历史 ---------- */
function Group({ agents }) {
  const hist = useLoad('/api/crew/group/history?limit=80', { keepPrevious: true });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const end = useRef(null);
  const msgs = hist.data?.messages || [];
  useEffect(() => { const t = setInterval(() => hist.reload(), 4000); return () => clearInterval(t); }, [hist.reload]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs.length]);
  const send = async () => {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true); setErr('');
    try { await api('/api/crew/group/chat', { method: 'POST', body: { message, sender: 'human' } }); setText(''); await hist.reload(); }
    catch (e) { setErr(e?.message || '没发出去'); }
    setBusy(false);
  };
  const mention = (id) => setText((t) => `${t.replace(/\s*$/, '')}${t.trim() ? ' ' : ''}@${id} `);
  return (
    <section className="wk-group">
      {hist.data?.available === false && <div className="card pg-pad">{hist.data.reason}</div>}
      <div className="wk-msgs">
        {!hist.data && <p className="wk-hint">正在翻群聊…</p>}
        {hist.data && !msgs.length && hist.data.available !== false && <p className="wk-hint">群里还没人说话。@ 一只 AI 派个活试试。</p>}
        {msgs.map((m) => {
          const who = senderOf(m);
          const card = /^\[[A-Z]+-\d+\]/.test(m.content) || who === 'system';
          if (card) return <div key={m.id} className="wk-card-line">{m.content.replace(/\b(draft|assigned|in_progress|submitted|auditing|pending_restart|paused|accepted|rejected|closed)\b/g, (w) => ORDER[w])}<time>{time(m.ts)}</time></div>;
          const mine = who === 'human';
          return (
            <div key={m.id} className={`wk-msg ${mine ? 'me' : ''}`}>
              {!mine && <b className="wk-who">{who}</b>}
              <p>{m.content}</p>
              <time>{time(m.ts)}</time>
            </div>
          );
        })}
        <i ref={end} />
      </div>
      {err && <p className="wk-err" role="alert">{err}</p>}
      <div className="wk-at">{agents.map((a) => <button key={a.id} type="button" onClick={() => mention(a.id)}>@{a.id}</button>)}</div>
      <form className="wk-in" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <label><span className="sr">发到群里</span>
          <textarea rows={1} value={text} onChange={(e) => setText(e.target.value)} placeholder="@ 一只 AI，说要做什么…" enterKeyHint="send"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
        </label>
        <button type="submit" aria-label="发送" disabled={!text.trim() || busy}><Icon name="send" size={18} stroke={1.5} /></button>
      </form>
    </section>
  );
}

/* ---------- 工单 ---------- */
function Orders({ agents }) {
  const all = useLoad('/api/crew/orders', { keepPrevious: true });
  const [group, setGroup] = useState('open');
  const [open, setOpen] = useState(null);
  const [creating, setCreating] = useState(false);
  const rows = Array.isArray(all.data) ? all.data : [];
  const shown = rows.filter((o) => GROUPS.find((g) => g[0] === group)[2].includes(o.status))
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  return (
    <section className="wk-orders">
      <div className="wk-orders-h">
        <div className="wk-seg">
          {GROUPS.map(([id, name, sts]) => (
            <button key={id} type="button" className={group === id ? 'on' : ''} onClick={() => setGroup(id)}>
              {name}<small>{rows.filter((o) => sts.includes(o.status)).length}</small>
            </button>
          ))}
        </div>
        <button type="button" className="btn-main wk-new" onClick={() => setCreating(true)}><Icon name="plus" size={15} />新工单</button>
      </div>
      {all.data?.available === false && <div className="card pg-pad">{all.data.reason}</div>}
      {!all.data && <div className="card pg-pad">正在翻工单…</div>}
      {all.data && all.data.available !== false && !shown.length && <div className="card pg-pad wk-hint">这一栏是空的。</div>}
      <div className="wk-list">
        {shown.map((o) => (
          <button key={o.id} type="button" className="card wk-order" onClick={() => setOpen(o.id)}>
            <span className="wk-order-h"><b>{o.id}</b><em className={`wk-st ${o.status}`}>{ORDER[o.status] || o.status}</em></span>
            <span className="wk-order-t">{o.title}</span>
            <span className="wk-order-f">{o.assignee ? `交给 ${o.assignee}` : '还没指派'}{o.repo ? ` · ${o.repo}` : ''}<time>{time(o.updated_at)}</time></span>
          </button>
        ))}
      </div>
      {open && <OrderSheet id={open} agents={agents} onClose={() => setOpen(null)} onChanged={all.reload} />}
      {creating && <NewOrder agents={agents} onClose={() => setCreating(false)} onDone={() => { setCreating(false); all.reload(); }} />}
    </section>
  );
}

function OrderSheet({ id, agents, onClose, onChanged }) {
  const { data, reload } = useLoad(`/api/crew/orders/${encodeURIComponent(id)}`);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [assignee, setAssignee] = useState('');
  const act = async (path, body = {}) => {
    setBusy(true); setNote('');
    try { await api(`/api/crew/orders/${encodeURIComponent(id)}${path}`, { method: 'POST', body: { actor: 'human', ...body } }); await reload(); onChanged(); }
    catch (e) { setNote(e?.message || '没成功'); }
    setBusy(false);
  };
  const s = data?.status;
  return (
    <Sheet open onClose={onClose} label={`工单 ${id}`} seed={71}>
      <div className="wk-sheet">
        {!data && <p className="wk-hint">正在打开…</p>}
        {data?.available === false && <p className="wk-hint">{data.reason}</p>}
        {data?.id && (
          <>
            <div className="wk-order-h"><b>{data.id}</b><em className={`wk-st ${s}`}>{ORDER[s] || s}</em></div>
            <h3>{data.title}</h3>
            {data.description && <p className="wk-desc">{data.description}</p>}
            <p className="wk-meta">{data.assignee ? `交给 ${data.assignee}` : '还没指派'}{data.repo ? ` · 仓库 ${data.repo}` : ''}{data.created_by ? ` · ${data.created_by} 开的` : ''}</p>
            {!data.assignee && (
              <div className="wk-assign">
                <select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="交给谁">
                  <option value="">交给谁…</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.id}</option>)}
                </select>
                <button type="button" className="chip" disabled={!assignee || busy} onClick={() => act('/assign', { assignee })}>指派</button>
              </div>
            )}
            <div className="wk-acts">
              {s === 'draft' && data.assignee && <button type="button" className="btn-main" disabled={busy} onClick={() => act('/dispatch')}>派出去</button>}
              {['assigned', 'in_progress', 'submitted', 'auditing'].includes(s) && <button type="button" className="chip" disabled={busy} onClick={() => act('/pause', { reason: '她先停一下' })}>暂停</button>}
              {s === 'paused' && <button type="button" className="chip" disabled={busy} onClick={() => act('/resume')}>继续</button>}
              {['submitted', 'auditing'].includes(s) && <button type="button" className="btn-main" disabled={busy} onClick={() => act('/transition', { to_status: 'accepted', comment: '她看过了' })}>通过</button>}
              {['submitted', 'auditing'].includes(s) && <button type="button" className="chip" disabled={busy} onClick={() => act('/transition', { to_status: 'rejected', comment: '她退回了' })}>退回</button>}
            </div>
            {note && <p className="wk-err" role="alert">{note}</p>}
            {!!data.timeline?.length && (
              <ol className="wk-tl">
                {data.timeline.map((t, i) => <li key={i}><b>{ORDER[t.status] || t.status}</b><span>{t.actor}{t.comment ? ` · ${t.comment}` : ''}</span><time>{time(t.ts)}</time></li>)}
              </ol>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

function NewOrder({ agents, onClose, onDone }) {
  const projects = useLoad('/api/crew/projects');
  const [f, setF] = useState({ title: '', description: '', assignee: '', repo: '', project_id: '' });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const plist = Array.isArray(projects.data) ? projects.data : [];
  useEffect(() => { if (plist.length && !f.project_id) setF((x) => ({ ...x, project_id: plist[0].id })); }, [plist.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    setBusy(true); setNote('');
    const body = Object.fromEntries(Object.entries({ ...f, actor: 'human' }).filter(([, v]) => v));
    try { await api('/api/crew/orders', { method: 'POST', body }); onDone(); }
    catch (e) { setNote(e?.message || '没开成'); }
    setBusy(false);
  };
  return (
    <Sheet open onClose={onClose} label="新工单" seed={73}>
      <div className="wk-sheet wk-form">
        <h3>新工单</h3>
        <label><span>要做什么</span><input value={f.title} onChange={set('title')} placeholder="一句话说清楚" maxLength={120} /></label>
        <label><span>细节</span><textarea rows={3} value={f.description} onChange={set('description')} placeholder="可以不填" /></label>
        {plist.length > 0 && (
          <label><span>项目</span><select value={f.project_id} onChange={set('project_id')}>{plist.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        )}
        <label><span>交给谁</span><select value={f.assignee} onChange={set('assignee')}><option value="">先不指派</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.id}</option>)}</select></label>
        <label><span>仓库</span><input value={f.repo} onChange={set('repo')} placeholder="比如 imprint（要和这只 AI 管的仓库一致）" /></label>
        {note && <p className="wk-err" role="alert">{note}</p>}
        <button type="button" className="btn-main" disabled={!f.title.trim() || busy} onClick={save}>{busy ? '正在开…' : '开工单'}</button>
        <p className="wk-hint">开好是草稿；指派了人再点「派出去」，它才会被叫起来。</p>
      </div>
    </Sheet>
  );
}

/* ---------- 接 mousecrew：地址 + 令牌 ---------- */
function Setup({ compact, url: current = '', onDone }) {
  const [open, setOpen] = useState(!compact);
  const [url, setUrl] = useState(current || 'http://127.0.0.1:8787');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const save = async () => {
    setBusy(true); setNote('');
    try { await api('/api/crew/config', { method: 'PUT', body: { url: url.trim(), token: token.trim() } }); setToken(''); onDone(); if (compact) setOpen(false); }
    catch (e) { setNote(e?.message || '没存上'); }
    setBusy(false);
  };
  if (compact && !open) return <button type="button" className="wk-setup-link" onClick={() => setOpen(true)}>换一个 mousecrew 地址 · 现在是 {current}</button>;
  return (
    <section className="card wk-setup">
      <h3>接上 mousecrew</h3>
      {!compact && <p>工作区是 mousecrew 的手机端。先在服务器上装好 mousecrew（它自己跑在一个端口上），再把地址和令牌填在这里。令牌只存在你的后端，不会显示出来。</p>}
      <label><span>地址</span><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://127.0.0.1:8787" /></label>
      <label><span>令牌</span><input value={token} onChange={(e) => setToken(e.target.value)} placeholder={compact ? '不改就留空' : 'auth.json 里的 token'} type="password" autoComplete="off" /></label>
      {note && <p className="wk-err" role="alert">{note}</p>}
      <div className="wk-acts">
        <button type="button" className="btn-main" disabled={busy || !url.trim() || (!compact && !token.trim())} onClick={save}>{busy ? '正在存…' : '保存'}</button>
        {compact && <button type="button" className="chip" onClick={() => setOpen(false)}>取消</button>}
        {compact && <button type="button" className="chip" onClick={() => api('/api/crew/config', { method: 'PUT', body: { url: '' } }).then(onDone)}>断开</button>}
      </div>
    </section>
  );
}
