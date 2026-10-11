import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTideMemories, parseTideMemoryText } from '../src/lib/tideMemory.js';

const CATALOG = `=== 记忆目录（20 桶）===
先看目录定位，再 breath_search(query=...) 精准拉取正文。
2026-10-10 09-15-13 季宁小年糕记忆档案 | 恋爱,数字 | 10 | 👣 Footprint：LLM经grow创建
2026-10-11 12-24-58 互称昵称确认大麻薯与小年糕 | 人际 | 6 | 👣 Footprint：LLM经grow创建`;

test('catalog headings are excluded and dated memories are structured', () => {
  const items = parseTideMemoryText(CATALOG);
  assert.equal(items.length, 2);
  assert.equal(items[0].text, '季宁小年糕记忆档案');
  assert.equal(items[0].tag, '恋爱 · 数字');
  assert.equal(items[0].at, '2026-10-10T09:15:13+08:00');
  assert.ok(!items.some((item) => item.text.includes('先看目录')));
});

test('normalization derives heat, week count, recent items and manual count', () => {
  const result = { text: CATALOG };
  const meta = { items: [{ id: 'mine-1', at: '2026-10-11T18:00:00+08:00', text: '她手动压的一枚', tag: '我们', by: 'me' }] };
  const data = normalizeTideMemories(result, meta, '', new Date('2026-10-11T20:00:00+08:00'));
  assert.equal(data.stats.longTerm, 3);
  assert.equal(data.stats.weekWrites, 3);
  assert.equal(data.stats.manual, 1);
  assert.equal(data.heat.find((day) => day.date === '2026-10-11').count, 2);
  assert.equal(data.recent[0].text, '她手动压的一枚');
});
