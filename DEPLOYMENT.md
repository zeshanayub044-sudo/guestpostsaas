# Deployment and handoff

## Existing isolated backend

Project: **guest posts saas**  
Reference: `aiolueflrpraiaqvdscp`  
URL: `https://aiolueflrpraiaqvdscp.supabase.co`  
Region: `ap-south-1`

Use its [Supabase dashboard](https://supabase.com/dashboard/project/aiolueflrpraiaqvdscp). Do not apply these files to any previous project. `supabase/config.toml` contains local CLI configuration; always explicitly target the above reference for remote operations.

The frontend workflow contains the public publishable key. It is designed to be public; RLS and authenticated Edge validation enforce access. No privileged key is needed in GitHub Actions for frontend deployment.

## GitHub Pages

Repository: [zeshanayub044-sudo/guestpostsaas](https://github.com/zeshanayub044-sudo/guestpostsaas).
Frontend URL: [GuestPost](https://zeshanayub044-sudo.github.io/guestpostsaas/).

The owner created this new repository and designated it for the application. Pages uses **GitHub Actions** as its source. Pushes to `main` run **Deploy GuestPost to GitHub Pages**; the workflow can also be started manually from Actions. Check the latest successful run before assuming a new commit is live.

The workflow runs `npm ci --ignore-scripts`, local tests, the static build, and the official Pages artifact/deployment actions. GitHub Pages serves only `dist/`; credentials and background processing remain in Supabase.

## Auth configuration required before real onboarding

Open **Authentication → URL Configuration** in this new project.

- Site URL: `https://zeshanayub044-sudo.github.io/guestpostsaas/`
- Allowed redirect URLs: that exact URL, `http://127.0.0.1:5173/`, and any explicitly used development preview URL.
- Configure custom SMTP for production email confirmation, password recovery and team invitations. Supabase's default email service has recipient/rate restrictions.
- Keep email confirmation enabled. Disable anonymous sign-in unless intentionally implementing its separate authorization model.

The available connector cannot update Auth URL/email settings. These settings must be completed in the dashboard. No existing Auth system was modified.

## Backend deployment from a clean checkout

The current backend was provisioned through the authorized Supabase connector. The tracked migration files contain the exact applied SQL and match the remote migration versions. Their local files were created with the CLI and aligned to the recorded deployment history. `supabase/schema.sql` is a final-state reference snapshot. Check remote history before applying anything; do not reapply the snapshot to the provisioned database.

For a future separate NEW project:

1. Create that new isolated project explicitly.
2. Update the project reference/URL, public key, API CORS origin, invite redirect URL, Settings display and scheduler URL for that deployment.
3. Review/apply the initial schema, image storage, queue hardening and tenant-invite index migrations.
4. Deploy `api` and `publish-worker` with their shared files and `deno.json` import map. Both authenticate in their bodies.
5. Apply `supabase/scheduler.sql` only after the worker is deployed. It generates an internal random Vault secret entirely in Postgres and schedules `private.tick()` every 30 seconds. Do not copy the secret into source or frontend config.
6. Configure Auth URLs/SMTP, run the rollback-only database suite, and complete an authorized WordPress staging test.

## Final acceptance still needed

- Successful GitHub repository upload, Pages configuration, Actions run and live URL verification.
- Real administrator email confirmation, password recovery and invitation delivery after Auth configuration.
- An authorized WordPress staging site's credentials entered through the dashboard, connection validation and a real publication, including featured images/taxonomy/optional SEO plugin.
- A closed-browser publication and an observed full-length 100-site campaign. Database pacing rules are tested independently; a short test is not evidence of a two-hour live campaign.

These are explicit remaining checks, not simulated successes.
