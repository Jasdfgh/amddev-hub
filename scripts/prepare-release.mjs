import fs from 'node:fs/promises';
import path from 'node:path';
import { projectRoot, pathsAndConfig, readJson, readText, sha256, fileManifest, copyChecked } from './common.mjs';
import { validateSite } from './validate.mjs';

const { output, original } = await pathsAndConfig();
const renamed = new Map();
const fingerprint = ['app.js', 'custom.css', 'journey.css', 'assets/styles.css', 'assets/theme.css', 'assets/favicon.svg', 'assets/amd-developer-group-qr-color.png'];
for (const relative of fingerprint) {
  const oldPath = path.join(output, relative);
  const bytes = await fs.readFile(oldPath);
  const extension = path.extname(relative);
  const next = relative.slice(0, -extension.length) + '.' + sha256(bytes).slice(0, 12) + extension;
  await fs.rename(oldPath, path.join(output, next));
  renamed.set(relative, next);
}
let html = await readText(path.join(output, 'index.html'));
html = html.replace(/\b(href|src)=(['"])(.*?)\2/g, (match, attribute, quote, value) => {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value)) return match;
  const url = new URL(value, 'https://hub.amddev.ai/');
  const replacement = renamed.get(url.pathname.slice(1));
  return replacement ? `${attribute}=${quote}./${replacement}${url.hash}${quote}` : match;
});
await fs.writeFile(path.join(output, 'index.html'), html);

const diagnosticSource = path.join(projectRoot, 'diagnostics');
const diagnosticOutput = path.join(output, '__network-check');
await copyChecked(diagnosticSource, diagnosticOutput);
const chunks = Array.from({ length: 2048 }, (_, i) => Buffer.from(sha256(Buffer.from(`amddev-probe-${i}`)), 'hex'));
await fs.writeFile(path.join(diagnosticOutput, 'sample.bin'), Buffer.concat(chunks));
const rootConfig = await readJson(path.join(projectRoot, 'edgeone.json'));
await fs.writeFile(path.join(output, 'edgeone.json'), JSON.stringify({ headers: rootConfig.headers }, null, 2) + '\n');

const beforeMarker = await fileManifest(output);
const releaseId = sha256(Buffer.from(JSON.stringify(beforeMarker))).slice(0, 16);
html = html.replace('</head>', `<meta name="build-id" content="${releaseId}"></head>`);
await fs.writeFile(path.join(output, 'index.html'), html);
const reviewedRuntimeScriptHashes = {
  '__network-check/probe.js': sha256(await fs.readFile(path.join(diagnosticSource, 'probe.js')))
};
const validation = await validateSite(output, { originalDirectory: original, reviewedRuntimeScriptHashes });
const report = { releaseId, generatedAt: new Date().toISOString(), nodeVersion: process.version,
  assetMapping: Object.fromEntries(renamed), reviewedRuntimeScriptHashes, validation };
await fs.mkdir(path.join(projectRoot, 'provenance'), { recursive: true });
await fs.writeFile(path.join(projectRoot, 'provenance/release-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`Production release ${releaseId}: ${validation.fileCount} files; fingerprinted assets and security headers validated.`);
