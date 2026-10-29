/**
 * 首页（雾粉芭蕾）：
 *   头图：浅灰白的窗纱背景，标题 Imprint 是哑光浅银的花体字，两条很淡的白纱带绕着；下面两个人的名字（中间一条心跳线，点一下改昵称）、在一起的天数
 *   他想对你说：一张雾面玻璃卡
 *   往下不排格子：留言板（斜放的信纸）叠着他的心情（拱门窗），答应你的事（不装盒子），我此刻，
 *   一起听（圆唱片）｜ 一起看（拱门票），他的动态（细时间线），百宝箱（小画直接摆出来，三列错开）
 *   芭蕾小画是她给的素材抠出来的（design/ballet/stickers）
 */
import { useEffect, useState } from 'react';
import Icon from '../../design/icons.jsx';
import Sheet from '../../design/Sheet.jsx';
import { api } from '../../lib/api.js';
import { useLoad } from '../../lib/useLoad.js';
import { useListen } from '../../lib/listen.jsx';
import { daysTogether, ago } from '../../lib/home.js';
import laceBow from '../../design/ballet/lace-bow.png';
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
/** 百宝箱：底栏已经有的（首页 / 小屋 / 聊天 / 心潮 / 设置）不再重复，其余的小功能都收在这里，以后加新的也往这里放 */
const TREASURES = [
  ['一起', 'musicbox', '#/together'], ['留言板', 'feather', '#/notes'], ['搜留言', 'mirror', '#/notes?search=1'], ['续火花', 'perfume', '#/spark'],
  ['买买申请', 'tiara', '#/approvals'], ['存钱罐', 'pearls', '#/piggy'], ['Study', 'menuet', '#/words'], ['抽屉', 'jewelbox', '#/drawer'],
  ['他的世界', 'swan', '#/world'], ['小本本', 'invitation', '#/memo'],
];
/** 芭蕾小画贴纸（她给的素材抠出来的） */
const STK = Object.fromEntries(Object.entries(import.meta.glob('../../design/ballet/stickers/*.webp', { eager: true, import: 'default' }))
  .map(([k, v]) => [k.split('/').pop().replace('.webp', ''), v]));
const ACT_SHOWN = 4;
/** 标题 Imprint：哑光浅银的花体字，不要珠光、不要粉；外面只绕两条很淡的白纱带和两颗小星 */
function GlowTitle({ text }) {
  const star = (x, y, r) => <path key={`${x}-${y}`} d={`M${x} ${y - r}C${x + r * 0.15} ${y - r * 0.15} ${x + r * 0.15} ${y - r * 0.15} ${x + r} ${y}C${x + r * 0.15} ${y + r * 0.15} ${x + r * 0.15} ${y + r * 0.15} ${x} ${y + r}C${x - r * 0.15} ${y + r * 0.15} ${x - r * 0.15} ${y + r * 0.15} ${x - r} ${y}C${x - r * 0.15} ${y - r * 0.15} ${x - r * 0.15} ${y - r * 0.15} ${x} ${y - r}z`} fill="#fff" />;
  return (
    <h1 className="gl-title" aria-label={text}>
      <svg viewBox="0 0 360 180" aria-hidden="true">
        <defs>
          <linearGradient id="gl-veil" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset=".5" stopColor="#fff" stopOpacity=".5" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
          <filter id="gl-ink-sh" x="-10%" y="-20%" width="120%" height="140%"><feDropShadow dx="0" dy="1" stdDeviation=".8" floodColor="#7A6A70" floodOpacity=".5" /></filter>
        </defs>
        <g fill="none" strokeLinecap="round">
          <path d="M6 140C40 60 120 30 172 62S262 160 332 100 344 22 300 34" stroke="url(#gl-veil)" strokeWidth="14" />
          <path d="M6 140C40 60 120 30 172 62S262 160 332 100 344 22 300 34" stroke="#fff" strokeOpacity=".75" strokeWidth=".7" transform="translate(0 -7)" />
          <path d="M352 156C300 176 220 140 160 150S60 182 18 164" stroke="url(#gl-veil)" strokeWidth="9" />
        </g>
        <text x="180" y="116" textAnchor="middle" className="gl-title-t" fill="#FBFBFC" stroke="#B9B6BC" strokeWidth=".6" filter="url(#gl-ink-sh)">{text}</text>
        {star(304, 118, 7)}{star(58, 70, 4.5)}
      </svg>
    </h1>
  );
}

