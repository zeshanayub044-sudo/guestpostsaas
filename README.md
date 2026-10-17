# GuestPost

A vanilla JavaScript publishing workspace backed by an isolated Supabase project. Connect authorized WordPress sites, approve editorial content, and run persistent campaigns with controlled pacing.

## Deployment status

- Supabase project: **guest posts saas** — `aiolueflrpraiaqvdscp` (Mumbai).
- [Supabase dashboard](https://supabase.com/dashboard/project/aiolueflrpraiaqvdscp)
- Frontend source, backend source, and a GitHub Pages workflow are included.
- Repository: [zeshanayub044-sudo/guestpostsaas](https://github.com/zeshanayub044-sudo/guestpostsaas).
- Frontend: [GuestPost](https://zeshanayub044-sudo.github.io/guestpostsaas/). See [DEPLOYMENT.md](DEPLOYMENT.md) for Auth setup and deployment details.
- Actual test results and remaining verification are in [TEST-RESULTS.md](TEST-RESULTS.md).

## Local development

Requires Node.js 22.12+ (Node 24 recommended).

```sh
npm ci --ignore-scripts
cp .env.example .env.local
# Set the NEW project's URL and public publishable key.
npm run dev
```

The local preview runs at `http://127.0.0.1:5173`. Only a public publishable key belongs in frontend configuration. Never add service-role keys, application passwords, scheduler tokens, or Supabase access tokens to source or browser storage.

```sh
npm test
npm run check:edge
npm run test:edge
npm run build
npm run preview
```

`dist/` is the complete static GitHub Pages artifact. Routing uses fragments, so no server rewrite is needed. On Windows, use `npm.cmd` if PowerShell blocks npm's script shim. Build tools may require normal local filesystem access outside a restricted agent sandbox.

## First administrator and team access

1. Configure Auth URLs and email delivery using [DEPLOYMENT.md](DEPLOYMENT.md).
2. Open the frontend and choose **Create a workspace**.
3. Verify your email and sign in. A new, isolated tenant is created; its first user is its workspace owner (`super_admin`). This role is scoped to that workspace.
4. Use **User management** to invite admins or editors. An invite creates membership in the inviting workspace. A normal public registration creates an independent workspace.
5. Editors can write and revise articles. Only admins or explicitly permitted editors can approve content and create/control campaigns. Saving an edit resets its approval.

Sessions and refresh tokens stay in memory, so reloading the page requires signing in again. Recovery and invitation links establish an in-memory session for setting a password. Disabling a profile immediately blocks RLS and API access even while its old JWT has not expired. The workspace owner cannot be demoted or disabled from the dashboard.

## Connect a WordPress website

1. Use HTTPS and an account with `publish_posts` permission. Featured images also require media-upload permission.
2. In WordPress, open **Users → Profile → Application Passwords** and create a dedicated application password.
3. Save the site's details in **Add new website**. The default endpoint is `https://domain/wp-json/wp/v2`; subdirectory installations can use their matching endpoint. The website and API must share an origin.
4. Run **Test connection**. This checks `/users/me?context=edit` and publishing capability. Only connected, active websites appear in campaign selection.
5. Create the requested category and tags in WordPress before publishing. The connector resolves existing names and never silently invents taxonomy.

For meta titles, descriptions, and focus keywords, install the included `wordpress/guestpost-metadata.php` plugin on the authorized target website. The connector detects its registered REST metadata. Without it, article content, title, excerpt, taxonomy and featured image still publish; plugin-specific SEO fields are not automatically mapped. Avoid duplicate description tags if another SEO plugin already controls them.

Credential rotation is supported by editing a connection. Secrets are bound to the canonical API endpoint; a mismatched endpoint/secret pair is rejected. Revoking stored credentials disables the connection and deletes the Vault secret. Also revoke the application password in WordPress to invalidate it at the source. Websites with publication history are disabled rather than deleted, preserving audit records.

## Editorial and publishing workflow

Write in the visual editor or import `.txt`/`.html`, review the sanitized HTML preview, attach an image, and save a draft. An authorized reviewer approves it. Choose an approved article, filter/select websites, optionally supply website-specific versions, and review the complete campaign before starting.

Campaigns preserve an immutable approved article snapshot, including variants. Later edits cannot silently alter queued content. Images uploaded through the dashboard are public publication assets, tenant-scoped for upload and limited to PNG/JPEG/WebP under 5 MB.

The default interval is 90 seconds. For 100+ websites the database enforces:

```text
effective interval = max(requested interval, ceil(7200 / (website count - 1)))
job time = campaign start + ordinal × effective interval
```

100 targets at 90 seconds span **2h 28m 30s** before request duration and Cron latency. A global single-worker gate adds at least the applicable interval after an attempt completes. Other campaigns, website limits, failures and pauses may extend the duration. Overdue jobs never catch up in a burst. Cron checks every 30 seconds; scheduled times are earliest starts, not exact deadlines.

Pausing stops new claims. Cancellation affects unstarted jobs. An already dispatched request may finish. Known transient failures use exponential backoff with `Retry-After`; failed jobs can be manually retried. Rate limits also delay the global gate. Completion and error logs, remote URLs, attempts and campaign progress remain persistent after logout/browser closure.

## Duplicate protection and recovery

The queue uses a database singleton lock, a partial unique index allowing one processing row, fencing tokens, and a 10-minute recovery lease. The lease exceeds the hosted worker maximum lifetime; connector work is separately bounded. The same article cannot be queued again for a website while a prior job is active, published, or has a potentially successful remote attempt, even after campaign cancellation.

WordPress core does not provide a transactional cross-system idempotency key. The connector creates a draft using a deterministic per-job slug, durably stores its remote ID, then publishes that ID. Retrying a known ID updates the same post. A create request with an unknown outcome is stopped for reconciliation; it is never blindly repeated. A manual retry searches for the exact slug, including draft/private states. If nothing can be reconciled, inspect the remote posts and trash before deciding how to resolve the failed job. No automatic deletion or fresh create bypass is offered for uncertain outcomes.

## Architecture and security

```text
Static HTML/CSS/JS → Supabase Auth + RLS reads
                  → api Edge Function → validated, authorized mutations
Supabase Cron → scheduler secret in Vault → publish-worker
              → atomic claim RPC → WordPress REST → fenced completion RPC
```

Domain tables: `tenants`, `profiles`, `tenant_invites`, `settings`, `websites`, `articles`, `campaigns`, `publishing_jobs`, `publishing_logs`. Composite tenant foreign keys block cross-workspace references. Browsers have SELECT-only RLS access to their tenant and tenant-scoped image upload access. All domain writes pass authenticated Edge validation. Privileged RPCs are executable only by `service_role`; the key is supplied only by the Edge runtime.

Private tables hold credential references and worker/config state. Publishing credentials and the scheduler secret are encrypted by Supabase Vault. They never enter frontend query results. Role decisions use protected database profiles, not editable user metadata. Server-side HTML allowlisting, browser sanitization and sandboxed previews protect content rendering. CSV exports neutralize spreadsheet formulas.

The connector accepts public HTTPS domains on port 443, rejects IP literals/internal names, resolves only public IPv4 addresses, and pins TLS connections to a validated address while retaining hostname verification/SNI. Redirects are refused. This avoids the DNS-rebinding gap of checking DNS and then using an unrelated resolver. IPv6-only sites are currently unsupported. Requests and response sizes are bounded; raw remote error bodies and credentials are excluded from logs.

Both Edge Functions use `verify_jwt=false` at the gateway **because they implement authentication themselves**: `api` verifies the user's token with Auth and checks the live profile; `publish-worker` accepts only the private Cron token verified server-side. A publishable API key alone does not authorize either function.

## Operations

- Monitor failed jobs, `publishing_logs`, Edge logs and Cron execution history. Reconcile unknown outcomes before retrying.
- Keep WordPress application passwords narrow and rotate them regularly. Review team access and publishing grants.
- Configure custom SMTP, Auth rate limits and appropriate project capacity before opening registration to a wider audience.
- Use a suitable Supabase plan for production availability; a paused project cannot process Cron jobs. Configure backups and retention for your operational needs.
- Deploy backend changes deliberately after reviewing migrations. The frontend workflow never receives backend secrets and does not automatically alter the database.
- New integrations implement a connector interface next to `_shared/wordpress.ts`. Unsupported CMS types cannot be selected as if they were functioning integrations.

Only the dedicated Supabase project and the owner-designated `guestpostsaas` repository are used. Other repositories and Supabase projects were not changed.

## Reference documentation

- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)
- [Supabase Vault](https://supabase.com/docs/guides/database/vault)
- [WordPress posts API](https://developer.wordpress.org/rest-api/reference/posts/)
- [WordPress application-password authentication](https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/)
