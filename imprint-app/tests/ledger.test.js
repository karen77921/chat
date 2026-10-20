import test from 'node:test';
import assert from 'node:assert/strict';
import { ledgerFrom } from '../src/lib/ledger.js';

test('no ledger without api info', () => {
  assert.equal(ledgerFrom(null), null);
  assert.equal(ledgerFrom({ model: 'x' }), null);
});

test('ledger lists usage, cache hit rate, timing and request make-up', () => {
  const groups = ledgerFrom({
    model: 'claude', tool_steps: 1, fallback_from: [],
    usage: { prompt_tokens: 20000, completion_tokens: 120, prompt_tokens_details: { cached_tokens: 15000 } },
    timing: { total_s: 7.2, context_s: 0.5, recall_s: 0.3, tool_s: 1.1,
      model: [{ first_chunk_s: 2.4, total_s: 4 }, { first_chunk_s: 1, total_s: 2 }],
      request: { system_chars: 8000, history: 40, history_chars: 12000, tools: 17, tool_chars: 9000 } },
    prompt_cache: { mode: 'auto' },
  });
  const flat = Object.fromEntries(groups.flatMap((g) => g.rows));
  assert.equal(flat['读进去'], '20.0k token');
  assert.equal(flat['缓存命中'], '15.0k token（75%）');
  assert.equal(flat['模型开口'], '2.4 秒');
  assert.equal(flat['模型请求'], '2 次');
  assert.equal(flat['聊天记录'], '40 条，1.2 万字');
  assert.equal(flat['工具'], '17 个，说明 9000 字');
  assert.equal(flat['缓存方式'], 'auto');
});

test('anthropic-style usage keys work too', () => {
  const groups = ledgerFrom({ usage: { input_tokens: 100, output_tokens: 5, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 } });
  const flat = Object.fromEntries(groups.flatMap((g) => g.rows));
  assert.equal(flat['本轮新输入'], '100 token');
  assert.equal(flat['本轮输入合计'], '160 token');
  assert.equal(flat['缓存命中'], '50 token（31%）');
  assert.equal(flat['写入缓存'], '10 token');
});

test('anthropic cache percentage uses all input buckets instead of tiny uncached input', () => {
  const groups = ledgerFrom({ usage: {
    input_tokens: 2, output_tokens: 226,
    cache_read_input_tokens: 29109, cache_creation_input_tokens: 20430,
  } });
  const flat = Object.fromEntries(groups.flatMap((g) => g.rows));
  assert.equal(flat['本轮输入合计'], '49.5k token');
  assert.equal(flat['缓存命中'], '29.1k token（59%）');
});

test('subscription usage (prompt_tokens + anthropic buckets) still uses all buckets', () => {
  const groups = ledgerFrom({ usage: {
    prompt_tokens: 2, completion_tokens: 536, total_tokens: 538,
    cache_read_input_tokens: 548, cache_creation_input_tokens: 48800,
  } });
  const flat = Object.fromEntries(groups.flatMap((g) => g.rows));
  assert.equal(flat['本轮输入合计'], '49.4k token');
  assert.equal(flat['缓存命中'], '548 token（1%）');
  assert.ok(flat['为什么重写']);
});
