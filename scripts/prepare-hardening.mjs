import {readFileSync,writeFileSync} from 'node:fs';
const schema=readFileSync('supabase/schema.sql','utf8');
const names=['create_campaign','control_campaign','retry_job','claim_next_job','finish_job'];
let delta=names.map(name=>{const start=schema.indexOf('create function public.'+name+'(');const end=schema.indexOf('$$;',start)+3;return schema.slice(start,end).replace('create function','create or replace function');}).join('\n');
delta+='\ndrop index public.prevent_duplicate_publication;\n'+schema.match(/create unique index prevent_duplicate_publication[^;]+;/)[0];
for(const name of ['website_credentials','worker_state','runtime_config'])delta+=`\ndrop policy if exists service_only on private.${name}; create policy service_only on private.${name} for all to service_role using(true) with check(true);`;
writeFileSync('supabase/hardening.sql',delta);
console.log('Hardening migration prepared.');
