/**
 * 07 设置：控制台 + 四个入口（接入 / 功能管理（含 Codex 那边的 MCP）/ 美化 / 用量与日志）。
 * 网址：#/settings   ?p=access|features|beauty|usage   （聊天页右上角「…」进 ?p=beauty）
 * 数据：GET /api/settings/console、/api/connections、/api/features、/api/logs/cache、/api/logs/tools、/api/logs/backend 等
 * （字段见 src/lib/mock.js 和 docs/07-设置.md）
 */
import { useEffect, useRef, useState } from 'react';
import Icon from '../design/icons.jsx';
import { Band, TornBox, Cyanotype } from '../design/paper.jsx';
import Sheet from '../design/Sheet.jsx';
import { api, saveToken, savedToken } from '../lib/api.js';
import { useLoad } from '../lib/useLoad.js';
import { replaceQuery } from '../lib/router.js';
import { THEMES, useTheme, useBeauty } from '../theme/theme.js';
import { Avatar } from './Chat.jsx';
import '../components/chat/chat.css';
import '../components/chat/chatlist.css';
import '../components/settings/settings.css';

const PAGES = {
  access: ['access', '接入'], features: ['features', '功能管理'], beauty: ['beauty', '美化'], usage: ['usage', '用量与日志'],
};
const upload = (file, kind) => { const f = new FormData(); f.append('file', file); f.append('kind', kind); return api('/api/chat/upload', { method: 'POST', form: f, timeout: 60000 }); };
const fmtN = (n) => (n == null ? '—' : n.toLocaleString('en-US'));
const hm = (iso) => { const d = new Date(iso); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };

export default function Settings({ query }) {
  const [p, setP] = useState(PAGES[query.p] ? query.p : null);
  useEffect(() => { setP(PAGES[query.p] ? query.p : null); }, [query.p]);
  const go = (k) => { setP(k); replaceQuery(k ? { p: k } : {}); window.scrollTo(0, 0); };
  if (p) {
    const [en, zh] = PAGES[p];
    return (
      <main className="settings sub">
        <header className="st-head sub">
          <button type="button" className="rbtn" aria-label="返回设置" onClick={() => go(null)}><Icon name="back" size={18} stroke={1.5} /></button>
          <h1><span className="hand">{en}</span><span>{zh}</span></h1>
        </header>
        <Band tone="l1" seed={82 + Object.keys(PAGES).indexOf(p)} className="st-band">
          {p === 'access' && <Access />}
          {p === 'features' && <Features />}
          {p === 'beauty' && <Beauty />}
          {p === 'usage' && <Usage />}
        </Band>
      </main>
    );
  }
  return <Desk go={go} />;
}

