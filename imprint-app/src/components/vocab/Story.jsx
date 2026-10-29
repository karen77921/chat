/**
 * 背完单词读一篇：他用刚背过的词写一篇短文（雅思阅读风 / 我们俩的小故事），
 * 生词在文中高亮，点一下看意思；后面三道选择题，最后可以看中文翻译。
 * 数据：POST /api/vocab/story（{ ids, style }，慢的话后台写、前端等）、GET /api/vocab/stories、GET/DELETE /api/vocab/story/:id
 */
import { useEffect, useState } from 'react';
import Icon from '../../design/icons.jsx';
import { api } from '../../lib/api.js';

export const STYLES = [['ielts', '雅思阅读风'], ['us', '我们俩的小故事']];

/** 生成：选风格 → 他在写 → 写好了直接打开 */
export function StoryMaker({ ids, count, onOpen, compact = false }) {
  const [style, setStyle] = useState('ielts');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api('/api/vocab/story', { method: 'POST', body: { ids: ids || [], style } });
      onOpen(r.item);
    } catch (e) { setErr(e?.message || '没写出来，再点一次'); }
    setBusy(false);
  };
  return (
    <div className={`vs-maker ${compact ? 'compact' : ''}`}>
      <div className="vs-styles">{STYLES.map(([k, n]) => <button key={k} type="button" className={style === k ? 'on' : ''} onClick={() => setStyle(k)}>{n}</button>)}</div>
      <button type="button" className="vb-btn ok wide" disabled={busy} onClick={go}>
        {busy ? '他在写，大概半分钟…' : ids ? `用这 ${count} 个词读一篇` : '用今天背过的词读一篇'}
      </button>
      {err && <p className="vs-err">{err}</p>}
    </div>
  );
}

const stem = (w) => w.toLowerCase().replace(/[^a-z'-]/g, '');
function findWord(words, raw) {
  const s = stem(raw);
  return words.find((w) => stem(w.word) === s) || words.find((w) => s.startsWith(stem(w.word).slice(0, Math.max(4, stem(w.word).length - 2))));
}

export function StoryReader({ id, story: initial, onClose, onDeleted }) {
  const [story, setStory] = useState(initial || null);
  const [tip, setTip] = useState(null); // { word, meaning }
  const [picked, setPicked] = useState({});
  const [zh, setZh] = useState(false);
  const [sure, setSure] = useState(false);
  useEffect(() => { if (!initial && id) api(`/api/vocab/story/${id}`).then((r) => setStory(r.item)).catch(() => setStory({ error: true })); }, [id, initial]);
  const words = story?.words || [];
  const paras = String(story?.text || '').split(/\n{2,}|\n/).filter((p) => p.trim());
  const remove = () => (sure ? api(`/api/vocab/story/${story.id}`, { method: 'DELETE' }).then(() => onDeleted?.()) : setSure(true));
  return (
    <div className="vs-layer" role="dialog" aria-modal="true" aria-label="短文">
      <div className="vs-page" onClick={() => setTip(null)}>
        <header className="vs-head">
          <button type="button" className="vb-back" aria-label="关上" onClick={onClose}><Icon name="back" size={18} stroke={1.6} /></button>
          <span>{story?.style === 'us' ? 'A LITTLE STORY' : 'READING'} · {story?.day || ''}</span>
        </header>
        {!story && <p className="vs-quiet">翻开中…</p>}
        {story?.error && <p className="vs-quiet">这篇找不到了。</p>}
        {story && !story.error && (
          <>
            <h1 className="vs-title">{story.title}</h1>
            {story.title_cn && <p className="vs-title-cn">{story.title_cn}</p>}
            <div className="vs-words">{words.map((w) => <span key={w.id}>{w.word}</span>)}</div>
            <article className="vs-text">
              {paras.map((p, i) => (
                <p key={i}>{p.split(/\*\*([^*]+)\*\*/).map((part, j) => {
                  if (j % 2 === 0) return part;
                  const w = findWord(words, part);
                  return (
                    <button key={j} type="button" className="vs-w" onClick={(e) => { e.stopPropagation(); setTip({ word: part, meaning: w?.meaning || '（单词本里没写释义）' }); }}>{part}</button>
                  );
                })}</p>
              ))}
            </article>

            {story.questions?.length > 0 && (
              <section className="vs-qs">
                <h2>读完考考你</h2>
                {story.questions.map((q, i) => {
                  const mine = picked[i];
                  const letter = (o) => (o.match(/^\s*([A-D])/) || [])[1] || '';
                  return (
                    <div key={i} className="vs-q">
                      <p><b>{i + 1}.</b> {q.q}</p>
                      {q.options.map((o) => {
                        const L = letter(o);
                        const cls = mine ? (L === q.answer ? 'right' : L === mine ? 'wrong' : '') : '';
                        return <button key={o} type="button" className={`vs-opt ${cls}`} disabled={!!mine} onClick={() => setPicked((m) => ({ ...m, [i]: L }))}>{o}</button>;
                      })}
                      {mine && <small className="vs-why">{mine === q.answer ? '对了！' : `答案是 ${q.answer}。`}{q.why}</small>}
                    </div>
                  );
                })}
              </section>
            )}

            {story.translation && (
              <section className="vs-zh">
                <button type="button" className="vs-zh-b" onClick={() => setZh((v) => !v)}>{zh ? '收起中文' : '看中文翻译'}</button>
                {zh && story.translation.split(/\n+/).map((p, i) => <p key={i}>{p}</p>)}
              </section>
            )}
            <button type="button" className="vs-del" onClick={remove}>{sure ? '再点一次，删掉这篇' : '删掉这篇'}</button>
          </>
        )}
      </div>
      {tip && (
        <div className="vs-tip" onClick={() => setTip(null)}>
          <b>{tip.word}</b><span>{tip.meaning}</span>
        </div>
      )}
    </div>
  );
}

/** 读过的短文列表 */
export function StoryShelf({ onOpen }) {
  const [list, setList] = useState(null);
  useEffect(() => { api('/api/vocab/stories').then((r) => setList(r.items || [])).catch(() => setList([])); }, []);
  if (!list?.length) return null;
  return (
    <div className="vs-shelf">
      {list.slice(0, 12).map((s) => (
        <button key={s.id} type="button" className="vs-card" onClick={() => onOpen(s.id)}>
          <b>{s.title}</b>
          <small>{s.day} · {(s.words || []).length} 个词{s.style === 'us' ? ' · 小故事' : ''}</small>
        </button>
      ))}
    </div>
  );
}
