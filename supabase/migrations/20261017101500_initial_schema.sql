-- Apply only to the dedicated Guest Posts SaaS project.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role, authenticated;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists supabase_vault with schema vault;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create table public.tenants (
  id uuid primary key default gen_random_uuid(), name text not null,
  created_at timestamptz not null default now()
);
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id),
  full_name text not null default '', email text not null,
  role text not null check(role in ('super_admin','admin','editor')),
  can_publish boolean not null default false, active boolean not null default true,
  created_at timestamptz not null default now(), unique(tenant_id,id)
);
create index profiles_tenant_idx on public.profiles(tenant_id);
create table public.tenant_invites (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
  email text not null unique, role text not null check(role in ('admin','editor')),
  can_publish boolean not null default false, created_at timestamptz not null default now()
);
create table public.settings (
  tenant_id uuid primary key references public.tenants(id),
  default_interval integer not null default 90 check(default_interval between 30 and 86400),
  max_attempts integer not null default 5 check(max_attempts between 1 and 10),
  workspace_name text not null default 'My publishing workspace'
);
create table public.websites (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
  owner_id uuid not null references public.profiles(id), website_name text not null check(length(website_name) between 1 and 200),
  website_url text not null, cms_type text not null default 'wordpress' check(cms_type='wordpress'),
  api_endpoint text not null, category text not null default '', language text not null default 'en',
  status text not null default 'active' check(status in ('active','disabled')),
  connection_status text not null default 'untested' check(connection_status in ('untested','connected','error','revoked')),
  connection_message text, tested_at timestamptz, min_interval_seconds integer not null default 90 check(min_interval_seconds between 30 and 86400),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(tenant_id,id), unique(tenant_id,website_url)
);
create index websites_owner_idx on public.websites(owner_id);
create table private.website_credentials (
  website_id uuid primary key references public.websites(id) on delete cascade,
  secret_id uuid not null, updated_at timestamptz not null default now()
);
alter table private.website_credentials enable row level security;
create table public.articles (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
  owner_id uuid not null references public.profiles(id), title text not null check(length(title) between 1 and 300),
  content text not null check(length(content)<=500000), meta_title text not null default '',
  meta_description text not null default '', slug text not null default '', focus_keyword text not null default '',
  featured_image text, category text not null default '', tags text[] not null default '{}',
  status text not null default 'draft' check(status in ('draft','review','approved')),
  approved_by uuid references public.profiles(id), approved_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(tenant_id,id)
);
create index articles_tenant_status_idx on public.articles(tenant_id,status);
create index articles_owner_idx on public.articles(owner_id);
create index articles_approver_idx on public.articles(approved_by);
create table public.campaigns (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
  owner_id uuid not null references public.profiles(id), campaign_name text not null,
  article_id uuid not null, article_snapshot jsonb not null,
  total_websites integer not null check(total_websites between 1 and 1000),
  publishing_interval_seconds integer not null check(publishing_interval_seconds between 30 and 86400),
  status text not null default 'running' check(status in ('running','paused','cancelled','completed')),
  start_time timestamptz not null, completed_at timestamptz,
  created_at timestamptz not null default now(), unique(tenant_id,id),
  foreign key(tenant_id,article_id) references public.articles(tenant_id,id),
  check(total_websites<100 or publishing_interval_seconds*(total_websites-1)>=7200)
);
create index campaigns_tenant_idx on public.campaigns(tenant_id,status);
create index campaigns_article_idx on public.campaigns(tenant_id,article_id);
create index campaigns_owner_idx on public.campaigns(owner_id);
create table public.publishing_jobs (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
  campaign_id uuid not null, article_id uuid not null, website_id uuid not null,
  ordinal integer not null, scheduled_at timestamptz not null,
  status text not null default 'scheduled' check(status in ('pending','scheduled','processing','published','failed','paused','cancelled')),
  attempts integer not null default 0, max_attempts integer not null default 5,
  error_message text, published_at timestamptz, published_url text,
  remote_post_id bigint, remote_slug text not null, needs_reconciliation boolean not null default false,
  remote_attempt_started boolean not null default false, lease_token uuid, lease_until timestamptz,
  response_info jsonb, overrides jsonb not null default '{}', created_at timestamptz not null default now(),
  unique(tenant_id,id), unique(campaign_id,website_id),
  foreign key(tenant_id,campaign_id) references public.campaigns(tenant_id,id),
  foreign key(tenant_id,article_id) references public.articles(tenant_id,id),
  foreign key(tenant_id,website_id) references public.websites(tenant_id,id)
);
create unique index one_global_processing_job on public.publishing_jobs((1)) where status='processing';
create unique index prevent_duplicate_publication on public.publishing_jobs(article_id,website_id) where status<>'cancelled';
create index jobs_due_idx on public.publishing_jobs(scheduled_at) where status in ('pending','scheduled');
create index jobs_tenant_idx on public.publishing_jobs(tenant_id,status);
create index jobs_campaign_idx on public.publishing_jobs(tenant_id,campaign_id);
create index jobs_article_idx on public.publishing_jobs(tenant_id,article_id);
create index jobs_website_idx on public.publishing_jobs(tenant_id,website_id);
create table public.publishing_logs (
  id bigint generated always as identity primary key, tenant_id uuid not null references public.tenants(id),
  job_id uuid, event_type text not null, message text not null, created_at timestamptz not null default now(),
  foreign key(tenant_id,job_id) references public.publishing_jobs(tenant_id,id)
);
create index logs_tenant_time_idx on public.publishing_logs(tenant_id,created_at desc);
create index logs_job_idx on public.publishing_logs(tenant_id,job_id);
create table private.worker_state (
  singleton boolean primary key default true check(singleton), active_job_id uuid,
  lease_token uuid, lease_until timestamptz, next_allowed_at timestamptz not null default now()
);
insert into private.worker_state(singleton) values(true);
alter table private.worker_state enable row level security;
create table private.runtime_config(singleton boolean primary key default true check(singleton), project_url text not null);
alter table private.runtime_config enable row level security;

