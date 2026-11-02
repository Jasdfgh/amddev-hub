import { createHash } from 'node:crypto';

export const PACKAGE_JSON = JSON.stringify({ name: 'amddev-makers-entry', private: true, type: 'module' }, null, 2) + '\n';
export const DASHBOARD_PUBLIC_FILES = ['index.html', 'app.js', 'dates.js', 'style.css', 'favicon.svg'];
export const DASHBOARD_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests";
export const DASHBOARD_CONFIG = {
  headers: [{ source: '/*', headers: [
    { key: 'Cache-Control', value: 'no-store' },
    { key: 'Content-Security-Policy', value: DASHBOARD_CSP },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
    { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
    { key: 'Strict-Transport-Security', value: 'max-age=86400' },
  ] }],
};

function moduleScope(source, name) {
  if (/^\s*import\s/m.test(source) || /^\s*export\s+(?:default|\{|\*)/m.test(source)) throw new Error('Entry bundle accepts only import-free named declarations: ' + name);
  const exports = Array.from(source.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm), match => match[1]);
  if (!exports.length) throw new Error('No exports in ' + name);
  return `const ${name} = (() => {\n${source.replace(/^export\s+/gm, '')}\nreturn {${exports.join(',')}};\n})();\n`;
}

export function buildProxyBundle({ scope, protocolSource, proxySource, adapterSource }) {
  if (!['collect', 'dashboard'].includes(scope)) throw new Error('Unsupported proxy scope');
  return '// Generated Makers server function; do not edit or load in a browser.\n'
    + moduleScope(protocolSource, 'protocol') + moduleScope(proxySource, 'proxy')
    + moduleScope(adapterSource, 'adapter')
    + `const handle = proxy.createEdgeProxy({scope:${JSON.stringify(scope)}, signRequest: adapter.makeSigner(protocol), normalizeClientIp: protocol.normalizeClientIp, routePolicy: protocol.proxyRoutePolicy});\n`
    + 'export function onRequest(context) { return handle(context); }\n';
}

export function fileHash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
