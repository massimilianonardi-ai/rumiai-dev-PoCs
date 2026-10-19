// Evidence-grounded review of the actual human-controlled browser.
// The original viewport PNGs are embedded unchanged: no CSS scroll stitching,
// no replay, no MHTML normalization and no synthetic conversation content.
const escape=s=>String(s).replace(/[&<>"']/g,
  c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const finite=n=>typeof n==='number'&&Number.isFinite(n);

export function manualSourceSummary(manifest,frames,report) {
  const observed=manifest?.messageSignatures||{};
  const screens=manifest?.screenshotSignatures||{};
  const messages={};
  for(const role of ['user','assistant']){
    const ever=new Set(observed[role]||[]);
    const saved=new Set(screens[role]||[]);
    messages[role]={observed:ever.size,withScreenshot:saved.size,
      observedWithoutScreenshot:[...ever].filter(v=>!saved.has(v)).length};
  }
  const savedTops=frames.filter(f=>finite(f.scrollBefore?.top))
    .map(f=>f.scrollBefore.top);
  const minimumSavedTop=savedTops.length?Math.min(...savedTops):null;
  const sourceTopCaptured=frames.some(f=>
    f.scrollBefore?.max>0&&finite(f.scrollBefore.top)&&
    f.scrollBefore.top<=3);
  return {
    frames:frames.length,
    sourceTopCaptured,
    minimumSavedTop,
    stableFrames:frames.filter(f=>f.screenshotStable===true).length,
    messages,
    manualNetworkIncomplete:manifest?.incompleteByDesign!==false,
    replayTopCaptured:report?.topCoverage?.replayTopCaptured===true,
    replayMissing:report?.messageCoverage?.missingCounts?
      {user:report.messageCoverage.missingCounts.user||0,
        assistant:report.messageCoverage.missingCounts.assistant||0}:null,
    fullConversationVerified:false
  };
}
export function manualSourceReviewHtml(manifest,frames,report){
  const summary=manualSourceSummary(manifest,frames,report);
  const topFrame=frames.find(f=>f.scrollBefore?.max>0&&
    finite(f.scrollBefore.top)&&f.scrollBefore.top<=3);
  const role=r=>escape(r==='user'?'prompt utente':'risposte assistente');
  let html='<!doctype html><html lang="it"><head><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>ChatGPT — immagini della navigazione originale</title>'+
    '<style>body{font:15px/1.5 system-ui;max-width:1200px;margin:1em auto;'+
    'padding:0 1em}a{color:#07599c}section{padding:1.3em 0;'+
    'border-top:1px solid #888}img{display:block;max-width:100%;'+
    'height:auto;border:1px solid #aaa}.warning{border:1px solid #aaa;'+
    'padding:1em}small{color:#555}</style></head><body>'+
    '<h1>ChatGPT — schermate originali osservate manualmente</h1>'+
    '<p><a href="../comparison.html">Confronto MHTML (non allineato)</a> · '+
    '<a href="manual.html">Galleria originale</a></p>'+
    '<p class="warning">Questa è la sorgente visiva della navigazione umana.'+
    ' Non deriva dal replay e non allinea né modifica gli MHTML.'+
    ' Gli screenshot rimangono completi, in ordine cronologico.'+
    ' Eventuali movimenti rapidi possono aver lasciato intervalli non fotografati.'+
    ' Lo stato iniziale del thread è verificabile solo per i messaggi effettivamente visibili.'+
    '</p><p>Immagini originali: '+summary.frames+
    ' · schermate stabili: '+summary.stableFrames+
    ' · inizio fotografato: '+(summary.sourceTopCaptured?'sì':'NON verificato')+
    ' · inizio del replay: '+(summary.replayTopCaptured?'sì':'NON raggiunto')+
    '</p>';
  for(const r of ['user','assistant']){
    const x=summary.messages[r];
    html+='<p>'+role(r)+': '+x.observed+
      ' identità osservate nel DOM manuale, '+x.withScreenshot+
      ' identità presenti nei checkpoint fotografati, '+
      x.observedWithoutScreenshot+
      ' identità osservate senza screenshot associato.</p>';
  }
  if(summary.replayMissing){
    html+='<p class="warning">Messaggi manuali non ritrovati nei checkpoint del replay:'+
      ' '+summary.replayMissing.user+' prompt utente e '+
      summary.replayMissing.assistant+' risposte assistente.'+
      ' È una misura dei campioni osservati, non una certificazione della chat intera.</p>';
  }
  if(summary.manualNetworkIncomplete)
    html+='<p class="warning">Osservazione manuale incompleta per limiti o'+
      ' perdita di eventi di rete: le immagini salvate sono autentiche, ma'+
      ' la copertura non è certificata.</p>';
  if(topFrame)
    html+='<p><a href="#frame-'+escape(topFrame.id)+
      '">Vai alla schermata che ha raggiunto l’inizio</a></p>';
  for(const frame of frames){
    if(!/^[0-9]{4,6}$/.test(frame.id))continue;
    const top=frame.scrollBefore?.top;
    html+='<section id="frame-'+frame.id+'"><h2>Schermata '+frame.id+
      '</h2><small>Posizione osservata: '+
      (finite(top)?top:'non disponibile')+
      ' · immagine '+(frame.screenshotStable?'stabile':'potenzialmente instabile')+
      ' · origine: '+escape(frame.reason||'osservazione')+
      '</small><p><img loading="lazy" alt="Schermata originale '+frame.id+
      '" src="./'+frame.id+'.png"></p><a href="./'+frame.id+
      '.json">Metadati originali</a></section>';
  }
  return html+'</body></html>';
}
