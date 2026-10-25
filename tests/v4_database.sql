-- Dedicated GuestPost project only. Tests are fully rolled back; Cron cannot see uncommitted fixture rows.
begin;
do $$
declare u uuid:=gen_random_uuid();t uuid;a uuid;b uuid;r jsonb;rows jsonb;w uuid;w2 uuid;c uuid;v timestamptz;failed boolean;before_count integer;req uuid:=gen_random_uuid();n integer;
begin
 perform 1 from private.worker_state where singleton for update;
 select count(*) into before_count from public.websites;
 insert into auth.users(id,email,raw_user_meta_data) values(u,'v4-'||u||'@fixture.invalid','{"full_name":"V4 transactional fixture"}');select tenant_id into t from public.profiles where id=u;
 select jsonb_agg(jsonb_build_object('row_number',i+1,'status','pending','website_url','https://inventory-'||i||'.publisher.org','domain','inventory-'||i||'.publisher.org','website_name','V4 inventory fixture '||i,'category','Technology','account_email','editor@publisher.org','country','PK','language','en')) into rows from generate_series(1,50) i;
 rows:=rows||jsonb_build_array(jsonb_build_object('row_number',52,'status','duplicate','website_url','https://inventory-1.publisher.org','message','Duplicate domain'),jsonb_build_object('row_number',53,'status','invalid','website_url','','error_code','invalid_inventory_row','message','Missing URL'));
 r:=public.import_website_inventory(u,req,'V4 50 sample website records.xlsx',rows);b:=(r->>'id')::uuid;
 if (r->>'imported')::integer<>50 or (r->>'skipped')::integer<>1 or (r->>'invalid')::integer<>1 then raise exception 'Import counters are inaccurate';end if;
 if (select count(*) from public.import_rows where batch_id=b)<>52 or (select count(*) from public.websites where tenant_id=t)<>50 then raise exception 'Inventory rows or report rows were not saved';end if;
 if not (public.import_website_inventory(u,req,'Retry upload',rows)->>'replayed')::boolean then raise exception 'Upload idempotency failed';end if;
 if (select count(*) from public.websites where tenant_id=t)<>50 then raise exception 'Replayed upload created duplicates';end if;
 if exists(select 1 from public.websites where tenant_id=t and (connection_status='connected' or permission_status='verified')) then raise exception 'Inventory import granted publishing permission';end if;
 rows:=jsonb_build_array(jsonb_build_object('row_number',2,'status','pending','website_url','https://www.inventory-1.publisher.org/new','domain','inventory-1.publisher.org','website_name','Duplicate alias','language','en'));
 if (public.import_website_inventory(u,gen_random_uuid(),'Alias duplicate.csv',rows)->>'skipped')::integer<>1 then raise exception 'Existing www/path domain duplicate was not detected';end if;
 -- Claim only this test batch by placing it before committed pending inventory.
 update public.import_rows set created_at='2000-01-01' where batch_id=b;
 r:=public.claim_import_discovery();if (r->>'batch_id')::uuid<>b or r->>'status'<>'discovering' then raise exception 'Durable discovery claim failed';end if;
 failed:=false;begin perform public.finish_import_discovery((r->>'id')::uuid,gen_random_uuid(),'{"platform":"ghost","status":"authorization_required"}');exception when others then failed:=true;end;if not failed then raise exception 'Stale discovery callback accepted';end if;
 perform public.finish_import_discovery((r->>'id')::uuid,(r->>'lease_token')::uuid,'{"platform":"ghost","status":"authorization_required","guide":"Connect an authorized Ghost Admin integration key","report":{"native_api":"detected"}}');
 if not exists(select 1 from public.websites where id=(r->>'website_id')::uuid and cms_type='ghost' and connection_status='authorization_required') then raise exception 'Discovery result was not linked to the website';end if;
 insert into public.articles(tenant_id,owner_id,title,content,status) values(t,u,'Saved draft fixture','<p>V4 content for saved-article integration</p>','draft') returning id,updated_at into a,v;
 if not exists(select 1 from public.articles where id=a and status='draft') then raise exception 'Saved drafts disappeared from the article library';end if;
 select id into w from public.websites where tenant_id=t order by website_url limit 1;
 select id into w2 from public.websites where tenant_id=t and id<>w order by website_url limit 1;
 update public.websites set connection_status='connected',permission_status='verified',cms_type='custom' where id in (w,w2);
 perform pg_temp.qualify_fixture(u,w);perform pg_temp.qualify_fixture(u,w2);
 c:=public.approve_and_create_campaign(u,a,v,'Saved article launch',array[w,w2],300,now(),'{}','manual');
 if not exists(select 1 from public.campaigns where id=c and article_id=a) or (select count(*) from public.articles where tenant_id=t)<>1 then raise exception 'Campaign did not reuse the saved article ID';end if;
 if (select status from public.articles where id=a)<>'approved' then raise exception 'Draft editorial approval did not commit with campaign creation';end if;
 if (select count(*) from public.publishing_jobs where campaign_id=c)<>2 or (select count(distinct website_id) from public.publishing_jobs where campaign_id=c)<>2 then raise exception 'Unique allocation failed';end if;
 if (select min(scheduled_at) from public.publishing_jobs where campaign_id=c)<now()+interval '300 seconds' then raise exception 'First interval missing';end if;
 if (select max(scheduled_at)-min(scheduled_at) from public.publishing_jobs where campaign_id=c)<interval '300 seconds' then raise exception 'Five minute schedule missing';end if;
 failed:=false;begin perform public.approve_and_create_campaign(u,a,v-interval '1 second','Stale content review',array[w],300,now(),'{}','auto');exception when others then failed:=true;end;if not failed then raise exception 'Stale article review accepted';end if;
 failed:=false;begin perform public.create_campaign(u,a,'Duplicate domain',array[w,w],300,now(),'{}');exception when others then failed:=true;end;if not failed then raise exception 'Duplicate target accepted';end if;
 update public.websites set permission_status='credential_verified' where id=w;
 failed:=false;begin perform public.create_campaign(u,a,'Read-only credential',array[w],300,now(),'{}');exception when others then failed:=true;end;if not failed then raise exception 'Read-only access scheduled a publication';end if;
 -- Failed allocation also rolls back draft approval.
 insert into public.articles(tenant_id,owner_id,title,content,status) values(t,u,'Rollback draft','<p>Different content</p>','draft') returning id,updated_at into a,v;
 failed:=false;begin perform public.approve_and_create_campaign(u,a,v,'Invalid interval',array[w2],299,now(),'{}','manual');exception when others then failed:=true;end;if not failed or (select status from public.articles where id=a)<>'draft' then raise exception 'Failed launch leaked editorial approval';end if;
 perform public.begin_google_account(u,'v4-one-use-state','v4-test-verifier');r:=public.consume_google_account('v4-one-use-state');if (r->>'actor_id')::uuid<>u or public.consume_google_account('v4-one-use-state') is not null then raise exception 'OAuth state replay protection failed';end if;
 n:=0;for i in 1..121 loop if public.consume_api_rate(u) then n:=n+1;end if;end loop;if n<>120 then raise exception 'API rate limit did not apply';end if;
 if (select count(*) from public.websites)<>before_count+50 then raise exception 'Existing inventory was unexpectedly changed';end if;
 if has_table_privilege('authenticated','private.website_credentials','select') or has_table_privilege('authenticated','private.integration_credentials','select') then raise exception 'A browser user can read stored secrets';end if;
 if has_function_privilege('authenticated','public.import_website_inventory(uuid,uuid,text,jsonb)','execute') or has_function_privilege('authenticated','public.read_google_account(uuid)','execute') then raise exception 'A browser user can call privileged backend operations';end if;
 if exists(select 1 from pg_class where oid in ('public.import_batches'::regclass,'public.import_rows'::regclass,'public.website_metrics'::regclass,'public.user_integrations'::regclass) and not relrowsecurity) then raise exception 'A V4 data table lacks RLS';end if;
end $$;
select 'V4 database: 24 import, article, campaign, permission, scheduling, OAuth, rate-limit and security assertions passed; all fixtures roll back' as result;
rollback;
