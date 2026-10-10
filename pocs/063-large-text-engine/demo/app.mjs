// PoC 063 hands-on browser adapter. No framework, persistence, product API or
// DOM data model. Limited textarea projection is deliberately NOT a large-file renderer.
import {PieceDocument} from '../src/documents.mjs';
import {TextEditSelections} from '../src/text-edit-selections-probe.mjs';
import {planColumnPaste} from '../src/column-edit-probe.mjs';
import {probeRectangles} from '../src/visual-column-probe.mjs';

const $=id=>document.getElementById(id);
const initial='aa\nb';
const MAX_UNITS=256*1024;
const graphemes=new Intl.Segmenter(undefined,{granularity:'grapheme'});
let doc,edit,history=[],position=0,composing=false,armed=false,rendering=false;
let rectMode=false,drag=null,rectPreview=null,consumedRectMouse=false;
const text=()=>doc.slice(0,doc.length);

function notice(message,error=false){
  $('message').textContent=message;
  $('message').style.color=error?'#a42227':'#1c5876';
}
function guard(fn){
  try{fn();}
  catch(error){notice(error?.message||String(error),true);render();}
}
function render(){
  rendering=true;
  const oldScrollTop=$('editor').scrollTop,oldScrollLeft=$('editor').scrollLeft;
  $('editor').value=text();
  const primary=edit.getSelections()[0];
  if(primary)$('editor').setSelectionRange(primary.start,primary.end,
    primary.forward?'forward':'backward');
  $('editor').scrollTop=oldScrollTop;$('editor').scrollLeft=oldScrollLeft;
  $('undo').disabled=position===0;$('redo').disabled=position===history.length;
  $('stats').textContent=doc.lineCount+' righe · '+doc.length+
    ' unità UTF-16 · '+edit.getSelections().length+' selezione/i · storico '+position+'/'+history.length;
  $('selection-details').textContent=edit.getSelections().map((s,i)=>
    (i+1)+'. '+s.start+' … '+s.end+(s.forward?' →':' ←')).join('\n');
  rendering=false;
}
function reset(value=initial){
  if(value.length>MAX_UNITS)throw Error('Documento oltre il limite della demo (256 KiB).');
  doc=new PieceDocument(value);edit=new TextEditSelections(doc);
  edit.setSelections([{start:0,end:0,forward:true}]);
  history=[];position=0;armed=false;$('column-arm').textContent='Arma incolla da clipboard';
  clearRect();
  $('row-from').value='1';$('row-to').value='2';
  $('col-from').value='2';$('col-to').value='2';
  render();notice('Esempio pronto. Tutte le modifiche restano locali in memoria.');
}
function chooseNative(){
  if(rendering||composing)return;
  const f=$('editor');
  edit.setSelections([{start:f.selectionStart,end:f.selectionEnd,
    forward:f.selectionDirection!=='backward'}]);
  renderStatusOnly();
}
function renderStatusOnly(){
  $('stats').textContent=doc.lineCount+' righe · '+doc.length+
    ' unità UTF-16 · '+edit.getSelections().length+' selezione/i · storico '+position+'/'+history.length;
  $('selection-details').textContent=edit.getSelections().map((s,i)=>
    (i+1)+'. '+s.start+' … '+s.end+(s.forward?' →':' ←')).join('\n');
}
function command(value,prepared=null){
  const previous=edit.getSelections();
  try{
    if(prepared)edit.setSelections(prepared);
    const change=edit.replace(value);
    if(doc.length>MAX_UNITS){
      // The demo refuses oversized edits before this stage through preflight.
      throw Error('Modifica oltre il limite della demo.');
    }
    if(position<history.length)history.length=position;
    history.push({value,change,previous});position++;
    clearRect();
    render();notice('Azione '+position+' registrata (undo separato).');
  }catch(error){
    // Selection validation must not leave the former canonical cursors lost.
    // A valid base-store mutation is not transactionally rolled back here.
    if(edit.length===doc.length)edit.setSelections(previous);
    throw error;
  }
}
function checkSize(valueOrTexts,prepared=null){
  const ranges=prepared||edit.getSelections();
  const values=typeof valueOrTexts==='string'?
    Array.from({length:ranges.length},()=>valueOrTexts):valueOrTexts;
  const predicted=doc.length+ranges.reduce((n,r,i)=>
    n+values[i].length-(r.end-r.start),0);
  if(predicted>MAX_UNITS)throw Error('Oltre 256 KiB: modifica non eseguita nella demo.');
}
function submit(value,prepared=null){
  checkSize(value,prepared);
  command(value,prepared);
}
function undo(){
  if(!position)return;
  const entry=history[--position];
  for(let i=entry.change.changes.length-1;i>=0;i--){
    const c=entry.change.changes[i];
    doc.replace(c.inverseStart,c.inverseEnd,c.removed);
  }
  edit.setSelections(entry.previous);
  clearRect();render();notice('Annullata una sola azione.');
}
function redo(){
  if(position===history.length)return;
  const entry=history[position];
  edit.setSelections(entry.change.before);
  const same=edit.replace(entry.value);
  if(same.changes.length!==entry.change.changes.length)throw Error('Redo non coerente.');
  position++;clearRect();render();notice('Ripristinata una sola azione.');
}
function previousBoundary(at){
  if(at===0)return 0;
  let boundary=0;
  for(const g of graphemes.segment(doc.slice(0,at)))boundary=g.index;
  return boundary;
}
function nextBoundary(at){
  if(at===doc.length)return at;
  const first=graphemes.segment(doc.slice(at,doc.length))[Symbol.iterator]().next().value;
  return at+first.segment.length;
}
function remove(forward){
  const previous=edit.getSelections();
  const ranges=previous.map(s=>{
    if(s.start!==s.end)return s;
    return forward?{...s,end:nextBoundary(s.end)}:{...s,start:previousBoundary(s.start)};
  });
  if(ranges.every(r=>r.start===r.end))return;
  submit('',ranges);
}
function widthOf(g){
  // View-supplied experiment; not a normative pixel/font width algorithm.
  return /[\u3400-\u9fff\uf900-\ufaff]/u.test(g)||/\p{Extended_Pictographic}/u.test(g)?2:1;
}
function rectangle(){
  const num=(id,min)=>{const s=$(id).value;const n=Number(s);
    if(!s.trim()||!Number.isSafeInteger(n)||n<min)throw Error('Numero non valido: '+id);
    return n;};
  return {lineFrom:num('row-from',1)-1,lineTo:num('row-to',1)-1,
    columnFrom:num('col-from',0),columnTo:num('col-to',0)};
}
function columnInsert(data){
  const plan=planColumnPaste(doc,{rectangle:rectangle(),clipboard:data,
    materializeRows:true,tabSize:4,widthOf});
  if(plan.noop){notice('Nessun testo da inserire.');return;}
  submit(plan.texts,plan.selections);
  notice('Incolla a colonne: '+plan.sourceRows+' righe sorgente, '+
    plan.materializedRows+' righe aggiunte oltre EOF; una sola azione.');
}
function offsetOf(row,column){
  if(row<0||row>=doc.lineCount)throw Error('Riga fuori documento.');
  const begin=doc.lineStart(row);
  const end=row+1<doc.lineCount?doc.lineStart(row+1):doc.length;
  const visible=doc.slice(begin,end).replace(/\r?\n$/,'');
  if(column>visible.length)throw Error('Colonna oltre la lunghezza della riga.');
  if(column!==visible.length && column!==0 &&
     !Array.from(graphemes.segment(visible)).some(g=>g.index===column))
    throw Error('Il cursore cadrebbe all’interno di un grafema Unicode.');
  return begin+column;
}


