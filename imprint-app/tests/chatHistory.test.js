import test from 'node:test';
import assert from 'node:assert/strict';
import { collectHistory } from '../src/lib/chatHistory.js';

test('loads every page into one continuous conversation', async () => {
  const source = Array.from({ length: 723 }, (_, index) => ({ id: index + 1, text: `message ${index + 1}` }));
  const calls = [];
  const messages = await collectHistory(({ since, limit }) => {
    calls.push({ since, limit });
    return Promise.resolve({ messages: source.filter((item) => item.id > since).slice(0, limit) });
  });
  assert.equal(messages.length, 723);
  assert.equal(messages.at(-1).text, 'message 723');
  assert.deepEqual(calls, [{ since: 0, limit: 500 }, { since: 500, limit: 500 }]);
});

test('deduplicates an inclusive page boundary', async () => {
  const pages = [
    { messages: [{ id: 1 }, { id: 2 }] },
    { messages: [{ id: 2 }, { id: 3 }] },
    { messages: [{ id: 3 }] },
  ];
  let call = 0;
  const messages = await collectHistory(() => Promise.resolve(pages[call++] || { messages: [] }), { pageSize: 2 });
  assert.deepEqual(messages.map((item) => item.id), [1, 2, 3]);
});

test('stops safely if the relay cursor cannot advance', async () => {
  let calls = 0;
  const messages = await collectHistory(() => {
    calls += 1;
    return Promise.resolve({ messages: [{ id: 'not-numeric' }] });
  }, { pageSize: 1 });
  assert.equal(calls, 1);
  assert.equal(messages.length, 1);
});
