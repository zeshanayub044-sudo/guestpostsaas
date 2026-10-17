# Verification — Version 2, 18 October 2026

Scope: only the dedicated Supabase project aiolueflrpraiaqvdscp and zeshanayub044-sudo/guestpostsaas. Existing administrator account preserved; browser checks use a separate disposable QA tenant.

## Automated checks

| Suite | Verified result |
|---|---|
| Frontend domain / CSV | 7 passed: quantities 1–500, initial five-minute wait, all duration examples, minimum interval, import parsing and credential-column rejection, formula-safe exports |
| Edge / transport / connectors | 18 passed: HTML sanitization, public HTTPS/IP restrictions, DNS-pinned TLS, HTTP framing and uncertainty, Ghost draft checkpoint/reconciliation/JWT, Shopify logical errors, Webflow single-item/live checks, Drupal stable UUID, custom idempotency, connection binding and native Wix formatting |
| Live transactional database suite | 30 passed; all fixtures rolled back: 100 and 500 distinct jobs, 8h20m / 41h40m schedules, first-job wait, five-minute floor, upper quantity bound, allocation exclusions, locking, pause/resume/cancel, retries/Retry-After, expired-lease reconciliation, tenant RLS, protected credentials/OAuth state and invoker views |
| Live authenticated HTTP API | 22 passed against API v6 / worker v4: real login/profile, public WordPress HTTPS read, manual metadata, sanitization/approval, real shortage, ineligible-target rejection, browser privilege denials, revocation/deletion and logout |
| Backend type check | All three entrypoints passed |
| Production build | Passed after browser fixes; JS 299.37 kB (87.31 kB gzip), CSS 39.32 kB (9.51 kB gzip) |

The connector tests use controlled protocol responses. The database suite simulates elapsed time and successful completion inside a rollback-only transaction. Neither is evidence of an actual external CMS publication or a 41-hour live campaign.

## Live browser and backend checks

- Real Supabase login using confirmed disposable QA accounts; no administrator credentials were used for tests.
- Seven essential navigation items, real database metrics and zero fabricated publication counts.
- Server-generated preview of 100 publications: 0 eligible targets, shortage 100, 8h20m estimate, safe formatted article preview and disabled Start. No jobs created.
- Website discovery of the owner-controlled Pages site correctly falls back to manual publishing, without submitting any CMS credential.
- CSV preview parsed two owner-controlled website URLs; import added one new row and skipped the existing connection without overwriting it.
- Formatted article saved to the real database through the HTML editor and explicitly approved; the original article library remains functional.
- Desktop checked at 1440 × 1000 and mobile at 390 × 844. Mobile document width was 375 px within the 390 px viewport; the navigation drawer opened.
- Maximum quantity preset displayed 500 and the expected 41h40m estimate. No console errors after the browser fix.
- QA screenshots are kept locally and excluded from the public source upload.

## Backend deployment

- Migration universal_publishing_v2 applied as version 20261017212753. Its local filename matches remote history.
- API version 6, publishing-worker version 4 and Google OAuth callback version 1 are active. Function bodies authenticate users, the private Cron token or one-use OAuth state respectively; gateway JWT verification is intentionally disabled.
- Cron guestpost-publish-worker remains active every 30 seconds.
- The new OAuth state table has RLS and no browser grants/policies, intentionally denying browser access. Its no-policy advisor notice is informational.
- Security advisor warns that leaked-password protection is disabled. Supabase makes this feature available on Pro and above; the project is on Free, and no paid upgrade was purchased. See https://supabase.com/docs/guides/auth/password-security.
- Unused-index informational notices are expected on an empty workload; no missing foreign-key indexes were reported.

## External acceptance still required

1. Authorized WordPress and second-CMS test website credentials. No such credentials were supplied, so no real external article was published.
2. Real closed-browser publication and an observed full-length campaign. Independent Cron invocation and database spacing are verified, but a short test is not a multi-hour publication run.
3. Google OAuth client/consent/callback setup for Blogger; provider app scopes, site templates, content fields, workflows and media permissions for other CMS integrations.
4. Production email delivery and administrator confirmation/recovery/invitation delivery; SMTP credentials were not supplied.
5. Owner-selected backup, availability and password-protection options for the Supabase plan. No paid resource was provisioned.

See DEPLOYMENT.md for operational setup and provider limitations.
