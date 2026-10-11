import { evaluate } from './price-monitor.mjs';
import { readMonitorLists, planMonitorCells } from './price-monitor-sheet-adapter.mjs';
import { toPriceObservations } from './wishlist-price-adapter.mjs';
import { reconcileMonitorLists } from './price-monitor-membership.mjs';
import { alertEmail, errorEmail } from './price-monitor-reports.mjs';

/**
 * Coordinator with explicit injected I/O. No automatic credentials, background
 * process or Google/Amazon access is embedded in the monitoring decisions.
 *
 * io: readTabs(), extractWishlist(url), sendEmail({subject,html}),
 *     applyCells([{sheet,row,column,value}]).
 * "sendEmail" must confirm provider success with {success:true}.
 */
export async function runPriceWatch({ sources, io, checkedAt = new Date().toISOString() }) {
  if (!Array.isArray(sources) || !sources.length ||
      !io || ['readTabs','extractWishlist','sendEmail','applyCells']
        .some(method => typeof io[method] !== 'function')) {
    throw new TypeError('sources and complete I/O adapter are required');
  }
  const lists = readMonitorLists(await io.readTabs());
  const names = new Set(lists.map(l => l.name));
  if (names.size !== lists.length || sources.length !== names.size ||
      sources.some(s => !names.has(s.name) || !s.wishlistUrl) ||
      new Set(sources.map(s => s.name)).size !== sources.length) {
    throw new Error('each monitored sheet must have exactly one Amazon wishlist URL');
  }
  const observations = [];
  const verifiedLists = new Map();
  const problems = [];
  let accessFailure = false, unreliable = false;
  for (const source of sources) {
    try {
      const result = toPriceObservations(await io.extractWishlist(source.wishlistUrl));
      accessFailure ||= result.accessFailure;
      unreliable ||= result.unreliable;
      if (result.accessFailure || result.unreliable) {
        problems.push(source.name + ': accesso bloccato, elenco incompleto o ambiguo');
      } else {
        verifiedLists.set(source.name, result.observations);
        observations.push(...result.observations.map(o => ({...o, list: source.name})));
      }
    } catch (error) {
      accessFailure = true;
      problems.push(source.name + ': ' + String(error.message || error));
    }
  }
  const currentMembership = reconcileMonitorLists(lists, verifiedLists);
  const decision = evaluate({lists: currentMembership, observations, accessFailure, unreliable, checkedAt});
  const delivery = { errorSent: false, alertSent: false, errors: [] };
  async function deliver(mail, kind) {
    if (!mail) return false;
    try {
      const receipt = await io.sendEmail(mail);
      if (receipt?.success !== true) throw new Error('email provider did not confirm success');
      return true;
    } catch (error) {
      delivery.errors.push(kind + ': ' + String(error.message || error));
      return false;
    }
  }
  delivery.errorSent = await deliver(errorEmail(decision,checkedAt,problems),'error');
  delivery.alertSent = await deliver(alertEmail(decision,checkedAt),'alert');
  const cells = planMonitorCells(currentMembership,decision,{alertEmailSucceeded:delivery.alertSent});
  let sheetUpdated = false;
  try {
    if (cells.length) await io.applyCells(cells);
    sheetUpdated = true;
  } catch (error) {
    delivery.errors.push('sheet: ' + String(error.message || error));
  }
  return { decision, problems, delivery, sheetUpdated, plannedCellCount: cells.length };
}