// Browser-only pointer geometry adapter. This is explicitly NOT text storage,
// generic Unicode hit-testing, or a direct edit of TextEditSelections.
// Column paste will resolve the rectangle to true offsets through the planner.
function rectangleMetrics(){
  const f=$('editor'),style=getComputedStyle(f);
  const context=document.createElement('canvas').getContext('2d');
  context.font=style.fontSize+' '+style.fontFamily;
  const cell=context.measureText('0').width;
  const lineHeight=Number.parseFloat(style.lineHeight);
  if(!(cell>0)||!(lineHeight>0))throw Error('Metrica monospaziata non disponibile.');
  return {f,box:f.getBoundingClientRect(),cell,lineHeight,
    x0:Number.parseFloat(style.borderLeftWidth)+Number.parseFloat(style.paddingLeft),
    y0:Number.parseFloat(style.borderTopWidth)+Number.parseFloat(style.paddingTop)};
}
function pointerColumnRow(event,metric){
  const col=Math.round((event.clientX-metric.box.left-metric.x0+
    metric.f.scrollLeft)/metric.cell);
  const row=Math.floor((event.clientY-metric.box.top-metric.y0+
    metric.f.scrollTop)/metric.lineHeight);
  // Do not permit accidental enormous virtual padding, or an out-of-doc row.
  return {line:Math.max(0,Math.min(doc.lineCount-1,row)),
    column:Math.max(0,Math.min(1024,col))};
}
function drawRect(){
  const overlay=$('rect-overlay');
  overlay.replaceChildren();
  if(!rectPreview)return;
  const {f,cell,lineHeight,x0,y0}=rectangleMetrics();
  const r=rectPreview;
  const first=Math.min(r.lineFrom,r.lineTo),last=Math.max(r.lineFrom,r.lineTo);
  const left=Math.min(r.columnFrom,r.columnTo),right=Math.max(r.columnFrom,r.columnTo);
  const topVisible=Math.max(first,Math.floor((f.scrollTop-y0)/lineHeight)-1);
  const lastVisible=Math.min(last,
    Math.ceil((f.scrollTop+f.clientHeight-y0)/lineHeight)+1);
  const fragment=document.createDocumentFragment();
  for(let row=topVisible;row<=lastVisible;row++){
    const band=document.createElement('div');
    band.className='rect-band';
    band.style.left=(x0+left*cell-f.scrollLeft)+'px';
    band.style.top=(y0+row*lineHeight-f.scrollTop)+'px';
    band.style.width=Math.max(2,(right-left)*cell)+'px';
    band.style.height=lineHeight+'px';
    fragment.append(band);
  }
  overlay.append(fragment);
}
function clearRect(){
  rectPreview=null;
  $('rect-overlay').replaceChildren();
  $('rect-status').textContent=rectMode?
    'Trascina nell’editor per selezionare un rettangolo.':
    'Modalità mouse disattivata.';
}
function previewRectangle(from,to){
  rectPreview={lineFrom:from.line,lineTo:to.line,
    columnFrom:from.column,columnTo:to.column};
  drawRect();
}
function asciiPointerCompatible(r){
  const start=Math.min(r.lineFrom,r.lineTo),end=Math.max(r.lineFrom,r.lineTo);
  for(let row=start;row<=end;row++){
    const from=doc.lineStart(row);
    const to=row+1<doc.lineCount?doc.lineStart(row+1):doc.length;
    const line=doc.slice(from,to).replace(/\r?\n$/,'');
    if(/[^\x09\x20-\x7e]/.test(line))return false;
  }
  return true;
}
function finalizeRectangle(){
  const r=rectPreview;
  if(!r)return;
  if(!asciiPointerCompatible(r)){
    clearRect();notice('Puntamento rettangolare: per righe Unicode usa i campi numerici.',true);
    return;
  }
  const geometry=probeRectangles(doc,[r],{tabSize:4,widthOf});
  if(geometry.unresolved.length||geometry.collisions.length){
    clearRect();notice('Rettangolo ambiguo: limite interno a un tab o collisione. Modifica la larghezza.',true);
    return;
  }
  $('row-from').value=r.lineFrom+1;$('row-to').value=r.lineTo+1;
  $('col-from').value=r.columnFrom;$('col-to').value=r.columnTo;
  $('rect-status').textContent='Selezione: righe '+(r.lineFrom+1)+' → '+(r.lineTo+1)+
    ', colonne '+r.columnFrom+' → '+r.columnTo+'.';
  notice('Rettangolo selezionato con il mouse; usa Inserisci a colonne o Arma incolla.');
}
$('editor').addEventListener('pointerdown',event=>{
  if(event.button!==0)return;
  if(!rectMode&&!event.altKey){if(rectPreview)clearRect();return;}
  event.preventDefault();
  consumedRectMouse=true;
  const f=$('editor');
  f.focus({preventScroll:true});
  const metric=rectangleMetrics();
  drag={id:event.pointerId,start:pointerColumnRow(event,metric)};
  f.setPointerCapture(event.pointerId);
  previewRectangle(drag.start,drag.start);
});
$('editor').addEventListener('pointermove',event=>{
  if(!drag||drag.id!==event.pointerId)return;
  previewRectangle(drag.start,pointerColumnRow(event,rectangleMetrics()));
});
$('editor').addEventListener('pointerup',event=>{
  if(!drag||drag.id!==event.pointerId)return;
  event.preventDefault();
  previewRectangle(drag.start,pointerColumnRow(event,rectangleMetrics()));
  drag=null;
  if($('editor').hasPointerCapture(event.pointerId))
    $('editor').releasePointerCapture(event.pointerId);
  guard(finalizeRectangle);
});
$('editor').addEventListener('pointercancel',event=>{
  if(drag?.id===event.pointerId){drag=null;clearRect();}
});
$('editor').addEventListener('scroll',drawRect,{passive:true});
window.addEventListener('resize',drawRect);

