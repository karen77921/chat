/** 首页顶部：品牌、名字、问候、在一起的天数 + 蓝晒拼贴 */
import Icon from '../../design/icons.jsx';
import { Torn, Cyanotype, Tape, Stamp, Postmark } from '../../design/paper.jsx';
import { greetingOf, daysTogether } from '../../lib/home.js';

function lineMarks(n, gap) {
  const r = [];
  for (let i = 0; i < n; i++) {
    const y = 34 + i * gap;
    let d = `M${18 + (i * 7) % 14} ${y}`;
    for (let x = 0; x < 150 + ((i * 37) % 40); x += 7) d += `q3.5 ${-2 - ((x + i) % 3)} 7 ${((x * i) % 3) * 0.2 - 0.2}`;
    r.push(<path key={i} d={d} fill="none" stroke="var(--ink)" strokeWidth=".7" strokeLinecap="round" opacity=".18" />);
  }
  return r;
}

export default function Hero({ data, now, unread, onBell }) {
  const names = data?.names || { me: '', him: '' };
  const days = daysTogether(data?.together, now);
  const since = data?.together?.since?.replaceAll('-', '.');
  return (
    <header className="hero">
      <div className="brand"><BrandMark /><span>IMPRINT</span></div>
      <h1 className="names serif">
        <span>{names.him || ' '}</span><span className="amp hand">&amp;</span><span>{names.me}</span>
      </h1>
      <p className="greet">{greetingOf(now)}{data?.greeting ? `，${data.greeting}` : ''}</p>
      <button type="button" className="rbtn bell" aria-label={unread ? `他的动态，${unread} 条没看` : '他的动态'} onClick={onBell}>
        <Icon name="bell" size={19} />{unread > 0 && <i className="dot" />}
      </button>

      {/* 拼贴：背后一张横线纸 + 蓝晒印相 + 纸胶带 + 邮票 + 邮戳 */}
      <div className="collage" aria-hidden="true">
        <Torn w={226} h={292} seed={11} className="c-sheet" style={{ rotate: '-4deg' }}>
          <svg width="226" height="292" style={{ position: 'absolute', inset: 0 }}>{lineMarks(12, 21)}</svg>
        </Torn>
        <Torn w={206} h={262} seed={21} amp={3.4} shadow="drop2" className="c-print" style={{ rotate: '3deg' }}>
          <Cyanotype w={206} h={262} seed={2} src={data?.cover || undefined} />
        </Torn>
        <Tape w={74} h={22} seed={4} className="c-tape m-breeze-tape" style={{ rotate: '-7deg' }} />
        <Stamp className="c-stamp m-breeze" style={{ rotate: '8deg' }} />
        <Postmark className="c-postmark" />
      </div>

      <div className="kicker since-k">TOGETHER SINCE ✦</div>
      <div className="days serif">{days ?? '—'}</div>
      <div className="days-unit hand">days</div>
      <div className="every hand">Every day with you.</div>
      {since && <div className="since">since {since}</div>}
      <svg width="120" height="10" className="squiggle" aria-hidden="true"><path d="M2 6q20-5 40-1t40 0 36-2" fill="none" stroke="var(--accent)" strokeWidth="1.2" strokeLinecap="round" opacity=".6" /></svg>
    </header>
  );
}

export function BrandMark({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="3.5" y="3.5" width="17" height="17" rx="1" strokeDasharray="2 1.6" />
      <path d="M12 17V8M12 11l-3-2.5M12 13.5l3-2.5" strokeLinecap="round" />
    </svg>
  );
}
