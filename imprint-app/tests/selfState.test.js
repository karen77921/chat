import test from 'node:test';
import assert from 'node:assert/strict';
import { splitSelfState } from '../src/lib/selfState.js';

test('splits a public self-state from the spoken reply', () => {
  assert.deepEqual(splitSelfState('[[自我状态]]\n有点想她。\n[[/自我状态]]\n——\n回来啦。'), {
    state: '有点想她。',
    body: '回来啦。',
  });
});

test('keeps ordinary replies unchanged', () => {
  assert.deepEqual(splitSelfState('普通回复'), { state: '', body: '普通回复' });
});

test('supports the full-width colon form and a self-state-only reply', () => {
  assert.deepEqual(splitSelfState(' [[自我状态：]]嗯。[[/自我状态]] '), { state: '嗯。', body: '' });
});
