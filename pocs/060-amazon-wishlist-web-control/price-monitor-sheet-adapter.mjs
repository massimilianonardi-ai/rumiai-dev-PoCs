/**
 * Pure bridge to the existing 12-column "Amazon Price Monitor" workbook.
 * Produces a cell-level plan; caller owns Google Sheets I/O and Gmail delivery.
 * Columns G/H contain user-owned formulas and must never be written here.
 */
const HEADERS = [
  'ASIN', 'Descrizione', 'Prezzo attuale (€)',
  'Differenza dal precedente (€)', 'Prezzo minimo monitorato (€)',
  'Target (€)', 'Scostamento (€)', 'Stato', 'Nota Amazon',
  'URL Amazon', 'Ultimo controllo', 'Target notificato (€)'
];

function money(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    const cents = Math.round(value * 100);
    if (!Number.isSafeInteger(cents) || cents < 0) throw new TypeError('invalid amount');
    return cents;
  }
  const text = String(value).trim().replace(/\u00a0/g, ' ').replace(/[+€\s]/g, '');
  if (!text) return null;
  const parsed = /^-?\d{1,3}(?:\.\d{3})*,\d{1,2}$/.test(text)
    ? text.replace(/\./g, '').replace(',', '.')
    : /^\d+(?:,\d{1,2})?$/.test(text) ? text.replace(',', '.')
    : /^\d+(?:\.\d{1,2})?$/.test(text) ? text : null;
  if (parsed == null) throw new TypeError('unrecognized euro amount');
  const cents = Math.round(Number(parsed) * 100);
  if (!Number.isSafeInteger(cents) || cents < 0) throw new TypeError('invalid euro amount');
  return cents;
}

export function readMonitorLists(tabs) {
  if (!Array.isArray(tabs) || !tabs.length) throw new TypeError('tabs must be a nonempty array');
  return tabs.map(({ name, values }) => {
    if (typeof name !== 'string' || !name || !Array.isArray(values) ||
        !Array.isArray(values[0]) || HEADERS.some((header, i) => values[0][i] !== header)) {
      throw new TypeError('unsupported monitor sheet schema: ' + String(name));
    }
    const known = new Set();
    const rows = [];
    values.slice(1).forEach((cells, position) => {
      if (!Array.isArray(cells) || !cells[0]) return;
      const asin = String(cells[0]).trim().toUpperCase();
      if (!/^[A-Z0-9]{10}$/.test(asin) || known.has(asin)) {
        throw new TypeError('invalid or repeated ASIN in ' + name + ' row ' + (position + 2));
      }
      known.add(asin);
      rows.push({
        asin, sheetRow: position + 2,
        description: String(cells[1] || ''),
        currentCents: money(cells[2]),
        minimumCents: money(cells[4]),
        targetCents: money(cells[5]),
        targetNotifiedCents: money(cells[11]),
        url: String(cells[9] || '')
      });
    });
    return { name, rows, lastRow: values.length };
  });
}

function put(cells, sheet, row, column, value) {
  cells.push({ sheet, row, column, value: value === null ? null : value });
}

export function planMonitorCells(lists, decision, { alertEmailSucceeded = false } = {}) {
  if (!Array.isArray(lists) || !decision || !Array.isArray(decision.changes) ||
      !Array.isArray(decision.alerts)) throw new TypeError('invalid monitor decision');
  const originals = new Map();
  for (const list of lists) {
    for (const row of list.rows) {
      originals.set(JSON.stringify([list.name, row.sheetRow]), row);
    }
  }
  const cells = [];
  for (const change of decision.changes) {
    const original = originals.get(JSON.stringify([change.list, change.sheetRow]));
    if (!original || original.asin !== change.asin) {
      throw new Error('monitor change does not identify a unique source sheet row');
    }
    const amount = cents => cents === null ? null : cents / 100;
    if (original.isNew) {
      put(cells, change.list, change.sheetRow, 'A', original.asin);
      put(cells, change.list, change.sheetRow, 'B', original.description);
      put(cells, change.list, change.sheetRow, 'J', original.url);
      // Copy formulas into the newly appended row; never alter existing formulas.
      if (original.formulaFromRow) {
        cells.push({ sheet: change.list, row: change.sheetRow, column: 'G',
          copyFormulaFromRow: original.formulaFromRow });
        cells.push({ sheet: change.list, row: change.sheetRow, column: 'H',
          copyFormulaFromRow: original.formulaFromRow });
      }
    }
    put(cells, change.list, change.sheetRow, 'C', amount(change.currentCents));
    put(cells, change.list, change.sheetRow, 'D', amount(change.differenceCents));
    put(cells, change.list, change.sheetRow, 'E', amount(change.minimumCents));
    put(cells, change.list, change.sheetRow, 'K', change.checkedAt);
    if ('targetNotifiedCents' in change) {
      put(cells, change.list, change.sheetRow, 'L', amount(change.targetNotifiedCents));
    }
  }
  // Never acknowledge a target alert until Gmail confirms the summary was sent.
  if (alertEmailSucceeded) {
    for (const alert of decision.alerts) {
      if (!alert.notificationAcknowledgement) continue;
      const ack = alert.notificationAcknowledgement;
      const original = originals.get(JSON.stringify([ack.list, ack.sheetRow]));
      if (!original || original.asin !== ack.asin) throw new Error('unmatched notification');
      put(cells, ack.list, ack.sheetRow, 'L', ack.targetNotifiedCents / 100);
    }
  }
  return cells;
}