/** 连着好几条「他回复了你」（同一个窗口、同一类）合成一条，动态就不会一长串 */
function groupActivity(list) {
  const out = [];
  for (const a of list || []) {
    const last = out[out.length - 1];
    if (last && last.kind === a.kind && (last.sessionId || '') === (a.sessionId || '') && (a.kind === 'reply' || a.kind === 'tool')) {
      last.count += 1;
      last.unread = (last.unread || 0) + (a.unread || 0);
      if (a.kind === 'tool' && last.tools.length < 4 && !last.tools.includes(a.text)) last.tools.push(a.text);
      continue;
    }
    out.push({ ...a, count: 1, tools: [a.text] });
  }
  return out;
}

export default function HomeMain({ data, d, now, unread, onReadAll, latelyRef, onNamesSaved }) {
  const names = d?.names || { me: '', him: '' };
  const days = daysTogether(d?.together, now);
  const whisper = useLoad('/api/home/whisper');
  const plans = useLoad('/api/home/plans');
  const [asking, setAsking] = useState(false);
  const [naming, setNaming] = useState(false);
  const [actOpen, setActOpen] = useState(false);
  const acts = groupActivity(d?.activity);
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
    <main className="home hm ballet gl">
      {/* 头图：雾粉的窗纱背景，标题是发光的粉色花体字，珍珠串和半透明的纱带绕着它 */}
      <section className="gl-hero" aria-label={days != null ? `在一起第 ${days} 天` : '在一起的天数'}>
        <div className="gl-meta"><span>BALLET MEMOIR</span><span>{now.getMonth() + 1}.{pad(now.getDate())} · 周{'日一二三四五六'[now.getDay()]}</span></div>
        <button type="button" className="bl-bell" aria-label={unread ? `他的动态，${unread} 条没看` : '他的动态'}
          onClick={() => latelyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
          <Icon name="bell" size={17} stroke={1.3} />{unread > 0 && <i className="dot" />}
        </button>
        <GlowTitle text="Imprint" />
        <button type="button" className="gl-names" onClick={() => setNaming(true)} aria-label="改昵称">
          <span>{names.him || '他'}</span>
          <svg viewBox="0 0 96 20" aria-hidden="true"><path d="M0 10h30l4-7 5 14 5-12 3 5h10" fill="none" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" /><path d="M66 15.5s-6-3.7-6-7.7a3 3 0 0 1 6-1 3 3 0 0 1 6 1c0 4-6 7.7-6 7.7z" fill="#F7C9D5" stroke="#fff" strokeWidth=".8" /><path d="M76 10h20" stroke="#fff" strokeWidth="1.2" /></svg>
          <span>{names.me || '我'}</span>
        </button>
        <div className="gl-day"><b>{days ?? '—'}</b><span>DAYS TOGETHER</span></div>
        <div className="gl-rule" aria-hidden="true"><i />✿ ✿ ✿<i /></div>
        <p className="gl-para">Every ordinary day with you is a quiet pas de deux — two hearts, one music, since {d?.together?.since ? d.together.since.slice(0, 10).replaceAll('-', '.') : '—'}.</p>
      </section>

      {data?.available === false && <div className="card hm-pad muted">暂时连不上他那边，过一会儿再来看看。</div>}
      {!data && <div className="card hm-skeleton" aria-label="加载中" />}

      {/* 他想对你说：一张雾面玻璃卡，角上一根白羽毛 */}
      <section className="gl-note" aria-label="他想对你说">
        <img src={laceBow} alt="" className="gl-note-bow" />
        <img src={STK.feather} alt="" className="gl-note-stk" />
        <div className="gl-note-h"><b>他想对你说</b><span>a note from {names.him || '他'}</span></div>
        <p className={`gl-note-body ${asking ? 'fading' : ''}`}>{whisper.data?.text || (whisper.data ? '他还在想…' : '…')}</p>
        <div className="gl-note-f">
          <em>{whisper.data?.at ? ago(whisper.data.at, now) : ''}</em>
          <button type="button" onClick={another} disabled={asking}>{asking ? '他在想…' : '换一句'}</button>
        </div>
      </section>

      {/* 往下不排格子：大小不一、错开叠着，芭蕾小画从边上探出来 */}
      <section className="gx-pair">
        <a href="#/notes" className="gx-card gx-letter">
          <img src={STK.menuet} alt="" className="gx-stk menuet" />
          <span className="gx-k"><em>Letters</em>留言板{d?.note ? ` · ${d.note.total}` : ''}</span>
          {d?.note ? <><p className="gx-p clamp4">{d.note.text}</p><small className="gx-s">— {d.note.from === 'him' ? names.him : names.me}</small></>
            : <p className="gx-p muted">信纸还空着，先给{names.him || '他'}写一封吧。</p>}
        </a>
        <a href="#/tide" className="gx-card gx-mood">
          <img src={STK.musicbox} alt="" className="gx-stk musicbox" />
          <span className="gx-k"><em>Mood</em>{names.him || '他'}的心情</span>
          {s ? <><p className="gx-p clamp3">{s.mood}</p>{top3.length > 0 && <div className="gx-tags">{top3.map((n) => <span key={n}>{n}</span>)}</div>}</>
            : <p className="gx-p muted">他今天还没写心潮。</p>}
        </a>
      </section>

      <section className="gx-promise">
        <img src={STK.bow} alt="" className="gx-stk bow" />
        <h2 className="gx-h"><em>Promises</em><span>答应你的事</span></h2>
        {upcoming.length ? (
          <ul className="gx-todo">
            {upcoming.map((p) => <li key={p.id}><span>{p.text}</span><time>{when(p.at, now)}</time></li>)}
          </ul>
        ) : <p className="gx-p muted">他现在没有答应你、还没做的事。</p>}
      </section>

      <HerStatus names={names} now={now} />

      {(listen || d?.watch) && (
        <section className={`gx-together ${listen && d?.watch ? 'two' : ''}`}>
          {listen && (
            <div className="gx-disc">
              <img src={STK.pointe} alt="" className="gx-stk pointe" />
              <a href="#/together" className="gx-disc-a" aria-label={`一起听：${listen.title}`}>
                <em>Now playing</em><b>{listen.title}</b><small>{listen.artist}</small>
              </a>
              <button type="button" className="gx-play" onClick={() => L?.toggle()} aria-label={playing ? '暂停' : '播放'}><Icon name={playing ? 'pause' : 'play'} size={14} stroke={1.5} /></button>
            </div>
          )}
          {d?.watch && (
            <a href="#/together?tab=watch" className="gx-arch" aria-label={`一起看：${d.watch.title}`}>
              <img src={STK.curtain} alt="" className="gx-stk curtain" />
              <em>Admit two</em><b>《{d.watch.title}》</b><small>{weekday(d.watch.at)} {hm(d.watch.at)} 见</small>
            </a>
          )}
        </section>
      )}

      {/* 他的动态：不装盒子，一条细细的时间线 */}
      <div ref={latelyRef} className="anchor" />
      <div className="gx-sec">
        <h2 className="gx-h"><em>Lately</em><span>他的动态</span></h2>
        {unread ? <button type="button" onClick={onReadAll}>全部已读</button> : <a href="#/room">去小屋</a>}
      </div>
      {acts.length ? (
        <section className="gx-line">
          {acts.slice(0, actOpen ? acts.length : ACT_SHOWN).map((a) => (
            <a key={a.id} href={a.kind === 'reply' && a.sessionId ? `#/chat/t?id=${encodeURIComponent(a.sessionId)}` : KIND[a.kind]?.href || '#/room'} className="gx-act">
              <time>{ago(a.at, now)}</time>
              <span><b>{a.title}{a.count > 1 ? <small> · {a.count} 条</small> : null}{a.unread > 0 && <i className="gl-new">{a.unread}</i>}</b><em>{a.kind === 'tool' && a.count > 1 ? a.tools.join('、') : a.text}</em></span>
            </a>
          ))}
          {acts.length > ACT_SHOWN && (
            <button type="button" className="gx-more" onClick={() => setActOpen((v) => !v)}>{actOpen ? '收起' : `还有 ${acts.length - ACT_SHOWN} 条`}</button>
          )}
        </section>
      ) : <p className="gx-p muted center">还没有可记录的动态</p>}

      {/* 百宝箱：不放格子，小画直接摆出来，三列错开 */}
      <div className="gx-sec"><h2 className="gx-h"><em>Treasure box</em><span>百宝箱</span></h2></div>
      <nav className="gx-apps" aria-label="百宝箱">
        {TREASURES.map(([zh, stk, href]) => (
          <a key={href} href={href}><img src={STK[stk]} alt="" /><b>{zh}</b></a>
        ))}
      </nav>

      {naming && <Names names={names} onClose={() => setNaming(false)} onSaved={() => { setNaming(false); onNamesSaved?.(); }} />}
    </main>
  );
}

