# V4 verification — 25 October 2026

## Resources and scope

- Repository: [zeshanayub044-sudo/guestpostsaas](https://github.com/zeshanayub044-sudo/guestpostsaas)
- Application: [GuestPost](https://zeshanayub044-sudo.github.io/guestpostsaas/)
- Supabase: **guest posts saas**, reference `aiolueflrpraiaqvdscp`.
- Original inventory at V4 start: **3 saved websites and 1 approved article**; no campaigns or registered browser workers. These records were preserved.

V4 is a deployed software repair. Full external publishing acceptance is still conditional on authorized CMS accounts and a production worker host. This report does not certify every platform or treat mocked HTTP responses as live publishing.

## Automated checks executed

| Check | Actual result |
|---|---|
| Node domain/import suite | **14 passed**; includes separate 50-row XLSX, XLS and CSV parsing/mapping tests, URL normalization, manual mapping, duplicate domains, secret-column rejection, invalid formats and bounds |
| Deno Edge/transport/connector suite | **30 passed**; includes secure sanitizer/URLs, DNS-pinned TLS, malformed/empty responses, native connector recovery, credential binding, Blogger write scope, Webflow scope/domain/collection checks and Drupal permission bridge checks |
| Browser security suite | **6 passed**; private egress, origin tricks, CONNECT restrictions, workflow manifests, live-worker and verified-permission eligibility, explicit automation prohibition |
| Real Chromium editorial fixture | **13 scenarios passed** (14 reported passes including parent suite): actual browser login, title/HTML/backlink publication and unauthenticated verification, lost checkpoints/create/publish responses, duplicate prevention, invalid credentials, MFA/CAPTCHA stop, permissions, layout change, expired session and unknown outcomes |
| Existing V3 live database rollback suite | **25 invariant assertions passed after V4**; 200 unique sites, queue cadence, limits, duplicates, atomic leases, retry/pause/failure behavior, API/browser separation, credential rotation, stale callbacks, private RPCs and tenant RLS |
| V4 live database rollback suite | **Passed**; 50 inventory records plus duplicate/invalid report rows, upload request replay, normalized existing-domain duplicates, discovery leases, draft persistence, saved-article FK reuse without an extra article, atomic approval/launch rollback, stale article review, publishing-permission gates, OAuth state replay, API rate limits and private data/RLS grants |
| Type checking | All four Edge entrypoints passed |
| Production frontend build | Passed; official pinned SheetJS dependency added with lockfile; npm audit returned zero vulnerabilities at installation |
| Supabase security advisors | No new security findings. Existing private OAuth-request no-policy informational finding and existing leaked-password-protection warning remain |

The database tests use uncommitted disposable tenants and controlled clock fields, then roll back. They do not accelerate production jobs or claim to have run a 41-hour campaign.

## Actual application + Supabase tests

1. **Sign-in:** the existing administrator signed into the upgraded build and loaded the actual tenant data.
2. **Existing article selection:** the original approved article appeared visibly in New Campaign, including title, date, status and original database ID. Its real server preview retained that ID.
3. **Spreadsheet upload:** a real `.xlsx` file containing **50 explicitly disposable sample records** was selected through the browser file chooser. The application recognized its headings, showed 50 valid rows and inserted **50 websites + one batch + 50 report rows into Supabase**. Batch ID was `de7bd76e-0339-49d8-8cef-ae8721940e3f`.
4. **Durability/background discovery:** the frontend restarted. The report still loaded all 50 rows from Supabase. Cron advanced discovery from 1 to at least 11 error results while the original page/session was absent; these deliberately nonexistent sample domains correctly failed connection discovery. The final diagnostic distinguishes HTTPS/DNS reachability from missing publishing integration. This verifies unattended **discovery**, not live CMS publication.
5. **Article creation → selection:** New Campaign → Create new article saved a real draft through `article.save` and automatically selected returned ID `426cea7b-1174-4970-a3f0-3792c5da1a98`. It was visible as a draft and reached server campaign review. The server correctly returned a one-website shortage and the UI disabled launch because the real network has no verified publishing targets.
6. **Fixture cleanup:** the exact disposable batch, its 50 website/report rows and the new draft were removed after verification. SQL confirmed **3 original websites, 1 original article, 0 campaigns**, no remaining test batch rows or draft. A cleanup audit event was retained. No real site credentials or article content were replaced.

Screenshots in the task's ignored `.local` directory are evidence of actual UI execution. They are not generated mockups or public source assets.

## Connector implementation and live verification

WordPress, Blogger, Shopify Blogs, Ghost, Webflow, Wix, Drupal, Joomla and custom guestpost.v1 API connectors are implemented. Browser support remains limited to WordPress Classic Editor and the permitted declarative custom-editor contract. See [the detailed readiness matrix](V4-OPERATIONS.md#connector-readiness-matrix).

Native API tests use controlled protocol responses. No authorized external WordPress/non-WordPress CMS account was supplied; **no real destination post was published in this V4 run**. Drupal's supplied module, Ghost/Joomla administrator permission bridges, Webflow live introspection and Wix live draft cleanup need destination acceptance. The app does not mark read-only credentials as publishing-ready to work around this dependency.

## Requested acceptance cases

| Requested workflow | Result / exact limit |
|---|---|
| Add an authorized website and establish a real connector | Connection system implemented and protocol-tested; live CMS credential required |
| Import >=50 spreadsheet rows | Actual browser → API → Supabase import/report passed; test rows cleaned |
| Non-WordPress publishing | Controlled Ghost/Webflow/Drupal/custom protocol tests pass; external live publication pending |
| Missing configuration guidance | Explicit platform/auth/permission/worker reports and authenticated destination pickers implemented; missing Google setup shown by backend status |
| Create article / select article | Actual save, returned ID, draft visibility and server preview passed |
| Create campaign from existing article | Live database transactional test passed with proper FK and no duplicate article; live user launch awaits eligible destinations |
| Website uniqueness / <=500 | Database constraints and both allocation suites pass |
| Five-minute scheduling | Existing live Cron active at 30-second checks; backend interval/first-wait/claim/retry gates pass; no production acceleration |
| Continue after frontend closure | Database queue architecture and unattended discovery verified; external CMS publication while closed awaits accounts/host |
| Successful real published URL | Chromium fixture public-page check passed; real external CMS URL pending |
| Expired credentials / failures / safe retries | Controlled API, browser and database suites pass |
| Google OAuth | Official PKCE/account/token/renewal/revocation and Supabase sign-in code implemented; state replay tested; real consent/refresh/revoke pending a configured Google OAuth app |
| Database privacy | Private credential/RPC grants, tenant RLS and new owner-only integration policies verified |
| Production frontend/backend | Supabase functions deployed; Pages pipeline runs the checked build; final commit and deployment evidence are recorded in this task |

## Browser deployment and remaining setup

No production browser worker is registered, no server was provided, and no browser host was provisioned. The existing Node/Playwright service, Docker/Compose isolation and enrollment UI are supplied; **container production deployment remains unverified**. [Worker setup](../browser-worker/README.md).

Required external setup:

- A server/hosting account running the separate worker continuously and a tenant worker token enrolled through Settings.
- Authorized disposable CMS websites with genuine publishing credentials and any required destination module/capability bridge.
- Google OAuth web application ID/secret, callback registration, permitted test users/scopes; Supabase Google provider configuration for Google sign-in.
- Licensed SEO data access for automatic provider ingestion. Current UI supports honest reported evidence and filters; **automated Moz/Semrush/Ahrefs synchronization is not implemented**. Unknown values do not pass provider-verified quality filters.
- Real verified publisher catalog submissions. No invented publisher listings were seeded.

These dependencies prevent declaring the entire real-world publishing system accepted. All remaining independent repairs and the testable application flows described above are implemented.

Existing Auth advisory: [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). No paid upgrade or unrelated account change was made.

## Changed code

- `src/v4.js`, `src/importer.js`, `src/v4.css`: campaign/article steps, spreadsheet import/mapping/history/report, Google account controls, metric evidence/filters and registry UI.
- `src/app.js`, `src/v2.js`, `src/v3.js`: nine-item navigation, nine real counters, saved article callback, provider setup pickers, actionable reports, permission/worker eligibility and mobile drawer preservation during polling.
- `supabase/functions/_shared/{inventory,v4-api,permission-checks,capabilities}.ts`: durable import/discovery, connector setup options, Google integration metadata, licensed evidence recording, Wix safe draft checks and destination permission validation.
- Existing API/campaign/connector/network/worker/OAuth modules: saved article versions, atomic launch RPC, request throttling, publishing scope checks, same-site redirect discovery, empty cleanup responses and background discovery.
- Two additive V4 migrations: inventory/report/metric/integration records and RLS, registry metadata, existing-queue views, atomic saved-article launch, discovery leases, OAuth state/Vault handling, Wix check records and queue permission guard.
- `drupal/guestpost_permissions`: optional authenticated Drupal 10/11 read-only capability module.
- Tests, GitHub Actions, pinned dependency/lockfile, release packaging and documentation updated; V3 evidence retained in `docs/V3-VERIFICATION.md`.