create function private.tenant_id() returns uuid language sql stable security definer set search_path='' as $$
  select tenant_id from public.profiles where id=(select auth.uid()) and active and auth.uid() is not null
$$;
create function private.is_admin() returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select role in ('super_admin','admin') from public.profiles where id=(select auth.uid()) and active),false)
$$;
revoke all on function private.tenant_id(), private.is_admin() from public,anon;
grant execute on function private.tenant_id(),private.is_admin() to authenticated;

create function private.on_signup() returns trigger language plpgsql security definer set search_path='' as $$
declare t uuid; inv public.tenant_invites; r text; p boolean;
begin
  select * into inv from public.tenant_invites where email=lower(new.email) for update;
  if inv.id is not null then
    t:=inv.tenant_id; r:=inv.role; p:=inv.can_publish;
    delete from public.tenant_invites where id=inv.id;
  else
    insert into public.tenants(name) values('My publishing workspace') returning id into t;
    insert into public.settings(tenant_id) values(t);
    r:='super_admin'; p:=true;
  end if;
  insert into public.profiles(id,tenant_id,full_name,email,role,can_publish)
  values(new.id,t,left(coalesce(new.raw_user_meta_data->>'full_name',''),200),lower(new.email),r,p);
  return new;
end $$;
revoke all on function private.on_signup() from public,anon,authenticated;
create trigger create_profile after insert on auth.users for each row execute function private.on_signup();

