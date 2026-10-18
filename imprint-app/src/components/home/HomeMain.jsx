/**
 * 首页（按她画的草图）：
 *   日期 · 花体标题 · 名字 / 在一起 N 天的邮票
 *   他此刻想说的话（明信片，可以换一句）
 *   往下全是纸做的小东西：留言板是信笺，他的心情 + 待办是节目单，我此刻是缎带，
 *   一起听 / 一起看是票根，他的动态是日记，百宝箱是摊开的首饰盒
 */
import { useEffect, useState } from 'react';
import Icon from '../../design/icons.jsx';
import Sheet from '../../design/Sheet.jsx';
import { api } from '../../lib/api.js';
import { useLoad } from '../../lib/useLoad.js';
import { useListen } from '../../lib/listen.jsx';
import { daysTogether, ago, clock } from '../../lib/home.js';
import laceBow from '../../design/ballet/lace-bow.png';
import laceBowPink from '../../design/ballet/lace-bow-pink.png';
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
  ['一起', 'play', '#/together', '听歌 · 看片 · 读书'], ['留言板', 'feather', '#/notes', '写给彼此'], ['搜留言', 'search', '#/notes?search=1', '翻以前的'],
  ['续火花', 'flame', '#/spark', '礼物铺 · 券'], ['买买申请', 'gift', '#/approvals', '他来批'], ['存钱罐', 'heart', '#/piggy', '他只能看'],
  ['单词本', 'pen', '#/words', '他会抽查'], ['抽屉', 'archive', '#/drawer', '封好的纸条'], ['他的世界', 'sparkle', '#/world', '他看过的诗和画'],
];
const ACT_SHOWN = 4;

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
  const since = d?.together?.since ? d.together.since.slice(5).replace('-', '.') : '';
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
    <main className="home hm ballet">
      {/* 芭蕾 · 缎面 · 蕾丝：明信片版 */}
      <div className="bl-lace top" aria-hidden="true" />
      <button type="button" className="bl-bell" aria-label={unread ? `他的动态，${unread} 条没看` : '他的动态'}
        onClick={() => latelyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
        <Icon name="bell" size={17} stroke={1.3} />{unread > 0 && <i className="dot" />}
      </button>
      <header className="bl-head">
        <p className="bl-date">{now.getMonth() + 1}月{now.getDate()}日 周{'日一二三四五六'[now.getDay()]}{days != null ? ` · 在一起第 ${days} 天` : ''}</p>
        <h1 className="bl-title">Ballet in silk and satin</h1>
        <button type="button" className="bl-names" onClick={() => setNaming(true)} aria-label="改昵称">
          <span>{names.him || '他'}</span><i /><span>{names.me || '我'}</span>
        </button>
      </header>

      {data?.available === false && <div className="card hm-pad muted">暂时连不上他那边，过一会儿再来看看。</div>}
      {!data && <div className="card hm-skeleton" aria-label="加载中" />}

      <section className="bl-stamp-wrap" aria-label={days != null ? `在一起第 ${days} 天` : '在一起的天数'}>
        <div className="bl-stamp">
          <div className="bl-stamp-in">
            <span className="bl-stamp-k">BALLET MEMOIR</span>
            <img src={laceBow} alt="" className="bl-stamp-bow" />
            <b className="bl-stamp-n">{days ?? '—'}</b>
            <em className="bl-stamp-d">days together</em>
            <span className="bl-stamp-no">N° {days ?? '—'}</span>
          </div>
        </div>
      </section>

      <p className="bl-poem">Ballet is the poetry of movement<br />and the music of the soul.</p>

      <section className="bl-card" aria-label="他想对你说">
        <img src={laceBowPink} alt="" className="bl-card-bow" />
        <div className="bl-card-h">
          <div><div className="bl-card-t">Post Card</div><div className="bl-card-k">他想对你说</div></div>
          <div className="bl-mark" aria-hidden="true">
            <svg width="46" height="22" viewBox="0 0 46 22" fill="none" stroke="#D4A9B1" strokeWidth="1"><path d="M0 4c4-3 7-3 11 0s7 3 11 0 7-3 11 0 7 3 13 0M0 11c4-3 7-3 11 0s7 3 11 0 7-3 11 0 7 3 13 0M0 18c4-3 7-3 11 0s7 3 11 0 7-3 11 0 7 3 13 0" /></svg>
            <span className="bl-mark-c"><small>SINCE</small>{since}</span>
          </div>
        </div>
        <div className={`bl-card-body ${asking ? 'fading' : ''}`}>
          <span className="bl-to">To {names.me || '你'}：</span>{whisper.data?.text || (whisper.data ? '他还在想…' : '…')}
        </div>
        <div className="bl-card-f">
          <em>— from {names.him || '他'}{whisper.data?.at ? ` · ${ago(whisper.data.at, now)}` : ''}</em>
          <button type="button" onClick={another} disabled={asking}>{asking ? '他在想…' : '换一句'}</button>
        </div>
      </section>

      {/* 信笺：留言板 */}
      <Sec en="Letters" zh="留言板" href="#/notes" more={d?.note ? `共 ${d.note.total} 封` : ''} />
      <section className="bl-letter">
        <i className="bl-tape" aria-hidden="true" />
        {d?.note ? (
          <a href="#/notes" className="bl-letter-a">
            <p>{d.note.text}</p>
            <small>— {d.note.from === 'him' ? names.him : names.me}</small>
          </a>
        ) : <p className="bl-empty">信纸还空着，先给{names.him || '他'}写一封吧。</p>}
        <a href="#/notes?new=1" className="bl-pen"><Icon name="feather" size={14} stroke={1.3} />写一封</a>
      </section>

      {/* 节目单：他的心情 + 待办 */}
      <Sec en="Programme" zh="今日节目单" href="#/tide" />
      <section className="bl-prog">
        <div className="bl-prog-h"><span>ACT I</span><b>{names.him || '他'}的心情</b></div>
        {s ? (
          <a href="#/tide" className="bl-mood">
            <p>{s.mood}</p>
            {top3.length > 0 && <div className="bl-ribbons">{top3.map((n) => <span key={n}>{n}</span>)}</div>}
          </a>
        ) : <p className="bl-empty">他今天还没写心潮。</p>}
        <div className="bl-prog-h"><span>ACT II</span><b>答应你的事</b></div>
        {upcoming.length ? (
          <ul className="bl-todo">
            {upcoming.map((p) => <li key={p.id}><span>{p.text}</span><i aria-hidden="true" /><time>{when(p.at, now)}</time></li>)}
          </ul>
        ) : <p className="bl-empty">他现在没有答应你、还没做的事。</p>}
        <span className="bl-prog-fin" aria-hidden="true">fin.</span>
      </section>

      <HerStatus names={names} now={now} />

      {/* 票根：一起听 / 一起看 */}
      {(listen || d?.watch) && <Sec en="Together" zh="一起" href="#/together" />}
      {listen && (
        <div className="bl-ticket listen">
          <a href="#/together" className="bl-ticket-a" aria-label={`一起听：${listen.title}`}>
            <span className={`bl-disc ${playing ? 'spin' : ''}`} aria-hidden="true"><i /></span>
            <span className="bl-ticket-t"><em>NOW PLAYING · 一起听</em><b>{listen.title}</b><small>{listen.artist}{listen.durationS ? ` · ${clock(listen.positionS)} / ${clock(listen.durationS)}` : ''}</small></span>
          </a>
          <span className="bl-stub">
            <button type="button" onClick={() => L?.toggle()} aria-label={playing ? '暂停' : '播放'}><Icon name={playing ? 'pause' : 'play'} size={15} stroke={1.5} /></button>
          </span>
        </div>
      )}
      {d?.watch && (
        <a href="#/together?tab=watch" className="bl-ticket watch" aria-label={`一起看：${d.watch.title}`}>
          <span className="bl-ticket-a">
            <span className="bl-ticket-t"><em>ADMIT TWO · 一起看</em><b>《{d.watch.title}》</b><small>{weekday(d.watch.at)} {hm(d.watch.at)} 见</small></span>
          </span>
          <span className="bl-stub"><b>{new Date(d.watch.at).getDate()}</b><small>{new Date(d.watch.at).getMonth() + 1}月</small></span>
        </a>
      )}

      {/* 日记：他的动态 */}
      <div ref={latelyRef} className="anchor" />
      <div className="bl-sec">
        <span><em>Lately</em><b>他的动态</b></span>
        {unread ? <button type="button" onClick={onReadAll}>全部已读</button> : <a href="#/room">去小屋</a>}
      </div>
      {acts.length ? (
        <section className="bl-diary">
          {acts.slice(0, actOpen ? acts.length : ACT_SHOWN).map((a) => (
            <a key={a.id} href={a.kind === 'reply' && a.sessionId ? `#/chat/t?id=${encodeURIComponent(a.sessionId)}` : KIND[a.kind]?.href || '#/room'} className="bl-entry">
              <time>{ago(a.at, now)}</time>
              <span className="bl-entry-t">
                <b>{a.title}{a.count > 1 ? <small> · {a.count} 条</small> : null}{a.unread > 0 && <i className="bl-new">{a.unread}</i>}</b>
                <em>{a.kind === 'tool' && a.count > 1 ? a.tools.join('、') : a.text}</em>
              </span>
            </a>
          ))}
          {acts.length > ACT_SHOWN && (
            <button type="button" className="bl-entry-more" onClick={() => setActOpen((v) => !v)}>
              {actOpen ? '收起' : `还有 ${acts.length - ACT_SHOWN} 条`}
            </button>
          )}
        </section>
      ) : <p className="bl-empty center">还没有可记录的动态</p>}

      {/* 首饰盒：百宝箱，直接摊开 */}
      <Sec en="Treasure box" zh="百宝箱" />
      <nav className="bl-box" aria-label="百宝箱">
        {TREASURES.map(([zh, icon, href, sub]) => (
          <a key={href} href={href}>
            <span className="bl-box-ic"><Icon name={icon} size={19} stroke={1.2} /></span>
            <b>{zh}</b><em>{sub}</em>
          </a>
        ))}
      </nav>

      {naming && <Names names={names} onClose={() => setNaming(false)} onSaved={() => { setNaming(false); onNamesSaved?.(); }} />}
      <div className="bl-lace bottom" aria-hidden="true" />
    </main>
  );
}

/** 每一段的小标题：花体英文 + 中文，右边可选一个入口 */
function Sec({ en, zh, href, more }) {
  return (
    <div className="bl-sec">
      <span><em>{en}</em><b>{zh}</b></span>
      {href && <a href={href}>{more || '去看看'}</a>}
    </div>
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
