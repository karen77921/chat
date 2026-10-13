/**
 * 首页 · 奶油玻璃版（只在主题 cream 时用）。参考杂志式排版：大衬线标题、左右错落的玻璃卡、宽幅横卡、日历 + 小卡。
 * 和原首页同一份数据、同样的入口：铃铛 → 他的动态、天气、他此刻 → 心潮、今日留言 / 搜留言 / 按日期、
 * 一起听（播放暂停）/ 一起看、他的动态（全部已读）、所有模块目录。
 */
import { useMemo, useState } from 'react';
import Icon from '../../design/icons.jsx';
import { Cyanotype } from '../../design/paper.jsx';
import AuthImg from '../../design/AuthImg.jsx';
import { useLoad } from '../../lib/useLoad.js';
import { useListen } from '../../lib/listen.jsx';
import { greetingOf, daysTogether, ago, clock } from '../../lib/home.js';
import './home-cream.css';

const WEEK_EN = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const MON_EN = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MON_FULL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const md = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const weekday = (iso) => `周${'日一二三四五六'[new Date(iso).getDay()]}`;
const hm = (iso) => { const d = new Date(iso); return `${d.getHours()}:${pad(d.getMinutes())}`; };

const KIND = {
  reply: { icon: 'chat', href: '#/chat' },
  tool: { icon: 'terminal', href: '#/settings?tab=logs' },
  solo: { icon: 'moon', href: '#/room?tab=solo' },
  memory: { icon: 'leaf', href: '#/tide?tab=memory' },
  photo: { icon: 'photo', href: '#/room?tab=photos' },
};
const TOC = [
  ['聊天', 'Letters', 'chat', '#/chat'], ['小屋', 'Room', 'room', '#/room'], ['心潮', 'Tides', 'tide', '#/tide'],
  ['一起', 'Together', 'play', '#/together'], ['留言板', 'Notes', 'feather', '#/notes'], ['续火花', 'Spark', 'flame', '#/spark'],
  ['设置', 'Desk', 'desk', '#/settings'],
];

function Head({ title, add, href }) {
  return (
    <div className="hc-head">
      <h2>{title}</h2>
      {href && <a href={href} aria-label={add}><Icon name="plus" size={17} stroke={1.4} /></a>}
    </div>
  );
}

