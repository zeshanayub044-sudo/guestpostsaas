-- Evaluate access on bounded queue candidates, rather than rechecking the whole queue under one lock.
create index qualification_queue_order_idx on public.qualification_checks(created_at,id) where status='queued';
create index websites_inventory_order_idx on public.websites(tenant_id,created_at,id);
create or replace function public.claim_qualification_check() returns jsonb language plpgsql set search_path='' as $$
declare r public.qualification_checks;w public.websites;i integer;begin
 perform pg_advisory_xact_lock(hashtextextended('v6-qualification-claims',0));
 update public.qualification_checks set status=case when attempts<3 then 'queued' else 'error' end,lease_token=null,lease_until=null,next_check_at=now()+interval '1 minute' where status='processing' and lease_until<now();
 if (select count(*) from public.qualification_checks where status='processing')>=16 then return null;end if;
 for i in 1..32 loop
  select * into r from public.qualification_checks where status='queued' and next_check_at<=now() and attempts<3 order by created_at,id for update skip locked limit 1;
  if r.id is null then return null;end if;
  if not private.actor_website_access(r.requested_by,r.website_id,'read') or not (private.actor_permission(r.requested_by,'publishers.research') or private.actor_permission(r.requested_by,'websites.connect')) then
   update public.qualification_checks set status='error',completed_at=clock_timestamp(),result='{"error":"requester_access_revoked"}' where id=r.id;continue;
  end if;
  select * into w from public.websites where id=r.website_id and tenant_id=r.tenant_id;
  update public.qualification_checks set status='processing',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes' where id=r.id returning * into r;
  return jsonb_build_object('can_test_connection',private.actor_permission(r.requested_by,'websites.connect') and private.actor_website_access(r.requested_by,w.id,'connect'),'check',to_jsonb(r),'website',to_jsonb(w),'source',(select to_jsonb(s) from public.import_rows s join public.workbook_imports b on b.id=s.workbook_id where s.tenant_id=w.tenant_id and s.website_id=w.id and b.status in ('verifying','complete') order by b.created_at desc,s.row_number limit 1));
 end loop;return null;
end $$;
create function private.readable_website_ids(p_actor uuid) returns setof uuid language plpgsql stable set search_path='' as $$
declare a public.profiles;all_access boolean;begin
 select * into a from public.profiles where id=p_actor and active and not password_change_required;
 if a.id is null or not private.actor_permission(a.id,'websites.read') then return;end if;all_access:=private.actor_permission(a.id,'websites.read_all');
 return query select w.id from public.websites w where w.tenant_id=a.tenant_id and (all_access or w.owner_id=a.id or exists(select 1 from public.website_assignments s where s.website_id=w.id and s.user_id=a.id));
end $$;
revoke all on function private.readable_website_ids(uuid) from public,anon,authenticated;grant execute on function private.readable_website_ids(uuid) to service_role;
create or replace function public.inventory_readiness(p_actor uuid,p_offset integer default 0,p_limit integer default 500) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'qualification',private.website_state(s.id)-'reachability_evidence'-'guidelines_evidence'-'review_notes'-'discovery','can_publish',private.actor_website_access(p_actor,s.id,'publish'),'can_connect',private.actor_website_access(p_actor,s.id,'connect'))),'[]') from (select w.id from private.readable_website_ids(p_actor) a(id) join public.websites w on w.id=a.id order by w.created_at,w.id offset greatest(0,p_offset) limit greatest(1,least(500,p_limit))) s
$$;
-- Small metadata summary; current qualification states are fetched through bounded pages below.
create or replace function public.workbook_verification_summary(p_actor uuid,p_workbook uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare a public.profiles;b public.workbook_imports;counts jsonb;jobs jsonb;begin
 select * into a from public.profiles where id=p_actor;select * into b from public.workbook_imports where id=p_workbook and tenant_id=a.tenant_id and (owner_id=a.id or private.actor_permission(a.id,'websites.read_all'));
 if b.id is null or not private.actor_permission(a.id,'websites.create') then raise exception 'Workbook access required';end if;
 select jsonb_object_agg(status,n) into counts from (select status,count(*) n from public.import_rows where workbook_id=b.id group by status) s;
 select jsonb_object_agg(status,n) into jobs from (select c.status,count(*) n from (select distinct website_id from public.import_rows where workbook_id=b.id and website_id is not null) r join lateral (select status from public.qualification_checks x where x.website_id=r.website_id order by created_at desc,id desc limit 1) c on true group by c.status) s;
 return jsonb_build_object('workbook',to_jsonb(b),'source',b.source_summary,'row_outcomes',coalesce(counts,'{}'),'latest_checks',coalesce(jobs,'{}'));
end $$;
create function public.workbook_qualification_page(p_actor uuid,p_workbook uuid,p_offset integer default 0,p_limit integer default 250) returns jsonb language plpgsql stable set search_path='' as $$
declare a public.profiles;b public.workbook_imports;result jsonb;begin
 select * into a from public.profiles where id=p_actor;select * into b from public.workbook_imports where id=p_workbook and tenant_id=a.tenant_id and (owner_id=a.id or private.actor_permission(a.id,'websites.read_all'));
 if b.id is null or not private.actor_permission(a.id,'websites.create') then raise exception 'Workbook access required';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.website_id,'qualification',private.website_state(s.website_id)-'reachability_evidence'-'guidelines_evidence'-'review_notes'-'discovery')),'[]') into result from (select distinct r.website_id from public.import_rows r join private.readable_website_ids(p_actor) a(id) on a.id=r.website_id where r.workbook_id=b.id order by r.website_id offset greatest(0,p_offset) limit greatest(1,least(250,p_limit))) s;
 return result;
end $$;
revoke all on function public.workbook_qualification_page(uuid,uuid,integer,integer) from public,anon,authenticated;grant execute on function public.workbook_qualification_page(uuid,uuid,integer,integer) to service_role;
-- Public read checks are bounded globally and do no work while idle. Publication Cron remains unchanged.
select cron.schedule('guestpost-qualification-worker','3 seconds',$cron$select private.tick_qualification() where exists(select 1 from public.qualification_checks where (status='queued' and next_check_at<=now()) or (status='processing' and lease_until<now())) and (select count(*) from public.qualification_checks where status='processing' and lease_until>now())<16;$cron$);
