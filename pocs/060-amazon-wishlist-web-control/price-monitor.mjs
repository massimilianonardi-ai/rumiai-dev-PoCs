/**
 * Pure monitoring decisions. All money is integer euro cents.
 * The caller owns persistence and notification delivery.
 * A successful email acknowledgement is required before committing targetNotifiedCents.
 */
const valid = n => Number.isSafeInteger(n) && n >= 0;
const optional = n => n == null || valid(n);
export function evaluate({ lists, observations, accessFailure = false, unreliable = false, checkedAt }) {
  if (!Array.isArray(lists) || !Array.isArray(observations)) throw new TypeError('lists and observations must be arrays');
  if (typeof checkedAt !== 'string' || !checkedAt) throw new TypeError('checkedAt is required');
  const byAsin = new Map();
  for (const observation of observations) {
    if (typeof observation.asin !== 'string' || !valid(observation.priceCents)) continue;
    if (observation.verified !== true) continue;
    if (byAsin.has(observation.asin)) {
      // Conflicting prices are not sufficiently reliable.
      if (byAsin.get(observation.asin) !== observation.priceCents) byAsin.set(observation.asin, null);
    } else byAsin.set(observation.asin, observation.priceCents);
  }
  const changes = [], alerts = [], coverage = [];
  for (const list of lists) {
    if (typeof list.name !== 'string' || !Array.isArray(list.rows)) throw new TypeError('invalid list');
    let attempted = 0, verified = 0;
    for (const row of list.rows) {
      if (!row.asin) continue;
      attempted++;
      for (const field of ['currentCents','minimumCents','targetCents','targetNotifiedCents']) {
        if (!optional(row[field])) throw new TypeError('invalid ' + field);
      }
      const current = byAsin.get(row.asin);
      if (!valid(current)) continue;
      verified++;
      const previous = row.currentCents ?? null;
      const priorMinimum = row.minimumCents ?? null;
      const minimum = priorMinimum === null ? current : Math.min(current, priorMinimum);
      const difference = previous === null ? null : current - previous;
      const target = row.targetCents ?? null;
      const resetNotification = target === null || current > target;
      const targetReached = !resetNotification && row.targetNotifiedCents !== target;
      const pctDrop = previous !== null && previous > 0 ? (previous - current) / previous : 0;
      const dropRelative = difference !== null && -difference >= 200 && pctDrop >= 0.07;
      const dropAbsolute = difference !== null && -difference >= 1000;
      const newMinimum = priorMinimum !== null && priorMinimum > 0 &&
        priorMinimum - current >= 100 && (priorMinimum - current) / priorMinimum >= 0.02;
      const reasons = [
        ...(targetReached ? ['target'] : []),
        ...(dropRelative ? ['drop-7-percent-and-2-eur'] : []),
        ...(dropAbsolute ? ['drop-10-eur'] : []),
        ...(newMinimum ? ['new-minimum'] : [])
      ];
      const identity = { list: list.name, asin: row.asin };
      changes.push({ ...identity, currentCents: current, differenceCents: difference,
        minimumCents: minimum, checkedAt,
        ...(resetNotification ? { targetNotifiedCents: null } : {}) });
      if (reasons.length) alerts.push({ ...identity, description: row.description ?? '',
        url: row.url ?? '', previousCents: previous, currentCents: current,
        differenceCents: difference, priorMinimumCents: priorMinimum,
        minimumCents: minimum, targetCents: target, reasons,
        ...(targetReached ? { notificationAcknowledgement: { ...identity, targetNotifiedCents: target } } : {}) });
    }
    coverage.push({ list: list.name, attempted, verified, unverified: attempted - verified });
  }
  const attempted = coverage.reduce((sum, c) => sum + c.attempted, 0);
  const verified = coverage.reduce((sum, c) => sum + c.verified, 0);
  const failed = Boolean(accessFailure || unreliable || attempted === 0 ||
    verified * 2 < attempted || coverage.some(c => c.attempted > 0 && c.verified === 0));
  return { coverage, attempted, verified, failed, changes, alerts,
    errorNotificationRequired: failed, alertNotificationRequired: alerts.length > 0 };
}
