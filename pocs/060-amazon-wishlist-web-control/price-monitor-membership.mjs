/**
 * Amazon is the source of monitored list membership; the Sheet supplies
 * historical price/target state, not the ASIN inventory.
 *
 * Inactive Sheet rows remain untouched as history. A newly seen verified
 * product is appended by the cell planner; unverified items are never written.
 */
export function reconcileMonitorLists(snapshotLists, verifiedWishlistLists) {
  if (!Array.isArray(snapshotLists) || !(verifiedWishlistLists instanceof Map)) {
    throw new TypeError('invalid sheet or wishlist membership');
  }
  return snapshotLists.map(list => {
    const observed = verifiedWishlistLists.get(list.name);
    if (!observed) return list; // failed wishlist: retain attempted count for failure reporting
    const existing = new Map(list.rows.map(row => [row.asin, row]));
    const rows = [];
    let nextRow = Math.max(list.lastRow || 1, ...list.rows.map(r => r.sheetRow || 1));
    const lastFormulaRow = [...list.rows].reverse().find(r => r.sheetRow >= 2)?.sheetRow;
    for (const item of observed) {
      if (!item.asin) throw new TypeError('wishlist item missing ASIN');
      const historical = existing.get(item.asin);
      if (historical) {
        rows.push(historical);
      } else {
        rows.push({ asin: item.asin, sheetRow: ++nextRow, isNew: true,
          formulaFromRow: lastFormulaRow || null,
          description: item.description || '',
          url: item.url || 'https://www.amazon.it/dp/' + item.asin,
          currentCents: null, minimumCents: null,
          targetCents: null, targetNotifiedCents: null });
      }
    }
    return { ...list, rows };
  });
}
