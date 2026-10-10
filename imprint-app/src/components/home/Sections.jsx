/** 首页的各个区块。每块都能点进对应的页面。 */
import Icon from '../../design/icons.jsx';
import { Cyanotype, Tape, Wax, PaperClip, Vinyl, Specimen, TornBox } from '../../design/paper.jsx';
import { ago, stampDate, clock, chordSteps } from '../../lib/home.js';
import { useListen } from '../../lib/listen.jsx';

export function SecHead({ en, zh, go, href, onGo }) {
  const inner = <>{go}<Icon name="arrow" size={13} /></>;
  return (
    <div className="sec-head">
      <span className="en">{en}</span>
      <h2 className="zh" style={{ margin: 0 }}>{zh}</h2>
      {href && <a className="go" href={href}>{inner}</a>}
      {onGo && <button type="button" className="go" onClick={onGo}>{inner}</button>}
    </div>
  );
}

/* ---------- 天气 ---------- */
export function Weather({ w }) {
  if (!w) return null;
  return (
    <div className="weather card m-settle">
      <Tape w={70} h={20} seed={6} style={{ right: 24, top: -10, rotate: '6deg' }} />
      <div className="w-top">
        <span className="w-ico"><Icon name={w.icon || 'cloud'} size={28} stroke={1.2} /></span>
        <div>
          <div className="w-city">{w.city} · {w.text}</div>
          <div className="w-meta">湿度 {w.humidity}% · 体感 {w.feels}° · {w.low}~{w.high}°</div>
        </div>
        <span className="w-temp serif">{w.temp}<sup>°</sup></span>
      </div>
      {w.note && <div className="w-note hand-cn">{w.note}</div>}
    </div>
  );
}

/* ---------- 他此刻（进心潮） ---------- */
function Breath({ rate = 0.4 }) {
  const wl = 12 - rate * 6;
  let d = 'M1 7';
  for (let x = 1; x < 45; x += wl) d += `q${wl / 4} -6 ${wl / 2} 0t${wl / 2} 0`;
  return <svg width="46" height="14" aria-hidden="true"><path d={d} fill="none" stroke="var(--accent)" strokeWidth="1.2" /></svg>;
}
function Staff({ chord }) {
  const steps = chordSteps(chord);
  return (
    <svg width="40" height="24" aria-hidden="true">
      <g stroke="var(--ink)" strokeWidth=".5" opacity=".55">{[3, 7.5, 12, 16.5, 21].map((y) => <path key={y} d={`M0 ${y}h40`} />)}</g>
      <g fill="var(--ink)">{steps.map((s) => <ellipse key={s} cx="20" cy={21 - s * 2.25} rx="2.6" ry="1.9" transform={`rotate(-20 20 ${21 - s * 2.25})`} />)}</g>
    </svg>
  );
}
export function HisNow({ s }) {
  if (!s) return null;
  const top3 = [...(s.emotions || [])].sort((a, b) => b.value - a.value).slice(0, 3).map((e) => e.name);
  return (
    <a href="#/tide" className="his card press" aria-label="他此刻，进入心潮">
      <div className="his-spec">
        <Specimen values={(s.emotions || []).map((e) => e.value)} />
        <span className="hand">specimen No.{s.emotions?.length || 0}</span>
      </div>
      <div className="his-rec">
        <div className="rec"><span>心情</span><i /><b>{s.mood}</b></div>
        <div className="rec"><span>体温</span><i /><b className="serif" style={{ fontSize: 17 }}>{s.bodyTemp}°</b></div>
        <div className="rec"><span>呼吸</span><i /><Breath rate={s.breath?.rate} /><b>{s.breath?.label}</b></div>
        <div className="rec"><span>和弦</span><i /><Staff chord={s.chord} /><b className="serif" style={{ fontSize: 16, fontStyle: 'italic' }}>{s.chord}</b></div>
        <div className="his-top">最长的三片叶子<br /><span>{top3.join(' · ')}</span></div>
      </div>
    </a>
  );
}

/* ---------- 今日留言 + 搜留言 ---------- */
export function TodayNote({ note, names }) {
  if (!note) return null;
  const who = note.from === 'him' ? names?.him : names?.me;
  return (
    <>
      <div className="note-wrap">
        <a href="#/notes" className="note sheet press" aria-label="今日留言，打开留言板">
          <span className="note-k serif">TODAY&#39;S NOTE</span>
          <p className="note-text">{note.text}</p>
          <div className="note-sign">
            <span className="hand">— {who}</span><span className="hand-cn">留</span>
            <span className="serif note-date">{stampDate(note.at)}</span>
          </div>
        </a>
        <Wax size={56} className="note-wax" />
        <PaperClip className="note-clip" />
      </div>
      <div className="pill note-search">
        <a href="#/notes?search=1" className="ns-q"><Icon name="search" size={16} /><span>搜留言：关键词、日期…</span></a>
        <a href="#/notes?date=1" className="ns-d"><Icon name="calendar" size={15} />按日期</a>
      </div>
    </>
  );
}

