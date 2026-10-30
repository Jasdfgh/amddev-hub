import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { buildCatalog } from './link-map.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export async function catalogFromHtml(htmlFile, rulesFile = path.join(here, 'catalog-rules.json')) {
  const rules = JSON.parse(await fs.readFile(rulesFile, 'utf8'));
  // Raw hrefs are kept in this pipe and never written to reports or console.
  const links = JSON.parse(execFileSync('python3', [path.join(here, 'extract_links.py'), htmlFile], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }));
  const catalog = buildCatalog(links, rules);
  catalog.source = { htmlSha256: createHash('sha256').update(await fs.readFile(htmlFile)).digest('hex'), rulesSha256: createHash('sha256').update(await fs.readFile(rulesFile)).digest('hex') };
  return catalog;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node build-catalog.mjs /path/to/site/index.html [output.json]');
  const catalog = await catalogFromHtml(path.resolve(process.argv[2]));
  const body = JSON.stringify(catalog, null, 2) + '\n';
  if (process.argv[3]) await fs.writeFile(process.argv[3], body); else process.stdout.write(body);
}
