/** 按日期找：撕边纸日历，有留言的日子下面有点（实心 = 他留的，空心 = 我留的） */
import { useState } from 'react';
import Sheet from '../../design/Sheet.jsx';
import Icon from '../../design/icons.jsx';
import { useLoad } from '../../lib/useLoad.js';
import { monthCells } from '../../lib/notes.js';

const pad = (n) => String(n).padStart(2, '0');
const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
const EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function CalendarSheet({ open, onClose, onPick, today, names }) {
  const [ym, setYm] = useState(() => [today.getFullYear(), today.getMonth() + 1]);
  const [picked, setPicked] = useState(() => today.getDate());
  const [y, m] = ym;
  const month = `${y}-${pad(m)}`;
  const { data } = useLoad(open ? `/api/notes/calendar?month=${month}` : null);
  const days = data?.days || {};
  const isFuture = (d) => new Date(y, m - 1, d) > today;
  const go = (k) => { const d = new Date(y, m - 1 + k, 1); setYm([d.getFullYear(), d.getMonth() + 1]); setPicked(null); };
  const key = picked ? `${month}-${pad(picked)}` : null;
  const { data: dayData } = useLoad(open && key ? `/api/notes?range=day&date=${key}` : null);
  const dayNotes = dayData?.items || [];
  const count = key ? (days[key]?.him || 0) + (days[key]?.me || 0) : 0;

  return (
    <Sheet open={open} onClose={onClose} label="按日期找留言">
      <div className="cal-head">
        <button type="button" className="rbtn" style={{ width: 36, height: 36 }} aria-label="上个月" onClick={() => go(-1)}><Icon name="back" size={16} stroke={1.5} /></button>
        <div className="cal-title"><span className="serif">{y}</span><span>{CN[m - 1]}月</span><span className="hand">{EN[m - 1]}</span></div>
        <button type="button" className="rbtn" style={{ width: 36, height: 36, transform: 'scaleX(-1)' }} aria-label="下个月" onClick={() => go(1)} disabled={y === today.getFullYear() && m === today.getMonth() + 1}><Icon name="back" size={16} stroke={1.5} /></button>
      </div>
      <div className="cal-week" aria-hidden="true">{'日一二三四五六'.split('').map((c) => <span key={c}>{c}</span>)}</div>
      <div className="cal-grid">
        {monthCells(y, m).map((d, i) => {
          if (!d) return <span key={i} />;
          const info = days[`${month}-${pad(d)}`];
          return (
            <button key={i} type="button" className={`cal-d serif ${d === picked ? 'on' : ''}`} disabled={isFuture(d)} onClick={() => setPicked(d)}
              aria-label={`${m}月${d}日${info ? `，${info.him + info.me} 条` : ''}`} aria-pressed={d === picked}>
              <span className="n">{d}</span>
              <span className="cal-dots">{info?.him > 0 && <i className="cal-him" />}{info?.me > 0 && <i className="cal-me" />}</span>
            </button>
          );
        })}
      </div>
      <div className="cal-legend"><span><i className="cal-him" />他留的</span><span><i className="cal-me" />我留的</span></div>
      {key && (
        <div className="card cal-day">
          <div className="cd-h"><span>{m}月{picked}日 · 周{'日一二三四五六'[new Date(y, m - 1, picked).getDay()]}</span><span className="muted">{count} 条</span></div>
          {dayNotes.slice(0, 2).map((n) => (
            <div key={n.id} className="cd-row"><span>{n.from === 'him' ? names?.him : names?.me}</span>{n.text}</div>
          ))}
          {!count && <div className="cd-row muted">这天没有留言</div>}
        </div>
      )}
      <button type="button" className="btn-main cal-go" disabled={!count} onClick={() => onPick(key)}>看这天的留言</button>
    </Sheet>
  );
}