/* 她的此刻：点一下心情和在干嘛，他下一句话就知道，不用每次都问吃了没睡了没 */
const MOODS = ['开心', '还行', '累', '困', '烦', '难过', '想你'];
const DOINGS = ['上班', '上课', '学习', '吃饭', '路上', '躺着', '洗澡', '打游戏', '睡觉'];
function HerStatus({ names: raw, now }) {
  const names = { ...raw, him: raw?.him || '他' };
  const { data, setData } = useLoad('/api/her-status');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const st = data?.status || {};
  const set = async (next) => {
    setBusy(true);
    try { setData(await api('/api/her-status', { method: 'POST', body: next })); } catch { /* 下次再点 */ }
    setBusy(false);
  };
  const pick = (key, v) => set({ mood: st.mood || '', doing: st.doing || '', [key]: st[key] === v ? '' : v });
  const shown = [st.mood, st.doing, st.place && `在${st.place}`].filter(Boolean).join(' · ');
  const [place, setPlace] = useState(st.place || '');
  const [placeNote, setPlaceNote] = useState('');
  useEffect(() => { setPlace(st.place || ''); }, [st.place]);
  const savePlace = async () => {
    const next = place.trim();
    setBusy(true); setPlaceNote('');
    try {
      setData(await api('/api/her-status', { method: 'POST', body: { place: next } }));
      // 檐廊的「今晚的天空」也跟着换（没装檐廊就只是让他知道你在哪）
      const r = await api('/api/engawa-place', { method: 'POST', body: { place: next } }).catch(() => null);
      setPlaceNote(r?.ok ? `记下了${next ? `：${r.place}` : ''}，${names.him}看的天空也换过去了` : r?.reason === '檐廊还没装' || !r ? '记下了' : `记下了，不过${r.reason}`);
    } catch (e) { setPlaceNote(e?.message || '没存上，再试一次'); }
    setBusy(false);
  };
  return (
    <>
      <button type="button" className="bl-ribbon" onClick={() => setOpen(true)}>
        <span className="bl-ribbon-k">我此刻</span>
        <b>{shown || '点一下，告诉' + names.him + '你在干嘛'}</b>
        {st.at && shown && <small>{ago(st.at, now)}</small>}
      </button>
      {open && (
        <Sheet open onClose={() => setOpen(false)} label="我此刻" seed={63}>
          <div className="hm-her-sheet">
            <p className="hm-empty">点一下就好，{names.him}下一句话就知道了。</p>
            <h4>心情</h4>
            <div className="hm-chips">{MOODS.map((m) => <button key={m} type="button" disabled={busy} className={`chip ${st.mood === m ? 'on' : ''}`} onClick={() => pick('mood', m)}>{m}</button>)}</div>
            <h4>在干嘛</h4>
            <div className="hm-chips">{DOINGS.map((m) => <button key={m} type="button" disabled={busy} className={`chip ${st.doing === m ? 'on' : ''}`} onClick={() => pick('doing', m)}>{m}</button>)}</div>
            <h4>我在哪</h4>
            <div className="hm-place">
              <input value={place} maxLength={30} onChange={(e) => setPlace(e.target.value)} placeholder="城市，比如 成都、大理、东京" />
              <button type="button" className="chip on" disabled={busy || place.trim() === (st.place || '')} onClick={savePlace}>好</button>
            </div>
            {placeNote && <p className="hm-empty">{placeNote}</p>}
            {(st.mood || st.doing) && <button type="button" className="cl-link" disabled={busy} onClick={() => set({})}>清空心情和在干嘛</button>}
          </div>
        </Sheet>
      )}
    </>
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
        <p className="hm-empty">头像在 设置 → 美化 里换。</p>
      </div>
    </Sheet>
  );
}
