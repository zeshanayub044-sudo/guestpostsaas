# Verification — 17 October 2026

Scope: only the new Supabase project `aiolueflrpraiaqvdscp`, this workspace, and the owner-designated `zeshanayub044-sudo/guestpostsaas` repository. Other repositories and the prior Supabase project were not modified.

## Passed automated checks

| Suite | Result | Evidence |
|---|---:|---|
| Local domain tests | 5 / 5 | `npm test` — scheduling math, interval validation, CSV escaping/formula protection |
| Edge/security/transport tests | 8 / 8 | `npm run test:edge` — sanitization, URL/IP restrictions, approval protection, DNS pinning, chunk framing, redirect refusal, uncertain truncated responses |
| Edge type checks | Passed | `npm run check:edge` — both entrypoints with the final Deno transport |
| Live database suite | 23 / 23 | `tests/database.sql` executed on the new project; all fixtures rolled back |
| Live Auth/API suite | 20 / 20 | `tests/live-auth.mjs` against deployed API v3 and worker v2; disposable accounts removed |
| Production frontend build | Passed | Vite 6.4.4; JS 274.92 kB (77.73 kB gzip), CSS 33.17 kB (8.24 kB gzip) |
| npm dependency audit | 0 vulnerabilities | Patched DOMPurify 3.4.17, Vite 6.4.4, Supabase CLI 2.121.0 |
| Supabase security advisor | No findings | Final security advisor returned an empty lint list |

The 23 database checks cover 100 persistent jobs, the minimum two-hour span, duplicate rejection, editor restrictions, pause/resume/cancel, claimed-job exclusion, actual-completion pacing, retry backoff/Retry-After, expired-lease reconciliation, a configured one-hour recovery cooldown, manual retries, service-role Vault read/revocation, tenant isolation, denied browser RPC/role writes, and duplicate protection after cancellation of an unknown outcome.

Database completion/URL tracking was tested using rollback-only state transitions. This is not evidence of an actual WordPress publication.

The 20 live HTTP checks cover unauthenticated API/worker denial, CORS, real Supabase password login/user lookup, tenant profile reads, a successful read from the public WordPress.com API using the deployed DNS-pinned TLS transport, unsafe URL rejection, website/Vault creation, article persistence and sanitization, editorial approval, rejection of unvalidated targets, browser privilege denial, credential revocation, unused website/article deletion, and logout.

The optional HTTP harness needs `bcryptjs@3.0.3` for disposable credential hashing (`npm install --no-save --package-lock=false bcryptjs@3.0.3 --ignore-scripts`). It never prints its generated password or access token. It must only be run against the dedicated test/deployment project with an explicitly provisioned disposable fixture.

## Browser checks

- Actual login to the live backend with a disposable account.
- Real database counts and empty states on the dashboard.
- Article creation through the visual/HTML editor, persistence in the library, formatted sandboxed preview, and editorial approval.
- Approved content appears in campaign selection; websites remain ineligible until validated.
- Responsive dashboard checked at 1440 × 1000 and 390 × 844. Mobile document width stayed within the viewport; the navigation drawer opened correctly.
- All icon placeholders converted to SVG.
- Desktop and mobile QA screenshots remain local; they use a temporary disposable workspace and are not needed to build or deploy the application.

## Backend deployment and Cron

- `api` deployed and active, version 4 (invitation redirect updated for `/guestpostsaas/`; prior live HTTP suite ran against version 3).
- `publish-worker` deployed and active, version 2.
- `guestpost-publish-worker` Cron job is active on a **30-second** schedule.
- Three observed Cron runs returned `succeeded`.
- Their worker HTTP responses were **200**, `{"processed":0}`, with no timeout/error. This verifies private scheduler authentication and independent backend invocation while the queue is empty.
- Test cleanup verified **0 users, 0 tenants, 0 articles, 0 publishing jobs**. Only the internal encrypted scheduler token remains after Cron setup. No production/admin password was created or left in source.
- The performance advisor's missing tenant-invite foreign-key index was added. Unused-index informational notices on the empty database do not establish a need to remove the indexes supporting ownership and queue queries.

## GitHub Pages deployment

- Uploaded all 41 application, backend, migration, test and workflow source files to `zeshanayub044-sudo/guestpostsaas`; ignored local configuration, build outputs and optional QA screenshots were excluded.
- Pages source saved as **GitHub Actions**.
- [Deployment run 39039483081](https://github.com/zeshanayub044-sudo/guestpostsaas/actions/runs/39039483081) completed successfully for application commit `229ededfa46a30f3d3497507fc6d16c7ac628874`: clean install, tests, build, artifact upload and deployment all passed.
- Opened [the live site](https://zeshanayub044-sudo.github.io/guestpostsaas/) in a browser; the GuestPost sign-in screen rendered correctly, with no console errors.
- Saved and verified the production Supabase Site URL plus exact production and local redirect URLs. Email delivery and real WordPress publication remain unverified.

## Not yet verified / remaining setup

1. Real email confirmation/registration, password-reset delivery and team invitation delivery after configuring production SMTP. The QA login used a provisioned, confirmed disposable account.
2. An authorized WordPress staging site: publishing permission validation, draft creation, publish-by-ID, featured image upload, category/tag matching, and optional SEO metadata plugin. No site credentials were supplied, so no real post was published.
3. A real closed-browser publication and a full-length 100-website live campaign. The backend scheduling architecture and database rules are verified, but those live acceptance tests require connected authorized targets.
4. The included WordPress metadata plugin needs installation and validation on the authorized target; no third-party WordPress site was changed.

Earlier failures were corrected before the passing results above: browser-target top-level-await compatibility, icon naming, unsupported Node custom DNS lookup in the Edge runtime, and TLS socket typing. Automatic review initially rejected broad Vault grants; they were removed because Supabase already provided the required service-role permissions. The final narrowed migration and validated deployments succeeded. No approval block remains.
