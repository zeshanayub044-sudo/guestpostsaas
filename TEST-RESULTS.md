# Verification - Version 5, 25 October 2026

Dedicated scope: guestpostsaas and Supabase aiolueflrpraiaqvdscp. Existing three websites, original approved article and owner account are preserved. The attached article is saved as a separate unapproved draft, with an unchanged original and a separately labeled assistant-prepared SEO proposal. No campaign or external publication was launched.

| Check | Result |
|---|---|
| Node domain/import/export suite | 16 passed |
| Edge sanitizer, transport, connector and V5 security suite | 36 passed |
| Browser network/origin/permission checks | 6 passed |
| Controlled real Chromium editor and recovery suite | 13 scenarios plus suite passed |
| V3 database rollback suite | 25 invariants passed |
| V4 database rollback suite | 24 assertions passed |
| V5 database rollback suite | Passed: trusted enrollment, role metadata isolation, first-login fence, service-role session checks, assignment/tenant RLS, approval, suspension/reactivation, atomic smoke scheduling, duplicate launch and edited-version rejection, and private data |
| Edge checks | All five entrypoints passed |
| Owner sign-in | Verified in actual local V5 UI against production Auth/API |
| Owner article preflight | Eight saved checks; blocked for approval/destination/credential; zero live URLs |
| Export validation | Actual eight-row evidence in CSV/XLSX/PDF; 45-row labeled publication fixture; exact links, XLSX hyperlinks/filter and CSV formula safety |
| Production build | Passed; final CI also checks the deployed revision |

Database fixtures roll back. Chromium fixture results are protocol/workflow tests, not a real third-party CMS certification. Export fixture URLs are test-only example.org values and never become owner publication records. The actual owner preflight exports contain no live publication URL.

## Remaining live acceptance

- A production employee creation/password-change/suspension/retained-JWT test was rejected by automatic approval review because its real-tenant account/access mutations require an explicitly scoped disposable test account. It did not run; the transactional database checks passed.
- Actual employee invitation/recovery delivery requires configured Auth email delivery and a permitted recipient.
- CMS publication, public article URL acceptance and background publication while the dashboard is closed require a verified authorized destination and explicit approval for the exact article. Browser targets also require a production worker host.
- Google OAuth consent/renew/revoke requires the user’s OAuth application and consent.
- OpenAI generation, Ahrefs DR/traffic, Moz Spam Score/DA and Brave discovery require tenant-configured licensed credentials. None were supplied or called in this release. All five publisher prospects have Unknown quality metrics; none are advertised as qualified or publishable.
- Client-share creation/revocation is implemented with selected verified snapshots; live report acceptance awaits a real successful publication. Invalid public tokens are rejected.

Security advisors retain the prior disabled leaked-password-protection warning and private.oauth_requests informational no-policy notice. No new anonymous table access or service credential exposure was added.

See [V5 operations](docs/V5-OPERATIONS.md) for workflows and boundaries. Prior V2/V3/V4 evidence remains under docs/.
