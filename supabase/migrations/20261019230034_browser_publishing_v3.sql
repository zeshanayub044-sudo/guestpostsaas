-- V3 is additive. Existing accounts, connections, campaigns and history are preserved.
alter table public.websites add column connection_method text not null default 'api' check(connection_method in ('api','browser')),
  add column connection_version integer not null default 1,
  add column connection_report jsonb not null default '{}';
alter table public.websites drop constraint websites_connection_status_check;
alter table public.websites add constraint websites_connection_status_check check(connection_status in ('untested','connected','error','revoked','authorization_required','limited','unsupported','manual','setup_required','checking'));
update public.websites set connection_status='setup_required',connection_message='Configure an authorized API connector or a permitted browser workflow.' where connection_status in ('manual','unsupported');
update public.websites set cms_type='custom' where cms_type='manual';
alter table public.publishing_jobs add column browser_worker_id uuid, add column payload_fingerprint text;
update public.publishing_jobs j set payload_fingerprint=md5(coalesce(j.overrides->>'content',c.article_snapshot->>'content','')) from public.campaigns c where c.id=j.campaign_id;
alter table public.publishing_jobs alter payload_fingerprint set not null;
create index jobs_immutable_payload_idx on public.publishing_jobs(tenant_id,website_id,payload_fingerprint);

create table public.browser_workers(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),name text not null,active boolean not null default true,last_seen_at timestamptz,version text,created_at timestamptz not null default now());
create index browser_workers_tenant_idx on public.browser_workers(tenant_id);
alter table public.browser_workers enable row level security;
create policy worker_tenant_read on public.browser_workers for select to authenticated using(tenant_id=(select private.tenant_id()));
revoke all on public.browser_workers from public,anon,authenticated;
grant select on public.browser_workers to authenticated;
grant all on public.browser_workers to service_role;
create table private.browser_worker_keys(worker_id uuid primary key references public.browser_workers(id),token_hash text not null unique check(length(token_hash)=64));
alter table private.browser_worker_keys enable row level security;
create policy worker_keys_service on private.browser_worker_keys for all to service_role using(true) with check(true);
revoke all on private.browser_worker_keys from public,anon,authenticated;
grant all on private.browser_worker_keys to service_role;
alter table public.publishing_jobs add foreign key(browser_worker_id) references public.browser_workers(id);
create table public.connection_checks(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),website_id uuid not null references public.websites(id) on delete cascade,connection_version integer not null,status text not null default 'queued' check(status in ('queued','processing','verified','failed','superseded')),worker_id uuid references public.browser_workers(id),lease_token uuid,lease_until timestamptz,error_code text,created_at timestamptz not null default now(),completed_at timestamptz);
create index checks_due_idx on public.connection_checks(created_at) where status='queued';
create index checks_tenant_idx on public.connection_checks(tenant_id,website_id);
create index checks_worker_idx on public.connection_checks(worker_id);
create unique index one_current_check on public.connection_checks(website_id) where status in ('queued','processing');
alter table public.connection_checks enable row level security;
create policy checks_tenant_read on public.connection_checks for select to authenticated using(tenant_id=(select private.tenant_id()));
revoke all on public.connection_checks from public,anon,authenticated;
grant select on public.connection_checks to authenticated;
grant all on public.connection_checks to service_role;

create function public.register_browser_worker(p_actor uuid,p_name text,p_hash text) returns uuid language plpgsql set search_path='' as $$
declare a public.profiles; wid uuid;
begin
  select * into a from public.profiles where id=p_actor and active and role in ('admin','super_admin');
  if a.id is null or p_hash !~ '^[a-f0-9]{64}$' or length(trim(p_name)) not between 1 and 100 then raise exception 'Worker registration denied'; end if;
  perform 1 from public.tenants where id=a.tenant_id for update;
  if (select count(*) from public.browser_workers where tenant_id=a.tenant_id and active)>=5 then raise exception 'Revoke an unused worker before registering another'; end if;
  insert into public.browser_workers(tenant_id,name) values(a.tenant_id,trim(p_name)) returning id into wid;
  insert into private.browser_worker_keys values(wid,p_hash);return wid;
