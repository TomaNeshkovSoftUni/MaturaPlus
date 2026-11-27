/*
 * API клиент на frontend-а. Единственото място, което "говори" с backend-а.
 *
 * Сега транспортът е вграденият сървър (MP.getBackend().server.handle),
 * с изкуствено мрежово закъснение и timeout – за да се държи като истински
 * HTTP. При преминаване към истински сървър се сменя само `transport`
 * с fetch() – страниците не се променят.
 *
 * Режим за тестване (localStorage 'maturaplus.debug', виж tests/manual.html):
 *   { "latencyMs": 4000 }   – бавен отговор
 *   { "offline": true }     – мрежова грешка
 *   { "dbDown": true }      – базата "пада" → 500
 */
(function (MP) {
  'use strict';

  class NetworkError extends Error {
    constructor(kind) {
      super(kind === 'timeout' ? 'Request timeout' : 'Network error');
      this.name = 'NetworkError';
      this.kind = kind; // 'timeout' | 'offline'
    }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function readDebug() {
    try { return JSON.parse(window.localStorage.getItem('maturaplus.debug') || '{}'); } catch (e) { return {}; }
  }

  function clientId() {
    let id = window.localStorage.getItem('maturaplus.clientId');
    if (!id) { id = MP.uuid(); window.localStorage.setItem('maturaplus.clientId', id); }
    return id;
  }

  /** UUID v4 (crypto.randomUUID, ако го има). */
  MP.uuid = function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    const b = window.crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };

  function defaultTransport(req, debug) {
    const backend = MP.getBackend();
    backend.db.simulateFailure = !!debug.dbDown;
    return backend.server.handle(req);
  }

  /**
   * @param {{transport?: Function, latencyMs?: number, timeoutMs?: number, getSession?: Function}} [options]
   */
  function createApiClient(options) {
    const opts = options || {};
    const transport = opts.transport || defaultTransport;
    const timeoutMs = opts.timeoutMs || 10000;

    return {
      /**
       * @returns {Promise<{ok: boolean, status: number, data: any, headers: object}>}
       * @throws {NetworkError} при timeout или липса на връзка
       */
      async request(method, path, body, reqOptions) {
        const ro = reqOptions || {};
        const debug = opts.transport ? {} : readDebug();
        const latency = debug.latencyMs !== undefined ? debug.latencyMs : (opts.latencyMs !== undefined ? opts.latencyMs : 200);
        const limit = ro.timeoutMs || timeoutMs;

        const session = opts.getSession ? opts.getSession() : (MP.session && MP.session.get());
        const headers = { 'content-type': 'application/json', 'x-client-id': opts.clientId || clientId() };
        if (session) {
          headers['x-session-token'] = session.token;
          headers['x-csrf-token'] = session.csrfToken;
        }

        const call = (async () => {
          await sleep(latency / 2);
          if (debug.offline) throw new NetworkError('offline');
          const res = await transport({ method, path, headers, body: body === undefined ? null : body }, debug);
          await sleep(latency / 2);
          return res;
        })();

        let timer;
        const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new NetworkError('timeout')), limit); });
        try {
          const res = await Promise.race([call, timeout]);
          if (res.status === 401 && session && MP.session) MP.session.clear(); // изтекла сесия
          return { ok: res.status >= 200 && res.status < 300, status: res.status, data: res.body, headers: res.headers || {} };
        } finally {
          clearTimeout(timer);
        }
      },
      get(path, o) { return this.request('GET', path, undefined, o); },
      post(path, body, o) { return this.request('POST', path, body, o); },
      put(path, body, o) { return this.request('PUT', path, body, o); },
      patch(path, body, o) { return this.request('PATCH', path, body, o); },
      del(path, o) { return this.request('DELETE', path, undefined, o); },
    };
  }

  MP.NetworkError = NetworkError;
  MP.createApiClient = createApiClient;
  MP.api = MP.api || {};
  MP.apiClient = createApiClient();
})(window.MP = window.MP || {});
