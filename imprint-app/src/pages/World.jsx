/**
 * 他的世界：他在檐廊上看过的东西——诗、画、星空、读到的文章、历史上的今天，按类放好给她看。
 * 他每用一次檐廊，后端就自动收一张（同一样东西只收一张，再看就记次数）；他看完写的看法挂在那张下面。
 * 网址：#/world    数据：GET /api/world?cat=
 */
import { useState } from 'react';
import Icon from '../design/icons.jsx';
import { useLoad } from '../lib/useLoad.js';
import '../components/piggy/piggy.css';
import '../components/world/world.css';

const when = (iso) => (iso ? new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

function Card({ it, him }) {
  const [open, setOpen] = useState(false);
  const [badImg, setBadImg] = useState(false);
  const long = Boolean(it.body) && it.cat !== 'poem';
  return (
    <article className={`card wd-card ${it.cat}`}>
      {it.image && !badImg && <img className="wd-img" src={it.image} alt={it.title} loading="lazy" referrerPolicy="no-referrer" onError={() => setBadImg(true)} />}
      <div className="wd-in">
        {it.cat === 'poem' && <p className="wd-line serif">{it.text}</p>}
        <h3 className="wd-t">{it.link ? <a href={it.link} target="_blank" rel="noreferrer">{it.title}</a> : it.title}</h3>
        {it.sub && <div className="wd-sub">{it.sub}</div>}
        {it.cat !== 'poem' && it.text && <p className="wd-text">{it.text}</p>}
        {it.cat === 'poem' && it.body && (open ? <p className="wd-body serif">{it.body}</p> : <button type="button" className="wd-more" onClick={() => setOpen(true)}>看全诗</button>)}
        {long && (open ? <p className="wd-body">{it.body}</p> : <button type="button" className="wd-more" onClick={() => setOpen(true)}>展开</button>)}
        {!!it.items?.length && (
          <ul className="wd-items">
            {it.items.map((x, i) => (
              <li key={i}>{x.sub && <em>{x.sub}</em>}{x.link ? <a href={x.link} target="_blank" rel="noreferrer">{x.title}</a> : <span>{x.title}</span>}</li>
            ))}
          </ul>
        )}
        {!!it.notes?.length && (
          <div className="wd-notes">
            {it.notes.map((n, i) => (
              <div key={i} className="wd-note"><b>{him}：</b><span>{n.text}</span><em>{when(n.at)}</em></div>
            ))}
          </div>
        )}
        <div className="wd-foot">{him} {when(it.at)} 看的{it.times > 1 ? ` · 看了 ${it.times} 次` : ''}</div>
      </div>
    </article>
  );
}

export default function World() {
  const [cat, setCat] = useState('');
  const { data } = useLoad(`/api/world${cat ? `?cat=${cat}` : ''}`);
  const him = data?.names?.him || '他';
  const total = (data?.cats || []).reduce((n, c) => n + c.count, 0);
  return (
    <main className="pg wd">
      <header className="pg-head">
        <a href="#/" className="rbtn" aria-label="返回"><Icon name="back" size={18} stroke={1.5} /></a>
        <h1><span className="hand">his world</span><span>他的世界</span></h1>
        <p>{him}在檐廊上看过的东西都收在这里：每天的诗、画、天文图和夜空，还有他读到的文章。每张下面是他看完写的话。</p>
      </header>
      <nav className="wd-tabs" aria-label="分类">
        <button type="button" className={!cat ? 'on' : ''} aria-pressed={!cat} onClick={() => setCat('')}>全部{total ? ` ${total}` : ''}</button>
        {(data?.cats || []).map((c) => (
          <button key={c.id} type="button" className={cat === c.id ? 'on' : ''} aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>{c.name}{c.count ? ` ${c.count}` : ''}</button>
        ))}
      </nav>
      {!data && <div className="card pg-pad">正在翻他的世界…</div>}
      {data?.available === false && <div className="card pg-pad">暂时连不上，过一会儿再来。</div>}
      {data && data.available !== false && !data.items?.length && (
        <div className="card pg-pad">{cat ? '这一类他还没看过。' : `${him}还没在檐廊上看过东西。等他去翻一首诗、看一眼今晚的月亮，就会出现在这里。`}</div>
      )}
      <div className="wd-list">{(data?.items || []).map((it) => <Card key={it.id} it={it} him={him} />)}</div>
    </main>
  );
}
