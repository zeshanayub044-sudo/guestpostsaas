-- Dedicated GuestPost project only. Existing accounts and tenant data are retained.
alter table public.websites drop constraint websites_cms_type_check;
alter table public.websites add constraint websites_cms_type_check check(cms_type in ('wordpress','ghost','shopify','webflow','blogger','wix','drupal','joomla','custom','manual'));
alter table public.websites drop constraint websites_connection_status_check;
alter table public.websites add constraint websites_connection_status_check check(connection_status in ('untested','connected','error','revoked','authorization_required','limited','unsupported','manual'));
alter table public.websites add column connector_config jsonb not null default '{}', add column permission_status text not null default 'unverified', add column rate_limit_until timestamptz;
alter table public.websites alter min_interval_seconds set default 300;
update public.websites set min_interval_seconds=greatest(300,min_interval_seconds);
alter table public.websites drop constraint websites_min_interval_seconds_check;
alter table public.websites add constraint websites_min_interval_seconds_check check(min_interval_seconds between 300 and 86400);
create index websites_eligible_idx on public.websites(tenant_id,category,language,cms_type) where status='active' and connection_status='connected';
alter table public.settings alter default_interval set default 300;
update public.settings set default_interval=greatest(default_interval,300);
alter table public.settings drop constraint settings_default_interval_check;
alter table public.settings add constraint settings_default_interval_check check(default_interval between 300 and 86400);
alter table public.articles add column canonical_url text, add column content_fingerprint text generated always as (md5(content)) stored;
create index articles_content_fingerprint_idx on public.articles(tenant_id,content_fingerprint);
alter table public.campaigns add column last_attempt_started_at timestamptz, add column selection_mode text not null default 'manual';
alter table public.campaigns drop constraint campaigns_total_websites_check;
alter table public.campaigns add constraint campaigns_total_websites_check check(total_websites between 1 and 500);
update public.campaigns set publishing_interval_seconds=greatest(300,publishing_interval_seconds);
alter table public.campaigns drop constraint campaigns_publishing_interval_seconds_check;
alter table public.campaigns add constraint campaigns_publishing_interval_seconds_check check(publishing_interval_seconds between 300 and 86400);
alter table public.publishing_jobs alter remote_post_id type text using remote_post_id::text;
alter table public.publishing_jobs add column started_at timestamptz, add column target_snapshot jsonb not null default '{}';
update public.publishing_jobs j set target_snapshot=jsonb_build_object('website_url',w.website_url,'api_endpoint',w.api_endpoint,'cms_type',w.cms_type,'connector_config',w.connector_config) from public.websites w where w.id=j.website_id;

create table public.platform_connectors(id text primary key, name text not null, authentication text not null, guide text not null, docs text not null, automatic boolean not null, canonical boolean not null);
alter table public.platform_connectors enable row level security;
create policy connectors_authenticated_read on public.platform_connectors for select to authenticated using ((select auth.uid()) is not null);
revoke all on public.platform_connectors from anon,authenticated;
grant select on public.platform_connectors to authenticated;
grant all on public.platform_connectors to service_role;
create view public.campaign_targets with (security_invoker=true) as select id,campaign_id,tenant_id,website_id,ordinal,status,scheduled_at,target_snapshot from public.publishing_jobs;
create view public.publication_results with (security_invoker=true) as select id,tenant_id,campaign_id,website_id,published_at,published_url,response_info from public.publishing_jobs where status='published';
create view public.application_settings with (security_invoker=true) as select * from public.settings;
grant select on public.campaign_targets,public.publication_results,public.application_settings to authenticated,service_role;

create table private.oauth_requests(state_hash text primary key, website_id uuid not null references public.websites(id) on delete cascade, actor_id uuid not null references public.profiles(id), verifier text not null, expires_at timestamptz not null default now()+interval '10 minutes');
alter table private.oauth_requests enable row level security;
revoke all on private.oauth_requests from public,anon,authenticated;
grant all on private.oauth_requests to service_role;
create index oauth_requests_website_idx on private.oauth_requests(website_id);
create index oauth_requests_actor_idx on private.oauth_requests(actor_id);
create function public.begin_google_connection(p_actor uuid,p_website uuid,p_state text,p_verifier text) returns void language plpgsql set search_path='' as $$
begin
  if not exists(select 1 from public.profiles p join public.websites w on w.tenant_id=p.tenant_id where p.id=p_actor and p.active and p.role in ('super_admin','admin') and w.id=p_website and w.cms_type='blogger') then raise exception 'Connection permission denied'; end if;
  delete from private.oauth_requests where expires_at<now() or website_id=p_website;
  insert into private.oauth_requests(state_hash,website_id,actor_id,verifier) values(md5(p_state),p_website,p_actor,p_verifier);