end $$;
create function public.authenticate_browser_worker(p_hash text,p_version text) returns jsonb language plpgsql set search_path='' as $$
declare w public.browser_workers;
begin
  select b.* into w from public.browser_workers b join private.browser_worker_keys k on k.worker_id=b.id where k.token_hash=p_hash and b.active;
  if w.id is null then return null; end if;
  update public.browser_workers set last_seen_at=now(),version=left(p_version,40) where id=w.id;
  return to_jsonb(w);
end $$;
create function public.enqueue_browser_check(p_actor uuid,p_website uuid) returns uuid language plpgsql set search_path='' as $$
declare w public.websites; cid uuid;
begin
  select w0.* into w from public.websites w0 join public.profiles a on a.tenant_id=w0.tenant_id where a.id=p_actor and a.active and a.role in ('admin','super_admin') and w0.id=p_website and w0.connection_method='browser' for update of w0;
  if w.id is null then raise exception 'Browser connection permission denied'; end if;
  update public.connection_checks set status='superseded',completed_at=now() where website_id=w.id and status in ('queued','processing');
  insert into public.connection_checks(tenant_id,website_id,connection_version) values(w.tenant_id,w.id,w.connection_version) returning id into cid;
  update public.websites set connection_status='checking',permission_status='unverified',tested_at=null,connection_message='Waiting for a browser worker to verify the permitted editorial workflow.' where id=w.id;
  return cid;
end $$;
create function public.claim_browser_check(p_worker uuid) returns jsonb language plpgsql set search_path='' as $$
declare w public.browser_workers; c public.connection_checks;
begin
  select * into w from public.browser_workers where id=p_worker and active;
  if w.id is null then raise exception 'Worker access revoked'; end if;
  update public.connection_checks set status='failed',error_code='lease_expired',completed_at=now() where tenant_id=w.tenant_id and status='processing' and lease_until<=now();
  select c0.* into c from public.connection_checks c0 join public.websites s on s.id=c0.website_id where c0.tenant_id=w.tenant_id and c0.status='queued' and c0.connection_version=s.connection_version and s.connection_status='checking' order by c0.created_at limit 1 for update of c0 skip locked;
  if c.id is null then return null; end if;
  update public.connection_checks set status='processing',worker_id=w.id,lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes' where id=c.id returning * into c;
  return to_jsonb(c);
end $$;
create function public.finish_browser_check(p_worker uuid,p_check uuid,p_token uuid,p_success boolean,p_code text,p_message text) returns boolean language plpgsql set search_path='' as $$
declare c public.connection_checks; w public.websites;
begin
  select * into c from public.connection_checks where id=p_check and worker_id=p_worker and lease_token=p_token and lease_until>now() and status='processing' for update;
  if c.id is null or not exists(select 1 from public.browser_workers where id=p_worker and active) then return false; end if;
  select * into w from public.websites where id=c.website_id for update;
  if w.connection_version<>c.connection_version or w.connection_status<>'checking' then return false; end if;
  update public.connection_checks set status=case when p_success then 'verified' else 'failed' end,error_code=left(p_code,80),completed_at=now() where id=c.id;
  update public.websites set connection_status=case when p_success then 'connected' when p_code in ('invalid_credentials','challenge_required','session_expired') then 'authorization_required' when p_code='layout_changed' then 'setup_required' else 'error' end,
    permission_status=case when p_success then 'verified' else 'unverified' end,connection_message=left(p_message,1000),tested_at=now(),connection_report=connection_report||jsonb_build_object('browser_workflow',case when p_success then 'verified' else p_code end) where id=w.id;
  return true;
end $$;

