// PoC 063: experimental browser viewport and pixel->Unicode-grapheme input.
// The DOM is a bounded projection only. PieceDocument and TextEditSelections
// remain the authoritative model; undo is an outer, in-memory action wrapper.
import {PieceDocument} from '../src/documents.mjs';
import {TextEditSelections} from '../src/text-edit-selections-probe.mjs';
import {projectViewport} from '../src/viewport-probe.mjs';
const $=id=>document.getElementById(id);
const HEIGHT=24,OVERSCAN=4,MAX_ROW_UNITS=512;
const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
let doc,editor,history=[],index=0,selectedRow=null;
let lastProjection=null,renderCount=0,maxMounted=0,lastHit=null;

function lineEnd(row){
  const from=doc.lineStart(row);
  const next=row+1<doc.lineCount?doc.lineStart(row+1):doc.length;
  let end=next;
  if(end>from&&doc.slice(end-1,end)==='\n')end--;
  if(end>from&&end<next&&doc.slice(end-1,end)==='\r')end--;
  return {from,end};
}
function message(text,error=false){
  $('message').textContent=text;
  $('message').style.color=error?'#b02028':'#31566c';
}
function reset(value){
  doc=new PieceDocument(value);
  editor=new TextEditSelections(doc);
  editor.setSelections([{start:0,end:0,forward:true}]);
  history=[];index=0;selectedRow=null;lastHit=null;
  $('vscroll').scrollTop=0;
  $('jump-row').max=doc.lineCount;
  render();
}
function sample(){
  reset([
    'a\t😀e\u0301漢Z',
    '👩‍👩‍👧‍👦 bandiera 🇮🇹',
    'emoji 👍🏽 e testo',
    'tab\tcolonna',
    'riga con CRLF',
    'ultima riga'
  ].join('\n'));
}
function large(){
  const lines=new Array(200000);
  for(let i=0;i<lines.length;i++)
    lines[i]=i%97===0?
      'line-'+String(i).padStart(6,'0')+'\t😀e\u0301漢Z':
      'line-'+String(i).padStart(6,'0')+' test ASCII';
  reset(lines.join('\n'));
  message('200.000 righe nel PieceDocument. Solo il viewport è nel DOM.');
}
function measuredOffsets(textElement,content){
  const textNode=textElement.firstChild;
  const segments=Array.from(segmenter.segment(content));
  const indices=segments.map(s=>s.index);
  indices.push(content.length);
  if(!indices.length)indices.push(0);
  const range=document.createRange();
  const origin=textElement.getBoundingClientRect().left;
  const xs=indices.map(n=>{
    if(!content.length)return 0;
    range.setStart(textNode,n);range.collapse(true);
    return range.getBoundingClientRect().left-origin;
  });
  // RTL/bidi reordering or collapsed glyph cluster boundaries can make
  // visual order ambiguous. This candidate explicitly refuses those cases.
  for(let i=1;i<xs.length;i++)
    if(!Number.isFinite(xs[i])||xs[i]+.25<xs[i-1]||
       (xs[i]-xs[i-1]<.25))
      return null;
  return {indices,xs};
}
function caretState(){
  return editor.getSelections()[0];
}
function makeRow(row){
  const line=document.createElement('div');
  line.className='v-row';
  line.dataset.row=String(row.row);
  const gutter=document.createElement('span');
  gutter.className='v-gutter';gutter.textContent=String(row.row+1);
  const value=document.createElement('span');value.className='v-text';
  value.append(document.createTextNode(row.content));
  line.append(gutter,value);
  if(row.truncated){
    const mark=document.createElement('span');
    mark.className='v-truncated';mark.textContent=' ⋯ [riga troncata]';
    line.append(mark);
  }
  if(selectedRow===row.row){
    line.classList.add('selected');
    const caret=caretState();
    const local=caret.start-row.start;
    if(!row.truncated&&local>=0&&local<=row.content.length){
      // Must measure only the currently selected visible row, not all rows.
      // This is one bounded Unicode line, not whole-document geometry.
      const slot=document.createElement('span');
      slot.className='v-caret';
      value.append(slot);
      // Font layout is not yet available until the row is attached. Position
      // the caret immediately after the fragment is attached in render().
      line.dataset.caret=String(local);
    }
  }
  return line;
}
function render(){
  const scroller=$('vscroll');
  const now=performance.now();
  const projection=projectViewport(doc,{
    scrollTop:scroller.scrollTop,height:scroller.clientHeight,
    rowHeight:HEIGHT,overscan:OVERSCAN,maxLineUnits:MAX_ROW_UNITS
  });
  lastProjection=projection;
  $('vspace').style.height=doc.lineCount*HEIGHT+'px';
  const windowEl=$('vrows');
  windowEl.style.transform='translateY('+(projection.first*HEIGHT)+'px)';
  const batch=document.createDocumentFragment();
  for(const r of projection.rows)batch.append(makeRow(r));
  windowEl.replaceChildren(batch);
  // DOM Range is used only for the selected row and only after attachment.
  for(const rowEl of windowEl.querySelectorAll('[data-caret]')){
    const textEl=rowEl.querySelector('.v-text');
    const textNode=textEl.firstChild;
    const local=Number(rowEl.dataset.caret);
    const range=document.createRange();
    range.setStart(textNode,local);range.collapse(true);
    const x=range.getBoundingClientRect().left-textEl.getBoundingClientRect().left;
    rowEl.querySelector('.v-caret').style.left=Math.max(0,x)+'px';
  }
  $('undo').disabled=index===0;$('redo').disabled=index===history.length;
  const span=projection.first+1+'–'+projection.last;
  const ms=(performance.now()-now).toFixed(2);
  renderCount++;maxMounted=Math.max(maxMounted,projection.rows.length);
  $('metrics').textContent=doc.lineCount.toLocaleString('it-IT')+
    ' righe | DOM: '+projection.rows.length+' righe ('+span+')'+
    ' | testo letto: '+projection.readUnits+' unità UTF-16'+
    ' | proiezione: '+ms+' ms (singola misura, non benchmark)';
  const caret=caretState();
  $('caret').textContent=selectedRow===null?'Nessun cursore selezionato.':
    'Riga '+(selectedRow+1)+', posizione UTF-16 '+caret.start+
    ', selezioni: '+editor.getSelections().length+', azioni: '+index+'/'+history.length;
}
function clickRow(event){
  const rowEl=event.target.closest('.v-row');
  if(!rowEl||event.target.closest('.v-gutter'))return;
  const row=Number(rowEl.dataset.row);
  const projection=lastProjection.rows.find(x=>x.row===row);
  if(!projection)return;
  if(projection.truncated){
    message('Riga troncata oltre 512 unità: click disabilitato per evitare offset errati.',true);
    return;
  }
  const el=rowEl.querySelector('.v-text');
  const offsets=measuredOffsets(el,projection.content);
  if(!offsets){
    message('Layout Unicode/bidirezionale ambiguo: nessun offset modificato.',true);
    return;
  }
  const x=event.clientX-el.getBoundingClientRect().left;
  let best=0;
  for(let i=1;i<offsets.xs.length;i++)
    if(Math.abs(offsets.xs[i]-x)<Math.abs(offsets.xs[best]-x))best=i;
  const pos=projection.start+offsets.indices[best];
  selectedRow=row;
  editor.setSelections([{start:pos,end:pos,forward:true}]);
  lastHit={row,offset:pos,local:offsets.indices[best],
    snapped:Math.abs(offsets.xs[best]-x)>1,
    graphemeBoundaries:offsets.indices.slice()};
  render();
  message('Posizione risolta da layout DOM: riga '+(row+1)+
    ', offset UTF-16 '+pos+(lastHit.snapped?' (al confine del grafema più vicino)':''));
}
function action(value,range=null){
  if(selectedRow===null)throw Error('Seleziona prima una riga nel viewport.');
  if(typeof value!=='string'||value.length>4096||/[\r\n]/.test(value))
    throw Error('Inserimento di una sola riga, massimo 4096 unità UTF-16.');
  const before=editor.getSelections();
  if(range)editor.setSelections([range]);
  const change=editor.replace(value);
  if(index<history.length)history.length=index;
  history.push({value,change,row:selectedRow});index++;
  render();
  message('Modifica nel PieceDocument. Una azione = un undo.');
}
function erase(){
  const caret=caretState();
  if(selectedRow===null)throw Error('Seleziona prima una riga nel viewport.');
  const {from,end}=lineEnd(selectedRow);
  if(caret.start<=from||caret.start>end)return;
  const prefix=doc.slice(from,caret.start);
  let previous=from;
  for(const part of segmenter.segment(prefix))previous=from+part.index;
  action('',{start:previous,end:caret.start,forward:true});
}
function undo(){
  if(!index)return;
  const entry=history[--index];
  for(let i=entry.change.changes.length-1;i>=0;i--){
    const c=entry.change.changes[i];
    doc.replace(c.inverseStart,c.inverseEnd,c.removed);
  }
  editor.setSelections(entry.change.before);
  selectedRow=entry.row;render();
  message('Una azione annullata.');
}
function redo(){
  if(index>=history.length)return;
  const entry=history[index++];
  editor.setSelections(entry.change.before);
  editor.replace(entry.value);
  selectedRow=entry.row;render();
  message('Una azione ripristinata.');
}
function safely(fn){
  try{fn();}catch(e){message(e.message||String(e),true);}
}
$('vrows').addEventListener('click',clickRow);
$('vscroll').addEventListener('scroll',render,{passive:true});
$('small').addEventListener('click',sample);
$('large').addEventListener('click',large);
$('jump').addEventListener('click',()=>safely(()=>{
  const str=$('jump-row').value,n=Number(str);
  if(!str.trim()||!Number.isSafeInteger(n)||n<1||n>doc.lineCount)
    throw Error('Riga inesistente.');
  $('vscroll').scrollTop=(n-1)*HEIGHT;
  render();
}));
$('insert').addEventListener('click',()=>safely(()=>action($('insert-text').value)));
$('erase').addEventListener('click',()=>safely(erase));
$('undo').addEventListener('click',()=>safely(undo));
$('redo').addEventListener('click',()=>safely(redo));
window.__viewportProbe={
  snapshot:()=>({
    documentRows:doc.lineCount,documentUnits:doc.length,
    first:lastProjection.first,last:lastProjection.last,
    mounted:document.querySelectorAll('.v-row').length,
    projectedReadUnits:lastProjection.readUnits,
    maxMounted,renderCount,
    caret:caretState(),selectedRow,lastHit,
    visible:lastProjection.rows.map(r=>({row:r.row,content:r.content,truncated:r.truncated})),
    historyIndex:index,historyLength:history.length
  })
};
sample();
document.documentElement.dataset.viewportReady='true';
