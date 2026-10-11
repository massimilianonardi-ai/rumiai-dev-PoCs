/**
 * Convert a *complete* Amazon wishlist observation to price-monitor input.
 * The browser extractor owns DOM interpretation; this adapter never guesses prices.
 */
export function toPriceObservations(wishlist) {
  if (!wishlist || typeof wishlist !== 'object' || !Array.isArray(wishlist.items)) {
    throw new TypeError('wishlist must contain extracted items');
  }
  const accessible = wishlist.complete === true && wishlist.blocked === false &&
    wishlist.items.length > 0 && wishlist.itemCount === wishlist.items.length;
  if (!accessible) {
    return { accessFailure: true, unreliable: true, observations: [],
      attempted: wishlist.items.length, verified: 0 };
  }
  const observations = [];
  const seen = new Set();
  for (const item of wishlist.items) {
    const asin = String(item.asin || '').toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin) || seen.has(asin)) {
      return { accessFailure: false, unreliable: true, observations: [],
        attempted: wishlist.items.length, verified: 0 };
    }
    seen.add(asin);
    const price = item.price;
    const valid = price?.verified === true && price.currency === 'EUR' &&
      Number.isSafeInteger(price.cents) && price.cents > 0;
    observations.push({ asin, verified: valid,
      ...(valid ? { priceCents: price.cents } : {}),
      reason: valid ? null : (price?.reason || 'price-unverified'),
      purchaseAction: item.purchaseAction || 'unknown',
      description: String(item.title || ''), url: String(item.url || '') });
  }
  return { accessFailure: false, unreliable: false, observations,
    attempted: observations.length, verified: observations.filter(x => x.verified).length };
}
