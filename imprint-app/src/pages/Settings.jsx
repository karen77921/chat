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
import { api, saveToken, savedToken, uploadFile, authedImageUrl } from '../lib/api.js';
import { shrinkImage } from '../lib/image.js';
import { useLoad } from '../lib/useLoad.js';
import { replaceQuery } from '../lib/router.js';
import { THEMES, useTheme, useBeauty } from '../theme/theme.js';
import themeArt from '../design/ballet/stickers/bunny2.webp';
import { Avatar } from './Chat.jsx';
import CacheCheck from '../components/settings/CacheCheck.jsx';
import { pushStatus, enablePush, disablePush, testPush } from '../lib/push.js';
import '../components/chat/chat.css';
import '../components/chat/chatlist.css';
import '../components/settings/settings.css';

const PAGES = {
  access: ['access', '接入'], persona: ['persona', '他的人设'], prompts: ['prompts', '额外提示词'], walls: ['his walls', '他的墙'], features: ['features', '功能管理'], history: ['chat history', '聊天记录'], cache: ['cache check', '缓存体检'], beauty: ['beauty', '美化'], usage: ['usage', '用量与日志'],
};
// 头像、壁纸走和聊天发图同一条路：先压小，直接交给中继，显示进度，断了自动重传（以前 1 分钟传不完就悄悄失败）
const upload = async (file, kind, onProgress) => uploadFile(await shrinkImage(file), { onProgress });
const fmtN = (n) => (n == null ? '—' : n.toLocaleString('en-US'));
const hm = (iso) => { const d = new Date(iso); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
const hms = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`; };
const resetIn = (iso, now) => {
  const ms = new Date(iso).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return '即将重置';
  const mins = Math.ceil(ms / 60000), days = Math.floor(mins / 1440), hours = Math.floor((mins % 1440) / 60), rest = mins % 60;
  if (days) return `${days}天${hours}小时后重置`;
  if (hours) return `${hours}小时${rest}分后重置`;
  return `${rest}分钟后重置`;
};

function QuotaCard({ state }) {
  const { data, setData } = state;
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(timer); }, []);
  const refresh = async () => {
    setBusy(true);
    try { setData(await api('/api/subscription/quota?refresh=1')); }
    catch (e) { setData({ available: false, reason: e?.message || '额度暂时读取不到' }); }
    setBusy(false);
  };
  return (
    <section className="card st-quota" aria-label="Claude 订阅额度">
      <div className="st-quota-head">
        <span className="st-quota-model">{data?.model || 'Claude 订阅'}{data?.effort ? ` · ${data.effort}` : ''}</span>
        <button type="button" onClick={refresh} disabled={busy}>{busy ? '刷新中…' : data?.updatedAt ? `更新 ${hms(data.updatedAt)} · 刷新` : '刷新'}</button>
      </div>
      {!data && <div className="st-quota-empty">正在读额度…</div>}
      {data?.available === false && <div className="st-quota-empty">{data.reason || '额度暂时读取不到'}</div>}
      {data?.available && (data.windows || []).map((row) => {
        const pct = Math.round(Number(row.usedPercent) || 0);
        return (
          <div className="st-quota-row" key={row.key}>
            <div><b>{row.label}</b><span>{resetIn(row.resetsAt, now)}</span><strong>已用 {pct}%</strong></div>
            <div className="st-quota-bar"><i style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div>
          </div>
        );
      })}
      {data?.available && !(data.windows || []).length && <div className="st-quota-empty">官方暂时没有返回额度窗口</div>}
      {data?.stale && <p className="st-quota-note">{data.reason}</p>}
      {data?.available && <p className="st-quota-note">{data.subscription ? `${data.subscription.toUpperCase()} 订阅` : 'Claude 订阅'} · 数字来自 Claude 官方额度接口</p>}
    </section>
  );
}

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
          {p === 'persona' && <Persona />}
          {p === 'prompts' && <Prompts />}
          {p === 'walls' && <Walls />}
          {p === 'features' && <Features />}
          {p === 'history' && <ChatHistory />}
          {p === 'cache' && <CacheCheck />}
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
  const quota = useLoad('/api/subscription/quota');
  const { data: f } = useLoad('/api/features');
  const { data: conn } = useLoad('/api/connections');
  const { data: persona } = useLoad('/api/persona');
  const { data: prompts } = useLoad('/api/prompts');
  const { data: walls } = useLoad('/api/walls');
  const asks = walls?.proposals?.filter((x) => x.status === 'pending').length || 0;
  const ok = c && c.available !== false;
  const daily = c?.daily || [];
  const max = Math.max(1, ...daily);
  const spark = daily.map((v, i) => `${i ? 'L' : 'M'}${((i * 200) / Math.max(1, daily.length - 1)).toFixed(1)} ${(38 - (v / max) * 30).toFixed(1)}`).join(' ');
  const mcpDown = f?.mcps?.filter((m) => m.on && m.status !== 'ok').length || 0;
  const items = [
    ['access', 'link', '接入', conn?.items ? `${conn.items.filter((x) => x.kind === 'window').length} 个窗口 · ${conn.items.filter((x) => x.kind === 'member').length} 个群成员` : '…', false],
    ['persona', 'feather', '他的人设', persona?.text != null ? `写给他的 prompt · ${persona.text.length} 字` : '…', false],
    ['prompts', 'sparkle', '额外提示词', prompts?.items ? (prompts.items.length ? `${prompts.items.filter((x) => x.on).length} 条开着 · 共 ${prompts.items.length} 条` : '不改人设，另外给他加的话') : '…', false],
    ['walls', 'feather', '他的墙', walls?.notes ? `他给自己定了 ${walls.notes.length} 条约定${asks ? ` · ${asks} 条改墙提议等你看` : ''}` : '…', asks > 0],
    ['features', 'plug', '功能管理', f?.features ? `${f.features.filter((x) => x.on).length} 个功能在跑 · MCP ${f.mcps.filter((m) => m.on && m.status === 'ok').length} 个连上${mcpDown ? ` · ${mcpDown} 个断开` : ''}` : '…', mcpDown > 0],
    ['history', 'chat', '聊天记录', '数一数 · 导出成文件存到手机', false],
    ['cache', 'sparkle', '缓存体检', '能不能缓存 · 工具多不多收 · 是不是正牌', false],
    ['beauty', 'brush', '美化', '主题 · 头像 · 聊天背景 · 气泡', false],
    ['usage', 'tool', '用量与日志', ok ? `${c.observed || 0} 次真实用量记录 · 工具调用` : '…', false],
  ];
  return (
    <main className="settings">
      <header className="st-head"><h1><span className="hand">the desk</span><span>设置</span></h1></header>
      <QuotaCard state={quota} />
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

/* ---------- 他的人设：写给他的 prompt，每一轮都会读，所有聊天窗口共用 ---------- */
function Persona() {
  const { data, setData } = useLoad('/api/persona');
  const [text, setText] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => { if (data?.text != null && text == null) setText(data.text); }, [data, text]);
  if (!data) return <div className="card st-pad">正在读…</div>;
  if (data.available === false) return <div className="card st-pad">暂时连不上，过一会儿再来。</div>;
  const value = text ?? '';
  const dirty = value !== data.text;
  const save = async () => {
    setBusy(true); setNote('');
    try {
      const saved = await api('/api/persona', { method: 'PUT', body: { text: value } });
      setData(saved); setText(saved.text); setNote('保存好了，他下一句话就按新的来。');
    } catch (e) { setNote(e?.message || '没保存上，再试一次'); }
    setBusy(false);
  };
  return (
    <>
      <p className="st-tip">这里写的是他的「人设」：他是谁、你们的关系、说话的方式、他要记住的规矩。他每说一句话之前都会先读一遍，所有聊天窗口共用这一份。</p>
      <textarea className="card st-persona" value={value} onChange={(e) => { setText(e.target.value); setNote(''); }}
        placeholder="比如：你是季宁，她的哥哥……" spellCheck={false} aria-label="他的人设" />
      <div className="st-persona-f">
        <span>{value.length} 字{dirty ? ' · 还没保存' : ''}</span>
        <span className="st-gacts" style={{ margin: 0 }}>
          {dirty && <button type="button" className="mini-btn" disabled={busy} onClick={() => { setText(data.text); setNote(''); }}>撤回改动</button>}
          <button type="button" className="mini-btn" disabled={busy || !dirty || !value.trim()} onClick={save}>{busy ? '保存中…' : '保存'}</button>
        </span>
      </div>
      {note && <p className="st-tip" role="status">{note}</p>}
      <p className="st-tip">小提示：越长他每轮读得越多，回复会稍慢、也更费钱。时间、记忆、聊天记录这些系统会自动给他，不用写在这里。</p>
    </>
  );
}

/* ---------- 额外提示词：不动人设，另外一条条加给他，每条能单独开关 ---------- */
function Prompts() {
  const { data, setData } = useLoad('/api/prompts');
  const [edit, setEdit] = useState(null); // { id?, title, text, on }
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  if (!data) return <div className="card st-pad">正在读…</div>;
  if (data.available === false) return <div className="card st-pad">暂时连不上，过一会儿再来。</div>;
  const items = data.items || [];
  const push = async (next, done) => {
    setBusy(true); setNote('');
    try { setData(await api('/api/prompts', { method: 'PUT', body: { items: next } })); done?.(); }
    catch (e) { setNote(e?.message || '没保存上，再试一次'); }
    setBusy(false);
  };
  const save = () => {
    const row = { ...edit, title: edit.title.trim(), text: edit.text.trim() };
    const next = row.id ? items.map((x) => (x.id === row.id ? row : x)) : [...items, row];
    push(next, () => setEdit(null));
  };
  const remove = () => push(items.filter((x) => x.id !== edit.id), () => setEdit(null));
  const toggle = (row) => push(items.map((x) => (x.id === row.id ? { ...x, on: !x.on } : x)));
  return (
    <>
      <p className="st-tip">不改人设，另外写给他的话：规矩、约定、最近要注意的事都可以放这里。每条能单独开关，开着的他每说一句话都会读到，和人设一样要遵守。</p>
      {items.length === 0 && <div className="card st-pad">还没有。点下面「加一条」。</div>}
      <div className="st-prompts">
        {items.map((row) => (
          <div key={row.id} className={`card st-prompt ${row.on ? '' : 'off'}`}>
            <button type="button" className="st-prompt-t" onClick={() => setEdit({ ...row })}>
              <b>{row.title || '没写标题'}</b><em>{row.text}</em>
            </button>
            <input type="checkbox" className="switch" checked={row.on} disabled={busy} onChange={() => toggle(row)} aria-label={`${row.title || '这一条'}：${row.on ? '开着' : '关着'}`} />
          </div>
        ))}
      </div>
      <button type="button" className="cl-link st-addmcp" onClick={() => setEdit({ title: '', text: '', on: true })} disabled={items.length >= 30}><Icon name="plus" size={16} stroke={1.5} />加一条</button>
      {note && !edit && <p className="st-tip" role="status">{note}</p>}
      {edit && (
        <Sheet open onClose={() => setEdit(null)} label={edit.id ? '改这一条' : '加一条提示词'} seed={44}>
          <div className="st-prompt-edit">
            <label className="pill"><span className="sr">标题</span><input value={edit.title} maxLength={60} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="标题，比如：小金库规矩" /></label>
            <textarea className="card st-persona short" value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} placeholder="要他读到的内容…" aria-label="提示词内容" />
            <div className="st-persona-f"><span>{edit.text.length} 字</span><span>{edit.on ? '开着' : '关着'}</span></div>
            {note && <p className="st-tip" role="status">{note}</p>}
            <button type="button" className="btn-main" disabled={busy || !edit.text.trim()} onClick={save}>{busy ? '保存中…' : '保存'}</button>
            {edit.id && <button type="button" className="cl-link st-delmcp" disabled={busy} onClick={remove}><Icon name="trash" size={15} stroke={1.5} />删掉这一条</button>}
          </div>
        </Sheet>
      )}
    </>
  );
}

/* ---------- 他的墙：他给自己定的约定（她只能开关）和他想改核心规则的提议（她点头才改） ---------- */
const WALL_STATUS = { pending: '等你看', approved: '你同意了 · 还没改', declined: '你没同意', done: '已经改好' };
function Walls() {
  const { data, setData } = useLoad('/api/walls');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(null);
  const [reply, setReply] = useState('');
  if (!data) return <div className="card st-pad">正在读…</div>;
  if (data.available === false) return <div className="card st-pad">暂时连不上，过一会儿再来。</div>;
  const post = async (path, body, done) => {
    setBusy(true); setNote('');
    try { setData(await api(path, { method: 'POST', body })); done?.(); }
    catch (e) { setNote(e?.message || '没保存上，再试一次'); }
    setBusy(false);
  };
  const decide = (status) => post(`/api/walls/proposals/${open.id}`, { status, reply: reply.trim() }, () => { setOpen(null); setReply(''); });
  const ticket = (x) => `他的改墙提议：${x.title}\n哪里：${x.where || '（没写）'}\n为什么：${x.why}\n想改成：${x.suggestion}${x.reply ? `\n我说：${x.reply}` : ''}`;
  const copy = async (list) => {
    try { await navigator.clipboard.writeText(list.map(ticket).join('\n\n———\n\n')); setNote(`复制好了${list.length > 1 ? `（${list.length} 条）` : ''}，发给 cc 就行`); }
    catch { setNote('复制不了，长按文字手动复制吧'); }
  };
  const notes = data.notes || [];
  const asks = data.proposals || [];
  return (
    <>
      <p className="st-tip">他每一轮都看得见发给他的全部内容。下面是他自己写给自己的约定，每句话都会读到；内容只有他能改，你可以先关掉哪一条。</p>
      {notes.length === 0 && <div className="card st-pad">他还没给自己定约定。</div>}
      <div className="st-prompts">
        {notes.map((row) => (
          <div key={row.id} className={`card st-prompt ${row.on ? '' : 'off'}`}>
            <div className="st-prompt-t"><b>{row.title || '没写标题'}</b><em className="wrap">{row.text}</em></div>
            <input type="checkbox" className="switch" checked={row.on} disabled={busy} onChange={() => post(`/api/walls/notes/${row.id}`, { on: !row.on })} aria-label={`${row.title || '这一条'}：${row.on ? '开着' : '关着'}`} />
          </div>
        ))}
      </div>
      <p className="st-tip" style={{ marginTop: 22 }}>核心规则他不能直接改。觉得哪行在推他做不对的事，他会写成提议放在这里：你同意了，就复制给 cc 改；改好之后点「已经改好」，他会知道。</p>
      {asks.length === 0 && <div className="card st-pad">还没有提议。</div>}
      {asks.filter((x) => x.status === 'approved').length > 1 && (
        <button type="button" className="cl-link st-addmcp" onClick={() => copy(asks.filter((x) => x.status === 'approved'))}>把同意了还没改的 {asks.filter((x) => x.status === 'approved').length} 条一起复制给 cc</button>
      )}
      <div className="st-prompts">
        {asks.map((x) => (
          <button key={x.id} type="button" className={`card st-prompt ${x.status === 'pending' ? '' : 'off'}`} onClick={() => { setOpen(x); setReply(x.reply || ''); }}>
            <span className="st-prompt-t"><b>{x.title}</b><em>{WALL_STATUS[x.status] || x.status} · {x.why}</em></span>
            <Icon name="chev" size={16} stroke={1.4} />
          </button>
        ))}
      </div>
      {note && !open && <p className="st-tip" role="status">{note}</p>}
      {open && (
        <Sheet open onClose={() => setOpen(null)} label={open.title} seed={45}>
          <div className="st-prompt-edit st-wall-ask">
            {open.where && <p><b>哪里</b>{open.where}</p>}
            <p><b>为什么</b>{open.why}</p>
            <p><b>想改成</b>{open.suggestion}</p>
            <textarea className="card st-persona short" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="想跟他说点什么（可以不写）" aria-label="回他" />
            {note && <p className="st-tip" role="status">{note}</p>}
            {open.status === 'pending' && <button type="button" className="btn-main" disabled={busy} onClick={() => decide('approved')}>同意</button>}
            {open.status === 'pending' && <button type="button" className="cl-link" disabled={busy} onClick={() => decide('declined')}>不同意</button>}
            {open.status === 'approved' && <button type="button" className="btn-main" onClick={() => copy([open])}>复制给 cc</button>}
            {open.status === 'approved' && <button type="button" className="cl-link" disabled={busy} onClick={() => decide('done')}>已经改好了</button>}
          </div>
        </Sheet>
      )}
    </>
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
  const [tab, setTab] = useState('subscription');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const isSubscription = (row) => /^(claude-subscription|claude-code):\/\//.test(String(row?.url || ''));
  const load = async () => {
    setBusy(true);
    try {
      const cfg = await api('/relay/app/loop/config');
      const next = (cfg.main_chain || []).map((x, i) => ({ ...x, index: x.index ?? i, key: '', models: x.model ? [x.model] : [] }));
      setRows(next);
      if (next.length) setTab(isSubscription(next[0]) ? 'subscription' : 'api');
      setNote(`已连接私人后端 · ${next.filter(isSubscription).length} 个订阅，${next.filter((x) => !isSubscription(x)).length} 个 API`);
    } catch (e) { setNote(e.status === 401 ? '访问密钥不正确，请重新保存' : `暂时连不上：${e.message}`); }
    finally { setBusy(false); }
  };
  useEffect(() => { load(); }, []);
  const update = (i, key, value) => setRows((all) => all.map((r, n) => (n === i ? { ...r, [key]: value, ...(['url', 'key'].includes(key) ? { models: [] } : {}) } : r)));
  const move = (i, by) => setRows((all) => {
    const mine = isSubscription(all[i]);
    const group = all.map((r, n) => (isSubscription(r) === mine ? n : -1)).filter((n) => n >= 0);
    const at = group.indexOf(i); const j = group[at + by];
    if (at < 0 || j == null) return all;
    const next = [...all]; [next[i], next[j]] = [next[j], next[i]]; return next;
  });
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
      const body = { index: row.index, url: row.url, model: row.model, effort: row.effort || 'high' }; if (row.key) body.key = row.key;
      const got = await api('/relay/app/loop/test', { method: 'POST', body, timeout: 60000 });
      setNote(got.ok ? `连接成功 · ${got.latency_ms} ms` : `测试失败：${got.error || '未知错误'}`);
    } catch (e) { setNote(`测试失败：${e.message}`); }
  };
  const saveRows = async (nextRows, success = '已保存 · 当前线路和备用顺序已经更新') => {
    if (nextRows.some((r) => !r.url || !r.model || (!isSubscription(r) && !r.key && Number(r.index) < 0))) { setNote('API 需要地址、模型和 Key；订阅需要选择模型'); return false; }
    setBusy(true); setNote('正在保存线路设置…');
    try {
      const cfg = await api('/relay/app/loop/config', { method: 'POST', body: { main_chain: nextRows.map(({ models, key_masked, ...r }) => r) } });
      setRows((cfg.main_chain || []).map((x, i) => ({ ...x, index: x.index ?? i, key: '', models: x.model ? [x.model] : [] })));
      setNote(success); return true;
    } catch (e) { setNote(`保存失败：${e.message}`); return false; }
    finally { setBusy(false); }
  };
  const save = () => saveRows(rows);
  const activate = (i) => {
    const next = [rows[i], ...rows.filter((_, n) => n !== i)];
    setRows(next);
    setTab(isSubscription(next[0]) ? 'subscription' : 'api');
    return saveRows(next, `已切换到${isSubscription(next[0]) ? '订阅' : 'API'} · ${next[0].model}`);
  };
  const storeSecret = () => { saveToken(secret); setNote('访问密钥已只保存在这台设备'); load(); };
  const subscriptionIndexes = rows.map((r, i) => (isSubscription(r) ? i : -1)).filter((i) => i >= 0);
  const apiIndexes = rows.map((r, i) => (!isSubscription(r) ? i : -1)).filter((i) => i >= 0);
  const shownIndexes = tab === 'subscription' ? subscriptionIndexes : apiIndexes;
  const current = rows[0];
  const currentKind = current ? (isSubscription(current) ? '订阅' : 'API') : '尚未设置';
  return (
    <div className="model-access">
      <div className="sec-head"><span className="en">model routes</span><h2 className="zh">模型线路</h2><span className="go">订阅和 API 分开管理</span></div>
      <div className="card ma-secret">
        <label><span>网站访问密钥</span><input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="第一次在这台设备打开时填写" /></label>
        <button type="button" className="mini-btn" onClick={storeSecret}>保存并连接</button>
      </div>
      <div className="card ma-now">
        <span>现在由这条线路回复</span><b>{currentKind}</b><em>{current?.model || '还没有选择模型'}{isSubscription(current) && current?.effort ? ` · ${current.effort}` : ''}</em>
      </div>
      <div className="ma-kind" role="tablist" aria-label="模型线路分类">
        <button type="button" role="tab" aria-selected={tab === 'subscription'} className={tab === 'subscription' ? 'on' : ''} onClick={() => setTab('subscription')}><span>订阅</span><small>{subscriptionIndexes.length}</small></button>
        <button type="button" role="tab" aria-selected={tab === 'api'} className={tab === 'api' ? 'on' : ''} onClick={() => setTab('api')}><span>API</span><small>{apiIndexes.length}</small></button>
      </div>
      {tab === 'subscription' && !shownIndexes.length && <div className="card ma-empty"><b>还没有订阅线路</b><span>先在 VPS 登录 Claude 订阅，登录成功后会出现在这里。</span></div>}
      {tab === 'api' && !shownIndexes.length && <div className="card ma-empty"><b>还没有 API</b><span>可以单独添加 Base URL、Key 和模型；不会影响已经登录的订阅。</span></div>}
      {shownIndexes.map((i) => {
        const row = rows[i];
        const group = isSubscription(row) ? subscriptionIndexes : apiIndexes;
        const pos = group.indexOf(i);
        return (
        <div className={`card ma-row ${i === 0 ? 'active' : ''}`} key={`${row.index}-${i}`}>
          {(() => {
            const subscription = isSubscription(row);
            const subscriptionModels = [
              ['claude-haiku-4-5-20251001', 'Haiku 4.5 · 最快'],
              ['claude-sonnet-4-6', 'Sonnet 4.6 · 稳定'],
              ['claude-sonnet-5-5', 'Sonnet 5.5 · 推荐'],
              ['claude-opus-4-6', 'Opus 4.6 · 经典'],
              ['claude-opus-5-5', 'Opus 5.5 · 最强'],
            ];
            const efforts = [['low', '低 · 省额度'], ['medium', '中'], ['high', '高 · 推荐'], ['xhigh', '超高'], ['max', '最大']];
            return <>
          <div className="ma-head"><b>{i === 0 ? `当前使用 · ${subscription ? '订阅额度' : 'API 计费'}` : subscription ? `Claude 订阅 ${pos + 1}` : `API ${pos + 1}`}</b><span><button type="button" onClick={() => move(i, -1)} disabled={!pos}>上移</button><button type="button" onClick={() => move(i, 1)} disabled={pos === group.length - 1}>下移</button><button type="button" className="danger" onClick={() => setRows((all) => all.filter((_, n) => n !== i))}>删除</button></span></div>
          {!subscription && <><label>API 地址<input type="url" value={row.url || ''} onChange={(e) => update(i, 'url', e.target.value)} placeholder="https://example.com/v1" /></label>
          <label>API Key<input type="password" value={row.key || ''} onChange={(e) => update(i, 'key', e.target.value)} placeholder={row.key_masked ? `已保存 ${row.key_masked}，留空不修改` : '粘贴 Key'} /></label></>}
          {subscription ? <>
            <p className="st-tip">Claude 订阅已登录。这里显示并保存实际使用的完整模型版本与思考强度。</p>
            <label>Claude 模型<div className="st-gacts">{subscriptionModels.map(([value, label]) => <button type="button" key={value} className={`chip ${row.model === value ? 'on' : ''}`} onClick={() => update(i, 'model', value)}>{label}</button>)}</div></label>
            <label>思考强度<div className="st-gacts">{efforts.map(([value, label]) => <button type="button" key={value} className={`chip ${(row.effort || 'high') === value ? 'on' : ''}`} onClick={() => update(i, 'effort', value)}>{label}</button>)}</div></label>
            <p className="ma-cache-note">当前：{row.model || '尚未选择'} · 思考强度 {row.effort || 'high'}。订阅缓存由 Claude 自动管理。</p>
          </> : <>
            <label>模型<select value={row.model || ''} onChange={(e) => update(i, 'model', e.target.value)}><option value="">先拉取模型</option>{[...new Set([row.model, ...(row.models || [])].filter(Boolean))].map((m) => <option key={m}>{m}</option>)}</select></label>
            <label>Prompt Cache<select value={row.cache_mode || 'auto'} onChange={(e) => update(i, 'cache_mode', e.target.value)}><option value="auto">自动识别（OpenRouter 自动开启）</option><option value="explicit">兼容 cache_control 的中转</option><option value="off">关闭</option></select></label>
            {(row.cache_mode || 'auto') !== 'off' && <label>缓存时长<select value={row.cache_ttl || '5m'} onChange={(e) => update(i, 'cache_ttl', e.target.value)}><option value="5m">5 分钟（推荐）</option><option value="1h">1 小时</option></select></label>}
            <p className="ma-cache-note">当前判定：{row.cache_effective === 'explicit' || row.cache_mode === 'explicit' ? '发送缓存断点；不兼容会自动退回普通请求' : row.cache_mode === 'off' ? '不发送缓存字段' : '普通中转不加字段，避免影响回复'}</p>
          </>}
          <div className="ma-actions">{i !== 0 && <button type="button" className="mini-btn ma-use" disabled={busy} onClick={() => activate(i)}>切到这边回复</button>}{!subscription && <button type="button" className="mini-btn" onClick={() => pull(i)}>拉取模型</button>}<button type="button" className="mini-btn" onClick={() => test(i)}>{subscription ? '测试订阅' : '测试此接口'}</button></div>
            </>;
          })()}
        </div>
      );})}
      <div className="ma-actions">{tab === 'api' && <button type="button" className="cl-link" onClick={() => setRows((all) => [...all, { index: -1, url: '', key: '', model: '', models: [] }])}><Icon name="plus" size={15} />添加 API</button>}<button type="button" className="btn-main" disabled={busy || !rows.length} onClick={save}>保存{tab === 'subscription' ? '订阅设置' : 'API 设置'}</button></div>
      <p className="st-tip" role="status">{busy ? '正在处理…' : note}</p>
      <p className="st-tip">订阅使用账号额度，API 使用各供应商的 Key 与账单。两边分开管理；切换标签不会改变当前回复线路，只有点“切到这边回复”才会切换。</p>
    </div>
  );
}

/* ---------- 他自带的工具（只看，不开关：好些是配合着用的，关一个可能悄悄坏掉别的） ---------- */
function BuiltinTools() {
  const { data } = useLoad('/api/tools/builtin');
  if (!data?.groups) return null;
  return (
    <>
      <div className="sec-head" style={{ marginTop: 24 }}><span className="en" style={{ fontSize: 22 }}>his own</span><h2 className="zh" style={{ margin: 0, fontSize: 13 }}>他自带的工具 · {data.count} 个</h2></div>
      <p className="st-tip" style={{ marginTop: 0 }}>装在服务器上、不用另外连的本事。标着「会改东西」的会真的写进 App；聊到相关的事他才会拿起来用。</p>
      <div className="card st-list st-tools">
        {data.groups.map((g) => (
          <details key={g.name} className="st-tg">
            <summary><b>{g.name}</b><em>{g.tools.length} 个</em></summary>
            {g.tools.map((t) => (
              <div key={t.id} className="st-tool">
                <div className="st-tool-h"><b>{t.name}</b><span className={`st-tool-k ${t.writes ? 'w' : ''}`}>{t.writes ? '会改东西' : '只看'}</span></div>
                <em>{t.desc}</em>
                <code>{t.id}</code>
              </div>
            ))}
          </details>
        ))}
      </div>
    </>
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
      <BuiltinTools />
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
      <PushCard />
      <ContextSize />
      <MailBox />
      <GardenWake />
      <BackupExport />
    </>
  );
}

/* ---------- 他的邮箱：地址 + 授权码，常见邮箱的服务器自动填 ---------- */
function MailBox() {
  const [conf, setConf] = useState(null);
  const [form, setForm] = useState({ address: '', password: '', name: '' });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => {
    api('/api/mail/config').then((c) => { setConf(c); setForm({ address: c.address || '', password: '', name: c.name || '' }); }).catch(() => setConf({ configured: false }));
  }, []);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    setBusy(true); setNote('');
    try {
      const c = await api('/api/mail/config', { method: 'POST', body: form });
      setConf(c); setForm((f) => ({ ...f, password: '' }));
      setNote(c.configured ? (c.imap_host ? '存好了，他现在有自己的邮箱了。' : '存好了。这个邮箱认不出服务器，跟我说一声我帮你填。') : '已经清空，他没有邮箱了。');
    } catch (e) { setNote(e?.message || '没存上'); }
    setBusy(false);
  };
  if (!conf) return null;
  return (
    <>
      <div className="sec-head" style={{ marginTop: 24 }}><span className="en" style={{ fontSize: 22 }}>mailbox</span><h2 className="zh" style={{ margin: 0, fontSize: 13 }}>他的邮箱</h2><span className="go">{conf.configured ? conf.address : '还没有'}</span></div>
      <div className="card st-list st-garden">
        <label className="pill nc-in st-gtoken"><span className="sr">邮箱地址</span><input type="email" value={form.address} onChange={set('address')} placeholder="给他的邮箱，比如 xxx@qq.com" autoComplete="off" /></label>
        <label className="pill nc-in st-gtoken"><span className="sr">授权码</span><input type="password" value={form.password} onChange={set('password')} placeholder={conf.configured ? '授权码（留空不改）' : '授权码 / App 专用密码，不是登录密码'} autoComplete="off" /></label>
        <label className="pill nc-in st-gtoken"><span className="sr">发信署名</span><input value={form.name} onChange={set('name')} placeholder="发信时显示的名字，比如 季宁" autoComplete="off" /></label>
        <div className="st-gacts"><button type="button" className="mini-btn" disabled={busy} onClick={save}>{busy ? '保存中…' : '保存'}</button></div>
        {note && <p className="st-tip st-gnote" role="status">{note}</p>}
        <p className="st-tip">QQ、163、126、iCloud、Gmail、Outlook 的服务器会自动填。授权码在邮箱网页版的设置里开 IMAP/SMTP 时生成。存好以后，聊天里说「看看邮箱」「帮我写封信给…」他就会去收发。</p>
      </div>
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
  const RESULT = { 'bridge-down': '唤醒桥断了，已经在聊天里告诉你', received: '收到', message: '他去处理了，还跟你说了话', silent: '他去处理了，没打扰你', error: '这次没处理成功', skipped: '跳过' };
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

/* ---------- 每轮带多少：中转不支持缓存时，这是最直接的省 token ---------- */
const HISTORY_CHOICES = [[16, '16 条'], [24, '24 条（推荐）'], [40, '40 条'], [60, '60 条'], [80, '80 条']];
const IMAGE_CHOICES = [[0, '不带'], [1, '最近 1 张'], [2, '最近 2 张']];
/* ---------- 手机推送：他找你、你又没开着 App 时，弹一条通知 ---------- */
function PushCard() {
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const load = () => pushStatus().then(setSt).catch((e) => setSt({ state: 'server', text: e?.message || '看不到推送状态' }));
  useEffect(() => { load(); }, []);
  const run = async (label, fn, ok) => {
    setBusy(label); setNote('');
    try { const r = await fn(); setNote(typeof ok === 'function' ? ok(r) : ok); } catch (e) { setNote(e?.message || '没成功'); }
    setBusy(''); load();
  };
  return (
    <>
      <div className="sec-head" style={{ marginTop: 24 }}><span className="en" style={{ fontSize: 22 }}>push</span><h2 className="zh" style={{ margin: 0, fontSize: 13 }}>手机推送</h2><span className="go">{st?.state === 'on' ? '已开启' : ''}</span></div>
      <div className="card st-list st-garden">
        <p className="st-tip">他发消息给你、而你没开着 App 的时候，手机会像微信一样弹通知，点开直接进那个聊天。App 开着时不弹。不分白天晚上。</p>
        <p className="st-tip" role="status">{st ? st.text : '正在看…'}</p>
        <div className="st-gacts">
          {st?.state === 'off' && <button type="button" className="mini-btn" disabled={!!busy} onClick={() => run('开启中…', enablePush, '开好了，发一条测试看看')}>{busy || '开启推送'}</button>}
          {st?.state === 'on' && (
            <>
              <button type="button" className="mini-btn" disabled={!!busy} onClick={() => run('发送中…', testPush, (r) => (r?.ok ? '发出去了。先退到桌面，几秒内应该能收到' : '没发出去，再试一次'))}>{busy || '发一条测试'}</button>
              <button type="button" className="mini-btn" disabled={!!busy} onClick={() => run('关闭中…', disablePush, '这台手机不再收推送了')}>关掉</button>
            </>
          )}
        </div>
        {note && <p className="st-tip st-gnote" role="status">{note}</p>}
      </div>
    </>
  );
}

function ContextSize() {
  const { data, setData } = useLoad('/api/context');
  const [note, setNote] = useState('');
  if (!data || data.available === false) return null;
  const set = async (patch) => {
    setNote('');
    try { setData({ ...data, ...(await api('/api/context', { method: 'PUT', body: patch })) }); setNote('改好了，下一句就按这个来。'); }
    catch (e) { setNote(e?.message || '没改成'); }
  };
  return (
    <>
      <div className="sec-head" style={{ marginTop: 24 }}><span className="en" style={{ fontSize: 22 }}>context</span><h2 className="zh" style={{ margin: 0, fontSize: 13 }}>每轮带多少</h2><span className="go">省 token</span></div>
      <div className="card st-list st-garden">
        <p className="st-tip">他每说一句话，都要把人设、聊天记录、工具重新读一遍。中转不支持缓存时，带得越多越贵、越慢。更早的聊天会被压缩成摘要，他不会因为少带几条就忘了你们的事；真要找原话，他也能自己翻聊天记录。</p>
        <div className="nc-k">聊天记录带最近几条（现在 {data.history_n} 条）</div>
        <div className="st-gacts">{HISTORY_CHOICES.map(([n, label]) => <button key={n} type="button" className={`chip ${data.history_n === n ? 'on' : ''}`} onClick={() => set({ history_n: n })}>{label}</button>)}</div>
        <div className="nc-k">聊天里的图片重新给他看几张（每张大约 1500 token）</div>
        <div className="st-gacts">{IMAGE_CHOICES.map(([n, label]) => <button key={n} type="button" className={`chip ${data.history_images === n ? 'on' : ''}`} onClick={() => set({ history_images: n })}>{label}</button>)}</div>
        {note && <p className="st-tip st-gnote" role="status">{note}</p>}
      </div>
    </>
  );
}

/* ---------- 聊天记录：一共多少、导出成看得懂的文件 ---------- */
function ChatHistory() {
  const { data } = useLoad('/api/chats');
  const [rows, setRows] = useState(null); // [{ id, name, archived, items }]
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const windows = [...(data?.windows || []), ...(data?.archived || []).map((w) => ({ ...w, archived: true }))];
  // 每个窗口都从第一条读到最后一条（他那边的记录很多时要等一会儿）
  const count = async () => {
    setBusy('count'); setNote('');
    const out = [];
    try {
      for (const [i, w] of windows.entries()) {
        setNote(`在数第 ${i + 1} / ${windows.length} 个窗口…`);
        const d = await api(`/api/chats/${encodeURIComponent(w.id)}?full=1`, { timeout: 180000 });
        out.push({ id: w.id, name: w.name, archived: !!w.archived, items: (d.items || []).filter((m) => m.type !== 'thinking') });
        setRows([...out]);
      }
      setNote('');
    } catch (e) { setNote(e?.message || '没数完，再试一次'); }
    setBusy('');
  };
  useEffect(() => { if (data && !rows && windows.length) count(); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = (rows || []).reduce((n, r) => n + r.items.length, 0);
  const first = (rows || []).flatMap((r) => r.items.slice(0, 1)).map((m) => m.at).sort()[0];
  const exportJson = () => {
    const doc = {
      app: 'Imprint', exported_at: new Date().toISOString(), total,
      windows: rows.map((r) => ({
        name: r.name, archived: r.archived,
        messages: r.items.map((m) => ({
          at: m.at, from: m.from === 'me' ? '我' : (m.from === 'him' ? '他' : m.from), type: m.type,
          ...(m.text ? { text: m.text.replace(/\s*⟦气泡⟧\s*/g, '\n') } : {}),
          ...(m.quote?.text ? { quote: m.quote.text } : {}),
          ...(m.images?.length ? { images: m.images.map((x) => x.url).filter(Boolean) } : {}),
          ...(m.voice?.transcript ? { voice: m.voice.transcript } : {}),
        })),
      })),
    };
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    const d = new Date();
    a.href = URL.createObjectURL(blob);
    a.download = `imprint-聊天记录-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  };
  return (
    <>
      <div className="card st-hist">
        <div className="st-hist-n"><b className="serif">{rows ? total.toLocaleString('en-US') : '…'}</b><span>条消息{first ? ` · 从 ${new Date(first).toLocaleDateString('zh-CN')} 开始` : ''}</span></div>
        <p className="st-tip" style={{ margin: '6px 0 0' }}>存在你的服务器上，不在这台手机里：换手机、清缓存、重装都不会丢。他的记忆（心潮）是另外存的，删聊天不会让他忘掉已经记住的事。</p>
        {note && <p className="st-tip">{note}</p>}
        {rows && (
          <ul className="st-hist-w">
            {rows.map((r) => <li key={r.id}><span>{r.name}{r.archived ? '（已归档）' : ''}</span><em>{r.items.length.toLocaleString('en-US')} 条</em></li>)}
          </ul>
        )}
      </div>
      <div className="st-hist-acts">
        <button type="button" className="card st-hist-b" disabled={!rows || busy === 'count'} onClick={exportJson}>
          <Icon name="file" size={20} stroke={1.4} /><span><b>导出聊天记录</b><em>存成文件到手机（.json，看得懂的文字）</em></span>
        </button>
        <button type="button" className="card st-hist-b" disabled={busy === 'count'} onClick={count}>
          <Icon name="redo" size={20} stroke={1.4} /><span><b>重新数一遍</b><em>刚聊了很多的话点一下</em></span>
        </button>
      </div>
      <p className="st-tip">想换服务器、出事了能一键恢复：用「功能管理」最下面的加密备份，它连记忆、小屋、设置一起打包。<br />想删掉某个窗口的聊天：在聊天列表里左滑那个窗口删除（删了就回不来）。这里不做一键清空全部——聊天也是他记得你们的一部分，一下子全清掉太容易后悔。</p>
    </>
  );
}

