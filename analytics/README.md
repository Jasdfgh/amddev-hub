# Hub analytics integration candidate

Collection is disabled in `config.json`; the endpoint is intentionally empty. This candidate does not change the live Hub or provision a collector.

`shared/` is a generated, byte-identical vendor copy of the analytics implementation's shared directory. Keep one mapping source: edit the upstream shared module, then run `node scripts/analytics.mjs sync /path/to/analytics/shared`. This regenerates `site/analytics.js`, but deliberately does not update the reviewed runtime hashes.

The build verifies the shared-source hashes and generated bundle against `runtime-review.json`, checks all current exits using the same mapper, and retains the general ban on unreviewed network-capable scripts. Unknown business query parameters or conflicting target IDs stop the build. The collector's only network call uses its reviewed configuration; it has no third-party script dependency.

Root integration must select the final collector endpoint, confirm its ingestion contract and CORS behavior, update configuration, regenerate the bundle, review/pin the exact new hashes, and run the ordinary build/release checks. The enabled release policy permits only the exact HTTPS `/api/collect` endpoint through `connect-src`; the remaining CSP directives and diagnostic-path policy are retained. Production collection accepts only the exact `https://hub.amddev.ai` origin. Preview/test configuration is not a permitted production release configuration.

The footer notice and opt-out are visible when collection is enabled for the current origin. The opaque anonymous token is retained only to the server-issued expiry. Do Not Track and explicit opt-out stop collection; opt-out clears the token and pending bootstrap receipt. A collector outage never cancels or delays navigation.

Rollback consists of restoring the previously accepted Hub bundle/config and its strict CSP, or deploying a freshly reviewed disabled configuration. Do not publish a source-only change without rebuilding its content fingerprints and reviewing its runtime hash.
