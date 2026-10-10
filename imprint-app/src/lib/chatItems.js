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
