/** Gmail-ready HTML reports; rendering has no network or delivery side effects. */
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
})[c]);
const eur = cents => cents == null ? '—' : new Intl.NumberFormat('it-IT',
  { style:'currency', currency:'EUR' }).format(cents / 100);
const label = {
  target: 'Target raggiunto',
  'drop-7-percent-and-2-eur': 'Ribasso di almeno 7% e 2 EUR',
  'drop-10-eur': 'Ribasso di almeno 10 EUR',
  'new-minimum': 'Nuovo minimo storico significativo'
};
export function alertEmail(decision, checkedAt) {
  if (!decision.alertNotificationRequired) return null;
  const rows = decision.alerts.map(a => {
    const href = new URL(/^https:\/\/(?:www\.)?amazon\.it\/dp\/[A-Z0-9]{10}/i.test(a.url)
      ? a.url : 'https://www.amazon.it/dp/' + encodeURIComponent(a.asin));
    const changePercent = a.differenceCents != null && a.previousCents > 0
      ? (100 * a.differenceCents / a.previousCents).toFixed(2) + '%'
      : '—';
    return '<li><strong>' + escape(a.list) + ' — ' + escape(a.description) +
      '</strong> (ASIN ' + escape(a.asin) + ')' +
      '<p>Precedente: ' + escape(eur(a.previousCents)) +
      '; attuale: ' + escape(eur(a.currentCents)) +
      '; differenza: ' + escape(eur(a.differenceCents)) + ' (' + escape(changePercent) + ')' +
      '; minimo precedente: ' + escape(eur(a.priorMinimumCents)) +
      '; minimo aggiornato: ' + escape(eur(a.minimumCents)) +
      '; target: ' + escape(eur(a.targetCents)) + '</p>' +
      '<p>Motivi: ' + escape(a.reasons.map(r => label[r] || r).join(', ')) +
      '</p><p><a href="' + escape(href.href) + '">Apri prodotto Amazon</a>' +
      ' — URL: ' + escape(href.href) + '</p></li>';
  });
  return { subject: 'Amazon Price Monitor — alert prezzi',
    html: '<html><body><h2>Amazon Price Monitor</h2><p>Controllo: ' +
      escape(checkedAt) + '</p><ol>' + rows.join('') + '</ol></body></html>' };
}

export function errorEmail(decision, checkedAt, problems = []) {
  if (!decision.errorNotificationRequired) return null;
  const rows = decision.coverage.map(c => '<li>' + escape(c.list) +
    ': tentati ' + c.attempted + ', verificati ' + c.verified +
    ', non verificati ' + c.unverified + '</li>');
  return { subject: 'Amazon Price Monitor — prezzi non accessibili',
    html: '<html><body><h2>Controllo prezzi non affidabile</h2><p>Data e ora: ' +
      escape(checkedAt) + '</p><p>Prezzi verificati: ' + decision.verified +
      ' di ' + decision.attempted + '.</p><ul>' + rows.join('') +
      '</ul><p>Problemi: ' + escape(problems.join('; ') || 'copertura insufficiente') +
      '</p><p>Le celle dei prodotti senza prezzo verificato sono rimaste invariate.</p>' +
      '</body></html>' };
}
