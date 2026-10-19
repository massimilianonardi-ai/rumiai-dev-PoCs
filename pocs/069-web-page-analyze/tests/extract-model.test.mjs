import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCandidates} from '../extract-model.mjs';
import {matchingSnapshotSchemas} from '../analyze-investigation.mjs';
test('find nested mapping/current_node without inventing a mounted DOM',()=>{
  const s={result:{data:{conversation:{current_node:'m2',
    mapping:{m1:{parent:null},m2:{parent:'m1'}}}}}};
  const x=snapshotCandidates(s);
  assert.equal(x.length,1);
  assert.equal(x[0].path,'/result/data/conversation');
  assert.equal(x[0].snapshot.current_node,'m2');
});
test('does not assume nested partial/unrelated JSON is complete transcript',()=>{
  assert.deepEqual(snapshotCandidates({messages:[{id:'m1'}]}),[]);
  assert.deepEqual(snapshotCandidates({result:{mapping:{},current_node:null}}),[]);
});
test('schema signatures match the supplied Python model only when both fields exist',()=>{
  const obj=members=>({type:'object',members});
  const records=[{sha256:'fixture',url:'https://chatgpt.com/backend-api/shared',
    structure:obj({data:obj({conversation:obj({
      mapping:obj({}),current_node:{type:'string'}
    })})})},{sha256:'nope',structure:obj({mapping:obj({})})}];
  const matches=matchingSnapshotSchemas(records);
  assert.equal(matches.length,1);
  assert.equal(matches[0].jsonPath,'/data/conversation');
  assert.equal(matches[0].status,'candidate-unverified');
});
