# GuestPost Universal - Version 7

V7 imports the owner’s complete original workbook, including headerless sheets, hyperlink targets, repeated column names, physical empty rows and duplicate domains. Resumable server-parsed batches preserve each source coordinate. Originals containing account values are encrypted with AES-256-GCM before private Storage retention; encryption keys remain in Vault. Ordinary source rows contain redacted metadata only. Imported account values are never automatically connected or tested.

Automatic eligibility requires current provider-verified **Moz DA >=30, Ahrefs DR >=30 and Moz Spam Score <5%**, the configured traffic threshold, safe public reachability, editorial review, assigned access and verified create/publish permission. Missing evidence remains pending. A public CMS signal does not prove API support or account authorization.

The separate qualification worker runs bounded read-only checks with a global 16-lease ceiling and at most three attempts for temporary failures. Campaigns retain a maximum of 500 unique websites and a minimum five-minute interval. Browser publishing needs a separate permitted Node/Playwright host. Licensed providers, an authorized CMS destination and genuine publication evidence are external acceptance requirements.

See [V7 verification](docs/V7-VERIFICATION.md), [deployment](DEPLOYMENT.md) and [test results](TEST-RESULTS.md). The owner workbook and its account data are deliberately excluded from this public repository.

A vanilla JavaScript publishing workspace with platform-specific connectors, Supabase Auth, encrypted credentials and a persistent sequential publishing queue.

