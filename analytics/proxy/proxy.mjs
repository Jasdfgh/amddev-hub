// Web-standard runtime only. Signing is supplied by shared/proxy-protocol.mjs.
const BODY_LIMIT = 12 * 1024;
const DASHBOARD_ROUTES = new Map([
  ['/api/session', 'GET'], ['/api/login', 'POST'], ['/api/logout', 'POST'],
  ['/api/catalog', 'GET'], ['/api/report', 'GET'], ['/api/outbound/daily', 'GET'],
]);
const RESPONSE_HEADERS = ['content-type', 'retry-after', 'vary'];
const APP_HEADERS = ['origin', 'user-agent', 'content-type', 'access-control-request-method', 'access-control-request-headers'];

function reject(status, code) {
  return new Response(JSON.stringify({ error: '请求暂时无法处理。', code }), {
    status, headers: { 'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow' },
  });
}

function originSetting(value, upstream = false) {
  if (typeof value !== 'string' || value.length > 255) throw new Error('configuration');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      url.pathname !== '/' || url.search || url.hash || url.origin !== value ||
      upstream && !/^[a-z0-9][a-z0-9.-]*\.run\.app$/.test(url.hostname)) throw new Error('configuration');
  return url;
}

async function bodyBytes(request, limit) {
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new Error('body_too_large');
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      // Edge runtimes may yield ArrayBuffer; browser/Node streams usually
      // yield Uint8Array. TypedArray.set(ArrayBuffer) silently copies no bytes.
      // Normalize before measuring/copying, and retain only the view's range.
      const value = item.value;
      const chunk = typeof value === 'string' ? new TextEncoder().encode(value) : ArrayBuffer.isView(value)
        ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        : Object.prototype.toString.call(value) === '[object ArrayBuffer]'
          ? new Uint8Array(value) : null;
      if (!chunk) { await reader.cancel(); throw new Error('invalid_body_chunk'); }
      size += chunk.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error('body_too_large'); }
      chunks.push(chunk.slice());
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

function safeCookie(value) {
  return /^hub_viewer=[^;\r\n]*;/i.test(value) && !/(?:^|;)\s*domain=/i.test(value) &&
    /(?:^|;)\s*HttpOnly(?:;|$)/i.test(value) && /(?:^|;)\s*Secure(?:;|$)/i.test(value) &&
    /(?:^|;)\s*SameSite=Strict(?:;|$)/i.test(value) && /(?:^|;)\s*Path=\/(?:;|$)/i.test(value);
}

