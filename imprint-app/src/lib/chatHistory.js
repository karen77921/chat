/**
 * Read one conversation in bounded pages. The relay history endpoint advances
 * with the numeric message id passed as `since`; the UI still receives one
 * continuous list and never creates or switches sessions.
 */
export async function collectHistory(fetchPage, { pageSize = 500, maxPages = 40 } = {}) {
  const byId = new Map();
  let since = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchPage({ since, limit: pageSize });
    const rows = Array.isArray(result?.messages) ? result.messages : [];
    for (const message of rows) byId.set(String(message.id), message);

    if (rows.length < pageSize) break;
    const lastId = Number(rows.at(-1)?.id);
    if (!Number.isFinite(lastId) || lastId <= since) break;
    since = lastId;
  }

  return [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id));
}
