/**
 * 01 首页：撕纸长卷。从上到下纸带越来越深（层一 → 层四），核心模块都能直接点进去。
 * 数据：GET /api/home（字段见 src/lib/mock.js 和 docs/01-首页.md）
 */
import { useRef } from 'react';
import { useLoad } from '../lib/useLoad.js';
import { useReveal } from '../lib/useReveal.js';
import { api } from '../lib/api.js';
import { nowOf } from '../lib/home.js';
import { Band } from '../design/paper.jsx';
import Hero, { BrandMark } from '../components/home/Hero.jsx';
import { SecHead, Weather, HisNow, TodayNote, Together, Lately, Contents } from '../components/home/Sections.jsx';
import '../components/home/home.css';

function Reveal({ children }) {
  const ref = useReveal();
  return <div ref={ref} className="reveal">{children}</div>;
}

export default function Home() {
  const { data, setData } = useLoad('/api/home');
  const latelyRef = useRef(null);
  const ok = data && data.available !== false;
  const d = ok ? data : null;
  const now = nowOf(d);
  const unread = d?.activity?.reduce((n, a) => n + (a.unread || 0), 0) || 0;

  const readAll = () => {
    setData((x) => ({ ...x, activity: x.activity.map((a) => ({ ...a, unread: 0 })) }));
    api('/api/activity/read', { method: 'POST' }).catch(() => {});
  };

  return (
    <main className="home">
      <Hero data={d} now={now} unread={unread} onBell={() => latelyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />

      <Band tone="l1" seed={2}>
        {data?.available === false && <div className="card offline">暂时连不上他那边，过一会儿再来看看。</div>}
        {!data && <div className="card skeleton" aria-label="加载中" />}
        <Weather w={d?.weather} />
        {d?.state && <><SecHead en="his tide" zh="他此刻" go="进入心潮" href="#/tide" /><HisNow s={d.state} /></>}
        {d?.note && <><SecHead en="notes" zh="留言板" go={`共 ${d.note.total} 条`} href="#/notes" /><TodayNote note={d.note} names={d.names} /></>}
      </Band>

      {(d?.listen || d?.watch) && (
        <Band tone="l2" seed={5}>
          <Reveal>
            <SecHead en="together" zh="一起" go="进入" href="#/together" />
            <div className="reveal-late"><Together listen={d.listen} watch={d.watch} /></div>
          </Reveal>
        </Band>
      )}

      <Band tone="l3" seed={8}>
        <div ref={latelyRef} className="anchor" />
        <Reveal>
          <SecHead en="lately" zh="他的动态" go={unread ? '全部已读' : '去小屋'} {...(unread ? { onGo: readAll } : { href: '#/room' })} />
          <div className="reveal-late"><Lately items={d?.activity} now={now} /></div>
        </Reveal>
      </Band>

      <Band tone="l4" seed={11} className="last">
        <Reveal><Contents /></Reveal>
        <footer className="foot"><BrandMark size={12} /><span className="serif">IMPRINT</span><span className="hand">with you, every tide.</span></footer>
      </Band>
    </main>
  );
}
