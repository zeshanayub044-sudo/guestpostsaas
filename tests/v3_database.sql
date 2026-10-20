-- Run only on the dedicated GuestPost project. ALL test data and queue clock
-- changes roll back. Holding the singleton lock prevents Cron seeing test jobs.
begin;
do $$
declare uid uuid:=gen_random_uuid(); tenant uuid; aid uuid; aid2 uuid; ids uuid[]; cid uuid; c2 uuid; first_job uuid; first_token uuid; claimed jsonb; wid uuid; checkid uuid; checkrow jsonb; browser_site uuid; failed_as_expected boolean; before_count integer;
begin
  perform 1 from private.worker_state where singleton for update;
  select count(*) into before_count from public.websites;
  insert into auth.users(id,email,raw_user_meta_data) values(uid,'v3-'||uid||'@fixture.invalid','{"full_name":"V3 transactional test"}');
  select tenant_id into tenant from public.profiles where id=uid;
  if tenant is null then raise exception 'Test tenant bootstrap failed'; end if;
  insert into public.websites(tenant_id,owner_id,website_name,website_url,api_endpoint,cms_type,connection_status,permission_status)
    select tenant,uid,'Fixture '||n,'https://fixture-'||n||'.publisher.org','https://fixture-'||n||'.publisher.org/.well-known/guestpost','custom','connected','verified' from generate_series(1,200) n;
  select array_agg(id order by website_name) into ids from public.websites where tenant_id=tenant;
  insert into public.articles(tenant_id,owner_id,title,content,status) values(tenant,uid,'V3 test','<p>Immutable fixture content</p>','approved') returning id into aid;
  cid:=public.create_campaign(uid,aid,'200 unique targets',ids,300,now(),'{}');
  if (select count(*) from public.publishing_jobs where campaign_id=cid)<>200 or (select count(distinct website_id) from public.publishing_jobs where campaign_id=cid)<>200 then raise exception 'Unique 200-site allocation failed'; end if;
  if (select min(scheduled_at) from public.publishing_jobs where campaign_id=cid)<now()+interval '300 seconds' then raise exception 'Initial wait is missing'; end if;
  if exists(select 1 from (select scheduled_at-lag(scheduled_at) over(order by ordinal) gap from public.publishing_jobs where campaign_id=cid) x where gap<interval '300 seconds') then raise exception 'Scheduled cadence failed'; end if;
  failed_as_expected:=false;begin perform public.create_campaign(uid,aid,'Duplicate target',array[ids[1],ids[1]],300,now(),'{}');exception when others then failed_as_expected:=true;end;if not failed_as_expected then raise exception 'Duplicate target was accepted'; end if;
  failed_as_expected:=false;begin perform public.create_campaign(uid,aid,'Invalid interval',ids,299,now(),'{}');exception when others then failed_as_expected:=true;end;if not failed_as_expected then raise exception 'Short interval was accepted'; end if;
  failed_as_expected:=false;begin perform public.create_campaign(uid,aid,'Over limit',array_fill(ids[1],array[501]),300,now(),'{}');exception when others then failed_as_expected:=true;end;if not failed_as_expected then raise exception '501 targets were accepted'; end if;
  update public.articles set content='<p>Edited later</p>' where id=aid;
  insert into public.articles(tenant_id,owner_id,title,content,status) values(tenant,uid,'Copied old content','<p>Immutable fixture content</p>','approved') returning id into aid2;
  failed_as_expected:=false;begin perform public.create_campaign(uid,aid2,'Must block immutable duplicate',array[ids[1]],300,now(),'{}');exception when others then failed_as_expected:=true;end;if not failed_as_expected then raise exception 'Editing source bypassed duplicate ledger'; end if;
  update public.publishing_jobs set scheduled_at=now()-interval '1 hour' where campaign_id=cid;
  update private.worker_state set active_job_id=null,lease_token=null,lease_until=null,next_allowed_at=now()-interval '1 hour' where singleton;
  claimed:=public.claim_next_job();first_job:=(claimed->'job'->>'id')::uuid;first_token:=(claimed->'job'->>'lease_token')::uuid;
  if first_job is null then raise exception 'Due API job was not claimed'; end if;
  if public.claim_next_job() is not null then raise exception 'Overlapping claim was accepted'; end if;
  failed_as_expected:=false;begin perform public.finish_job(first_job,gen_random_uuid(),'{"success":false}');exception when others then failed_as_expected:=true;end;if not failed_as_expected then raise exception 'Stale completion accepted'; end if;
  perform public.mark_remote_attempt(first_job,first_token);
  perform public.finish_job(first_job,first_token,'{"success":false,"retryable":true,"error":"Simulated lost remote response"}');
  if not exists(select 1 from public.publishing_jobs where id=first_job and status='failed' and needs_reconciliation) then raise exception 'Unknown outcome was retried blindly'; end if;
  perform public.retry_job(uid,first_job);
  update private.worker_state set next_allowed_at=now()-interval '1 hour' where singleton;
  if public.claim_next_job() is not null then raise exception 'Retry bypassed campaign five-minute gate'; end if;
  update public.campaigns set last_attempt_started_at=now()-interval '301 seconds' where id=cid;
  claimed:=public.claim_next_job();if claimed is null then raise exception 'Eligible due work was blocked after interval'; end if;
  perform public.finish_job((claimed->'job'->>'id')::uuid,(claimed->'job'->>'lease_token')::uuid,'{"success":false,"error":"Fixture completion","known_no_effect":true}');
  update public.campaigns set status='paused' where id=cid;
  update private.worker_state set next_allowed_at=now()-interval '1 hour' where singleton;
  if public.claim_next_job() is not null then raise exception 'Paused campaign was claimed'; end if;
  wid:=public.register_browser_worker(uid,'Transactional fixture',repeat('a',64));
  perform public.authenticate_browser_worker(repeat('a',64),'fixture');
  insert into public.websites(tenant_id,owner_id,website_name,website_url,api_endpoint,cms_type,connection_status,permission_status,connection_method,connector_config)
    values(tenant,uid,'Browser fixture','https://browser-fixture.publisher.org','https://browser-fixture.publisher.org','custom','connected','verified','browser','{"browser_workflow":{"id":"custom-editor-v1"}}') returning id into browser_site;
  c2:=public.create_campaign(uid,aid2,'Browser dispatch',array[browser_site],300,now(),'{}');
  update public.publishing_jobs set scheduled_at=now()-interval '1 hour' where campaign_id=c2;
  if public.claim_next_job() is not null then raise exception 'API runner claimed browser work'; end if;
  claimed:=public.claim_next_job('browser',wid);if claimed is null or claimed->'job'->>'browser_worker_id'<>wid::text then raise exception 'Tenant-scoped browser claim failed'; end if;
  first_job:=(claimed->'job'->>'id')::uuid;first_token:=(claimed->'job'->>'lease_token')::uuid;
  failed_as_expected:=false;begin perform public.finish_job(first_job,first_token,'{"success":true,"url":"https://browser-fixture.publisher.org/post"}');exception when others then failed_as_expected:=true;end;if not failed_as_expected then raise exception 'Unverified browser publication accepted'; end if;
  perform public.mark_remote_attempt(first_job,first_token);perform public.save_remote_id(first_job,first_token,'123');
  perform public.finish_job(first_job,first_token,'{"success":true,"url":"https://browser-fixture.publisher.org/post","info":{"verification":"public_page_verified"}}');
  if public.save_remote_id(first_job,first_token,'456') then raise exception 'Completed lease could still checkpoint'; end if;
  checkid:=public.enqueue_browser_check(uid,browser_site);checkrow:=public.claim_browser_check(wid);
  if checkrow->>'id'<>checkid::text then raise exception 'Connection check claim failed'; end if;
  perform public.reserve_connection_version(uid,browser_site);
  if public.finish_browser_check(wid,checkid,(checkrow->>'lease_token')::uuid,true,'','Old credential result') then raise exception 'Stale connection version was accepted'; end if;
  if has_table_privilege('authenticated','private.website_credentials','SELECT') or has_table_privilege('authenticated','private.browser_worker_keys','SELECT') then raise exception 'Frontend can read credentials'; end if;
  if has_function_privilege('authenticated','public.read_credentials(uuid)','EXECUTE') or has_function_privilege('authenticated','public.claim_next_job(text,uuid)','EXECUTE') or has_function_privilege('anon','public.authenticate_browser_worker(text,text)','EXECUTE') then raise exception 'Public worker RPC exposure'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);
  set local role authenticated;
  if (select count(*) from public.websites)<>201 then raise exception 'Tenant RLS leaked or hid websites'; end if;
  reset role;
end $$;
rollback;
select 'passed' as result,24 as asserted_invariants,'All fixture accounts, sites, articles, campaigns, workers, jobs and queue clock changes rolled back' as cleanup;
