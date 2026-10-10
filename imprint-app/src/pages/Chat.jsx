/**
 * 03 聊天。不显示底栏。磨砂玻璃气泡，背景是一张虚化的蓝晒图（设置 · 美化里可换）。
 * 消息：文字、多张图片、语音条、文件、表情、命令行、引用、「想了一下」。
 * 回车只发出去，按「回复」他才开始回；回的时候可以暂停；状态用一行小字：回复中 / 仍在等待 / 卡住了。
 * 网址：#/chat/t?id=对话id（窗口或群聊）   ?demo=waiting|stuck|failed 只在假数据下用来看各种状态
 * 群聊：消息上面写是谁说的；按「回复」时选谁来回。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../design/icons.jsx';
import { Cyanotype } from '../design/paper.jsx';
import { MOCK } from '../lib/api.js';
import { useChat, replyState, hm, dayLabel, nameOf, memberOf } from '../lib/chat.js';
import Message from '../components/chat/Message.jsx';
import InputBar from '../components/chat/InputBar.jsx';
import MessageMenu from '../components/chat/MessageMenu.jsx';
import '../components/chat/chat.css';

export default function Chat({ query }) {
  const chatId = query.id || 'w1';
  const c = useChat(chatId, MOCK ? query.demo : undefined);
  const { data, now } = c;
  const [menu, setMenu] = useState(null); // { m, rect }
  const [quote, setQuote] = useState(null);
  const [editing, setEditing] = useState(null); // { id, text, then? }
  const [viewer, setViewer] = useState(null); // { images, i }
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState('');
  const [toast, setToast] = useState('');
  const [chooser, setChooser] = useState(false);

  const ok = data && data.available !== false;
  const items = ok ? data.items : [];
  const shown = searching && q.trim() ? items.filter((m) => m.type === 'text' && m.text?.toLowerCase().includes(q.trim().toLowerCase())) : items;
  const queued = items.filter((m) => m.from === 'me' && m.status === 'queued').length;
  const st = ok ? replyState(data.replying, now) : null;
  const lastMine = useMemo(() => [...items].reverse().find((m) => m.from === 'me'), [items]);

  // 新消息进来滚到底
  // 停在最底下时，新消息、状态、字体晚加载导致内容变高，都自动贴底；往上翻看历史时不打扰
  const atBottom = useRef(true);
  const listRef = useRef(null);
  const toBottom = () => window.scrollTo(0, document.documentElement.scrollHeight);
  useEffect(() => {
    const onScroll = () => { atBottom.current = document.documentElement.scrollHeight - (window.scrollY + window.innerHeight) < 80; };
    addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(() => { if (atBottom.current) toBottom(); });
    if (listRef.current) ro.observe(listRef.current);
    return () => { removeEventListener('scroll', onScroll); ro.disconnect(); };
  }, []);
  useEffect(() => { if (!searching) { atBottom.current = true; requestAnimationFrame(toBottom); } }, [items.length, searching]);

  const flash = (t) => { setToast(t); setTimeout(() => setToast(''), 1600); };
  const send = (body) => {
    if (editing) {
      const { id, then } = editing;
      setEditing(null);
      return c.edit(id, body.text).then(() => then && c.regenerate(then));
    }
    setQuote(null);
    return c.send(body).catch(() => flash('没发出去，点一下那条重发'));
  };
  const back = () => { location.hash = '#/chat'; };
  const group = data?.kind === 'group';
  const who = (from) => nameOf(data, from);
  const him = data?.members?.[0];
  const doReply = () => (group ? setChooser(true) : c.reply());
  const status = st?.kind === 'stuck' ? '好像卡住了' : st?.kind === 'waiting' ? '仍在等待…' : st ? '回复中…' : data?.presence?.online === false ? '不在线' : '在线';

  return (
    <main className="chat">
      <ChatBackground url={data?.wallpaper} />

      <header className="ch-head">
        <button type="button" className="gbtn" aria-label="返回" onClick={back}><Icon name="back" size={18} stroke={1.5} /></button>
        {searching ? (
          <label className="ch-search glass">
            <Icon name="search" size={16} /><span className="sr">搜聊天</span>
            <input autoFocus type="search" value={q} placeholder="搜聊天记录" onChange={(e) => setQ(e.target.value)} />
            <button type="button" aria-label="退出搜索" onClick={() => { setSearching(false); setQ(''); }}><Icon name="close" size={13} stroke={1.6} /></button>
          </label>
        ) : (
          <>
            {group ? (
              <span className="ch-avatar grp">
                {data.members.slice(0, 2).map((m, k) => <span key={m.id} className={`ga ga${k}`}><Avatar m={m} /></span>)}
              </span>
            ) : (
              <span className="ch-avatar"><Avatar m={him} /></span>
            )}
            <div className="ch-who">
              <h1 className={group ? 'grp' : 'serif'}>{group ? data.name : him?.name || '\u00a0'}</h1>
              <div className={`ch-st ${st ? st.kind : 'idle'}`}>{group ? <>{data.members.map((m) => m.name).join(' · ')} · 你</> : <><i />{status}</>}</div>
            </div>
            <button type="button" className="gbtn" aria-label="搜聊天" onClick={() => setSearching(true)}><Icon name="search" size={18} /></button>
            <a className="gbtn" aria-label="美化聊天" href="#/settings?tab=beauty"><Icon name="more" size={18} /></a>
          </>
        )}
      </header>

      <section ref={listRef} className="ch-list" aria-live="polite">
        {!data && <div className="ch-tip">正在翻聊天记录…</div>}
        {data?.available === false && <div className="ch-tip">暂时连不上他那边，过一会儿再来。</div>}
        {searching && q.trim() && <div className="ch-tip">找到 {shown.length} 条</div>}
        {shown.map((m, i) => {
          const prev = shown[i - 1];
          const day = !prev || dayLabel(prev.at, now) !== dayLabel(m.at, now) ? dayLabel(m.at, now) : null;
          const next = shown[i + 1];
          const showTime = !next || next.from !== m.from || new Date(next.at) - new Date(m.at) > 300000 || m.status === 'failed';
          let tail = '';
          if (m === lastMine && !searching) tail = m.status === 'queued' ? ' · 他还没开始回' : m.status === 'sending' ? ' · 发送中…' : m.status === 'sent' ? ' · 已读' : '';
          if (m.status === 'failed') tail = ' · 失败';
          return (
            <div key={m.id}>
              {day && <div className="ch-day"><span className="glass">{day}</span></div>}
              <Message m={m} nameOf={who} q={searching ? q.trim() : ''}
                sender={group && m.from !== 'me' && (prev?.from !== m.from || day) ? { name: who(m.from), color: memberOf(data, m.from)?.color } : null}
                foot={showTime && <div className="cm-time">{hm(m.at)}{tail}</div>}
                onMenu={(mm, rect) => setMenu({ m: mm, rect })}
                onOpenImage={(images, idx) => setViewer({ images, i: idx })}
                onRegenerate={c.regenerate}
                onResend={c.resend}
                onEditFailed={(f) => {
                  const mine = [...items].reverse().find((x) => x.from === 'me' && x.type === 'text');
                  if (mine) setEditing({ id: mine.id, text: mine.text, then: f.id }); else c.regenerate(f.id);
                }} />
            </div>
          );
        })}
        {st && !searching && <StatusLine st={st} onPause={c.pause} onRetry={() => c.pause().then(c.reply)} />}
      </section>

      {!searching && (
        <InputBar toName={group ? data?.name : him?.name} nameOf={who} queued={queued} replying={!!st} quote={quote} editing={editing}
          onCancelQuote={() => setQuote(null)} onCancelEdit={() => setEditing(null)}
          onSend={send} onReply={doReply} onPause={c.pause} onUpload={c.upload} />
      )}

      {menu && (
        <MessageMenu m={menu.m} rect={menu.rect} onClose={() => setMenu(null)}
          onQuote={(m) => setQuote(m)}
          nameOf={who}
          onCopy={(m) => navigator.clipboard?.writeText(m.text).then(() => flash('复制好了'), () => flash('没复制上'))}
          onRegenerate={c.regenerate}
          onEdit={(m) => setEditing({ id: m.id, text: m.text })}
          onDelete={c.remove}
          onReact={c.react} />
      )}
      {viewer && <ImageViewer {...viewer} onClose={() => setViewer(null)} onGo={(i) => setViewer((v) => ({ ...v, i }))} />}
      {toast && <div className="ch-toast glass" role="status">{toast}</div>}
      {chooser && group && (
        <div className="ch-choose-layer">
          <button type="button" className="cmenu-mask" aria-label="关闭" onClick={() => setChooser(false)} />
          <div className="ch-choose glass" role="dialog" aria-label="让谁来回">
            <div className="kicker" style={{ letterSpacing: '.12em' }}>让谁来回？</div>
            <div className="ch-choose-r">
              <button type="button" className="chip on" onClick={() => { setChooser(false); c.reply(); }}>大家</button>
              {data.members.map((m) => (
                <button key={m.id} type="button" className="chip" onClick={() => { setChooser(false); c.reply(m.id); }}><span className="ch-mini"><Avatar m={m} size={22} /></span>只要 {m.name}</button>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/** 头像：后端给图就用图，没给就画一张小蓝晒；群里的成员用首字 */
