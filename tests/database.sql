-- Run only against the NEW project. All fixtures and state changes are rolled back.
begin;
create temporary table qa_context(actor_a uuid,actor_b uuid,tenant_a uuid,tenant_b uuid,article uuid,campaign uuid,job uuid,token uuid);
create temporary table qa_results(test text,passed boolean);
insert into auth.users(id,email,raw_user_meta_data) values(gen_random_uuid(),'qa-a-'||gen_random_uuid()||'@example.com','{"full_name":"QA A"}'),(gen_random_uuid(),'qa-b-'||gen_random_uuid()||'@example.com','{"full_name":"QA B"}');
insert into qa_context(actor_a,actor_b) select (select id from public.profiles where full_name='QA A'),(select id from public.profiles where full_name='QA B');
update qa_context set tenant_a=(select tenant_id from public.profiles where id=actor_a),tenant_b=(select tenant_id from public.profiles where id=actor_b);
insert into public.websites(tenant_id,owner_id,website_name,website_url,api_endpoint,connection_status)
select tenant_a,actor_a,'QA '||n,'https://qa'||n||'.test.invalid','https://qa'||n||'.test.invalid/wp-json/wp/v2','connected' from qa_context cross join generate_series(1,100)n;
insert into public.articles(tenant_id,owner_id,title,content,status) select tenant_a,actor_a,'QA article','<p>Approved QA content</p>','approved' from qa_context;
update qa_context set article=(select id from public.articles where title='QA article');
update public.profiles set role='editor',can_publish=false where id=(select actor_b from qa_context);
do $$ begin
  begin perform public.create_campaign(actor_b,article,'Unauthorized',array[(select id from public.websites limit 1)],90,now()) from qa_context;raise exception 'Editor publishing restriction failed';
  exception when others then if sqlerrm not like '%Publishing permission required%' then raise;end if;end;
end $$;
insert into qa_results values('Editor without publishing permission cannot start campaigns',true);
update qa_context set campaign=public.create_campaign(actor_a,article,'QA pacing',(select array_agg(id order by website_name) from public.websites where tenant_id=tenant_a),30,now());
insert into qa_results select '100-target database minimum >= 120 minutes',max(scheduled_at)-min(scheduled_at)>=interval '2 hours' from public.publishing_jobs where campaign_id=(select campaign from qa_context);
insert into qa_results select 'Exactly 100 persistent jobs',count(*)=100 from public.publishing_jobs where campaign_id=(select campaign from qa_context);
insert into qa_results select 'Minimum interval raised to 73 seconds',publishing_interval_seconds=73 from public.campaigns where id=(select campaign from qa_context);
do $$ begin
  begin
    perform public.create_campaign(actor_a,article,'Duplicate',(select array_agg(id) from public.websites where tenant_id=tenant_a),90,now()) from qa_context;
    raise exception 'Duplicate protection failed';
  exception when others then if sqlerrm not like '%already has a job%' then raise; end if; end;
