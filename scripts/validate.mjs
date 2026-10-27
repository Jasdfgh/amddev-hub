import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectRoot, toPosix, readText, pathsAndConfig, collectFiles, fileManifest, isWithin, fail } from './common.mjs';

function decodeEntities(value) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, match => {
    const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
    if (named[match.toLowerCase()]) return named[match.toLowerCase()];
    const hex = /^&#x/i.test(match);
    return String.fromCodePoint(parseInt(match.slice(hex ? 3 : 2, -1), hex ? 16 : 10));
  });
}
export function tags(text) {
  const result = [];
  const matcher = /<([a-zA-Z][\w:.-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
  for (const match of text.matchAll(matcher)) {
    const attrs = {};
    const attrMatcher = /([\w:.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s'"=<>`]+)))?/g;
    for (const item of match[2].matchAll(attrMatcher)) attrs[item[1].toLowerCase()] = decodeEntities(item[2] ?? item[3] ?? item[4] ?? '');
    result.push({ tag: match[1].toLowerCase(), attrs });
  }
  return result;
}
export function cssUrls(text) {
  const values = [];
  const matcher = /url\s*\(/gi;
  let match;
  while ((match = matcher.exec(text))) {
    let i = matcher.lastIndex;
    while (/\s/.test(text[i] ?? '') && i < text.length) i++;
    let quote = '';
    if (text[i] === '"' || text[i] === "'") quote = text[i++];
    let value = '';
    while (i < text.length) {
      const char = text[i++];
      if (char === '\\' && i < text.length) { value += text[i++]; continue; }
      if ((quote && char === quote) || (!quote && char === ')')) break;
      value += char;
    }
    if (quote) while (i < text.length && text[i++] !== ')') { /* advance past the closing parenthesis */ }
    values.push(value.trim());
    matcher.lastIndex = i;
  }
  for (const match of text.matchAll(/@import\s+["']([^"']+)["']/gi)) values.push(match[1]);
  return values;
}
function hrefsForGithub(text) {
  return tags(text).filter(item => item.tag === 'a' && /^https:\/\/github\.com\/AMD-DEVELOPERS\/AI-issues\//.test(item.attrs.href ?? ''))
    .map(item => item.attrs.href).sort();
}
function absoluteWebReference(value) { return /^(?:https?:)?\/\//i.test(value); }
function sameList(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

export async function validateSite(directory, { originalDirectory, requireNoExternalRuntimeResources = true, reviewedRuntimeScriptHashes = {} } = {}) {
  const root = path.resolve(directory);
  const files = await collectFiles(root);
  const htmlDocuments = new Map();
  const references = [];
  const anchors = [];
  const externalClickLinks = [];
  const externalRuntimeResources = [];
  const embeddedResources = [];
  const unresolvedRuntimeCalls = [];
  const missingResources = [];
  const badAnchors = [];
  const duplicateIds = [];
  const runtimeRef = (file, value, kind) => references.push({ file, value, kind });
  for (const file of files) {
    const extension = path.extname(file).toLowerCase();
    if (!['.html', '.css', '.js', '.svg'].includes(extension)) continue;
    const text = await readText(file);
    if (extension === '.html' || extension === '.svg') {
      const parsed = tags(text);
      const idCounts = new Map();
      for (const { tag, attrs } of parsed) {
        if (attrs.id) idCounts.set(attrs.id, (idCounts.get(attrs.id) ?? 0) + 1);
        for (const attribute of ['src', 'poster']) if (attrs[attribute]) runtimeRef(file, attrs[attribute], `${tag}[${attribute}]`);
        if (tag === 'link' && attrs.href && /(?:^|\s)(stylesheet|preload|modulepreload|icon|manifest|prefetch|preconnect|dns-prefetch)(?:\s|$)/i.test(attrs.rel ?? '')) runtimeRef(file, attrs.href, `link[rel=${attrs.rel}]`);
        if (['image', 'use'].includes(tag)) for (const attribute of ['href', 'xlink:href']) if (attrs[attribute]) runtimeRef(file, attrs[attribute], `svg:${tag}[${attribute}]`);
        if (attrs.style) for (const value of cssUrls(attrs.style)) runtimeRef(file, value, 'inline-style-url');
        for (const attribute of ['fill', 'filter', 'mask', 'clip-path']) if (attrs[attribute]) for (const value of cssUrls(attrs[attribute])) runtimeRef(file, value, `svg:${attribute}`);
        if (attrs.srcset) {
          // Current source has no srcset. Ordinary relative/web candidate lists are supported.
          if (/\bdata:/i.test(attrs.srcset)) fail('Inline data URLs in srcset require explicit review; no silent approximation is allowed.');
          for (const candidate of attrs.srcset.split(',')) runtimeRef(file, candidate.trim().split(/\s+/)[0], `${tag}[srcset]`);
        }
        if (tag === 'a' && attrs.href) {
          if (absoluteWebReference(attrs.href)) externalClickLinks.push({ file: toPosix(path.relative(root, file)), href: attrs.href });
          else if (!/^(?:mailto|tel|javascript|data|blob):/i.test(attrs.href)) anchors.push({ file, value: attrs.href });
        }
      }
      const ids = new Set(idCounts.keys());
      if (extension === '.html') htmlDocuments.set(file, ids);
      for (const [id, count] of idCounts) if (count > 1) duplicateIds.push({ file: toPosix(path.relative(root, file)), id, count });
      for (const style of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) for (const value of cssUrls(style[1])) runtimeRef(file, value, 'style-block-url');
    }
    if (extension === '.css') for (const value of cssUrls(text)) runtimeRef(file, value, 'css-url-or-import');
    if (extension === '.js') {
      for (const match of text.matchAll(/\b(?:import|export)\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["']/g)) runtimeRef(file, match[1], 'javascript-import');
      for (const match of text.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) runtimeRef(file, match[1], 'javascript-dynamic-import');
      for (const match of text.matchAll(/\b(fetch|WebSocket|EventSource|sendBeacon)\s*\(\s*(["'])(.*?)\2/g)) runtimeRef(file, match[3], `javascript-${match[1]}`);
      if (/\bXMLHttpRequest\b|\b(?:fetch|WebSocket|EventSource|sendBeacon)\s*\(/.test(text)) unresolvedRuntimeCalls.push(toPosix(path.relative(root, file)));
    }
  }
  function resolveLocal(file, value) {
    const url = new URL(value, `https://static.invalid/${toPosix(path.relative(root, file))}`);
    const decodedPath = decodeURIComponent(url.pathname);
    if (decodedPath.includes('\0') || decodedPath.includes('\\')) fail(`Unsafe resource path in ${file}`);
    const target = path.resolve(root, '.' + decodedPath);
    if (!isWithin(root, target)) fail(`Resource path escapes build output: ${value}`);
    return { target, fragment: decodeURIComponent(url.hash.slice(1)) };
  }
  async function checkLocal(reference, isAnchor = false) {
    const value = reference.value.trim();
    if (!value) return;
    if (/^(?:data|blob):/i.test(value)) { embeddedResources.push({ file: toPosix(path.relative(root, reference.file)), kind: reference.kind ?? 'link', scheme: value.split(':')[0] }); return; }
    if (absoluteWebReference(value)) {
      externalRuntimeResources.push({ file: toPosix(path.relative(root, reference.file)), kind: reference.kind, url: value });
      return;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) fail(`Unsupported resource scheme in ${reference.file}: ${value.split(':')[0]}`);
    if (value.startsWith('#') && !isAnchor) return; // SVG paint/filter identifiers are not network requests.
    const { target, fragment } = resolveLocal(reference.file, value);
    let info;
    try { info = await fs.lstat(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const resolvedTarget = info?.isDirectory() ? path.join(target, 'index.html') : target;
    try {
      const actual = await fs.lstat(resolvedTarget);
      if (!actual.isFile() || actual.isSymbolicLink()) throw new Error('not a regular file');
    } catch { missingResources.push({ from: toPosix(path.relative(root, reference.file)), reference: value, target: toPosix(path.relative(root, resolvedTarget)) }); return; }
    if (isAnchor && fragment && htmlDocuments.has(resolvedTarget) && !htmlDocuments.get(resolvedTarget).has(fragment)) badAnchors.push({ from: toPosix(path.relative(root, reference.file)), href: value });
  }
  for (const reference of references) await checkLocal(reference);
  for (const anchor of anchors) await checkLocal(anchor, true);
  const indexPath = path.join(root, 'index.html');
  const indexHtml = await readText(indexPath);
  const currentGithub = hrefsForGithub(indexHtml);
  let originalGithub = null;
  if (originalDirectory) {
    originalGithub = hrefsForGithub(await readText(path.join(originalDirectory, 'index.html')));
    if (!originalGithub.length) fail('The original snapshot has no expected GitHub template link.');
    if (!sameList(currentGithub, originalGithub)) fail('The intentional GitHub issue-template href changed from the original snapshot.');
  }
  if (missingResources.length || badAnchors.length || duplicateIds.length) fail(JSON.stringify({ missingResources, badAnchors, duplicateIds }, null, 2));
  if (requireNoExternalRuntimeResources && externalRuntimeResources.length) fail('External automatic runtime resources are present: ' + JSON.stringify(externalRuntimeResources));
  const manifest = await fileManifest(root);
  const manifestByPath = new Map(manifest.map(item => [item.path, item.sha256]));
  const unreviewedRuntimeCalls = unresolvedRuntimeCalls.filter(relative => reviewedRuntimeScriptHashes[relative] !== manifestByPath.get(relative));
  if (unreviewedRuntimeCalls.length) fail('Runtime request-capable JavaScript requires explicit review: ' + unreviewedRuntimeCalls.join(', '));
  return {
    passed: true,
    framework: 'Static HTML, CSS and vanilla browser JavaScript; no Next.js or React runtime',
    fileCount: files.length,
    checkedResourceReferenceCount: references.length,
    localAnchorLinkCount: anchors.filter(item => item.value.startsWith('#')).length,
    htmlIdCount: [...htmlDocuments.values()].reduce((total, ids) => total + ids.size, 0),
    missingResources, badAnchors, duplicateIds,
    externalRuntimeResources,
    embeddedResourceCount: embeddedResources.length,
    externalClickLinks,
    githubTemplateHrefs: currentGithub,
    githubTemplatePreserved: originalGithub ? sameList(currentGithub, originalGithub) : null,
    runtimeRequestCapableScripts: unresolvedRuntimeCalls,
    files: await fileManifest(root)
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { config, original, output } = await pathsAndConfig();
    const report = await validateSite(output, { originalDirectory: original, requireNoExternalRuntimeResources: config.requireNoExternalRuntimeResources });
    const reportPath = path.join(projectRoot, 'provenance', 'validation-report.json');
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(`Validated ${report.fileCount} static files; no missing resources or broken anchors. Intentional GitHub link preserved.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
