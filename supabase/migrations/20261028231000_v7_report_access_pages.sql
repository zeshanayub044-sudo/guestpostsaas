-- Resolve the readable ID set once per report page. No assignment scope is widened.
create or replace function public.workbook_report_rows(p_actor uuid,p_workbook uuid,p_offset integer default 0,p_limit integer default 500) returns jsonb language plpgsql stable set search_path='' as $$
declare actor_profile public.profiles;book public.workbook_imports;result jsonb;begin
 select * into actor_profile from public.profiles where id=p_actor;
 select * into book from public.workbook_imports where id=p_workbook and tenant_id=actor_profile.tenant_id and (owner_id=actor_profile.id or private.actor_permission(actor_profile.id,'websites.read_all'));
 if book.id is null or not private.actor_permission(actor_profile.id,'websites.create') then raise exception 'Workbook access required';end if;
 with accessible as materialized(select id from private.readable_website_ids(p_actor) ids(id)),page as (select * from public.import_rows where workbook_id=book.id and tenant_id=actor_profile.tenant_id order by sequence_number offset greatest(0,p_offset) limit greatest(1,least(500,p_limit)))
 select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('qualification',case when r.website_id is null then jsonb_build_object('group','rejected','auto_ready',false,'quality_status','invalid_domain','reason',r.message) when allowed.id is null then jsonb_build_object('group','pending_verification','auto_ready',false,'reason','Website assignment required to read existing evidence.') else private.website_state(r.website_id) end) order by r.sequence_number),'[]') into result from page r left join accessible allowed on allowed.id=r.website_id;
 return result;
end $$;
-- Keep a confirmed rejection's real cause when DR has not yet been measured.
do $$ declare d text;begin d:=pg_get_functiondef('private.website_state(uuid)'::regprocedure);if position('case when (s->>''spreadsheet_source'')::boolean then' in d)=0 then raise exception 'Inspect rejection reason before replacement';end if;execute replace(d,'case when (s->>''spreadsheet_source'')::boolean then','case when s->>''group''=''rejected'' then s->>''reason'' when (s->>''spreadsheet_source'')::boolean then');end $$;
