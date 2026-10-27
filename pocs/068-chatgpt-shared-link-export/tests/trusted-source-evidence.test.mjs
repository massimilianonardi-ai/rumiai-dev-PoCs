'use strict';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {collectTrustedSourceEvidence,summarizeTrustedSourceEvidence}
  from '../inspect-trusted-source-evidence.mjs';

function fixture(run)
{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'poc068-source-evidence-'));
  try{
    const dirs=['catalog','actions'].map(name=>{
      const directory=path.join(root,name);
      fs.mkdirSync(directory);
      return directory;
    });
    const write=(dir,rows)=>fs.writeFileSync(path.join(dir,'events.jsonl'),
      rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
    return run({dirs,write});
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}
const hover=(ordinal,index,expectedSources)=>({
  kind:'interaction.source-hover',ordinal,index,expectedSources
});
const action=(ordinal,groupIndex,expectedSources,attempts)=>({
  kind:'interaction.trusted-source-card-intents',
  ordinal,groupIndex,expectedSources,attempts
});
const clicked=(index,url)=>({
  index,status:'dispatched',windowOpen:[url],anchorClick:[]
});

test('a previous capture supplies missing-group catalog while trusted intent supplies exact links',()=>
  fixture(({dirs,write})=>{
    write(dirs[0],[hover(2,0,2),hover(2,1,5)]);
    write(dirs[1],[action(2,0,2,[
      clicked(0,'https://example.net/private?q=hidden'),
      clicked(1,'https://example.org/second')
    ])]);
    const evidence=collectTrustedSourceEvidence(dirs);
    assert.equal(evidence.groups.length,2);
    assert.equal(evidence.groups[0].complete,true);
    assert.equal(evidence.groups[0].targets.length,2);
    assert.equal(evidence.groups[1].complete,false);
    assert.equal(evidence.groups[1].targets,null);
    const safe=summarizeTrustedSourceEvidence(dirs);
    assert.equal(safe.expectedGroups,2);
    assert.equal(safe.verifiedGroups,1);
    assert.equal(safe.verifiedCards,2);
    assert.ok(!JSON.stringify(safe).includes('hidden'));
    assert.ok(!JSON.stringify(safe).includes('example.net'));
    assert.ok(!JSON.stringify(safe).includes('example.org'));
  })
);
test('unknown or inconsistent source-card values cannot become verified targets',()=>
  fixture(({dirs,write})=>{
    write(dirs[0],[hover(4,0,2)]);
    write(dirs[1],[action(4,0,2,[
      clicked(0,'javascript:alert(1)'),
      {index:1,status:'dispatched',windowOpen:[],anchorClick:[]}
    ])]);
    const result=summarizeTrustedSourceEvidence(dirs);
    assert.equal(result.verifiedGroups,0);
    assert.equal(result.ambiguousCards,1);
    assert.equal(result.verifiedCards,0);
  })
);
test('conflicting per-card target and expected source count are rejected',()=>
  fixture(({dirs,write})=>{
    write(dirs[0],[hover(6,1,2)]);
    write(dirs[1],[hover(6,1,3)]);
    assert.throws(()=>collectTrustedSourceEvidence(dirs),
      /Conflicting source group count/);
    write(dirs[1],[action(6,1,2,[
      clicked(0,'https://example.net/one'),
      clicked(1,'https://example.net/two')
    ]),action(6,1,2,[
      clicked(0,'https://example.net/different'),
      clicked(1,'https://example.net/two')
    ])]);
    assert.throws(()=>collectTrustedSourceEvidence(dirs),
      /Conflicting source destination/);
  })
);