-- Freeze connection mode and content identity for every new allocation.
create function private.freeze_job_target() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    select new.target_snapshot||jsonb_build_object('connection_method',w.connection_method,'connection_version',w.connection_version) into new.target_snapshot from public.websites w where w.id=new.website_id;
    select md5(coalesce(new.overrides->>'content',c.article_snapshot->>'content','')) into new.payload_fingerprint from public.campaigns c where c.id=new.campaign_id;
  elsif new.payload_fingerprint is distinct from old.payload_fingerprint or new.target_snapshot is distinct from old.target_snapshot then raise exception 'Job target and payload identities are immutable'; end if;
  return new;
end $$;
create trigger freeze_job_target before insert or update on public.publishing_jobs for each row execute function private.freeze_job_target();
revoke all on function private.freeze_job_target() from public,anon,authenticated;

-- No frontend role can call a worker mutation or credential function.
do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('register_browser_worker','authenticate_browser_worker','enqueue_browser_check','claim_browser_check','finish_browser_check') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;

create or replace function public.create_campaign(p_actor uuid,p_article uuid,p_name text,p_sites uuid[],p_interval integer,p_start timestamptz,p_overrides jsonb default '{}') returns uuid language plpgsql set search_path='' as $$
declare actor public.profiles; article public.articles; n integer; c uuid; w uuid; idx integer:=1; jid uuid; first_base timestamptz;
begin
  -- Serialize allocation for one workspace so identical content cannot race into two campaigns.
  select * into actor from public.profiles where id=p_actor and active;
  if actor.id is null or not(actor.role in ('super_admin','admin') or actor.can_publish) then raise exception 'Publishing permission required'; end if;
  perform 1 from public.tenants where id=actor.tenant_id for update;
  select * into article from public.articles where id=p_article and tenant_id=actor.tenant_id and status='approved' for share;
  if article.id is null then raise exception 'Select an approved article'; end if;
  n:=cardinality(p_sites);
  if n is null or n<1 or n>500 or p_interval not between 300 and 86400 or p_start is null or length(trim(p_name)) not between 1 and 200 then raise exception 'Choose 1–500 targets and an interval of at least five minutes'; end if;
  if (select count(distinct x) from unnest(p_sites) x)<>n then raise exception 'Duplicate website selection'; end if;
  if (select count(*) from public.websites where id=any(p_sites) and tenant_id=actor.tenant_id and status='active' and connection_status='connected' and cms_type<>'manual' and (connection_method='api' or exists(select 1 from public.browser_workers bw where bw.tenant_id=public.websites.tenant_id and bw.active and bw.last_seen_at>now()-interval '2 minutes')))<>n then raise exception 'Every website must be connected and enabled'; end if;
  if exists(select 1 from public.publishing_jobs j join public.articles a on a.id=j.article_id where j.website_id=any(p_sites) and a.tenant_id=actor.tenant_id and j.payload_fingerprint=md5(coalesce(p_overrides->(j.website_id::text)->>'content',article.content)) and (j.status<>'cancelled' or j.remote_attempt_started or j.remote_post_id is not null or j.needs_reconciliation)) then raise exception 'This content already has a job on a selected website; retry the existing job'; end if;
  first_base:=greatest(p_start,now());
  insert into public.campaigns(tenant_id,owner_id,campaign_name,article_id,article_snapshot,total_websites,publishing_interval_seconds,start_time)
    values(actor.tenant_id,p_actor,trim(p_name),p_article,to_jsonb(article),n,p_interval,first_base) returning id into c;
  foreach w in array p_sites loop
    jid:=gen_random_uuid();
    insert into public.publishing_jobs(id,tenant_id,campaign_id,article_id,website_id,ordinal,scheduled_at,max_attempts,remote_slug,overrides,target_snapshot)
    select jid,actor.tenant_id,c,p_article,w,idx,first_base+make_interval(secs=>idx*p_interval),s.max_attempts,left(coalesce(nullif(article.slug,''),'article'),75)||'-gps-'||replace(jid::text,'-',''),coalesce(p_overrides->w::text,'{}'),jsonb_build_object('website_url',t.website_url,'api_endpoint',t.api_endpoint,'cms_type',t.cms_type,'connector_config',t.connector_config)
    from public.settings s,public.websites t where s.tenant_id=actor.tenant_id and t.id=w;
    idx:=idx+1;
  end loop;
  insert into public.publishing_logs(tenant_id,event_type,message) values(actor.tenant_id,'campaign_created',trim(p_name)||': '||n||' jobs, first attempt after '||p_interval||' seconds');
  return c;
