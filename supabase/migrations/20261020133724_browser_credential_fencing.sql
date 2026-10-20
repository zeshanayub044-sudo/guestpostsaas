-- Credential generations are fenced per attempt, not frozen for the campaign lifetime.
alter table public.publishing_jobs add column claimed_connection_version integer;
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
  update public.publishing_jobs set status='processing',claimed_connection_version=(select connection_version from public.websites where id=j.website_id),browser_worker_id=case when p_method='browser' then p_worker else null end,started_at=now(),attempts=attempts+1,lease_token=token,lease_until=now()+interval '10 minutes' where id=j.id returning * into j;
  update private.worker_state set active_job_id=j.id,lease_token=token,lease_until=j.lease_until where singleton;
  insert into public.publishing_logs(tenant_id,job_id,event_type,message) values(j.tenant_id,j.id,'processing','Job claimed by background worker.');
  return jsonb_build_object('job',to_jsonb(j),'campaign',to_jsonb(c),'website',(select to_jsonb(w) from public.websites w where id=j.website_id));
end $$;

