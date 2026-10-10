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
    <svg viewBox="0 0 300 310" className="td-spec" role="img" aria-label={`十六维情绪：${emotions.map((e) => `${e.name}${Math.round(e.value * 100)}`).join('，')}`}>
      <path d={`M${p0}Q${p1} ${p2}`} fill="none" stroke="var(--ink)" strokeWidth="1.4" strokeLinecap="round" opacity=".8" />
      {emotions.map((e, i) => {
        const t = 0.08 + (0.86 * i) / Math.max(1, n - 1);
        const [x, y] = qpt(p0, p1, p2, t);
        const a = qang(p0, p1, p2, t) + (i % 2 ? -1 : 1) * 1.15;
        const L = 16 + e.value * 62;
        const fill = e.value > 0.6 ? 'var(--print-c)' : e.value > 0.4 ? 'var(--print-a)' : 'var(--l1)';
        const ex = x + Math.cos(a) * (L + 6), ey = y + Math.sin(a) * (L + 6);
        return (
          <g key={e.key}>
            <path d={leafPath(x, y, a, L, L * 0.2)} style={{ fill }} fillOpacity=".85" stroke="var(--ink)" strokeWidth=".8" strokeOpacity=".7" />
            {e.value > 0.45 && <text x={ex} y={ey + 3} fontSize="10" fill="var(--ink)" textAnchor={Math.cos(a) > 0 ? 'start' : 'end'}>{e.name}</text>}
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
  const top3 = [...s.emotions].sort((a, b) => b.value - a.value).slice(0, 3);
  const drives = [...data.drives].sort((a, b) => b.value - a.value);
  const W = 306, H = 62;
  const path = (series) => series.map((v, h) => `${h ? 'L' : 'M'}${(8 + (h * (W - 16)) / 23).toFixed(1)} ${(H - 4 - v * (H - 12)).toFixed(1)}`).join(' ');
  const COLS = ['var(--dot)', 'var(--print-b)', 'var(--print-a)'];
  return (
    <>
      <div className="card td-specard">
        <div className="sec-head"><span className="en" style={{ fontSize: 22 }}>specimen</span><h2 className="zh" style={{ margin: 0, fontSize: 13 }}>十六维情绪</h2><span className="go">叶子越长越强</span></div>
        <BigSpecimen emotions={s.emotions} />
      </div>
      <div className="card td-rec">
        <div className="rec"><span>心情</span><i /><b>{s.mood}</b></div>
        <div className="rec"><span>体温</span><i /><b className="serif" style={{ fontSize: 16 }}>{s.bodyTemp}°</b></div>
        <div className="rec"><span>呼吸</span><i /><b>{s.breath?.label}</b></div>
        <div className="rec"><span>和弦</span><i /><b className="serif" style={{ fontSize: 15, fontStyle: 'italic' }}>{s.chord}</b></div>
        <div className="td-top3">最长的三片叶子：<b>{top3.map((e) => e.name).join(' · ')}</b></div>
      </div>
      <div className="sec-head" style={{ marginTop: 22 }}><span className="en" style={{ fontSize: 22 }}>drives</span><h2 className="zh" style={{ margin: 0, fontSize: 13 }}>驱力 · 今天的潮汐</h2>
        <button type="button" className="go" onClick={() => setAll((a) => !a)} aria-expanded={all}>{all ? '收起' : `全部 ${drives.length} 股`}<Icon name="arrow" size={13} /></button></div>
      <div className="card td-tide">
        <svg viewBox={`0 0 ${W} ${H + 4}`} role="img" aria-label={`最强的三股驱力：${drives.slice(0, 3).map((d) => d.name).join('、')}`}>
          <path d={`M8 ${H}H${W - 8}`} stroke="var(--line)" />
          {drives.slice(0, 3).map((d, k) => <path key={d.key} d={path(d.series)} fill="none" stroke={COLS[k]} strokeWidth={2 - k * 0.4} strokeLinecap="round" />)}
        </svg>
        <div className="td-legend">{drives.slice(0, 3).map((d, k) => <span key={d.key}><i style={{ background: COLS[k] }} />{d.name} {Math.round(d.value * 100)}</span>)}</div>
        <div className="td-axis serif"><span>0:00</span><span>6:00</span><span>12:00</span><span>18:00</span><span>现在</span></div>
      </div>
      {all && (
        <div className="card td-all m-settle">
          {drives.map((d) => (
            <div key={d.key} className="td-drv"><span>{d.name}</span><span className="td-drv-b"><i style={{ width: `${d.value * 100}%` }} /></span><b className="serif">{Math.round(d.value * 100)}</b></div>
          ))}
        </div>
      )}
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
  const { data, setData } = useLoad(`/api/tide/memory${qd ? `?q=${encodeURIComponent(qd)}` : ''}`);
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
        <div className="sec-head" style={{ margin: 0 }}><span className="en" style={{ fontSize: 20 }}>heat</span><h3 className="zh" style={{ margin: 0, fontSize: 12.5 }}>记忆热力</h3><span className="go" style={{ fontSize: 10 }}>心潮暂未提供逐日写入时间</span></div>
        {data.heat?.length ? <Heat heat={data.heat} /> : <p className="st-tip">无法生成准确热力图</p>}
        <div className="td-stats"><span>当前读到 <b className="serif">{data.stats.longTerm}</b></span><span>这周写入 <b className="serif">{data.stats.weekWrites ?? '—'}</b></span><span>你手动压的 <b className="serif">{data.stats.manual ?? '—'}</b></span></div>
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
          onDone={(it) => { setData((d) => ({ ...d, stats: { ...d.stats, longTerm: d.stats.longTerm + 1 }, items: [it, ...d.items] })); setFresh(it.id); setPress(false); replaceQuery({ tab: 'memory' }); }} />
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
            <div className="td-dream-tags">{data.last.tags.map((t) => <span key={t}>{t}</span>)}</div>
          </div>
        </div>
      ) : <div className="card cl-empty">昨晚没有做梦</div>}
      <div className="sec-head" style={{ marginTop: 24 }}><span className="en" style={{ fontSize: 22 }}>in the margin</span><h2 className="zh" style={{ margin: 0, fontSize: 13 }}>觉察</h2><span className="go">他写在页边的</span></div>
      {data.aware.map((a) => (
        <div key={a.date} className="td-aware"><span className="serif">{md(a.date)}</span><p className="hand-cn">{a.text}</p></div>
      ))}
      {data.older?.length > 0 && (
        <div className="td-older">
          <span>更早的梦 · {data.olderCount} 个</span>
          {data.older.map((o) => <span key={o.at}>{md(o.at)}《{o.title}》</span>)}
        </div>
      )}
    </>
  );
}