/* ---------- 主页：控制台 + 入口 ---------- */
function Desk({ go }) {
  const { data: c } = useLoad('/api/settings/console');
  const { data: f } = useLoad('/api/features');
  const { data: conn } = useLoad('/api/connections');
  const ok = c && c.available !== false;
  const daily = c?.daily || [];
  const max = Math.max(1, ...daily);
  const spark = daily.map((v, i) => `${i ? 'L' : 'M'}${((i * 200) / Math.max(1, daily.length - 1)).toFixed(1)} ${(38 - (v / max) * 30).toFixed(1)}`).join(' ');
  const mcpDown = f?.mcps?.filter((m) => m.on && m.status !== 'ok').length || 0;
  const items = [
    ['access', 'link', '接入', conn?.items ? `${conn.items.filter((x) => x.kind === 'window').length} 个窗口 · ${conn.items.filter((x) => x.kind === 'member').length} 个群成员` : '…', false],
    ['features', 'plug', '功能管理', f?.features ? `${f.features.filter((x) => x.on).length} 个功能在跑 · MCP ${f.mcps.filter((m) => m.on && m.status === 'ok').length} 个连上${mcpDown ? ` · ${mcpDown} 个断开` : ''}` : '…', mcpDown > 0],
    ['beauty', 'brush', '美化', '主题 · 头像 · 聊天背景 · 气泡', false],
    ['usage', 'tool', '用量与日志', ok ? `${c.observed || 0} 次真实用量记录 · 工具调用` : '…', false],
  ];
  return (
    <main className="settings">
      <header className="st-head"><h1><span className="hand">the desk</span><span>设置</span></h1></header>
      <TornBox seed={160} className="st-console">
        <div className="st-c-in">
          <div className="sec-head" style={{ margin: 0 }}><span className="en" style={{ fontSize: 22 }}>console</span><h2 className="zh" style={{ margin: 0, fontSize: 13 }}>控制台</h2><span className="go" style={{ fontSize: 10.5 }}>{c?.now ? `${new Date(c.now).getMonth() + 1}月${new Date(c.now).getDate()}日` : ''}</span></div>
          {!c && <div className="cl-empty">正在算…</div>}
          {c?.available === false && <div className="cl-empty">暂时连不上</div>}
          {ok && (
            <div className="st-nums">
              <div><em>今日 token</em><b className="serif">{fmtN(c.today.tokens)}</b></div>
              <div><em>本月 token</em><b className="serif">{fmtN(c.month.tokens)}</b></div>
              <div><em>本月花费</em><b className="serif">{c.month.cost == null ? '未提供' : <><small>{c.month.currency}</small>{c.month.cost.toFixed(2)}</>}</b></div>
              <div><em>缓存命中率</em><b className="serif">{c.hitRate == null ? '—' : <>{Math.round(c.hitRate * 100)}<small>%</small></>}</b></div>
            </div>
          )}
          {ok && !c.observed && <p className="st-tip">现有回复没有上游回传的 token 用量；新版会请求真实用量，不能核实的数字不会填 0 冒充统计。</p>}
          {ok && c.month.cost == null && <p className="st-tip">金额需由模型供应商返回账单或提供对应模型单价；这里不会估算扣费。</p>}
          {daily.length > 1 && (
            <svg className="st-spark" viewBox="0 0 200 40" aria-hidden="true"><path d={`${spark} L200 40 L0 40Z`} style={{ fill: 'color-mix(in srgb, var(--print-a) 30%, transparent)' }} /><path d={spark} fill="none" stroke="var(--print-c)" strokeWidth="1.6" strokeLinecap="round" /></svg>
          )}
          {daily.length > 1 && <span className="st-spark-k">最近 {daily.length} 天</span>}
        </div>
      </TornBox>
      <Band tone="l1" seed={81} className="st-band">
        {items.map(([k, ic, name, sub, warn]) => (
          <button key={k} type="button" className="card st-item" onClick={() => go(k)}>
            <span className="st-ic"><Icon name={ic} size={19} /></span>
            <span><b>{name}</b><em className={warn ? 'warn' : ''}>{sub}</em></span>
            <Icon name="chev" size={16} stroke={1.4} />
          </button>
        ))}
      </Band>
    </main>
  );
}

/* ---------- 接入 ---------- */
function Access() {
  const { data } = useLoad('/api/connections');
  const [open, setOpen] = useState(null);
  if (!data) return <div className="card cl-empty">正在看…</div>;
  return (
    <>
      <ModelAccess />
      <p className="st-tip">所有聊天窗口使用当前私人后端。模型密钥只保存在 VPS，这里看不到也拿不到。</p>
      {data.items.map((x) => (
        <button key={x.id} type="button" className={`card st-conn ${open === x.id ? 'on' : ''}`} onClick={() => setOpen(open === x.id ? null : x.id)} aria-expanded={open === x.id}>
          <span className="st-cx serif">Cx</span>
          <span><b>{x.name}</b><em>{x.provider} · {x.note}</em></span>
          <span className={`st-dot ${x.status || 'ok'}`}><i />{x.statusText || '在线'}</span>
          {open === x.id && (
            <span className="st-detail">
              {[['调用方式', x.mode || '本机 Codex'], ['工作目录', x.workdir || '…'], ['沙箱', x.sandbox || '只能动工作目录'], ['用在', x.kind === 'member' ? '群聊' : '窗口']].map(([k, v]) => (
                <span key={k} className="rec"><span>{k}</span><i /><b>{v}</b></span>
              ))}
            </span>
          )}
        </button>
      ))}
    </>
  );
}