// The armed clipboard action survives clicking the editor to place the caret.
// A second click on the arm button cancels the one-shot mode.
$('editor').addEventListener('mouseup',()=>{
  if(consumedRectMouse){consumedRectMouse=false;return;}
  chooseNative();
});
$('editor').addEventListener('keyup',event=>{
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End',
      'PageUp','PageDown'].includes(event.key) ||
     ((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='a')){
    clearRect();chooseNative();
  }
});
$('editor').addEventListener('beforeinput',event=>{
  if(composing||event.isComposing)return;
  // Do not permit unhandled browser edits to diverge from the model.
  event.preventDefault();
  guard(()=>{
    switch(event.inputType){
      case 'insertText':
      case 'insertReplacementText':
        if(typeof event.data==='string'&&event.data.length)submit(event.data);
        break;
      case 'insertLineBreak':
      case 'insertParagraph':submit('\n');break;
      case 'deleteContentBackward':remove(false);break;
      case 'deleteContentForward':remove(true);break;
      case 'insertFromPaste':break; // handled by the real ClipboardEvent
      default:notice('Input non ancora supportato: '+event.inputType,true);
    }
  });
});
$('editor').addEventListener('paste',event=>{
  const data=event.clipboardData?.getData('text/plain');
  if(typeof data!=='string')return;
  event.preventDefault();
  guard(()=>{
    if(armed){armed=false;$('column-arm').textContent='Arma incolla da clipboard';
      columnInsert(data);
    }else submit(data);
  });
});
$('editor').addEventListener('compositionstart',()=>{composing=true;});
$('editor').addEventListener('compositionend',event=>{
  composing=false;
  // This follows the single real-Chromium commit path verified by the PoC.
  guard(()=>{
    if(event.data)submit(event.data);
    else render();
  });
});
$('editor').addEventListener('keydown',event=>{
  const key=event.key.toLowerCase();
  if((event.metaKey||event.ctrlKey)&&key==='z'){
    event.preventDefault();guard(()=>event.shiftKey?redo():undo());
  }else if((event.metaKey||event.ctrlKey)&&key==='y'){
    event.preventDefault();guard(redo);
  }else if(event.key==='Tab'&&!event.metaKey&&!event.ctrlKey&&!event.altKey){
    event.preventDefault();guard(()=>submit('\t'));
  }
});
$('undo').addEventListener('click',()=>guard(undo));
$('redo').addEventListener('click',()=>guard(redo));
$('sample').addEventListener('click',()=>guard(()=>reset()));
$('add-cursor').addEventListener('click',()=>guard(()=>{
  const row=Number($('cursor-row').value),col=Number($('cursor-col').value);
  if(!Number.isSafeInteger(row)||!Number.isSafeInteger(col)||row<1||col<0)
    throw Error('Inserisci riga e colonna valide.');
  const at=offsetOf(row-1,col);
  const old=edit.getSelections();
  if(old.some(s=>at>=s.start&&at<=s.end))throw Error('Posizione già selezionata.');
  edit.setSelections([...old,{start:at,end:at,forward:true}]);render();
  $('editor').focus();notice('Cursore aggiunto; la prossima digitazione interessa tutti.');
}));
$('single-cursor').addEventListener('click',()=>guard(()=>{
  edit.setSelections([edit.getSelections()[0]]);render();$('editor').focus();
}));
$('column-apply').addEventListener('click',()=>guard(()=>columnInsert($('column-text').value)));
$('rect-mode').addEventListener('click',()=>{
  rectMode=!rectMode;
  $('rect-mode').setAttribute('aria-pressed',String(rectMode));
  $('editor').classList.toggle('rect-pick',rectMode);
  $('rect-status').textContent=rectMode?'Trascina nell’editor per selezionare un rettangolo.':'Modalità mouse disattivata.';
});
for(const id of ['row-from','row-to','col-from','col-to'])
  $(id).addEventListener('input',()=>clearRect());
$('column-arm').addEventListener('click',()=>{
  armed=!armed;
  $('column-arm').textContent=armed?'Pronto: premi ⌘V/Ctrl+V':'Arma incolla da clipboard';
  if(armed)$('editor').focus();
  notice(armed?'Incolla dalla clipboard nel documento.':'Incolla rettangolare disarmato.');
});
$('open-file').addEventListener('click',()=>$('file').click());
$('file').addEventListener('change',async()=>{
  const f=$('file').files?.[0];
  if(!f)return;
  try{
    if(f.size>MAX_UNITS)throw Error('Il file supera 256 KiB: non caricato.');
    const data=await f.text();
    reset(data);notice('File locale caricato: '+f.name);
  }catch(error){notice(error?.message||String(error),true);}
  finally{$('file').value='';}
});
$('save-file').addEventListener('click',()=>{
  const blob=new Blob([text()],{type:'text/plain;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='poc063-test.txt';
  document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  notice('Salvataggio richiesto al browser; il PoC non salva automaticamente.');
});
reset();
$('editor').focus();
document.documentElement.dataset.demoReady='true';