end $$;
create function public.consume_google_connection(p_state text) returns jsonb language plpgsql set search_path='' as $$
declare r private.oauth_requests;
begin
  delete from private.oauth_requests where state_hash=md5(p_state) and expires_at>now() returning * into r;
  if r.website_id is null or not exists(select 1 from public.profiles p join public.websites w on w.tenant_id=p.tenant_id where p.id=r.actor_id and p.active and p.role in ('super_admin','admin') and w.id=r.website_id and w.cms_type='blogger') then raise exception 'Authorization request expired or access was revoked'; end if;
  return to_jsonb(r);
end $$;
revoke all on function public.begin_google_connection(uuid,uuid,text,text),public.consume_google_connection(text) from public,anon,authenticated;
grant execute on function public.begin_google_connection(uuid,uuid,text,text),public.consume_google_connection(text) to service_role;

drop function public.save_remote_id(uuid,uuid,bigint);
create function public.save_remote_id(p_job uuid,p_token uuid,p_remote_id text) returns boolean language plpgsql set search_path='' as $$
begin
  if p_remote_id is null or length(p_remote_id) not between 1 and 300 or p_remote_id !~ '^[A-Za-z0-9:/_.-]+$' then raise exception 'Invalid remote identifier'; end if;
  update public.publishing_jobs set remote_post_id=p_remote_id where id=p_job and lease_token=p_token and status='processing' and (remote_post_id is null or remote_post_id=p_remote_id);
  return found;