export default function HomeCream({ data, d, now, unread, onReadAll, latelyRef }) {
  const names = d?.names || { me: '', him: '' };
  const days = daysTogether(d?.together, now);
  const since = d?.together?.since?.replaceAll('-', '.');
  const L = useListen();
  const listen = d?.listen;
  const playing = L?.state ? L.state.playing : listen?.playing;
  const s = d?.state;
  const top3 = s ? [...(s.emotions || [])].sort((a, b) => b.value - a.value).slice(0, 3).map((e) => e.name) : [];
  const toLately = () => latelyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <main className="home hc">
      {/* 顶部：日期 · 大标题 · 副标题 */}
      <header className="hc-top">
        <div className="hc-date">
          <span>{WEEK_EN[now.getDay()]} · {MON_EN[now.getMonth()]} {now.getDate()}</span>
          {days != null && <em>{days} days</em>}
        </div>
        <button type="button" className="hc-menu" aria-label={unread ? `他的动态，${unread} 条没看` : '他的动态'} onClick={toLately}>
          <Icon name="bell" size={19} stroke={1.3} />{unread > 0 && <i className="dot" />}
        </button>
        <h1 className="hc-title">{names.him || ' '}<br /><span>with {names.me || 'you'}.</span></h1>
        <p className="hc-sub">{greetingOf(now)}{d?.greeting ? `，${d.greeting}` : ''}<br />{since ? `since ${since}` : 'Every day with you.'}</p>
        <i className="hc-rule" />
      </header>

      {data?.available === false && <div className="card hc-pad hc-offline">暂时连不上他那边，过一会儿再来看看。</div>}
      {!data && <div className="card hc-skeleton" aria-label="加载中" />}

      {/* 左：今天 + 他此刻；右：叠放的照片卡 */}
      <section className="hc-split">
        <div className="hc-left">
          <Head title="Today" add="写一条留言" href="#/notes?new=1" />
          {d?.weather ? (
            <div className="card hc-row hc-weather">
              <span className="hc-ring"><Icon name={d.weather.icon || 'cloud'} size={18} stroke={1.3} /></span>
              <span className="hc-row-t"><b>{d.weather.city} · {d.weather.text}</b><em>{d.weather.note || `${d.weather.low}~${d.weather.high}°`}</em></span>
              <span className="hc-temp">{d.weather.temp}°</span>
            </div>
          ) : (
            <a href="#/notes?new=1" className="card hc-row">
              <span className="hc-ring" /><span className="hc-row-t"><b>今天想写点什么？</b></span><Icon name="chev" size={16} />
            </a>
          )}
          {s && (
            <>
              <Head title="His tide" add="进入心潮" href="#/tide" />
              <a href="#/tide" className="card hc-list" aria-label="他此刻，进入心潮">
                <span className="hc-li"><i className="b" /><b>{s.mood}</b></span>
                <span className="hc-li"><i className="r" /><b>体温 {s.bodyTemp}°</b><em>{s.chord}</em></span>
                {top3.length > 0 && <span className="hc-li"><i className="g" /><b>{top3.join(' · ')}</b></span>}
              </a>
            </>
          )}
        </div>
        <a href="#/room?tab=photos" className="hc-memory" aria-label="小屋照片墙">
          <span className="hc-photo back" aria-hidden="true" />
          <span className="hc-photo">
            {d?.cover ? <AuthImg src={d.cover} alt="" /> : <Cyanotype w={150} h={130} seed={2} develop={false} />}
          </span>
          <span className="hc-mem card">
            <span className="hc-mem-k">Together</span>
            <span className="hc-mem-n">{days ?? '—'}<small> days</small></span>
            <span className="hc-pill">去小屋 <Icon name="chev" size={13} /></span>
          </span>
        </a>
      </section>

      {/* 宽幅横卡：一起听 / 一起看 */}
      {listen && (
        <div className="card hc-wide">
          <a href="#/together" className="hc-wide-link" aria-label={`一起听：${listen.title}`}>
            <span className="hc-disc"><Cyanotype w={92} h={92} seed={21} variant="sprig" develop={false} /></span>
            <span className="hc-wide-t">
              <em>TOGETHER · 一起听</em>
              <b>{listen.title}</b>
              <small>{listen.artist} · {clock(listen.positionS)} / {clock(listen.durationS)}</small>
            </span>
          </a>
          <button type="button" className="hc-round" onClick={() => L?.toggle()} aria-label={playing ? '暂停' : '播放'}>
            <Icon name={playing ? 'pause' : 'play'} size={14} stroke={1.6} />
          </button>
        </div>
      )}
      {d?.watch && (
        <a href="#/together?tab=watch" className="card hc-wide" aria-label={`一起看：${d.watch.title}`}>
          <span className="hc-disc sq"><Icon name="window" size={22} stroke={1.2} /></span>
          <span className="hc-wide-t">
            <em>WATCH · 一起看 · 片单第 {d.watch.order} 部</em>
            <b>《{d.watch.title}》</b>
            <small>{weekday(d.watch.at)} {hm(d.watch.at)} 见</small>
          </span>
          <span className="hc-round"><Icon name="chev" size={15} /></span>
        </a>
      )}

      {/* 日历（点日子看那天的留言）+ 今日留言 / 最新动态 */}
      <section className="card hc-board">
        <Calendar now={now} />
        <div className="hc-board-r">
          {d?.note && (
            <a href="#/notes" className="hc-mini" aria-label="今日留言，打开留言板">
              <span className="hc-mini-t"><b>Note</b><em>{d.note.text}</em><small>{md(d.note.at)} · 共 {d.note.total} 条</small></span>
              <Icon name="chev" size={15} />
            </a>
          )}
          {d?.activity?.[0] && (
            <a href={KIND[d.activity[0].kind]?.href || '#/room'} className="hc-mini">
              <span className="hc-mini-t"><b>Lately</b><em>{d.activity[0].text}</em><small>{ago(d.activity[0].at, now)}</small></span>
              <Icon name="chev" size={15} />
            </a>
          )}
        </div>
      </section>

      <div className="pill hc-search">
        <a href="#/notes?search=1" className="ns-q"><Icon name="search" size={16} /><span>搜留言：关键词、日期…</span></a>
        <a href="#/notes?date=1" className="ns-d"><Icon name="calendar" size={15} />按日期</a>
      </div>

      {/* 他的动态 */}
      <div ref={latelyRef} className="anchor" />
      <div className="hc-head hc-head-wide">
        <h2>Lately <small>他的动态</small></h2>
        {unread ? <button type="button" className="hc-link" onClick={onReadAll}>全部已读</button> : <a className="hc-link" href="#/room">去小屋</a>}
      </div>
      {d?.activity?.length ? (
        <div className="card hc-lately">
          {d.activity.map((a) => (
            <a key={a.id} href={a.kind === 'reply' && a.sessionId ? `#/chat/t?id=${encodeURIComponent(a.sessionId)}` : KIND[a.kind]?.href || '#/room'} className="hc-act">
              <span className="hc-ring"><Icon name={KIND[a.kind]?.icon || 'leaf'} size={16} stroke={1.3} /></span>
              <span className="hc-row-t"><b>{a.title}</b><em>{a.text}</em></span>
              <span className="hc-act-m">{ago(a.at, now)}{a.unread > 0 && <span className="badge">{a.unread}</span>}</span>
            </a>
          ))}
        </div>
      ) : <div className="card hc-pad muted">还没有可记录的动态</div>}

      {/* 目录 */}
      <nav className="hc-toc" aria-label="目录">
        {TOC.map(([zh, en, icon, href]) => (
          <a key={href} href={href} className="card hc-tile">
            <Icon name={icon} size={18} stroke={1.3} />
            <b>{zh}</b><em>{en}</em>
          </a>
        ))}
      </nav>
      <footer className="hc-foot">IMPRINT · <span>with you, every tide.</span></footer>
    </main>
  );
}

