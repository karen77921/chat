/** 和 <img> 一样用；上传到中继的图片会先带着登录凭证取回来再显示（直接用地址会显示成「?」）。 */
import { useEffect, useState } from 'react';
import { authedImageUrl, isRelayUpload } from '../lib/api.js';

export default function AuthImg({ src, alt = '', ...rest }) {
  const needsAuth = isRelayUpload(src);
  const [shown, setShown] = useState(needsAuth ? '' : src);
  useEffect(() => {
    if (!needsAuth) { setShown(src); return undefined; }
    let alive = true;
    authedImageUrl(src).then((url) => { if (alive) setShown(url); }).catch(() => { if (alive) setShown(src); });
    return () => { alive = false; };
  }, [src, needsAuth]);
  return shown ? <img src={shown} alt={alt} {...rest} /> : <img alt={alt} {...rest} style={{ ...(rest.style || {}), visibility: 'hidden' }} />;
}
