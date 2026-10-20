-- Optional operational rollback. Do not run during normal installation.
-- Disables browser automation while retaining all data and API publishing.
begin;
update public.browser_workers set active=false where active;
update public.websites set status='disabled',connection_status='setup_required',connection_message='Browser publishing is disabled for operational rollback.' where connection_method='browser';
update public.connection_checks set status='superseded',completed_at=now() where status in ('queued','processing');
commit;
-- Restore the prior Pages/API source if needed. Keep the V3 database schema so
-- historical browser results and immutable duplicate fingerprints are retained.
