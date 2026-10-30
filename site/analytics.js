/* Generated from analytics/shared. Run scripts/analytics.mjs sync; do not hand-edit. */
(() => {
"use strict";
// V1 evolution of dashboard-prototype/link-map.mjs. This is the sole mapping
// implementation used by catalog generation and the browser collector.
// Navigation URLs are never rewritten; query values never leave this module.
class MappingError extends Error {
  constructor(code, details = {}) { super(code); this.name = 'MappingError'; this.code = code; this.details = details; }
}

function canonicalTarget(href, { origin, download = false } = {}) {
  if (!href || /^\s*(?:#|javascript:|data:|blob:)/i.test(href)) return null;
  let url, base;
  try { base = new URL(origin); url = new URL(href, base); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
  const local = url.origin === base.origin;
  const query = [...url.searchParams];
  let route = '';
  if (/^#!?\//.test(url.hash)) {
    const raw = url.hash.replace(/^#!/, '#').slice(1);
    const split = raw.indexOf('?');
    route = '#' + (split === -1 ? raw : raw.slice(0, split));
    if (split !== -1) query.push(...new URLSearchParams(raw.slice(split + 1)));
  }
  if (download && local && /\/amd-developer-group-qr-color(?:\.[a-f0-9]{8,64})?\.png$/i.test(url.pathname)) {
    return { key: 'download:community-qr', host: base.host, path: '/assets/amd-developer-group-qr-color.png', kind: 'download', query, strippedQuery: !!url.search };
  }
  if (local && !download) return null;
  const pathname = url.pathname === '/' ? '/' : url.pathname.replace(/\/+$/, '');
  const clean = url.origin + pathname + route;
  return { key: (download ? 'download:' : '') + clean, host: url.host, path: pathname + route, kind: download ? 'download' : 'external', query, strippedQuery: !!url.search || /\?/.test(url.hash) };
}

function stableId(key) {
  let hash = 14695981039346656037n;
  for (const byte of new TextEncoder().encode(key)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 1099511628211n);
  return 'link_' + hash.toString(16).padStart(16, '0');
}

function inferredCategory(target) {
  const host = target.host.replace(/^www\./, ''), p = target.path;
  if (host === 'bilibili.com') return { category: /^\/video\//.test(p) ? 'bilibili_video' : 'community', channel: 'B站' };
  if (host === 'b23.tv') return { category: 'other', channel: 'B站' };
  if (host === 'zhuanlan.zhihu.com') return { category: 'zhihu_article', channel: '知乎' };
  if (host === 'zhihu.com') return { category: /^\/(question|answer|p)\//.test(p) ? 'zhihu_article' : 'community', channel: '知乎' };
  if (['xiaohongshu.com', 'rednote.com'].includes(host)) return { category: /^\/(discovery\/item|explore)\//.test(p) ? 'xiaohongshu_content' : 'community', channel: '小红书' };
  return { category: 'other', channel: target.host };
}

const validId = value => /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value);
const queryKey = value => /^[a-zA-Z0-9_.-]{1,64}$/.test(value) ? value : '[unrecognized]';
const categoriesOf = rules => rules.categories || rules.groups;
const ruleKey = (value, rules) => value.startsWith('download:') ? value : canonicalTarget(value, { origin: rules.origin })?.key;

function mapLink(link, rules) {
  if (link.attrs?.['data-track-ignore'] === 'true') return null;
  const target = canonicalTarget(link.href, { origin: rules.origin, download: link.download });
  if (!target) return null;
  const match = rules.targets.find(row => [row[4], ...(row[5] || [])].some(value => ruleKey(value, rules) === target.key));
  const explicitId = link.attrs?.['data-track-id'];
  if (explicitId && !validId(explicitId)) throw new MappingError('invalid_explicit_id');
  const explicitRule = explicitId && rules.targets.find(row => row[0] === explicitId);
  if (explicitRule && explicitRule !== match) throw new MappingError('conflicting_explicit_id', { targetId: explicitId });
  const policy = rules.queryPolicies?.[explicitId || match?.[0]] || {};
  const ignoredKeys = new Set([...(rules.trackingQueryKeys || []), ...(policy.ignore || [])]);
  const ambiguous = target.query.filter(([key, value]) => !ignoredKeys.has(key) && !policy.values?.[key]?.includes(value));
  // An explicit ID is a curator assertion of identity. Otherwise an unknown
  // business query must be reviewed, never hashed into an accidental visitor ID.
  if (ambiguous.length && !explicitId) throw new MappingError('unreviewed_query', {
    canonical: target.key, host: target.host, queryKeys: [...new Set(ambiguous.map(([key]) => queryKey(key)))]
  });
  const inferred = inferredCategory(target);
  const explicitCategory = link.attrs?.['data-track-category'];
  if (explicitCategory && !categoriesOf(rules)[explicitCategory]) throw new MappingError('invalid_category');
  const id = explicitId || match?.[0] || stableId(target.key);
  const explicitTopics = (link.attrs?.['data-track-topics'] || '').split(',').map(value => value.trim()).filter(Boolean);
  if (explicitTopics.some(topic => !rules.topics?.[topic])) throw new MappingError('unknown_topic');
  return {
    id, name: link.attrs?.['data-track-label'] || match?.[1] || link.label || ('待命名 · ' + target.host),
    category: explicitCategory || match?.[2] || inferred.category, channel: match?.[3] || inferred.channel,
    topics: [...new Set(explicitTopics.length ? explicitTopics : match?.[6] || [])],
    canonical: match ? ruleKey(match[4], rules) : target.key, host: target.host, kind: target.kind,
    reviewed: !!(match || (explicitId && link.attrs?.['data-track-label'])), strippedQuery: target.strippedQuery,
    placement: link.attrs?.['data-track-placement'] || link.placement || '未标注位置',
    role: link.attrs?.['data-track-role'] || link.role || '',
    event: { type: target.kind === 'download' ? 'download_click' : 'outbound_click', targetId: id, targetHost: target.host }
  };
}

function validateRules(rules) {
  const ids = new Set(), aliases = new Map();
  for (const row of rules.targets) {
    if (!validId(row[0]) || ids.has(row[0])) throw new MappingError('duplicate_or_invalid_rule_id');
    ids.add(row[0]);
    if (!categoriesOf(rules)[row[2]]) throw new MappingError('invalid_rule_category', { targetId: row[0] });
    if ((row[6] || []).some(topic => !rules.topics?.[topic])) throw new MappingError('unknown_rule_topic', { targetId: row[0] });
    for (const value of [row[4], ...(row[5] || [])]) {
      const key = ruleKey(value, rules);
      if (!key || aliases.has(key) && aliases.get(key) !== row[0]) throw new MappingError('conflicting_alias', { targetId: row[0] });
      aliases.set(key, row[0]);
    }
  }
  return true;
}

function buildCatalog(links, rules) {
  validateRules(rules);
  const targets = new Map();
  let outgoing = 0, external = 0, downloads = 0, stripped = 0;
  for (const link of links) {
    const mapped = mapLink(link, rules);
    if (!mapped) continue;
    outgoing++;
    if (mapped.kind === 'download') downloads++; else external++;
    if (mapped.strippedQuery) stripped++;
    if (targets.has(mapped.id) && targets.get(mapped.id).canonical !== mapped.canonical) throw new MappingError('conflicting_target_id', { targetId: mapped.id });
    if (!targets.has(mapped.id)) targets.set(mapped.id, { ...mapped, occurrences: [] });
    targets.get(mapped.id).occurrences.push({ placement: mapped.placement, role: mapped.role });
  }
  return {
    version: rules.version, origin: rules.origin,
    counts: { anchors: links.length, outgoing, external, downloads, ignored: links.length - outgoing, targets: targets.size, queryStripped: stripped },
    targets: [...targets.values()].map(({ placement, role, strippedQuery, event, ...rest }) => rest),
    categories: Object.entries(categoriesOf(rules)).map(([id, name]) => ({ id, name })),
    topics: Object.entries(rules.topics || {}).map(([id, name]) => ({ id, name })), provenance: rules.provenance
  };
}

function trackableFromEvent(event) {
  return event.composedPath?.().find(node => (node?.tagName === 'A' && node.hasAttribute?.('href'))
    || (node?.tagName === 'BUTTON' && node.hasAttribute?.('data-track-href')))
    || event.target?.closest?.('a[href], button[data-track-href]') || null;
}

function linkFromElement(anchor) {
  const attrs = {};
  for (const key of ['data-track-id', 'data-track-label', 'data-track-category', 'data-track-topics', 'data-track-role', 'data-track-placement', 'data-track-ignore']) {
    if (anchor.hasAttribute(key)) attrs[key] = anchor.getAttribute(key);
  }
  return { href: anchor.getAttribute('href') || anchor.getAttribute('data-track-href'), download: anchor.hasAttribute('download'), attrs,
    label: anchor.getAttribute('aria-label') || anchor.getAttribute('title') || anchor.querySelector('h3,h2')?.textContent.trim() || anchor.textContent.trim(),
    placement: anchor.closest('[data-track-placement]')?.getAttribute('data-track-placement') || '未标注位置' };
}


const OPT_OUT_KEY = 'hub.analytics.optOut';
const MAX_PENDING = 64;

function privateIPv4(hostname) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
  const parts = hostname.split('.').map(Number);
  if (parts.some(part => part > 255)) return false;
  return parts[0] === 10 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 || parts[0] === 192 && parts[1] === 168;
}

function randomEventId(crypto) {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

function validateCollectorConfig(config, location) {
  if (!config || config.enabled !== true) return false;
  if (!['production', 'test'].includes(config.traffic)) throw new Error('Invalid analytics traffic mode');
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
function installCollector({ config, rules, env = globalThis, onDiagnostic = () => {} }) {
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
      const timer = env.setTimeout(() => controller.abort(), Math.max(100, Math.min(config.timeoutMs || 2000, 5000)));
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

const ANALYTICS_RULES = {"origin":"https://hub.amddev.ai/","targets":[["token_factory","Token Factory","platform","AMD","https://developer.amd.com.cn/radeon/tokenfactory",[],["getting_started","model_inference"]],["radeon_cloud","Radeon Cloud","platform","AMD","https://developer.amd.com.cn/radeon/",[],["getting_started","model_inference"]],["radeon_docs","RC 文档","platform","AMD","https://amd-aim.github.io/radeon-cloud-docs/introduction/",[],["getting_started"]],["developer_login","AMD 开发者登录","other","AMD","https://developer.amd.com.cn/login",[],[]],["creative_factory","Creative Factory","other","AMD","https://h3.oneclickamd.ai/video",[],["image_video"]],["gpu_model_guide","GPU 型号与 gfx 代号","zhihu_article","知乎","https://zhuanlan.zhihu.com/p/2067663713826612548",[],["gpu_models"]],["w7900_comfyui","W7900 · MiniMax H3 + ComfyUI","zhihu_article","知乎","https://zhuanlan.zhihu.com/p/2073092993117073920",[],["image_video","development"]],["dual_gpu_minimax","AMD / NV 双卡运行 MiniMax H3","bilibili_video","B站","https://www.bilibili.com/video/BV1ptb56HEPL/",[],["performance","image_video"]],["astra_game_demo","GPT-6 Astra 游戏实践","bilibili_video","B站","https://www.bilibili.com/video/BV1abYK6WEYF/",[],["development"]],["community_qa","AMD、ROCm 与 AI 社区答疑","xiaohongshu_content","小红书","https://www.xiaohongshu.com/discovery/item/6a8c12290000000028022167",[],["community_support"]],["qwen_performance","Qwen3.8-27B 性能实测","bilibili_video","B站","https://www.bilibili.com/video/BV1DMbv69EN3/",[],["performance","model_inference"]],["gpu_llm_guide","AMD GPU 能否跑大模型","zhihu_article","知乎","https://zhuanlan.zhihu.com/p/2070243270706435814",[],["model_inference"]],["radeon_player_story","AMD 显卡玩家实践","xiaohongshu_content","小红书","https://www.xiaohongshu.com/discovery/item/6a8e4eee00000000200344ff",[],["development"]],["issue_guide","GitHub 问题提交指南","other","GitHub","https://github.com/AMD-DEVELOPERS/AI-issues/blob/main/.github/ISSUE_TEMPLATE/ai-issue.md",[],["community_support"]],["xiaohongshu_profile","小红书主页","community","小红书","https://www.xiaohongshu.com/user/profile/6a6b08ac0000000013030800",[],["community_support"]],["xiaohongshu_short","小红书交流入口 · 短链","community","小红书","https://xhslink.cn/m/48X05yizCbk",[],["community_support"]],["rednote_profile","小红书频道 · Rednote 域名","community","小红书","https://www.rednote.com/user/profile/6a6b08ac0000000013030800",[],["community_support"]],["zhihu_profile","知乎主页","community","知乎","https://www.zhihu.com/people/fed0c9f3c397a3cc89d81c9b331393e2",[],["community_support"]],["bilibili_profile_short","B站主页 · 短链","community","B站","https://b23.tv/HtwltVK",[],["community_support"]],["community_qr_download","保存技术群二维码","other","本站","download:community-qr",[],["community_support"]]],"version":"hub-targets-v1","categories":{"platform":"平台入口","zhihu_article":"知乎文章","bilibili_video":"B站视频","xiaohongshu_content":"小红书内容","community":"社区主页","other":"其他出口"},"topics":{"getting_started":"开始使用","gpu_models":"显卡与架构","model_inference":"模型推理","image_video":"图像与视频","performance":"性能实测","development":"开发实践","community_support":"社区交流与支持"},"queryPolicies":{"developer_login":{"values":{"returnUrl":["/"]}},"community_qr_download":{"ignore":["v"]},"dual_gpu_minimax":{"ignore":["share_source","vd_source"]},"astra_game_demo":{"ignore":["share_source","vd_source"]},"community_qa":{"ignore":["source","xhsshare","xsec_source","xsec_token"]},"qwen_performance":{"ignore":["share_source","vd_source"]},"radeon_player_story":{"ignore":["source","xhsshare","xsec_source","xsec_token"]}},"trackingQueryKeys":["utm_source","utm_medium","utm_campaign","utm_term","utm_content","utm_id","gclid","fbclid","msclkid"],"provenance":{"derivedFrom":"dashboard-prototype/catalog-rules.json","baseSha256":"2ca0911281822b8cb896270eb930626905f4b40ee9e07520f2b6952823c43898","hubCommit":"960ec991a778df02a31a4b1729e5892bf413bb9a","topicsSource":"Curated from existing Hub link titles; not inferred from visitor behavior."}};
const ANALYTICS_CONFIG = {"enabled":false,"site":"hub","endpoint":"","allowedOrigins":["https://hub.amddev.ai"],"traffic":"production","timeoutMs":2000};

const analytics = installCollector({ config: ANALYTICS_CONFIG, rules: ANALYTICS_RULES });
globalThis.HubAnalytics = Object.freeze({ get enabled() { return analytics.enabled; }, setEnabled: value => analytics.setEnabled(value), flush: () => analytics.flush() });
const notice = document.getElementById('analytics-privacy');
const toggle = document.getElementById('analytics-toggle');
if (notice && toggle && ANALYTICS_CONFIG.enabled && ANALYTICS_CONFIG.allowedOrigins.includes(location.origin)) {
  notice.hidden = false;
  const update = () => { toggle.textContent = analytics.enabled ? '关闭统计' : '允许统计'; if (navigator.doNotTrack === '1') { toggle.textContent = '浏览器已关闭统计'; toggle.disabled = true; } };
  toggle.addEventListener('click', () => { analytics.setEnabled(!analytics.enabled); update(); });
  update();
}

})();
