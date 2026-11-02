import path from 'node:path';
import fs from 'node:fs/promises';
import { projectRoot, pathsAndConfig, sha256 } from './common.mjs';
import { validateSite } from './validate.mjs';
import { reviewedAnalytics, verifyAnalyticsHeaders } from './analytics.mjs';
import { reviewedMakers } from './makers.mjs';

const { output, original } = await pathsAndConfig();
const analytics = await reviewedAnalytics(output);
const makers = await reviewedMakers(output);
await verifyAnalyticsHeaders(output, analytics.config);
const result = await validateSite(output, {
  originalDirectory: original,
  ...makers,
  reviewedRuntimeScriptHashes: {
    ...analytics.reviewedRuntimeScriptHashes,
    '__network-check/probe.js': sha256(await fs.readFile(path.join(projectRoot, 'diagnostics/probe.js')))
  }
});
console.log(`Validated release: ${result.fileCount} files; all local resources and anchors resolve; GitHub entry preserved.`);
