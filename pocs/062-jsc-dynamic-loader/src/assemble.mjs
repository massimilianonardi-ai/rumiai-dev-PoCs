#!/usr/bin/env node
// Experimental packaging convenience, deliberately separate from the jsc compiler and runtime.
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {argv} from 'node:process';
import {fileURLToPath} from 'node:url';
import {Script} from 'node:vm';

if (argv.length !== 4 && argv.length !== 5) {
  console.error('usage: node src/assemble.mjs manifest.json self-contained-output.js [independent-loader.js]');
  process.exitCode = 1;
} else {
  const tmp=await mkdtemp(join(tmpdir(),'jsc-pack-'));
  try {
    const compiled=join(tmp,'compiled.js');
    const compiler=spawnSync(process.execPath,[fileURLToPath(new URL('./jsc.mjs',import.meta.url)),argv[2],compiled],{encoding:'utf8'});
    if(compiler.status!==0)throw Error('compiler failed: '+compiler.stderr.trim());
    const [runtime,source]=await Promise.all([
      readFile(argv.length === 5 ? resolve(argv[4]) : new URL('./loader.js',import.meta.url),'utf8'),
      readFile(compiled,'utf8')
    ]);
    const result=runtime+'\n'+source;
    new Script(result,{filename:argv[3]});
    await writeFile(resolve(argv[3]),result);
    process.stdout.write('assemble: independent classic runtime + compiled registrations, '+Buffer.byteLength(result)+' bytes\n');
  } catch (error) {
    console.error('assemble:',error.message);
    process.exitCode=2;
  } finally {await rm(tmp,{recursive:true,force:true});}
}
