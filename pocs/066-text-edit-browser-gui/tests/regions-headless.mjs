/* Headless PoC 066: real TextEdit 0.8.2 + the same 2D region model as the GUI. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const geometry=require('../region-geometry.js');
const API=require('../../../../../lib/sys/js/text-edit.lib.js');
assert.equal(API.VERSION,'0.8.2');

const SOURCE='A\tB\nfold alpha\nfold beta\nfold gamma\n0123456789\nuvwxyzABCD';
const policies=()=>({tab:'touch',fold:'touch',annotation:'touch'});
const point=(row,col)=>({row,col});

function editorFixture()
{
  const editor=new API.TextEdit(SOURCE);
  editor.representation.setColumnMetrics({tabSize:4,widthOf:()=>1});
  editor.representation.setReplacements
  ([
    {
      start:editor.document.lineStart(1),
      end:editor.document.lineStart(4),
      text:'[3 folded rows]'
    }
  ]);
  editor.representation.setAnnotations
  ([
    {
      id:'info',at:editor.document.lineStart(4),
      text:'ℹ nota',affinity:'after'
    }
  ]);
  return editor;
}

function project(editor,options=policies())
{
  return geometry.buildRegions
  (
    editor.document,
    editor.representation,
    {columns:18,policies:options}
  );
}

function resolve(editor,projection,start,end)
{
  const requested=geometry.clippedRectangle(start,end);
  const selected=geometry.selectRegions(projection.regions,requested);
  const direction=
  {
    horizontal:start.col<=end.col,
    vertical:start.row<=end.row
  };
  const physical=geometry.physicalSelections(editor.document,selected,direction);
  return {requested,selected,direction,physical};
}

{
  const editor=editorFixture();
  try
  {
    const revision=editor.document.revision;
    const projection=project(editor);
    assert.equal(projection.visualRows.length,4);
    const tab=projection.regions.find(x=>x.kind==='tab');
    const fold=projection.regions.find(x=>x.kind==='fold');
    const note=projection.regions.find(x=>x.kind==='annotation');
    assert.deepEqual([tab.row,tab.col,tab.width,tab.height],[0,1,3,1]);
    assert.deepEqual([fold.row,fold.col,fold.width,fold.height],[1,0,6,1]);
    assert.deepEqual([note.row,note.col,note.width,note.height],[2,12,4,2]);
    assert.equal(note.source,null);
    assert.deepEqual(fold.source,
      {start:editor.document.lineStart(1),end:editor.document.lineStart(4)});

    let result=resolve(editor,projection,point(0,2),point(0,2));
    assert.deepEqual(result.selected.map(x=>x.id),[tab.id]);
    assert.deepEqual(result.physical,
      [{start:point(0,1),end:point(0,2),forward:true}]);

    const full=project(editor,{...policies(),tab:'full'});
    assert.deepEqual(resolve(editor,full,point(0,2),point(0,2)).selected,[]);
    assert.deepEqual(resolve(editor,full,point(0,1),point(0,3))
      .selected.map(x=>x.id),[tab.id]);
    const none=project(editor,{...policies(),tab:'none'});
    assert.deepEqual(resolve(editor,none,point(0,1),point(0,3)).physical,[]);

    result=resolve(editor,projection,point(1,2),point(1,2));
    assert.deepEqual(result.physical,
      [{start:point(1,0),end:point(4,0),forward:true}]);

    result=resolve(editor,projection,point(2,13),point(2,13));
    assert.deepEqual(result.selected.map(x=>x.id),['annotation']);
    assert.deepEqual(result.physical,[],'source-less highlight is not editable');

    result=resolve(editor,projection,point(2,9),point(2,16));
    assert.deepEqual(result.physical,
      [{start:point(4,9),end:point(4,10),forward:true}]);

    const overlapping=
    [
      {source:{start:0,end:2}},
      {source:{start:1,end:3}},
      {source:{start:0,end:2}},
      {source:null}
    ];
    assert.deepEqual(
      geometry.physicalSelections(editor.document,overlapping,
        {horizontal:false,vertical:false}),
      [{start:point(0,0),end:point(0,3),forward:false}],
      'duplicated and overlapping source spans coalesce in this PoC');
    assert.equal(editor.document.revision,revision,
      'projection and selection resolution never change source');
    assert.equal(editor.document.toString(),SOURCE);
  }
  finally
  {
    editor.dispose();
  }
}

{
  const editor=editorFixture();
  try
  {
    const projection=project(editor);
    const result=resolve(editor,projection,point(3,3),point(2,1));
    assert.deepEqual(result.direction,{horizontal:false,vertical:false});
    assert.deepEqual(result.physical.map(s=>s.start.row),[5,4]);
    assert.ok(result.physical.every(s=>s.forward===false));
    editor.selections.setSelections(result.physical);
    editor.replace(['AA','BB']);
    assert.equal(editor.document.toString(),
      'A\tB\nfold alpha\nfold beta\nfold gamma\n0BB456789\nuAAyzABCD');
    assert.deepEqual(editor.selections.getSelections().map(s=>s.forward),
      [false,false]);
    editor.replace(['Q','R']);
    assert.equal(editor.document.toString(),
      'A\tB\nfold alpha\nfold beta\nfold gamma\n0RBB456789\nuQAAyzABCD');
    assert.deepEqual(editor.selections.getSelections().map(s=>s.start.row),
      [5,4],'repeated edits keep original visual traversal order');
  }
  finally
  {
    editor.dispose();
  }
}

{
  const editor=editorFixture();
  try
  {
    const projection=project(editor);
    const result=resolve(editor,projection,point(1,2),point(1,2));
    editor.selections.setSelections(result.physical);
    editor.replace('X');
    assert.equal(editor.document.revision,1);
    assert.equal(editor.representation.replacements.length,0,
      'real TextEdit invalidates the consumed fold overlay');
    assert.equal(project(editor).visualRows.length,3);
    assert.equal(editor.document.toString(),'A\tB\nX0123456789\nuvwxyzABCD');
  }
  finally
  {
    editor.dispose();
  }
}

console.log(JSON.stringify({
  pass:true,version:API.VERSION,
  coverage:[
    'source-region-projection','tab-complete-cell','fold-source-span',
    'annotation-source-less','touch-full-none','clipped-eol',
    'overlapping-interval-coalescence','bottom-up-physical-order',
    'reverse-caret-reuse','source-invalidation'
  ]
}));
