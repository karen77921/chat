/**
 * 底栏：首页 · 小屋 · 聊天（居中凸起）· 心潮 · 设置。固定在屏幕底部，磨砂白。
 */
import Icon from '../design/icons.jsx';
import './tabbar.css';

const TABS = [
  { path: '/', name: '首页', icon: 'home' },
  { path: '/room', name: '小屋', icon: 'room' },
  { path: '/chat', name: '聊天', icon: 'chat', mid: true },
  { path: '/tide', name: '心潮', icon: 'tide' },
  { path: '/settings', name: '设置', icon: 'desk' },
];

export const TAB_PATHS = TABS.map((t) => t.path);

export default function TabBar({ path }) {
  return (
    <nav className="tabbar" aria-label="主导航">
      {TABS.map((t) => {
        const on = t.path === '/' ? path === '/' : path.startsWith(t.path);
        return (
          <a key={t.path} href={`#${t.path}`} className={`tab ${t.mid ? 'mid' : ''} ${on ? 'on' : ''}`} aria-current={on ? 'page' : undefined}>
            {t.mid ? <span className="mc"><Icon name={t.icon} size={24} stroke={1.4} /></span> : <Icon name={t.icon} size={22} />}
            <span>{t.name}</span>
          </a>
        );
      })}
    </nav>
  );
}
