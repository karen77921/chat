/**
 * 01 首页：按她画的草图——头像和名字、在一起的天数、会动的年糕、他想说的话、留言板、他的心情和待办。
 * 数据：GET /api/home、/api/home/whisper、/api/home/plans（字段见 src/lib/mock.js）
 */
import { useEffect, useRef, useState } from 'react';
import { useLoad } from '../lib/useLoad.js';
import { api } from '../lib/api.js';
import { nowOf } from '../lib/home.js';
import HomeMain from '../components/home/HomeMain.jsx';

export default function Home() {
  const { data, setData, reload } = useLoad('/api/home');
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const timer = setInterval(reload, 30000);
    const onVisible = () => { if (document.visibilityState === 'visible') reload(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [reload]);
  const latelyRef = useRef(null);
  const ok = data && data.available !== false;
  const d = ok ? data : null;
  const now = d ? new Date(clock) : nowOf(d);
  const unread = d?.activity?.reduce((n, a) => n + (a.unread || 0), 0) || 0;

  const readAll = () => {
    api('/api/activity/read', { method: 'POST' })
      .then(() => setData((x) => ({ ...x, activity: x.activity.map((a) => ({ ...a, unread: 0 })) })))
      .catch(() => {});
  };

  return <HomeMain data={data} d={d} now={now} unread={unread} onReadAll={readAll} latelyRef={latelyRef} onNamesSaved={reload} />;
}
