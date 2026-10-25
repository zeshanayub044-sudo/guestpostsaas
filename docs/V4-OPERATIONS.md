# GuestPost V4 — repair and operations

Date: 25 October 2026 (Asia/Karachi).

## Existing resources

- Repository: https://github.com/zeshanayub044-sudo/guestpostsaas
- Static frontend: https://zeshanayub044-sudo.github.io/guestpostsaas/
- Dedicated Supabase project: **guest posts saas**, `aiolueflrpraiaqvdscp` (Mumbai).
- Application API: `https://aiolueflrpraiaqvdscp.supabase.co/functions/v1/api`.
- Worker gateway: `https://aiolueflrpraiaqvdscp.supabase.co/functions/v1/browser-bridge`.

No duplicate project, repository or native Sites hosting was created. Unrelated projects are outside this rollout.

## Root causes and changes

1. The saved article existed in the correct tenant and was approved. New Campaign hid the saved-article selector in an advanced SEO disclosure and copied its contents into an inline article payload, discarding its ID. V4 puts the selector first, retrieves all tenant-visible statuses, displays title/date/status/image, and sends `article_id`. Creating an article from this screen selects the returned database ID. Editing resets editorial approval. Launch locks the selected row and checks the reviewed `updated_at`; approval and campaign allocation commit or roll back together. The existing composite article foreign key remains authoritative.
2. CSV import was an inventory-only upsert with no durable batch, per-row report or discovery. V4 parses XLSX/XLS/CSV using pinned official SheetJS 0.20.3, supports header aliases/manual mapping and worksheets, refuses credential columns, validates HTTPS URLs, and deduplicates by normalized hostname including www aliases. The server validates again, serializes inventory allocation per tenant and records each row, including invalid/duplicate records. Upload request IDs prevent duplicate retries. Imports do not grant publishing permission.
3. Read access was treated as sufficient for campaigns even when connectors returned only `credential_verified`. V4 requires `permission_status=verified` in UI eligibility, server allocation and atomic queue claiming. Public Drupal reads cannot validate a password. Permission checks distinguish native account authentication, publish scope, account/category access and browser-worker availability. An unrecognized CMS is not automatically WordPress or prohibited automation.
4. Browser publishing code existed, but **no worker host is registered or online**. V4 does not change that fact into a success message. Deploy the separate service using [the worker guide](../browser-worker/README.md).

## Inventory and discovery

Use **Import Websites → Choose spreadsheet → review mapping → Import websites & start discovery**. The recommended columns are Website URL, Account Email, CMS, Category, Language and Country. Account email is a label, never permission. Do not include passwords, tokens, session cookies or API secrets.

`import_batches` and `import_rows` retain durable processing state. The existing authenticated Cron worker claims one discovery row per invocation using SKIP LOCKED, a two-minute lease and a three-attempt limit. It checks common public signatures and endpoints through DNS-pinned HTTPS. Each callback is fenced by lease token. Existing authenticated credentials are not overwritten by discovery. At the current 30-second Cron interval, 500 rows need at least about 250 minutes of discovery; failures/latency can add time. Increase throughput only after assessing Edge runtime limits, rate limits and fairness.

Use the report to refresh discovery status, download CSV, open connection setup or retry eligible failures. The live upload test uses explicitly disposable records; its domains are not verified publishers or publishing targets. An imported CMS hint is retained for diagnostics, not trusted over actual detection.

## Connector readiness matrix

Every native connector below is implemented. Controlled tests cover representative protocols and failures; **none is certified against an authorized live destination in this V4 run**.

| Platform | Interface / authentication | Publishing permission preflight | Remaining destination setup |
|---|---|---|---|
| WordPress | REST v2; dedicated application password (5.6+) | Authenticated user has edit_posts and publish_posts | HTTPS REST access, account rights; image/taxonomy rights when needed |
| Blogger | API v3; Google OAuth + refresh token | Exact blogger write scope plus author access to matching blog | Google OAuth web app, Blogger API enabled and per-site consent |
| Shopify Blogs | Admin GraphQL 2026-10; installed app token or same-organization client credentials | Content write scope, matching store domain and selected blog | Installed app; blog picker finds up to 100 blogs |
| Webflow | Data API v2; API token | CMS read/write scope, matching site domain and collection membership | sites:read, site/collection, required field mapping and public URL template |
| Ghost | v5-compatible Admin API; signed Admin credential | Authenticated posts read plus same-site capability bridge for create/publish | Staff roles can restrict publication; read success alone is insufficient |
| Wix | Blog v3; owner API key and author member ID | Explicit unpublished draft create/delete verifies Manage Blog and author | User approves the draft check; remote ID and cleanup state are durable |
| Drupal | Core JSON:API + Basic Auth; included Drupal 10/11 module | Authenticated bridge checks bundle create/status-field/format access, JSON:API writes and direct publication | Install `drupal/guestpost_permissions`, enable writes; moderated bundles need their own transition connector |
| Joomla | Web Services v1; API token | Authenticated API plus administrator-supplied category permission bridge | core.login.api, core.create, edit/own-edit and core.edit.state for chosen category |
| Custom | guestpost.v1 bearer contract | Explicit create/publish capability and idempotency contract | Install the site's supported API implementation; no arbitrary URL/password promise |
| Browser | WordPress Classic Editor or permitted declarative custom editor | Worker validates supported workflow, credential generation and publishing action | Always-on worker host, destination permission and matching selectors |