- [Live application](https://zeshanayub044-sudo.github.io/guestpostsaas/)
- [Repository](https://github.com/zeshanayub044-sudo/guestpostsaas)
- Dedicated Supabase project: **guest posts saas**, `aiolueflrpraiaqvdscp`, Mumbai.
- [Deployment and provider setup](DEPLOYMENT.md) · [Verified results and remaining acceptance](TEST-RESULTS.md)


## V4 repairs and bulk onboarding

Import XLSX, XLS or CSV spreadsheets with column mapping, per-row validation, domain deduplication and durable discovery reports. Select saved articles directly in New Campaign, including drafts; launch retains the existing article ID and commits editorial approval atomically. Publishing eligibility now requires verified write permission, with actionable connector configuration and an online browser worker when required. Google identity connection and licensed metric evidence stay separate from website publishing authorization.

See [V4 operations, connector readiness and exact setup requirements](docs/V4-OPERATIONS.md) and [current test evidence](TEST-RESULTS.md). A production browser host, authorized live CMS accounts, Google OAuth application and paid SEO-provider access remain external setup dependencies.

## V3 foundation (retained)

Website setup checks **native APIs → dedicated CMS connectors → permitted browser workflows**. Unrecognized sites now receive Connector Setup Required with a staged report, rather than an immediate manual-only conclusion. Existing website records, articles and publishing history are retained.

Browser publishing is a separate Node/Playwright service with tenant-scoped worker registration, encrypted task credentials, durable checkpoints, deadline fencing and public-page verification. Its code and isolated-server configuration are supplied; **a production browser host has not been provisioned**. A site is not eligible merely because a URL or password works. Browser targets need both a verified workflow and an online worker.

- [Architecture and rollout](docs/V3-ARCHITECTURE.md)
- [Browser worker deployment, supported profiles and custom manifest](browser-worker/README.md)
- [Current verification and remaining acceptance](TEST-RESULTS.md)

WordPress, Ghost, Shopify Blogs, Webflow, Blogger, Wix, Drupal, Joomla and the generic custom API contract have implemented API connectors and controlled automated tests. This does not mean every installation or account can publish. The implemented browser profiles are WordPress Classic Editor (not yet live-CMS verified) and declarative custom editorial forms (verified against a real Chromium fixture). No other browser platform support is advertised.

## Workflow

1. Add an authorized HTTPS website. GuestPost detects common platforms and guides its supported connection method.
2. Paste or import one article, optionally attach an optimized public image, and choose 1–500 publications.
3. Select automatic, manual or category-based allocation. Language and platform filters are optional.
4. Preview the article, target list, website shortage, warnings and estimated schedule. Confirm editorial review and website authorization.
5. Start the campaign. Supabase continues processing after logout or browser closure; monitor progress, errors and confirmed public URLs.

The sidebar contains Dashboard, My Websites, Import Websites, Articles, New Campaign, Running Campaigns, Publishing History, Website Discovery and Settings. Add Website is available in My Websites.

## Scheduling rules

The database enforces **at least 300 seconds between attempts**, including failures and retries. The first job is scheduled one interval after campaign confirmation. The last scheduled start for N publications is N × interval after confirmation.

| Publications | Default scheduled duration |
|---:|---:|
| 10 | 50 minutes |
| 50 | 4 hours 10 minutes |
| 100 | 8 hours 20 minutes |
| 200 | 16 hours 40 minutes |
| 300 | 25 hours |
| 500 | 41 hours 40 minutes |

Times are earliest starts, not guaranteed completion deadlines. A global fenced worker processes one job at a time and waits at least the applicable interval after an attempt finishes. Per-campaign start guards, per-site minimums, provider rate limits, other campaigns and retries can extend the duration. Overdue jobs never catch up in a burst. Cron checks every 30 seconds; no browser timer or sleeping five-minute request is used.

Pause prevents new claims; resume restores pending work; cancel removes unstarted attempts. An already dispatched request may finish. Failed jobs can be retried safely. Invalid authorization stops that connection and requests reconnection while other eligible targets can continue.

## Supported connection methods

| Platform | Required authorization and setup |
|---|---|
| WordPress | WordPress username and a dedicated Application Password; account must have `publish_posts`. The API is discovered on the website's origin. |
| Ghost | Custom Integration **Admin API key**, with the actual Ghost admin domain when it differs from the public website. Content API keys cannot publish. |
| Shopify Blogs | Installed app with content scopes, store domain and blog ID. Same-organization app client credentials are exchanged on the server; an existing authorized Admin access token is also supported. Other stores require merchant OAuth installation. |
| Webflow CMS | Site token with CMS read/write, collection ID, content-field mapping and the actual public URL pattern. Additional required fields and SEO/image mappings are optional advanced settings. |
| Blogger / Blogspot | Google OAuth using the Blogger publishing scope. Backend Google OAuth application credentials and callback registration must be configured first. Refresh tokens remain in Vault. |
| Wix | Site-owner API key with Manage Blog, site ID and author member ID. Native paragraphs, headings, links, bold/italic and simple tables are converted to Ricos. Unsupported media or formatting requires manual publishing; content is never silently discarded. |
| Drupal | Enabled JSON:API writes and HTTP Basic Authentication, a publishing account, content bundle and permitted text format. Required custom fields/relationships can be configured. |
| Joomla | Joomla Web Services and API token plugins, authorized API token and an existing article category. Site workflows must permit publication. |
| Custom website | Installed [GuestPost connector contract](docs/CUSTOM-CONNECTOR.md), bearer key and durable idempotency support. |
| Manual | Save website details and export reviewed HTML for its normal editor. Manual connections are excluded from automatic allocation and success counts. |

A normal website login password is not a universal API credential. GuestPost never bypasses CAPTCHA, MFA, consent or platform access restrictions. Where a platform cannot expose all permissions through a read-only test, the UI says that credentials were verified and publishing permission will be checked at dispatch. Every publication is counted only after its platform confirms the result.

The connectors are implemented and protocol-tested. **Live publishing on two authorized CMS sites remains an external acceptance step because no publishing-site credentials have been supplied.** Do not interpret mocked provider responses or rollback-only database fixtures as actual publications.

## Website and article management

Search, filter by platform/status, paginate website lists, edit/reconnect, disable, disconnect and inspect history. Import up to 500 website-detail CSV rows; passwords/tokens are rejected from imports and existing connections are preserved on duplicate URLs.

The visual/HTML editor, safe iframe preview, plain-text/HTML import, editorial approval, tags, metadata, optional canonical URL and featured images remain available. Campaign images are resized to a maximum dimension of 1600 and converted to WebP below 4 MB before tenant-scoped upload. Published assets are public. Canonical/SEO/image support varies by CMS and configured templates; preview reports relevant limitations.

Allocation excludes disconnected, disabled, manual, incompatible and previously scheduled/published content targets. The same content fingerprint cannot be queued again for the same website by simply creating another article record. A shortage blocks campaign creation instead of reusing websites or inventing success counts. Website-specific variants require explicit editorial review; no automatic rewriting is performed.

## Reliability and security

The queue uses a singleton lock, a unique processing-row index, `FOR UPDATE SKIP LOCKED`, fencing tokens, a ten-minute recovery lease and immutable content/target snapshots. Browser access is tenant-scoped SELECT through RLS; authenticated Edge Functions authorize mutations against the live profile. Team roles are stored in protected database profiles, not editable JWT user metadata.

CMS passwords, tokens and Google refresh credentials are encrypted in Supabase Vault. They are bound to the platform, endpoint and connection configuration, excluded from frontend records, CSV files, logs and source. OAuth state is single-use, short-lived, protected from browser roles and paired with PKCE. No service-role key is included in the frontend or Actions workflow.

The HTTP transport validates public IPv4 DNS answers, pins TLS to a validated address while preserving certificate hostname verification, refuses redirects and limits response size/time. IPv6-only publishing endpoints are currently unsupported. Only public HTTPS domains on port 443 are accepted.

Connectors create a draft, persist its remote ID, then publish that ID. An interrupted create is reconciled by a stable slug, handle, job UUID or idempotency key. An unresolved outcome requires review; it never causes a blind second create. Known IDs are reused on retries. Webflow publishes only the selected CMS item, never unrelated staged site changes.

Realtime updates have a 15-second polling fallback. Active forms and open dialogs are preserved during live refreshes. Sessions stay in memory; a full page reload requires signing in again.

## Local development and verification

Requires Node.js 22.12+ (Node 24 recommended). Dependencies and lockfiles are pinned.

```sh
npm ci --ignore-scripts
cp .env.example .env.local
# Fill the dedicated project's URL and PUBLIC publishable key.
npm run dev
npm test
npm run check:edge
npm run test:edge
npm run build
```

On Windows use `npm.cmd` if needed. The Deno npm wrapper may need its normal install/bootstrap or a separately installed Deno 2.5.6; CI uses the official Deno setup action. Run `tests/database.sql` only against the dedicated project; its fixtures and state transitions roll back.

The Pages workflow installs dependencies, runs frontend and Edge tests, builds relative static assets and deploys `dist/` to the existing GitHub Pages site. Backend deployments and migrations are deliberate separate operations. Use the tracked migration history as authoritative; never reapply an old schema snapshot to the live database.

## Operations requiring owner setup

Connect authorized CMS accounts, configure Google OAuth if using Blogger, and configure production SMTP for reliable email onboarding. Configure backups and availability appropriate to the Supabase plan. The current Free plan does not include leaked-password protection, which Supabase documents as Pro or above. No paid resource, unrelated repository or unrelated Supabase project is changed by this upgrade.

## Version 5 workspace

Publication reports and selected client shares, real Auth employee provisioning with live-session fences, assigned tasks, original/versioned article review, tenant-configured SEO generation, real publisher guideline research and evidence-based publishing preflight are implemented. Provider credentials and external publishing infrastructure must be configured for their live acceptance. See [V5 operations and limitations](docs/V5-OPERATIONS.md) and [current verification](TEST-RESULTS.md).
