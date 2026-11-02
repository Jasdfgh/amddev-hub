import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { projectRoot, readJson, readText } from '../scripts/common.mjs';
import { analyticsHeaders } from '../scripts/analytics.mjs';
import { reviewedMakers } from '../scripts/makers.mjs';

test('direct upload preserves supported routes and exact CSP/no-store policies', async () => {
  const root = await readJson(path.join(projectRoot, 'edgeone.json'));
  root.redirects = [{ source: '/old', destination: '/new', statusCode: 301 }];
  root.rewrites = [{ source: '/alias', destination: '/index.html' }];
  const originalRoot = structuredClone(root);
  const config = await readJson(path.join(projectRoot, 'analytics/config.json'));
  // Exercise rollback and production explicitly, regardless of the checked-in
  // deployment mode. A release may legitimately switch between these states.
  const disabledConfig = { ...config, enabled: false, endpoint: '' };
  const enabledConfig = { ...config, enabled: true, endpoint: 'https://hub.amddev.ai/api/collect' };
  const actual = analyticsHeaders(root, disabledConfig);
  assert.deepEqual(actual.redirects, root.redirects); assert.deepEqual(actual.rewrites, root.rewrites);
  assert.equal(actual.buildCommand, undefined);
  assert.equal(config.timeoutMs, 60000);
  const policy = actual.headers.find(row => row.source === '/*').headers.find(row => row.key === 'Content-Security-Policy').value;
  assert.equal(policy.split(';').map(value => value.trim()).find(value => value.startsWith('connect-src ')), "connect-src 'none'");
  assert.deepEqual(actual.headers, root.headers);
  const enabled = analyticsHeaders(root, enabledConfig);
  const enabledPolicy = enabled.headers.find(row => row.source === '/*').headers.find(row => row.key === 'Content-Security-Policy').value;
  assert.equal(enabledPolicy, policy.replace("connect-src 'none'", 'connect-src https://hub.amddev.ai/api/collect'));
  assert.equal(enabledPolicy.split(';').map(value => value.trim()).find(value => value.startsWith('connect-src ')), 'connect-src https://hub.amddev.ai/api/collect');
  for (const output of [actual, enabled]) {
    assert.deepEqual(output.redirects, root.redirects); assert.deepEqual(output.rewrites, root.rewrites);
    assert.equal(output.buildCommand, undefined);
    assert.equal(output.headers.find(row => row.source === '/api/collect').headers.find(row => row.key === 'Cache-Control').value, 'no-store');
    assert.deepEqual(output.headers.filter(row => row.source !== '/*'), root.headers.filter(row => row.source !== '/*'));
  }
  assert.deepEqual(root, originalRoot, 'Rendering either mode must not mutate the deny-all source policy');
  assert.throws(() => analyticsHeaders({ ...root, caches: [] }, config), /Unsupported EdgeOne field/);
  assert.throws(() => analyticsHeaders(enabled, disabledConfig), /Expected existing deny-all/, 'An already-open policy cannot become a trusted baseline');
  assert.throws(() => analyticsHeaders({ ...root, headers: root.headers.filter(row => row.source !== '/api/collect') }, enabledConfig), /explicit no-store/);
});

test('release includes exactly the pinned server route and a configuration-free manifest', async () => {
  const result = await reviewedMakers(path.join(projectRoot, 'dist'));
  assert.deepEqual(Object.keys(result.reviewedServerScriptHashes), ['edge-functions/api/collect.js']);
  const packageJson = await readJson(path.join(projectRoot, 'dist/package.json'));
  assert.deepEqual(packageJson, { name: 'amddev-makers-entry', private: true, type: 'module' });
  const source = await readText(path.join(projectRoot, 'dist/edge-functions/api/collect.js'));
  assert.match(source, /export function onRequest\(context\)/);
  assert.equal(/^\s*import\s/m.test(source), false);
});

test('release validation rejects a missing route, extra function, modified server code or package payload', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'amddev-makers-review-'));
  try {
    const src = path.join(projectRoot, 'dist');
    for (const mutation of ['missing', 'extra', 'modified', 'manifest']) {
      const target = path.join(temp, mutation);
      await fs.cp(src, target, { recursive: true });
      if (mutation === 'missing') await fs.rm(path.join(target, 'edge-functions/api/collect.js'));
      if (mutation === 'extra') await fs.writeFile(path.join(target, 'edge-functions/api/admin.js'), 'export function onRequest() {}');
      if (mutation === 'modified') await fs.appendFile(path.join(target, 'edge-functions/api/collect.js'), '\n// unreviewed change');
      if (mutation === 'manifest') await fs.writeFile(path.join(target, 'package.json'), '{"scripts":{"build":"unexpected"}}');
      await assert.rejects(reviewedMakers(target), /Unexpected Makers|manifest/);
    }
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});
