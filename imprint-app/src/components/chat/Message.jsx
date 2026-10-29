/**
 * 一条消息。只有文字类的句子用气泡；图片、表情、命令行、语音各有自己的样子。
 * 长按（电脑上右键）弹出菜单。
 */
import { Fragment, useRef, useState } from 'react';
import Icon from '../../design/icons.jsx';
import { Cyanotype } from '../../design/paper.jsx';
import { Sticker } from './stickers.jsx';
import { fileSize } from '../../lib/chat.js';
import { splitByQuery } from '../../lib/notes.js';
import { stickerToken } from '../../lib/stickerUrls.js';
import AuthImg from '../../design/AuthImg.jsx';
import { useListen } from '../../lib/listen.jsx';
import { api } from '../../lib/api.js';

function useLongPress(onLong) {
  const t = useRef(null);
  const origin = useRef(null);
  const openedAt = useRef(0);
  const clear = () => clearTimeout(t.current);
  const open = (rect, part) => {
    if (Date.now() - openedAt.current < 700) return;
    openedAt.current = Date.now();
    window.getSelection()?.removeAllRanges();
    onLong(rect, part);
  };
  // 一条消息拆成好几个气泡时，记下按的是哪一个：引用、复制就只拿那一句
  const pressed = (e) => {
    const bubble = e.target.closest?.('[data-part]');
    return bubble ? { rect: bubble.getBoundingClientRect(), part: Number(bubble.dataset.part) } : { rect: e.currentTarget.getBoundingClientRect(), part: null };
  };
  const start = (e) => {
    if (e.button > 0) return;
    clear();
    origin.current = { x: e.clientX, y: e.clientY };
    // Capture the element now; React's currentTarget is unavailable once the timer fires.
    const { rect, part } = pressed(e);
    t.current = setTimeout(() => open(rect, part), 480);
  };
  return {
    onPointerDown: start,
    onPointerMove: (e) => { if (origin.current && Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > 12) clear(); },
    onPointerUp: clear, onPointerLeave: clear, onPointerCancel: clear,
    onContextMenu: (e) => { e.preventDefault(); clear(); const { rect, part } = pressed(e); open(rect, part); },
    onSelectStart: (e) => e.preventDefault(),
  };
}

function Marked({ text, q }) {
  return <>{splitByQuery(text, q).map((p, i) => (p.hit ? <mark key={i}>{p.t}</mark> : p.t))}</>;
}

/** 他偶尔会写 **加粗**：画成粗体，不把星号原样露出来 */
function Text({ text, q }) {
  return <>{String(text || '').split(/\*\*([^*\n]+)\*\*/).map((t, i) => (i % 2 ? <b key={i}><Marked text={t} q={q} /></b> : <Marked key={i} text={t} q={q} />))}</>;
}

// 他发的歌卡：[歌：曲目id｜歌名｜歌手]，单独一行；点一下就在一起听里放
const SONG = /\[歌：([^｜\]\n]+)｜([^｜\]\n]*)｜([^\]\n]*)\]/g;
const songsIn = (text) => [...String(text || '').matchAll(SONG)].map((m) => ({ id: m[1].trim(), title: m[2].trim(), artist: m[3].trim() }));
const withoutSongs = (text) => String(text || '').replace(SONG, '').replace(/\[申请草稿：[^\]\n]*\]/g, '').replace(XHS, '').replace(WORD, '').replace(/\n{3,}/g, '\n\n').trim();

// 他弹的单词卡：[单词：词id｜单词｜释义｜备注]。先自己想，翻开看答案，点「记得 / 没记住」直接记进单词本
const WORD = /\[单词：([0-9a-zA-Z]{4,40})｜([^｜\]\n]*)｜([^｜\]\n]*)｜([^\]\n]*)\]/g;
const wordsIn = (text) => [...String(text || '').matchAll(WORD)].map((m) => ({ id: m[1], word: m[2].trim(), meaning: m[3].trim(), note: m[4].trim() }));
function WordCard({ w, mid }) {
  const key = `imprint.wordcard.${mid}.${w.id}`;
  const [state, setState] = useState(() => { try { return localStorage.getItem(key) || ''; } catch { return ''; } });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const answer = async (ok) => {
    setBusy(true); setErr('');
    try {
      await api(`/api/vocab/${w.id}/review`, { method: 'POST', body: { correct: ok } });
      const s = ok ? 'ok' : 'miss';
      setState(s);
      try { localStorage.setItem(key, s); } catch { /* 无痕模式 */ }
    } catch (e) { setErr(e?.message || '没记上，再点一次'); }
    setBusy(false);
  };
  return (
    <div className={`cm-word glass ${state}`}>
      <span className="cm-word-tag">单词卡</span>
      <b className="cm-word-w">{w.word}</b>
      {!state ? <button type="button" className="cm-word-open" onClick={() => setState('open')}>想好了，翻开</button> : (
        <>
          <p className="cm-word-m">{w.meaning || '（还没写释义）'}</p>
          {w.note && <small className="cm-word-n">{w.note}</small>}
          {state === 'open' ? (
            <div className="cm-word-b">
              <button type="button" disabled={busy} onClick={() => answer(true)}>记得</button>
              <button type="button" disabled={busy} className="miss" onClick={() => answer(false)}>没记住</button>
            </div>
          ) : <em className="cm-word-r">{state === 'ok' ? '记得 ✓ 下次复习往后推了' : '进错词本了，过一阵再考你'}</em>}
          {err && <em className="cm-word-r err">{err}</em>}
        </>
      )}
    </div>
  );
}

