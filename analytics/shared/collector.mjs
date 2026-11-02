import { linkFromElement, mapLink, trackableFromEvent } from './link-map.mjs';

const OPT_OUT_KEY = 'hub.analytics.optOut';
const MAX_PENDING = 64;
const DEFAULT_TIMEOUT_MS = 2000;
const MAX_TIMEOUT_MS = 60000;

function privateIPv4(hostname) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
  const parts = hostname.split('.').map(Number);
  if (parts.some(part => part > 255)) return false;
  return parts[0] === 10 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 || parts[0] === 192 && parts[1] === 168;
}

export function randomEventId(crypto) {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export function validateCollectorConfig(config, location) {
  if (!config || config.enabled !== true) return false;
  if (!['production', 'test'].includes(config.traffic)) throw new Error('Invalid analytics traffic mode');
  if (config.timeoutMs !== undefined && (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 100 || config.timeoutMs > MAX_TIMEOUT_MS)) throw new Error('Invalid analytics timeout');
  if (!Array.isArray(config.allowedOrigins) || !config.allowedOrigins.includes(location.origin)) return false;
  const endpoint = new URL(config.endpoint);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
  const intranetTest = config.traffic === 'test' && config.allowIntranetTestHttp === true
    && location.protocol === 'http:' && endpoint.protocol === 'http:'
    && privateIPv4(location.hostname) && privateIPv4(endpoint.hostname);
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash
      || endpoint.protocol !== 'https:' && !(config.traffic === 'test' && loopback && endpoint.protocol === 'http:') && !intranetTest) throw new Error('Invalid analytics endpoint');
  if (config.traffic === 'test' && !/^[a-zA-Z0-9_-]{1,64}$/.test(config.testRunId || '')) throw new Error('Test collection requires an explicit test run');
  if (config.traffic === 'production' && config.testRunId) throw new Error('Production cannot carry test-run configuration');
  if (config.traffic === 'production' && location.protocol !== 'https:') throw new Error('Production collection requires an HTTPS source');
  return true;
}