export function Avatar({ m, size = 42 }) {
  if (m?.avatar) return <img src={m.avatar} alt="" width={size} height={size} style={{ objectFit: 'cover', display: 'block' }} />;
  if (m?.color) return <span className="ch-letter serif" style={{ width: size, height: size, background: m.color, fontSize: size * 0.45 }}>{m.name?.[0]}</span>;
  return <Cyanotype w={size} h={size} seed={3} variant="sprig" develop={false} />;
}

/** 状态只是一行小字，跟在最后一条下面 */
function StatusLine({ st, onPause, onRetry }) {
  if (st.kind === 'stuck') {
    return (
      <div className="ch-status">
        <Icon name="alert" size={13} stroke={1.5} />好像卡住了 · {Math.floor(st.quiet / 60000)} 分钟没有动静
        <button type="button" onClick={onRetry}>重试</button><button type="button" onClick={() => {}}>再等等</button>
      </div>
    );
  }
  return (
    <div className="ch-status">
      <span className={`dots ${st.kind === 'waiting' ? 'slow' : ''}`} aria-hidden="true"><i /><i /><i /></span>
      {st.kind === 'waiting' ? `仍在等待 · 已经 ${Math.round(st.since / 1000)} 秒` : '回复中'}
      {st.kind === 'waiting' && <button type="button" onClick={onPause}>暂停</button>}
    </div>
  );
}

