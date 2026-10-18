/**
 * 陪读：读书页底下拉出来的小聊天框，跟他聊眼前这一页。
 * 就是正在用的那个聊天窗口（他记得住，聊天页里也看得到），只是这里只显示打开陪读之后的几条。
 * 每次发之前把这一页的字告诉后端（POST /api/books/here），他回的时候知道她在看哪一页。
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { useChat, replyState } from '../../lib/chat.js';
import Message from '../chat/Message.jsx';
import '../chat/chat.css';

function Talk({ chatId, him, page, since }) {
  const chat = useChat(chatId);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const box = useRef(null);
  const items = (chat.data?.items || []).filter((m) => m.type !== 'thinking' && new Date(m.at).getTime() >= since);
  const waiting = replyState(chat.data?.replying, chat.now);
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight, behavior: 'smooth' }); }, [items.length, waiting?.kind]);

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true); setErr('');
    try {
      await api('/api/books/here', { method: 'POST', body: page() }).catch(() => {});
      setText('');
      await chat.send({ type: 'text', text: body });
      await chat.reply();
    } catch (e) { setErr(e?.message || '没发出去'); }
    setBusy(false);
  };

  return (
    <>
      <div className="st-co-list" ref={box}>
        {!items.length && <p className="st-co-hint">读到哪儿想说点什么、有不懂的，就在这里问{him}。他知道你眼前是哪一页。</p>}
        {items.map((m) => <Message key={m.id} m={m} nameOf={(f) => (f === 'me' ? '我' : him)} onOpenImage={(imgs, i) => window.open(imgs[i]?.url, '_blank')} />)}
        {waiting && <div className="st-co-wait">{him}在看这一页<span className="dots"><i /><i /><i /></span></div>}
      </div>
      {err && <div className="st-co-err" role="alert">{err}</div>}
      <form className="st-co-in" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <label className="st-co-field"><span className="sr">和{him}聊这一页</span>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`和${him}聊聊这一页…`} enterKeyHint="send" />
        </label>
        <button type="submit" disabled={!text.trim() || busy}>发送</button>
      </form>
    </>
  );
}

export default function Companion({ him, page, onClose }) {
  const [chatId, setChatId] = useState('');
  const [err, setErr] = useState('');
  const since = useRef(Date.now() - 60000);
  useEffect(() => { api('/api/chats/active').then((d) => setChatId(d.id)).catch((e) => setErr(e?.message || '连不上聊天')); }, []);
  return (
    <section className="st-co" role="dialog" aria-label="陪读" onClick={(e) => e.stopPropagation()}>
      <header className="st-co-h"><span>陪 读</span><button type="button" aria-label="收起陪读" onClick={onClose}>×</button></header>
      {err && <p className="st-co-hint">{err}</p>}
      {!chatId && !err && <p className="st-co-hint">在叫{him}过来…</p>}
      {chatId && <Talk chatId={chatId} him={him} page={page} since={since.current} />}
    </section>
  );
}
