# Version 5 deployment

Deploy to the existing guestpostsaas repository and dedicated aiolueflrpraiaqvdscp Supabase project. Apply migrations in filename order. The migration directory is authoritative; legacy schema.sql/hardening.sql files are historical snapshots.

Deploy api, publish-worker, oauth-callback, browser-bridge and report-share with the shared TypeScript, MJS and JSON modules and deno.json. Keep the existing function-body authentication modes in config.toml. The public report route accepts a fragment token through a no-store POST and returns only a restricted snapshot.

The frontend build now includes Team Management, Tasks & Tickets, Publishing Reports, SEO/version review and per-tenant provider settings. GitHub Actions runs Node, Edge and controlled Chromium publishing-recovery tests before Pages deployment. No raw article, credentials, local evidence, dependency folders or browser state should enter the public source stage.

See [V5 operations](docs/V5-OPERATIONS.md). A separate production browser host, authorized target CMS, Google OAuth application and licensed provider credentials are still required for external acceptance.

---

# Version 4 rollout

Apply the two V4 migrations only to the existing dedicated project, preserving all earlier migrations. Deploy api, publish-worker and oauth-callback with deno.json and all shared modules; pass the explicit relative import_map_path deno.json to avoid reusing a stale absolute map path. The V3 browser-bridge remains compatible. See [V4 operations and provider configuration](docs/V4-OPERATIONS.md) and [verification](TEST-RESULTS.md).

# Version 3 deployment

Existing resource identities remain unchanged. Apply the V3 migration only to `aiolueflrpraiaqvdscp`; deploy API, publish-worker, oauth-callback and browser-bridge with all shared files, including `.mjs`. Function bodies authenticate users, the private Cron token, one-use OAuth state or a tenant worker token respectively; gateway JWT checking is intentionally disabled in config.toml.

GitHub Actions builds and tests the static application before deploying Pages. The browser worker is separate infrastructure. Follow [its deployment guide](browser-worker/README.md); a server/provider account and permitted CMS credentials are required for live acceptance. No paid hosting or browser worker is automatically created by the Pages workflow.

The V3 migration retains existing rows and increases credential versions for browser rotations. Legacy manual-only records become Connector Setup Required. Run [transactional database tests](tests/v3_database.sql) only on the dedicated project; their fixture writes and queue clock changes roll back. See [operational rollback](docs/V3-ROLLBACK.sql).

The following provider setup remains applicable from V2.

# Deployment and operations — GuestPost Universal V2

## Dedicated resources

- Repository: https://github.com/zeshanayub044-sudo/guestpostsaas
- Frontend: https://zeshanayub044-sudo.github.io/guestpostsaas/
- Supabase project: guest posts saas, aiolueflrpraiaqvdscp, ap-south-1.
- Dashboard: https://supabase.com/dashboard/project/aiolueflrpraiaqvdscp

The original repository and isolated database are reused. Never target unrelated projects or repositories. The frontend workflow receives only the public publishable key. No service-role, CMS, Google client-secret or scheduler credential belongs in GitHub or the browser bundle.

## Frontend deployment

Pages is configured with GitHub Actions as its source. Push to main triggers the existing Pages workflow. It performs a clean install, Node tests, pinned Deno setup, Edge type checks and tests, Vite build, Pages artifact upload and deployment. Relative assets support this repository path. Verify the final Actions run and live URL after every deployment.

## Backend deployment

Tracked migrations are authoritative. universal_publishing_v2 is applied as 20261017212753. supabase/schema.sql includes the initial schema plus Version 2 changes as a reference; do not reapply it to this provisioned project. supabase/hardening.sql is a historical Version 1 reference and must not replace the current queue functions.

Deploy api, publish-worker and oauth-callback with their shared modules, catalog.json, deno.json import map and pinned lockfile. api verifies the real Auth user and current profile; publish-worker verifies the private scheduler token; oauth-callback consumes one-use PKCE state. Their gateway verify_jwt=false setting is intentional. The worker secret stays in Vault and is never exported.

Cron checks the queue every 30 seconds. The database enforces an initial interval before the first attempt, intervals of at least 300 seconds, one global worker and conservative spacing after completed or interrupted attempts. Do not replace this with browser timers or long sleeping requests.

## Auth and email

The production Site URL and exact redirect URL are configured as https://zeshanayub044-sudo.github.io/guestpostsaas/. The local redirect http://127.0.0.1:5173/ is also configured. Sessions stay in memory. Keep email confirmation enabled. Configure production SMTP in Authentication → Emails before broad onboarding; default email delivery has recipient/rate restrictions. The existing administrator was created separately and is retained. Never store its password in source or deployment notes.

## Blogger OAuth owner setup

Create an authorized Google OAuth web application with Blogger API enabled and the Blogger publishing scope. Configure its consent screen and permitted test users or production verification as applicable. Register this exact redirect URI:

https://aiolueflrpraiaqvdscp.supabase.co/functions/v1/oauth-callback

Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET as Supabase Edge Function secrets in this project. Do not enter them into public advanced connection JSON. The Connect Google action creates a short-lived PKCE request; the callback verifies access to the connected blog and stores its refresh credential only in Vault. Until these owner credentials exist, the UI reports that Google authorization setup is required. No fake Google connection is supplied.

## Provider-specific prerequisites

Read the connector matrix in README.md. WordPress needs an application password and publish_posts; Ghost needs an Admin integration key; Shopify needs an installed app and blog; Webflow needs collection/field/public URL mappings; Wix needs the owner key/site/member and supports a limited set of native rich-content blocks; Drupal needs writable JSON:API, an allowed bundle/format and its publishing workflow; Joomla needs Web Services token/category/ACL; custom sites implement docs/CUSTOM-CONNECTOR.md.

Read-only credential tests cannot universally prove every CMS create/publish permission. The UI distinguishes this from verified capability checks, and dispatch validates responses before recording a publication. Canonical settings, SEO fields, featured images and custom/headless storefront URLs depend on provider configuration. Incompatible targets are excluded from automatic allocation or rejected explicitly during manual review.

## Monitoring, recovery and backups

Review Publishing History, failed jobs, authorization-required connections, audit logs, Edge logs and Cron run history. Reconcile unknown remote outcomes before a manual retry. A draft ID or deterministic key is reused; a blind second create is never offered. Credential rotation must retain the destination binding; connections with history cannot be silently changed to another endpoint.

The OAuth state table is private and denies browser access by default. The security advisor may report this intentional no-policy state as informational. Leaked-password protection requires Pro or above according to the official password-security guide; the current Free project was not upgraded. Configure backups, retention and project availability using owner-approved plan options. A paused project cannot process scheduled jobs.

## Acceptance limits

The software and database protocol checks do not prove an external publication. Complete an authorized WordPress test plus a second CMS, email onboarding, a closed-browser publication and a sustained campaign before treating those acceptance criteria as verified. No third-party publishing credentials, Google developer credentials, SMTP credentials or paid backup approval were supplied during this upgrade.
