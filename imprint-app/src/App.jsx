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
  return (
    <>
      <div key={path} className="m-turn">
        {Page ? <Page query={query} /> : <ComingSoon title={TITLES[path] || ['还没做好', 'soon']} />}
      </div>
      {TAB_PATHS.includes(path) && <TabBar path={path} />}
      <MiniPlayer path={path} tabbar={TAB_PATHS.includes(path)} />
      <Grain />
    </>
  );
}
