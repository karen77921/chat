import assert from 'node:assert/strict';
import test from 'node:test';
import { stickerToken, stickerUrls, rememberStickers } from '../src/lib/stickerUrls.js';

test('a paragraph that is only a sticker token is a sticker', () => {
  assert.equal(stickerToken('[表情：cat-heart]'), 'cat-heart');
  assert.equal(stickerToken('  [表情：abc123]\n'), 'abc123');
  assert.equal(stickerToken('哈哈 [表情：cat-heart]'), null);
  assert.equal(stickerToken(''), null);
});

test('custom sticker urls are remembered by id', () => {
  rememberStickers([{ id: 'a1', url: '/relay/uploads/a.png' }], [{ id: 'b2' }]);
  assert.equal(stickerUrls.get('a1'), '/relay/uploads/a.png');
  assert.equal(stickerUrls.has('b2'), false);
});