export function createEdgeProxy({ scope, signRequest, normalizeClientIp, routePolicy, fetchImpl = globalThis.fetch }) {
  if (!['collect', 'dashboard'].includes(scope) || [signRequest, normalizeClientIp, routePolicy].some(value => typeof value !== 'function')) throw new Error('Invalid proxy factory');
  return async function onRequest(context) {
    const request = context.request;
    let publicOrigin, upstream;
    try {
      publicOrigin = originSetting(context.env?.HUB_PROXY_PUBLIC_ORIGIN);
      upstream = originSetting(context.env?.HUB_PROXY_UPSTREAM_ORIGIN, true);
    } catch { return reject(503, 'proxy_unconfigured'); }
    let url;
    try { url = new URL(request.url); } catch { return reject(400, 'invalid_request'); }
    if (url.origin !== publicOrigin.origin || url.username || url.password || url.hash) return reject(421, 'host_not_allowed');
    const route = url.pathname, method = request.method.toUpperCase();
    if (new TextEncoder().encode(route + url.search).byteLength > 4096) return reject(414, 'request_target_too_long');
    if (scope === 'collect') {
      if (route !== '/api/collect' || url.search) return reject(404, 'not_found');
      if (!['POST', 'OPTIONS'].includes(method)) return reject(405, 'method_not_allowed');
    } else {
      if (!DASHBOARD_ROUTES.has(route)) return reject(404, 'not_found');
      if (DASHBOARD_ROUTES.get(route) !== method) return reject(405, 'method_not_allowed');
      if (url.search && !['/api/report', '/api/outbound/daily'].includes(route)) return reject(400, 'unexpected_query');
    }
    const origin = request.headers.get('origin');
    if ((method === 'POST' || method === 'OPTIONS') && origin !== publicOrigin.origin || origin && origin !== publicOrigin.origin) return reject(403, 'origin_not_allowed');
    if (!request.headers.get('user-agent')) return reject(400, 'user_agent_required');
    if (request.headers.get('content-encoding') && request.headers.get('content-encoding').toLowerCase() !== 'identity') return reject(415, 'encoding_not_allowed');
    if (method === 'POST' && route !== '/api/logout' && request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return reject(415, 'json_required');
    if (method === 'OPTIONS') {
      if (request.headers.get('access-control-request-method') !== 'POST') return reject(403, 'preflight_not_allowed');
      const names = (request.headers.get('access-control-request-headers') || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
      if (names.some(name => name !== 'content-type')) return reject(403, 'preflight_not_allowed');
    }
    // Only the platform-supplied request context is accepted; never use an HTTP forwarding header.
    const clientIp = normalizeClientIp(request.eo?.clientIp);
    if (!clientIp) return reject(503, 'client_context_unavailable');
    const headers = new Headers();
    for (const name of APP_HEADERS) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    if (scope === 'dashboard' && request.headers.has('cookie')) headers.set('cookie', request.headers.get('cookie'));
    const policy = routePolicy(scope, method, route + url.search);
    if (!policy) return reject(400, 'request_not_allowed');
    let bytes;
    try { bytes = await bodyBytes(request, Math.min(policy.maxBodyBytes, BODY_LIMIT)); }
    catch { return reject(413, 'body_too_large'); }
    if (route === '/api/logout' && bytes.length) {
      if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return reject(415, 'json_required');
      try {
        const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).length) return reject(400, 'invalid_logout_body');
      } catch { return reject(400, 'invalid_logout_body'); }
    }
    try {
      const signed = await signRequest({ scope, method, target: route + url.search, body: bytes, clientIp,
        publicHost: publicOrigin.host, headers, env: context.env });
      for (const [name, value] of new Headers(signed)) headers.set(name, value);
    } catch (error) {
      return [400, 413, 415].includes(error.statusCode) ? reject(error.statusCode, 'invalid_request_context') : reject(503, 'proxy_signing_unavailable');
    }
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { 'cache-control': 'no-store', 'vary': 'Origin',
        'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST',
        'access-control-allow-headers': 'Content-Type', 'access-control-max-age': '600',
        'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow' } });
    }
    let response;
    try {
      response = await fetchImpl(upstream.origin + route + url.search, {
        method, headers, ...(method === 'POST' ? { body: bytes.buffer } : {}), redirect: 'manual',
        eo: { timeoutSetting: { connectTimeout: 5000, readTimeout: 45000, writeTimeout: 5000 } },
      });
    } catch { return reject(502, 'upstream_unavailable'); }
    if (response.status >= 500) {
      await response.body?.cancel().catch(() => {});
      return reject(response.status, 'upstream_unavailable');
    }
    if (response.status < 200 || response.status >= 300 && response.status < 400 ||
        response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      await response.body?.cancel().catch(() => {});
      return reject(502, 'upstream_invalid_response');
    }
    const outgoing = new Headers({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow' });
    for (const name of RESPONSE_HEADERS) { const value = response.headers.get(name); if (value) outgoing.set(name, value); }
    if (scope === 'collect') { outgoing.set('access-control-allow-origin', publicOrigin.origin); outgoing.set('vary', 'Origin'); }
    if (scope === 'dashboard' && ['/api/login', '/api/logout'].includes(route)) {
      const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean);
      if (cookies.length > 1 || cookies.some(value => !safeCookie(value))) return reject(502, 'upstream_invalid_cookie');
      for (const cookie of cookies) outgoing.append('set-cookie', cookie);
    }
    return new Response(response.body, { status: response.status, headers: outgoing });
  };
}
