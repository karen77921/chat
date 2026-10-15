import test from 'node:test';
import assert from 'node:assert/strict';
import { mapLimited } from '../src/lib/image.js';

test('mapLimited keeps order and never runs more than the limit at once', async () => {
  let running = 0, peak = 0;
  const seen = [];
  const out = await mapLimited([30, 10, 20, 5, 15], 2, async (ms, i) => {
    running++; peak = Math.max(peak, running);
    await new Promise((ok) => setTimeout(ok, ms));
    running--;
    return i * 10;
  }, (n) => seen.push(n));
  assert.deepEqual(out, [0, 10, 20, 30, 40]);
  assert.equal(peak, 2);
  assert.deepEqual(seen, [1, 2, 3, 4, 5]);
});
