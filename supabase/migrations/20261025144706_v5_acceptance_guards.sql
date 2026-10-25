-- Granular permissions supersede legacy can_publish flags at every allocation layer.
do $$ declare f record;d text;begin
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('create_campaign_v3','create_inline_campaign','eligible_websites','control_campaign','retry_job') loop
  d:=pg_get_functiondef(f.sig);
  d:=replace(d,'(actor.role in (''super_admin'',''admin'') or actor.can_publish)','private.actor_permission(actor.id,''campaigns.launch'')');
  d:=replace(d,'(a.role in (''super_admin'',''admin'') or a.can_publish)','(private.actor_permission(a.id,''campaigns.launch'') and private.actor_permission(a.id,''articles.approve''))');
  d:=replace(d,'(p.role in (''super_admin'',''admin'') or p.can_publish)','private.actor_permission(p.id,''campaigns.create'')');
  execute d;
 end loop;
end $$;
create function public.publishing_runtime_status() returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('scheduler_active',exists(select 1 from cron.job where jobname='guestpost-publish-worker' and active),'schedule',(select schedule from cron.job where jobname='guestpost-publish-worker' limit 1),'checked_at',clock_timestamp())
$$;
revoke all on function public.publishing_runtime_status() from public,anon,authenticated;grant execute on function public.publishing_runtime_status() to service_role;

-- Capture image/canonical changes in the same review history as article content.
create or replace function private.snapshot_article() returns trigger language plpgsql set search_path='' as $$ declare v uuid;begin
 if tg_op='INSERT' or (new.content,new.title,new.meta_title,new.meta_description,new.slug,new.focus_keyword,new.tags,new.category,new.featured_image,new.canonical_url) is distinct from (old.content,old.title,old.meta_title,old.meta_description,old.slug,old.focus_keyword,old.tags,old.category,old.featured_image,old.canonical_url) then
  insert into public.seo_article_versions(tenant_id,article_id,created_by,original_content,optimized_content,seo_data,provider,status,source_updated_at,approved_by,approved_at) values(new.tenant_id,new.id,new.owner_id,coalesce(new.original_content,new.content),new.content,jsonb_build_object('title',new.title,'meta_title',new.meta_title,'meta_description',new.meta_description,'slug',new.slug,'primary_keyword',new.focus_keyword,'category',new.category,'tags',new.tags,'featured_image',new.featured_image,'canonical_url',new.canonical_url),'manual',case when new.status='approved' then 'approved' else 'accepted' end,new.updated_at,new.approved_by,new.approved_at) returning id into v;
  update public.articles set current_version_id=v,approved_version_id=case when new.status='approved' then v end where id=new.id;
 end if;return new;end $$;
drop trigger article_version_snapshot on public.articles;
create trigger article_version_snapshot after insert or update of content,title,meta_title,meta_description,slug,focus_keyword,tags,category,featured_image,canonical_url on public.articles for each row execute function private.snapshot_article();

-- A smoke run can pass only after the real worker and unauthenticated public check succeed.
create function private.sync_smoke_evidence() returns trigger language plpgsql set search_path='' as $$
declare campaign uuid;r public.smoke_test_runs;j public.publishing_jobs;i public.publication_report_items;result text;url text;begin
 if tg_table_name='publishing_jobs' then campaign:=new.campaign_id;else select campaign_id into campaign from public.publishing_jobs where id=new.job_id;end if;
 select * into r from public.smoke_test_runs where campaign_id=campaign for update;if r.id is null then return new;end if;
 select * into j from public.publishing_jobs where campaign_id=campaign order by created_at limit 1;select * into i from public.publication_report_items where job_id=j.id;
 result:=case when j.status='published' and j.remote_post_id is not null and i.verification_status='verified' then 'passed' when j.status in ('failed','cancelled') then 'failed' when j.status='processing' then 'running' else 'scheduled' end;
 url:=case when result='passed' then i.published_url end;
 update public.smoke_test_runs set status=result,published_url=url,completed_at=case when result in ('passed','failed') then clock_timestamp() end where id=r.id;
 if j.status='published' or result='failed' then
  update public.smoke_test_steps set actual_result=case when result='passed' then 'Public title, content and intended backlinks verified at '||url when result='failed' then coalesce(j.error_message,'The destination did not complete publication') else 'CMS publication exists; unauthenticated public verification is pending' end,status=case when result='passed' then 'passed' when result='failed' then 'failed' else 'pending' end,error_code=case when result='failed' then 'publication_failed' when result<>'passed' then 'public_verification_pending' end,verified_at=clock_timestamp() where run_id=r.id and test_name='Public publication verification';
  if not found then insert into public.smoke_test_steps(tenant_id,run_id,test_name,expected_result,actual_result,status,error_code,corrective_action,log_reference) values(r.tenant_id,r.id,'Public publication verification','Durable remote ID plus public article, title, content and backlink verification',case when result='passed' then 'Verified exact live URL: '||url else 'CMS status: '||j.status||'; public verification: '||coalesce(i.verification_status,'not started') end,case when result='passed' then 'passed' when result='failed' then 'failed' else 'pending' end,case when result='passed' then null else 'public_verification_pending' end,'Review the campaign log and public report; reconcile unknown outcomes before retrying.',j.id::text);end if;
 end if;return new;
end $$;
create trigger z_sync_smoke_job after update of status on public.publishing_jobs for each row execute function private.sync_smoke_evidence();
create trigger z_sync_smoke_report after update of verification_status on public.publication_report_items for each row execute function private.sync_smoke_evidence();
revoke all on function private.sync_smoke_evidence() from public,anon,authenticated;
