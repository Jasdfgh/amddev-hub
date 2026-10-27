import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { pathsAndConfig, isWithin, readJson } from './common.mjs';
const mimeTypes = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.mjs':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.woff2':'font/woff2','.woff':'font/woff','.ico':'image/x-icon','.txt':'text/plain; charset=utf-8' };
const args = process.argv.slice(2);
const portFlag = args.indexOf('--port');
const port = Number(portFlag >= 0 ? args[portFlag + 1] : (process.env.PORT ?? '4180'));
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose --port between 1024 and 65535.');
const { output } = await pathsAndConfig();
await fs.access(path.join(output, 'index.html'));
const edgeConfig = await readJson(path.join(output, 'edgeone.json'));
function configuredHeaders(pathname) {
  const result = {};
  for (const rule of edgeConfig.headers ?? []) {
    const escaped = rule.source.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    if (new RegExp('^' + escaped + '$').test(pathname)) {
      for (const header of rule.headers) result[header.key] = header.value;
    }
  }
  return result;
}
const server = http.createServer(async (request, response) => {
  try {
    if (!['GET','HEAD'].includes(request.method ?? '')) { response.writeHead(405,{Allow:'GET, HEAD'}); response.end('Method not allowed'); return; }
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    const pathname = decodeURIComponent(requestUrl.pathname);
    if (pathname.includes('\0') || pathname.includes('\\')) { response.writeHead(400); response.end('Bad path'); return; }
    let file = path.resolve(output, '.' + pathname);
    if (!isWithin(output, file)) { response.writeHead(403); response.end('Forbidden'); return; }
    const relativeParts = path.relative(output,file).split(path.sep).filter(Boolean);
    let walk = output;
    for (const part of relativeParts) {
      walk = path.join(walk,part);
      if ((await fs.lstat(walk)).isSymbolicLink()) { response.writeHead(403); response.end('Symbolic links are not served'); return; }
    }
    let info = await fs.lstat(file);
    if (info.isDirectory()) { file = path.join(file,'index.html'); info = await fs.lstat(file); }
    if (!info.isFile() || info.isSymbolicLink()) { response.writeHead(404); response.end('Not found'); return; }
    const bytes = await fs.readFile(file);
    response.writeHead(200,{...configuredHeaders(requestUrl.pathname),'Content-Type':mimeTypes[path.extname(file).toLowerCase()] ?? 'application/octet-stream','Content-Length':bytes.byteLength});
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 400,{'Content-Type':'text/plain; charset=utf-8'});
    response.end(error.code === 'ENOENT' ? 'Not found' : 'Bad request');
  }
});
server.on('error',error => { console.error(error.message); process.exitCode=1; });
server.listen(port,'127.0.0.1',() => console.log(`Static preview: http://127.0.0.1:${port}/ (serving dist/, loopback only)`));