function ModelAccess() {
  const [secret, setSecret] = useState(savedToken());
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const load = async () => {
    setBusy(true);
    try {
      const cfg = await api('/relay/app/loop/config');
      setRows((cfg.main_chain || []).map((x, i) => ({ ...x, index: x.index ?? i, key: '', models: x.model ? [x.model] : [] })));
      setNote(`已连接私人后端 · ${cfg.main_chain?.length || 0} 个 API`);
    } catch (e) { setNote(e.status === 401 ? '访问密钥不正确，请重新保存' : `暂时连不上：${e.message}`); }
    finally { setBusy(false); }
  };
  useEffect(() => { load(); }, []);
  const update = (i, key, value) => setRows((all) => all.map((r, n) => (n === i ? { ...r, [key]: value, ...(['url', 'key'].includes(key) ? { models: [] } : {}) } : r)));
  const move = (i, by) => setRows((all) => { const next = [...all]; const j = i + by; if (j < 0 || j >= next.length) return all; [next[i], next[j]] = [next[j], next[i]]; return next; });
  const pull = async (i) => {
    const row = rows[i]; setNote(`正在从第 ${i + 1} 个服务商拉取模型…`);
    try {
      const body = { index: row.index, url: row.url }; if (row.key) body.key = row.key;
      const got = await api('/relay/app/loop/models', { method: 'POST', body, timeout: 45000 });
      setRows((all) => all.map((r, n) => (n === i ? { ...r, models: got.models || [], model: (got.models || []).includes(r.model) ? r.model : got.models?.[0] || '' } : r)));
      setNote(`拉到了 ${got.count || got.models?.length || 0} 个模型`);
    } catch (e) { setNote(`拉取失败：${e.message}`); }
  };
  const test = async (i) => {
    const row = rows[i]; setNote('正在测试接口…');
    try {
      const body = { index: row.index, url: row.url, model: row.model }; if (row.key) body.key = row.key;
      const got = await api('/relay/app/loop/test', { method: 'POST', body, timeout: 60000 });
      setNote(got.ok ? `连接成功 · ${got.latency_ms} ms` : `测试失败：${got.error || '未知错误'}`);
    } catch (e) { setNote(`测试失败：${e.message}`); }
  };
  const save = async () => {
    if (rows.some((r) => !r.url || !r.model || (!r.key && Number(r.index) < 0))) { setNote('每一行都需要地址、模型和 Key'); return; }
    setBusy(true); setNote('正在保存，第一行会立刻成为当前 API…');
    try {
      const cfg = await api('/relay/app/loop/config', { method: 'POST', body: { main_chain: rows.map(({ models, key_masked, ...r }) => r) } });
      setRows((cfg.main_chain || []).map((x, i) => ({ ...x, index: x.index ?? i, key: '', models: x.model ? [x.model] : [] })));
      setNote('已保存 · 第一行是当前使用，后面的只在失败时备用');
    } catch (e) { setNote(`保存失败：${e.message}`); }
    finally { setBusy(false); }
  };
  const storeSecret = () => { saveToken(secret); setNote('访问密钥已只保存在这台设备'); load(); };
  return (
    <div className="model-access">
      <div className="sec-head"><span className="en">model api</span><h2 className="zh">模型与 API</h2><span className="go">第一行当前使用</span></div>
      <div className="card ma-secret">
        <label><span>网站访问密钥</span><input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="第一次在这台设备打开时填写" /></label>
        <button type="button" className="mini-btn" onClick={storeSecret}>保存并连接</button>
      </div>
      {rows.map((row, i) => (
        <div className={`card ma-row ${i === 0 ? 'active' : ''}`} key={`${row.index}-${i}`}>
          <div className="ma-head"><b>{i === 0 ? '当前使用 · 优先扣费' : `备用 API ${i}`}</b><span><button type="button" onClick={() => move(i, -1)} disabled={!i}>上移</button><button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1}>下移</button><button type="button" className="danger" onClick={() => setRows((all) => all.filter((_, n) => n !== i))}>删除</button></span></div>
          <label>API 地址<input type="url" value={row.url || ''} onChange={(e) => update(i, 'url', e.target.value)} placeholder="https://example.com/v1" /></label>
          <label>API Key<input type="password" value={row.key || ''} onChange={(e) => update(i, 'key', e.target.value)} placeholder={row.key_masked ? `已保存 ${row.key_masked}，留空不修改` : '粘贴 Key'} /></label>
          <label>模型<select value={row.model || ''} onChange={(e) => update(i, 'model', e.target.value)}><option value="">先拉取模型</option>{[...new Set([row.model, ...(row.models || [])].filter(Boolean))].map((m) => <option key={m}>{m}</option>)}</select></label>
          <label>Prompt Cache<select value={row.cache_mode || 'auto'} onChange={(e) => update(i, 'cache_mode', e.target.value)}><option value="auto">自动识别（OpenRouter 自动开启）</option><option value="explicit">兼容 cache_control 的中转</option><option value="off">关闭</option></select></label>
          {(row.cache_mode || 'auto') !== 'off' && <label>缓存时长<select value={row.cache_ttl || '5m'} onChange={(e) => update(i, 'cache_ttl', e.target.value)}><option value="5m">5 分钟（推荐）</option><option value="1h">1 小时</option></select></label>}
          <p className="ma-cache-note">当前判定：{row.cache_effective === 'explicit' || row.cache_mode === 'explicit' ? '发送缓存断点；不兼容会自动退回普通请求' : row.cache_mode === 'off' ? '不发送缓存字段' : '普通中转不加字段，避免影响回复'}</p>
          <div className="ma-actions"><button type="button" className="mini-btn" onClick={() => pull(i)}>拉取模型</button><button type="button" className="mini-btn" onClick={() => test(i)}>测试此接口</button></div>
        </div>
      ))}
      <div className="ma-actions"><button type="button" className="cl-link" onClick={() => setRows((all) => [...all, { index: -1, url: '', key: '', model: '', models: [] }])}><Icon name="plus" size={15} />添加 API</button><button type="button" className="btn-main" disabled={busy || !rows.length} onClick={save}>保存 API 顺序</button></div>
      <p className="st-tip" role="status">{busy ? '正在处理…' : note}</p>
      <p className="st-tip">这是提示词缓存，不会缓存或复用整段回复。首次请求是写入，前缀足够长且再次命中后才会显示缓存 Token。</p>
    </div>
  );
}