do $$ declare t text; begin
  foreach t in array array['tenants','profiles','tenant_invites','settings','websites','articles','campaigns','publishing_jobs','publishing_logs'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    if t='tenants' then
      execute 'create policy tenant_read on public.tenants for select to authenticated using(id=(select private.tenant_id()))';
    elsif t='tenant_invites' then
      execute 'create policy tenant_read on public.tenant_invites for select to authenticated using(tenant_id=(select private.tenant_id()) and (select private.is_admin()))';
    else
      execute format('create policy tenant_read on public.%I for select to authenticated using(tenant_id=(select private.tenant_id()))',t);
    end if;
  end loop;
end $$;
grant all on all tables in schema private to service_role;
grant usage,select on all sequences in schema public to service_role;

-- Mutation RPCs run as service_role only; actor is supplied only by the authenticated Edge API.
create function public.store_credentials(p_website uuid,p_credentials jsonb) returns void language plpgsql set search_path='' as $$
declare s uuid;
begin
  select secret_id into s from private.website_credentials where website_id=p_website for update;
  if s is null then
    select vault.create_secret(p_credentials::text,'website-'||p_website::text) into s;
    insert into private.website_credentials(website_id,secret_id) values(p_website,s);
  else perform vault.update_secret(s,p_credentials::text); end if;
  update public.websites set connection_status='untested',tested_at=null,updated_at=now() where id=p_website;
end $$;
create function public.read_credentials(p_website uuid) returns jsonb language sql set search_path='' as $$
  select v.decrypted_secret::jsonb from private.website_credentials c join vault.decrypted_secrets v on v.id=c.secret_id where c.website_id=p_website
$$;
create function public.revoke_credentials(p_website uuid) returns void language plpgsql set search_path='' as $$
begin
  delete from vault.secrets where id=(select secret_id from private.website_credentials where website_id=p_website);
  delete from private.website_credentials where website_id=p_website;
  update public.websites set connection_status='revoked',status='disabled',tested_at=null where id=p_website;
end $$;
create function public.verify_worker_token(p_token text) returns boolean language sql set search_path='' as $$
  select exists(select 1 from vault.decrypted_secrets where name='scheduler_token' and decrypted_secret=p_token and length(p_token)>30)
$$;

create function public.create_campaign(p_actor uuid,p_article uuid,p_name text,p_sites uuid[],p_interval integer,p_start timestamptz,p_overrides jsonb default '{}')
returns uuid language plpgsql set search_path='' as $$
declare actor public.profiles; article public.articles; n integer; v_interval integer; c uuid; w uuid; idx integer:=0; jid uuid;
begin
  select * into actor from public.profiles where id=p_actor and active;
  if actor.id is null or not(actor.role in ('super_admin','admin') or actor.can_publish) then raise exception 'Publishing permission required'; end if;
  select * into article from public.articles where id=p_article and tenant_id=actor.tenant_id and status='approved' for share;
  if article.id is null then raise exception 'Select an approved article'; end if;
  n:=cardinality(p_sites);
  if n is null or n<1 or n>1000 or p_interval not between 30 and 86400 or p_start is null or length(trim(p_name)) not between 1 and 200 then raise exception 'Invalid campaign settings'; end if;
  if (select count(distinct x) from unnest(p_sites) x)<>n then raise exception 'Duplicate website selection'; end if;
  if (select count(*) from public.websites where id=any(p_sites) and tenant_id=actor.tenant_id and status='active' and connection_status='connected')<>n then raise exception 'Every website must be connected and enabled'; end if;
  if exists(select 1 from public.publishing_jobs where article_id=p_article and website_id=any(p_sites) and status<>'cancelled') then raise exception 'This article already has a job on a selected website; retry the existing job'; end if;
  v_interval:=greatest(p_interval,case when n>=100 then ceil(7200.0/(n-1))::integer else 30 end);
  insert into public.campaigns(tenant_id,owner_id,campaign_name,article_id,article_snapshot,total_websites,publishing_interval_seconds,start_time)
  values(actor.tenant_id,p_actor,trim(p_name),p_article,to_jsonb(article),n,v_interval,greatest(p_start,now())) returning id into c;
  foreach w in array p_sites loop
    jid:=gen_random_uuid();
    insert into public.publishing_jobs(id,tenant_id,campaign_id,article_id,website_id,ordinal,scheduled_at,max_attempts,remote_slug,overrides)
    values(jid,actor.tenant_id,c,p_article,w,idx,greatest(p_start,now())+make_interval(secs=>idx*v_interval),
      (select max_attempts from public.settings where tenant_id=actor.tenant_id),
      left(coalesce(nullif(article.slug,''),'article'),100)||'-gps-'||replace(jid::text,'-',''),coalesce(p_overrides->w::text,'{}'));
    idx:=idx+1;
  end loop;
  insert into public.publishing_logs(tenant_id,event_type,message) values(actor.tenant_id,'campaign_created',trim(p_name)||': '||n||' jobs, '||v_interval||' second interval');
  return c;
end $$;

create function public.control_campaign(p_actor uuid,p_campaign uuid,p_action text) returns void language plpgsql set search_path='' as $$
declare c public.campaigns; a public.profiles;
begin
  select * into a from public.profiles where id=p_actor and active;
  if a.id is null or not(a.role in ('super_admin','admin') or a.can_publish) then raise exception 'Permission denied'; end if;
  select * into c from public.campaigns where id=p_campaign and tenant_id=a.tenant_id for update;
  if c.id is null or c.status in ('cancelled','completed') then raise exception 'Campaign is not active'; end if;
  if p_action='pause' then
    update public.campaigns set status='paused' where id=c.id;
    update public.publishing_jobs set status='paused' where campaign_id=c.id and status in ('pending','scheduled');
  elsif p_action='resume' then
    update public.campaigns set status='running' where id=c.id;
    update public.publishing_jobs set status='scheduled' where campaign_id=c.id and status='paused';
  elsif p_action='cancel' then
    update public.campaigns set status='cancelled',completed_at=now() where id=c.id;
    update public.publishing_jobs set status='cancelled' where campaign_id=c.id and status in ('pending','scheduled','paused','failed');
  else raise exception 'Invalid campaign action'; end if;
  insert into public.publishing_logs(tenant_id,event_type,message) values(a.tenant_id,'campaign_'||p_action,c.campaign_name);
end $$;
create function public.retry_job(p_actor uuid,p_job uuid) returns void language plpgsql set search_path='' as $$
declare j public.publishing_jobs; a public.profiles;
begin
  select * into a from public.profiles where id=p_actor and active;
  if a.id is null or not(a.role in ('super_admin','admin') or a.can_publish) then raise exception 'Permission denied'; end if;
  select * into j from public.publishing_jobs where id=p_job and tenant_id=a.tenant_id for update;
  if j.id is null or j.status<>'failed' then raise exception 'Only failed jobs can be retried'; end if;
  if (select status from public.campaigns where id=j.campaign_id)='cancelled' then raise exception 'Campaign is cancelled'; end if;
  update public.campaigns set status='running',completed_at=null where id=j.campaign_id;
  update public.publishing_jobs set status='scheduled',scheduled_at=greatest(scheduled_at,now()),max_attempts=attempts+5,error_message=null where id=j.id;
  insert into public.publishing_logs(tenant_id,job_id,event_type,message) values(a.tenant_id,j.id,'manual_retry','Retry requested; unknown outcomes will only be reconciled.');
end $$;

create function public.claim_next_job() returns jsonb language plpgsql set search_path='' as $$
declare s private.worker_state; j public.publishing_jobs; c public.campaigns; token uuid; wait_seconds integer;
begin
  select * into s from private.worker_state where singleton for update;
  if s.active_job_id is not null then
    if s.lease_until>now() then return null; end if;
    update public.publishing_jobs set status='failed',needs_reconciliation=remote_attempt_started,
      error_message='Worker lease expired. Reconcile the remote outcome before retrying.',lease_until=null where id=s.active_job_id and status='processing';
    insert into public.publishing_logs(tenant_id,job_id,event_type,message)
      select tenant_id,id,'lease_expired','Worker interrupted; remote outcome requires review.' from public.publishing_jobs where id=s.active_job_id;
    update private.worker_state set active_job_id=null,lease_until=null,lease_token=null,next_allowed_at=greatest(next_allowed_at,now()+interval '90 seconds') where singleton;
    return null;
  end if;
  if s.next_allowed_at>now() then return null; end if;
  select j0.* into j from public.publishing_jobs j0
    join public.campaigns c0 on c0.id=j0.campaign_id
    join public.websites w on w.id=j0.website_id
    where j0.status in ('pending','scheduled') and j0.scheduled_at<=now() and c0.status='running'
      and w.status='active' and w.connection_status='connected'
    order by j0.scheduled_at,j0.ordinal limit 1 for update of j0 skip locked;
  if j.id is null then return null; end if;
  select * into c from public.campaigns where id=j.campaign_id for update;
  if c.status<>'running' then return null; end if;
  token:=gen_random_uuid();
  update public.publishing_jobs set status='processing',attempts=attempts+1,lease_token=token,lease_until=now()+interval '3 minutes' where id=j.id returning * into j;
  update private.worker_state set active_job_id=j.id,lease_token=token,lease_until=j.lease_until where singleton;
  insert into public.publishing_logs(tenant_id,job_id,event_type,message) values(j.tenant_id,j.id,'processing','Job claimed by background worker.');
  return jsonb_build_object('job',to_jsonb(j),'campaign',to_jsonb(c),'website',(select to_jsonb(w) from public.websites w where id=j.website_id));
end $$;
create function public.mark_remote_attempt(p_job uuid,p_token uuid) returns boolean language plpgsql set search_path='' as $$
begin
  update public.publishing_jobs set remote_attempt_started=true where id=p_job and status='processing' and lease_token=p_token and lease_until>now();
  return found;
end $$;
create function public.save_remote_id(p_job uuid,p_token uuid,p_remote_id bigint) returns boolean language plpgsql set search_path='' as $$
begin
  update public.publishing_jobs set remote_post_id=p_remote_id,needs_reconciliation=false where id=p_job and status='processing' and lease_token=p_token and lease_until>now();
  return found;
end $$;
create function public.finish_job(p_job uuid,p_token uuid,p_result jsonb) returns void language plpgsql set search_path='' as $$
declare j public.publishing_jobs; c public.campaigns; gap integer; target_status text; delay_seconds integer;
begin
  perform 1 from private.worker_state where singleton and active_job_id=p_job and lease_token=p_token for update;
  if not found then raise exception 'Expired worker token'; end if;
  select * into j from public.publishing_jobs where id=p_job and lease_token=p_token and status='processing' for update;
  if j.id is null then raise exception 'Job is not claimed'; end if;
  select * into c from public.campaigns where id=j.campaign_id;
  gap:=greatest(c.publishing_interval_seconds,(select min_interval_seconds from public.websites where id=j.website_id));
  delay_seconds:=greatest(gap,least(604800,coalesce((p_result->>'retry_after')::integer,0)),least(86400,(60*power(2,least(j.attempts,10)))::integer));
  if coalesce((p_result->>'success')::boolean,false) then target_status:='published';
  elsif coalesce((p_result->>'retryable')::boolean,false) and j.attempts<j.max_attempts and c.status<>'cancelled' and not coalesce((p_result->>'uncertain')::boolean,false) then
    target_status:=case when c.status='paused' then 'paused' else 'scheduled' end;
  else target_status:='failed'; end if;
  update public.publishing_jobs set status=target_status,
    published_at=case when target_status='published' then now() else null end,
    published_url=p_result->>'url',response_info=p_result->'info',error_message=left(p_result->>'error',1000),
    needs_reconciliation=coalesce((p_result->>'uncertain')::boolean,false),lease_until=null,
    scheduled_at=case when target_status in ('scheduled','paused') then greatest(scheduled_at,now()+make_interval(secs=>delay_seconds)) else scheduled_at end
    where id=j.id;
  update private.worker_state set active_job_id=null,lease_token=null,lease_until=null,
    next_allowed_at=now()+make_interval(secs=>greatest(gap,least(604800,coalesce((p_result->>'retry_after')::integer,0)))) where singleton;
  insert into public.publishing_logs(tenant_id,job_id,event_type,message)
    values(j.tenant_id,j.id,target_status,case when target_status='published' then 'Published successfully.' else coalesce(left(p_result->>'error',1000),'Publication failed.') end);
  if c.status='running' and not exists(select 1 from public.publishing_jobs where campaign_id=c.id and status in ('pending','scheduled','paused','processing')) then
    update public.campaigns set status='completed',completed_at=now() where id=c.id;
  end if;
end $$;

-- Cron can read Vault, but no browser role can read credentials or worker secrets.
create function private.tick() returns void language plpgsql set search_path='' as $$
begin
  perform net.http_post(
    url:=(select project_url from private.runtime_config where singleton)||'/functions/v1/publish-worker',
    headers:=jsonb_build_object('Content-Type','application/json','x-scheduler-token',(select decrypted_secret from vault.decrypted_secrets where name='scheduler_token')),
    body:='{}'::jsonb,timeout_milliseconds:=120000);
end $$;
revoke all on function private.tick() from public,anon,authenticated,service_role;
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('store_credentials','read_credentials','revoke_credentials','verify_worker_token','create_campaign','control_campaign','retry_job','claim_next_job','mark_remote_attempt','save_remote_id','finish_job') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;

-- Realtime is read-only for members, governed by the same SELECT RLS policies.
alter publication supabase_realtime add table public.publishing_jobs,public.campaigns,public.websites,public.articles;


