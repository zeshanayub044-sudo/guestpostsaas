-- V4: preserve existing inventory, credential vault and durable publishing queue.
alter table public.websites add column account_email text not null default '', add column country text not null default '';
create index websites_tenant_domain_idx on public.websites(tenant_id,(lower(regexp_replace(split_part(split_part(website_url,'://',2),'/',1),'^www\.',''))));
alter table public.settings add column quality_filters jsonb not null default '{"minimum_da":30,"maximum_spam":9,"minimum_traffic":1000,"enabled":false}';
alter table public.platform_connectors add column version_compatibility text not null default '', add column publishing_method text not null default 'api', add column required_permissions text[] not null default '{}', add column features jsonb not null default '{}', add column enabled boolean not null default true;
update public.platform_connectors set version_compatibility=case id when 'wordpress' then 'WordPress REST v2; application passwords WordPress 5.6+' when 'blogger' then 'Blogger API v3' when 'ghost' then 'Ghost Admin API v5-compatible' when 'shopify' then 'Admin GraphQL 2026-10' when 'webflow' then 'Data API v2' when 'wix' then 'Blog API v3' when 'drupal' then 'Drupal 10/11 JSON:API' when 'joomla' then 'Joomla 4/5/6 Web Services v1' when 'custom' then 'guestpost.v1 / custom-editor-v1' else 'Destination-specific' end,
 required_permissions=case id when 'wordpress' then array['edit_posts','publish_posts'] when 'blogger' then array['blogger','AUTHOR or ADMIN'] when 'shopify' then array['write_content'] when 'ghost' then array['Admin integration posts write'] when 'webflow' then array['cms:read','cms:write'] when 'wix' then array['Manage Blog'] when 'drupal' then array['JSON:API writes','create content','publish content'] when 'joomla' then array['core.login.api','core.create','core.edit.state'] else array['create','publish'] end,
 features=jsonb_build_object('html',automatic,'canonical',canonical,'public_url',automatic), enabled=automatic;

