import {mkdir,cp,readFile,readdir,stat,writeFile} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve('.'),stage=join(root,'.local','release-source');
await mkdir(stage,{recursive:true});
const entries=['.env.example','.gitignore','.github','index.html','vite.config.js','package.json','package-lock.json','README.md','DEPLOYMENT.md','TEST-RESULTS.md','src','public','scripts','supabase','tests','docs','wordpress'];
for(const name of entries)await cp(join(root,name),join(stage,name),{recursive:true,force:true,filter:src=>!/[\\/](node_modules|\.temp|\.local|\.git)([\\/]|$)/.test(src)});
const walk=async dir=>{let files=[];for(const entry of await readdir(dir,{withFileTypes:true})){const full=join(dir,entry.name);files.push(...(entry.isDirectory()?await walk(full):[full]));}return files;};
const files=await walk(stage);const manifest=[];
for(const file of files){const bytes=await readFile(file);manifest.push({path:relative(stage,file).replaceAll('\\','/'),bytes:(await stat(file)).size,sha256:createHash('sha256').update(bytes).digest('hex')});}
await writeFile(join(root,'.local','release-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({source_stage:stage,files:files.length,manifest:'.local/release-manifest.json'}));
