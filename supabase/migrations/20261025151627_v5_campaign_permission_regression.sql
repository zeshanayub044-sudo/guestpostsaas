-- Keep the negation token separate when adapting legacy allocation gates.
do $$ declare d text;begin
 d:=pg_get_functiondef('public.create_campaign_v3(uuid,uuid,text,uuid[],integer,timestamptz,jsonb)'::regprocedure);
 if position('notprivate.actor_permission' in d)>0 then execute replace(d,'notprivate.actor_permission','not private.actor_permission');end if;
end $$;
