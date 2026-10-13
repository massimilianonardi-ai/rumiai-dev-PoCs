/* Browser-only experiment. The real TextEdit owns document and selections. */
(function(){
'use strict';
const API=globalThis.TextEdit;
const $=id=>document.getElementById(id);
if(!API||API.VERSION!=='0.8.1'){
  $('warning').textContent='TextEdit 0.8.1 non disponibile: verificare rumiai-os/src/rumiai-dev-PoCs e il server avviato da rumiai-os.';
  return;
}
const scroller=$('scroller'),rows=$('rows'),spacer=$('spacer');
const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
const HEIGHT=24,MAX_UNITS=1024,OVERSCAN=5;
let editor=null,unsubscribe=null,drag=null,scheduled=false;
let visible=[],renderCount=0,maxMounted=0,desiredColumn=null;
const p=(row,col)=>({row,col});
const cmp=(a,b)=>a.row-b.row||a.col-b.col;
function warning(message=''){$('warning').textContent=message;}
function rowInfo(row){const x=editor.document.lineInfo(row);return {start:x.start,end:x.end,width:x.end-x.start};}
function width(row){return rowInfo(row).width;}
function selection(){return editor.selections.getSelections()[0];}
function active(){const s=selection();return s.forward?s.end:s.start;}
function setRange(anchor,cursor){
  const forward=cmp(anchor,cursor)<=0;
  const start=forward?anchor:cursor,end=forward?cursor:anchor;
  editor.selections.setSelections([{start:{...start},end:{...end},forward}]);
  schedule();
}
function place(cursor){setRange(cursor,cursor);desiredColumn=null;}
function boundedRow(row){
  const info=rowInfo(row);
  let text=editor.document.slice(info.start,Math.min(info.end,info.start+MAX_UNITS));
  const truncated=info.width>MAX_UNITS;
  if(truncated){
    const graphemes=[...segmenter.segment(text)];
    if(graphemes.length)text=text.slice(0,graphemes[graphemes.length-1].index);
  }
  return {row,start:info.start,text,truncated};
}
function pixel(textNode,index){
  if(!textNode||index<0||index>textNode.textContent.length)return null;
  const range=document.createRange();
  range.setStart(textNode,index);
  range.collapse(true);
  return range.getBoundingClientRect().left-textNode.parentElement.getBoundingClientRect().left;
}
function boundaries(span,text){
  const node=span.firstChild;
  if(!node||node.nodeType!==Node.TEXT_NODE)return null;
  const indices=[...segmenter.segment(text)].map(x=>x.index);
  if(!indices.includes(0))indices.unshift(0);
  if(indices[indices.length-1]!==text.length)indices.push(text.length);
  const xs=indices.map(n=>pixel(node,n));
  if(xs.some(x=>x===null||!Number.isFinite(x)))return null;
  for(let i=1;i<xs.length;i++)if(xs[i]<=xs[i-1]+.1)return null;
  return {indices,xs};
}
function paintSelection(rowInfo){
  const all=editor.selections.getSelections();
  const line=rows.querySelector('[data-row="'+rowInfo.row+'"]');
  if(!line)return;
  const span=line.querySelector('.content'),node=span.firstChild;
  for(const s of all){
    if(cmp(s.start,s.end)===0||s.start.row>rowInfo.row||s.end.row<rowInfo.row)continue;
    const start=s.start.row<rowInfo.row?0:s.start.col;
    const end=s.end.row>rowInfo.row?rowInfo.text.length:s.end.col;
    const a=Math.min(rowInfo.text.length,start),b=Math.min(rowInfo.text.length,end);
    if(b<=a)continue;
    const x1=pixel(node,a),x2=pixel(node,b);
    if(x1!==null&&x2!==null&&x2>=x1){
      const mark=document.createElement('span');
      mark.className='mark';mark.style.left=x1+'px';
      mark.style.width=Math.max(1,x2-x1)+'px';span.append(mark);
    }
  }
  for(const s of all){
    const current=s.forward?s.end:s.start;
    if(current.row!==rowInfo.row||current.col>rowInfo.text.length)continue;
    const x=pixel(node,current.col);
    if(x!==null&&Number.isFinite(x)){
      const caret=document.createElement('span');
      caret.className='caret';caret.style.left=x+'px';span.append(caret);
    }
  }
}
function render(){
  scheduled=false;if(!editor)return;
  const doc=editor.document;
  const first=Math.max(0,Math.floor(scroller.scrollTop/HEIGHT)-OVERSCAN);
  const last=Math.min(doc.lineCount,first+Math.ceil(scroller.clientHeight/HEIGHT)+2*OVERSCAN+2);
  spacer.style.height=doc.lineCount*HEIGHT+'px';
  rows.style.transform='translateY('+(first*HEIGHT)+'px)';
  const batch=document.createDocumentFragment();visible=[];
  for(let row=first;row<last;row++){
    const info=boundedRow(row);visible.push(info);
    const el=document.createElement('div');el.className='row';el.dataset.row=String(row);
    const gutter=document.createElement('span');gutter.className='gutter';gutter.textContent=String(row+1);
    const text=document.createElement('span');text.className='content';text.append(document.createTextNode(info.text));
    el.append(gutter,text);
    if(info.truncated){
      const suffix=document.createElement('span');suffix.className='ellipsis';
      suffix.textContent='… [riga lunga]';el.append(suffix);
    }
    batch.append(el);
  }
  rows.replaceChildren(batch);
  for(const info of visible)paintSelection(info);
  renderCount++;maxMounted=Math.max(maxMounted,visible.length);
  const c=active();
  $('status').textContent='Riga '+(c.row+1)+' · colonna UTF-16 '+c.col+
    ' · selezioni '+editor.selections.getSelections().length;
  $('metrics').textContent=doc.lineCount.toLocaleString('it-IT')+
    ' righe · DOM '+visible.length+' righe · render '+renderCount;
}
function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(render);}}
function reveal(c){
  const top=c.row*HEIGHT;
  if(top<scroller.scrollTop)scroller.scrollTop=top;
  if(top+HEIGHT>scroller.scrollTop+scroller.clientHeight)
    scroller.scrollTop=top+HEIGHT-scroller.clientHeight;
  schedule();
}
function locate(event){
  const frame=scroller.getBoundingClientRect();
  const y=Math.max(frame.top+1,Math.min(frame.bottom-1,event.clientY));
  const row=Math.max(0,Math.min(editor.document.lineCount-1,
    Math.floor((scroller.scrollTop+y-frame.top)/HEIGHT)));
  const el=rows.querySelector('[data-row="'+row+'"]');
  const info=visible.find(v=>v.row===row);
  if(!el||!info)return null;
  const span=el.querySelector('.content');
  const result=boundaries(span,info.text);
  if(!result){warning('Layout Unicode/bidi ambiguo: click rifiutato.');return null;}
  const x=event.clientX-span.getBoundingClientRect().left;
  if(info.truncated&&x>result.xs[result.xs.length-1]+4){
    warning('La parte troncata della riga non è editabile tramite mouse.');return null;
  }
  let best=0;
  for(let i=1;i<result.xs.length;i++)
    if(Math.abs(result.xs[i]-x)<Math.abs(result.xs[best]-x))best=i;
  const physical=p(row,result.indices[best]);
  const logical=editor.representation.sourceToColumn(info.start+physical.col);
  if(logical.kind!=='column'){warning('Colonna non risolvibile.');return null;}
  return {physical,logical:p(logical.row,logical.col)};
}
function down(event){
  if(event.button!==0)return;
  // Native scrollbars belong to the scroller, not to editable text rows.
  // Do not start a selection or capture pointers in scrollbar tracks,
  // padding, gutter or empty viewport space.
  const frame=scroller.getBoundingClientRect();
  const left=frame.left+scroller.clientLeft,top=frame.top+scroller.clientTop;
  // Overlay scrollbars may report zero gutter width and target a DOM row
  // underneath the scrollbar. Reserve their right-edge hit zone explicitly.
  const nativeGutter=scroller.offsetWidth-scroller.clientWidth-scroller.clientLeft;
  const overlayGuard=scroller.scrollHeight>scroller.clientHeight&&nativeGutter<4?18:0;
  if(event.clientX<left||
     event.clientX>=left+scroller.clientWidth-overlayGuard||
     event.clientY<top||event.clientY>=top+scroller.clientHeight||
     !event.target.closest('.row')||event.target.closest('.gutter'))return;
  warning();scroller.focus({preventScroll:true});
  const hit=locate(event);if(!hit)return;
  event.preventDefault();drag={anchor:hit,rectangle:event.altKey,id:event.pointerId};
  if(drag.rectangle)editor.advancedSelections.rectangularSelection(hit.logical,hit.logical);
  else place(hit.physical);
  schedule();scroller.setPointerCapture(event.pointerId);
}
function movePointer(event){
  if(!drag||drag.id!==event.pointerId)return;
  const bounds=scroller.getBoundingClientRect();
  if(event.clientY<bounds.top+12)scroller.scrollTop-=HEIGHT;
  if(event.clientY>bounds.bottom-12)scroller.scrollTop+=HEIGHT;
  render();
  const hit=locate(event);if(!hit)return;
  if(drag.rectangle){
    editor.advancedSelections.rectangularSelection(drag.anchor.logical,hit.logical);
    schedule();
  }else setRange(drag.anchor.physical,hit.physical);
}
function up(event){
  if(drag&&drag.id===event.pointerId){
    drag=null;
    if(scroller.hasPointerCapture(event.pointerId))scroller.releasePointerCapture(event.pointerId);
  }
}
function graphemes(row){
  const info=rowInfo(row);
  if(info.width>MAX_UNITS)throw new RangeError('Navigazione su righe oltre 1024 unità ancora limitata.');
  const text=editor.document.slice(info.start,info.end);
  return [...segmenter.segment(text)].map(x=>x.index).concat(text.length);
}
function horizontal(c,direction){
  const points=graphemes(c.row);
  if(direction<0){
    for(let i=points.length-1;i>=0;i--)if(points[i]<c.col)return p(c.row,points[i]);
    return c.row?p(c.row-1,width(c.row-1)):p(0,0);
  }
  for(const index of points)if(index>c.col)return p(c.row,index);
  return c.row+1<editor.document.lineCount?p(c.row+1,0):c;
}
function vertical(c,delta){
  const row=Math.max(0,Math.min(editor.document.lineCount-1,c.row+delta));
  const here=rowInfo(c.row);
  if(desiredColumn===null){
    const m=editor.representation.sourceToColumn(here.start+Math.min(c.col,here.width));
    if(m.kind!=='column')throw new RangeError('Il cursore divide un grafema.');
    desiredColumn=m.col+Math.max(0,c.col-here.width);
  }
  const m=editor.representation.columnToSource(row,desiredColumn);
  const there=rowInfo(row);
  if(m.kind==='virtual')return p(row,there.width+m.virtualSpaces);
  if(m.kind==='inside-grapheme')return p(row,m.before-there.start);
  return p(row,m.offset-there.start);
}
function keyboardMove(key,extend){
  const s=selection(),c=active();
  let result=c;
  if(!extend&&cmp(s.start,s.end)!==0&&['ArrowLeft','ArrowRight'].includes(key))
    result=key==='ArrowLeft'?s.start:s.end;
  else if(key==='ArrowLeft')result=horizontal(c,-1);
  else if(key==='ArrowRight')result=horizontal(c,1);
  else if(key==='ArrowUp')result=vertical(c,-1);
  else if(key==='ArrowDown')result=vertical(c,1);
  else if(key==='Home')result=p(c.row,0);
  else if(key==='End')result=p(c.row,width(c.row));
  else if(key==='PageUp')result=vertical(c,-Math.max(1,Math.floor(scroller.clientHeight/HEIGHT)-2));
  else if(key==='PageDown')result=vertical(c,Math.max(1,Math.floor(scroller.clientHeight/HEIGHT)-2));
  if(!['ArrowUp','ArrowDown','PageUp','PageDown'].includes(key))desiredColumn=null;
  if(extend)setRange(s.forward?s.start:s.end,result);
  else setRange(result,result);
  reveal(result);
}
function write(text){editor.replace(text);desiredColumn=null;schedule();reveal(active());}
function erase(backward){
  const s=selection();
  if(cmp(s.start,s.end)!==0){write('');return;}
  const c=active(),other=horizontal(c,backward?-1:1);
  if(cmp(c,other)!==0){setRange(c,other);write('');}
}
function keyDown(event){
  if(event.isComposing||event.key==='Process'||event.key==='Dead')return;
  if((event.ctrlKey||event.metaKey)&&!event.altKey&&event.key.toLowerCase()==='a'){
    event.preventDefault();
    const last=editor.document.lineCount-1;
    setRange(p(0,0),p(last,width(last)));return;
  }
  if(event.ctrlKey||event.metaKey||event.altKey)return;
  try{
    const nav=['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'];
    if(nav.includes(event.key)){event.preventDefault();keyboardMove(event.key,event.shiftKey);return;}
    if(event.shiftKey&&event.key==='Tab')return;
    if(event.key==='Backspace'||event.key==='Delete'){event.preventDefault();erase(event.key==='Backspace');return;}
    if(event.key==='Enter'){event.preventDefault();write('\n');return;}
    if(event.key==='Tab'){event.preventDefault();write('\t');return;}
    if(event.key.length===1){event.preventDefault();write(event.key);}
  }catch(error){warning(error?.message||String(error));}
}
function reset(text){
  if(unsubscribe)unsubscribe();
  if(editor)editor.dispose();
  editor=new API.TextEdit(text);
  editor.selections.setSelections([{start:p(0,0),end:p(0,0),forward:true}]);
  unsubscribe=editor.document.subscribe(schedule);
  drag=null;desiredColumn=null;maxMounted=0;
  scroller.scrollTop=0;scroller.scrollLeft=0;
  schedule();
}
function sample(){
  reset(['alpha beta gamma','tab\tcolonna\tX',
    'emoji 😀 e\u0301 e famiglia 👩‍👩‍👧‍👦','漢字 e testo',
    'linea semplice','','fine'].join('\n'));
}
function large(){
  reset(Array.from({length:100000},(_,i)=>
    'riga '+String(i+1).padStart(6,'0')+' testo campione '+(i%97===0?'😀e\u0301':'abc')).join('\n'));
}
scroller.addEventListener('scroll',schedule,{passive:true});
scroller.addEventListener('pointerdown',down);
scroller.addEventListener('pointermove',movePointer);
scroller.addEventListener('pointerup',up);
scroller.addEventListener('pointercancel',up);
scroller.addEventListener('keydown',keyDown);
$('sample').addEventListener('click',sample);
$('large').addEventListener('click',large);
$('jump').addEventListener('click',()=>{
  scroller.scrollTop=Math.min(editor.document.lineCount-1,49999)*HEIGHT;
  schedule();scroller.focus({preventScroll:true});
});
function setFont(proportional){
  scroller.classList.toggle('proportional-font',proportional);
  $('font-mono').setAttribute('aria-pressed',String(!proportional));
  $('font-proportional').setAttribute('aria-pressed',String(proportional));
  // Selection offsets stay owned by TextEdit; only DOM glyph geometry changes.
  schedule();
  if(document.fonts)document.fonts.ready.then(schedule);
}
$('font-mono').addEventListener('click',()=>setFont(false));
$('font-proportional').addEventListener('click',()=>setFont(true));
new ResizeObserver(schedule).observe(scroller);
globalThis.__guiProbe={
  snapshot:()=>({version:API.VERSION,rows:editor.document.lineCount,
    units:editor.document.length,selection:editor.selections.getSelections(),
    first:visible[0]?.row,last:visible[visible.length-1]?.row,
    mounted:rows.children.length,maxMounted,renderCount,
    text:editor.document.toString(),warning:$('warning').textContent}),
  focus:()=>scroller.focus(),setText:reset
};
sample();
})();