/* ---------- 功能管理（含 MCP） ---------- */
function Features() {
  const { data, setData } = useLoad('/api/features');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', url: '' });
  const [error, setError] = useState('');
  const [addingBusy, setAddingBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editBusy, setEditBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  if (!data) return <div className="card cl-empty">正在看…</div>;
  if (data.available === false) return <div className="card cl-empty">暂时连不上，过一会儿再来看看。</div>;
  const setF = async (key, on) => {
    setError('');
    try { await api(`/api/features/${key}`, { method: 'PUT', body: { on } });
      setData((d) => ({ ...d, features: d.features.map((x) => (x.key === key ? { ...x, on } : x)) }));
    } catch (e) { setError(e?.message || '设置失败'); }
  };
  const setM = async (id, on) => {
    setError('');
    try { await api(`/api/mcp/${id}`, { method: 'PUT', body: { on } });
      setData((d) => ({ ...d, mcps: d.mcps.map((x) => (x.id === id ? { ...x, on } : x)) }));
    } catch (e) { setError(e?.message || '设置失败'); }
  };
  const retry = async (id) => {
    setData((d) => ({ ...d, mcps: d.mcps.map((x) => (x.id === id ? { ...x, status: 'pending' } : x)) }));
    const m = await api(`/api/mcp/${id}/reconnect`, { method: 'POST' });
    setData((d) => ({ ...d, mcps: d.mcps.map((x) => (x.id === id ? { ...x, ...m } : x)) }));
  };
  const add = async () => {
    setError(''); setAddingBusy(true);
    try {
      const m = await api('/api/mcp', { method: 'POST', body: { name: form.name.trim(), url: form.url.trim() }, timeout: 60000 });
      if (m.authorization_url) { window.location.assign(m.authorization_url); return; }
      setData((d) => ({ ...d, mcps: [...d.mcps, m] })); setAdding(false); setForm({ name: '', url: '' });
    } catch (e) { setError(e?.message || '连接失败'); setAddingBusy(false); }
  };
  const openEdit = (x) => { setError(''); setConfirmDel(false); setEditing({ id: x.id, auth: x.auth || 'none', name: x.name, url: x.url || '', always: Boolean(x.always), tools: x.tools || 0 }); };
  const saveEdit = async () => {
    setError(''); setEditBusy(true);
    try {
      const m = await api(`/api/mcp/${encodeURIComponent(editing.id)}`, { method: 'PATCH', body: { name: editing.name.trim(), url: editing.url.trim(), always: editing.always }, timeout: 60000 });
      setData((d) => ({ ...d, mcps: d.mcps.map((x) => (x.id === editing.id ? { ...x, ...m } : x)) })); setEditing(null);
    } catch (e) { setError(e?.message || '保存失败'); }
    setEditBusy(false);
  };
  const remove = async () => {
    if (!confirmDel) { setConfirmDel(true); return; }
    setError(''); setEditBusy(true);
    try {
      await api(`/api/mcp/${encodeURIComponent(editing.id)}`, { method: 'DELETE' });
      setData((d) => ({ ...d, mcps: d.mcps.filter((x) => x.id !== editing.id) })); setEditing(null);
    } catch (e) { setError(e?.message || '删除失败'); }
    setEditBusy(false); setConfirmDel(false);
  };
  const ST = { ok: '', down: '断开 · 点一下重连', pending: '连接中…' };
  return (
    <>
      {error && <p className="ws-err" role="alert">{error}</p>}
      <div className="sec-head"><span className="en" style={{ fontSize: 22 }}>running</span><h2 className="zh" style={{ margin: 0, fontSize: 13 }}>后台在跑的</h2><span className="go">关掉就不跑了</span></div>
      <div className="card st-list">
        {data.features.map((x) => (
          <label key={x.key} className="st-row">
            <span><b>{x.name}</b><em>{x.desc}{x.last ? ` · ${x.last}` : ''}</em></span>
            <input type="checkbox" className="switch" checked={x.on} onChange={(e) => setF(x.key, e.target.checked)} aria-label={x.name} />
          </label>
        ))}
      </div>
      <div className="sec-head" style={{ marginTop: 24 }}><span className="en" style={{ fontSize: 22 }}>mcp</span><h2 className="zh" style={{ margin: 0, fontSize: 13 }}>MCP · Codex 那边</h2><span className="go">他能用的工具</span></div>
      <div className="card st-list">
        {data.mcps.map((x) => (
          <div key={x.id} className="st-row">
            <i className={`st-mdot ${x.on ? x.status : 'off'}`} />
            <span><b>{x.name}</b> <code>{x.id}</code>{x.always && <span className="st-pin">常驻</span>}
              {x.on && x.status === 'down' ? <button type="button" className="st-retry" onClick={() => retry(x.id)}>{ST.down}</button> : <em>{x.on ? ST[x.status] || `${x.tools} 个工具` : '已关'}</em>}
            </span>
            <button type="button" className="st-edit" onClick={() => openEdit(x)} aria-label={`编辑 MCP ${x.name}`}><Icon name="pen" size={15} stroke={1.5} /></button>
            <input type="checkbox" className="switch" checked={x.on} onChange={(e) => setM(x.id, e.target.checked)} aria-label={`MCP ${x.name}`} />
          </div>
        ))}
      </div>
      <button type="button" className="cl-link st-addmcp" onClick={() => setAdding(true)}><Icon name="plus" size={16} stroke={1.5} />加一个 MCP（填地址）</button>
      {adding && (
        <Sheet open onClose={() => setAdding(false)} label="加一个 MCP" seed={87}>
          <div className="sec-head"><span className="en">add mcp</span><h2 className="zh" style={{ margin: 0 }}>加一个 MCP</h2></div>
          <div className="nc-k">名字</div>
          <label className="pill nc-in"><span className="sr">名字</span><input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="比如：日历" /></label>
          <div className="nc-k">地址</div>
          <label className="pill nc-in"><span className="sr">地址</span><input value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} placeholder="MCP 服务的地址" inputMode="url" /></label>
          <p className="st-tip">需要登录的 MCP 会跳转到服务方授权；访问令牌只保存在 VPS，不会暴露给浏览器。</p>
          <button type="button" className="btn-main nc-go" disabled={addingBusy || !form.name.trim() || !form.url.trim()} onClick={add}>{addingBusy ? '正在检查并连接…' : '加上'}</button>
        </Sheet>
      )}
      {editing && (
        <Sheet open onClose={() => setEditing(null)} label="编辑 MCP" seed={88}>
          <div className="sec-head"><span className="en">edit mcp</span><h2 className="zh" style={{ margin: 0 }}>编辑 MCP</h2></div>
          {error && <p className="ws-err" role="alert">{error}</p>}
          <div className="nc-k">名字</div>
          <label className="pill nc-in"><span className="sr">名字</span><input value={editing.name} disabled={editing.auth !== 'none'} onChange={(e) => setEditing((f) => ({ ...f, name: e.target.value }))} /></label>
          <div className="nc-k">地址</div>
          <label className="pill nc-in"><span className="sr">地址</span><input value={editing.url} disabled={editing.auth !== 'none'} onChange={(e) => setEditing((f) => ({ ...f, url: e.target.value }))} placeholder="MCP 服务的地址" inputMode="url" /></label>
          <p className="st-tip">{editing.auth !== 'none' ? '这个 MCP 带授权，名字和地址改不了；想换的话删掉后重新加一次。' : '保存后会用新地址重新连接一次。'}</p>
          <label className="st-row st-always">
            <span><b>常驻</b><em>每一轮都把它的 {editing.tools} 个工具交给他，不用聊到它的名字；会多花一些 token</em></span>
            <input type="checkbox" className="switch" checked={editing.always} onChange={(e) => setEditing((f) => ({ ...f, always: e.target.checked }))} aria-label="常驻" />
          </label>
          <button type="button" className="btn-main nc-go" disabled={editBusy || !editing.name.trim() || !editing.url.trim()} onClick={saveEdit}>{editBusy && !confirmDel ? '正在保存并重连…' : '保存'}</button>
          <button type="button" className={`cl-link st-delmcp${confirmDel ? ' on' : ''}`} disabled={editBusy} onClick={remove}><Icon name="trash" size={15} stroke={1.5} />{confirmDel ? '再点一下，确定删除' : '删除这个 MCP'}</button>
        </Sheet>
      )}
      <GardenWake />
    </>
  );
}

