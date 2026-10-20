# Verification — Version 3, 20 October 2026

Scope: `zeshanayub044-sudo/guestpostsaas` and dedicated Supabase project `aiolueflrpraiaqvdscp` only. The two saved websites were preserved. Database fixtures rolled back: no test users, websites, articles, campaigns, jobs, workers or checks remained.

## Completed checks

| Suite | Result |
|---|---|
| Domain/CSV | 7 passed |
| Existing Edge/transport/API connector suite | 20 passed, including JSONB ordering and legacy API credential binding |
| Browser origin, DNS/proxy and manifest/eligibility security | 6 passed, including an explicit destination prohibition blocking the WordPress fallback |
| Real Chromium editorial fixture | 13 scenarios plus suite passed: connection probe; draft/publish/public content/backlink; repeated known ID; lost draft checkpoint; lost create response; lost publish response; wrong public page; destination prohibition; CAPTCHA/MFA; missing permission; changed layout; expired session; bad credentials; unresolved create |
| Live database rollback suite | 25 assertions passed: 200 unique targets; earliest schedule; five-minute cadence; 501/duplicate/short-interval rejection; immutable duplicate ledger after article edits; atomic claim/no overlap; stale completion; unknown remote outcomes; retry cadence; pause; API/browser separation; browser claim identity; verified publication requirement; completed lease fencing; async check; version rotation; private credentials and worker functions; tenant RLS |
| Type checks | API, publish-worker, OAuth callback and browser-bridge passed |
| Production build | Passed |

The database suite tests elapsed-time predicates with controlled transactional clock fields. It does not claim a real 16-hour/200-publication campaign. The browser fixture uses a disposable local editor and dummy credentials; it is not a real CMS certification. API connector tests use controlled protocol responses. Previous V2 evidence is retained in [V2-VERIFICATION.md](docs/V2-VERIFICATION.md).

## Implemented connector matrix

| Platform | API implementation | Browser implementation | Live destination publication in this run |
|---|---|---|---|
| WordPress | Application-password REST connector | Classic Editor profile; requires matching interface | Pending authorized test site |
| Ghost | Admin API | No dedicated browser profile | Pending |
| Shopify Blogs | Installed app/Admin GraphQL | No dedicated browser profile | Pending |
| Webflow | CMS Data API | No dedicated browser profile | Pending |
| Blogger | Google OAuth API | No dedicated browser profile | Pending |
| Wix | Owner API key + Blog API | No dedicated browser profile | Pending |
| Drupal | JSON:API | No dedicated browser profile | Pending |
| Joomla | Web Services API | No dedicated browser profile | Pending |
| Custom CMS | Documented guestpost.v1 contract | Declarative guestpost.browser.v1 forms; fixture verified | Pending a permitted configured destination |

Browser profiles currently support title, safe HTML, slug and backlinks. Featured image, taxonomy and SEO/canonical mappings require a compatible connector and are rejected if unsupported; they are not silently discarded.

## Remaining live acceptance

- Test A/B: actual WordPress and non-WordPress publication need authorized disposable CMS sites/accounts. The existing two saved sites have no stored publishing credentials.
- Test C: real Chromium fixture passed; real destination browser acceptance remains pending.
- Test D/E/G/H/I: allocation, timing gates, duplicates, credential boundaries and failure recovery passed the suites above.
- Test F: server-side Cron and database scheduling do not depend on the dashboard. Actual CMS publication while the dashboard is closed remains pending the same accounts/worker host.
- Test J: Pages and Supabase deployment verification is recorded separately during rollout. Dedicated browser-worker production deployment remains pending a suitable connected server/provider. Supplied Docker/Compose sandbox configuration has not been run on a production Linux host.

No worker token, website password, cookie, persisted browser session, private screenshot or service-role key is included in public source. The existing Supabase leaked-password-protection warning remains; no paid plan change was made.