/* 小日历：有留言的日子带一个点，点哪天就去看那天的留言 */
function Calendar({ now }) {
  const [view, setView] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const month = `${view.getFullYear()}-${pad(view.getMonth() + 1)}`;
  const { data } = useLoad(`/api/notes/calendar?month=${month}`);
  const cells = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const start = new Date(first); start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => { const x = new Date(start); x.setDate(start.getDate() + i); return x; });
  }, [view]);
  const rows = cells[35].getMonth() === view.getMonth() ? 6 : 5;
  const today = ymd(now);
  const step = (k) => setView((v) => new Date(v.getFullYear(), v.getMonth() + k, 1));
  return (
    <div className="hc-cal">
      <div className="hc-cal-h">
        <button type="button" className="hc-round sm" onClick={() => step(-1)} aria-label="上个月"><Icon name="back" size={13} /></button>
        <span>{MON_FULL[view.getMonth()]} {view.getFullYear()}</span>
        <button type="button" className="hc-round sm" onClick={() => step(1)} aria-label="下个月"><Icon name="chev" size={13} /></button>
      </div>
      <div className="hc-cal-g">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => <span key={i} className="w">{w}</span>)}
        {cells.slice(0, rows * 7).map((x) => {
          const k = ymd(x);
          const other = x.getMonth() !== view.getMonth();
          const has = data?.days?.[k];
          return (
            <a key={k} href={`#/notes?day=${k}`} className={`d${other ? ' o' : ''}${x.getDay() === 0 ? ' sun' : ''}${k === today ? ' t' : ''}`} aria-label={`${k} 的留言`}>
              {x.getDate()}{has && <i />}
            </a>
          );
        })}
      </div>
    </div>
  );
}