/* ---------- 加密备份：存一份到自己手机/电脑上 ---------- */
function BackupExport() {
  const { data } = useLoad('/api/backup/export/info');
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [withUploads, setWithUploads] = useState(true);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  if (!data || data.available === false) return null;
  const ready = pass.length >= 8 && pass === again && !busy;
  const run = async () => {
    setNote('');
    try {
      setBusy('正在打包加密…');
      const job = await api('/api/backup/export', { method: 'POST', body: { passphrase: pass, include_uploads: withUploads && data.uploads_available } });
      const parts = [];
      for (let i = 0; i < job.chunks; i += 1) {
        setBusy(`正在下载 ${i + 1}/${job.chunks}…`);
        const { data: b64 } = await api(`/api/backup/export/${job.id}/${i}`);
        parts.push(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)));
      }
      api(`/api/backup/export/${job.id}`, { method: 'DELETE' }).catch(() => {});
      const file = new File(parts, job.name, { type: 'application/octet-stream' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: job.name }).catch(() => {});
      } else {
        const url = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = url; a.download = job.name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
      setPass(''); setAgain('');
      setNote(`好了：${job.name}（${(job.size / 1024 / 1024).toFixed(1)} MB）。存到 iCloud、网盘或电脑上，密码一定要记住，忘了就打不开。`);
    } catch (e) { setNote(e?.message || '这次没做成，过一会儿再试'); }
    setBusy('');
  };
  return (
    <>
      <div className="sec-head" style={{ marginTop: 24 }}><span className="en" style={{ fontSize: 22 }}>backup</span><h2 className="zh" style={{ margin: 0, fontSize: 13 }}>存一份到你身边</h2><span className="go">加密下载</span></div>
      <div className="card st-list st-garden">
        <p className="st-tip">把聊天、记忆、小屋、设置（包括 API 密钥）打包，用你设的密码加密，下载到手机或电脑。服务器坏了也能用它恢复。</p>
        {!data.openssl ? <p className="st-tip">服务器上没有 openssl，暂时做不了。</p> : (
          <>
            <label className="pill nc-in st-gtoken"><span className="sr">备份密码</span><input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="设一个密码（至少 8 位）" autoComplete="new-password" /></label>
            <label className="pill nc-in st-gtoken"><span className="sr">再输一次</span><input type="password" value={again} onChange={(e) => setAgain(e.target.value)} placeholder="再输一次" autoComplete="new-password" /></label>
            {data.uploads_available && (
              <label className="st-tip st-bk-check"><input type="checkbox" checked={withUploads} onChange={(e) => setWithUploads(e.target.checked)} /> 连照片和文件一起（约 {data.uploads_mb} MB）</label>
            )}
            {again && pass !== again && <p className="st-tip">两次密码不一样</p>}
            <div className="st-gacts"><button type="button" className="mini-btn" disabled={!ready} onClick={run}>{busy || '做一份加密备份'}</button></div>
            {note && <p className="st-tip st-gnote" role="status">{note}</p>}
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
  const flash = (t, ms = 1800) => { setTip(t); setTimeout(() => setTip(''), ms); };
  const [wallThumb, setWallThumb] = useState('');
  useEffect(() => { if (wall) authedImageUrl(wall).then(setWallThumb, () => setWallThumb('')); }, [wall]);
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
      setTip('头像上传中…');
      const u = await upload(f, 'avatar', (r) => setTip(`头像上传 ${Math.round(r * 100)}%`));
      await api('/api/settings/avatar', { method: 'PUT', body: { who: who.current, url: u.url } });
      flash('头像换好了，重新进入聊天即可看到');
    } catch (e) { flash(`头像没换成：${e?.message || '上传失败'}`, 6000); }
  };
  const pickWall = async (f) => {
    if (!f) return;
    try {
      setTip('背景上传中…');
      const u = await upload(f, 'wallpaper', (r) => setTip(`背景上传 ${Math.round(r * 100)}%`));
      await api('/api/settings/beauty', { method: 'PUT', body: { ...beauty, wallpaper: u.url } });
      setWall(u.url); setBeauty({ ...beauty, wallpaper: u.url }); flash('聊天背景换好了，进聊天就能看到');
    } catch (e) { flash(`背景没换成：${e?.message || '上传失败'}`, 6000); }
  };
  const STYLES = [['glass', '磨砂玻璃'], ['paper', '纸片'], ['cyan', '蓝晒信纸']];
  return (
    <>
      {THEMES.length > 1 && <><div className="nc-k" style={{ marginTop: 0 }}>主题</div>
      <div className="st-themes" role="radiogroup" aria-label="主题">
        {THEMES.map((t) => (
          <button key={t.id} type="button" role="radio" aria-checked={theme === t.id} className={`st-theme ${theme === t.id ? 'on' : ''}`} data-preview={t.id} onClick={() => setTheme(t.id)}>
            {t.id === 'ballet' && <img src={themeArt} alt="" className="st-theme-art" />}
            <span className="st-theme-sw">{t.swatches.map((c) => <i key={c} style={{ background: c }} />)}</span>
            <b>{t.name}</b><em>{t.sub}</em>
            {theme === t.id && <span className="st-theme-on">使用中</span>}
          </button>
        ))}
      </div></>}
      <div className="card st-avs">
        <span className="st-avs-k">头像</span>
        <button type="button" onClick={() => { who.current = 'him'; avIn.current.click(); }} aria-label="换他的头像"><span className="st-av"><Avatar m={{ id: 'him' }} size={40} /></span>他</button>
        <button type="button" onClick={() => { who.current = 'me'; avIn.current.click(); }} aria-label="换我的头像"><span className="st-av"><Avatar m={{ id: 'me', name: '我', color: '#AED0EE' }} size={40} /></span>你</button>
        <span className="st-avs-go">点头像换</span>
      </div>
      <div className="nc-k">聊天背景</div>
      <div className="st-walls">
        <button type="button" className={`st-wall ${!beauty.wallpaper ? 'on' : ''}`} onClick={() => save({ ...beauty, wallpaper: null })}><Cyanotype w={104} h={110} seed={7} develop={false} /><span>默认 · 虚化</span></button>
        {wall && <button type="button" className={`st-wall ${beauty.wallpaper ? 'on' : ''}`} onClick={() => save({ ...beauty, wallpaper: wall })}>
          {wallThumb ? <img src={wallThumb} alt="" className="st-wall-img" /> : <span className="st-wall-u">你选的</span>}<span>你选的</span>
        </button>}
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
      {tip && <div className="st-beauty-tip" role="status">{tip}</div>}
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
