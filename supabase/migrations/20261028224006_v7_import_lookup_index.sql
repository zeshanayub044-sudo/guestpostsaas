-- Match the exact immutable domain function used by resumable row imports.
-- A syntactically similar index did not match the function call under its SET search_path.
create index websites_source_domain_lookup_idx on public.websites(tenant_id,private.website_domain(website_url),created_at,id);
create index import_rows_workbook_sequence_idx on public.import_rows(workbook_id,sequence_number);
create index qualification_checks_latest_idx on public.qualification_checks(website_id,created_at desc);
