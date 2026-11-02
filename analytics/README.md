# Hub analytics integration

`config.json` controls whether this Hub release collects visits and outbound clicks. The production endpoint is the same-origin `https://hub.amddev.ai/api/collect`; a disabled release must have `enabled:false` and an empty endpoint. Configuration and source files alone do not prove deployment: check the built release, actual Makers deployment and the separate production acceptance record. This repository does not provision the database or dashboard.

The browser calls only the Hub's Tencent function. That function signs and forwards the allowed request to the Cloud Run gateway; Umami and Neon stay behind it. The separate `https://stats.amddev.ai` password viewer has two read-only pages: overview with trends/TOP3, and searchable daily outbound detail. Database credentials, admin tokens and proxy signing keys are never included in browser assets or this repository.

Input counts accepted native Umami visits. Output counts the first effective click per visit and destination; refreshes and repeated clicks do not simply add to the totals. The mapping covers Hub exits, not activity inside destination websites. Trial/demo use a separate website ID and keys; production must reject test traffic and report its actual collection start rather than invent historical zeros.

`shared/` is a generated, byte-identical vendor copy of the analytics implementation's shared directory. Keep one mapping source: edit the upstream shared module, then run `node scripts/analytics.mjs sync /path/to/analytics/shared`. This regenerates `site/analytics.js`, but deliberately does not update the reviewed runtime hashes.

The build verifies the shared-source hashes and generated bundle against `runtime-review.json`, checks all current exits using the same mapper, and retains the general ban on unreviewed network-capable scripts. Unknown business query parameters or conflicting target IDs stop the build. The collector's only network call uses its reviewed configuration; it has no third-party script dependency.

When changing collection configuration or shared code, regenerate the bundle, review/pin the exact new hashes, and run the ordinary build/release checks. The enabled release policy permits only the exact HTTPS `/api/collect` endpoint through `connect-src`; the remaining CSP directives and diagnostic-path policy are retained. Production collection accepts only the exact `https://hub.amddev.ai` origin. Preview/test configuration is not a permitted production release configuration.

The footer notice and opt-out are visible when collection is enabled for the current origin. The opaque anonymous token is retained only to the server-issued expiry. Do Not Track and explicit opt-out stop collection; opt-out clears the token and pending bootstrap receipt. A collector outage never cancels or delays navigation. The collector has a bounded 60-second request budget to allow backend cold starts; it does not make navigation wait for that budget. Blocking or lost requests can undercount, and bot filtering is not proof of human identity.

Rollback consists of restoring the previously accepted Hub bundle/config and its strict CSP, or deploying a freshly reviewed disabled configuration. Do not publish a source-only change without rebuilding its content fingerprints and reviewing its runtime hash.

## Makers proxy and release checks

The release now includes a separately reviewed server-only `edge-functions/api/collect.js`. It uses the same `shared/proxy-protocol.mjs` WebCrypto protocol as the Node gateway, with a fixed runtime Cloud Run origin and platform-supplied client IP. `analytics/proxy/` is a byte-identical vendor copy of the canonical analytics `infra/tencent` runtime modules and shared protocol; its hashes and generated function hash are pinned in `proxy-review.json`.

`build.config.json` has an explicit server upload allowlist. `prepare-release` stages only that function and a minimal package manifest. Supported `edgeone.json` redirects, rewrites and headers are retained; the API has an explicit no-store override. Server functions are checked separately from browser network-capable scripts, so the browser review policy remains intact.

No runtime proxy key/upstream is present in the release. Configure the exact production environment in Makers with `HUB_PROXY_PUBLIC_ORIGIN`, `HUB_PROXY_UPSTREAM_ORIGIN`, `HUB_PROXY_KEY_ID` and `HUB_PROXY_KEY`; use an independent collect-scoped key matching the gateway, not the dashboard key. Keep values out of command history, source, build output and logs. Environment changes require a new deployment.

After building, run `node --test tests/makers.test.mjs` and `npm run validate`. Actual cloud configuration, function compilation, API non-caching, login/read-only behavior, real click ingestion, cold-start behavior and target-network access require separate runtime acceptance. A page returning HTTP 200 or a local fixture passing is not proof of that complete chain. Preserve stable IDs when updating article titles so history remains associated with the same destination.
