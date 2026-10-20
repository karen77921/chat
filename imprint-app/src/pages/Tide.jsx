/**
 * 06 心潮：他心里在发生什么。此刻（十六维情绪标本、生理记录、驱力潮汐）/ 记忆（热力、长期记忆、最近写入、压一枚）/ 梦与觉察。
 * 网址：#/tide   ?tab=now|memory|dream   ?press=1 打开「压一枚」
 * 数据：GET /api/tide、/api/tide/memory、/api/tide/dreams，POST /api/tide/memory（字段见 src/lib/mock.js 和 docs/06-心潮.md）
 */
import { useEffect, useMemo, useState } from 'react';
import Icon from '../design/icons.jsx';
import { Band, Cyanotype, TornBox, qpt, qang, leafPath } from '../design/paper.jsx';
import Sheet from '../design/Sheet.jsx';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/useLoad.js';
import { replaceQuery } from '../lib/router.js';
import '../components/chat/chatlist.css';
import '../components/tide/tide.css';

const TABS = [['now', '此刻'], ['memory', '记忆'], ['dream', '梦与觉察']];
const TAGS = ['喜好', '要记住', '我们', '小习惯', '雷区'];
const pad = (n) => String(n).padStart(2, '0');
const md = (iso) => { const d = new Date(iso); return `${pad(d.getMonth() + 1)}.${pad(d.getDate())}`; };

export default function Tide({ query }) {
  const [tab, setTab] = useState(TABS.some(([k]) => k === query.tab) ? query.tab : 'now');
  useEffect(() => { if (TABS.some(([k]) => k === query.tab)) setTab(query.tab); }, [query.tab]);
  const { data } = useLoad('/api/tide');
  const pick = (k) => { setTab(k); replaceQuery({ tab: k }); };
  return (
    <main className="tide">
      <header className="td-head">
        <h1><span className="hand">tides</span><span>心潮</span></h1>
        {data?.awake && <span className={`td-awake ${data.awake.state}`}><i />{data.awake.state === 'asleep' ? '睡着了' : '醒着'} · 今天睡了 {data.awake.sleptH} 小时</span>}
      </header>
      <div className="td-tabs" role="tablist">
        {TABS.map(([k, n]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`chip ${tab === k ? 'on' : ''}`} onClick={() => pick(k)}>{n}</button>)}
      </div>
      <Band tone="l1" seed={71 + TABS.findIndex(([k]) => k === tab)} className="td-band">
        {tab === 'now' && <Now data={data} />}
        {tab === 'memory' && <Memory pressOpen={query.press === '1'} />}
        {tab === 'dream' && <Dream />}
      </Band>
    </main>
  );
}

