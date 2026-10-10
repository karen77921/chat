/**
 * 路由表。新页面做好后在 ROUTES 里加一行；首页和底栏的链接已经指好了。
 * 每次换页套一层 .m-turn（纸张动效「翻页」）。
 */
import { useRoute } from './lib/router.js';
import Home from './pages/Home.jsx';
import ComingSoon from './pages/ComingSoon.jsx';
import TabBar, { TAB_PATHS } from './components/TabBar.jsx';
import Notes from './pages/Notes.jsx';
import Chat from './pages/Chat.jsx';
import Room from './pages/Room.jsx';
import ChatList from './pages/ChatList.jsx';
import Spark from './pages/Spark.jsx';
import Together from './pages/Together.jsx';
import MiniPlayer from './components/together/MiniPlayer.jsx';
import Tide from './pages/Tide.jsx';
import Settings from './pages/Settings.jsx';
import { Grain } from './design/paper.jsx';
import { useEffect, useState } from 'react';
import { saveToken, savedToken } from './lib/api.js';

const ROUTES = {
  '/': Home,
  '/notes': Notes,
  '/chat': ChatList,
  '/chat/t': Chat,
  '/room': Room,
  '/spark': Spark,
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
  const [needsAuth, setNeedsAuth] = useState(() => !savedToken());
  useEffect(() => {
    const show = () => setNeedsAuth(true);
    addEventListener('imprint-auth-required', show);
    return () => removeEventListener('imprint-auth-required', show);
  }, []);
  return (
    <>
      <div key={path} className="m-turn">
        {Page ? <Page query={query} /> : <ComingSoon title={TITLES[path] || ['还没做好', 'soon']} />}
      </div>
      {TAB_PATHS.includes(path) && <TabBar path={path} />}
      <MiniPlayer path={path} tabbar={TAB_PATHS.includes(path)} />
      <Grain />
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
