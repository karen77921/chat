import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

/**
 * GET 一个接口。data：null = 加载中；{ available: false } = 失联或出错。
 * keepPrevious 用于搜索、筛选等轻量刷新，避免刷新时卸载页面内正在编辑的弹层。
 */
export function useLoad(path, { keepPrevious = false } = {}) {
  const [data, setData] = useState(null);
  const load = useCallback(() => {
    if (!path) return Promise.resolve();
    return api(path)
      .then(setData)
      .catch((e) => setData({ available: false, reason: e.message }));
  }, [path]);
  useEffect(() => { if (!keepPrevious) setData(null); load(); }, [load, keepPrevious]);
  return { data, setData, reload: load };
}
