/**
 * 底栏：首页 · 小屋 · 聊天 · 心潮 · 设置。
 * 每个入口是一张芭蕾小画（她给的素材抠出来的），不是线条图标：
 * 首页 天鹅 · 小屋 舞台帘子 · 聊天 羽毛 · 心潮 音乐盒 · 设置 小镜子。
 * 没选中的小画褪一点色，选中的那张放大一点、底下一颗玫瑰色小点。
 */
import swan from '../design/ballet/stickers/swan.webp';
import curtain from '../design/ballet/stickers/curtain.webp';
import feather from '../design/ballet/stickers/feather.webp';
import musicbox from '../design/ballet/stickers/musicbox.webp';
import mirror from '../design/ballet/stickers/mirror.webp';
import './tabbar.css';

const TABS = [
  { path: '/', name: '首页', img: swan },
  { path: '/room', name: '小屋', img: curtain },
  { path: '/chat', name: '聊天', img: feather },
  { path: '/tide', name: '心潮', img: musicbox },
  { path: '/settings', name: '设置', img: mirror },
];

export const TAB_PATHS = TABS.map((t) => t.path);

export default function TabBar({ path }) {
  return (
    <nav className="tabbar" aria-label="主导航">
      {TABS.map((t) => {
        const on = t.path === '/' ? path === '/' : path.startsWith(t.path);
        return (
          <a key={t.path} href={`#${t.path}`} className={`tab ${on ? 'on' : ''}`} aria-current={on ? 'page' : undefined}>
            <img src={t.img} alt="" />
            <span>{t.name}</span>
          </a>
        );
      })}
    </nav>
  );
}
