# V6 production recovery review

Status: the V6 migration is applied and the matching backend is deployed in the existing project. The public frontend is released through the repository’s checked deployment workflow. The owner approved the scoped V6 deployment on 26 October 2026 after automatic review required specific permission for production access-rule changes.

## Proposed live change

Apply `supabase/migrations/20261025193141_spreadsheet_qualification_v6.sql` only to the existing `guest posts saas` project (`aiolueflrpraiaqvdscp`). Deploy the updated API, publishing worker and browser bridge, plus a separate qualification worker, then enable its private scheduler. Publish the matching frontend to the existing GitHub Pages repository after backend validation.

The migration preserves the existing inventory and research in a private backup before classification. It adds workbook provenance, a resumable row ledger, website assignments and current qualification evidence. It narrows website and article access and makes source, quality and permission checks mandatory at campaign creation, job claim and dispatch. Ordinary browser accounts cannot call the service-only bypass functions. Existing 500-publication and five-minute interval limits remain in force. The new qualification scheduler performs read-only checks; it cannot publish an article.

## External dependencies still blocked

- The latest attachment is an instruction document containing a spreadsheet placeholder. No actual owner XLSX, XLS or CSV has been attached. No owner workbook has been processed or certified.
- Licensed Moz evidence, traffic provider access and OpenAI generation need configured, authorized provider credentials. Source values and assistant-prepared text remain explicitly unverified/proposed.
- Browser publishing needs an authorized persistent Node/Playwright host and worker enrollment. Supabase Edge Functions and static GitHub Pages cannot run that service.
- A real CMS publication needs an authorized target, usable publishing credentials and explicit approval of the exact article and destination.
- Google OAuth needs a configured Google application and the real account consent flow.

## Preserved owner data

Three existing website records are retained. An existing website label/domain mismatch is flagged for review without silently changing either value. The five earlier research prospects are retained in a legacy archive outside spreadsheet candidate lists. The previously supplied retirement article remains an unapproved source draft. No campaign or external publication is created by this recovery change.

## Verification approach

Node and Edge tests cover all-sheet parsing beyond 500 rows, physical blank-row references, duplicate outcomes, secret-bearing source rejection, strict Moz thresholds, unknown versus zero metrics, freshness, safe redirects, reachability outcomes and original source preservation. SQL fixtures run inside rollback transactions and check provenance proofs, chunk replay, assignment scopes, current readiness and browser-role execution boundaries. Local PostgreSQL testing uses isolated platform adapters for Auth, Vault, Storage, Cron and HTTP; actual platform deployment still requires post-deployment checks.