/* ---------- 一起听 · 一起看 ---------- */
export function Together({ listen, watch }) {
  // 和「一起」页、悬浮小窗共用一份播放状态
  const L = useListen();
  const playing = L?.state ? L.state.playing : listen?.playing;
  const toggle = () => L?.toggle();
  return (
    <div className="tg">
      {listen && (
        <div className="tg-listen card">
          <a href="#/together" className="tg-link" aria-label={`一起听：${listen.title}`}>
            <div className="tg-art">
              <Vinyl size={92} spinning={playing} className="tg-vinyl" />
              <Cyanotype w={96} h={96} seed={21} variant="sprig" className="tg-sleeve" develop={false} />
            </div>
            <div className="kicker" style={{ letterSpacing: '.3em' }}>一起听</div>
            <div className="tg-title serif">{listen.title}</div>
            <div className="tg-artist">{listen.artist}</div>
            <div className="tg-bar"><i style={{ width: `${(listen.positionS / listen.durationS) * 100}%` }} /></div>
            <div className="tg-time serif"><span>{clock(listen.positionS)}</span><span>{clock(listen.durationS)}</span></div>
          </a>
          <button type="button" className="tg-play" onClick={toggle} aria-label={playing ? '暂停' : '播放'}>
            <Icon name={playing ? 'pause' : 'play'} size={14} stroke={1.6} />
          </button>
        </div>
      )}
      {watch && (
        <a href="#/together?tab=watch" className="ticket press" aria-label={`一起看：${watch.title}`}>
          <div className="serif tk-k">ADMIT TWO</div>
          <div className="tk-sub">一起看 · 片单第 {watch.order} 部</div>
          <div className="tk-title">《{watch.title}》</div>
          <div className="tk-when hand-cn">{weekday(watch.at)} {hm(watch.at)} 见</div>
          {watch.note && <div className="tk-note">“{watch.note}”</div>}
          <i className="tk-cut" /><i className="tk-notch l" /><i className="tk-notch r" />
          <div className="tk-foot"><span className="serif">No.{watch.ticketNo}</span><Barcode /></div>
        </a>
      )}
    </div>
  );
}
const weekday = (iso) => `周${'日一二三四五六'[new Date(iso).getDay()]}`;
const hm = (iso) => { const d = new Date(iso); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
function Barcode() {
  const bars = [[0, 1], [3, 2], [7, 1], [10, 1], [13, 3], [18, 1], [21, 2], [25, 1], [28, 1], [31, 3], [36, 1], [39, 2], [43, 1], [46, 2], [50, 1], [53, 1]];
  return <svg width="54" height="18" aria-hidden="true">{bars.map(([x, w]) => <rect key={x} x={x} width={w} height="18" fill="var(--ink)" opacity=".8" />)}</svg>;
}

/* ---------- 他的动态 ---------- */
const KIND = {
  solo: { icon: 'moon', href: '#/room?tab=solo' },
  memory: { icon: 'leaf', href: '#/tide?tab=memory' },
  photo: { icon: 'photo', href: '#/room?tab=photos' },
};
export function Lately({ items, now }) {
  if (!items?.length) return <div className="card lately-empty muted">他今天还没留下什么</div>;
  return (
    <div className="card lately">
      {items.map((a) => (
        <a key={a.id} href={KIND[a.kind]?.href || '#/room'} className="act">
          <span className="act-i"><Icon name={KIND[a.kind]?.icon || 'leaf'} size={19} /></span>
          <span className="act-t"><b>{a.title}</b><em>{a.text}</em></span>
          <span className="act-m">{ago(a.at, now)}{a.unread > 0 && <span className="badge">{a.unread}</span>}</span>
        </a>
      ))}
    </div>
  );
}

/* ---------- 目录：所有模块的入口 ---------- */
const TOC = [
  ['I.', '聊天', 'letters', '#/chat'], ['II.', '小屋', 'the room', '#/room'], ['III.', '心潮', 'tides', '#/tide'],
  ['IV.', '一起', 'together', '#/together'], ['V.', '留言板', 'notes', '#/notes'], ['VI.', '续火花', 'spark', '#/spark'], ['VII.', '设置', 'the desk', '#/settings'],
];
export function Contents() {
  return (
    <div className="toc-wrap">
      <TornBox seed={31} className="toc-sheet" style={{ rotate: '-1.2deg' }}>
        <div className="toc-in">
          <div className="serif toc-k">CONTENTS</div>
          <nav aria-label="目录">
            {TOC.map(([n, zh, en, href]) => (
              <a key={href} href={href} className="toc">
                <span className="serif toc-n">{n}</span><span className="toc-zh">{zh}</span><span className="hand toc-en">{en}</span>
              </a>
            ))}
          </nav>
        </div>
      </TornBox>
      <div className="toc-print drop2" aria-hidden="true" style={{ rotate: '5deg' }}>
        <Cyanotype w={118} h={150} seed={8} />
      </div>
      <Tape w={62} h={20} seed={44} className="m-breeze-tape" style={{ right: 52, bottom: 168, rotate: '-4deg' }} />
      <div className="toc-cap hand-cn" aria-hidden="true">十月 · 河边</div>
    </div>
  );
}