// 他分享的小红书帖子：[小红书：笔记id｜xsec_token｜标题｜作者｜封面]，点开去小红书看原帖
const XHS = /\[小红书：([0-9a-zA-Z]{8,40})｜([^｜\]\n]*)｜([^｜\]\n]*)｜([^｜\]\n]*)｜([^\]\n]*)\]/g;
const xhsIn = (text) => [...String(text || '').matchAll(XHS)].map((m) => ({ id: m[1], token: m[2].trim(), title: m[3].trim(), author: m[4].trim(), cover: m[5].trim() }));

// 手机上：先用小红书 App 自己的链接直接打开这篇（xhsdiscover://item/…）；没装 App、没跳走，就退到网页版的分享链接。
// 原来的 /explore/ 是电脑网页的地址，在手机上会被带去首页，看不到那一篇
function openXhs(e, x) {
  e.preventDefault(); e.stopPropagation();
  const web = `https://www.xiaohongshu.com/discovery/item/${x.id}${x.token ? `?xsec_token=${encodeURIComponent(x.token)}&xsec_source=app_share` : ''}`;
  const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  if (!mobile) { window.open(web, '_blank', 'noopener'); return; }
  let left = false;
  const away = () => { left = true; };
  document.addEventListener('visibilitychange', away, { once: true });
  window.addEventListener('pagehide', away, { once: true });
  location.href = `xhsdiscover://item/${x.id}`;
  setTimeout(() => {
    document.removeEventListener('visibilitychange', away);
    window.removeEventListener('pagehide', away);
    if (!left && document.visibilityState === 'visible') window.open(web, '_blank', 'noopener');
  }, 1500);
}

function XhsCard({ x }) {
  const [broken, setBroken] = useState(!x.cover);
  const href = `https://www.xiaohongshu.com/discovery/item/${x.id}${x.token ? `?xsec_token=${encodeURIComponent(x.token)}&xsec_source=app_share` : ''}`;
  return (
    <a className="cm-xhs glass" href={href} target="_blank" rel="noreferrer" onClick={(e) => openXhs(e, x)}>
      <span className="cm-xhs-cover">
        {broken ? <span className="cm-xhs-ph" aria-hidden="true">📕</span>
          : <img src={x.cover} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />}
        <i className="cm-xhs-tag">小红书</i>
      </span>
      <b>{x.title}</b>
      <span className="cm-xhs-foot">{x.author && <em>@{x.author}</em>}<span>去看看 ›</span></span>
    </a>
  );
}

function SongCard({ song }) {
  const L = useListen();
  const [state, setState] = useState('');
  const playing = L?.state?.track?.id === song.id && L.state.playing;
  const play = async (e) => {
    e.stopPropagation();
    if (playing) { location.hash = '#/together?tab=listen'; return; }
    setState('…');
    try { await L.queue({ track_id: song.id, at: 'now' }); setState(''); } catch (err) { setState(err?.message || '放不了'); }
  };
  return (
    <button type="button" className="cm-song glass" onClick={play} aria-label={`放 ${song.title}`}>
      <span className="cm-song-i"><Icon name={playing ? 'pause' : 'play'} size={18} stroke={2} /></span>
      <span className="cm-song-t"><span className="cm-song-k">{L?.state?.names?.him || '他'} 点的歌</span><b>{song.title}</b><em>{state || `${song.artist} · ${playing ? '正在放，点开一起听' : '点一下放'}`}</em></span>
    </button>
  );
}

// 他起草的买买申请：[申请草稿：id｜商品｜价格｜店铺]，点开去审批页看、改、交
const DRAFT = /\[申请草稿：([0-9a-f]{8,40})｜([^｜\]\n]*)｜([^｜\]\n]*)｜([^\]\n]*)\]/g;
const draftsIn = (text) => [...String(text || '').matchAll(DRAFT)].map((m) => ({ id: m[1], title: m[2].trim(), price: m[3].trim(), channel: m[4].trim() }));

