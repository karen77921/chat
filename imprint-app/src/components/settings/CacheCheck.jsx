/**
 * 缓存体检：真打几发探针，告诉她这条线路能不能缓存、工具有没有多收钱、后面接的是不是 Claude，
 * 再结合最近几轮真实聊天给一句人话结论。10 分钟内再点直接给上一份，不重复花钱。
 * 数据：GET/POST /api/cache-check（→ /loop/cache-check）
 */
import { useEffect, useRef, useState } from 'react';
import Icon from '../../design/icons.jsx';
import { api } from '../../lib/api.js';
import './cachecheck.css';

const LEVEL = { good: 'cc-good', warn: 'cc-warn', bad: 'cc-bad', info: 'cc-info' };
const when = (iso) => { const d = new Date(iso); return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };

export default function CacheCheck() {
  const [data, setData] = useState(null);
  const [index, setIndex] = useState(0);
  const [note, setNote] = useState('');
  const timer = useRef(null);

  const load = async () => {
    try {
      const got = await api('/api/cache-check');
      setData(got);
      if (got.running) timer.current = setTimeout(load, 2500);
      else if (got.error) setNote(`体检没做完：${got.error}`);
    } catch (e) { setNote(e?.message || '暂时连不上'); }
  };
  useEffect(() => { load(); return () => clearTimeout(timer.current); }, []);

  const run = async (force) => {
    setNote('');
    try {
      const got = await api('/api/cache-check', { method: 'POST', body: { index, force } });
      if (got.reused) { setData((d) => ({ ...d, result: got.result })); setNote('10 分钟内刚测过，直接给你这份，没再花钱。要重测点下面「强制重测」。'); return; }
      setData((d) => ({ ...d, running: true, step: got.step }));
      clearTimeout(timer.current); timer.current = setTimeout(load, 2000);
    } catch (e) { setNote(e?.message || '没开始'); }
  };

  if (!data) return <div className="card cc-pad">{note || '正在看…'}</div>;
  const r = data.result;
  const routes = data.routes || [];
  return (
    <div className="cc">
      <div className="card cc-intro">
        <span className="cc-ic"><Icon name="sparkle" size={20} /></span>
        <span>
          <b>缓存体检</b>
          <em>真打 6 发小请求，大约用掉 {Math.round((data.estimate_tokens || 0) / 1000)}k token</em>
        </span>
      </div>
      {routes.length > 1 && (
        <div className="st-gacts">{routes.map((x) => <button key={x.index} type="button" className={`chip ${index === x.index ? 'on' : ''}`} onClick={() => setIndex(x.index)}>{x.index === 0 ? '当前' : `备用 ${x.index}`} · {x.model}</button>)}</div>
      )}
      <div className="st-gacts">
        <button type="button" className="btn-main" disabled={data.running} onClick={() => run(false)}>{data.running ? `正在测：${data.step || '…'}` : r ? '再体检一次' : '开始体检'}</button>
        {r && !data.running && <button type="button" className="mini-btn" onClick={() => run(true)}>强制重测</button>}
      </div>
      {note && <p className="st-tip" role="status">{note}</p>}

      {r && (
        <>
          <p className="cc-meta">{when(r.at)} · {r.host} · {r.model} · 打了 {r.probes} 发，用掉 {r.tokens_spent.toLocaleString('en-US')} token · {r.elapsed_s}s</p>
          <div className="card cc-list">
            {r.sections.map((s) => (
              <div key={s.key} className="cc-row">
                <div className="cc-h"><b>{s.title}</b><span className={LEVEL[s.level] || ''}>{s.status}</span>{s.saved != null && <i className="cc-good">省 {s.saved}%</i>}</div>
                {s.note && <small className="cc-note">{s.note}</small>}
                <p className={s.level === 'bad' ? 'cc-bad' : ''}>{s.summary}</p>
              </div>
            ))}
          </div>
          {r.advice.length > 0 && (
            <div className="card cc-advice">
              <h3>该怎么办</h3>
              {r.advice.map((a, i) => <p key={i} className={LEVEL[a.level] || ''}>{a.level === 'bad' ? '🔴 ' : a.level === 'good' ? '🟢 ' : '🟡 '}{a.text}</p>)}
            </div>
          )}
          <p className="st-tip">探针用的是你人设的前 {r.prefix_chars.toLocaleString('en-US')} 字，只能证明「这组探针能不能缓存」；真实对话以「真实」那一行为准。工具计价是粗估，差两倍以上才算虚高。</p>
        </>
      )}
    </div>
  );
}