end $$;
revoke all on function public.save_remote_id(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.save_remote_id(uuid,uuid,text) to service_role;

create or replace function public.create_campaign(p_actor uuid,p_article uuid,p_name text,p_sites uuid[],p_interval integer,p_start timestamptz,p_overrides jsonb default '{}') returns uuid language plpgsql set search_path='' as $$
declare actor public.profiles; article public.articles; n integer; c uuid; w uuid; idx integer:=1; jid uuid; first_base timestamptz;
begin
  -- Serialize allocation for one workspace so identical content cannot race into two campaigns.
  select * into actor from public.profiles where id=p_actor and active;
  if actor.id is null or not(actor.role in ('super_admin','admin') or actor.can_publish) then raise exception 'Publishing permission required'; end if;
  perform 1 from public.tenants where id=actor.tenant_id for update;
  select * into article from public.articles where id=p_article and tenant_id=actor.tenant_id and status='approved' for share;
  if article.id is null then raise exception 'Select an approved article'; end if;
  n:=cardinality(p_sites);
  if n is null or n<1 or n>500 or p_interval not between 300 and 86400 or p_start is null or length(trim(p_name)) not between 1 and 200 then raise exception 'Choose 1–500 targets and an interval of at least five minutes'; end if;
  if (select count(distinct x) from unnest(p_sites) x)<>n then raise exception 'Duplicate website selection'; end if;
  if (select count(*) from public.websites where id=any(p_sites) and tenant_id=actor.tenant_id and status='active' and connection_status='connected' and cms_type<>'manual')<>n then raise exception 'Every website must be connected and enabled'; end if;
  if exists(select 1 from public.publishing_jobs j join public.articles a on a.id=j.article_id where j.website_id=any(p_sites) and a.tenant_id=actor.tenant_id and a.content_fingerprint=article.content_fingerprint and (j.status<>'cancelled' or j.remote_attempt_started or j.remote_post_id is not null or j.needs_reconciliation)) then raise exception 'This content already has a job on a selected website; retry the existing job'; end if;
  first_base:=greatest(p_start,now());
  insert into public.campaigns(tenant_id,owner_id,campaign_name,article_id,article_snapshot,total_websites,publishing_interval_seconds,start_time)
    values(actor.tenant_id,p_actor,trim(p_name),p_article,to_jsonb(article),n,p_interval,first_base) returning id into c;
  foreach w in array p_sites loop
    jid:=gen_random_uuid();
    insert into public.publishing_jobs(id,tenant_id,campaign_id,article_id,website_id,ordinal,scheduled_at,max_attempts,remote_slug,overrides,target_snapshot)
    select jid,actor.tenant_id,c,p_article,w,idx,first_base+make_interval(secs=>idx*p_interval),s.max_attempts,left(coalesce(nullif(article.slug,''),'article'),75)||'-gps-'||replace(jid::text,'-',''),coalesce(p_overrides->w::text,'{}'),jsonb_build_object('website_url',t.website_url,'api_endpoint',t.api_endpoint,'cms_type',t.cms_type,'connector_config',t.connector_config)
    from public.settings s,public.websites t where s.tenant_id=actor.tenant_id and t.id=w;
    idx:=idx+1;
  end loop;
  insert into public.publishing_logs(tenant_id,event_type,message) values(actor.tenant_id,'campaign_created',trim(p_name)||': '||n||' jobs, first attempt after '||p_interval||' seconds');
  return c;
end $$;

create function public.create_inline_campaign(p_actor uuid,p_article jsonb,p_name text,p_sites uuid[],p_interval integer,p_start timestamptz,p_overrides jsonb,p_mode text) returns uuid language plpgsql set search_path='' as $$
declare a public.profiles; aid uuid; cid uuid;
begin
  select * into a from public.profiles where id=p_actor and active;
  if a.id is null or not(a.role in ('super_admin','admin') or a.can_publish) then raise exception 'Publishing permission required'; end if;
  insert into public.articles(tenant_id,owner_id,title,content,meta_title,meta_description,slug,focus_keyword,featured_image,canonical_url,category,tags,status,approved_by,approved_at)
  values(a.tenant_id,a.id,p_article->>'title',p_article->>'content',coalesce(p_article->>'meta_title',''),coalesce(p_article->>'meta_description',''),coalesce(p_article->>'slug',''),coalesce(p_article->>'focus_keyword',''),p_article->>'featured_image',p_article->>'canonical_url',coalesce(p_article->>'category',''),array(select jsonb_array_elements_text(coalesce(p_article->'tags','[]'))),'approved',a.id,now()) returning id into aid;
  cid:=public.create_campaign(p_actor,aid,p_name,p_sites,p_interval,p_start,p_overrides);
  update public.campaigns set selection_mode=case when p_mode in ('auto','manual','category') then p_mode else 'auto' end where id=cid;
  return cid;
end $$;
revoke all on function public.create_inline_campaign(uuid,jsonb,text,uuid[],integer,timestamptz,jsonb,text) from public,anon,authenticated;
grant execute on function public.create_inline_campaign(uuid,jsonb,text,uuid[],integer,timestamptz,jsonb,text) to service_role;

create function public.eligible_websites(p_actor uuid,p_content text,p_category text default '',p_language text default '',p_platform text default '') returns setof public.websites language sql stable set search_path='' as $$
  select w.* from public.websites w join public.profiles p on p.tenant_id=w.tenant_id
  where p.id=p_actor and p.active and (p.role in ('super_admin','admin') or p.can_publish)
    and w.status='active' and w.connection_status='connected' and w.cms_type<>'manual'
    and (p_category='' or lower(w.category)=lower(p_category)) and (p_language='' or w.language=p_language) and (p_platform='' or w.cms_type=p_platform)
    and not exists(select 1 from public.publishing_jobs j join public.articles a on a.id=j.article_id where j.website_id=w.id and a.content_fingerprint=md5(p_content) and (j.status<>'cancelled' or j.remote_attempt_started or j.remote_post_id is not null or j.needs_reconciliation))
  order by (select max(j.published_at) from public.publishing_jobs j where j.website_id=w.id) nulls first,w.id limit 5000
$$;
revoke all on function public.eligible_websites(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.eligible_websites(uuid,text,text,text,text) to service_role;

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
    select greatest(300,c0.publishing_interval_seconds,w.min_interval_seconds) into wait_seconds from public.publishing_jobs j0 join public.campaigns c0 on c0.id=j0.campaign_id join public.websites w on w.id=j0.website_id where j0.id=s.active_job_id;
    update private.worker_state set active_job_id=null,lease_until=null,lease_token=null,next_allowed_at=greatest(next_allowed_at,now()+make_interval(secs=>coalesce(wait_seconds,86400))) where singleton;
    return null;
  end if;
  if s.next_allowed_at>now() then return null; end if;
  select j0.* into j from public.publishing_jobs j0
    join public.campaigns c0 on c0.id=j0.campaign_id
    join public.websites w on w.id=j0.website_id
    where (c0.last_attempt_started_at is null or c0.last_attempt_started_at+make_interval(secs=>greatest(300,c0.publishing_interval_seconds))<=now()) and (w.rate_limit_until is null or w.rate_limit_until<=now()) and j0.status in ('pending','scheduled') and j0.scheduled_at<=now() and c0.status='running'
      and w.status='active' and w.connection_status='connected'
    order by j0.scheduled_at,j0.ordinal limit 1 for update of j0 skip locked;
  if j.id is null then return null; end if;
  select * into c from public.campaigns where id=j.campaign_id for update;
  if c.status<>'running' then return null; end if;
  token:=gen_random_uuid(); update public.campaigns set last_attempt_started_at=now() where id=c.id;
  update public.publishing_jobs set status='processing',started_at=now(),attempts=attempts+1,lease_token=token,lease_until=now()+interval '10 minutes' where id=j.id returning * into j;
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
  if coalesce((p_result->>'success')::boolean,false) and coalesce(p_result->>'url','') !~ '^https://' then raise exception 'A confirmed HTTPS publication URL is required'; end if;
  if coalesce((p_result->>'auth_invalid')::boolean,false) then update public.websites set connection_status='authorization_required',permission_status='authorization_required',connection_message='Reconnect this account before retrying publications.' where id=j.website_id; end if;
  if coalesce((p_result->>'retry_after')::integer,0)>0 then update public.websites set rate_limit_until=now()+make_interval(secs=>least(604800,(p_result->>'retry_after')::integer)) where id=j.website_id; end if;
  gap:=greatest(300,c.publishing_interval_seconds,(select min_interval_seconds from public.websites where id=j.website_id));
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

insert into public.platform_connectors(id,name,authentication,guide,docs,automatic,canonical) values
('wordpress','WordPress','Application password','In WordPress, open Users → Profile → Application Passwords. Create a dedicated password and use your WordPress username. Your normal login password may not work.','https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/',true,false),
('ghost','Ghost','Admin integration key','In Ghost Admin, open Settings → Advanced → Integrations → Add custom integration. Use its Admin API key, not the Content API key. Ghost''s admin domain can differ from your public website.','https://docs.ghost.org/admin-api/',true,true),
('shopify','Shopify Blogs','Installed app credentials','Install an app with read_content and write_content. For a store in your own Shopify organization, provide the app client ID and secret. Other stores need merchant OAuth installation or an existing Admin access token.','https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant',true,false),
('webflow','Webflow CMS','Site API token','In Webflow Site settings → Apps & integrations → API access, create a token with CMS read and write. Choose the collection and confirm which field holds article content.','https://developers.webflow.com/data/reference/authentication/site-token',true,false),
('blogger','Blogger / Blogspot','Google authorization','Connect your Google account using the Blogger publishing scope. The workspace owner must first configure a Google OAuth web application and its callback URL in the backend.','https://developers.google.com/blogger/docs/3.0/using',true,false),
('wix','Wix','Owner API key','Use an API key from the site''s owner or co-owner, with Manage Blog permission. Supply the Wix site ID and the author member ID. Your Wix account password cannot authorize its publishing API.','https://dev.wix.com/docs/rest/articles/getting-started/api-keys',true,false),
('drupal','Drupal','Authorized CMS account','Your site administrator must enable JSON:API writes and HTTP Basic Authentication. The account needs create, edit and publish permission for the selected content type and text format.','https://www.drupal.org/docs/core-modules-and-themes/core-modules/jsonapi-module/creating-new-resources-post',true,false),
('joomla','Joomla','Web services API token','Enable Joomla Web Services, Content API and API token plugins. Use a token for an account with API login and create/edit-state permissions. Choose an existing article category.','https://manual.joomla.org/docs/general-concepts/webservices/',true,false),
('custom','Custom website','Publishing connector key','Your developer can implement the documented GuestPost connector contract, including authorization, draft creation, reconciliation and publication confirmation. Otherwise use manual publishing.','https://github.com/zeshanayub044-sudo/guestpostsaas/blob/main/docs/CUSTOM-CONNECTOR.md',true,true),
('manual','Manual publishing','No supported API','Keep this website in your network, export the reviewed article and publish using its normal editor. It will not be counted as an eligible automatic publishing target.','',false,false);
