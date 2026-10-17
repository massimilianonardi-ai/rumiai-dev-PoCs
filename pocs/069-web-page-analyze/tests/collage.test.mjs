import test from 'node:test';
import assert from 'node:assert/strict';
import {planCollage,collageHtml} from '../collage.mjs';

function state(id, top, max=900, height=500){
  return {id,capture:{
    before:{top,max},scrollViewport:{
      x:50,y:100,width:700,height,viewportWidth:900,
      viewportHeight:800,devicePixelRatio:1
    }
  }};
}
test('collage stitches only visible original scroll-container slices',()=>{
  const plan=planCollage([state('0001',400,400),state('0000',0,400)]);
  assert.equal(plan.type,'strips');
  assert.deepEqual(plan.segments.map(s=>[s.id,s.from,s.to]),
    [['0000',0,500],['0001',500,900]]);
  assert.equal(plan.segments[1].cropY,200);
  assert.equal(plan.completeGeometry,true);
  const html=collageHtml('chatgpt-share',[state('0001',400,400),state('0000',0,400)]);
  assert.match(html,/states\/0000\/original.png/);
  assert.match(html,/states\/0001\/original.png/);
  assert.doesNotMatch(html,/page\.html|page\.mhtml|file:\/\/\//);
});
test('collage marks uncovered scroll ranges instead of pretending continuity',()=>{
  const plan=planCollage([state('0000',0),state('0001',700)]);
  assert.deepEqual(plan.gaps,[{start:500,end:700},{start:1200,end:1400}]);
  assert.equal(plan.completeGeometry,false);
});
test('a virtualized changing extent is flagged as uncertain',()=>{
  const plan=planCollage([state('0000',0,900),state('0001',400,1200)]);
  assert.equal(plan.changingExtent,true);
  assert.match(collageHtml('chatgpt-share',
    [state('0000',0,900),state('0001',400,1200)]),
    /Altezza scrollabile variabile/);
});
test('prior runs without viewport geometry fall back to historical screenshots',()=>{
  const entries=[{id:'0000',capture:{before:{top:0,max:800}}}];
  assert.equal(planCollage(entries).type,'timeline');
  assert.match(collageHtml('amazon-wishlist',entries),/senza ritagli/);
});

test('partial virtualized ChatGPT traversal explicitly reports missing beginning',()=>{
  const entries=[state('0010',13242,26925),state('0009',14042,26925)];
  const plan=planCollage(entries);
  assert.equal(plan.gaps[0].start,0);
  assert.equal(plan.gaps[0].end,13242);
  assert.equal(plan.completeGeometry,false);
  const html=collageHtml('chatgpt-share',entries);
  assert.match(html,/Intervallo non acquisito: 0–13242/);
  assert.match(html,/Intervallo non acquisito: 14542–27425/);
});
test('stale screenshot position is excluded from geometric strips',()=>{
  const good=state('0000',0,0,500);
  const drifted=state('0001',400,400,500);
  drifted.capture.screenshotStable=false;
  const plan=planCollage([good,drifted]);
  assert.equal(plan.omitted,1);
  assert.equal(plan.completeGeometry,false);
});
