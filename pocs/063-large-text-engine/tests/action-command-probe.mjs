import assert from 'node:assert/strict';
import {EditorCore,ActionController} from '../src/action-command-probe.mjs';
import {FlatDocument,AdaptiveRepackDocument} from '../src/documents.mjs';
import {probeRectangles} from '../src/visual-column-probe.mjs';
function snapshot(editor){return {text:editor.slice(0,editor.length),selection:editor.getSelections()};}
function caret(at,extra={}){return {anchor:at,head:at,...extra};}
const results=[];
for(const Doc of [FlatDocument,AdaptiveRepackDocument]){
 const editor=new EditorCore(new Doc(''),{primary:0,ranges:[caret(0)]});
 assert.equal('undo' in editor,false);assert.equal('history' in editor,false);
 const changeEvents=[];
 const controller=new ActionController(editor);
 const unsubscribe=controller.subscribe(e=>changeEvents.push(e.type));
 for(const [letter,keyboard] of [['C','keyboard-1'],['I','keyboard-2'],['A','keyboard-1'],['O','keyboard-2']])
   controller.input({type:'text',text:letter,device:keyboard});
 assert.equal(snapshot(editor).text,'CIAO');assert.equal(controller.historyLength,4);
 for(const value of ['CIA','CI','C','']){assert(controller.undo());assert.equal(snapshot(editor).text,value);}
 for(const value of ['C','CI','CIA','CIAO']){assert(controller.redo());assert.equal(snapshot(editor).text,value);}
 assert.equal(changeEvents.length,12);
 unsubscribe();
 // One text action targets all carets, no independent streams.
 editor.setSelections({primary:1,ranges:[caret(0),caret(4)]});
 controller.input({type:'text',text:'🙂'});
 assert.equal(snapshot(editor).text,'🙂CIAO🙂');assert.equal(controller.historyLength,5);
 assert(controller.undo());assert.equal(snapshot(editor).text,'CIAO');
 assert.deepEqual(editor.getSelections(),{primary:1,ranges:[caret(0),caret(4)]});
 assert(controller.redo());assert.equal(snapshot(editor).text,'🙂CIAO🙂');
 // A new user action after undo drops the future redo branch.
 assert(controller.undo());controller.input({type:'text',text:'x'});
 assert.equal(snapshot(editor).text,'xCIAOx');assert.equal(controller.redo(),false);
 results.push({doc:Doc.name,keyboardEdits:4,simultaneousCarets:2,undoExact:true,redoBranch:true});
}
// Multi-line column paste uses pre-existing geometry, with visual cells/carets
// owned by EditorCore, NOT by ActionController. Row mapping is only a probe.
for(const Doc of [FlatDocument,AdaptiveRepackDocument]){
 const doc=new Doc('aa\nb\n\n');
 const geometry=probeRectangles(doc,[{lineFrom:0,lineTo:2,columnFrom:4,columnTo:4}],{tabSize:4,widthOf:()=>1});
 assert.equal(geometry.targets.length,3);assert.equal(geometry.unresolved.length,0);
 const initial={primary:0,ranges:geometry.targets.map(t=>caret(t.start,{virtualSpaces:t.virtualSpaces,virtualColumn:t.columnFrom}))};
 const editor=new EditorCore(doc,initial),controller=new ActionController(editor);
 const before=snapshot(editor);
 controller.input({type:'pasteRows',rows:['X','Y','Z']});
 assert.equal(editor.slice(0,editor.length),'aa  X\nb   Y\n    Z\n');
 assert.equal(controller.historyLength,1);
 const after=snapshot(editor);
 assert(controller.undo());assert.deepEqual(snapshot(editor),before);
 assert(controller.redo());assert.deepEqual(snapshot(editor),after);
 assert.throws(()=>controller.input({type:'pasteRows',rows:['X','Y']}),/one row per selection/);
 assert.deepEqual(snapshot(editor),after);
 results.push({doc:Doc.name,rectangularPasteRows:3,undoAtomic:true,virtualColumns:true});
}
// Reject overlapping/duplicate carets before mutation or history registration.
{
 const editor=new EditorCore(new FlatDocument('abcd'),{primary:0,ranges:[caret(1),caret(1)]});
 const ctl=new ActionController(editor);
 assert.throws(()=>ctl.input({type:'text',text:'?'}),/duplicate changes/);
 assert.equal(editor.slice(0,editor.length),'abcd');assert.equal(ctl.historyLength,0);
}
// Verify strong command-level rollback for an atomic pre-mutation primitive
// rejection. Do not claim safety for a primitive that changes state then throws.
{
 const storage=new FlatDocument('abc\ndef\nghi');let calls=0,failed=false;
 const guarded={get length(){return storage.length;},get lineCount(){return storage.lineCount;},slice:(a,b)=>storage.slice(a,b),lineStart:i=>storage.lineStart(i),replace(a,b,text){calls++;if(calls===2&&!failed){failed=true;throw Error('injected primitive rejection');}return storage.replace(a,b,text);}};
 const selection={primary:0,ranges:[caret(0),caret(4),caret(8)]};
 const editor=new EditorCore(guarded,selection),controller=new ActionController(editor);
 const before=snapshot(editor);
 assert.throws(()=>controller.input({type:'text',text:'Z'}),/injected primitive rejection/);
 assert.deepEqual(snapshot(editor),before);
 assert.equal(editor.version,0);assert.equal(controller.historyLength,0);
 assert(controller.input({type:'text',text:'Z'}));
 assert(controller.undo());assert.deepEqual(snapshot(editor),before);
}
// External direct editor changes must invalidate the wrapper's stale history;
// independent collaborative editing and synchronization are out of scope.
{
 const editor=new EditorCore(new FlatDocument('abc'),{primary:0,ranges:[caret(3)]});
 const ctl=new ActionController(editor,{undoLimit:2});
 for(const letter of ['x','y','z'])ctl.input({type:'text',text:letter});
 assert.equal(ctl.historyLength,2);assert(ctl.undo());assert(ctl.undo());assert.equal(ctl.undo(),false);
 assert.equal(editor.slice(0,editor.length),'abcx');
 const isolated=new EditorCore(new FlatDocument('a'),{primary:0,ranges:[caret(1)]});
 const wrapper=new ActionController(isolated);
 wrapper.input({type:'text',text:'b'});
 isolated.applyChanges([{start:0,end:0,insert:'!'}],{primary:0,ranges:[caret(0)]});
 assert.throws(()=>wrapper.undo(),/outside controller/);
 assert.throws(()=>wrapper.input({type:'text',text:'c'}),/outside controller/);
}
console.log(JSON.stringify({pass:true,cases:results,rollback:true,duplicateSelectionRejected:true,unifiedInput:true,undoLimit:true,externalMutationDetected:true,collaboration:false,IME:false,nativeMadEdit:false}));
