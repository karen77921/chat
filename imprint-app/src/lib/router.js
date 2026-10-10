/**
 * 极简 hash 路由：#/days、#/home?p=2。不引第三方库，部署到任何静态目录都能用。
 */
import { useEffect, useState } from 'react';

function parse() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(qs)) };
}

export function useRoute() {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}

/** 改网址但不新增历史记录（首页左右滑动时同步 ?p=） */
export function replaceQuery(query) {
  const { path } = parse();
  const qs = new URLSearchParams(query).toString();
  history.replaceState(null, '', `#${path}${qs ? `?${qs}` : ''}`);
}
