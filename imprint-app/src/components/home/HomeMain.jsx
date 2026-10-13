/**
 * 首页（按她画的草图）：
 *   头像 · 他 × 她 · 头像 / 在一起 N 天 / 会动的两只年糕
 *   他此刻想说的话（可以换一句）
 *   留言板 ｜ 他的心情 + 待办（他答应你、给自己定了时间的事）
 *   往下：一起听 / 一起看、他的动态、所有入口
 */
import { useEffect, useState } from 'react';
import Icon from '../../design/icons.jsx';
import Sheet from '../../design/Sheet.jsx';
import AuthImg from '../../design/AuthImg.jsx';
import { api } from '../../lib/api.js';
import { useLoad } from '../../lib/useLoad.js';
import { useListen } from '../../lib/listen.jsx';
import { daysTogether, ago, clock } from '../../lib/home.js';
import mochiHim from '../../assets/mochi-him.png';
import mochiHer from '../../assets/mochi-her.png';
import './home-main.css';

const pad = (n) => String(n).padStart(2, '0');
const hm = (iso) => { const d = new Date(iso); return `${d.getHours()}:${pad(d.getMinutes())}`; };
const when = (iso, now) => {
  const d = new Date(iso);
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  return sameDay ? `今天 ${hm(iso)}` : d.toDateString() === tomorrow.toDateString() ? `明天 ${hm(iso)}` : `${d.getMonth() + 1}月${d.getDate()}日 ${hm(iso)}`;
};
const weekday = (iso) => `周${'日一二三四五六'[new Date(iso).getDay()]}`;

const KIND = {
  reply: { icon: 'chat', href: '#/chat' },
  tool: { icon: 'terminal', href: '#/settings?tab=logs' },
  solo: { icon: 'moon', href: '#/room?tab=solo' },
  memory: { icon: 'leaf', href: '#/tide?tab=memory' },
  photo: { icon: 'photo', href: '#/room?tab=photos' },
};
const ENTRIES = [
  ['聊天', 'chat', '#/chat'], ['小屋', 'room', '#/room'], ['心潮', 'tide', '#/tide'], ['一起', 'play', '#/together'],
  ['留言板', 'feather', '#/notes'], ['续火花', 'flame', '#/spark'], ['设置', 'desk', '#/settings'],
];

function Face({ src, label }) {
  return (
    <a href="#/settings?p=beauty" className="hm-face" aria-label={`${label}的头像，去换头像`}>
      {src ? <AuthImg src={src} alt="" /> : <span>{label?.[0] || '·'}</span>}
    </a>
  );
}

/* 两只年糕：平时轻轻呼吸、晃一晃；点一下会被捏扁再弹回来 */
function Mochi() {
  const [poke, setPoke] = useState('');
  const tap = (who) => { setPoke(''); requestAnimationFrame(() => setPoke(who)); };
  return (
    <div className="hm-mochi" aria-hidden="true">
      <img src={mochiHim} alt="" className={`m-him ${poke === 'him' ? 'poke' : ''}`} onClick={() => tap('him')} onAnimationEnd={() => setPoke('')} draggable="false" />
      <img src={mochiHer} alt="" className={`m-her ${poke === 'her' ? 'poke' : ''}`} onClick={() => tap('her')} onAnimationEnd={() => setPoke('')} draggable="false" />
    </div>
  );
}