function DraftCard({ d }) {
  return (
    <a className="cm-draft glass" href={`#/approvals?draft=${d.id}`} onClick={(e) => e.stopPropagation()}>
      <span className="cm-draft-k"><Icon name="gift" size={14} stroke={1.5} />申请购买草稿</span>
      <b>{d.title}</b>
      <span className="cm-draft-m">¥ {d.price}{d.channel ? ` · ${d.channel}` : ''}</span>
      <span className="cm-draft-go">查看并提交</span>
      <em>草稿还没提交，可以改了再决定</em>
    </a>
  );
}

function bubbleParts(text) {
  const parts = String(text || '').split(/\s*⟦气泡⟧\s*/).map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts : [''];
}

function Quote({ quote, nameOf }) {
  return (
    <div className="cm-quote">
      <span className="cm-quote-who">{nameOf(quote.from)}</span>
      <span className="cm-quote-t">{String(quote.text || '').replace(/\s*⟦气泡⟧\s*/g, ' ').trim() || '[图片]'}</span>
    </div>
  );
}

function Images({ images, onOpen }) {
  const n = images.length;
  const cls = n === 1 ? 'one' : n === 2 || n === 4 ? 'two' : 'three';
  return (
    <div className={`cm-imgs glass ${cls}`}>
      {images.slice(0, 9).map((im, i) => (
        <button key={i} type="button" className="cm-img" onClick={() => onOpen(i)} aria-label={`看第 ${i + 1} 张图`}>
          {im.url ? <AuthImg src={im.thumb || im.url} alt="" loading="lazy" /> : <Cyanotype w={n === 1 ? 168 : 120} h={n === 1 ? 120 : 120} seed={20 + i} variant="sprig" develop={false} />}
        </button>
      ))}
    </div>
  );
}

function Voice({ voice, mine }) {
  const [playing, setPlaying] = useState(false);
  const [showText, setShowText] = useState(false);
  const audio = useRef(null);
  const bars = useRef(Array.from({ length: Math.min(18, 6 + Math.round(voice.durationS)) }, (_, i) => 5 + ((i * 37) % 15))).current;
  const toggle = () => {
    const a = audio.current;
    if (!voice.url || !a) { setPlaying((p) => !p); return; }
    if (a.paused) a.play().then(() => setPlaying(true)).catch(() => {}); else { a.pause(); setPlaying(false); }
  };
  return (
    <div className="cm-voice-wrap">
      <div className={`cm-bubble cm-voice ${mine ? 'me' : 'him'}`}>
        <button type="button" className="cm-play" onClick={toggle} aria-label={playing ? '暂停语音' : '播放语音'}>
          <Icon name={playing ? 'pause' : 'play'} size={14} stroke={1.8} />
        </button>
        <span className={`cm-wave ${playing ? 'on' : ''}`} aria-hidden="true">{bars.map((h, i) => <i key={i} style={{ height: h }} />)}</span>
        <span className="serif cm-dur">0:{String(Math.round(voice.durationS)).padStart(2, '0')}</span>
        {voice.url && <audio ref={audio} src={voice.url} preload="none" onEnded={() => setPlaying(false)} />}
      </div>
      {voice.transcript && (
        <button type="button" className="cm-transcript" onClick={() => setShowText((s) => !s)}>
          {showText ? `转文字：${voice.transcript}` : '转文字'}
        </button>
      )}
    </div>
  );
}

function Command({ command }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="cm-term">
      <button type="button" className="cm-term-h" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon name="terminal" size={14} stroke={1.4} /><span>命令行 · {command.title || '跑了一条命令'}</span>
        <Icon name="down" size={14} stroke={1.5} className={open ? 'up' : ''} />
      </button>
      {open && (
        <div className="cm-term-b">
          <div className="cm-cmd">$ {command.cmd}</div>
          <pre>{command.output}</pre>
          <div className="cm-exit">退出码 {command.exitCode ?? 0}{command.ms ? ` · ${(command.ms / 1000).toFixed(1)} 秒` : ''}</div>
        </div>
      )}
    </div>
  );
}

