import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectRoot, sha256, readJson, readText } from './common.mjs';

const directory = path.join(projectRoot, 'analytics');
const vendor = path.join(directory, 'shared');
const sourceFiles = ['link-map.mjs', 'collector.mjs', 'catalog-rules.json', 'extract_links.py', 'build-catalog.mjs'];
const bootstrap = `
const analytics = installCollector({ config: ANALYTICS_CONFIG, rules: ANALYTICS_RULES });
globalThis.HubAnalytics = Object.freeze({ get enabled() { return analytics.enabled; }, setEnabled: value => analytics.setEnabled(value), flush: () => analytics.flush() });
const notice = document.getElementById('analytics-privacy');
const toggle = document.getElementById('analytics-toggle');
if (notice && toggle && ANALYTICS_CONFIG.enabled && ANALYTICS_CONFIG.allowedOrigins.includes(location.origin)) {
  notice.hidden = false;
  const update = () => { toggle.textContent = analytics.enabled ? '关闭统计' : '允许统计'; if (navigator.doNotTrack === '1') { toggle.textContent = '浏览器已关闭统计'; toggle.disabled = true; } };
  toggle.addEventListener('click', () => { analytics.setEnabled(!analytics.enabled); update(); });
  update();
}
`;

export async function renderAnalyticsBundle() {
  const mapping = (await readText(path.join(vendor, 'link-map.mjs'))).replace(/^export /gm, '');
  const collector = (await readText(path.join(vendor, 'collector.mjs'))).replace(/^import .*from '\.\/link-map\.mjs';\n/m, '').replace(/^export /gm, '');
  const rules = await readJson(path.join(vendor, 'catalog-rules.json'));
  const config = await readJson(path.join(directory, 'config.json'));
  return '/* Generated from analytics/shared. Run scripts/analytics.mjs sync; do not hand-edit. */\n(() => {\n"use strict";\n'
    + mapping + '\n' + collector + '\nconst ANALYTICS_RULES = ' + JSON.stringify(rules) + ';\nconst ANALYTICS_CONFIG = ' + JSON.stringify(config) + ';\n' + bootstrap + '\n})();\n';
}

export async function reviewedAnalytics(directoryToCheck) {
  const config = await readJson(path.join(directory, 'config.json'));
  const review = await readJson(path.join(directory, 'runtime-review.json'));
  const expected = await renderAnalyticsBundle();
  if (sha256(Buffer.from(expected)) !== review.bundleSha256) throw new Error('Analytics bundle/config changed: explicit runtime review is required.');
  if (await readText(path.join(projectRoot, 'site/analytics.js')) !== expected) throw new Error('Analytics source bundle is stale; run the explicit sync step.');
  for (const filename of sourceFiles) {
    if (sha256(await fs.readFile(path.join(vendor, filename))) !== review.sources[filename]) throw new Error('Analytics reviewed source changed: ' + filename);
  }
  if (config.enabled) {
    const endpoint = new URL(config.endpoint);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/api/collect') throw new Error('Production collector must use one exact HTTPS /api/collect endpoint.');
    if (config.site !== 'hub' || config.traffic !== 'production' || config.testRunId || config.allowIntranetTestHttp || JSON.stringify(config.allowedOrigins) !== JSON.stringify(['https://hub.amddev.ai'])) throw new Error('Production analytics config cannot include preview/test origins or traffic.');
  } else if (config.endpoint) throw new Error('Disabled deployment candidate must not carry an endpoint.');
  const { catalogFromHtml } = await import('../analytics/shared/build-catalog.mjs');
  const catalog = await catalogFromHtml(path.join(directoryToCheck, 'index.html'));
  const candidates = (await fs.readdir(directoryToCheck)).filter(name => /^analytics(?:\.[a-f0-9]{12})?\.js$/.test(name));
  if (candidates.length !== 1) throw new Error('Expected exactly one reviewed analytics runtime.');
  const filename = candidates[0];
  if (sha256(await fs.readFile(path.join(directoryToCheck, filename))) !== review.bundleSha256) throw new Error('Output analytics runtime differs from reviewed bytes.');
  return { config, catalog, reviewedRuntimeScriptHashes: { [filename]: review.bundleSha256 } };
}

export function analyticsHeaders(rootConfig, config) {
  const headers = structuredClone(rootConfig.headers);
  const policy = headers.find(row => row.source === '/*')?.headers.find(row => row.key.toLowerCase() === 'content-security-policy');
  if (!policy || !/connect-src 'none'/.test(policy.value)) throw new Error('Expected existing deny-all main-page connect-src before analytics adaptation.');
  if (config.enabled) policy.value = policy.value.replace("connect-src 'none'", 'connect-src ' + config.endpoint);
  return { headers };
}

export async function verifyAnalyticsHeaders(output, config) {
  const rootConfig = await readJson(path.join(projectRoot, 'edgeone.json'));
  const actual = await readJson(path.join(output, 'edgeone.json'));
  if (JSON.stringify(actual) !== JSON.stringify(analyticsHeaders(rootConfig, config))) throw new Error('Release headers differ from the exact reviewed analytics policy.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== 'sync' || !process.argv[3]) throw new Error('Usage: node scripts/analytics.mjs sync /path/to/analytics/shared');
  const source = path.resolve(process.argv[3]);
  await fs.mkdir(vendor, { recursive: true });
  for (const filename of sourceFiles) await fs.copyFile(path.join(source, filename), path.join(vendor, filename));
  await fs.writeFile(path.join(projectRoot, 'site/analytics.js'), await renderAnalyticsBundle());
  // This command deliberately does NOT update runtime-review.json. A changed
  // source/config remains unpublishable until its exact bytes are reviewed.
  console.log('Shared analytics sources synchronized; pinned runtime review was not changed.');
}
