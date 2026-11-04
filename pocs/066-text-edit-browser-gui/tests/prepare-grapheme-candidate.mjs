// PoC-only preparation: modify a disposable COPY of the shipped Cell source.
// Never run this against the product checkout; CI stages core in RUNNER_TEMP.
import {readFileSync, writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';

const target=process.argv[2];
assert.ok(target && target.includes('text-edit-candidate-core/'),
  'only the disposable candidate-core copy may be patched');
const source=readFileSync(target,'utf8');
const original='const count = final ? parts.length : Math.max(0, parts.length - 1);';
assert.equal(source.split(original).length,2,
  'candidate anchor must match exactly once in current CellDocument2D');
const replacement=`// Experiment: a trailing high surrogate may join the preceding
      // grapheme when its low surrogate arrives in the next input region.
      const lastUnit = carry.charCodeAt(carry.length - 1);
      const retain = !final && lastUnit >= 0xd800 && lastUnit <= 0xdbff ?
        2 : 1;
      const count = final ? parts.length : Math.max(0, parts.length - retain);`;
writeFileSync(target,source.replace(original,replacement));
console.log('PoC candidate Cell scanner staged; product checkout unchanged.');