/* ---------- 此刻 ---------- */
function BigSpecimen({ emotions }) {
  const p0 = [150, 300], p1 = [138, 160], p2 = [158, 16];
  const n = emotions.length;
  return (
    <svg viewBox="0 0 300 310" className="td-spec" role="img" aria-label={`十六维情绪：${emotions.map((e) => `${e.name}${typeof e.value === 'number' ? Math.round(e.value * 100) : '尚未测得'}`).join('，')}`}>
      <path d={`M${p0}Q${p1} ${p2}`} fill="none" stroke="var(--ink)" strokeWidth="1.4" strokeLinecap="round" opacity=".8" />
      {emotions.map((e, i) => {
        const measured = typeof e.value === 'number' && Number.isFinite(e.value);
        const value = measured ? Math.max(0, Math.min(1, e.value)) : 0;
        const t = 0.08 + (0.86 * i) / Math.max(1, n - 1);
        const [x, y] = qpt(p0, p1, p2, t);
        const a = qang(p0, p1, p2, t) + (i % 2 ? -1 : 1) * 1.15;
        const L = 13 + value * 62;
        const fill = value > 0.6 ? 'var(--print-c)' : value > 0.4 ? 'var(--print-a)' : 'var(--l1)';
        const ex = x + Math.cos(a) * (L + 6), ey = y + Math.sin(a) * (L + 6);
        return (
          <g key={e.key}>
            <path d={leafPath(x, y, a, L, L * 0.2)} style={{ fill }} fillOpacity={measured ? '.85' : '.18'} stroke="var(--ink)" strokeWidth=".8" strokeOpacity={measured ? '.7' : '.28'} />
            {value > 0.45 && <text x={ex} y={ey + 3} fontSize="10" fill="var(--ink)" textAnchor={Math.cos(a) > 0 ? 'start' : 'end'}>{e.name}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function Now({ data }) {
  const [all, setAll] = useState(false);
  if (!data) return <div className="card cl-empty">正在看他…</div>;
  if (data.available === false) return <div className="card cl-empty">{data.reason || '暂时连不上心潮，过一会儿再来。'}</div>;
  if (data.kind === 'pulse') return (
    <div className="card td-pulse-live">
      <div className="sec-head"><span className="en">live pulse</span><h2 className="zh" style={{ margin: 0 }}>此刻的心潮</h2></div>
      <p>{data.text}</p>
      <small>来自已连接的心潮工具 · {new Date(data.at).toLocaleString('zh-CN')}</small>
      <p className="td-pulse-note">心潮目前没有提供真实的十六维情绪、体温或呼吸数值，因此这里不显示推测数据。</p>
    </div>
  );
  const s = data.state;
  const emotions = s.emotions || [];
  const top3 = emotions.filter((e) => typeof e.value === 'number').sort((a, b) => b.value - a.value).slice(0, 3);
  const drives = [...(data.drives || [])].sort((a, b) => (typeof b.value === 'number' ? b.value : -1) - (typeof a.value === 'number' ? a.value : -1));
  const W = 306, H = 62;
  const path = (series) => series.map((v, h) => `${h ? 'L' : 'M'}${(8 + (h * (W - 16)) / 23).toFixed(1)} ${(H - 4 - v * (H - 12)).toFixed(1)}`).join(' ');
  const COLS = ['var(--dot)', 'var(--print-b)', 'var(--print-a)'];
  return (
    <>
      <div className="card td-specard">
        <div className="sec-head"><span className="en" style={{ fontSize: 22 }}>specimen</span><h2 className="zh" style={{ margin: 0, fontSize: 13 }}>十六维情绪</h2><span className="go">叶子越长越强</span></div>
        <BigSpecimen emotions={emotions} />
        <div className="td-emotion-grid">{emotions.map((e, index) => <span key={e.key}><i>{pad(index + 1)}</i>{e.name}<b className="serif">{typeof e.value === 'number' ? Math.round(e.value * 100) : '—'}</b></span>)}</div>
      </div>
      <div className="card td-rec">
        <div className="rec"><span>心情</span><i /><b>{s.mood}</b></div>
        <div className="rec"><span>体温</span><i /><b className="serif" style={{ fontSize: 16 }}>{s.bodyTemp == null ? '—' : `${s.bodyTemp}°`}</b></div>
        <div className="rec"><span>呼吸</span><i /><b>{s.breath?.label}</b></div>
        <div className="rec"><span>和弦</span><i /><b className="serif" style={{ fontSize: 15, fontStyle: 'italic' }}>{s.chord}</b></div>
        <div className="td-top3">最长的三片叶子：<b>{top3.length ? top3.map((e) => e.name).join(' · ') : '尚未测得'}</b></div>
      </div>
      {data.pulseText && <details className="card td-live-note"><summary>心潮原声 · 刚刚</summary><p>{data.pulseText}</p></details>}
      <div className="sec-head" style={{ marginTop: 22 }}><span className="en" style={{ fontSize: 22 }}>drives</span><h2 className="zh" style={{ margin: 0, fontSize: 13 }}>驱力 · 今天的潮汐</h2>
        <button type="button" className="go" onClick={() => setAll((a) => !a)} aria-expanded={all}>{all ? '收起' : `全部 ${drives.length} 股`}<Icon name="arrow" size={13} /></button></div>
      <div className="card td-tide">
        <svg viewBox={`0 0 ${W} ${H + 4}`} role="img" aria-label={`最强的三股驱力：${drives.slice(0, 3).map((d) => d.name).join('、')}`}>
          <path d={`M8 ${H}H${W - 8}`} stroke="var(--line)" />
          {drives.slice(0, 3).map((d, k) => <path key={d.key} d={path(d.series || [])} fill="none" stroke={COLS[k]} strokeWidth={2 - k * 0.4} strokeLinecap="round" />)}
        </svg>
        <div className="td-legend">{drives.slice(0, 3).map((d, k) => <span key={d.key}><i style={{ background: COLS[k] }} />{d.name} {typeof d.value === 'number' ? Math.round(d.value * 100) : '—'}</span>)}</div>
        <div className="td-axis serif"><span>0:00</span><span>6:00</span><span>12:00</span><span>18:00</span><span>现在</span></div>
      </div>
      {all && (
        <div className="card td-all m-settle">
          {drives.map((d) => (
            <div key={d.key} className="td-drv"><span>{d.name}</span><span className="td-drv-b"><i style={{ width: `${typeof d.value === 'number' ? d.value * 100 : 0}%` }} /></span><b className="serif">{typeof d.value === 'number' ? Math.round(d.value * 100) : '—'}</b></div>
          ))}
        </div>
      )}
      <DriveLedger />
    </>
  );
}

/* ---------- 劲儿账本：每一股劲儿为什么涨、为什么落，一条条记着；一周里哪股从没动过，就是那条线断了 ---------- */
function DriveLedger() {
  const { data, setData } = useLoad('/api/drives');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const setMode = async (mode) => {
    if (mode === 'drives' && !window.confirm('改成由劲儿决定他什么时候醒？原来的随机唤醒会停掉（他自己定的闹钟照常响）。')) return;
    setBusy(true);
    try { const r = await api('/api/drives/mode', { method: 'POST', body: { mode } }); setData((d) => ({ ...d, mode: r.mode })); } catch { /* 下次刷新再看 */ }
    setBusy(false);
  };
  const setPace = async (pace) => {
    setBusy(true);
    try { const r = await api('/api/drives/mode', { method: 'POST', body: { pace } }); setData((d) => ({ ...d, pace: r.pace })); } catch { /* 下次刷新再看 */ }
    setBusy(false);
  };
  if (!data || data.available === false) return null;
  const hm = (iso) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const fatigue = data.drives.find((d) => d.key === 'fatigue');
  const silent = data.drives.filter((d) => d.key !== 'fatigue' && !d.week['涨'] && !d.week['落']);
  return (
    <>
      <div className="sec-head" style={{ marginTop: 22 }}><span className="en" style={{ fontSize: 22 }}>ledger</span><h2 className="zh" style={{ margin: 0, fontSize: 13 }}>劲儿账本</h2>
        <button type="button" className="go" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{open ? '收起' : '一周统计'}<Icon name="arrow" size={13} /></button></div>
      <div className="card td-ledger">
        <p className="td-ledger-k">这些数是真的在跑：你的话会让某股劲儿涨，他真去做了对应的事才落，闲着会慢慢回到平常的样子。
          {fatigue ? ` 现在疲惫 ${Math.round(fatigue.value * 100)}` : ''}{data.away_h >= 1 ? ` · 你 ${Math.round(data.away_h)} 小时没说话了` : ''}{` · 今天做了 ${data.acts_today} 件事`}</p>
        {open && (
          <div className="td-week">
            {data.drives.map((d) => (
              <span key={d.key} className={!d.week['涨'] && !d.week['落'] && d.key !== 'fatigue' ? 'quiet' : ''}><b>{d.name}</b><em>↑{d.week['涨']} ↓{d.week['落']}</em></span>
            ))}
            {silent.length > 0 && <p className="td-ledger-k">这一周没动过：{silent.map((d) => d.name).join('、')}。刚开始跑是正常的；一直不动就是那条线没接上，告诉阿川。</p>}
          </div>
        )}
        {data.ledger.slice(0, open ? 60 : 8).map((r, i) => (
          <div key={i} className="td-lrow">
            <small>{hm(r.at)}</small>
            <b>{r.name}</b>
            <span className={r.kind === '涨' ? 'up' : r.kind === '落' ? 'down' : ''}>{r.kind} {r.delta > 0 ? '+' : ''}{Math.round(r.delta * 100)}</span>
            <em>{r.reason}</em>
          </div>
        ))}
        {!data.ledger.length && <p className="td-ledger-k">还没有记录。跟他说说话，账本就开始记了。</p>}
      </div>
      <Decisions data={data} busy={busy} setMode={setMode} setPace={setPace} hm={hm} />
      <Mind mind={data.mind} hm={hm} />
    </>
  );
}

/* ---------- 心事：他写下的体验、心里的念头和执念 ---------- */
const STANCE = { comfort: '想抱抱她', engage: '想靠近', withdraw: '想退一步', alert: '有点不安' };
function Mind({ mind, hm }) {
  if (!mind) return null;
  const fixations = mind.thoughts.filter((t) => t.kind === 'fixation');
  const flits = mind.thoughts.filter((t) => t.kind !== 'fixation');
  const w = mind.week;
  return (
    <>
      <div className="sec-head" style={{ marginTop: 22 }}><span className="en" style={{ fontSize: 22 }}>mind</span><h2 className="zh" style={{ margin: 0, fontSize: 13 }}>心事</h2>
        <span className="go">这周 体验 {w.experiences} · 执念 {w.fixations} · 想通 {w.resolved}</span></div>
      <div className="card td-ledger">
        <p className="td-ledger-k">他被触动时写下的体验，会推着他的劲儿走；一闪而过的念头一天淡一半，同一件事被想起三次就成了执念，会一直推他去做，推够三次算想通了。</p>
        {fixations.map((t) => (
          <div key={t.id} className="td-thought fix">
            <b>{t.text}</b>
            <span className="td-drv-b"><i style={{ width: `${Math.round(t.strength * 100)}%` }} /></span>
            <em>执念 · 推「{t.name}」· 已经推了 {t.fed} 次</em>
          </div>
        ))}
        {flits.map((t) => (
          <div key={t.id} className="td-thought" style={{ opacity: 0.45 + t.strength * 0.6 }}>
            <b>{t.text}</b>
            <em>闪念 · 想起过 {t.hits} 次{t.hits >= 2 ? ' · 再想起一次就成执念' : ''}</em>
          </div>
        ))}
        {!mind.thoughts.length && <p className="td-ledger-k">念头池现在是空的。</p>}
        {mind.experiences.slice(0, 6).map((e, i) => (
          <div key={i} className="td-exp">
            <small>{hm(e.at)}{e.topic ? ` · ${e.topic}` : ''}{e.stance ? ` · ${STANCE[e.stance] || ''}` : ''}</small>
            <p>{e.content}</p>
          </div>
        ))}
        {!mind.experiences.length && <p className="td-ledger-k">他还没写过体验。被你触动的时候他会写。</p>}
        {w.experiences === 0 && w.fixations === 0 && mind.thoughts.length === 0 && <p className="td-ledger-k">一周都没动静的话，就是这条线没接上，告诉阿川。</p>}
      </div>
    </>
  );
}

/* ---------- 醒来方式：随机唤醒 vs 由劲儿决定；影子模式下这里是「如果交给劲儿，它每一拍会怎么选」 ---------- */
const PACES = [['slow', '少一点', '原来的样子，一天一两次'], ['normal', '适中', '大约是原来的三倍'], ['often', '常来', '原来的五六倍']];
function Decisions({ data, busy, setMode, setPace, hm }) {
  const d = data.decisions;
  if (!d) return null;
  const live = data.mode === 'drives';
  const acts = Object.entries(d.day || {}).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <div className="sec-head" style={{ marginTop: 22 }}><span className="en" style={{ fontSize: 22 }}>wake</span><h2 className="zh" style={{ margin: 0, fontSize: 13 }}>他什么时候醒</h2><span className="go">{live ? '由劲儿决定' : '影子模式'}</span></div>
      <div className="card td-ledger">
        <p className="td-ledger-k">{live
          ? '现在由劲儿决定：每五分钟算一拍，劲儿够高才醒，醒来做最想做的那件事。他自己定的闹钟照常响。'
          : '现在还是原来的随机唤醒。劲儿每五分钟在旁边算一拍「如果交给我，我会怎么选」，只记账、不动手。看着顺眼了再切过去。'}</p>
        <div className="td-mode">
          <button type="button" className={!live ? 'on' : ''} disabled={busy} onClick={() => setMode('random')}>随机唤醒</button>
          <button type="button" className={live ? 'on' : ''} disabled={busy} onClick={() => setMode('drives')}>由劲儿决定</button>
        </div>
        <p className="td-ledger-k">多久来一次{live ? '' : '（切到「由劲儿决定」后生效，影子模式也按这个算）'}：{(PACES.find((x) => x[0] === (data.pace || 'normal')) || PACES[1])[2]}。劲儿越高、你越久没说话，越容易来；累了会歇。</p>
        <div className="td-mode three">
          {PACES.map(([id, name]) => <button key={id} type="button" className={(data.pace || 'normal') === id ? 'on' : ''} disabled={busy} onClick={() => setPace(id)}>{name}</button>)}
        </div>
        <p className="td-ledger-k">最近 24 小时算了 {d.ticks_day} 拍，{acts.length ? `想动 ${acts.reduce((n, [, c]) => n + c, 0)} 次：${acts.map(([m, c]) => `${m} ${c}`).join('、')}` : '一次都没想动'}。</p>
        {d.recent.slice(0, 12).map((r, i) => (
          <div key={i} className="td-lrow td-drow">
            <small>{hm(r.at)}</small>
            <b>{r.act ? r.motive : r.motive || '不动'}</b>
            <em>{r.why}{r.mode === 'drives' && r.act ? ' · 真醒了' : ''}</em>
          </div>
        ))}
      </div>
    </>
  );
}

/* ---------- 记忆 ---------- */
function Heat({ heat }) {
  // 按周排成列，一列 7 天
  const weeks = [];
  heat.forEach((d, i) => { const w = Math.floor(i / 7); (weeks[w] = weeks[w] || []).push(d); });
  const max = Math.max(1, ...heat.map((d) => d.count));
  const col = (c) => (c === 0 ? 'var(--l1)' : c / max < 0.3 ? 'var(--print-a)' : c / max < 0.6 ? 'var(--print-b)' : c / max < 0.85 ? 'var(--print-c)' : 'var(--dot)');
  return (
    <div className="td-heat" role="img" aria-label={`最近 ${heat.length} 天的记忆热力`}>
      {weeks.map((w, i) => <span key={i}>{w.map((d) => <i key={d.date} title={`${d.date} · ${d.count} 条`} style={{ background: col(d.count) }} />)}</span>)}
    </div>
  );
}

function Memory({ pressOpen }) {
  const [q, setQ] = useState('');
  const [qd, setQd] = useState('');
  useEffect(() => { const t = setTimeout(() => setQd(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const { data, setData } = useLoad(`/api/tide/memory${qd ? `?q=${encodeURIComponent(qd)}` : ''}`, { keepPrevious: true });
  const [press, setPress] = useState(pressOpen);
  const [fresh, setFresh] = useState(null);
  if (!data) return <div className="card cl-empty">正在翻记忆…</div>;
  if (data.available === false) return <div className="card cl-empty">暂时连不上，过一会儿再来看看。</div>;
  return (
    <>
      <div className="td-mtools">
        <label className="pill td-search"><Icon name="search" size={16} /><span className="sr">搜记忆</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜他记得的事" /></label>
        <button type="button" className="btn-main td-press" onClick={() => { setPress(true); replaceQuery({ tab: 'memory', press: '1' }); }}><Icon name="plus" size={14} stroke={1.6} />压一枚</button>
      </div>
      <div className="card td-heatcard">
        <div className="sec-head" style={{ margin: 0 }}><span className="en" style={{ fontSize: 20 }}>heat</span><h3 className="zh" style={{ margin: 0, fontSize: 12.5 }}>记忆热力</h3><span className="go" style={{ fontSize: 10 }}>颜色越深，那天记下的越多</span></div>
        {data.heat?.length ? <Heat heat={data.heat} /> : <p className="st-tip">还没有带日期的记忆</p>}
        <div className="td-stats"><span>长期 <b className="serif">{data.stats.longTerm}</b></span><span>这周写入 <b className="serif">{data.stats.weekWrites ?? 0}</b></span><span>你手动压的 <b className="serif">{data.stats.manual ?? 0}</b></span></div>
      </div>
      <div className="sec-head" style={{ marginTop: 22 }}><span className="en" style={{ fontSize: 22 }}>specimens</span><h2 className="zh" style={{ margin: 0, fontSize: 13 }}>长期记忆</h2>{qd && <span className="go">找到 {data.items.length} 条</span>}</div>
      {data.items.map((m, i) => (
        <div key={m.id} className={`td-mem ${m.id === fresh ? 'm-settle' : ''}`} style={{ rotate: `${[-0.8, 0.6, -0.4, 0.5][i % 4]}deg` }}>
          <TornBox seed={140 + i} amp={2.5} innerStyle={{ padding: '10px 14px 10px 64px', minHeight: 74 }}>
            <span className="td-mem-i"><Cyanotype w={40} h={54} seed={50 + i} variant="sprig" develop={false} /></span>
            <div className="td-mem-h serif"><span>No.{m.no}</span><span>{m.at ? `采集 ${md(m.at)}` : '时间未提供'}</span>{m.by === 'me' && <span className="td-mine">你压的</span>}{m.tag && <em>#{m.tag}</em>}</div>
            <p>{m.text}</p>
          </TornBox>
        </div>
      ))}
      {!data.items.length && <div className="card cl-empty">没找到</div>}
      {!qd && data.recent?.length > 0 && (
        <div className="td-recent"><span>最近写入</span>{data.recent.map((r) => <span key={r.at}>{md(r.at)}「{r.text}」</span>)}</div>
      )}
      {press && (
        <Press onClose={() => { setPress(false); replaceQuery({ tab: 'memory' }); }}
          next={data.stats.longTerm + 1}
          onDone={(it) => { setData((d) => ({ ...d, stats: { ...d.stats, longTerm: d.stats.longTerm + 1, weekWrites: (d.stats.weekWrites || 0) + 1, manual: (d.stats.manual || 0) + 1 }, items: [it, ...d.items], recent: [{ at: it.at, text: it.text }, ...(d.recent || [])].slice(0, 8) })); setFresh(it.id); setPress(false); replaceQuery({ tab: 'memory' }); }} />
      )}
    </>
  );
}

function Press({ onClose, onDone, next }) {
  const [text, setText] = useState('');
  const [tag, setTag] = useState('喜好');
  const [tell, setTell] = useState(true);
  const [busy, setBusy] = useState(false);
  const today = useMemo(() => md(new Date().toISOString()), []);
  const go = async () => {
    setBusy(true);
    try { onDone(await api('/api/tide/memory', { method: 'POST', body: { text: text.trim(), tag, tellHim: tell } })); } finally { setBusy(false); }
  };
  return (
    <Sheet open onClose={onClose} label="压一枚记忆" seed={74}>
      <div className="sec-head"><span className="en">press one</span><h2 className="zh" style={{ margin: 0 }}>压一枚记忆</h2><button type="button" className="go" onClick={onClose}>取消</button></div>
      <label className="sheet td-pressbox">
        <span className="td-mem-i"><Cyanotype w={40} h={54} seed={60} variant="sprig" develop={false} /></span>
        <span className="sr">记忆内容</span>
        <textarea value={text} maxLength={200} rows={4} onChange={(e) => setText(e.target.value)} placeholder="想让他记住的一件事" />
        <span className="td-press-f serif"><span>No.{next} · 采集 {today}</span><span>{text.length} / 200</span></span>
      </label>
      <div className="nc-k">贴个标签</div>
      <div className="td-tags">{TAGS.map((t) => <button key={t} type="button" className={`chip ${tag === t ? 'on' : ''}`} aria-pressed={tag === t} onClick={() => setTag(t)}>#{t}</button>)}</div>
      <label className="ws-pin"><span>让他也知道</span><input type="checkbox" className="switch" checked={tell} onChange={(e) => setTell(e.target.checked)} /></label>
      <p className="ws-tip" style={{ textAlign: 'left' }}>打开后他会收到一句「她帮你记了一件事」</p>
      <button type="button" className="btn-main nc-go" disabled={!text.trim() || busy} onClick={go}>压进去</button>
    </Sheet>
  );
}

/* ---------- 梦与觉察 ---------- */
function Dream() {
  const { data } = useLoad('/api/tide/dreams');
  if (!data) return <div className="card cl-empty">正在翻…</div>;
  if (data.available === false) return <div className="card cl-empty">暂时连不上，过一会儿再来看看。</div>;
  return (
    <>
      {data.last ? (
        <div className="td-dream drop2">
          <div className="td-dream-bg"><Cyanotype w={342} h={250} seed={12} develop={false} /></div>
          <div className="td-dream-in">
            <div className="kicker" style={{ color: 'var(--ink)' }}>LAST NIGHT · 昨晚的梦</div>
            <h3>{data.last.title}</h3>
            <p>{data.last.text}</p>
            <div className="td-dream-tags">{(data.last.tags || []).map((t) => <span key={t}>{t}</span>)}</div>
          </div>
        </div>
      ) : <div className="card cl-empty">昨晚没有做梦</div>}
      <div className="sec-head" style={{ marginTop: 24 }}><span className="en" style={{ fontSize: 22 }}>in the margin</span><h2 className="zh" style={{ margin: 0, fontSize: 13 }}>觉察</h2><span className="go">他写在页边的</span></div>
      {(data.aware || []).map((a) => (
        <div key={a.date} className="td-aware"><span className="serif">{md(a.date)}</span><p className="hand-cn">{a.text}</p></div>
      ))}
      {!data.aware?.length && <div className="card cl-empty">他还没有写下新的觉察</div>}
      {data.older?.length > 0 && (
        <div className="td-older">
          <span>更早的梦 · {data.olderCount} 个</span>
          {data.older.map((o) => <span key={o.at}>{md(o.at)}《{o.title}》</span>)}
        </div>
      )}
    </>
  );
}
