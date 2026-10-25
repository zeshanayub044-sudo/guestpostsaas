create function private.publishing_runtime_status() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('scheduler_active',exists(select 1 from cron.job where jobname='guestpost-publish-worker' and active),'schedule',(select schedule from cron.job where jobname='guestpost-publish-worker' limit 1),'checked_at',clock_timestamp())
$$;
revoke all on function private.publishing_runtime_status() from public,anon,authenticated;grant execute on function private.publishing_runtime_status() to service_role;
create or replace function public.publishing_runtime_status() returns jsonb language sql stable set search_path='' as $$ select private.publishing_runtime_status() $$;
revoke all on function public.publishing_runtime_status() from public,anon,authenticated;grant execute on function public.publishing_runtime_status() to service_role;