export default function HomeMain({ data, d, now, unread, onReadAll, latelyRef, onNamesSaved }) {
  const names = d?.names || { me: '', him: '' };
  const days = daysTogether(d?.together, now);
  const whisper = useLoad('/api/home/whisper');
  const plans = useLoad('/api/home/plans');
  const [asking, setAsking] = useState(false);
  const [naming, setNaming] = useState(false);
  const L = useListen();
  const listen = d?.listen;
  const playing = L?.state ? L.state.playing : listen?.playing;
  const s = d?.state;
  const top3 = s ? [...(s.emotions || [])].sort((a, b) => b.value - a.value).slice(0, 3).map((e) => e.name) : [];
  const upcoming = (plans.data?.items || []).filter((p) => new Date(p.at) > now).slice(0, 3);

  const another = async () => {
    setAsking(true);
    try { whisper.setData(await api('/api/home/whisper', { method: 'POST' })); } catch { /* 留着上一句 */ }
    setAsking(false);
  };

  return (
    <main className="home hm">
      {/* 头像 · 他 × 她 · 头像 */}
      <header className="hm-top">
        <button type="button" className="hm-bell" aria-label={unread ? `他的动态，${unread} 条没看` : '他的动态'}
          onClick={() => latelyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
          <Icon name="bell" size={18} stroke={1.3} />{unread > 0 && <i className="dot" />}
        </button>
        <div className="hm-pair">
          <Face src={d?.avatars?.him} label={names.him} />
          <button type="button" className="hm-names" onClick={() => setNaming(true)} aria-label="改昵称">
            <span>{names.him || ' '}</span><em>×</em><span>{names.me}</span>
          </button>
          <Face src={d?.avatars?.me} label={names.me} />
        </div>
        <p className="hm-days">在一起 <b>{days ?? '—'}</b> 天</p>
      </header>

      {data?.available === false && <div className="card hm-pad muted">暂时连不上他那边，过一会儿再来看看。</div>}
      {!data && <div className="card hm-skeleton" aria-label="加载中" />}

      {/* 他此刻想说的话，年糕坐在卡片上 */}
      <section className="hm-say-wrap">
        <Mochi />
        <div className="card hm-say">
          <span className="hm-k">他想对你说</span>
          <p className={asking ? 'fading' : ''}>{whisper.data?.text || (whisper.data ? '他还在想…' : '…')}</p>
          <div className="hm-say-f">
            <span>{whisper.data?.at ? ago(whisper.data.at, now) : ''}</span>
            <button type="button" onClick={another} disabled={asking}><Icon name="sync" size={13} stroke={1.5} />{asking ? '他在想…' : '换一句'}</button>
          </div>
        </div>
      </section>

      {/* 留言板 ｜ 他的心情 + 待办 */}
      <section className="hm-two">
        <div className="card hm-box">
          <a href="#/notes" className="hm-box-h"><b>留言板</b><Icon name="chev" size={14} /></a>
          {d?.note ? (
            <a href="#/notes" className="hm-note">
              <p>{d.note.text}</p>
              <small>— {d.note.from === 'him' ? names.him : names.me} · 共 {d.note.total} 条</small>
            </a>
          ) : <p className="hm-empty">还没有留言</p>}
          <a href="#/notes?new=1" className="hm-add"><Icon name="plus" size={13} />写一条</a>
        </div>
        <div className="card hm-box">
          <a href="#/tide" className="hm-box-h"><b>他的心情</b><Icon name="chev" size={14} /></a>
          {s ? (
            <a href="#/tide" className="hm-mood">
              <p>{s.mood}</p>
              {top3.length > 0 && <small>{top3.join(' · ')}</small>}
            </a>
          ) : <p className="hm-empty">他还没写心潮</p>}
          <div className="hm-box-h sub"><b>待办</b></div>
          {upcoming.length ? (
            <ul className="hm-todo">
              {upcoming.map((p) => <li key={p.id}><i /><span>{p.text}</span><time>{when(p.at, now)}</time></li>)}
            </ul>
          ) : <p className="hm-empty">他现在没有答应你、还没做的事</p>}
        </div>
      </section>

      {/* 往下：一起、动态、入口 */}
      {listen && (
        <div className="card hm-wide">
          <a href="#/together" className="hm-wide-a" aria-label={`一起听：${listen.title}`}>
            <span className="hm-ico"><Icon name="play" size={16} /></span>
            <span className="hm-wide-t"><em>一起听</em><b>{listen.title}</b><small>{listen.artist} · {clock(listen.positionS)} / {clock(listen.durationS)}</small></span>
          </a>
          <button type="button" className="hm-round" onClick={() => L?.toggle()} aria-label={playing ? '暂停' : '播放'}><Icon name={playing ? 'pause' : 'play'} size={14} stroke={1.6} /></button>
        </div>
      )}
      {d?.watch && (
        <a href="#/together?tab=watch" className="card hm-wide" aria-label={`一起看：${d.watch.title}`}>
          <span className="hm-ico"><Icon name="window" size={16} /></span>
          <span className="hm-wide-t"><em>一起看</em><b>《{d.watch.title}》</b><small>{weekday(d.watch.at)} {hm(d.watch.at)} 见</small></span>
          <span className="hm-round"><Icon name="chev" size={14} /></span>
        </a>
      )}

      <div ref={latelyRef} className="anchor" />
      <div className="hm-sec">
        <h2>他的动态</h2>
        {unread ? <button type="button" onClick={onReadAll}>全部已读</button> : <a href="#/room">去小屋</a>}
      </div>
      {d?.activity?.length ? (
        <div className="card hm-list">
          {d.activity.map((a) => (
            <a key={a.id} href={a.kind === 'reply' && a.sessionId ? `#/chat/t?id=${encodeURIComponent(a.sessionId)}` : KIND[a.kind]?.href || '#/room'} className="hm-act">
              <span className="hm-ico"><Icon name={KIND[a.kind]?.icon || 'leaf'} size={15} /></span>
              <span className="hm-act-t"><b>{a.title}</b><em>{a.text}</em></span>
              <span className="hm-act-m">{ago(a.at, now)}{a.unread > 0 && <span className="badge">{a.unread}</span>}</span>
            </a>
          ))}
        </div>
      ) : <div className="card hm-pad muted">还没有可记录的动态</div>}

      <nav className="hm-entries" aria-label="所有入口">
        {ENTRIES.map(([zh, icon, href]) => <a key={href} href={href} className="card"><Icon name={icon} size={18} stroke={1.3} /><span>{zh}</span></a>)}
        <a href="#/notes?search=1" className="card"><Icon name="search" size={18} stroke={1.3} /><span>搜留言</span></a>
      </nav>

      {naming && <Names names={names} onClose={() => setNaming(false)} onSaved={() => { setNaming(false); onNamesSaved?.(); }} />}
    </main>
  );
}

function Names({ names, onClose, onSaved }) {
  const [him, setHim] = useState(names.him || '');
  const [me, setMe] = useState(names.me === '我' ? '' : names.me || '');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => { setNote(''); }, [him, me]);
  const save = async () => {
    setBusy(true);
    try {
      await api('/api/settings/contact', { method: 'PUT', body: { himName: him.trim(), ...(me.trim() ? { meName: me.trim() } : {}) } });
      onSaved();
    } catch (e) { setNote(e?.message || '没保存上'); }
    setBusy(false);
  };
  return (
    <Sheet open onClose={onClose} label="改昵称" seed={19}>
      <div className="hm-names-sheet">
        <h3>你们的名字</h3>
        <label className="pill"><span>他</span><input value={him} onChange={(e) => setHim(e.target.value)} maxLength={24} placeholder="他的名字" /></label>
        <label className="pill"><span>你</span><input value={me} onChange={(e) => setMe(e.target.value)} maxLength={24} placeholder="你的名字" /></label>
        {note && <p className="hm-empty">{note}</p>}
        <button type="button" className="btn-main" disabled={busy || !him.trim()} onClick={save}>{busy ? '保存中…' : '保存'}</button>
        <p className="hm-empty">头像点首页上的圆圈去换。</p>
      </div>
    </Sheet>
  );
}
