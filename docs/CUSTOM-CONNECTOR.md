# Custom publishing connector contract — guestpost.v1

Install this interface on an authorized HTTPS website when its CMS has no supported connector. GuestPost refuses redirects, private/reserved IP addresses, non-443 ports and publication URLs outside the connected website. The connector base URL must share the website's origin. The server receives a bearer credential stored in Supabase Vault, never in a browser query or CSV file.

All responses are JSON. Verify the bearer credential on every request, use narrow publishing permissions and enforce your own authorization and rate limits. Return HTTP401/403 when authorization is invalid, 429 with Retry-After when limited, and appropriate 4xx validation failures. Do not return secrets in error responses.

## Required operations

`GET /capabilities`

```json
{"protocol":"guestpost.v1","account":"Editorial integration","permissions":{"publish":true},"idempotency":true}
```

Only report publishing permission when this credential can actually create and publish content.

`POST /drafts`

```json
{"idempotency_key":"stable-job-uuid","article":{"title":"Article title","content":"<p>Reviewed HTML</p>","slug":"deterministic-job-slug","meta_title":"SEO title","meta_description":"Description","canonical_url":null,"featured_image":null,"category":"Technology","tags":[]}}
```

Return `{"id":"remote-id","idempotency_key":"stable-job-uuid","status":"draft"}`. Atomically enforce one remote article per idempotency key, retain that mapping through publication and never allocate a fresh record for a repeated key. IDs must contain only letters, digits, `:`, `/`, `_`, `.`, or `-`, with a maximum length of 300. Do not publish during draft creation.

`GET /publications/by-key/{stable-job-uuid}`

Return the existing draft or published record with `id`, `idempotency_key`, `status` and its actual public `url` when published. A timed-out create is reconciled through this lookup. GuestPost will not blindly create another draft when the outcome is unknown; retain the lookup mapping for reliable recovery.

`POST /publications/{remote-id}/publish`

Body: `{"idempotency_key":"stable-job-uuid"}`. Publish the existing record and return:

```json
{"id":"remote-id","idempotency_key":"stable-job-uuid","status":"published","url":"https://your-website.com/the-actual-article"}
```

Only report published after the CMS confirms it. Repeating publication must update or return the same record. GuestPost validates the matching ID, idempotency key, status and HTTPS website origin before recording success. Support canonical, SEO and image fields only when your target actually implements them; document any limitations for the administrator.

## Manual publishing

Websites without this interface can be saved as manual connections. Download the reviewed HTML from campaign preview or use the article library. Manual connections are excluded from automatic allocation and never create synthetic success counts.
