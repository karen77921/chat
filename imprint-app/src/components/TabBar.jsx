/**
 * 底栏：首页 · 小屋 · 聊天（居中，一颗缎面珍珠扣）· 心潮 · 设置。
 * 芭蕾风：奶白缎面条，上沿一圈蕾丝，双细线边框；当前页的图标上面系一个小粉蝴蝶结。
 */
import Icon from '../design/icons.jsx';
import bow from '../design/ballet/lace-bow-pink.png';
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
            {on && !t.mid && <img src={bow} alt="" className="tab-bow" />}
            {t.mid ? <span className="mc"><Icon name={t.icon} size={22} stroke={1.3} /></span> : <Icon name={t.icon} size={21} stroke={1.2} />}
            <span>{t.name}</span>
          </a>
        );
      })}
    </nav>
  );
}
