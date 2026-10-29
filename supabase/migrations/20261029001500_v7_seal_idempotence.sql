-- A committed seal is a checkpoint. Re-selecting the same original must not
-- restart completed checks or reset their bounded retry budget.
do $$ declare d text;begin
 d:=pg_get_functiondef('public.seal_workbook_import(uuid,uuid,boolean)'::regprocedure);
 if position('if w.status in (''uploading'',''complete'',''verifying'') then' in d)=0 then raise exception 'Inspect the import seal checkpoint before replacing it';end if;
 execute replace(d,'if w.status in (''uploading'',''complete'',''verifying'') then','if w.sealed_at is null then');
end $$;
-- Close completed ledger checkpoints whose last check exhausted a lease.
-- Per-site failed/missing observations retain their unverified classification.
update public.workbook_imports b set status='complete'
where status='verifying' and sealed_at is not null and received_rows=total_rows
and not exists(select 1 from public.import_rows r join public.qualification_checks c on c.website_id=r.website_id and c.status in ('queued','processing') where r.workbook_id=b.id);
