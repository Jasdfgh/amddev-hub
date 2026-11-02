import fs from 'node:fs/promises';
import path from 'node:path';
import { projectRoot, readJson, readText, sha256, fileManifest } from './common.mjs';
import { buildProxyBundle, PACKAGE_JSON } from '../analytics/proxy/bundle.mjs';

const sourceRoot = path.join(projectRoot, 'analytics/proxy');
const sourceFiles = ['proxy-protocol.mjs', 'proxy.mjs', 'signing-adapter.mjs', 'bundle.mjs'];
const functionPath = 'edge-functions/api/collect.js';

export async function renderMakersFunction() {
  return buildProxyBundle({ scope: 'collect',
    protocolSource: await readText(path.join(sourceRoot, 'proxy-protocol.mjs')),
    proxySource: await readText(path.join(sourceRoot, 'proxy.mjs')),
    adapterSource: await readText(path.join(sourceRoot, 'signing-adapter.mjs')),
  });
}

export async function reviewedMakers(output, { stage = false } = {}) {
  const config = await readJson(path.join(projectRoot, 'build.config.json'));
  if (JSON.stringify(config.serverInclude) !== JSON.stringify([functionPath, 'package.json'])) throw new Error('Makers upload allowlist changed; review the exact function routes.');
  const review = await readJson(path.join(projectRoot, 'analytics/proxy-review.json'));
  for (const filename of sourceFiles) {
    if (sha256(await fs.readFile(path.join(sourceRoot, filename))) !== review.sources[filename]) throw new Error('Proxy source needs review: ' + filename);
  }
  const bundle = await renderMakersFunction(), bundleHash = sha256(Buffer.from(bundle));
  if (bundleHash !== review.bundleSha256) throw new Error('Generated Makers proxy needs explicit review.');
  if (stage) {
    await fs.mkdir(path.join(output, 'edge-functions/api'), { recursive: true });
    await fs.writeFile(path.join(output, functionPath), bundle);
    await fs.writeFile(path.join(output, 'package.json'), PACKAGE_JSON);
  }
  const functions = await fileManifest(path.join(output, 'edge-functions'));
  if (functions.length !== 1 || functions[0].path !== 'api/collect.js' || functions[0].sha256 !== bundleHash) throw new Error('Unexpected Makers function routes or bytes.');
  if (await readText(path.join(output, 'package.json')) !== PACKAGE_JSON) throw new Error('Makers package manifest must contain no scripts, dependencies or runtime configuration.');
  return { reviewedServerScriptHashes: { [functionPath]: bundleHash } };
}
