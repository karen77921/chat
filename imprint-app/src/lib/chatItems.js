// SSE may deliver the saved message before the send request returns. Keep a
// single row for each server id when the optimistic row is reconciled.
const sameId = (a, b) => String(a) === String(b);

export function upsertMessage(items, message) {
  const index = items.findIndex((item) => sameId(item.id, message.id));
  if (index < 0) return [...items, message];
  return items.map((item, i) => i === index ? { ...item, ...message } : item);
}

export function settleSentMessage(items, temporaryId, message) {
  const withoutTemporary = items.filter((item) => !sameId(item.id, temporaryId));
  return upsertMessage(withoutTemporary, message);
}

// A fresh copy of the chat replaces the old one (it may hold replies the stream
// missed). Rows still being sent stay, and "he is replying" clears only once
// a reply newer than her latest message is there.
export function mergeResync(prev, fresh) {
  if (!fresh || fresh.available === false) return prev;
  if (!prev || prev.available === false) return fresh;
  const lastMine = [...prev.items].reverse().find((m) => m.from === 'me');
  const answered = !lastMine || fresh.items.some((m) => m.from !== 'me' && new Date(m.at) >= new Date(lastMine.at));
  const pending = prev.items.filter((m) => String(m.id).startsWith('tmp-'));
  return { ...fresh, items: [...fresh.items, ...pending], replying: answered ? null : prev.replying };
}
