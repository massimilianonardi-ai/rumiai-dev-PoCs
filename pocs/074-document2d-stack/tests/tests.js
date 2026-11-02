function runTests() {
  const {raw,projection,view} = fixture();
  const equal = (a,b) => { if (JSON.stringify(a)!==JSON.stringify(b)) throw Error(JSON.stringify([a,b])); };
  const rejects = (fn,msg) => { try { fn(); } catch(e) { equal(e.message,msg); return; } throw Error('Rifiuto atteso'); };
  const edit = {row:0,start:4,end:5,text:'X'};
  const v = view.snapshot();
  equal(view.window(0,2,5).map(t=>[t.text,t.left,t.right]),[['\t',2,4],['B',4,5]]);
  rejects(()=>view.apply(v,[edit,{row:0,start:3,end:4,text:'!'}]),'Selezione parziale o fuori testo');
  equal(raw.version,0);
  equal(view.noteAt(1,11),'nota');
  rejects(()=>view.apply(v,[edit,{row:1,start:11,end:12,text:'!'}]),'Nota di sola lettura');
  rejects(()=>view.apply(v,[{row:0,start:1,end:2,text:'!'}]),'Intervallo sintetico o misto');
  projection.toggle();
  rejects(()=>view.apply(v,[edit]),'Coordinate scadute');
  equal(raw.text,'A\nnascosto\n\tB');
  projection.toggle();
  view.apply(view.snapshot(),[edit,{row:0,start:0,end:1,text:'e\u0301'}]);
  equal(raw.text,'e\u0301\nnascosto\n\tX'); equal(raw.version,1);
  equal(view.window(0,0,1)[0].text,'e\u0301');
  const stale = view.snapshot();
  raw.apply(raw.version,[{start:0,end:2,text:'A'}]);
  rejects(()=>view.apply(stale,[edit]),'Coordinate scadute');
  return 'PASS';
}
