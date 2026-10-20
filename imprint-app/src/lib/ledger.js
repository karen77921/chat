/**
 * 上下文账本：把后端记在每条回复上的 api 信息（用量、缓存、耗时、请求组成）
 * 整理成几组「名字 / 数值」，长按他的消息就能看到这一轮花在了哪里。
 */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const tokens = (v) => (v == null ? '—' : v >= 10000 ? `${(v / 1000).toFixed(1)}k` : String(v));
const secs = (v) => (v == null ? '—' : `${Number(v).toFixed(1)} 秒`);
const chars = (v) => (v == null ? '—' : v >= 10000 ? `${(v / 10000).toFixed(1)} 万字` : `${v} 字`);

export function ledgerFrom(api) {
  if (!api || typeof api !== 'object' || !(api.usage || api.timing)) return null;
  const u = api.usage || {};
  const d = u.prompt_tokens_details || {};
  const t = api.timing || {};
  const req = t.request || {};
  const input = num(u.prompt_tokens ?? u.input_tokens);
  const output = num(u.completion_tokens ?? u.output_tokens);
  const read = num(d.cached_tokens ?? u.cache_read_input_tokens) || 0;
  const write = num(d.cache_write_tokens ?? u.cache_creation_input_tokens) || 0;
  // OpenAI-compatible usage reports prompt_tokens as the whole prompt and
  // cached_tokens as a subset. Anthropic reports the three input buckets
  // separately. Dividing an Anthropic cache read by input_tokens therefore
  // produces nonsense such as 29,109 / 2 = 1,455,450%.
  const anthropicBuckets = u.prompt_tokens == null
    && (u.input_tokens != null || u.cache_read_input_tokens != null || u.cache_creation_input_tokens != null);
  const promptTotal = input == null ? null : anthropicBuckets ? input + read + write : input;
  const cacheHit = promptTotal ? Math.round((read / promptTotal) * 100) : null;
  const calls = Array.isArray(t.model) ? t.model : [];
  const firstChunk = calls.length ? num(calls[0].first_chunk_s) : null;

  const groups = [];
  groups.push({
    title: '用量',
    rows: [
      [anthropicBuckets ? '本轮新输入' : '读进去', input == null ? '—' : `${tokens(input)} token`],
      anthropicBuckets && promptTotal != null ? ['本轮输入合计', `${tokens(promptTotal)} token`] : null,
      ['写出来', output == null ? '—' : `${tokens(output)} token`],
      ['缓存命中', cacheHit == null ? `${tokens(read)} token` : `${tokens(read)} token（${cacheHit}%）`],
      write ? ['写入缓存', `${tokens(write)} token`] : null,
    ].filter(Boolean),
  });
  groups.push({
    title: '耗时',
    rows: [
      ['一共', secs(t.total_s)],
      ['准备上下文', secs(t.context_s)],
      t.recall_s != null ? ['回想记忆', secs(t.recall_s) + (t.recall_timed_out ? '（超时，用了上一轮的）' : '')] : null,
      ['模型开口', secs(firstChunk)],
      t.tool_s ? ['用工具', secs(t.tool_s)] : null,
      ['模型请求', `${calls.length} 次` + (calls.some((c) => c.dropped_tools) ? '（有一次太慢，去掉工具重问了）' : '')],
    ].filter(Boolean),
  });
  if (Object.keys(req).length) {
    groups.push({
      title: '这一轮装了什么',
      rows: [
        ['人设和环境', chars(num(req.system_chars))],
        ['聊天记录', `${req.history ?? '—'} 条，${chars(num(req.history_chars))}`],
        ['工具', `${req.tools ?? 0} 个，说明 ${chars(num(req.tool_chars))}`],
      ],
    });
  }
  const cache = api.prompt_cache || {};
  groups.push({
    title: '线路',
    rows: [
      ['模型', api.model || '—'],
      (api.fallback_from || []).length ? ['换过线路', api.fallback_from.join('、')] : null,
      ['工具轮数', String(api.tool_steps ?? 0)],
      cache.mode ? ['缓存方式', String(cache.mode) + (cache.fallback ? '（降级过）' : '')] : null,
      api.error ? ['出错', String(api.error).slice(0, 160)] : null,
    ].filter(Boolean),
  });
  return groups;
}
