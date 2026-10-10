# Imprint · 蓝晒手账

伴侣 App 前端（只做手机）。风格：蓝晒印相 + 撕纸拼贴，纸带从上到下越来越深。

效果图（含设计系统参考板）：https://claude.ai/artifact/6YMgFxt6nxUGiBDm6PxL8p

## 怎么跑

```bash
npm install
cp .env.example .env.local   # 没有后端时保持 VITE_MOCK=1，用假数据
npm run dev
```

打包：`npm run build`，产物在 `dist/`，任何静态目录都能放（hash 路由，不需要服务器配置）。

## 接后端

- 所有请求都走 `src/lib/api.js`，后端地址写在 `.env.local` 的 `VITE_API_BASE`，同时把 `VITE_MOCK` 改成 0。
- 需要登录的话，把令牌存进本地的 `imprint.token`，请求会自动带上。
- 每个接口要返回什么，看 `src/lib/mock.js`（假数据的形状就是约定）和 `docs/` 里每页的接入建议。

## 进度

| # | 页面 | 路由 | 状态 | 说明 |
|---|---|---|---|---|
| 00 | 设计系统 | — | ✅ 只出参考图 | 见效果图画布左边两张板 |
| 01 | 首页 | `#/` | ✅ | [docs/01-首页.md](docs/01-首页.md) |
| 02 | 留言板 | `#/notes` | ✅ | [docs/02-留言板.md](docs/02-留言板.md) |
| 03 | 聊天 | `#/chat/t?id=` | ✅ | [docs/03-聊天.md](docs/03-聊天.md) |
| 03a | 聊天列表（窗口 · 群聊 · 接 Codex） | `#/chat` | ✅ | [docs/03a-聊天列表.md](docs/03a-聊天列表.md) |
| 04 | 小屋 | `#/room` | ✅ | [docs/04-小屋.md](docs/04-小屋.md) |
| 05 | 一起（听 · 歌单 · 看 · 悬浮小窗） | `#/together` | ✅ | [docs/05-一起.md](docs/05-一起.md) |
| 06 | 心潮（此刻 / 记忆 / 梦与觉察） | `#/tide` | ✅ | [docs/06-心潮.md](docs/06-心潮.md) |
| 07 | 设置（控制台 / 接入 / 功能管理含 MCP / 美化 / 用量与日志） | `#/settings` | ✅ | [docs/07-设置.md](docs/07-设置.md) |
| 08 | 续火花（赠送） | `#/spark` | ✅ | [docs/08-续火花.md](docs/08-续火花.md) |

全部页面已完成。

## 换主题色

颜色全是变量，在 `src/design/tokens.css`：默认蓝晒写在最上面，下面有雾紫、灰绿两段示例。要换颜色，改这十来个值，或者照着示例再写一段。切换主题调用 `src/theme/theme.js` 里的 `setTheme('lilac')`，会记在本地；网址加 `?theme=lilac` 可以临时看效果。

## 纸张动效

八种，样式都在 `src/design/tokens.css` 底部，加上对应的 class 就能用：

| 动效 | class | 用在哪 |
|---|---|---|
| 落桌 | `m-settle` | 新卡片、新留言出现 |
| 撕开进场 | `reveal`（配 `useReveal`） | 往下滚动时纸带升上来 |
| 显影 | `m-develop`（蓝晒图自带） | 图片加载 |
| 盖章 | `m-seal` | 发送、保存 |
| 掀角 | `press` | 按住卡片 |
| 风吹 | `m-breeze` / `m-breeze-tape` | 待机时照片、纸胶带轻轻晃 |
| 翻页 | `m-turn`（App 已套好） | 切换页面 |
| 收好 | `m-tuck` | 删除、归档 |

手机开了「减少动态效果」时会自动换成简单的淡入淡出。

## 目录

```
src/
  design/      tokens.css 颜色变量和动效 · paper.jsx 纸张材质（撕边、蓝晒、火漆…）· icons.jsx
  theme/       换主题
  lib/         api.js 请求出口 · mock.js 假数据 · router.js · 每页的数据工具
  components/  底栏 + 每页的组件文件夹
  pages/       每页一个文件
docs/          每页的接入建议
previews/      预览图
tools/         shoot.mjs 截预览图 · pack.sh 打交付包
```

## 字体

正文用苹方-繁 细体（系统自带，安卓和 Windows 会换成思源黑体）；标题用 Cormorant Garamond；手写小字英文用 Mrs Saint Delafield，中文用 Long Cang。后三种从 Google Fonts 加载，链接在 `index.html`。