create table public.import_batches(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),owner_id uuid not null references public.profiles(id),request_id uuid not null,filename text not null,total_rows integer not null check(total_rows between 1 and 500),created_at timestamptz not null default now(),unique(tenant_id,id),unique(tenant_id,request_id));
create index import_batches_owner_idx on public.import_batches(owner_id);
create table public.import_rows(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),batch_id uuid not null,row_number integer not null,website_id uuid,website_url text not null default '',status text not null check(status in ('pending','discovering','discovered','invalid','duplicate','error')),cms_hint text not null default '',error_code text,message text,discovery jsonb,attempts integer not null default 0,lease_token uuid,lease_until timestamptz,created_at timestamptz not null default now(),completed_at timestamptz,foreign key(tenant_id,batch_id) references public.import_batches(tenant_id,id) on delete cascade,foreign key(tenant_id,website_id) references public.websites(tenant_id,id) on delete restrict,unique(batch_id,row_number));
create index import_rows_tenant_idx on public.import_rows(tenant_id,batch_id);
create index import_rows_website_idx on public.import_rows(tenant_id,website_id);
create index import_rows_due_idx on public.import_rows(created_at) where status in ('pending','discovering');
create table public.website_metrics(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),website_id uuid not null,metric text not null check(metric in ('domain_authority','spam_score','estimated_organic_traffic','domain_rating')),value numeric not null check(value>=0),provider text not null check(provider in ('moz','semrush','ahrefs','first_party')),source_url text not null check(source_url ~ '^https://'),observed_at timestamptz not null,verification text not null default 'reported' check(verification in ('reported','provider_verified')),created_at timestamptz not null default now(),foreign key(tenant_id,website_id) references public.websites(tenant_id,id),unique(website_id,metric),check(metric not in ('domain_authority','spam_score','domain_rating') or value<=100),check(metric<>'domain_authority' or provider='moz'),check(metric<>'domain_rating' or provider='ahrefs'));
create index website_metrics_tenant_idx on public.website_metrics(tenant_id,website_id);
create table public.user_integrations(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),owner_id uuid not null references public.profiles(id),provider text not null default 'google' check(provider='google'),account_email text not null,provider_subject text not null,scopes text[] not null,status text not null check(status in ('connected','expired','revoked')),expires_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(owner_id,provider));
create index integrations_tenant_idx on public.user_integrations(tenant_id);
create table private.integration_credentials(integration_id uuid primary key references public.user_integrations(id),secret_id uuid not null);
create table private.google_account_requests(state_hash text primary key,actor_id uuid not null references public.profiles(id),verifier text not null,expires_at timestamptz not null default now()+interval '10 minutes');
create index google_account_requests_actor_idx on private.google_account_requests(actor_id);
create table private.api_rate_limits(actor_id uuid not null,bucket timestamptz not null,requests integer not null default 0,primary key(actor_id,bucket));
do $$ declare t text; begin
 foreach t in array array['import_batches','import_rows','website_metrics'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy tenant_read on public.%I for select to authenticated using(tenant_id=(select private.tenant_id()))',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);execute format('grant all on public.%I to service_role',t);
 end loop;
 foreach t in array array['integration_credentials','google_account_requests','api_rate_limits'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('create policy service_only on private.%I for all to service_role using(true) with check(true)',t);
  execute format('revoke all on private.%I from public,anon,authenticated',t);execute format('grant all on private.%I to service_role',t);
 end loop;
end $$;
alter table public.user_integrations enable row level security;
create policy own_integration_read on public.user_integrations for select to authenticated using(owner_id=(select auth.uid()) and tenant_id=(select private.tenant_id()));
revoke all on public.user_integrations from public,anon,authenticated;grant select on public.user_integrations to authenticated;grant all on public.user_integrations to service_role;

-- Existing jobs remain the single source of truth. These views never duplicate queue state.
-- campaign_targets already exists as a security-invoker view over publishing_jobs; retain its columns.
create view public.publishing_results with(security_invoker=true) as select tenant_id,id as job_id,campaign_id,article_id,website_id,status,published_url,published_at,response_info,error_message from public.publishing_jobs where status in ('published','failed');
create view public.website_connections with(security_invoker=true) as select id as website_id,tenant_id,cms_type as connector_id,connection_method,connection_status,permission_status,connection_report,tested_at,connection_version from public.websites;
revoke all on public.campaign_targets,public.publishing_results,public.website_connections from public,anon;grant select on public.campaign_targets,public.publishing_results,public.website_connections to authenticated,service_role;

create function public.import_website_inventory(p_actor uuid,p_request uuid,p_filename text,p_rows jsonb) returns jsonb language plpgsql set search_path='' as $$
declare a public.profiles;b uuid;r jsonb;w uuid;existing uuid;added integer:=0;skipped integer:=0;bad integer:=0;st text;msg text;
begin
 select * into a from public.profiles where id=p_actor and active and role in ('admin','super_admin');if a.id is null then raise exception 'Administrator permission required';end if;
 perform 1 from public.tenants where id=a.tenant_id for update;
 select id into b from public.import_batches where tenant_id=a.tenant_id and request_id=p_request;if b is not null then return jsonb_build_object('id',b,'replayed',true,'message','This upload was already saved. Open its import report.');end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'Import 1–500 rows';end if;
 insert into public.import_batches(tenant_id,owner_id,request_id,filename,total_rows) values(a.tenant_id,a.id,p_request,p_filename,jsonb_array_length(p_rows)) returning id into b;
 for r in select value from jsonb_array_elements(p_rows) loop
  w:=null;existing:=null;st:=r->>'status';msg:=r->>'message';
  if st='pending' then
   select id into existing from public.websites where tenant_id=a.tenant_id and lower(regexp_replace(split_part(split_part(website_url,'://',2),'/',1),'^www\.',''))=r->>'domain' limit 1;
   if existing is not null then st:='duplicate';w:=existing;msg:='This domain already exists in your website inventory.';skipped:=skipped+1;
   else
    insert into public.websites(tenant_id,owner_id,website_name,website_url,api_endpoint,cms_type,connection_status,category,language,country,account_email,min_interval_seconds)
     values(a.tenant_id,a.id,r->>'website_name',r->>'website_url',r->>'website_url','custom','untested',r->>'category',r->>'language',r->>'country',r->>'account_email',300) returning id into w;added:=added+1;msg:='Inventory saved. Discovery queued; publishing authorization is separate.';
   end if;
  elsif st='duplicate' then skipped:=skipped+1;else st:='invalid';bad:=bad+1;end if;
  insert into public.import_rows(tenant_id,batch_id,row_number,website_id,website_url,status,cms_hint,error_code,message) values(a.tenant_id,b,(r->>'row_number')::integer,w,coalesce(r->>'website_url',''),st,coalesce(r->>'cms_hint',''),case when st='duplicate' then 'duplicate_domain' else r->>'error_code' end,msg);
 end loop;
 insert into public.publishing_logs(tenant_id,event_type,message) values(a.tenant_id,'inventory_imported',added||' website records imported; '||skipped||' duplicates; '||bad||' invalid rows.');
 return jsonb_build_object('id',b,'imported',added,'skipped',skipped,'invalid',bad,'message',added||' websites imported. Discovery runs in the background.');
end $$;
create function public.claim_import_discovery() returns jsonb language plpgsql set search_path='' as $$
declare r public.import_rows;begin
 update public.import_rows set status='error',message='Discovery worker interrupted. Retry this row.',error_code='discovery_lease_expired',lease_token=null,lease_until=null where status='discovering' and lease_until<now();
 select * into r from public.import_rows where status='pending' and attempts<3 order by created_at,row_number limit 1 for update skip locked;if r.id is null then return null;end if;
 update public.import_rows set status='discovering',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes' where id=r.id returning * into r;return to_jsonb(r);
end $$;
create function public.finish_import_discovery(p_row uuid,p_token uuid,p_result jsonb) returns void language plpgsql set search_path='' as $$
declare r public.import_rows;begin
 select * into r from public.import_rows where id=p_row and lease_token=p_token and status='discovering' and lease_until>now() for update;if r.id is null then raise exception 'Expired discovery lease';end if;
 update public.import_rows set status=case when p_result ? 'error' or p_result->>'status'='error' then 'error' else 'discovered' end,discovery=p_result,error_code=case when p_result ? 'error' or p_result->>'status'='error' then 'discovery_failed' else null end,message=coalesce(p_result->>'message',p_result->>'guide'),completed_at=now(),lease_token=null,lease_until=null where id=r.id;
 update public.websites set cms_type=case when p_result->>'platform' in ('wordpress','blogger','ghost','shopify','webflow','wix','drupal','joomla','custom') then p_result->>'platform' else cms_type end,connection_status=case when p_result->>'status'='error' or p_result ? 'error' then 'error' when p_result->>'status'='setup_required' then 'setup_required' else 'authorization_required' end,connection_report=coalesce(p_result->'report','{}'),connection_message=coalesce(p_result->>'message',p_result->>'guide','Connect an authorized publishing account.'),updated_at=now()
 where id=r.website_id and tenant_id=r.tenant_id and connection_status in ('untested','setup_required','authorization_required','error') and not exists(select 1 from private.website_credentials c where c.website_id=r.website_id);
end $$;

-- Preserve the vetted V3 allocation, fingerprints, leases and fencing; add V4 gates.
alter function public.create_campaign(uuid,uuid,text,uuid[],integer,timestamptz,jsonb) rename to create_campaign_v3;
create function public.create_campaign(p_actor uuid,p_article uuid,p_name text,p_sites uuid[],p_interval integer,p_start timestamptz,p_overrides jsonb default '{}') returns uuid language plpgsql set search_path='' as $$
begin
 if exists(select 1 from public.websites where id=any(p_sites) and permission_status<>'verified') then raise exception 'Verify publishing permission on every selected website first';end if;
 if (select count(distinct lower(regexp_replace(split_part(split_part(website_url,'://',2),'/',1),'^www\.',''))) from public.websites where id=any(p_sites))<>cardinality(p_sites) then raise exception 'Select each website domain only once';end if;
 return public.create_campaign_v3(p_actor,p_article,p_name,p_sites,p_interval,p_start,p_overrides);
end $$;
create function public.approve_and_create_campaign(p_actor uuid,p_article uuid,p_version timestamptz,p_name text,p_sites uuid[],p_interval integer,p_start timestamptz,p_overrides jsonb,p_mode text) returns uuid language plpgsql set search_path='' as $$
declare a public.profiles;r public.articles;c uuid;begin
 select * into a from public.profiles where id=p_actor and active;if a.id is null or not(a.role in ('admin','super_admin') or a.can_publish) then raise exception 'Publishing permission required';end if;
 select * into r from public.articles where id=p_article and tenant_id=a.tenant_id for update;if r.id is null then raise exception 'Article not found in this workspace';end if;
 if p_version is null or r.updated_at<>p_version then raise exception 'The article changed after review. Refresh and review it again';end if;
 if r.status<>'approved' then update public.articles set status='approved',approved_by=a.id,approved_at=now() where id=r.id;end if;
 c:=public.create_campaign(p_actor,p_article,p_name,p_sites,p_interval,p_start,p_overrides);update public.campaigns set selection_mode=p_mode where id=c;return c;
end $$;
alter function public.eligible_websites(uuid,text,text,text,text) rename to eligible_websites_v3;
create function public.eligible_websites(p_actor uuid,p_content text,p_category text default '',p_language text default '',p_platform text default '') returns setof public.websites language sql stable set search_path='' as $$
 select distinct on(lower(regexp_replace(split_part(split_part(w.website_url,'://',2),'/',1),'^www\.',''))) w.* from public.eligible_websites_v3(p_actor,p_content,p_category,p_language,p_platform) w where w.permission_status='verified' order by lower(regexp_replace(split_part(split_part(w.website_url,'://',2),'/',1),'^www\.','')),w.id
$$;
create function public.consume_api_rate(p_actor uuid) returns boolean language plpgsql set search_path='' as $$
declare n integer;begin delete from private.api_rate_limits where bucket<now()-interval '1 hour';insert into private.api_rate_limits(actor_id,bucket,requests) values(p_actor,date_trunc('minute',now()),1) on conflict(actor_id,bucket) do update set requests=private.api_rate_limits.requests+1 returning requests into n;return n<=120;end $$;

create function public.begin_google_account(p_actor uuid,p_state text,p_verifier text) returns void language plpgsql set search_path='' as $$
begin if not exists(select 1 from public.profiles where id=p_actor and active) then raise exception 'Active account required';end if;delete from private.google_account_requests where expires_at<now();insert into private.google_account_requests(state_hash,actor_id,verifier) values(encode(extensions.digest(p_state,'sha256'),'hex'),p_actor,p_verifier);end $$;
create function public.consume_google_account(p_state text) returns jsonb language plpgsql set search_path='' as $$
declare r private.google_account_requests;begin delete from private.google_account_requests where state_hash=encode(extensions.digest(p_state,'sha256'),'hex') and expires_at>now() returning * into r;if r.actor_id is null then return null;end if;if not exists(select 1 from public.profiles where id=r.actor_id and active) then raise exception 'Active account required';end if;return to_jsonb(r);end $$;
create function public.store_google_account(p_actor uuid,p_email text,p_subject text,p_scopes text[],p_expires timestamptz,p_tokens jsonb) returns uuid language plpgsql set search_path='' as $$
declare a public.profiles;i uuid;s uuid;begin select * into a from public.profiles where id=p_actor and active;if a.id is null then raise exception 'Active account required';end if;
 insert into public.user_integrations(tenant_id,owner_id,account_email,provider_subject,scopes,status,expires_at) values(a.tenant_id,a.id,p_email,p_subject,p_scopes,'connected',p_expires) on conflict(owner_id,provider) do update set account_email=excluded.account_email,provider_subject=excluded.provider_subject,scopes=excluded.scopes,status='connected',expires_at=excluded.expires_at,updated_at=now() returning id into i;
 select secret_id into s from private.integration_credentials where integration_id=i;if s is null then select vault.create_secret(p_tokens::text,'google-account-'||i) into s;insert into private.integration_credentials values(i,s);else perform vault.update_secret(s,p_tokens::text);end if;return i;end $$;
create function public.read_google_account(p_actor uuid) returns jsonb language sql set search_path='' as $$ select v.decrypted_secret::jsonb from public.user_integrations i join private.integration_credentials c on c.integration_id=i.id join vault.decrypted_secrets v on v.id=c.secret_id where i.owner_id=p_actor and i.status<>'revoked' $$;
create function public.revoke_google_account(p_actor uuid) returns void language plpgsql set search_path='' as $$ declare i uuid;s uuid;begin select id into i from public.user_integrations where owner_id=p_actor;select secret_id into s from private.integration_credentials where integration_id=i;delete from private.integration_credentials where integration_id=i;delete from vault.secrets where id=s;update public.user_integrations set status='revoked',updated_at=now() where id=i;end $$;

do $$ declare f record;begin for f in select p.oid::regprocedure::text signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('import_website_inventory','claim_import_discovery','finish_import_discovery','create_campaign','create_campaign_v3','approve_and_create_campaign','eligible_websites','eligible_websites_v3','consume_api_rate','begin_google_account','consume_google_account','store_google_account','read_google_account','revoke_google_account') loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;end $$;
