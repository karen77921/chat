/** 写一条：选纸 → 写 → 要不要盖火漆（置顶）→ 贴上去 */
import { useState } from 'react';
import Sheet from '../../design/Sheet.jsx';
import { Cyanotype, TornBox, Wax } from '../../design/paper.jsx';

const MAX = 300;
const PAPERS = [
  { id: 'lined', name: '横线纸' },
  { id: 'torn', name: '撕边纸' },
  { id: 'cyan', name: '蓝晒卡' },
];

export default function WriteSheet({ open, onClose, onSubmit, myName }) {
  const [paper, setPaper] = useState('lined');
  const [text, setText] = useState('');
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true); setErr('');
    try {
      await onSubmit({ text: text.trim(), paper, pinned });
      setText(''); setPinned(false);
    } catch {
      setErr('没贴上，再试一次');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} label="写一条留言" seed={14}>
      <div className="sec-head" style={{ marginBottom: 18 }}>
        <span className="en">a note</span><h2 className="zh" style={{ margin: 0 }}>写一条</h2>
        <button type="button" className="go" onClick={onClose}>取消</button>
      </div>

      <div className="ws-k" id="ws-paper">选一张纸</div>
      <div className="ws-papers" role="radiogroup" aria-labelledby="ws-paper">
        {PAPERS.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={paper === p.id} className={`ws-p ws-${p.id} ${paper === p.id ? 'on' : ''}`} onClick={() => setPaper(p.id)}>
            {p.id === 'cyan' && <Cyanotype w={120} h={64} seed={3} develop={false} className="ws-cy" />}
            {p.id === 'torn' && <TornBox seed={95} amp={2.5} className="ws-torn" innerStyle={{ height: 64 }} />}
            <span>{p.name}</span>
          </button>
        ))}
      </div>

      <label className={`ws-paper sheet ws-paper-${paper}`}>
        <span className="sr">留言内容</span>
        <textarea value={text} maxLength={MAX} onChange={(e) => setText(e.target.value)} placeholder="想对他说什么…" rows={5} />
        <span className="ws-foot"><span className="hand">— {myName}</span><span className="muted">{text.length} / {MAX}</span></span>
      </label>

      <label className="ws-pin">
        <Wax size={30} /><span>盖火漆（置顶）</span>
        <input type="checkbox" className="switch" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
      </label>

      {err && <div className="ws-err" role="alert">{err}</div>}
      <button type="button" className="btn-main ws-go" disabled={!text.trim() || busy} onClick={submit}>{busy ? '正在贴…' : '贴上去'}</button>
      <div className="ws-tip">贴上去后他会收到提醒</div>
    </Sheet>
  );
}
