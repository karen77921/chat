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
import Sheet from '../design/Sheet.jsx';
import { api, MOCK, uploadFile } from '../lib/api.js';
import { shrinkImage } from '../lib/image.js';
import { useLoad } from '../lib/useLoad.js';
import { useChat, replyState, hm, dayLabel, nameOf, memberOf } from '../lib/chat.js';
import { useBeauty } from '../theme/theme.js';
import Message from '../components/chat/Message.jsx';
import InputBar from '../components/chat/InputBar.jsx';
import MessageMenu from '../components/chat/MessageMenu.jsx';
import { ledgerFrom } from '../lib/ledger.js';
import { splitByQuery } from '../lib/notes.js';
import '../components/chat/chat.css';
import '../components/chat/ballet.css';
import AuthImg from '../design/AuthImg.jsx';

/** 引用、复制整条时：把气泡分隔记号去掉，按原来的分段接起来 */
const plainText = (t) => String(t || '').split(/\s*⟦气泡⟧\s*/).filter(Boolean).join('\n');

export default function Chat({ query }) {
  const [localBeauty] = useBeauty();
  const chatId = query.id || 'w1';
  const c = useChat(chatId, MOCK ? query.demo : undefined);
  const { data, now } = c;
  const [, setBeauty] = useBeauty();
  useEffect(() => {
    if (data?.beauty && Object.keys(data.beauty).length) setBeauty(data.beauty);
  }, [data?.beauty]);
  const [menu, setMenu] = useState(null); // { m, rect }
  const [ledger, setLedger] = useState(null); // 账本里正在看的那条消息
  const [quote, setQuote] = useState(null);
  const [editing, setEditing] = useState(null); // { id, text, then? }
  const [viewer, setViewer] = useState(null); // { images, i }
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState('');
  const [jump, setJump] = useState(null); // 从搜索结果点进来：要停在哪一条
  const [toast, setToast] = useState('');
  const [chooser, setChooser] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const ok = data && data.available !== false;
  const items = ok ? data.items : [];
  // iOS Safari becomes unstable when hundreds of translucent message trees are
  // mounted at once. Keep all history in memory/search, but only paint the recent
  // conversation during normal chatting.
  const jumpAt = jump ? items.findIndex((m) => m.id === jump) : -1;
  const visibleItems = jumpAt >= 0 && jumpAt < items.length - 180 ? items.slice(Math.max(0, jumpAt - 20)) : items.length > 180 ? items.slice(-180) : items;
  const needle = q.trim().toLowerCase();
  // 搜索：不再把气泡挤在一起，而是列成一条条结果（头像、谁、什么时候、那句话），点一下回到聊天里那个位置
  const results = useMemo(() => (searching && needle
    ? items.filter((m) => m.type === 'text' && m.text?.toLowerCase().includes(needle)).reverse()
    : []), [items, searching, needle]);
  const shown = searching && needle ? [] : visibleItems;
  const queued = items.filter((m) => m.from === 'me' && m.status === 'queued').length;
  const st = ok ? replyState(data.replying, now) : null;
  const lastMine = useMemo(() => [...items].reverse().find((m) => m.from === 'me'), [items]);
  // 快捷回复只挂在最新一条上：他正在回、或者她已经接着说了，就不显示
  const lastItem = items[items.length - 1];
  const options = !st && !searching && lastItem?.from !== 'me' && lastItem?.replyOptions?.length ? lastItem.replyOptions : null;
  const [draft, setDraft] = useState(null);
  const pickOption = (text) => c.send({ type: 'text', text }).then(() => c.reply(), () => flash('没发出去，再点一次'));

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
  useEffect(() => { if (!searching && !jump) { atBottom.current = true; requestAnimationFrame(toBottom); } }, [items.length, searching]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!jump) return undefined;
    const t = setTimeout(() => {
      const el = document.querySelector(`[data-mid="${CSS.escape(String(jump))}"]`);
      if (!el) return;
      atBottom.current = false;
      el.scrollIntoView({ block: 'center' });
      el.classList.add('ch-hit');
      setTimeout(() => el.classList.remove('ch-hit'), 2200);
    }, 120);
    return () => clearTimeout(t);
  }, [jump]);
  const openResult = (m) => { setSearching(false); setQ(''); setJump(m.id); };

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

  const wall = data?.wallpaper === undefined ? localBeauty.wallpaper : data.wallpaper;
  return (
    <main className={`chat ${wall ? 'own-wall' : ''}`}>
      <ChatBackground url={wall} />

      <header className="ch-head">
        <button type="button" className="gbtn" aria-label="返回" onClick={back}><Icon name="back" size={18} stroke={1.5} /></button>
        {searching ? (
          <label className="ch-search glass">
            <Icon name="search" size={16} /><span className="sr">搜聊天</span>
            <input autoFocus type="search" value={q} placeholder="搜聊天记录" onChange={(e) => setQ(e.target.value)} />
            <button type="button" aria-label="退出搜索" onClick={() => { setSearching(false); setQ(''); setJump(null); }}><Icon name="close" size={13} stroke={1.6} /></button>
          </label>
        ) : (
          <>
            <div className="ch-id">
              {group ? (
                <span className="ch-avatar grp">
                  {data.members.slice(0, 2).map((m, k) => <span key={m.id} className={`ga ga${k}`}><Avatar m={m} /></span>)}
                </span>
              ) : (
                <span className="ch-avatar"><Avatar m={him} /></span>
              )}
              <button type="button" className="ch-who" aria-label="聊天设置" onClick={() => setDetailsOpen(true)}>
                <h1 className={group ? 'grp' : 'serif'}>{group ? data.name : him?.name || '\u00a0'}</h1>
                <Icon name="chev" size={12} stroke={1.8} />
              </button>
              <div className={`ch-st ${st ? st.kind : 'idle'}`}>{group ? <>{data.members.map((m) => m.name).join(' · ')} · 你</> : <><i />{status}</>}</div>
            </div>
            <button type="button" className="gbtn" aria-label="搜聊天" onClick={() => setSearching(true)}><Icon name="search" size={18} /></button>
          </>
        )}
      </header>

      <section ref={listRef} className="ch-list" aria-live="polite">
        {!data && <div className="ch-tip">正在翻聊天记录…</div>}
        {data?.available === false && <div className="ch-tip">暂时连不上他那边，过一会儿再来。</div>}
        {!searching && items.length > shown.length && <div className="ch-tip">较早的 {items.length - shown.length} 条已收起，可用右上角搜索查找</div>}
        {searching && needle && <div className="ch-tip">找到 {results.length} 条{results.length ? ' · 点一条回到聊天里' : ''}</div>}
        {searching && needle && (
          <div className="ch-results">
            {results.slice(0, 300).map((m) => {
              const text = String(m.text || '').replace(/\s*⟦气泡⟧\s*/g, ' ');
              const at = text.toLowerCase().indexOf(needle);
              const snip = (at > 30 ? '…' : '') + text.slice(Math.max(0, at - 30), at + needle.length + 60) + (at + needle.length + 60 < text.length ? '…' : '');
              const d = new Date(m.at);
              return (
                <button key={m.id} type="button" className="ch-res glass" onClick={() => openResult(m)}>
                  <span className="ch-res-av"><Avatar m={m.from === 'me' ? data?.me : memberOf(data, m.from) || him} size={36} /></span>
                  <span className="ch-res-b">
                    <span className="ch-res-h"><b>{m.from === 'me' ? (data?.me?.name || '我') : who(m.from)}</b><time>{d.getFullYear() !== new Date(now).getFullYear() ? `${d.getFullYear()}.` : ''}{d.getMonth() + 1}月{d.getDate()}日 {hm(m.at)}</time></span>
                    <span className="ch-res-t">{splitByQuery(snip, q.trim()).map((x, i) => (x.hit ? <mark key={i}>{x.t}</mark> : x.t))}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {shown.map((m, i) => {
          const prev = shown[i - 1];
          const day = !prev || dayLabel(prev.at, now) !== dayLabel(m.at, now) ? dayLabel(m.at, now) : null;
          const next = shown[i + 1];
          const showTime = !next || next.from !== m.from || new Date(next.at) - new Date(m.at) > 300000 || m.status === 'failed';
          let tail = '';
          if (m === lastMine && !searching) tail = m.status === 'queued' ? ' · 他还没开始回' : m.status === 'sending' ? ` · ${m.progress || '发送中…'}` : m.status === 'sent' ? ' · 已读' : '';
          if (m.status === 'failed') tail = ' · 失败';
          return (
            <div key={m.id} data-mid={m.id} className={showTime ? 'cm-last' : undefined}>
              {day && <div className="ch-day"><span className="glass">{day}</span></div>}
              <Message m={m} nameOf={who} q={searching ? q.trim() : ''}
                sender={group && m.from !== 'me' && (prev?.from !== m.from || day) ? { name: who(m.from), color: memberOf(data, m.from)?.color } : null}
                foot={showTime && <div className="cm-time">{hm(m.at)}{tail}</div>}
                onMenu={(mm, rect, part) => setMenu({ m: mm, rect, part })}
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
        {options && (
          <div className="ch-opts" role="group" aria-label="快捷回复">
            {options.map((o) => (
              <div key={o} className="ch-opt glass">
                <button type="button" className="ch-opt-send" onClick={() => pickOption(o)}>{o}</button>
                <button type="button" className="ch-opt-edit" aria-label="先改一改再发" onClick={() => setDraft({ text: o, n: Date.now() })}><Icon name="pen" size={13} stroke={1.5} /></button>
              </div>
            ))}
          </div>
        )}
        {st && !searching && <StatusLine st={st} onPause={c.pause} onRetry={() => c.pause().then(c.reply)} />}
      </section>

      {!searching && (
        <InputBar toName={group ? data?.name : him?.name} nameOf={who} queued={queued} replying={!!st} quote={quote} editing={editing}
          onCancelQuote={() => setQuote(null)} onCancelEdit={() => setEditing(null)} draft={draft}
          onSend={send} onSendImages={(files) => { setQuote(null); c.sendImages(files).catch(() => flash('图没发出去，点那条重发')); }}
          onReply={doReply} onPause={c.pause} onUpload={c.upload} />
      )}

      {menu && (
        <MessageMenu m={menu.m} rect={menu.rect} onClose={() => setMenu(null)}
          onQuote={(m) => setQuote({ ...m, text: menu.part ?? plainText(m.text) })}
          nameOf={who}
          onCopy={(m) => navigator.clipboard?.writeText(menu.part ?? plainText(m.text)).then(() => flash('复制好了'), () => flash('没复制上'))}
          onRegenerate={c.regenerate}
          onEdit={(m) => setEditing({ id: m.id, text: m.text })}
          onDelete={c.remove}
          onReact={c.react}
          onLedger={setLedger} />
      )}
      {ledger && <Ledger m={ledger} onClose={() => setLedger(null)} />}
      {viewer && <ImageViewer {...viewer} onClose={() => setViewer(null)} onGo={(i) => setViewer((v) => ({ ...v, i }))} />}
      {detailsOpen && <ChatDetails chatId={chatId} data={data} upload={c.upload} onClose={() => setDetailsOpen(false)} onUpdated={c.reload} />}
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

function Ledger({ m, onClose }) {
  const groups = ledgerFrom(m.api) || [];
  return (
    <Sheet open onClose={onClose} label="这一轮的账本" seed={57}>
      <div className="kicker" style={{ letterSpacing: '.12em' }}>这一轮的账本</div>
      <div className="ledger">
        {groups.map((g) => (
          <section key={g.title}>
            <h3>{g.title}</h3>
            <dl>{g.rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          </section>
        ))}
      </div>
    </Sheet>
  );
}

const OPTION_MODES = [['off', '关'], ['mixed', '两句话 + 一个动作'], ['lines', '三句话'], ['actions', '三个动作']];

function ChatDetails({ chatId, data, upload, onClose, onUpdated }) {
  const { data: optMode, setData: setOptMode } = useLoad(`/api/chats/${encodeURIComponent(chatId)}/reply-options`);
  const [beauty, setBeauty] = useBeauty();
  const [nickname, setNickname] = useState(data?.members?.[0]?.name || '');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const avatarInput = useRef(null);
  const wallInput = useRef(null);
  const say = (message) => setNotice(message);
  const saveName = async () => {
    const himName = nickname.trim();
    if (!himName) return say('先写一个昵称');
    setBusy(true); setNotice('');
    try { await api('/api/settings/contact', { method: 'PUT', body: { chatName: himName } }); await onUpdated(); say('昵称已保存'); }
    catch (e) { say(e?.message || '昵称保存失败'); }
    finally { setBusy(false); }
  };
  const saveBeauty = async (next) => {
    setBusy(true); setNotice('');
    try {
      const saved = await api('/api/settings/beauty', { method: 'PUT', body: next });
      setBeauty(saved); await onUpdated(); say('外观已保存');
    } catch (e) { say(e?.message || '外观保存失败'); }
    finally { setBusy(false); }
  };
  const changeImage = async (file, kind) => {
    if (!file) return;
    setBusy(true); setNotice('');
    try {
      // 和主页「设置 → 美化」一样：先压小再传，显示进度（以前传的是原图，网慢就一直传不完）
      say(kind === 'avatar' ? '头像上传中…' : '壁纸上传中…');
      const small = await shrinkImage(file);
      const uploaded = MOCK ? await upload(small, kind)
        : await uploadFile(small, { onProgress: (r) => say(`${kind === 'avatar' ? '头像' : '壁纸'}上传 ${Math.round(r * 100)}%`) });
      if (kind === 'avatar') {
        await api('/api/settings/avatar', { method: 'PUT', body: { who: 'him', url: uploaded.url } });
        await onUpdated(); say('头像已保存');
      } else {
        const saved = await api('/api/settings/beauty', { method: 'PUT', body: { ...beauty, wallpaper: uploaded.url } });
        setBeauty(saved); await onUpdated(); say('聊天壁纸已保存');
      }
    } catch (e) { say(`没换成：${e?.message || '上传失败'}`); }
    finally { setBusy(false); }
  };
  return (
    <Sheet open onClose={onClose} label="聊天设置" seed={103}>
      <div className="ch-detail">
        <div className="sec-head"><span className="en">just us</span><h2 className="zh">聊天设置</h2></div>
        <p className="ch-detail-hint">这里改的是你看到的名字和这段聊天的外观，不会改动聊天记录或他的记忆。</p>
        <div className="ch-detail-person">
          <span className="ch-detail-avatar"><Avatar m={data?.members?.[0]} size={52} /></span>
          <button type="button" className="chip" disabled={busy} onClick={() => avatarInput.current?.click()}>更换他的头像</button>
          <input ref={avatarInput} type="file" accept="image/*" hidden onChange={(e) => { changeImage(e.target.files[0], 'avatar'); e.target.value = ''; }} />
        </div>
        <label className="ch-detail-field">聊天框里对他的昵称（只在聊天里显示，别处还是他的名字）
          <input value={nickname} maxLength={24} onChange={(e) => setNickname(e.target.value)} placeholder="给他起个名字" />
        </label>
        <button type="button" className="btn-main ch-detail-save" disabled={busy || !nickname.trim() || nickname.trim() === data?.members?.[0]?.name} onClick={saveName}>保存昵称</button>
        <div className="ch-detail-divider" />
        <div className="ch-detail-label">聊天壁纸</div>
        <div className="ch-detail-actions">
          <button type="button" className="chip" disabled={busy} onClick={() => wallInput.current?.click()}>从相册选择</button>
          {beauty.wallpaper && <button type="button" className="chip" disabled={busy} onClick={() => saveBeauty({ ...beauty, wallpaper: null })}>恢复默认</button>}
          <input ref={wallInput} type="file" accept="image/*" hidden onChange={(e) => { changeImage(e.target.files[0], 'wallpaper'); e.target.value = ''; }} />
        </div>
        {notice && <p className="ch-detail-notice" role="status">{notice}</p>}
        <div className="ch-detail-label">气泡样式</div>
        <div className="ch-detail-actions" role="radiogroup" aria-label="气泡样式">
          {[['glass', '磨砂玻璃'], ['paper', '纸片'], ['cyan', '蓝晒信纸']].map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={beauty.bubble === id} className={`chip ${beauty.bubble === id ? 'on' : ''}`} disabled={busy} onClick={() => saveBeauty({ ...beauty, bubble: id })}>{label}</button>
          ))}
        </div>
        <label className="ch-detail-field">气泡透明度 · {Math.round((beauty.alpha ?? 0.5) * 100)}%
          <input type="range" min="0.2" max="0.95" step="0.05" value={beauty.alpha ?? 0.5} disabled={busy} onChange={(e) => setBeauty({ ...beauty, alpha: Number(e.target.value) })} onPointerUp={() => saveBeauty(beauty)} />
        </label>
        <div className="ch-detail-divider" />
        <div className="ch-detail-label">快捷回复（亲密的时候用）</div>
        <p className="ch-detail-hint">打开后，他每次说完会在下面给你三个可以一点就发的下一步。这些选项只给你看，不会留在聊天记录里，也不会被他再读到。只对这个聊天窗口生效。</p>
        <div className="ch-detail-actions" role="radiogroup" aria-label="快捷回复">
          {OPTION_MODES.map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={(optMode?.mode || 'off') === id} className={`chip ${(optMode?.mode || 'off') === id ? 'on' : ''}`} disabled={busy || !optMode}
              onClick={() => api(`/api/chats/${encodeURIComponent(chatId)}/reply-options`, { method: 'PUT', body: { mode: id } }).then(setOptMode, (e) => say(e?.message || '没保存上'))}>{label}</button>
          ))}
        </div>
        {notice && <p className="ch-detail-notice" role="status">{notice}</p>}
      </div>
    </Sheet>
  );
}

/** 头像：后端给图就用图，没给就画一张小蓝晒；群里的成员用首字 */
export function Avatar({ m, size = 42 }) {
  if (m?.avatar) return <AuthImg src={m.avatar} alt="" width={size} height={size} style={{ objectFit: 'cover', display: 'block' }} />;
  if (m?.color) return <span className="ch-letter serif" style={{ width: size, height: size, background: m.color, fontSize: size * 0.45 }}>{m.name?.[0]}</span>;
  return <Cyanotype w={size} h={size} seed={3} variant="sprig" develop={false} />;
}

/** 状态只是一行小字，跟在最后一条下面 */
function StatusLine({ st, onPause, onRetry }) {
  if (st.kind === 'stuck') {
    return (
      <div className="ch-status">
        <Icon name="alert" size={13} stroke={1.5} />好像卡住了 · {Math.floor(st.quiet / 60000)} 分钟没有动静
        <button type="button" onClick={onRetry}>重试</button><button type="button" onClick={() => window.location.reload()}>刷新页面</button>
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
    <div className={`ch-bg ${url ? 'own' : ''}`} aria-hidden="true">
      {url ? <AuthImg src={url} alt="" /> : (
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
      <div className="ch-viewer-img">{im?.url ? <AuthImg src={im.url} alt="" /> : <Cyanotype w={320} h={240} seed={20 + i} variant="sprig" develop={false} />}</div>
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
