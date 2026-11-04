// PoC 066: direct compact presentation from *aggregated* Raw getRegions.
// This is a candidate producer, NOT a public Document2D API.
(function()
{
'use strict';

function display(unit)
{
  const code=unit.charCodeAt(0);
  if(code>=0xd800 && code<=0xdbff) return 'H';
  if(code>=0xdc00 && code<=0xdfff) return 'L';
  if(unit==='\t') return '⇥';
  if(code===0x200d) return 'ZWJ';
  if(code===0x200c) return 'ZWNJ';
  if(code===0x200b) return 'ZWSP';
  if(/^\p{Mark}$/u.test(unit)) return '◌'+unit;
  if(code<32 || code===127) return '·';
  return unit;
}

function packRawRows(rows)
{
  return rows.map(regions=>regions.map(region=>
  {
    if(region.kind!=='text')
    {
      throw new TypeError('direct compact input requires Raw text runs');
    }
    const row=region.start.row;
    const col=region.start.col;
    const count=region.text.length;
    if(row!==region.end.row || count!==region.end.col-col || count<1)
    {
      throw new RangeError('invalid aggregated Raw extent');
    }
    if(count===1) return {...region,displayText:display(region.text)};

    const cells=new Array(count);
    const glyphs=[];
    for(let index=0;index<count;index++)
    {
      const unit=region.text[index];
      cells[index]=[index+1,index+1];
      const glyph=display(unit);
      if(glyph!==unit) glyphs.push([index,glyph]);
    }
    const packed={
      kind:'text',text:region.text,
      start:{row,col},end:{row,col:region.end.col},cells
    };
    if(glyphs.length) packed.glyphs=glyphs;
    return packed;
  }));
}
globalThis.__presentationDirect=Object.freeze({packRawRows});
})();