end $$;

create or replace function public.eligible_websites(p_actor uuid,p_content text,p_category text default '',p_language text default '',p_platform text default '') returns setof public.websites language sql stable set search_path='' as $$
  select w.* from public.websites w join public.profiles p on p.tenant_id=w.tenant_id
  where p.id=p_actor and p.active and (p.role in ('super_admin','admin') or p.can_publish)
    and w.status='active' and w.connection_status='connected' and w.cms_type<>'manual' and (w.connection_method='api' or exists(select 1 from public.browser_workers bw where bw.tenant_id=w.tenant_id and bw.active and bw.last_seen_at>now()-interval '2 minutes'))
    and (p_category='' or lower(w.category)=lower(p_category)) and (p_language='' or w.language=p_language) and (p_platform='' or w.cms_type=p_platform)
    and not exists(select 1 from public.publishing_jobs j join public.articles a on a.id=j.article_id where j.website_id=w.id and j.payload_fingerprint=md5(p_content) and (j.status<>'cancelled' or j.remote_attempt_started or j.remote_post_id is not null or j.needs_reconciliation))
  order by (select max(j.published_at) from public.publishing_jobs j where j.website_id=w.id) nulls first,w.id limit 5000
$$;
revoke all on function public.eligible_websites(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.eligible_websites(uuid,text,text,text,text) to service_role;

drop function public.claim_next_job();
create or replace function public.claim_next_job(p_method text default 'api',p_worker uuid default null) returns jsonb language plpgsql set search_path='' as $$
declare s private.worker_state; j public.publishing_jobs; c public.campaigns; token uuid; wait_seconds integer;
begin
  if p_method not in ('api','browser') or (p_method='browser' and not exists(select 1 from public.browser_workers where id=p_worker and active)) then raise exception 'Worker authorization required'; end if;
  select * into s from private.worker_state where singleton for update;
  if s.active_job_id is not null then
    if s.lease_until>now() then return null; end if;
    update public.publishing_jobs set status='failed',needs_reconciliation=remote_attempt_started or remote_post_id is not null,
      error_message='Worker lease expired. Reconcile the remote outcome before retrying.',lease_until=null where id=s.active_job_id and status='processing';
    insert into public.publishing_logs(tenant_id,job_id,event_type,message)
      select tenant_id,id,'lease_expired','Worker interrupted; remote outcome requires review.' from public.publishing_jobs where id=s.active_job_id;
    select greatest(300,c0.publishing_interval_seconds,w.min_interval_seconds) into wait_seconds from public.publishing_jobs j0 join public.campaigns c0 on c0.id=j0.campaign_id join public.websites w on w.id=j0.website_id where j0.id=s.active_job_id;
    update private.worker_state set active_job_id=null,lease_until=null,lease_token=null,next_allowed_at=greatest(next_allowed_at,now()+make_interval(secs=>coalesce(wait_seconds,86400))) where singleton;
    return null;
  end if;
  if s.next_allowed_at>now() then return null; end if;
  select j0.* into j from public.publishing_jobs j0
    join public.campaigns c0 on c0.id=j0.campaign_id
    join public.websites w on w.id=j0.website_id
    where (c0.last_attempt_started_at is null or c0.last_attempt_started_at+make_interval(secs=>greatest(300,c0.publishing_interval_seconds))<=now()) and (w.rate_limit_until is null or w.rate_limit_until<=now()) and j0.status in ('pending','scheduled') and j0.scheduled_at<=now() and c0.status='running'
      and w.status='active' and w.connection_status='connected' and w.connection_method=p_method and (p_method='api' or w.tenant_id=(select tenant_id from public.browser_workers where id=p_worker and active))
    order by j0.scheduled_at,j0.ordinal limit 1 for update of j0 skip locked;
  if j.id is null then return null; end if;
  select * into c from public.campaigns where id=j.campaign_id for update;
  if c.status<>'running' then return null; end if;
  token:=gen_random_uuid(); update public.campaigns set last_attempt_started_at=now() where id=c.id;
  update public.publishing_jobs set status='processing',browser_worker_id=case when p_method='browser' then p_worker else null end,started_at=now(),attempts=attempts+1,lease_token=token,lease_until=now()+interval '10 minutes' where id=j.id returning * into j;
  update private.worker_state set active_job_id=j.id,lease_token=token,lease_until=j.lease_until where singleton;
  insert into public.publishing_logs(tenant_id,job_id,event_type,message) values(j.tenant_id,j.id,'processing','Job claimed by background worker.');
  return jsonb_build_object('job',to_jsonb(j),'campaign',to_jsonb(c),'website',(select to_jsonb(w) from public.websites w where id=j.website_id));
end $$;

create or replace function public.finish_job(p_job uuid,p_token uuid,p_result jsonb) returns void language plpgsql set search_path='' as $$
declare j public.publishing_jobs; c public.campaigns; gap integer; target_status text; delay_seconds integer;
begin
  perform 1 from private.worker_state where singleton and active_job_id=p_job and lease_token=p_token for update;
  if not found then raise exception 'Expired worker token'; end if;
  select * into j from public.publishing_jobs where id=p_job and lease_token=p_token and status='processing' and lease_until>now() for update;
  if j.id is null then raise exception 'Job is not claimed'; end if;
  select * into c from public.campaigns where id=j.campaign_id;
  if not coalesce((p_result->>'success')::boolean,false) and j.remote_attempt_started and j.remote_post_id is null and not coalesce((p_result->>'known_no_effect')::boolean,false) then p_result:=p_result||'{"uncertain":true}'::jsonb; end if;
  if coalesce((p_result->>'success')::boolean,false) and j.target_snapshot->>'connection_method'='browser' and (j.remote_post_id is null or p_result->'info'->>'verification' is distinct from 'public_page_verified') then raise exception 'Verified browser publication required'; end if;
  if coalesce((p_result->>'success')::boolean,false) and coalesce(p_result->>'url','') !~ '^https://' then raise exception 'A confirmed HTTPS publication URL is required'; end if;
  if coalesce((p_result->>'auth_invalid')::boolean,false) then update public.websites set connection_status='authorization_required',permission_status='authorization_required',connection_message='Reconnect this account before retrying publications.' where id=j.website_id; end if;
  if coalesce((p_result->>'retry_after')::integer,0)>0 then update public.websites set rate_limit_until=now()+make_interval(secs=>least(604800,(p_result->>'retry_after')::integer)) where id=j.website_id; end if;
  gap:=greatest(300,c.publishing_interval_seconds,(select min_interval_seconds from public.websites where id=j.website_id));
  delay_seconds:=greatest(gap,least(604800,coalesce((p_result->>'retry_after')::integer,0)),least(86400,(60*power(2,least(j.attempts,10)))::integer));
  if coalesce((p_result->>'success')::boolean,false) then target_status:='published';
  elsif coalesce((p_result->>'retryable')::boolean,false) and j.attempts<j.max_attempts and c.status<>'cancelled' and not coalesce((p_result->>'uncertain')::boolean,false) then
    target_status:=case when c.status='paused' then 'paused' else 'scheduled' end;
  else target_status:='failed'; end if;
  update public.publishing_jobs set status=target_status,
    published_at=case when target_status='published' then now() else null end,
    published_url=p_result->>'url',response_info=p_result->'info',error_message=left(p_result->>'error',1000),
    needs_reconciliation=coalesce((p_result->>'uncertain')::boolean,false),lease_until=null,
    remote_attempt_started=case when remote_post_id is null and not coalesce((p_result->>'uncertain')::boolean,false) then false else remote_attempt_started end,
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


revoke all on function public.claim_next_job(text,uuid) from public,anon,authenticated;
grant execute on function public.claim_next_job(text,uuid) to service_role;
create or replace function public.mark_remote_attempt(p_job uuid,p_token uuid) returns boolean language plpgsql set search_path='' as $$
begin
  update public.publishing_jobs set remote_attempt_started=true where id=p_job and lease_token=p_token and status='processing' and lease_until>now();return found;
end $$;
create or replace function public.save_remote_id(p_job uuid,p_token uuid,p_remote_id text) returns boolean language plpgsql set search_path='' as $$
begin
  if p_remote_id is null or length(p_remote_id) not between 1 and 300 or p_remote_id !~ '^[A-Za-z0-9:/_.-]+$' then raise exception 'Invalid remote identifier'; end if;
  update public.publishing_jobs set remote_post_id=p_remote_id where id=p_job and lease_token=p_token and status='processing' and lease_until>now() and (remote_post_id is null or remote_post_id=p_remote_id);return found;
end $$;
create or replace function public.revoke_credentials(p_website uuid) returns void language plpgsql set search_path='' as $$
begin
  delete from vault.secrets where id=(select secret_id from private.website_credentials where website_id=p_website);
  delete from private.website_credentials where website_id=p_website;
  update public.websites set connection_status='revoked',status='disabled',tested_at=null,connection_version=connection_version+1 where id=p_website;
  update public.connection_checks set status='superseded',completed_at=now() where website_id=p_website and status in ('queued','processing');
end $$;
-- Metadata only; browser workflows are not advertised as verified CMS integrations.
create function public.reserve_connection_version(p_actor uuid,p_website uuid) returns integer language plpgsql set search_path='' as $$
declare v integer;
begin
  update public.websites w set connection_version=connection_version+1,connection_status='authorization_required',permission_status='unverified',tested_at=null where w.id=p_website and exists(select 1 from public.profiles a where a.id=p_actor and a.tenant_id=w.tenant_id and a.active and a.role in ('admin','super_admin')) returning connection_version into v;
  if v is null then raise exception 'Connection permission denied'; end if;
  update public.connection_checks set status='superseded',completed_at=now() where website_id=p_website and status in ('queued','processing');
  return v;
end $$;
create function public.store_connection_credentials(p_website uuid,p_version integer,p_credentials jsonb) returns void language plpgsql set search_path='' as $$
begin
  perform 1 from public.websites where id=p_website and connection_version=p_version for update;
  if not found then raise exception 'Connection changed during credential rotation'; end if;
  perform public.store_credentials(p_website,p_credentials);
end $$;
revoke all on function public.reserve_connection_version(uuid,uuid),public.store_connection_credentials(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_connection_version(uuid,uuid),public.store_connection_credentials(uuid,integer,jsonb) to service_role;
create function public.monitor_browser_connections() returns void language plpgsql set search_path='' as $$
begin
  with expired as (
    update public.connection_checks set status='failed',error_code='lease_expired',completed_at=now() where status='processing' and lease_until<=now() returning website_id,connection_version
  ) update public.websites w set connection_status='error',connection_message='The browser worker was interrupted. Test this connection again.',permission_status='unverified' from expired e where w.id=e.website_id and w.connection_version=e.connection_version and w.connection_status='checking';
  with due as (
    select w.id,w.tenant_id,w.connection_version from public.websites w where w.connection_method='browser' and w.connection_status='connected' and w.status='active' and w.tested_at<now()-interval '24 hours' and not exists(select 1 from public.connection_checks c where c.website_id=w.id and c.status in ('queued','processing')) for update skip locked
  ), queued as (
    insert into public.connection_checks(website_id,tenant_id,connection_version) select id,tenant_id,connection_version from due returning website_id
  ) update public.websites set connection_status='checking',permission_status='unverified',connection_message='Scheduled browser connection health check is waiting for the worker.' where id in (select website_id from queued);
end $$;
revoke all on function public.monitor_browser_connections() from public,anon,authenticated;
grant execute on function public.monitor_browser_connections() to service_role;
update public.platform_connectors set guide='Install an authorized API connector, or configure and verify a permitted browser editor workflow.' where id in ('manual','custom');
