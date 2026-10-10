// Browser-only PoC: native beforeinput/keyboard/mouse boundary projected onto
// DOM-independent TextEditSelections. This wrapper is *test code*, not an API.
import {PieceDocument} from '../src/documents.mjs';
import {TextEditSelections} from '../src/text-edit-selections-probe.mjs';

const documentModel=new PieceDocument('ab');
const editor=new TextEditSelections(documentModel);
editor.setSelections([{start:2,end:2,forward:true}]);
const field=document.getElementById('capture');
const history=[];
const observed=[];
let index=0,rendering=false,composing=false;
const text=()=>documentModel.slice(0,documentModel.length);
function render(){
  rendering=true;
  field.value=text();
  const s=editor.getSelections()[0];
  field.setSelectionRange(s.start,s.end,s.forward?'forward':'backward');
  rendering=false;
}
function selectFromNative(){
  if(rendering||composing)return;
  editor.setSelections([{
    start:field.selectionStart,end:field.selectionEnd,
    forward:field.selectionDirection!=='backward'
  }]);
}
function input(value){
  const change=editor.replace(value);
  if(index<history.length)history.length=index;
  history.push({value,change});index++;
  render();
}
function undo(){
  if(!index)return;
  const {change}=history[--index];
  for(let i=change.changes.length-1;i>=0;i--){
    const c=change.changes[i];
    documentModel.replace(c.inverseStart,c.inverseEnd,c.removed);
  }
  editor.setSelections(change.before);
  render();
}
function redo(){
  if(index===history.length)return;
  const {value,change}=history[index++];
  editor.setSelections(change.before);
  editor.replace(value);
  render();
}
field.addEventListener('beforeinput',e=>{
  observed.push({event:'beforeinput',type:e.inputType,data:e.data,composing:e.isComposing});
  if(e.inputType==='insertText'&&!e.isComposing&&!composing&&typeof e.data==='string'&&e.data.length){
    e.preventDefault();
    input(e.data);
  }
});
field.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){
    e.preventDefault();
    if(e.shiftKey)redo();else undo();
    observed.push({event:'shortcut',type:e.shiftKey?'redo':'undo'});
  }
});
field.addEventListener('mouseup',selectFromNative);
field.addEventListener('keyup',selectFromNative);
field.addEventListener('compositionstart',()=>{composing=true;observed.push({event:'compositionstart'});});
field.addEventListener('compositionupdate',e=>observed.push({event:'compositionupdate',data:e.data}));
field.addEventListener('compositionend',e=>{
  composing=false;observed.push({event:'compositionend',data:e.data});
  // Preview/cancellation is not a committed editor action. The final IME
  // commit policy is *not* claimed as solved by this browser boundary probe.
  render();
});
render();
field.focus();
window.__probe={
  snapshot:()=>({text:text(),selection:editor.getSelections(),
    historyLength:history.length,historyIndex:index,
    nativeSelectionStart:field.selectionStart,
    events:observed.slice()}),
  focus:()=>field.focus(),
  rect:()=>{const r=field.getBoundingClientRect();return {x:r.x+3,y:r.y+12};}
};
document.getElementById('result').textContent='ready';