Shopify, Webflow and Joomla offer authenticated configuration pickers. OAuth/API credentials go to the server over HTTPS and never enter spreadsheet files or browser persistence. A missing API does not justify sending API credentials to a login form. Browser fallback needs an explicit separate account credential and consent.

### Capability bridge contract

For Ghost or Joomla, the destination administrator may expose an authenticated, same-origin endpoint and enter its URL in connection settings. It must validate the supplied credential through its CMS, never trust caller-supplied roles, and return:

```json
{"protocol":"guestpost.permissions.v1","platform":"joomla","authenticated":true,"account_id":"42","category_id":"2","permissions":{"create":true,"publish":true}}
```

For Ghost use `platform:ghost`; for Drupal the included module also returns the exact bundle and text_format. Joomla must evaluate category ACL and workflow state; a template that simply returns true is not a permission bridge. The application rejects mismatched platform/category/type, unauthenticated responses and missing write permissions. Bridge implementation and deployment on Ghost/Joomla are destination-admin dependencies; no untested installable plugin is advertised.

Wix check failures retain the marker and any returned remote ID. A repeated check reconciles that exact draft before cleanup; it never blindly creates another draft after an uncertain response. Cleanup errors stay pending and block eligibility. A verified proof is tied to the credential generation; cached rechecks expire after 24 hours. No live Wix draft probe has been executed in this run.

## Google identity and publishing

Two independent flows are implemented:

- **Sign in with Google** uses the project's Supabase Auth provider. The owner must enable Google in Supabase Auth and register `https://aiolueflrpraiaqvdscp.supabase.co/auth/v1/callback` in the Google OAuth web app. Normal email sign-in still works when this is absent.
- **Settings → Connect Google account** uses server-side authorization code + PKCE, ten-minute hashed one-use state, verified Google userinfo and Vault-protected refresh/access tokens. Its scopes are only openid/email/profile. Status, expiration, renewal and provider revocation are exposed. Configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET as Edge secrets and register `https://aiolueflrpraiaqvdscp.supabase.co/functions/v1/oauth-callback`.

Blogger publishing separately asks for `https://www.googleapis.com/auth/blogger` and checks the scope actually granted. It cannot be inferred from a connected identity. No Gmail feature or Gmail scope is requested. A Google identity does not authenticate unrelated website accounts or verify their publishing permissions. Third-party Google SSO browser login requires a supported destination-specific flow and is not offered as universal automation.

The Google application credentials have not been supplied. OAuth success, token refresh/revocation and the live consent screen therefore remain unverified. Missing configuration is displayed explicitly. This task did not create OAuth credentials, accept provider terms, upgrade a plan or charge for hosting.

## Quality metrics and publisher research

Settings provides DA >=30, Spam Score <=9%, estimated organic visits >=1,000, category, country and language defaults. Metrics retain provider, observed date, report URL and verification state. Moz DA and Ahrefs DR remain distinct. The manual report form records **reported**, not provider-verified, values. Automatic quality filters require provider-verified evidence less than 90 days old and exclude unknown data.

No licensed Moz/Semrush/Ahrefs account or key is connected; automatic provider synchronization is **not implemented or claimed to work** in this rollout. Connect a licensed provider and implement its account-specific ingestion before enabling automated quality qualification. The publisher catalog is an honest empty state, with no invented listings, traffic or permissions. The administrator can import their own authorized inventory independently.

## Data, security and operations

- Existing articles, websites, credentials and publication history remain in their original tables. Existing `campaign_targets` is retained. V4 `website_connections` and `publishing_results` are security-invoker views over existing records; they do not duplicate the queue. `private.website_credentials` stays private and Vault-backed.
- New import, metric, integration and permission-check records have explicit tenant/owner RLS and read-only browser grants. Privileged functions are service-role-only. Google token references are private. No service-role key or user password belongs in GitHub.
- API calls authenticate the real Supabase user and active profile and enforce a database-backed 120-request/minute/account limit. Errors include code, component, retry hint, timestamp and diagnostic reference, without destination response bodies or stored credentials.
- The queue still uses one global processing lease, immutable payload fingerprints, deterministic job markers, one target per campaign/domain, a 500-site limit and at least 300 seconds between attempts. A revoked/unverified publishing permission also blocks subsequent claims. No production interval is accelerated for tests.
- Browser automation runs only in the separate supplied Node/Playwright service. Supported title/HTML/links are verified on the public page without logged-in cookies. Unsupported mappings are rejected. No CAPTCHA/MFA/security bypass or stealth implementation exists.
- The V3 Docker sandbox setup is supplied but has not been run on a production Linux host. No production browser worker was registered by V4.

Use migrations in order, not `schema.sql` over an existing project. The schema file is a cumulative reference for a fresh database. Run both transactional database suites only on this dedicated project. They roll back all fixtures and clock adjustments. Real CMS publication with the frontend closed, Google consent and production browser deployment need the missing external services/accounts.

The existing leaked-password-protection advisory remains: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection . No plan change was made.
