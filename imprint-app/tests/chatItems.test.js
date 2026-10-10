import assert from 'node:assert/strict';
import test from 'node:test';
import { upsertMessage, settleSentMessage } from '../src/lib/chatItems.js';

test('SSE arriving before send acknowledgement leaves one saved message', () => {
  const temp = { id: 'tmp-1', text: '把这个导入记忆库', status: 'sending' };
  const pushed = { id: 42, text: temp.text, status: 'queued' };
  const acknowledged = { id: '42', text: temp.text, status: 'queued' };
  const items = settleSentMessage(upsertMessage([temp], pushed), temp.id, acknowledged);
  assert.equal(items.length, 1);
  assert.equal(String(items[0].id), '42');
});

test('send acknowledgement before SSE also leaves one saved message', () => {
  const temp = { id: 'tmp-2', text: '一份文件', status: 'sending' };
  const acknowledged = { id: 43, text: temp.text, status: 'queued' };
  const pushed = { id: '43', text: temp.text, status: 'sent' };
  const items = upsertMessage(settleSentMessage([temp], temp.id, acknowledged), pushed);
  assert.equal(items.length, 1);
  assert.equal(items[0].status, 'sent');
});