// No browser-defined visit ID or inactivity policy. The server owns Umami's
// visit boundary and visit × destination deduplication. All retries reuse IDs.
export function installCollector({ config, rules, env = globalThis, onDiagnostic = () => {} }) {
  const { document, location, navigator } = env;
  let localStorage;
  try { localStorage = env.localStorage; } catch { /* browser storage may be blocked */ }
  const now = () => env.Date?.now?.() ?? Date.now();
  const pause = ms => new Promise(resolve => env.setTimeout(resolve, ms));
  let active = false, destroyed = false, generation = 0, session = null, bootstrap = null;
  const pending = new Set(), controllers = new Set(), waiting = [];
  let initialEvent = null;
  const sessionKey = 'hub.analytics.session.' + encodeURIComponent(`${config.site || 'hub'}:${config.traffic}:${config.endpoint || ''}`);
  const bootstrapKey = sessionKey + '.bootstrap';
  const read = key => { try { return localStorage?.getItem(key); } catch { return null; } };
  const remove = key => { try { localStorage?.removeItem(key); } catch { /* unavailable storage does not affect navigation */ } };
  const write = (key, value) => { try { localStorage?.setItem(key, value); } catch { /* no storage exception may interrupt navigation */ } };
  const disabled = () => !active || destroyed || read(OPT_OUT_KEY) === '1' || navigator?.doNotTrack === '1';
  const diagnostic = code => { try { onDiagnostic({ code }); } catch { /* diagnostics are optional */ } };
  function validSession(value) {
    return value && typeof value.sessionToken === 'string' && value.sessionToken.length > 0 && value.sessionToken.length <= 8192
      && Number.isFinite(value.expiresAt) && value.expiresAt > now();
  }
  function loadSession() {
    if (validSession(session)) return session;
    session = null;
    try {
      const stored = JSON.parse(read(sessionKey));
      if (validSession(stored)) session = stored; else remove(sessionKey);
    } catch { remove(sessionKey); }
    return session;
  }
  function remember(reply) {
    const expiresAt = typeof reply.expiresAt === 'number' ? reply.expiresAt : Date.parse(reply.expiresAt);
    const candidate = { sessionToken: reply.sessionToken, expiresAt };
    if (!validSession(candidate)) return false;
    session = candidate;
    write(sessionKey, JSON.stringify(candidate));
    return true;
  }
  function makeEvent(type, data = {}) {
    const payload = { version: 1, site: config.site || 'hub', type, eventId: randomEventId(env.crypto), pagePath: location.pathname || '/', ...data };
    // This mode comes only from reviewed build configuration, never URL input.
    payload.traffic = config.traffic;
    if (config.traffic === 'test') payload.testRunId = config.testRunId;
    return payload;
  }
  function bootstrapEvent() {
    if (initialEvent) return initialEvent;
    try {
      const stored = JSON.parse(read(bootstrapKey));
      if (stored?.version === 1 && stored.type === 'pageview' && stored.site === (config.site || 'hub')
          && stored.traffic === config.traffic && stored.testRunId === (config.traffic === 'test' ? config.testRunId : undefined)
          && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stored.eventId)
          && typeof stored.pagePath === 'string' && stored.pagePath.startsWith('/') && !/[?#]/.test(stored.pagePath)) {
        initialEvent = { version: 1, site: stored.site, type: 'pageview', eventId: stored.eventId, pagePath: stored.pagePath, traffic: stored.traffic };
        if (config.traffic === 'test') initialEvent.testRunId = config.testRunId;
      }
    } catch { /* stale or invalid retry records are discarded */ }
    if (!initialEvent) initialEvent = makeEvent('pageview');
    // This is a pending delivery receipt, not a browser visit/session ID. It
    // survives a lost response so the server can return the same identity.
    write(bootstrapKey, JSON.stringify(initialEvent));
    return initialEvent;
  }
  async function transmit(payload, token = null) {
    const ownGeneration = generation;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (disabled() || ownGeneration !== generation) return null;
      const controller = new env.AbortController();
      controllers.add(controller);
      // A reviewed deployment may allow a serverless cold start. Collection is
      // still asynchronous, keepalive and bounded; native navigation never waits.
      const timer = env.setTimeout(() => controller.abort(), config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      try {
        const body = token ? { ...payload, sessionToken: token } : payload;
        const response = await env.fetch(config.endpoint, {
          method: 'POST', credentials: 'omit', mode: 'cors', redirect: 'error', referrerPolicy: 'no-referrer',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true, signal: controller.signal
        });
        // Invalid/rate-limited requests are not retried. Network/5xx errors get
        // one bounded retry with the same eventId for backend idempotence.
        if (response.ok) {
          const reply = await response.json();
          if (ownGeneration !== generation || disabled()) return null;
          if (reply?.accepted !== true) return null;
          remember(reply);
          return reply;
        }
        if (response.status === 410) {
          const reply = await response.json().catch(() => null);
          if (reply?.code === 'identity_expired') {
            session = null; initialEvent = null;
            remove(sessionKey); remove(bootstrapKey);
            diagnostic('identity_expired');
            return { identityExpired: true };
          }
        }
        if (response.status < 500) return null;
      } catch { /* finite best effort; no exception escapes the event handler */ }
      finally { env.clearTimeout(timer); controllers.delete(controller); }
      if (attempt === 0) await pause(100);
    }
    diagnostic('transport_failed');
    return null;
  }
  function trackPromise(promise) {
    pending.add(promise);
    promise.finally(() => pending.delete(promise)).catch(() => {});
    return promise;
  }
  function ensureSession() {
    if (disabled()) return Promise.resolve(null);
    if (loadSession()) return Promise.resolve(session);
    if (bootstrap) return bootstrap;
    const perform = async () => {
      if (disabled()) return null;
      let current = loadSession();
      if (current && !initialEvent) return current;
      // A definitive server expiry permits one fresh bootstrap. A temporary
      // failure retains the exact receipt/eventId and is never treated as expiry.
      for (let renewal = 0; renewal < 2; renewal++) {
        const reply = await transmit(bootstrapEvent(), current?.sessionToken);
        if (reply?.identityExpired) { current = null; continue; }
        if (reply?.accepted && loadSession()) { initialEvent = null; remove(bootstrapKey); }
        break;
      }
      return loadSession();
    };
    // Web Locks prevents simultaneous first tabs creating separate identities.
    const operation = navigator?.locks?.request
      ? navigator.locks.request(sessionKey, { mode: 'exclusive' }, perform)
      : perform();
    bootstrap = trackPromise(Promise.resolve(operation).catch(() => null).finally(() => { bootstrap = null; }));
    return bootstrap;
  }
  function submit(payload) {
    if (disabled()) return;
    if (waiting.length >= MAX_PENDING) { diagnostic('queue_full'); return; }
    waiting.push(payload);
    const ownGeneration = generation;
    trackPromise(ensureSession().then(async current => {
      const index = waiting.indexOf(payload);
      if (index !== -1) waiting.splice(index, 1);
      if (!current || disabled() || generation !== ownGeneration) return;
      const reply = await transmit(payload, current.sessionToken);
      if (reply?.identityExpired && !disabled() && generation === ownGeneration) {
        const renewed = await ensureSession();
        if (renewed && !disabled() && generation === ownGeneration) return transmit(payload, renewed.sessionToken);
      }
      return reply;
    }).catch(() => diagnostic('submit_failed')));
  }
  function beginPageview() {
    if (disabled()) return;
    if (loadSession()) { remove(bootstrapKey); submit(makeEvent('pageview')); }
    else {
      bootstrapEvent();
      trackPromise(ensureSession().catch(() => diagnostic('bootstrap_failed')));
    }
  }
  function handleEvent(event) {
    if (disabled() || event.type === 'auxclick' && event.button !== 1 || event.type === 'click' && event.button !== 0) return;
    if (config.traffic === 'production' && event.isTrusted === false) return;
    const element = trackableFromEvent(event);
    if (!element || element.disabled || element.getAttribute?.('aria-disabled') === 'true') return;
    try {
      const mapped = mapLink(linkFromElement(element), rules);
      if (!mapped) return;
      submit(makeEvent(mapped.event.type, {
        targetId: mapped.id, targetHost: mapped.host, targetCanonical: mapped.canonical, unreviewed: !mapped.reviewed
      }));
    } catch (error) {
      diagnostic(error.code || 'mapping_failed');
      if (error.code === 'unreviewed_query') submit(makeEvent('mapping_issue', {
        targetHost: error.details.host, targetCanonical: error.details.canonical, unreviewed: true
      }));
    }
    // Keyboard activation produces native click; no keydown listener and no
    // preventDefault/stopPropagation or navigation mutation are introduced.
  }
  function clearSession() {
    generation++;
    session = null; initialEvent = null;
    remove(sessionKey); remove(bootstrapKey); waiting.length = 0;
    for (const controller of controllers) controller.abort();
  }
  function storageChanged(event) {
    if (event.key === OPT_OUT_KEY && event.newValue === '1') clearSession();
    if (event.key === sessionKey) session = null;
  }
  try { active = validateCollectorConfig(config, location); } catch { diagnostic('invalid_config'); }
  if (!(env.crypto?.randomUUID || env.crypto?.getRandomValues) || !env.fetch || !env.AbortController) { active = false; diagnostic('unsupported_browser'); }
  if (active) {
    const probeKey = sessionKey + '.probe.' + randomEventId(env.crypto);
    try {
      localStorage.setItem(probeKey, '1');
      if (localStorage.getItem(probeKey) !== '1') throw new Error('Storage unavailable');
      localStorage.removeItem(probeKey);
    } catch { active = false; remove(probeKey); diagnostic('storage_unavailable'); }
  }
  document?.addEventListener('click', handleEvent, true);
  document?.addEventListener('auxclick', handleEvent, true);
  env.addEventListener?.('storage', storageChanged);
  if (read(OPT_OUT_KEY) === '1' || navigator?.doNotTrack === '1') clearSession();
  beginPageview();
  return {
    get enabled() { return !disabled(); },
    setEnabled(enabled) {
      if (enabled) { remove(OPT_OUT_KEY); beginPageview(); }
      else { write(OPT_OUT_KEY, '1'); clearSession(); }
      return !disabled();
    },
    async flush() { while (pending.size) await Promise.allSettled([...pending]); },
    destroy() {
      destroyed = true; clearSession();
      document?.removeEventListener('click', handleEvent, true);
      document?.removeEventListener('auxclick', handleEvent, true);
      env.removeEventListener?.('storage', storageChanged);
    }
  };
}
