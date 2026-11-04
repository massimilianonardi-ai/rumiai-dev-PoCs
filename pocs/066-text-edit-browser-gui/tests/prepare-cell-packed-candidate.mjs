// Experimental edit to a disposable copy of actual CellDocument2D.js.
// Adds a PoC-only packed output method directly around its REAL #scanRow
// visitor, avoiding the detached public getRegions array altogether.
// This is not a released method and must never modify the product tree.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';

const path=process.argv[2];
assert.ok(path && path.includes('text-edit-candidate-core/'),
  'only the temporary candidate core may be instrumented');
assert.ok(path.endsWith('/m/text/document/CellDocument2D.js'),
  'the candidate must patch exactly CellDocument2D');
const original=readFileSync(path,'utf8');
const anchor='  getRect(rowStart, colStart, rowEnd, colEnd)\n  {';
assert.equal(original.split(anchor).length,2,
  'CellDocument2D code shape changed; review before instrumentation');
assert.ok(original.includes('  #scanRow(row, visitor)'),
  'real Cell scanner must be present');
assert.ok(!original.includes('__pocPackRegions('),
  'candidate method already installed');

const method=String.raw`
  // Experimental full-region semantics with direct visitor-to-packed-runs.
  // No public per-grapheme region array is produced as an intermediate.
  __pocPackRegions(rowStart, colStart, rowEnd, colEnd)
  {
    const input=this.#active();
    if(![rowStart,colStart,rowEnd,colEnd].every(
      n=>Number.isSafeInteger(n) && n>=0
    ) || rowEnd<rowStart || colEnd<colStart)
    {
      throw new RangeError('invalid PoC packed cell window');
    }

    const rows=[];
    for(let row=rowStart;row<Math.min(rowEnd,input.rowCount);row++)
    {
      const regions=[];
      let run=null;

      const flush=()=>
      {
        if(!run) return;
        if(run.cells.length===1)
        {
          delete run.cells;
        }
        regions.push(run);
        run=null;
      };

      if(colStart<colEnd)
      {
        this.#scanRow(row,cell=>
        {
          const overlay=cell.kind==='annotation';
          const visible=overlay ?
            cell.start.col>=colStart && cell.start.col<colEnd :
            cell.end.col>colStart;

          if(visible)
          {
            if(cell.kind==='text' &&
              cell.start.row===cell.end.row)
            {
              if(run && (run.end.row!==cell.start.row ||
                run.end.col!==cell.start.col))
              {
                flush();
              }
              if(!run)
              {
                run={
                  kind:'text',text:'',
                  start:{...cell.start},end:{...cell.end},
                  cells:[]
                };
              }
              run.text+=cell.text;
              run.end={...cell.end};
              run.cells.push([
                cell.end.col-run.start.col,run.text.length
              ]);
            }
            else
            {
              flush();
              const record={
                kind:cell.kind,text:cell.text,
                start:{...cell.start},end:{...cell.end}
              };
              if(cell.id!==undefined) record.id=cell.id;
              regions.push(record);
            }
          }

          return (overlay ? cell.start.col : cell.end.col)<colEnd;
        });
      }

      flush();
      rows.push(regions);
    }
    return rows;
  }

`;
writeFileSync(path,original.replace(anchor,method+anchor));
console.log('PoC direct Cell packer instrumented in disposable core only.');
