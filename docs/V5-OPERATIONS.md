# Version 5 operations

The existing GitHub Pages app and dedicated Supabase project remain the production resources. Apply all migrations in order. The browser publishing service remains separate infrastructure.

## Employee access

The workspace owner can create an Admin, SEO Manager, Editor, Publishing Operator or Viewer. The original Super Admin is protected. Invitations use Supabase Auth email; temporary-password creation uses the Auth Admin API. Both require the employee to establish a private password before business-data access. Temporary passwords are never stored in application tables or returned after creation.

Authorization comes from trusted profile, role and individual-permission records, never user-editable metadata. Editors see their own or assigned articles and tasks. Operators and viewers see their own or assigned campaigns/reports. Administrators can manage their permitted workspace records. API, REST RLS and Storage enforce live sessions, active accounts and first-login restrictions. Suspension, reactivation and access changes fence old sessions; a new sign-in is required. Sessions in Auth remain private behind narrow server checks.

Use Team Management to invite or provision employees, update roles, review granular overrides, suspend/reactivate, request recovery mail and inspect activity. No message is sent merely by opening a form. A specifically approved disposable Editor passed real enrollment, required password change, suspension/reactivation and retained-session checks, and was left disabled. Invitation and recovery email delivery still require configured SMTP and an authorized recipient.

## Content and SEO

Original content remains unchanged. Saving edits creates a version and clears publication approval. An owner-configured OpenAI key and exact enabled model are required for AI generation. The Responses API uses strict structured output and store:false. Generated links/images must already exist in the supplied source; invented external references fail validation. Provider failure never substitutes a fabricated AI result.

Review the original, proposed content and metadata in Articles. Accepting a proposal creates an unapproved draft. Approval applies to the exact current version. Campaign snapshots preserve reviewed content. A smoke launch also requires the unchanged version and target captured by preflight, and is transactionally protected against repeated launch.

An assistant-prepared proposal is labeled separately from an OpenAI API generation. No paid model request is implied by this label. Financial articles retain educational framing and require editorial fact review.

## Publishing reports and client links

A report and durable result rows are created with each campaign. CMS confirmation is separate from unauthenticated public verification. Checks require an exact article URL, durable remote identifier, matching title/content and intended backlinks. Homepages, login pages and wrong content do not qualify. The scheduled worker performs public verification and records actual HTTP, canonical, robots and link-rel observations. These observations are not a promise of indexing or ranking.

Publishing Reports exports XLSX, CSV and PDF and copies verified URLs. XLSX includes filters and exact clickable links; CSV neutralizes spreadsheet formulas. Only selected, publicly verified rows may enter a client snapshot. Employee names are optional and require team-read permission. Share tokens are generated with 256 bits of randomness, stored as SHA-256 hashes, carried in a browser fragment, and submitted by POST. Snapshots expose only allowlisted public results. Optional expiry and revocation are checked on each public fetch. As with any download, revocation cannot recall a copy already obtained by a recipient.

The report-share function intentionally accepts public token-bearing POST requests and performs its own authorization. API, scheduler, bridge and callback functions likewise validate their own session, private scheduler token, worker enrollment or one-use OAuth state. Keep verify_jwt=false for these existing body-authenticated routes.

## Publisher research and providers

Publisher Discovery holds editorial prospects separately from authenticated websites. Five real official guideline sources were recorded. Editorial acceptance, commercial terms, contribution restrictions and publishing permission remain separate. Pioneers Post explicitly rejects AI-written submissions; do not send generated prose there.

Default quality requirements are Ahrefs DR >=30, Moz Spam Score <=5%, and estimated monthly organic traffic >=1,000. DA is not DR. Unavailable, negative, unlicensed or stale observations remain Unknown and cannot qualify. DR/traffic use licensed Ahrefs API results; Spam Score/DA use licensed Moz API results with attribution. Brave Search is optional public-guideline discovery, not an outreach or publishing service. Provider keys remain tenant-scoped in Vault; an environment fallback is allowed only for the explicitly matching INTEGRATION_TENANT_ID. Do not pool or redistribute licensed metrics across workspaces.

## Real smoke tests

Run preflight from Articles or Publishing Reports. It saves timestamped checks without external publishing. Missing approval, credential, verified destination, required browser worker or scheduler readiness blocks launch. A ready run still requires a separate explicit publication approval to its displayed target. Exactly one publication is scheduled with the normal minimum 300-second interval. A run passes only after durable remote publication and public content/backlink verification. Evidence exports include every check, expected/observed result, error, required action, log reference and check time.

## Deployment and acceptance limits

The static frontend does not host the Node/Playwright worker. A compatible server and authorized CMS account are required for browser publishing. Google OAuth needs a registered application and actual user consent. Paid OpenAI, Ahrefs, Moz and Brave calls require the workspace’s configured credentials and applicable licenses. No external publication, licensed score, OAuth consent or production browser-worker deployment is claimed without that evidence.

Security advisors currently retain the pre-existing disabled leaked-password-protection warning and informational no-policy notice on private.oauth_requests. The latter remains deny-by-default. See https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection for the Auth option.
