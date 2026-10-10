/**
 * 一条消息。只有文字类的句子用气泡；图片、表情、命令行、语音各有自己的样子。
 * 长按（电脑上右键）弹出菜单。
 */
import { useRef, useState } from 'react';
import Icon from '../../design/icons.jsx';
import { Cyanotype } from '../../design/paper.jsx';
import { Sticker } from './stickers.jsx';
import { fileSize } from '../../lib/chat.js';
import { splitByQuery } from '../../lib/notes.js';

function useLongPress(onLong) {
  const t = useRef(null);
  const origin = useRef(null);
  const openedAt = useRef(0);
  const clear = () => clearTimeout(t.current);
  const open = (rect) => {
    if (Date.now() - openedAt.current < 700) return;
    openedAt.current = Date.now();
    window.getSelection()?.removeAllRanges();
    onLong(rect);
  };
  const start = (e) => {
    if (e.button > 0) return;
    clear();
    origin.current = { x: e.clientX, y: e.clientY };
    // Capture the element now; React's currentTarget is unavailable once the timer fires.
    const rect = e.currentTarget.getBoundingClientRect();
    t.current = setTimeout(() => open(rect), 480);
  };
  return {
    onPointerDown: start,
    onPointerMove: (e) => { if (origin.current && Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > 12) clear(); },
    onPointerUp: clear, onPointerLeave: clear, onPointerCancel: clear,
    onContextMenu: (e) => { e.preventDefault(); clear(); open(e.currentTarget.getBoundingClientRect()); },
    onSelectStart: (e) => e.preventDefault(),
  };
}

function Text({ text, q }) {
  return <>{splitByQuery(text || '', q).map((p, i) => (p.hit ? <mark key={i}>{p.t}</mark> : p.t))}</>;
}

function bubbleParts(text) {
  const parts = String(text || '').split(/\s*⟦气泡⟧\s*/).map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts : [''];
}

function Quote({ quote, nameOf }) {
  return (
    <div className="cm-quote">
      <span className="cm-quote-who">{nameOf(quote.from)}</span>
      <span className="cm-quote-t">{quote.text || '[图片]'}</span>
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
          {im.url ? <img src={im.thumb || im.url} alt="" loading="lazy" /> : <Cyanotype w={n === 1 ? 168 : 120} h={n === 1 ? 120 : 120} seed={20 + i} variant="sprig" develop={false} />}
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
  const press = useLongPress((rect) => onMenu?.(m, rect));

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
          {parts.map((part, index) => (
            <div key={index} className={`cm-bubble ${mine ? 'me' : 'him'}`}>
              {index === 0 && m.quote && <Quote quote={m.quote} nameOf={nameOf} />}
              <Text text={part} q={q} />
              {index === parts.length - 1 && m.edited && <span className="cm-edited">（改过）</span>}
            </div>
          ))}
        </div>
      );
      }
  }

  return (
    <div className={`cm-row ${mine ? 'me' : 'him'} ${sender ? 'grp' : ''} ${m.fresh ? 'm-settle' : ''}`}>
      {sender && <div className="cm-sender"><i style={{ background: sender.color || 'var(--print-c)' }}>{sender.name?.[0]}</i>{sender.name}</div>}
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
      {m.status === 'unsent' && <button type="button" className="cm-unsent" onClick={() => onResend(m)}><Icon name="alert" size={13} stroke={1.5} />没发出去，点一下重发</button>}
      {foot}
    </div>
  );
}
