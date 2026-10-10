/**
 * 03a 聊天列表：窗口（和他的每一个对话，各自接到一条「接入」）+ 群聊。底栏「聊天」进来就是这里。
 * 点一行进 #/chat/t?id=对话id。左滑（电脑上右键）：置顶 / 归档 / 删除。右上角「＋」新建窗口或群聊。
 * 网址：#/chat   ?new=1 打开新建   ?archived=1 看归档
 * 数据：GET /api/chats、GET /api/connections、POST /api/chats、PATCH / DELETE /api/chats/{id}（字段见 src/lib/mock.js 和 docs/03a-聊天列表.md）
 */
import { useRef, useState } from 'react';
import Icon from '../design/icons.jsx';
import { Band, Wax } from '../design/paper.jsx';
import Sheet from '../design/Sheet.jsx';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/useLoad.js';
import { replaceQuery } from '../lib/router.js';
import { hm, dayLabel } from '../lib/chat.js';
import { Avatar } from './Chat.jsx';
import '../components/chat/chat.css';
import '../components/chat/chatlist.css';

export default function ChatList({ query }) {
  const { data, reload } = useLoad('/api/chats');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(query.new === '1');
  const [showArchived, setShowArchived] = useState(query.archived === '1');
  const [swiped, setSwiped] = useState(null);
  const now = data?.now ? new Date(data.now) : new Date();
  const ok = data && data.available !== false;

  const match = (c) => !q.trim() || c.name.includes(q.trim()) || c.preview?.includes(q.trim());
  const act = async (c, patch) => {
    setSwiped(null);
    if (patch === 'delete') {
      if (!confirm(`删掉「${c.name}」？聊天记录也会一起删掉。`)) return;
      await api(`/api/chats/${c.id}`, { method: 'DELETE' });
    } else {
      await api(`/api/chats/${c.id}`, { method: 'PATCH', body: patch });
    }
    reload();
  };
  const open = (id) => { location.hash = `#/chat/t?id=${encodeURIComponent(id)}`; };
  const startNew = () => { setCreating(true); replaceQuery({ new: '1' }); };

  const row = (c) => (
    <SwipeRow key={c.id} c={c} open={swiped === c.id} onSwipe={(v) => setSwiped(v ? c.id : null)}
      actions={[
        ['pin', c.pinned ? '取消置顶' : '置顶', () => act(c, { pinned: !c.pinned })],
        ['archive', showArchived ? '放回去' : '归档', () => act(c, { archived: !showArchived })],
        ['trash', '删除', () => act(c, 'delete'), 'danger'],
      ]}>
      <button type="button" className="cl-row card" onClick={() => (swiped === c.id ? setSwiped(null) : open(c.id))}>
        <span className="cl-av">
          {c.kind === 'group' ? (
            <span className="cl-gav">{c.members.slice(0, 2).map((m, k) => <span key={m.id} className={`ga ga${k}`}><Avatar m={m} size={29} /></span>)}</span>
          ) : <Avatar m={c.members?.[0]} size={46} />}
        </span>
        <span className="cl-mid">
          <span className="cl-name"><b>{c.name}</b>{c.kind === 'group' ? <em>{c.members.length + 1} 人</em> : c.connection && <em>{c.connection}</em>}</span>
          <span className="cl-prev">{c.replying ? <span className="cl-rep">回复中 <span className="dots"><i /><i /><i /></span></span> : c.preview}</span>
        </span>
        <span className="cl-side">
          {c.lastAt && <span>{dayLabel(c.lastAt, now) === '今天' ? hm(c.lastAt) : dayLabel(c.lastAt, now)}</span>}
          {c.unread > 0 && <span className="badge">{c.unread}</span>}
        </span>
      </button>
      {c.pinned && <Wax size={34} className="cl-wax" />}
    </SwipeRow>
  );

  return (
    <main className="clist">
      <header className="cl-head">
        <h1><span className="hand">letters</span><span>{showArchived ? '已归档' : '聊天'}</span></h1>
        {showArchived ? (
          <button type="button" className="rbtn" aria-label="返回聊天列表" onClick={() => { setShowArchived(false); replaceQuery({}); }}><Icon name="back" size={18} stroke={1.5} /></button>
        ) : (
          <button type="button" className="rbtn" aria-label="新建窗口或群聊" onClick={startNew}><Icon name="plus" size={18} stroke={1.5} /></button>
        )}
      </header>
      <label className="pill cl-search"><Icon name="search" size={16} /><span className="sr">搜聊天</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜聊天、窗口、群" />
      </label>

      <Band tone="l1" seed={41} className="cl-band">
        {!data && <div className="card cl-empty">正在翻…</div>}
        {data?.available === false && <div className="card cl-empty">暂时连不上，过一会儿再来看看。</div>}
        {ok && showArchived && (
          <>
            {data.archived.filter(match).map(row)}
            {!data.archived.length && <div className="card cl-empty">没有归档的对话</div>}
          </>
        )}
        {ok && !showArchived && (
          <>
            <div className="sec-head"><span className="en" style={{ fontSize: 24 }}>windows</span><h2 className="zh" style={{ margin: 0, fontSize: 14 }}>窗口</h2><span className="go">和他的每一个对话</span></div>
            {data.windows.filter(match).map(row)}
            <button type="button" className="cl-link" onClick={startNew}>
              <Icon name="link" size={18} stroke={1.4} />接入一个新窗口<span>预留 · 填接入地址就能用</span>
            </button>
            <div className="sec-head" style={{ marginTop: 26 }}><span className="en" style={{ fontSize: 24 }}>together</span><h2 className="zh" style={{ margin: 0, fontSize: 14 }}>群聊</h2><span className="go">{data.groups.length} 个</span></div>
            {data.groups.filter(match).map(row)}
            {!data.groups.length && <div className="card cl-empty">还没有群聊</div>}
            {data.archived.length > 0 && (
              <button type="button" className="cl-arch" onClick={() => { setShowArchived(true); replaceQuery({ archived: '1' }); }}><Icon name="archive" size={14} stroke={1.4} />已归档 {data.archived.length} 个 ›</button>
            )}
          </>
        )}
      </Band>

      {creating && <NewChat onClose={() => { setCreating(false); replaceQuery({}); }} onDone={open} />}
    </main>
  );
}

