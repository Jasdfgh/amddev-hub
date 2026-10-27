import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const toPosix = value => value.split(path.sep).join('/');
export const sha256 = data => createHash('sha256').update(data).digest('hex');
export const readText = async file => (await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '');
export const readJson = async file => JSON.parse(await readText(file));
export function fail(message) { throw new Error(message); }
export function isWithin(parent, target) {
  const relative = path.relative(parent, target);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
export function assertWithin(parent, target, label = 'path') {
  if (!isWithin(parent, target)) fail(`${label} escapes its permitted directory: ${target}`);
}
export function safeRelative(value, label) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.includes('\\') || value.split('/').some(part => part === '..' || part === '.' || !part)) {
    fail(`Unsafe ${label}: ${String(value)}`);
  }
  return value;
}
export async function assertNoSymlinkTree(target) {
  let info;
  try { info = await fs.lstat(target); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (info.isSymbolicLink()) fail(`Symbolic links and junctions are not accepted: ${target}`);
  if (info.isDirectory()) {
    for (const item of await fs.readdir(target)) await assertNoSymlinkTree(path.join(target, item));
  } else if (!info.isFile()) fail(`Only normal files and directories are accepted: ${target}`);
}
export async function pathsAndConfig() {
  const rootStat = await fs.lstat(projectRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('The project root must be a real directory, not a symbolic link.');
  const config = await readJson(path.join(projectRoot, 'build.config.json'));
  // A deliberately strict target prevents accidental recursive removal elsewhere.
  if (config.inputDirectory !== 'site' || config.originalDirectory !== 'original' || config.outputDirectory !== 'dist') {
    fail('This migration build only permits site/, original/, and dist/ in the project root.');
  }
  if (!Array.isArray(config.include) || !config.include.includes('index.html')) fail('The include list must contain index.html.');
  for (const item of config.include) safeRelative(item, 'include entry');
  const source = path.join(projectRoot, 'site');
  const original = path.join(projectRoot, 'original');
  const output = path.join(projectRoot, 'dist');
  const expectedOutput = path.resolve(projectRoot, 'dist');
  if (path.resolve(output) !== expectedOutput || !isWithin(projectRoot, output) || output === projectRoot) fail('Refusing unsafe output directory.');
  return { config, source, original, output };
}
export function prohibitedName(name) {
  return /^(?:node_modules|\.git|\.next|\.cache|cache|\.pnpm-store|\.npmrc|credentials\.json|id_rsa|id_ed25519)$/i.test(name)
    || /^\.env(?:\.|$)/i.test(name) || /\.(?:pem|key|p12|pfx)$/i.test(name);
}
export async function collectFiles(root) {
  await assertNoSymlinkTree(root);
  const files = [];
  async function visit(current) {
    for (const item of (await fs.readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const full = path.join(current, item.name);
      if (prohibitedName(item.name)) fail(`Excluded or potentially sensitive file in source tree: ${toPosix(path.relative(root, full))}`);
      if (item.isDirectory()) await visit(full);
      else if (item.isFile()) files.push(full);
      else fail(`Unsupported directory entry: ${full}`);
    }
  }
  await visit(root);
  return files;
}
export async function fileManifest(root) {
  const entries = [];
  for (const file of await collectFiles(root)) {
    const bytes = await fs.readFile(file);
    entries.push({ path: toPosix(path.relative(root, file)), bytes: bytes.byteLength, sha256: sha256(bytes) });
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}
export async function copyChecked(source, target) {
  const info = await fs.lstat(source);
  if (info.isSymbolicLink()) fail(`Refusing to copy a symbolic link: ${source}`);
  if (prohibitedName(path.basename(source))) fail(`Refusing excluded source entry: ${source}`);
  if (info.isDirectory()) {
    await fs.mkdir(target, { recursive: true });
    for (const item of await fs.readdir(source)) await copyChecked(path.join(source, item), path.join(target, item));
  } else if (info.isFile()) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
  } else fail(`Refusing unsupported source entry: ${source}`);
}
