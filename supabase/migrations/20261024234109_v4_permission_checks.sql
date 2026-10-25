create table public.connection_permission_checks(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),website_id uuid not null,connection_version integer not null,status text not null check(status in ('creating','cleanup_pending','verified','failed','outcome_unknown')),marker text not null,remote_id text,error_code text,created_at timestamptz not null default now(),completed_at timestamptz,foreign key(tenant_id,website_id) references public.websites(tenant_id,id),unique(website_id,connection_version));
alter table public.connection_permission_checks enable row level security;
create policy tenant_read on public.connection_permission_checks for select to authenticated using(tenant_id=(select private.tenant_id()));
revoke all on public.connection_permission_checks from public,anon,authenticated;grant select on public.connection_permission_checks to authenticated;grant all on public.connection_permission_checks to service_role;
create index connection_permission_checks_tenant_idx on public.connection_permission_checks(tenant_id,website_id);
-- A credential rotation can remove publishing rights after campaign creation.
-- Keep the existing atomic lease implementation and enforce the current permission at claim time too.
do $$ declare definition text;needle text:='and w.status=''active'' and w.connection_status=''connected'' and w.connection_method=p_method';begin
 definition:=pg_get_functiondef('public.claim_next_job(text,uuid)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Queue implementation differs; inspect before adding the permission guard';end if;
 execute replace(definition,needle,'and w.status=''active'' and w.connection_status=''connected'' and w.permission_status=''verified'' and w.connection_method=p_method');
end $$;
