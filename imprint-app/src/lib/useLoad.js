import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

/**
 * GET 一个接口。data：null = 加载中；{ available: false } = 失联或出错。
 */
export function useLoad(path) {
  const [data, setData] = useState(null);
  const load = useCallback(() => {
    if (!path) return Promise.resolve();
    return api(path)
      .then(setData)
      .catch((e) => setData({ available: false, reason: e.message }));
  }, [path]);
  useEffect(() => { setData(null); load(); }, [load]);
  return { data, setData, reload: load };
}
