// Write many journal pages in a few database calls instead of one call per page.
// Each call is a server round trip and a broadcast to every connected client, so a vault
// re-import that changed 200 notes used to send 200 updates; grouped, it sends a handful.

/** Updates per call. Large enough to cut the round trips, small enough to keep each broadcast light. */
export const BATCH_SIZE = 40;

/**
 * Group page updates by their journal entry and cut each group into chunks (pure; no Foundry globals).
 * @param {{parentId: string, update: object}[]} items  `update` must carry the page's `_id`
 * @param {number} size
 * @returns {{parentId: string, updates: object[]}[]}
 */
export function groupByParent(items, size = BATCH_SIZE) {
  const byParent = new Map();
  for ( const { parentId, update } of items ) {
    if ( !parentId || !update?._id ) continue;
    if ( !byParent.has(parentId) ) byParent.set(parentId, []);
    byParent.get(parentId).push(update);
  }
  const out = [];
  const step = Math.max(1, Math.floor(size) || BATCH_SIZE);
  for ( const [parentId, updates] of byParent ) {
    for ( let i = 0; i < updates.length; i += step ) out.push({ parentId, updates: updates.slice(i, i + step) });
  }
  return out;
}

/**
 * Update journal pages in batches.
 * @param {{page: JournalEntryPage, data: object}[]} list
 * @param {object} [options]  passed to updateEmbeddedDocuments (e.g. {diff: false})
 * @param {(done: number, total: number) => void} [progress]
 * @returns {Promise<number>} how many pages were sent
 */
export async function updatePages(list, options = {}, progress = null) {
  const parents = new Map();
  const items = [];
  for ( const { page, data } of list ) {
    const parent = page?.parent;
    if ( !parent ) continue;
    parents.set(parent.id, parent);
    items.push({ parentId: parent.id, update: { _id: page.id, ...data } });
  }
  let done = 0;
  for ( const { parentId, updates } of groupByParent(items) ) {
    await parents.get(parentId).updateEmbeddedDocuments("JournalEntryPage", updates, options);
    done += updates.length;
    progress?.(done, items.length);
  }
  return done;
}
