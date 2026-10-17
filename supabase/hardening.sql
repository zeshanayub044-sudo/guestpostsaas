-- Historical Version 1 hardening reference. Do not reapply to the Version 2 deployment; use tracked migrations.
create or replace function public.create_campaign(p_actor uuid,p_article uuid,p_name text,p_sites uuid[],p_interval integer,p_start timestamptz,p_overrides jsonb default '{}')
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
  if exists(select 1 from public.publishing_jobs where article_id=p_article and website_id=any(p_sites) and (status<>'cancelled' or remote_attempt_started or remote_post_id is not null or needs_reconciliation)) then raise exception 'This article already has a job on a selected website; retry the existing job'; end if;
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
create or replace function public.control_campaign(p_actor uuid,p_campaign uuid,p_action text) returns void language plpgsql set search_path='' as $$
declare c public.campaigns; a public.profiles;
begin
  perform 1 from private.worker_state where singleton for update;
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
create or replace function public.retry_job(p_actor uuid,p_job uuid) returns void language plpgsql set search_path='' as $$
declare j public.publishing_jobs; a public.profiles;
begin
  perform 1 from private.worker_state where singleton for update;
  select * into a from public.profiles where id=p_actor and active;
  if a.id is null or not(a.role in ('super_admin','admin') or a.can_publish) then raise exception 'Permission denied'; end if;
  select * into j from public.publishing_jobs where id=p_job and tenant_id=a.tenant_id for update;
  if j.id is null or j.status<>'failed' then raise exception 'Only failed jobs can be retried'; end if;
  if (select status from public.campaigns where id=j.campaign_id)='cancelled' then raise exception 'Campaign is cancelled'; end if;
  update public.campaigns set status='running',completed_at=null where id=j.campaign_id;
  update public.publishing_jobs set status='scheduled',scheduled_at=greatest(scheduled_at,now()),max_attempts=attempts+5,error_message=null where id=j.id;
  insert into public.publishing_logs(tenant_id,job_id,event_type,message) values(a.tenant_id,j.id,'manual_retry','Retry requested; unknown outcomes will only be reconciled.');
end $$;
create or replace function public.claim_next_job() returns jsonb language plpgsql set search_path='' as $$
declare s private.worker_state; j public.publishing_jobs; c public.campaigns; token uuid; wait_seconds integer;
begin
  select * into s from private.worker_state where singleton for update;
  if s.active_job_id is not null then
    if s.lease_until>now() then return null; end if;
    update public.publishing_jobs set status='failed',needs_reconciliation=remote_attempt_started,
      error_message='Worker lease expired. Reconcile the remote outcome before retrying.',lease_until=null where id=s.active_job_id and status='processing';
    insert into public.publishing_logs(tenant_id,job_id,event_type,message)
      select tenant_id,id,'lease_expired','Worker interrupted; remote outcome requires review.' from public.publishing_jobs where id=s.active_job_id;
    select greatest(c0.publishing_interval_seconds,w.min_interval_seconds) into wait_seconds from public.publishing_jobs j0 join public.campaigns c0 on c0.id=j0.campaign_id join public.websites w on w.id=j0.website_id where j0.id=s.active_job_id;
    update private.worker_state set active_job_id=null,lease_until=null,lease_token=null,next_allowed_at=greatest(next_allowed_at,now()+make_interval(secs=>coalesce(wait_seconds,86400))) where singleton;
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
  update public.publishing_jobs set status='processing',attempts=attempts+1,lease_token=token,lease_until=now()+interval '10 minutes' where id=j.id returning * into j;
  update private.worker_state set active_job_id=j.id,lease_token=token,lease_until=j.lease_until where singleton;
  insert into public.publishing_logs(tenant_id,job_id,event_type,message) values(j.tenant_id,j.id,'processing','Job claimed by background worker.');
  return jsonb_build_object('job',to_jsonb(j),'campaign',to_jsonb(c),'website',(select to_jsonb(w) from public.websites w where id=j.website_id));
end $$;
create or replace function public.finish_job(p_job uuid,p_token uuid,p_result jsonb) returns void language plpgsql set search_path='' as $$
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
drop index public.prevent_duplicate_publication;
create unique index prevent_duplicate_publication on public.publishing_jobs(article_id,website_id) where status<>'cancelled' or remote_attempt_started or remote_post_id is not null or needs_reconciliation;
drop policy if exists service_only on private.website_credentials;create policy service_only on private.website_credentials for all to service_role using(true) with check(true);
drop policy if exists service_only on private.worker_state;create policy service_only on private.worker_state for all to service_role using(true) with check(true);
drop policy if exists service_only on private.runtime_config;create policy service_only on private.runtime_config for all to service_role using(true) with check(true);
