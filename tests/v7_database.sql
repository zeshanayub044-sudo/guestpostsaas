begin;
do $$ declare actor uuid:=gen_random_uuid();other_actor uuid:=gen_random_uuid();tenant uuid;site uuid;denied boolean;envelope jsonb;book jsonb;begin
 insert into auth.users(id,email) values(actor,'v7-isolated-'||actor||'@fixture.invalid');select tenant_id into tenant from public.profiles where id=actor;
 insert into auth.users(id,email) values(other_actor,'v7-other-'||other_actor||'@fixture.invalid');
 insert into public.websites(tenant_id,owner_id,website_name,website_url,api_endpoint,cms_type,status,connection_status,permission_status,connection_method) values(tenant,actor,'V7 isolated website','https://v7-isolated.publisher.org','https://v7-isolated.publisher.org/api','custom','active','connected','verified','api') returning id into site;
 perform pg_temp.qualify_fixture(actor,site);if not private.website_is_ready(site) then raise exception 'Fully qualified three-provider fixture blocked';end if;
 declare before_count bigint;begin
  select count(*) into before_count from public.qualification_checks;
  perform public.seal_workbook_import(actor,(select workbook_id from public.import_rows where website_id=site limit 1),false);
  if (select count(*) from public.qualification_checks)<>before_count then raise exception 'Retrying a sealed workbook must not enqueue its websites again';end if;
 end;
 if not exists(select 1 from private.readable_website_ids(actor) x where x=site) or exists(select 1 from private.readable_website_ids(other_actor) x where x=site) then raise exception 'Paged inventory changed tenant access';end if;
 if jsonb_array_length(public.inventory_readiness(actor))<>1 then raise exception 'Paged owner inventory failed';end if;
 if jsonb_array_length(public.workbook_qualification_page(actor,(select workbook_id from public.import_rows where website_id=site limit 1)))<>1 then raise exception 'Bounded qualification page failed';end if;
 denied:=false;begin perform public.workbook_qualification_page(other_actor,(select workbook_id from public.import_rows where website_id=site limit 1));exception when others then denied:=true;end;if not denied then raise exception 'Cross-tenant workbook page leaked';end if;
 update public.website_metrics set value=29 where website_id=site and metric='domain_rating';if private.website_is_ready(site) or private.website_state(site)->>'quality_status'<>'rejected_low_dr' then raise exception 'DR below thirty passed';end if;
 delete from public.website_metrics where website_id=site and metric='domain_rating';if private.website_is_ready(site) or private.website_state(site)->>'quality_status'<>'pending_seo_verification' then raise exception 'Unknown DR qualified';end if;
 envelope:=public.store_workbook_envelope(actor,repeat('d',64),tenant::text||'/'||actor::text||'/'||repeat('d',64)||'-fixture.enc',repeat('a',44),repeat('b',16));if envelope->>'key' is not null then raise exception 'Store response returned source key';end if;
 if public.read_workbook_envelope(other_actor,repeat('d',64)) is not null then raise exception 'Cross-tenant encrypted source exposed';end if;
 if has_function_privilege('authenticated','public.read_workbook_envelope(uuid,text)','execute') or has_table_privilege('authenticated','private.workbook_envelopes','select') then raise exception 'Browser role can read source keys';end if;
 book:=public.start_workbook_import(actor,'isolated.csv',repeat('e',64),'isolated-fixture','[{"name":"Without headers","header_row":0,"row_count":1,"headers":["Column A"]}]','["source-proof"]');if book->>'id' is null then raise exception 'Headerless manifest could not preserve row one';end if;
end $$;
rollback;