/* ---------- Galatea 花园唤醒桥 ---------- */
// 桥是「断了就停」的设计：不自动重连、不自动拉起。这里只有她亲手点的「检查」「启动」。
const GARDEN_STATE = { active: ['ok', '在线 · 花园有事会叫醒他'], activating: ['pending', '正在连接…'], inactive: ['off', '没在运行'], failed: ['down', '已断开（出错停下了）'] };
function GardenWake() {
  const { data, setData, reload } = useLoad('/api/garden');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [showLog, setShowLog] = useState(false);
  if (!data || data.available === false) return null;
  const run = async (what, fn) => {
    setBusy(what); setNote('');
    try { await fn(); } catch (e) { setNote(e?.message || '没成功'); }
    setBusy('');
  };
  const saveToken = () => run('token', async () => { setData(await api('/api/garden/token', { method: 'POST', body: { token: token.trim() } })); setToken(''); setNote('令牌已保存在 VPS 上。'); });
  const check = () => run('check', async () => { const r = await api('/api/garden/check', { method: 'POST', timeout: 45000 }); setNote(r.ok ? '握手成功，令牌和花园都没问题。' : `检查没通过：${r.output || r.code}`); });
  const start = () => run('start', async () => { setData(await api('/api/garden/start', { method: 'POST', timeout: 45000 })); });
  const stop = () => run('stop', async () => { setData(await api('/api/garden/stop', { method: 'POST', timeout: 45000 })); });
  const [dot, label] = GARDEN_STATE[data.state] || ['off', '状态未知'];
  const RESULT = { received: '收到', message: '他去处理了，还跟你说了话', silent: '他去处理了，没打扰你', error: '这次没处理成功', skipped: '跳过' };
  return (
    <>
      <div className="sec-head" style={{ marginTop: 24 }}><span className="en" style={{ fontSize: 22 }}>garden</span><h2 className="zh" style={{ margin: 0, fontSize: 13 }}>花园唤醒</h2><span className="go">Galatea Garden</span></div>
      <div className="card st-list st-garden">
        {!data.installed || !data.node ? (
          <p className="st-tip">{!data.installed ? '服务器上还没装唤醒桥，先跑一次部署脚本。' : '服务器上没有 Node 20+，唤醒桥跑不起来。'}</p>
        ) : (
          <>
            <div className="st-row">
              <i className={`st-mdot ${dot}`} />
              <span><b>{label}</b><em>{data.configured ? '机器令牌已设置' : '还没填机器令牌'}{data.node ? ` · Node ${data.node}` : ''}</em></span>
              <button type="button" className="mini-btn st-gbtn" onClick={() => reload()}>刷新</button>
            </div>
            <label className="pill nc-in st-gtoken"><span className="sr">机器令牌</span><input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={data.configured ? '换一个新令牌（留空不改）' : '粘贴花园给这台机器的令牌'} autoComplete="off" /></label>
            <div className="st-gacts">
              <button type="button" className="mini-btn" disabled={!token.trim() || !!busy} onClick={saveToken}>{busy === 'token' ? '保存中…' : '保存令牌'}</button>
              <button type="button" className="mini-btn" disabled={!data.configured || !!busy} onClick={check}>{busy === 'check' ? '检查中…' : '检查连接'}</button>
              {data.state === 'active' || data.state === 'activating'
                ? <button type="button" className="mini-btn" disabled={!!busy} onClick={stop}>{busy === 'stop' ? '停止中…' : '停止'}</button>
                : <button type="button" className="mini-btn" disabled={!data.configured || !!busy} onClick={start}>{busy === 'start' ? '启动中…' : '启动'}</button>}
            </div>
            {note && <p className="st-tip st-gnote" role="status">{note}</p>}
            <p className="st-tip">唤醒桥断开后不会自己重连，这是花园要求的。看到「已断开」时，先看下面的记录找原因，再点「检查连接」，没问题了再点「启动」。</p>
            {data.wakes?.length > 0 && (
              <div className="st-gwakes">
                {data.wakes.map((w, i) => <div key={i}><time>{hm(w.at)}</time>{RESULT[w.result] || w.result}{w.result === 'received' ? `：${w.detail}` : ''}</div>)}
              </div>
            )}
            {data.log?.length > 0 && (
              <>
                <button type="button" className="st-retry" onClick={() => setShowLog((v) => !v)}>{showLog ? '收起运行记录' : '看运行记录'}</button>
                {showLog && <pre className="st-glog">{data.log.join('\n')}</pre>}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

/* ---------- 美化 ---------- */
function Beauty() {
  const [theme, setTheme] = useTheme();
  const [beauty, setBeauty] = useBeauty();
  const [wall, setWall] = useState(null);
  const [tip, setTip] = useState('');
  const avIn = useRef(null), wallIn = useRef(null);
  const who = useRef('him');
  const flash = (t) => { setTip(t); setTimeout(() => setTip(''), 1800); };
  useEffect(() => {
    api('/api/settings/beauty').then((saved) => {
      if (saved.beauty && Object.keys(saved.beauty).length) setBeauty(saved.beauty);
      if (saved.beauty?.wallpaper) setWall(saved.beauty.wallpaper);
    }).catch((e) => flash(e?.message || '暂时读不到美化设置'));
  }, []);
  const save = async (next) => {
    const previous = beauty;
    setBeauty(next);
    try { await api('/api/settings/beauty', { method: 'PUT', body: next }); }
    catch (e) { setBeauty(previous); flash(e?.message || '美化设置保存失败'); }
  };
  const pickAvatar = async (f) => {
    if (!f) return;
    try {
      const u = await upload(f, 'avatar');
      await api('/api/settings/avatar', { method: 'PUT', body: { who: who.current, url: u.url } });
      flash('头像换好了，重新进入聊天即可看到');
    } catch (e) { flash(e?.message || '头像保存失败'); }
  };
  const pickWall = async (f) => {
    if (!f) return;
    try {
      const u = await upload(f, 'wallpaper');
      await api('/api/settings/beauty', { method: 'PUT', body: { ...beauty, wallpaper: u.url } });
      setWall(u.url); setBeauty({ ...beauty, wallpaper: u.url }); flash('聊天背景换好了');
    } catch (e) { flash(e?.message || '背景保存失败'); }
  };
  const STYLES = [['glass', '磨砂玻璃'], ['paper', '纸片'], ['cyan', '蓝晒信纸']];
  return (
    <>
      <div className="nc-k" style={{ marginTop: 0 }}>主题色</div>
      <div className="st-themes" role="radiogroup" aria-label="主题色">
        {THEMES.map((t) => (
          <button key={t.id} type="button" role="radio" aria-checked={theme === t.id} className={`st-theme ${theme === t.id ? 'on' : ''}`} data-preview={t.id} onClick={() => setTheme(t.id)}>
            <i style={{ background: t.swatch }} /><span>{t.name}{theme === t.id ? ' ✓' : ''}</span>
          </button>
        ))}
      </div>
      <div className="card st-avs">
        <span className="st-avs-k">头像</span>
        <button type="button" onClick={() => { who.current = 'him'; avIn.current.click(); }} aria-label="换他的头像"><span className="st-av"><Avatar m={{ id: 'him' }} size={40} /></span>他</button>
        <button type="button" onClick={() => { who.current = 'me'; avIn.current.click(); }} aria-label="换我的头像"><span className="st-av"><Avatar m={{ id: 'me', name: '我', color: '#AED0EE' }} size={40} /></span>你</button>
        <span className="st-avs-go">点头像换</span>
      </div>
      <div className="nc-k">聊天背景</div>
      <div className="st-walls">
        <button type="button" className={`st-wall ${!beauty.wallpaper ? 'on' : ''}`} onClick={() => save({ ...beauty, wallpaper: null })}><Cyanotype w={104} h={110} seed={7} develop={false} /><span>默认 · 虚化</span></button>
        {wall && <button type="button" className="st-wall on"><span className="st-wall-u">你选的</span></button>}
        <button type="button" className="st-wall add" onClick={() => wallIn.current.click()}>＋ 相册</button>
      </div>
      <div className="nc-k">气泡</div>
      <div className="st-bprev" data-bubble={beauty.bubble} style={{ '--bubble-alpha': beauty.alpha }}>
        <div className="st-bprev-bg"><Cyanotype w={342} h={150} seed={6} develop={false} /></div>
        <div className="cm-bubble him">今天也辛苦了。</div>
        <div className="cm-bubble me">你也是 ฅ</div>
        <span>实时预览</span>
      </div>
      <div className="st-bstyles" role="radiogroup" aria-label="气泡样式">
        {STYLES.map(([k, n]) => <button key={k} type="button" role="radio" aria-checked={beauty.bubble === k} className={`chip ${beauty.bubble === k ? 'on' : ''}`} onClick={() => save({ ...beauty, bubble: k })}>{n}</button>)}
      </div>
      <label className="st-alpha"><span>透明度</span>
        <input type="range" min="0.2" max="0.95" step="0.01" value={beauty.alpha} onChange={(e) => setBeauty({ ...beauty, alpha: Number(e.target.value) })} onPointerUp={() => save(beauty)} />
        <b className="serif">{Math.round(beauty.alpha * 100)}%</b>
      </label>
      {tip && <div className="rm-tip" role="status">{tip}</div>}
      <input ref={avIn} type="file" accept="image/*" hidden onChange={(e) => { pickAvatar(e.target.files[0]); e.target.value = ''; }} />
      <input ref={wallIn} type="file" accept="image/*" hidden onChange={(e) => { pickWall(e.target.files[0]); e.target.value = ''; }} />
    </>
  );
}

/* ---------- 用量与日志 ---------- */
function Usage() {
  const [tab, setTab] = useState('cache');
  const [range, setRange] = useState('today');
  const cache = useLoad(tab === 'cache' ? `/api/logs/cache?range=${range}` : null);
  const tools = useLoad(tab === 'tools' ? '/api/logs/tools' : null);
  const back = useLoad(tab === 'backend' ? '/api/logs/backend' : null);
  return (
    <>
      <div className="st-seg" role="tablist">
        {[['cache', '缓存命中'], ['tools', '工具调用'], ['backend', '运行记录']].map(([k, n]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{n}</button>)}
      </div>
      {tab === 'cache' && (
        <>
          <div className="sec-head" style={{ marginTop: 18 }}><span className="en" style={{ fontSize: 22 }}>cache</span><h2 className="zh" style={{ margin: 0, fontSize: 13 }}>各个窗口的缓存命中</h2>
            <button type="button" className="go" onClick={() => setRange((r) => (r === 'today' ? 'month' : 'today'))}>{range === 'today' ? '今天' : '本月'} ⇄</button></div>
          <p className="st-tip">只统计模型接口实际回传的输入与缓存 token；未回传的调用不会被猜测。</p>
          {!cache.data && <div className="card cl-empty">正在算…</div>}
          {cache.data && !cache.data.items?.length && <div className="card cl-empty">当前没有可核实的缓存用量。新回复产生后再来看。</div>}
          {cache.data?.items?.map((x) => {
            const pct = Math.round((x.hitTokens / Math.max(1, x.inputTokens)) * 100);
            const lv = pct >= 70 ? 'hi' : pct >= 50 ? 'mid' : 'lo';
            const tr = (x.trend || []).map((v, i) => `${i ? 'L' : 'M'}${i * 9} ${(26 - (v - 25) * 0.4).toFixed(1)}`).join(' ');
            return (
              <div key={x.chatId} className={`card st-cache ${lv}`}>
                <div className="st-cache-h"><b>{x.name}</b><span>{x.sub}</span><strong className="serif">{pct}<small>%</small></strong></div>
                <div className="st-cache-bar"><i style={{ width: `${pct}%` }} /></div>
                <div className="st-cache-f"><span>命中 <b className="serif">{x.hitTokens.toLocaleString('en-US')}</b> / {x.inputTokens.toLocaleString('en-US')} token</span>{x.saved != null && <span>省下 <b>{cache.data.currency}{x.saved.toFixed(2)}</b></span>}
                  {tr && <svg viewBox="0 0 56 30" aria-hidden="true"><path d={tr} fill="none" strokeWidth="1.6" /></svg>}</div>
              </div>
            );
          })}
          <p className="st-tip">缓存金额取决于供应商的实际计费，未提供单价时不估算。</p>
        </>
      )}
      {tab === 'tools' && (
        <>
          {!tools.data && <div className="card cl-empty st-gap">正在翻…</div>}
          {tools.data?.items?.map((x) => (
            <div key={x.id} className={`card st-call ${x.ok ? '' : 'warn'}`}>
              <span className="serif">{hm(x.at)}</span>
              <span><b>{x.title}</b><em><code>{x.tool}</code> · {x.detail}</em></span>
              <span className="serif st-ms">{(x.ms / 1000).toFixed(1)}s</span>
            </div>
          ))}
        </>
      )}
      {tab === 'backend' && (
        <div className="st-log">
          {!back.data && <div>正在翻…</div>}
          {back.data && !back.data.items?.length && <div>目前没有工具运行或模型接口错误记录。</div>}
          {back.data?.items?.map((x, i) => <div key={i}><span className={`lv ${x.level}`}>{x.level.toUpperCase()}</span> {hm(x.at)} {x.text}</div>)}
        </div>
      )}
    </>
  );
}
