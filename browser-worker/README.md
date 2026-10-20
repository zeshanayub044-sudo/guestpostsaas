# GuestPost browser worker — V3

This is a separate, persistent Node 24 / Playwright service. It is **not** a GitHub Pages process or a persistent Supabase Edge browser. No production worker host has been provisioned in this release.

## Deploy on an isolated Linux server

1. Use a dedicated Linux VM/container host that permits Chromium's user-namespace sandbox and a custom seccomp profile. Do not disable Chromium's sandbox to work around an incompatible host. The supplied profile is the unmodified official Playwright v1.64.0 `utils/docker/seccomp_profile.json`.
2. Clone the existing repository. In the app, open Settings → Manage browser workers → Register worker. Copy its one-time token directly to the host's secret manager. It is stored only as a SHA-256 hash in the database; lost tokens must be revoked and replaced.
3. Inject `BROWSER_GATEWAY_URL=https://aiolueflrpraiaqvdscp.supabase.co/functions/v1/browser-bridge` and `BROWSER_WORKER_TOKEN` into the container environment through that secret manager. Do not commit them, print them in logs, put them in shell arguments, or save an `.env` in the repository.
4. From `browser-worker/`, run `docker compose up --build -d`. The Dockerfile builds from the repository root. No public worker port is needed: it makes authenticated outbound polls only. The Compose configuration uses a non-root user, Chromium sandbox, dropped capabilities, read-only root, temporary browser storage, process/memory limits, and automatic restart. Validate these controls on the chosen host before enabling real websites.
5. Confirm the worker appears Online in Settings. Connect a dedicated authorized CMS account and explicitly permit its browser workflow. Wait for its check to pass before creating a campaign.
6. Publish one approved test article to an authorized disposable site. Verify the unauthenticated public URL. Then stop the dashboard and check that the server continues polling and completes the next due job. Real destination tests are required before claiming platform compatibility.

Running `npm ci --ignore-scripts`, `npx playwright install chromium`, and `npm start` is also supported on a properly isolated server with a protected process manager. Docker is the supplied deployment configuration; no paid service is automatically provisioned.

## Implemented browser profiles

| Profile | Scope | Verification so far |
|---|---|---|
| `wordpress-classic-v1` | Ordinary WordPress login + the Classic Editor's HTML/Text mode, title, body, slug, draft save, publish, permalink | Implemented; **not tested against a real WordPress installation**. Gutenberg-only, SSO and customized editors need another verified profile. |
| `custom-editor-v1` | Declarative same-origin HTML editorial forms using the manifest below | Real Chromium fixture passed; **not a certification of arbitrary custom websites**. |

These profiles support safe HTML and backlinks. They deliberately reject images, taxonomy fields and SEO/canonical fields without an implemented mapping, so a campaign cannot silently discard them. Existing API connectors retain their own richer capabilities.

A browser connection check opens an editor and verifies its editable fields and enabled publishing action, without submitting article content. WordPress can create an empty auto-draft when opening Add New. This is disclosed in the consent step. Every job rechecks its publishing action and must verify a genuine unauthenticated public resource before being marked Published.

## Custom editor manifest

The website owner installs `/.well-known/guestpost-browser.json` on the authorized destination. It is configuration, never executable code. Publishing automation must be allowed by the destination and the administrator must explicitly authorize the account.

```json
{
  "protocol": "guestpost.browser.v1",
  "id": "custom-editor-v1",
  "automation_permitted": true,
  "paths": {
    "login": "/editor/login",
    "editor": "/editor/new",
    "search": "/editor/articles?search={marker}",
    "edit": "/editor/articles/{id}"
  },
  "selectors": {
    "username": "#username",
    "password": "#password",
    "login_submit": "#sign-in",
    "authenticated": "#editor-navigation",
    "title": "#article-title",
    "content": "#article-html",
    "slug": "#article-slug",
    "save_draft": "#save-draft",
    "remote_id": "input[name=article_id]",
    "publish": "#publish",
    "published": "[data-status=published]",
    "public_link": "a[data-public-url]",
    "search_result": "a.article-edit-link"
  }
}
```

All paths remain on the connected HTTPS origin. Fields are ordinary editable inputs/textarea; the ID is an input with a stable alphanumeric value. Save/publish actions must complete ordinary navigation and expose the saved record. Each selector must resolve uniquely. Search must return exact titles containing the full `GPJOB-<job UUID>` marker, including recoverable drafts; zero or multiple matches after an uncertain create stops for reconciliation. SPAs, rich editors, extra review dialogs and external SSO need a dedicated versioned adapter, not guessed clicks.

## Reliability and security

- API and browser attempts use the same database claim, singleton lock, campaign start gate and lease. Browser polls atomically claim a task; a lost poll response never creates a second attempt. Expired claims become failures requiring reconciliation if remote effects were possible.
- The gateway authenticates a separately registered, tenant-scoped worker on every operation. It returns only that task's bound credentials. It never exposes a service-role key or unrestricted credential RPC to the runner.
- Credential rotation reserves a monotonically increasing connection version. Old connection checks and browser checkpoints cannot validate newer credentials. Revoking the worker or website blocks subsequent task operations.
- A checkpoint precedes draft creation; the durable remote ID is saved before publishing. A lost create outcome searches the marker. A known remote ID always reopens that record. Unknown outcomes never cause a blind create.
- Jobs have a hard browser deadline of two minutes (gateway maximum three minutes), shorter than their database lease. Contexts are ephemeral and closed before completion. No cookies, persistent profiles, traces or session-state files are saved.
- A local CONNECT proxy validates all DNS results and pins a public IPv4 connection. Chromium validates TLS end-to-end. Cross-origin navigation/subresources, private/reserved addresses, downloads, service workers and insecure protocols are blocked. There is no stealth, fingerprint spoofing, CAPTCHA solver or MFA bypass.
- CAPTCHA, MFA, permission failures, expired sessions, changed layouts and failed public verification return distinct safe error codes. Authentication challenges require the normal human/provider flow and a reconnection; there is no challenge handoff/session import feature in this release.
- Optional `DIAGNOSTICS_DIR` screenshots mask the entire page body, because arbitrary CMS DOM may contain credentials or article data. They show viewport/failure context only; task phase and safe error code are the useful diagnostic. Screenshots are local, private and not uploaded. No raw CMS exception messages or HTML are logged.
- Supabase Cron runs a connection monitor; expired checks fail accurately, and connected browser workflows are rechecked after 24 hours. Offline workers exclude browser connections from new campaign allocation. API publishing continues.

## Tests

```text
npm ci --ignore-scripts
npm test
npx playwright install chromium --only-shell
npm run test:e2e
```

The fixture suite runs real Chromium against a disposable local editorial server. Its local HTTP target is used only by the test harness; production entrypoint validation/proxy has no localhost or insecure-transport override. The fixture does not demonstrate a production browser host, real CMS credentials or provider permission to automate.
