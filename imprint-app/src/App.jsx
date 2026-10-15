/**
 * 路由表。新页面做好后在 ROUTES 里加一行；首页和底栏的链接已经指好了。
 * 每次换页套一层 .m-turn（纸张动效「翻页」）。
 */
import { useRoute } from './lib/router.js';
import Home from './pages/Home.jsx';
import ComingSoon from './pages/ComingSoon.jsx';
import TabBar, { TAB_PATHS } from './components/TabBar.jsx';
import MiniPlayer from './components/together/MiniPlayer.jsx';
import { Grain } from './design/paper.jsx';
import { lazy, Suspense, useEffect, useState } from 'react';
import { api, MOCK, saveToken, savedToken } from './lib/api.js';

// 首页之外的页面点进去才下载，打开 App 时少解析一大块代码
const Notes = lazy(() => import('./pages/Notes.jsx'));
const Chat = lazy(() => import('./pages/Chat.jsx'));
const Room = lazy(() => import('./pages/Room.jsx'));
const ChatList = lazy(() => import('./pages/ChatList.jsx'));
const Spark = lazy(() => import('./pages/Spark.jsx'));
const Approvals = lazy(() => import('./pages/Approvals.jsx'));
const Piggy = lazy(() => import('./pages/Piggy.jsx'));
const Vocab = lazy(() => import('./pages/Vocab.jsx'));
const Study = lazy(() => import('./pages/Study.jsx'));
const Drawer = lazy(() => import('./pages/Drawer.jsx'));
const Together = lazy(() => import('./pages/Together.jsx'));
const Tide = lazy(() => import('./pages/Tide.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));

const ROUTES = {
  '/': Home,
  '/notes': Notes,
  '/chat': ChatList,
  '/chat/t': Chat,
  '/room': Room,
  '/spark': Spark,
  '/approvals': Approvals,
  '/piggy': Piggy,
  '/drawer': Drawer,
  '/words': Vocab,
  '/study': Study,
  '/study/read': Study,
  '/together': Together,
  '/tide': Tide,
  '/settings': Settings,
};
const TITLES = {
  '/notes': ['留言板', 'notes'], '/chat': ['聊天', 'letters'], '/room': ['小屋', 'the room'],
  '/together': ['一起', 'together'], '/tide': ['心潮', 'tides'], '/settings': ['设置', 'the desk'],
};

export default function App() {
  const { path, query } = useRoute();
  const Page = ROUTES[path];
  const [needsAuth, setNeedsAuth] = useState(() => !MOCK && !savedToken());
  const [oauthNote, setOauthNote] = useState('');
  useEffect(() => {
    const show = () => { if (!MOCK) setNeedsAuth(true); };
    addEventListener('imprint-auth-required', show);
    return () => removeEventListener('imprint-auth-required', show);
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const code = params.get('code'), state = params.get('state'), error = params.get('error');
    if ((!code || !state) && !error) return;
    if (needsAuth) return;
    if (error) {
      setOauthNote(`MCP 授权失败：${params.get('error_description') || error}`);
      history.replaceState(null, '', `${location.pathname}#/settings?p=features`);
      return;
    }
    setOauthNote('正在完成 MCP 授权…');
    api('/api/mcp/oauth/complete', { method: 'POST', body: { code, state }, timeout: 60000 })
      .then((result) => {
        setOauthNote(result.ok ? 'MCP 已连接，AI 现在可以使用它的工具。' : '授权已保存，但 MCP 暂时未连上，请点一下重连。');
        history.replaceState(null, '', `${location.pathname}#/settings?p=features`);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      })
      .catch((e) => {
        setOauthNote(`MCP 授权失败：${e?.message || '未知错误'}`);
        history.replaceState(null, '', `${location.pathname}#/settings?p=features`);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
  }, [needsAuth]);
  return (
    <>
      <div key={path} className="m-turn">
        <Suspense fallback={<div className="page-wait" aria-label="加载中" />}>
          {Page ? <Page query={query} /> : <ComingSoon title={TITLES[path] || ['还没做好', 'soon']} />}
        </Suspense>
      </div>
      {TAB_PATHS.includes(path) && <TabBar path={path} />}
      {path !== '/study/read' && <MiniPlayer path={path} tabbar={TAB_PATHS.includes(path)} />}
      <Grain />
      {oauthNote && <button type="button" onClick={() => setOauthNote('')} style={{ position: 'fixed', left: 16, right: 16, bottom: 92, zIndex: 90, maxWidth: 430, margin: 'auto', padding: '12px 16px', borderRadius: 14, border: '1px solid rgba(93,112,134,.25)', background: 'rgba(250,248,242,.96)', color: '#42536a', boxShadow: '0 8px 28px rgba(43,55,70,.14)', textAlign: 'left' }}>{oauthNote}</button>}
      {needsAuth && <AccessGate onConnected={() => setNeedsAuth(false)} />}
    </>
  );
}

function AccessGate({ onConnected }) {
  const [secret, setSecret] = useState(savedToken());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const connect = async (event) => {
    event.preventDefault();
    const value = secret.trim();
    if (!value) { setError('请填写网站访问密钥'); return; }
    setBusy(true); setError(''); saveToken(value);
    try {
      const response = await fetch('/relay/app/sessions', { headers: { Authorization: `Bearer ${value}` } });
      if (!response.ok) throw new Error(response.status === 401 ? '访问密钥不正确' : '暂时无法连接私人后端');
      onConnected();
      location.reload();
    } catch (e) {
      saveToken(''); setError(e.message); setBusy(false);
    }
  };
  return (
    <div className="auth-gate" role="dialog" aria-modal="true" aria-label="连接私人后端">
      <form className="auth-card glass" onSubmit={connect}>
        <span className="auth-mark serif">Imprint</span>
        <h1>连接我们的记录</h1>
        <p>主屏幕 App 第一次打开，需要重新确认一次网站访问密钥。聊天和心潮记忆都还在 VPS，没有丢失。</p>
        <label><span>网站访问密钥</span><input autoFocus type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="current-password" placeholder="输入原来的网站访问密钥" /></label>
        {error && <div className="auth-error" role="alert">{error}</div>}
        <button className="btn-main" type="submit" disabled={busy}>{busy ? '正在连接…' : '连接并打开'}</button>
      </form>
    </div>
  );
}
