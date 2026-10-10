/** 一条留言。三种纸：lined 横线纸 / torn 撕边纸 / cyan 蓝晒卡；pinned = 盖了火漆（置顶） */
import { TornBox, Tape, Wax, PlantSprite } from '../../design/paper.jsx';
import { noteTime, splitByQuery } from '../../lib/notes.js';

function Text({ text, q }) {
  return <p className="nc-text">{splitByQuery(text, q).map((p, i) => (p.hit ? <mark key={i}>{p.t}</mark> : p.t))}</p>;
}

function Sign({ name, time, light }) {
  return (
    <div className={`nc-sign ${light ? 'light' : ''}`}>
      <span className="hand">— {name}</span>
      <span className="nc-time">{time}</span>
    </div>
  );
}

export default function NoteCard({ note, names, now, index = 0, fresh }) {
  const name = note.from === 'him' ? names?.him : names?.me;
  const time = noteTime(note.at, now);
  const anim = fresh ? 'm-settle' : '';
  const label = `${name}留的：${note.text}`;

  if (note.paper === 'cyan') {
    return (
      <article className={`nc nc-cyan ${anim}`} aria-label={label} style={{ rotate: `${index % 2 ? -0.8 : 0.8}deg` }}>
        <TornBox seed={93 + index} shadow="drop2" innerStyle={{ background: 'linear-gradient(135deg, var(--print-a), var(--print-b) 50%, var(--print-c))', padding: '18px 110px 14px 20px', minHeight: 116 }}>
          <PlantSprite w={120} h={116} seed={5 + index} className="nc-plant" />
          <Text text={note.text} />
          <Sign name={name} time={time} light />
        </TornBox>
        {note.pinned && <Wax size={48} className={`nc-wax ${fresh ? 'm-seal' : ''}`} />}
      </article>
    );
  }
  if (note.paper === 'torn') {
    return (
      <article className={`nc nc-torn ${anim}`} aria-label={label} style={{ rotate: `${index % 2 ? 1.2 : -1.4}deg` }}>
        <Tape w={66} h={20} seed={92 + index} style={{ left: '42%', top: -10, rotate: '4deg' }} />
        <TornBox seed={91 + index} innerStyle={{ padding: '18px 18px 12px 20px' }}>
          <Text text={note.text} />
          <Sign name={name} time={time} />
        </TornBox>
        {note.pinned && <Wax size={48} className={`nc-wax ${fresh ? 'm-seal' : ''}`} />}
      </article>
    );
  }
  return (
    <article className={`nc nc-lined sheet ${anim}`} aria-label={label}>
      {note.pinned && <span className="nc-pin">置顶</span>}
      <Text text={note.text} />
      <Sign name={name} time={time} />
      {note.pinned && <Wax size={48} className={`nc-wax ${fresh ? 'm-seal' : ''}`} />}
    </article>
  );
}
