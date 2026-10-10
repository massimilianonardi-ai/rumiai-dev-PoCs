// Two independently versioned, private local npm tarballs from one experimental PoC.
// No npm registry, publishing, production installation or generated copy in Git.
import {mkdtemp,mkdir,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const here=fileURLToPath(new URL('./',import.meta.url));
if(process.argv.length>3||process.argv[2]==='--help'){
 console.log('usage: node distribution/build.mjs [output-directory]');
 process.exit(process.argv[2]==='--help'?0:2);
}
const output=process.argv[2]?resolve(process.argv[2]):join(here,'dist');
const staging=await mkdtemp(join(tmpdir(),'jsc-release-pack-'));
try{
 await mkdir(output,{recursive:true});
 for(const entry of [
  {id:'jsc',sources:[['src/jsc.mjs','bin/jsc.mjs'],['src/assemble.mjs','bin/assemble.mjs']]},
  {id:'dynamic-loader',sources:[['src/loader.js','loader.js']]}
 ]){
  const target=join(staging,entry.id);
  await mkdir(target,{recursive:true});
  for(const [source,dest] of entry.sources){
   await mkdir(join(target,...dest.split('/').slice(0,-1)),{recursive:true});
   await copyFile(join(root,source),join(target,dest));
  }
  await copyFile(join(here,entry.id,'README.md'),join(target,'README.md'));
  const pkg=JSON.parse(await readFile(join(here,entry.id,'package.json'),'utf8'));
  if(pkg.private!==true||pkg.version!=='0.0.0-poc.1')throw Error('experimental package must remain private/prerelease: '+entry.id);
  await writeFile(join(target,'package.json'),JSON.stringify(pkg,null,2)+'\n');
  const result=spawnSync('npm',['pack',target,'--json','--ignore-scripts','--pack-destination',output],
   {encoding:'utf8',timeout:60000});
  if(result.status!==0)throw Error('npm pack '+entry.id+' failed: '+result.stderr+'\n'+result.stdout);
  const parsed=JSON.parse(result.stdout);
  if(parsed.length!==1||parsed[0].name!==pkg.name||parsed[0].version!==pkg.version)
   throw Error('unexpected npm tarball metadata for '+entry.id);
  console.log(pkg.name+'@'+pkg.version+': '+join(output,parsed[0].filename));
 }
}finally{await rm(staging,{recursive:true,force:true});}
