// Real PostgreSQL in memory; platform service adapters never make network calls.
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {readFile,readdir} from 'node:fs/promises';
const db=new PGlite({extensions:{pgcrypto}});
await db.exec(`
create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create schema storage;create schema vault;create schema extensions;create schema cron;create schema net;
grant usage on schema auth,storage,extensions to anon,authenticated,service_role;
create extension pgcrypto with schema extensions;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}',created_at timestamptz default now(),encrypted_password text,banned_until timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,created_at timestamptz default now(),updated_at timestamptz default now());
grant all on auth.users,auth.sessions to service_role;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}')$$;
create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;
create function auth.role() returns text language sql stable as $$select auth.jwt()->>'role'$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets,name text,owner uuid,owner_id text,metadata jsonb,created_at timestamptz default now(),updated_at timestamptz default now());
alter table storage.objects enable row level security;grant all on storage.buckets,storage.objects to service_role;grant select,insert,update,delete on storage.objects to authenticated;
create function storage.foldername(text) returns text[] language sql immutable as $$select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1]$$;
create table vault.secrets(id uuid primary key default gen_random_uuid(),name text,description text,secret text);
create view vault.decrypted_secrets as select id,name,description,secret as decrypted_secret from vault.secrets;
create function vault.create_secret(new_secret text,new_name text default null,new_description text default null) returns uuid language plpgsql as $$declare i uuid;begin insert into vault.secrets(name,description,secret) values(new_name,new_description,new_secret) returning id into i;return i;end$$;
create function vault.update_secret(secret_id uuid,new_secret text,new_name text default null,new_description text default null) returns void language sql as $$update vault.secrets set secret=new_secret,name=coalesce(new_name,name),description=coalesce(new_description,description) where id=secret_id$$;
create table cron.job(jobid bigserial primary key,jobname text unique,schedule text,command text,active boolean default true);
create function cron.schedule(p_name text,p_schedule text,p_command text) returns bigint language plpgsql as $$declare i bigint;begin insert into cron.job(jobname,schedule,command) values(p_name,p_schedule,p_command) on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command returning jobid into i;return i;end$$;
create function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 2000) returns bigint language sql as $$select 0::bigint$$;
create publication supabase_realtime;
`);
let passed=0;
for(const name of (await readdir('supabase/migrations')).filter(n=>n.endsWith('.sql')).sort()){
 let sql=await readFile('supabase/migrations/'+name,'utf8');
 // Only unavailable managed platform extension installers are omitted.
 sql=sql.replace(/create extension if not exists (supabase_vault|pg_cron|pg_net)[^;]*;/gi,'');
 try{await db.exec(sql);console.log('Migration passed: '+name);passed++;}catch(e){console.error('Migration failed: '+name+'\n'+e.message+'\n'+(e.where||'')+'\n'+(e.detail||''));await db.close();process.exit(1);}
}
const fixture=await readFile('tests/qualification-fixture.sql','utf8');
for(const name of ['v6_database.sql','v4_database.sql','v5_database.sql','v3_database.sql']){
 let sql=await readFile('tests/'+name,'utf8');
 sql=sql.replace(/begin;/i,()=> 'begin;\n'+fixture);
 try{await db.exec(sql);console.log('SQL suite passed: '+name);passed++;}catch(e){console.error('SQL suite failed: '+name+'\n'+e.message+'\n'+(e.where||'')+'\n'+(e.detail||''));await db.close();process.exit(1);}
}
await db.close();console.log(JSON.stringify({passed,platform_adapters:['Auth schema','unencrypted isolated Vault','Storage metadata','Cron metadata','HTTP stub'],external_requests:0}));
