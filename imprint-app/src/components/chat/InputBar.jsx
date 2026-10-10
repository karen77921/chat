/**
 * 底部输入：＋（图片 / 拍照 / 文件 / 表情）· 输入框（按住麦克风说话、表情）· 发送 / 回复 / 暂停。
 * 回车只把消息发出去；攒几条后按「回复」他才开始回。Shift + 回车换行。
 */
import { useEffect, useRef, useState } from 'react';
import Icon from '../../design/icons.jsx';
import { useLoad } from '../../lib/useLoad.js';
import { BUILTIN, Sticker } from './stickers.jsx';

const MAX_IMAGES = 9;

export default function InputBar({ queued, replying, quote, onCancelQuote, editing, onCancelEdit, onSend, onReply, onPause, onUpload, toName, nameOf }) {
  const [text, setText] = useState('');
  const [panel, setPanel] = useState(null); // null | 'plus' | 'sticker'
  const [tab, setTab] = useState('builtin');
  const [busy, setBusy] = useState('');
  const [rec, setRec] = useState(null); // 录音中：{ start }
  const ta = useRef(null);
  const imgIn = useRef(null), camIn = useRef(null), fileIn = useRef(null);
  const recorder = useRef(null);
  const { data: mineStk } = useLoad(panel === 'sticker' ? '/api/stickers' : null);

  useEffect(() => { if (editing) { setText(editing.text || ''); ta.current?.focus(); } }, [editing]);
  useEffect(() => { if (quote) ta.current?.focus(); }, [quote]);
  // 输入框跟着字数长高
  useEffect(() => { const el = ta.current; if (!el) return; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 120)}px`; }, [text]);

  const sendText = () => {
    const t = text.trim();
    if (!t) return;
    onSend({ type: 'text', text: t, ...(quote ? { quote: { id: quote.id, from: quote.from, text: quote.text } } : {}) });
    setText('');
  };
  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); sendText(); }
  };

  const pickImages = async (files) => {
    const list = [...files].slice(0, MAX_IMAGES);
    if (!list.length) return;
    setBusy(`正在传 ${list.length} 张图…`); setPanel(null);
    try {
      const ups = await Promise.all(list.map((f) => onUpload(f, 'image')));
      onSend({ type: 'images', images: ups.map((u) => ({ url: u.url, thumb: u.thumb, w: u.w, h: u.h })) });
    } finally { setBusy(''); }
  };
  const pickFile = async (f) => {
    if (!f) return;
    setBusy('正在传文件…'); setPanel(null);
    try {
      const u = await onUpload(f, 'file');
      onSend({ type: 'file', file: { name: f.name, size: f.size, url: u.url } });
    } finally { setBusy(''); }
  };

  // 按住说话：松开发送，滑出按钮取消
  const startRec = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setBusy('这个浏览器不支持录音'); setTimeout(() => setBusy(''), 1800); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream);
      const chunks = [];
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const secs = (Date.now() - r.startedAt) / 1000;
        if (r.cancelled || secs < 1) return;
        setBusy('正在发语音…');
        try {
          const u = await onUpload(new File(chunks, 'voice.webm', { type: r.mimeType || 'audio/webm' }), 'voice');
          onSend({ type: 'voice', voice: { url: u.url, durationS: Math.round(secs) } });
        } finally { setBusy(''); }
      };
      r.startedAt = Date.now();
      r.start();
      recorder.current = r;
      setRec({ start: r.startedAt });
    } catch { setBusy('没拿到麦克风权限'); setTimeout(() => setBusy(''), 1800); }
  };
  const stopRec = (cancel) => {
    const r = recorder.current;
    if (r && r.state !== 'inactive') { r.cancelled = cancel; r.stop(); }
    recorder.current = null; setRec(null);
  };

  const stickers = tab === 'builtin' ? BUILTIN : tab === 'mine' ? mineStk?.mine || [] : mineStk?.his || [];

  return (
    <div className={`cin ${panel ? 'open' : ''}`}>
      {(quote || editing) && (
        <div className="cin-quote glass">
          <i />
          <span className="cq-who">{editing ? '改这条' : `引用 ${nameOf(quote.from)}`}</span>
          <span className="cq-t">{editing ? editing.text : quote.text || '[图片]'}</span>
          <button type="button" aria-label="取消" onClick={editing ? onCancelEdit : onCancelQuote}><Icon name="close" size={14} stroke={1.5} /></button>
        </div>
      )}
      {busy && <div className="cin-busy">{busy}</div>}
      {rec && <div className="cin-busy rec"><i />正在录音，松开发送，滑走取消</div>}

      <div className="cin-row">
        <button type="button" className="gbtn cin-plus" aria-label="更多" aria-expanded={panel === 'plus'} onClick={() => setPanel((p) => (p === 'plus' ? null : 'plus'))}>
          <Icon name={panel === 'plus' ? 'close' : 'plus'} size={20} stroke={1.4} />
        </button>
        <label className="cin-field glass">
          <span className="sr">写给 {toName}</span>
          <textarea ref={ta} rows={1} value={text} placeholder={`写给 ${toName || ''}…`} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onFocus={() => setPanel(null)} enterKeyHint="send" />
          <button type="button" className="cin-ico" aria-label="按住说话"
            onPointerDown={startRec} onPointerUp={() => stopRec(false)} onPointerLeave={() => rec && stopRec(true)} onContextMenu={(e) => e.preventDefault()}>
            <Icon name="mic" size={19} />
          </button>
          <button type="button" className="cin-ico" aria-label="表情" aria-expanded={panel === 'sticker'} onClick={() => setPanel((p) => (p === 'sticker' ? null : 'sticker'))}><Icon name="smile" size={19} /></button>
        </label>
        {text.trim() ? (
          <button type="button" className="cin-send" aria-label="发送" onClick={editing ? () => { onSend({ type: 'text', text: text.trim() }); setText(''); } : sendText}><Icon name="send" size={19} stroke={1.5} /></button>
        ) : replying ? (
          <button type="button" className="cin-pause glass" onClick={onPause}><Icon name="stop" size={16} />暂停</button>
        ) : (
          <button type="button" className="btn-main cin-reply" disabled={!queued} onClick={onReply}>
            <Icon name="feather" size={17} stroke={1.5} />回复{queued > 0 && <i className="cnt">{queued}</i>}
          </button>
        )}
      </div>

      {panel === 'plus' && (
        <div className="cin-panel">
          <div className="cin-acts">
            <button type="button" onClick={() => imgIn.current.click()}><span className="gbtn"><Icon name="image" size={22} /></span>相册</button>
            <button type="button" onClick={() => camIn.current.click()}><span className="gbtn"><Icon name="camera" size={22} /></span>拍照</button>
            <button type="button" onClick={() => fileIn.current.click()}><span className="gbtn"><Icon name="file" size={22} /></span>文件</button>
            <button type="button" onClick={() => setPanel('sticker')}><span className="gbtn"><Icon name="smile" size={22} /></span>表情</button>
          </div>
          <p className="cin-tip">图片一次最多 {MAX_IMAGES} 张</p>
        </div>
      )}
      {panel === 'sticker' && (
        <div className="cin-panel">
          <div className="cin-tabs" role="tablist">
            {[['builtin', '常用'], ['mine', '我的'], ['his', '他画的']].map(([k, n]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{n}</button>
            ))}
            <a href="#/room?tab=stickers" className="cin-manage">管理</a>
          </div>
          <div className="cin-stk">
            {stickers.map((s) => (
              <button key={s.id} type="button" aria-label={`发表情：${s.name || ''}`} onClick={() => { onSend({ type: 'sticker', sticker: s.url ? { id: s.id, url: s.url } : { id: s.id } }); setPanel(null); }}>
                <Sticker sticker={s} size={54} />
              </button>
            ))}
            {!stickers.length && <p className="cin-tip">{tab === 'mine' ? '还没有自己的表情' : '他还没画'}</p>}
          </div>
        </div>
      )}

      <input ref={imgIn} type="file" accept="image/*" multiple hidden onChange={(e) => { pickImages(e.target.files); e.target.value = ''; }} />
      <input ref={camIn} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { pickImages(e.target.files); e.target.value = ''; }} />
      <input ref={fileIn} type="file" hidden onChange={(e) => { pickFile(e.target.files[0]); e.target.value = ''; }} />
    </div>
  );
}
