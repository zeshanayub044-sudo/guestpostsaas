import {mkdir,cp,readFile,readdir,stat,writeFile,rm} from 'node:fs/promises';
import {resolve,join,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve('.'),stage=join(root,'.local','release-source-v5');
if(!stage.startsWith(join(root,'.local')+sep)||stage===root)throw new Error('Unsafe staging directory.');
await rm(stage,{recursive:true,force:true});
await mkdir(stage,{recursive:true});
const entries=['.env.example','.gitignore','.dockerignore','.github','index.html','vite.config.js','package.json','package-lock.json','README.md','DEPLOYMENT.md','TEST-RESULTS.md','src','public','scripts','supabase','tests','docs','wordpress','drupal','browser-worker'];
for(const name of entries)await cp(join(root,name),join(stage,name),{recursive:true,force:true,filter:src=>!/[\\/](node_modules|\.temp|\.local|\.git|diagnostics)([\\/]|$)/.test(src)&&(!/[\\/]\.env(?:\.|$)/.test(src)||src.endsWith('.env.example'))&&!/storage-state.*\.json$/.test(src)&&!/[\\/]docs[\\/].*\.(png|jpe?g|webp|gif|pdf|zip)$/i.test(src)});
const walk=async dir=>{let files=[];for(const entry of await readdir(dir,{withFileTypes:true})){const full=join(dir,entry.name);files.push(...(entry.isDirectory()?await walk(full):[full]));}return files;};
const files=await walk(stage);const manifest=[];
for(const file of files){const bytes=await readFile(file);manifest.push({path:relative(stage,file).replaceAll('\\','/'),bytes:(await stat(file)).size,sha256:createHash('sha256').update(bytes).digest('hex')});}
await writeFile(join(root,'.local','release-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({source_stage:stage,files:files.length,manifest:'.local/release-manifest.json'}));
