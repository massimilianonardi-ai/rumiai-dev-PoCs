// Reproducible consumer example: compiler, independent loader, optional one-file packaging.
import {spawnSync} from 'node:child_process';
import {copyFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url));
const here=fileURLToPath(new URL('./',import.meta.url));
if(process.argv.length>3||process.argv[2]==='--help'){
 console.log('usage: node example/workflow/build.mjs [output-directory]');
 process.exit(process.argv[2]==='--help'?0:2);
}
const dest=process.argv[2]?resolve(process.argv[2]):join(here,'dist');
await mkdir(dest,{recursive:true});
function build(tool,manifest,output){
 const cli=join(root,'src',tool),input=join(here,'modules',manifest+'.json');
 const result=spawnSync(process.execPath,[cli,input,join(dest,output)],{encoding:'utf8'});
 if(result.status!==0)throw Error(tool+' '+manifest+': '+result.stderr.trim());
}
build('jsc.mjs','base','initial.js');
build('jsc.mjs','optional','optional.js');
build('jsc.mjs','patch','patch.js');
build('assemble.mjs','all','bundle-all.js');
await Promise.all([
 copyFile(join(root,'src/loader.js'),join(dest,'loader.js')),
 copyFile(join(here,'client.js'),join(dest,'client.js')),
 copyFile(join(here,'dev.html'),join(dest,'dev.html')),
 copyFile(join(here,'release.html'),join(dest,'release.html'))
]);
console.log('workflow: generated dev.html and release.html at '+dest);
