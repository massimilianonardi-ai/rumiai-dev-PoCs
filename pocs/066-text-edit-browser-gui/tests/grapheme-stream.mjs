// PoC-only experiment for CellDocument2D's UTF-16 streaming carry policy.
// It models its current scan/flush rules without altering the product.
import assert from 'node:assert/strict';

const segmenter = new Intl.Segmenter(undefined, {granularity:'grapheme'});

function scan(text, chunkSizes, keepPrecedingCluster)
{
  const result = [];
  let carry = '';
  let carryStart = 0;
  let offset = 0;
  let nextChunk = 0;

  function flush(final)
  {
    if(!carry.length) return;

    const parts = [...segmenter.segment(carry)];
    let keep = final ? 0 : 1;
    // A lone trailing high surrogate is not yet a complete scalar.
    // The preceding cluster may join the completed scalar (e.g. ZWJ
    // pictograph, regional indicator). Retain both until completion.
    if(!final && keepPrecedingCluster)
    {
      const last = carry.charCodeAt(carry.length - 1);
      if(last >= 0xd800 && last <= 0xdbff) keep = 2;
    }
    const count = Math.max(0, parts.length - keep);
    for(let i = 0; i < count; i++)
    {
      const item = parts[i];
      result.push({
        text:item.segment,
        start:carryStart + item.index,
        end:carryStart + item.index + item.segment.length
      });
    }

    if(final) carry = '';
    else
    {
      const tail = parts[count];
      if(tail)
      {
        carry = carry.slice(tail.index);
        carryStart += tail.index;
      }
      else
      {
        carryStart += carry.length;
        carry = '';
      }
    }
  }

  while(offset < text.length)
  {
    const size = chunkSizes[nextChunk++ % chunkSizes.length];
    const next = Math.min(text.length, offset + size);
    if(!carry.length) carryStart = offset;
    carry += text.slice(offset, next);
    offset = next;
    flush(offset === text.length);
  }
  flush(true);
  return result;
}

function expected(text)
{
  return [...segmenter.segment(text)].map(part => ({
    text:part.segment,
    start:part.index,
    end:part.index + part.segment.length
  }));
}

const cases = [
  'A😀Be\u0301\tZ\u0001👩‍💻',
  '👩‍💻',
  '👨‍👩‍👧‍👦',
  '👩🏽‍🚀',
  '🇮🇹🇪🇺🇫🇷',
  'e\u0301😀👩‍💻🇮🇹e\u0301',
  'क्‍ष',
  'a\u0301\u0302\u0303\u0304\u0305\u0306',
  'x\uD83D',
  'x\uDCBB',
  ...[2045,2046,2047,2048,2049,2050].flatMap(
    n => ['👩‍💻','🇮🇹','e\u0301','👨‍👩‍👧‍👦'].map(
      text => 'a'.repeat(n) + text + 'z'
    )
  )
];
const chunkPlans = [[1],[2],[3],[7],[2048],[2047],[2049],[1,2048],[2048,1]];
let comparisons = 0;

for(const value of cases)
{
  for(const plan of chunkPlans)
  {
    assert.deepEqual(
      scan(value, plan, true), expected(value),
      'stream mismatch plan=' + plan + ' text=' +
      JSON.stringify(value.slice(-35))
    );
    comparisons++;
  }
}

const baseline = scan('👩‍💻', [1], false).map(unit => unit.text);
assert.deepEqual(baseline, ['👩‍','💻'],
  'must reproduce the actual scanner weakness');
const corrected = scan('👩‍💻', [1], true).map(unit => unit.text);
assert.deepEqual(corrected, ['👩‍💻']);

console.log(JSON.stringify({
  status:'PASS', comparisons, baselineZWJ:baseline, correctedZWJ:corrected,
  scope:'standalone carry/flush prototype; not compiled Document2D'
}));
