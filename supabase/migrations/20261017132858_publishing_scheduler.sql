-- Dedicated new Guest Posts SaaS backend only. Empty queue verified. Generate an internal-only scheduler token in Vault; never expose or export it.
insert into private.runtime_config(singleton,project_url) values(true,'https://aiolueflrpraiaqvdscp.supabase.co') on conflict(singleton) do update set project_url=excluded.project_url;
do $$ begin if not exists(select 1 from vault.secrets where name='scheduler_token') then perform vault.create_secret(encode(extensions.gen_random_bytes(48),'hex'),'scheduler_token','Internal Cron authentication. Never return to browsers.');end if;end $$;
select cron.schedule('guestpost-publish-worker','30 seconds','select private.tick();');