/** 左滑露出操作（电脑上右键也能打开） */
function SwipeRow({ c, open, onSwipe, actions, children }) {
  const start = useRef(null);
  return (
    <div className={`cl-swipe ${open ? 'open' : ''}`}
      onPointerDown={(e) => { start.current = e.clientX; }}
      onPointerUp={(e) => { if (start.current == null) return; const dx = e.clientX - start.current; if (dx < -40) onSwipe(true); if (dx > 40) onSwipe(false); start.current = null; }}
      onContextMenu={(e) => { e.preventDefault(); onSwipe(!open); }}>
      <div className="cl-acts">
        {actions.map(([ic, name, fn, tone]) => <button key={name} type="button" className={tone || ''} tabIndex={open ? 0 : -1} onClick={fn}><Icon name={ic} size={18} stroke={1.4} />{name}</button>)}
      </div>
      <div className="cl-front">{children}</div>
      {!open && <button type="button" className="sr" onClick={() => onSwipe(true)}>{c.name} 的更多操作</button>}
    </div>
  );
}

/** 新建：新窗口（起名字、接到哪个窗口）/ 新群聊（起名字、拉谁进来，他默认在） */
function NewChat({ onClose, onDone }) {
  const { data } = useLoad('/api/connections');
  const [kind, setKind] = useState('window');
  const [name, setName] = useState('');
  const [conn, setConn] = useState('main');
  const [members, setMembers] = useState([]);
  const [busy, setBusy] = useState(false);
  const opts = (data?.items || []).filter((x) => (kind === 'window' ? x.kind === 'window' : x.kind === 'member'));
  const go = async () => {
    setBusy(true);
    try {
      const r = await api('/api/chats', { method: 'POST', body: kind === 'window' ? { kind, name: name.trim(), connection: conn } : { kind, name: name.trim(), members } });
      onDone(r.id);
    } finally { setBusy(false); }
  };
  return (
    <Sheet open onClose={onClose} label="新建" seed={44}>
      <div className="sec-head"><span className="en">new</span><h2 className="zh" style={{ margin: 0 }}>新建</h2><button type="button" className="go" onClick={onClose}>取消</button></div>
      <div className="nc-kind" role="radiogroup" aria-label="新建什么">
        <button type="button" role="radio" aria-checked={kind === 'window'} className={`chip ${kind === 'window' ? 'on' : ''}`} onClick={() => setKind('window')}><Icon name="window" size={16} />新窗口</button>
        <button type="button" role="radio" aria-checked={kind === 'group'} className={`chip ${kind === 'group' ? 'on' : ''}`} onClick={() => setKind('group')}><Icon name="group" size={16} />新群聊</button>
      </div>
      <div className="nc-k">起个名字</div>
      <label className="pill nc-in"><span className="sr">名字</span><input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder={kind === 'window' ? '比如：十月旅行计划' : '比如：周末出游'} /></label>
      <div className="nc-k">{kind === 'window' ? '接到哪个窗口' : '还拉谁进来（他默认在）'}</div>
      <div className="nc-opts">
        {opts.map((x) => {
          const on = kind === 'window' ? conn === x.id : members.includes(x.id);
          return (
            <button key={x.id} type="button" role={kind === 'window' ? 'radio' : 'checkbox'} aria-checked={on} className={`card nc-opt ${on ? 'on' : ''}`}
              onClick={() => (kind === 'window' ? setConn(x.id) : setMembers((ms) => (ms.includes(x.id) ? ms.filter((y) => y !== x.id) : [...ms, x.id])))}>
              <span className={`nc-dot ${kind}`}>{on && <i />}</span>
              <span><b>{x.name}</b><em>{x.provider} · {x.note}</em></span>
            </button>
          );
        })}
        <div className="card nc-opt nc-new"><span className="nc-dot"><Icon name="link" size={12} /></span><span><b>新的接入</b><em>在「设置 · 接入」里填地址（预留）</em></span></div>
      </div>
      <button type="button" className="btn-main nc-go" disabled={busy || !name.trim() || (kind === 'group' && !members.length)} onClick={go}>开始聊</button>
    </Sheet>
  );
}
