import {readdirSync,readFileSync} from 'node:fs';
import {join,relative} from 'node:path';
const root='supabase/functions';
const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]);
console.log(JSON.stringify(walk(root).filter(f=>/\.(ts|json|jsonc)$/.test(f)&&!f.endsWith('deno.lock')).map(f=>({name:relative(root,f).replaceAll('\\','/'),content:readFileSync(f,'utf8')}))));