export default function Message({ m, nameOf, sender, q, foot, onMenu, onOpenImage, onRegenerate, onEditFailed, onResend }) {
  const mine = m.from === 'me';
  const [thinkOpen, setThinkOpen] = useState(false);
  const [heartOpen, setHeartOpen] = useState(false);
  const press = useLongPress((rect, part) => {
    const parts = bubbleParts(m.text);
    onMenu?.(m, rect, part != null && parts.length > 1 ? parts[part] : null);
  });

  if (m.type === 'thinking') {
    return (
      <div className="cm-row him">
        <div className="cm-think">
          <button type="button" className="glass cm-think-b" onClick={() => setThinkOpen((o) => !o)} aria-expanded={thinkOpen}>想了一下<Icon name="down" size={14} stroke={1.5} className={thinkOpen ? 'up' : ''} /></button>
          {thinkOpen && <div className="cm-think-t">{m.thinking}</div>}
        </div>
      </div>
    );
  }

  if (m.status === 'failed') {
    return (
      <div className="cm-row him">
        <div className="cm-fail">
          <div className="cm-fail-h"><Icon name="alert" size={15} stroke={1.4} />这一条没写完就断了</div>
          {m.text && <div className="cm-fail-t">{m.text}</div>}
          <div className="cm-fail-a">
            <button type="button" className="mini-btn" onClick={() => onRegenerate(m.id)}><Icon name="redo" size={13} stroke={1.5} />重新生成</button>
            <button type="button" className="mini-btn" onClick={() => onEditFailed(m)}><Icon name="pen" size={13} stroke={1.5} />编辑</button>
          </div>
        </div>
        {foot}
      </div>
    );
  }

  let body;
  switch (m.type) {
    case 'images': body = <Images images={m.images || []} onOpen={(i) => onOpenImage(m.images, i)} />; break;
    case 'sticker': body = <div className="cm-sticker"><Sticker sticker={m.sticker} size={88} /></div>; break;
    case 'voice': body = <Voice voice={m.voice} mine={mine} />; break;
    case 'command': body = <Command command={m.command} />; break;
    case 'file':
      body = (
        <a className="cm-file glass" href={m.file?.url || undefined} target="_blank" rel="noreferrer">
          <span className="cm-file-i"><Icon name="file" size={22} /></span>
          <span className="cm-file-t"><b>{m.file?.name}</b><em>{fileSize(m.file?.size)} · 点开预览</em></span>
        </a>
      );
      break;
    default:
      {
        const parts = bubbleParts(m.text);
      body = (
        <div className="cm-bubble-stack">
          {parts.map((part, index) => (stickerToken(part) && !(index === 0 && m.quote) ? (
            <div key={index} className="cm-sticker"><Sticker sticker={{ id: stickerToken(part) }} size={88} /></div>
          ) : (
            <Fragment key={index}>
              {(withoutSongs(part) || (index === 0 && m.quote) || !(songsIn(part).length || draftsIn(part).length || xhsIn(part).length || wordsIn(part).length)) && (
                <div data-part={index} className={`cm-bubble ${mine ? 'me' : 'him'}`}>
                  {index === 0 && m.quote && <Quote quote={m.quote} nameOf={nameOf} />}
                  <Text text={withoutSongs(part)} q={q} />
                  {index === parts.length - 1 && m.edited && <span className="cm-edited">（改过）</span>}
                </div>
              )}
              {songsIn(part).map((song) => <SongCard key={song.id} song={song} />)}
              {draftsIn(part).map((d) => <DraftCard key={d.id} d={d} />)}
              {xhsIn(part).map((x) => <XhsCard key={x.id} x={x} />)}
              {wordsIn(part).map((w) => <WordCard key={w.id} w={w} mid={m.id} />)}
            </Fragment>
          )))}
        </div>
      );
      }
  }

  return (
    <div className={`cm-row ${mine ? 'me' : 'him'} ${sender ? 'grp' : ''} ${m.fresh ? 'm-settle' : ''}`}>
      {sender && <div className="cm-sender"><i style={{ background: sender.color || 'var(--print-c)' }}>{sender.name?.[0]}</i>{sender.name}</div>}
      {!mine && m.selfState && (
        <div className="cm-heart">
          <button type="button" className="glass cm-heart-b" onClick={() => setHeartOpen((o) => !o)} aria-expanded={heartOpen}>
            <span aria-hidden="true">♡</span>心里话<Icon name="down" size={14} stroke={1.5} className={heartOpen ? 'up' : ''} />
          </button>
          {heartOpen && <div className="glass cm-heart-t"><Text text={m.selfState} q={q} /></div>}
        </div>
      )}
      {m.thinking && (
        <div className="cm-think">
          <button type="button" className="glass cm-think-b" onClick={() => setThinkOpen((o) => !o)} aria-expanded={thinkOpen}>想了一下<Icon name="down" size={14} stroke={1.5} className={thinkOpen ? 'up' : ''} /></button>
          {thinkOpen && <div className="cm-think-t">{m.thinking}</div>}
        </div>
      )}
      <div className="cm-press" {...press}>
        {body}
        {m.reaction && <span className="cm-react"><Sticker sticker={{ id: m.reaction }} size={26} /></span>}
      </div>
      {m.status === 'unsent' && <button type="button" className="cm-unsent" onClick={() => onResend(m)}><Icon name="alert" size={13} stroke={1.5} />没发出去，点一下重发{m.error ? `（${m.error}）` : ''}</button>}
      {foot}
    </div>
  );
}