function ChatBackground({ url }) {
  return (
    <div className="ch-bg" aria-hidden="true">
      {url ? <img src={url} alt="" /> : (
        <div className="ch-bg-art">
          <Cyanotype w={430} h={932} seed={7} develop={false} />
        </div>
      )}
      <i className="ch-veil" />
    </div>
  );
}

function ImageViewer({ images, i, onClose, onGo }) {
  const im = images[i];
  return (
    <div className="ch-viewer" role="dialog" aria-label="看图">
      <button type="button" className="ch-viewer-mask" aria-label="关闭" onClick={onClose} />
      <div className="ch-viewer-img">{im?.url ? <img src={im.url} alt="" /> : <Cyanotype w={320} h={240} seed={20 + i} variant="sprig" develop={false} />}</div>
      {images.length > 1 && (
        <div className="ch-viewer-nav">
          <button type="button" className="gbtn" aria-label="上一张" disabled={i === 0} onClick={() => onGo(i - 1)}><Icon name="back" size={18} stroke={1.5} /></button>
          <span className="serif">{i + 1} / {images.length}</span>
          <button type="button" className="gbtn" aria-label="下一张" disabled={i === images.length - 1} onClick={() => onGo(i + 1)} style={{ transform: 'scaleX(-1)' }}><Icon name="back" size={18} stroke={1.5} /></button>
        </div>
      )}
      <button type="button" className="gbtn ch-viewer-x" aria-label="关闭" onClick={onClose}><Icon name="close" size={16} stroke={1.5} /></button>
    </div>
  );
}
