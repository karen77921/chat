// 预览图截图脚本。用法：
//   VITE_MOCK=1 npx vite build && npx vite preview --port 4322
//   node tools/shoot.mjs [只截名字含这个词的]
// Playwright 用的是本机 ~/taobao-mcp 里装好的那份；换机器时改成 import { chromium, devices } from 'playwright'
import { chromium, devices } from '/Users/paipai/taobao-mcp/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = 'http://localhost:4322/';
const OUT = fileURLToPath(new URL('../previews', import.meta.url));
mkdirSync(OUT, { recursive: true });
const only = process.argv[2];
const browser = await chromium.launch();
const errors = [];

// 截整页时「撕开进场」的区块还没滚到，先全部显示出来
const revealAll = (p) => p.evaluate(() => document.querySelectorAll('.reveal').forEach((e) => e.classList.add('in')));

async function shot({ name, hash = '', wait = 1600, before, full = false, scrollTo }) {
  if (only && !name.includes(only)) return;
  const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  // 网络加载失败（多半是 Google Fonts 偶尔连不上）不算页面报错
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(`${name}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(`${BASE}#/${hash}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(wait);
  if (scrollTo) { await page.locator(scrollTo).first().evaluate((e) => e.scrollIntoView({ block: 'start' })); await page.waitForTimeout(900); }
  if (before) { await before(page); await page.waitForTimeout(600); }
  if (full) { await revealAll(page); await page.waitForTimeout(800); }
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  await ctx.close();
  console.log('shot', name);
}

// 01 首页
await shot({ name: '01-home', hash: '' });
await shot({ name: '01-home-full', hash: '', full: true });
await shot({ name: '01-home-note', hash: '', scrollTo: '.his' });
await shot({ name: '01-home-together', hash: '', scrollTo: '.tg' , before: (p) => p.evaluate(() => scrollBy(0, -90)) });
await shot({ name: '01-home-contents', hash: '', before: (p) => p.evaluate(() => scrollTo(0, document.body.scrollHeight)) });

// 02 留言板
await shot({ name: '02-notes', hash: 'notes' });
await shot({ name: '02-notes-search', hash: 'notes?q=月亮' });
await shot({ name: '02-notes-calendar', hash: 'notes?date=1' });
await shot({ name: '02-notes-write', hash: 'notes?new=1', before: (p) => p.locator('.ws-paper textarea').fill('明天早上的会改到十点了，\n可以多睡半小时') });
await shot({ name: '02-notes-posted', hash: 'notes?new=1', before: async (p) => {
  await p.locator('.ws-paper textarea').fill('今晚的风好舒服，开着窗写这条。');
  await p.getByRole('radio', { name: '蓝晒卡' }).click();
  await p.locator('.ws-pin').click();
  await p.getByRole('button', { name: '贴上去' }).click();
  await p.waitForTimeout(1200);
} });

// 03 聊天
await shot({ name: '03-chat', hash: 'chat/t?id=w1' });
await shot({ name: '03-chat-replying', hash: 'chat/t?id=w1', before: async (p) => { await p.getByRole('button', { name: /回复/ }).click(); await p.waitForTimeout(500); } });
await shot({ name: '03-chat-replied', hash: 'chat/t?id=w1', before: async (p) => { await p.getByRole('button', { name: /回复/ }).click(); await p.waitForTimeout(3200); } });
await shot({ name: '03-chat-waiting', hash: 'chat/t?id=w1&demo=waiting' });
await shot({ name: '03-chat-stuck', hash: 'chat/t?id=w1&demo=stuck' });
await shot({ name: '03-chat-failed', hash: 'chat/t?id=w1&demo=failed' });
await shot({ name: '03-chat-menu', hash: 'chat/t?id=w1', before: (p) => p.locator('.cm-bubble.him').last().click({ button: 'right' }) });
await shot({ name: '03-chat-quote', hash: 'chat/t?id=w1', before: async (p) => { await p.locator('.cm-bubble.him').last().click({ button: 'right' }); await p.getByRole('button', { name: '引用' }).click(); await p.locator('.cin-field textarea').fill('没有！站在路边的！'); } });
await shot({ name: '03-chat-plus', hash: 'chat/t?id=w1', before: (p) => p.getByRole('button', { name: '更多', exact: true }).click() });
await shot({ name: '03-chat-stickers', hash: 'chat/t?id=w1', before: (p) => p.getByRole('button', { name: '表情', exact: true }).click() });
await shot({ name: '03-chat-images', hash: 'chat/t?id=w1', before: (p) => p.evaluate(() => scrollTo(0, 0)) });

// 04 小屋
await shot({ name: '04-room', hash: 'room' });
await shot({ name: '04-room-solo', hash: 'room?tab=solo' });
await shot({ name: '04-room-stickers', hash: 'room?tab=stickers' });
await shot({ name: '04-room-photo', hash: 'room', before: (p) => p.locator('.rm-pol').first().click() });
await shot({ name: '04-room-draw', hash: 'room?tab=stickers', before: (p) => p.getByRole('button', { name: /让他画一张/ }).click() });

// 03a 聊天列表 + 群聊
await shot({ name: '03a-chatlist', hash: 'chat' });
await shot({ name: '03a-chatlist-swipe', hash: 'chat', before: (p) => p.locator('.cl-swipe').nth(1).click({ button: 'right' }) });
await shot({ name: '03a-chatlist-new', hash: 'chat?new=1' });
await shot({ name: '03a-group', hash: 'chat/t?id=g1' });
await shot({ name: '03a-group-choose', hash: 'chat/t?id=g1', before: async (p) => { await p.locator('.cin-field textarea').fill('九点可以！'); await p.keyboard.press('Enter'); await p.getByRole('button', { name: /回复/ }).click(); } });

// 08 续火花（赠送）
await shot({ name: '08-spark', hash: 'spark' });
await shot({ name: '08-spark-shop', hash: 'spark?tab=shop' });
await shot({ name: '08-spark-redeem', hash: 'spark?tab=shop', before: (p) => p.locator('.sp-gift').nth(2).click() });
await shot({ name: '08-spark-kept', hash: 'spark?tab=kept' });
await shot({ name: '08-spark-records', hash: 'spark?tab=kept', before: (p) => p.getByRole('tab', { name: '兑换记录' }).click() });

// 05 一起
await shot({ name: '05-together', hash: 'together' });
await shot({ name: '05-together-playlist', hash: 'together?playlist=1' });
await shot({ name: '05-together-search', hash: 'together?playlist=1', before: (p) => p.locator('.pl-search input').fill('海边') });
await shot({ name: '05-together-watch', hash: 'together?tab=watch' });
await shot({ name: '05-mini', hash: '' , before: (p) => p.evaluate(() => scrollTo(0, 900)) });
await shot({ name: '05-mini-open', hash: 'room', before: (p) => p.locator('.mini').click() });

// 06 心潮
await shot({ name: '06-tide', hash: 'tide' });
await shot({ name: '06-tide-drives', hash: 'tide', before: (p) => p.getByRole('button', { name: /全部 12 股/ }).click() });
await shot({ name: '06-tide-memory', hash: 'tide?tab=memory' });
await shot({ name: '06-tide-press', hash: 'tide?tab=memory&press=1', before: (p) => p.locator('.td-pressbox textarea').fill('她早上起来第一件事是开窗，冬天也开一条缝。') });
await shot({ name: '06-tide-dream', hash: 'tide?tab=dream' });

// 07 设置
await shot({ name: '07-settings', hash: 'settings' });
await shot({ name: '07-settings-access', hash: 'settings?p=access', before: (p) => p.locator('.st-conn').first().click() });
await shot({ name: '07-settings-features', hash: 'settings?p=features' });
await shot({ name: '07-settings-beauty', hash: 'settings?p=beauty' });
await shot({ name: '07-settings-usage', hash: 'settings?p=usage' });
await shot({ name: '07-settings-tools', hash: 'settings?p=usage', before: (p) => p.getByRole('tab', { name: '工具调用' }).click() });

await browser.close();
if (errors.length) { console.error('页面报错：\n' + errors.join('\n')); process.exit(1); }