end $$;
insert into qa_results values('Duplicate campaign rejected',true);
select public.control_campaign(actor_a,campaign,'pause') from qa_context;
insert into qa_results select 'Pause prevents all pending claims',public.claim_next_job() is null;
select public.control_campaign(actor_a,campaign,'resume') from qa_context;
with claimed as (select public.claim_next_job() as v) update qa_context set job=(v->'job'->>'id')::uuid,token=(v->'job'->>'lease_token')::uuid from claimed;
insert into qa_results select 'A due job is atomically claimed',job is not null from qa_context;
insert into qa_results select 'Overlapping worker cannot claim another job',public.claim_next_job() is null;
select public.finish_job(job,token,'{"success":true,"url":"https://qa.test.invalid/post","info":{"test":true}}') from qa_context;
insert into qa_results select 'Published URL and timestamp recorded',status='published' and published_at is not null and published_url='https://qa.test.invalid/post' from public.publishing_jobs where id=(select job from qa_context);
update public.publishing_jobs set scheduled_at=now()-interval '1 day' where campaign_id=(select campaign from qa_context) and status='scheduled';
insert into qa_results select 'Overdue jobs do not burst past actual pacing gate',public.claim_next_job() is null;
update private.worker_state set next_allowed_at=now()-interval '1 second';
with claimed as (select public.claim_next_job() as v) update qa_context set job=(v->'job'->>'id')::uuid,token=(v->'job'->>'lease_token')::uuid from claimed;
select public.finish_job(job,token,'{"success":false,"retryable":true,"retry_after":600,"error":"HTTP 429 test"}') from qa_context;
insert into qa_results select '429 retry honors Retry-After and increases attempts',status='scheduled' and attempts=1 and scheduled_at>=now()+interval '599 seconds' from public.publishing_jobs where id=(select job from qa_context);
update private.worker_state set next_allowed_at=now()-interval '1 second';
with claimed as (select public.claim_next_job() as v) update qa_context set job=(v->'job'->>'id')::uuid,token=(v->'job'->>'lease_token')::uuid from claimed;
select public.mark_remote_attempt(job,token) from qa_context;
update public.campaigns set publishing_interval_seconds=3600 where id=(select campaign from qa_context);
update private.worker_state set lease_until=now()-interval '1 second';
insert into qa_results select 'Expired worker enters reconciliation instead of another create',public.claim_next_job() is null;
insert into qa_results select 'Lease recovery preserves a configured one-hour cooldown',next_allowed_at>=now()+interval '3599 seconds' from private.worker_state;
insert into qa_results select 'Unknown result is failed and flagged',status='failed' and needs_reconciliation from public.publishing_jobs where id=(select job from qa_context);
select public.retry_job(actor_a,job) from qa_context;
insert into qa_results select 'Manual retry preserves reconciliation flag',status='scheduled' and needs_reconciliation from public.publishing_jobs where id=(select job from qa_context);
grant select on qa_context to service_role;
grant insert,select on qa_results to service_role;
set local role service_role;
select public.store_credentials((select id from public.websites where tenant_id=(select tenant_a from qa_context) limit 1),'{"username":"qa","password":"disposable-fixture"}');
insert into qa_results select 'Vault credentials can be read by the backend',public.read_credentials((select id from public.websites where tenant_id=(select tenant_a from qa_context) limit 1))->>'username'='qa';
select public.revoke_credentials((select id from public.websites where tenant_id=(select tenant_a from qa_context) limit 1));
insert into qa_results select 'Service-role Vault revocation succeeds',public.read_credentials((select id from public.websites where tenant_id=(select tenant_a from qa_context) limit 1)) is null;
reset role;
select set_config('request.jwt.claim.sub',(select actor_b::text from qa_context),true);
grant select,insert on qa_results to authenticated;
set local role authenticated;
insert into qa_results select 'Other tenant cannot read websites',count(*)=0 from public.websites;
insert into qa_results select 'Other tenant cannot read articles',count(*)=0 from public.articles;
insert into qa_results select 'Other tenant cannot read campaigns or jobs',(select count(*)=0 from public.campaigns) and (select count(*)=0 from public.publishing_jobs);
do $$ begin
  begin perform public.claim_next_job();raise exception 'Worker RPC exposed';exception when insufficient_privilege then null;end;
  begin perform public.read_credentials(gen_random_uuid());raise exception 'Credentials RPC exposed';exception when insufficient_privilege then null;end;
  begin update public.profiles set role='super_admin';raise exception 'Role update exposed';exception when insufficient_privilege then null;end;
end $$;
insert into qa_results values('Worker and credential RPCs and role mutations denied to browser',true);
reset role;
update public.websites set status='active',connection_status='connected' where tenant_id=(select tenant_a from qa_context);
select public.control_campaign(actor_a,campaign,'cancel') from qa_context;
insert into qa_results select 'Cancel removes all unstarted jobs from queue',count(*)=0 from public.publishing_jobs where campaign_id=(select campaign from qa_context) and status in ('pending','scheduled','paused');
do $$ begin
  begin
    perform public.create_campaign(actor_a,article,'Cancelled unknown duplicate',array[(select website_id from public.publishing_jobs where id=job)],90,now()) from qa_context;
    raise exception 'Cancelled unknown outcome allowed a duplicate';
  exception when others then if sqlerrm not like '%already has a job%' then raise;end if;end;
end $$;
insert into qa_results values('Cancelled unknown publication still blocks duplicates',true);
select * from qa_results;
rollback;
