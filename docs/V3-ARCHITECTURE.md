# V3 connection and execution architecture

The existing repository and Supabase project are retained. Two previously saved website records were preserved. No production article/campaign/history records were removed, and no new Supabase project or unrelated repository is used.

## Discovery and classification

`connections.ts` checks public HTTPS reachability, known CMS signals, WordPress's native namespace when applicable, the generic `guestpost.v1` API endpoint and the optional `guestpost.browser.v1` editorial manifest. It keeps platform-specific authentication and configuration in existing connectors. A missing WordPress API no longer immediately means manual publishing.

The administrator sees API Connected, Browser Connected, Authorization Required, Connector Setup Required, Connection Failed or Unsupported. Stored legacy status values remain compatible. An unidentified or unconfigured site is **Connector Setup Required**, not an assertion that no permitted method could ever exist. A browser connection is checked asynchronously; accepting a password alone never marks it connected.

## Execution

```text
GitHub Pages dashboard → authenticated Edge API → PostgreSQL durable campaign/jobs
                                                    ↓
                                   atomic claim + ≥300 second campaign gate
                                      ↙                         ↘
                         Cron / API publisher             tenant browser worker
                         native CMS connector             outbound authenticated poll
                                      ↘                         ↙
                                 durable ID / verification / fenced completion
```

The conservative global processing limit remains from V2. Other campaigns and completion spacing may delay starts beyond the per-campaign minimum. This release does not increase global publication throughput. All selected targets remain unique (`UNIQUE(campaign_id,website_id)`); the database rejects quantities outside 1–500, duplicate target arrays, ineligible connections and intervals below 300 seconds.

An immutable per-job payload fingerprint closes V2's editable-article duplicate gap. Previous remote effects remain protected after cancellation and retries. Existing stricter cross-campaign duplicate rules remain; repeated content on a previously used destination is not newly enabled.

## Credential and authorization boundaries

CMS credentials remain in Supabase Vault with references only in `private.website_credentials`. Clients cannot read the secret table or call secret/worker mutation functions. New worker keys are hashed in a separate private table. Worker health and connection-check reports are tenant-scoped RLS metadata.

The gateway validates worker identity, tenant, current task, lease and connection binding for checkpoints/completion. Worker registration is admin-only; tokens are returned once for server provisioning, never stored in frontend local/session storage. The runner has no unrestricted database client. Safe error codes are mapped to fixed administrator messages.

Browser jobs carry frozen connection configuration/version. A rotation fences old checks and remote actions; an already submitted external request cannot be undone. Revocation stops later operations, and uncertain outcomes require inspection/reconciliation. Completion callbacks are acknowledged idempotently for their same completed lease.

## Verification boundary

API connectors require their implemented CMS response/status/ID/URL checks; response metadata records `connector_type=api` and `verification=cms_response_verified`. Browser profiles require the saved remote ID, published editor state and an unauthenticated public page containing the article title, body and backlink text/URLs. Preview/admin URLs cannot satisfy browser verification.

No arbitrary website can be guaranteed to accept a normal password or a generic UI script. Native OAuth/token requirements remain. Browser profiles must be implemented and tested for their editorial interface, allowed by the platform and explicitly authorized by the administrator.

## Reversible rollout

The migration is additive and retains all historical records/constraints. Its source filename matches the applied migration history. Existing API credentials retain their original connection-binding format.

For an operational rollback, revoke/stop browser workers, disable browser connections and restore the prior Pages release plus API source. Keep the additive V3 schema and immutable duplicate ledger; API `claim_next_job()` defaults to API mode. Do not drop V3 tables/columns after they contain real history. A destructive structural downgrade would require a separately reviewed data migration. See `V3-ROLLBACK.sql` for a feature-disable procedure that preserves data.
