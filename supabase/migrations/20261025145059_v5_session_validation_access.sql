-- Auth session storage remains private. The API receives only a scoped boolean.
create function private.validate_actor_session(p_actor uuid,p_session uuid,p_password_flow boolean) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join auth.sessions s on s.user_id=p.id where p.id=p_actor and s.id=p_session and s.created_at>=p.min_session_created_at and p.active and (p_password_flow or not p.password_change_required))
$$;
revoke all on function private.validate_actor_session(uuid,uuid,boolean) from public,anon,authenticated;grant execute on function private.validate_actor_session(uuid,uuid,boolean) to service_role;
create or replace function public.validate_actor_session(p_actor uuid,p_session uuid,p_password_flow boolean default false) returns boolean language sql stable set search_path='' as $$ select private.validate_actor_session(p_actor,p_session,p_password_flow) $$;
create or replace function public.record_signin_activity(p_actor uuid,p_session uuid) returns void language plpgsql set search_path='' as $$ declare t uuid;n integer;begin
 select tenant_id into t from public.profiles where id=p_actor and active;if t is null or not public.validate_actor_session(p_actor,p_session,true) then return;end if;
 insert into private.signin_activity(session_id,user_id) values(p_session,p_actor) on conflict do nothing;get diagnostics n=row_count;if n=1 then insert into public.publishing_logs(tenant_id,actor_id,event_type,message) values(t,p_actor,'employee_signed_in','Account signed in to the publishing workspace.');end if;
end $$;
revoke all on function public.validate_actor_session(uuid,uuid,boolean),public.record_signin_activity(uuid,uuid) from public,anon,authenticated;grant execute on function public.validate_actor_session(uuid,uuid,boolean),public.record_signin_activity(uuid,uuid) to service_role;
