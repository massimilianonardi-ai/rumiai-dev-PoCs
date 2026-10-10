// PoC Node adapter for the same Promise-based journal port as services/browser.
// No atomicity, crash recovery or guarantees across concurrent writers.
import * as fs from 'node:fs/promises';
const SLOT=16;
async function writeExact(fd,b,at) {
  let offset=0;
  while(offset<b.length){const {bytesWritten}=await fd.write(b,offset,b.length-offset,at+offset);if(bytesWritten<=0)throw Error('short write');offset+=bytesWritten;}
}
async function readExact(fd,b,at) {
  let offset=0;
  while(offset<b.length){const {bytesRead}=await fd.read(b,offset,b.length-offset,at+offset);if(bytesRead<=0)throw Error('truncated journal');offset+=bytesRead;}
}
export class NodeAsyncFileJournal {
  constructor(prefix,data,index,count,end){this.prefix=prefix;this.data=data;this.index=index;this.records=count;this.end=end;}
  static async open(prefix,{create=true}={}) {
    const data=await fs.open(prefix+'.data',create?'wx+':'r+');
    let index;
    try {
      index=await fs.open(prefix+'.index',create?'wx+':'r+');
      const size=(await index.stat()).size;
      if(size%SLOT)throw Error('misaligned index');
      const count=size/SLOT;
      let end=0;
      if(count){const meta=Buffer.alloc(SLOT);await readExact(index,meta,(count-1)*SLOT);end=Number(meta.readBigUInt64LE(0)+meta.readBigUInt64LE(8));}
      if(end>(await data.stat()).size)throw Error('data truncated');
      return new NodeAsyncFileJournal(prefix,data,index,count,end);
    } catch(e) {await index?.close();await data.close();throw e;}
  }
  async count(){return this.records;}
  async read(i){
    if(!Number.isSafeInteger(i)||i<0||i>=this.records)throw RangeError('journal index');
    const meta=Buffer.alloc(SLOT);await readExact(this.index,meta,i*SLOT);
    const at=Number(meta.readBigUInt64LE(0)),len=Number(meta.readBigUInt64LE(8));
    if(!Number.isSafeInteger(at)||!Number.isSafeInteger(len)||len>32*1048576)throw Error('invalid record size');
    const payload=Buffer.alloc(len);await readExact(this.data,payload,at);
    return JSON.parse(payload.toString('utf8'));
  }
  async appendAt(i,entry){
    if(!Number.isSafeInteger(i)||i<0||i>this.records)throw RangeError('append index');
    const payload=Buffer.from(JSON.stringify(entry),'utf8');
    if(payload.length>32*1048576)throw RangeError('record too long (PoC guardrail)');
    let at=this.end;
    if(i<this.records){
      if(i===0)at=0;
      else {const meta=Buffer.alloc(SLOT);await readExact(this.index,meta,(i-1)*SLOT);at=Number(meta.readBigUInt64LE(0)+meta.readBigUInt64LE(8));}
      await this.index.truncate(i*SLOT);await this.data.truncate(at);
    }
    await writeExact(this.data,payload,at);
    const meta=Buffer.alloc(SLOT);meta.writeBigUInt64LE(BigInt(at),0);meta.writeBigUInt64LE(BigInt(payload.length),8);
    await writeExact(this.index,meta,i*SLOT);
    this.records=i+1;this.end=at+payload.length;
  }
  async readSession(){
    try{return JSON.parse(await fs.readFile(this.prefix+'.session','utf8'));}
    catch(e){if(e.code==='ENOENT')return null;throw e;}
  }
  async writeSession(meta){await fs.writeFile(this.prefix+'.session',JSON.stringify(meta),'utf8');}
  async close(){await this.data.close();await this.index.close();}
}
