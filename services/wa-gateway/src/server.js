// WhatsApp gateway: sends WhatsApp messages through WhatsApp Web driven by a
// headless Chromium (whatsapp-web.js). A stand-in until the official WhatsApp
// Business API. Message text carries one-time codes, so it is never logged.

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pkg from 'whatsapp-web.js';

const { Client, LocalAuth } = pkg;

// ---------------------------------------------------------------- config

const PORT = Number.parseInt(process.env.PORT || '3100', 10);
const DATA_DIR = process.env.WA_DATA_DIR || '/data';
const CHROME_PATH = process.env.CHROME_PATH || '/usr/bin/chromium';
const GATEWAY_KEY = process.env.WA_GATEWAY_KEY || '';

const MAX_TEXT = 1000; // characters
const MAX_BODY_BYTES = 16 * 1024;
const RATE_LIMIT = 30; // messages ...
const RATE_WINDOW_MS = 60_000; // ... per rolling minute, overall
const RESTART_DELAY_MS = 5_000;
const WA_CALL_TIMEOUT_MS = 30_000;
const LOGOUT_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------- logging

function fmt(v) {
  const s = String(v);
  return /[\s"=]/.test(s) || s === '' ? JSON.stringify(s) : s;
}

// One line per event on stdout. Never pass message text or the QR string here.
function log(event, fields = {}) {
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${fmt(v)}`);
  console.log([new Date().toISOString(), event, ...parts].join(' '));
}

function mask(number) {
  return number.length >= 8 ? `${number.slice(0, 4)}****${number.slice(-4)}` : '****';
}

function errText(e, scrub) {
  let msg = typeof e === 'string' ? e : (e && e.message) || String(e);
  if (scrub) msg = msg.split(scrub).join('[text]');
  return msg.replace(/\s+/g, ' ').slice(0, 300);
}

if (GATEWAY_KEY.length < 24) {
  console.error('WA_GATEWAY_KEY must be set and at least 24 characters long. Refusing to start.');
  process.exit(1);
}
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`PORT is not valid: ${process.env.PORT}`);
  process.exit(1);
}

// ---------------------------------------------------------------- auth

const sha256 = (s) => crypto.createHash('sha256').update(s).digest();
const KEY_DIGEST = sha256(GATEWAY_KEY);

function authorized(req) {
  const given = req.headers['x-gateway-key'];
  if (typeof given !== 'string' || given === '') return false;
  // Hash both sides so the comparison is constant-time whatever the length.
  return crypto.timingSafeEqual(sha256(given), KEY_DIGEST);
}

// ---------------------------------------------------------------- state

const status = {
  state: 'STARTING', // STARTING | QR | CONNECTED | DISCONNECTED
  qr: null,
  number: null,
  name: null,
  since: new Date().toISOString(),
  last_error: null,
};

function setState(next, patch = {}) {
  const prev = status.state;
  Object.assign(status, patch);
  if (next !== 'QR') status.qr = null;
  if (next === 'QR') {
    status.number = null;
    status.name = null;
  }
  if (next !== prev) {
    status.state = next;
    status.since = new Date().toISOString();
    log('state', { from: prev, to: next, number: status.number ? mask(status.number) : null });
  }
}

function setError(message) {
  status.last_error = message;
  log('error', { message });
}

// ---------------------------------------------------------------- rate limit

const sendTimes = [];

// Returns 0 when a slot was taken, otherwise the seconds to wait.
function takeSendSlot() {
  const now = Date.now();
  while (sendTimes.length && now - sendTimes[0] >= RATE_WINDOW_MS) sendTimes.shift();
  if (sendTimes.length >= RATE_LIMIT) {
    return Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - sendTimes[0])) / 1000));
  }
  sendTimes.push(now);
  return 0;
}

// ---------------------------------------------------------------- helpers

class HttpError extends Error {
  constructor(code, error, extra = {}) {
    super(error);
    this.code = code;
    this.body = { error, ...extra };
  }
}

class TimeoutError extends Error {}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError('timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Digits only; a leading 0 becomes 62; a leading + is dropped (it is not a digit).
// Must end up 10-15 digits starting with 62. Returns null when it does not.
function normalizeNumber(raw) {
  if (typeof raw !== 'string') return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  return /^62\d{8,13}$/.test(digits) ? digits : null;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const fail = (err) => {
      if (!done) {
        done = true;
        reject(err);
      }
    };
    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) return fail(new HttpError(413, 'payload_too_large'));
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
        resolve(value);
      } catch {
        reject(new HttpError(400, 'invalid_json'));
      }
    });
    req.on('error', fail);
  });
}

function sendJson(res, code, body, headers = {}) {
  if (res.headersSent) return;
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

// ---------------------------------------------------------------- WhatsApp client

const SESSION_DIR = path.join(path.resolve(DATA_DIR), 'session'); // LocalAuth's directory (no clientId)

let client = null; // the live client, or null while none is running
let restartTimer = null;
let dropping = Promise.resolve(); // chain of pending client teardowns
let logoutInFlight = null;
let shuttingDown = false;

function buildClient() {
  return new Client({
    authStrategy: new LocalAuth({ dataPath: DATA_DIR }),
    // Keep the downloaded WhatsApp Web page next to the session, on the volume.
    webVersionCache: { type: 'local', path: path.join(DATA_DIR, 'wwebjs_cache') },
    puppeteer: {
      executablePath: CHROME_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    },
  });
}

// A container that was killed or recreated leaves Chromium's profile lock behind
// and the next launch then refuses to start. Only done once, at process start,
// while no browser of ours exists.
function clearStaleBrowserLocks() {
  for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try {
      fs.rmSync(path.join(SESSION_DIR, f), { force: true });
    } catch {
      // nothing to clear
    }
  }
}

// Detach the current client (its events are ignored from now on) and close its browser.
function dropClient() {
  const old = client;
  client = null;
  if (!old) return;
  dropping = dropping.then(async () => {
    try {
      await old.destroy();
    } catch (e) {
      log('destroy_failed', { message: errText(e) });
    }
  });
}

function scheduleRestart(delay = RESTART_DELAY_MS) {
  if (shuttingDown || restartTimer) return;
  restartTimer = setTimeout(async () => {
    restartTimer = null;
    try {
      await dropping;
      await startClient();
    } catch (e) {
      setState('DISCONNECTED');
      setError(`restart: ${errText(e)}`);
      scheduleRestart();
    }
  }, delay);
}

// Something went wrong with client `c`: report it, tear it down, bring a fresh one up.
function recover(c, where, err) {
  if (client !== c) return; // stale client, already handled
  const message = `${where}: ${errText(err)}`;
  setState('DISCONNECTED');
  setError(message);
  dropClient();
  scheduleRestart();
}

function wire(c) {
  c.on('qr', (qr) => {
    if (client !== c) return;
    setState('QR', { qr }); // logged on the state change only; the QR itself is never logged
  });

  c.on('authenticated', () => {
    if (client !== c) return;
    setState('STARTING');
  });

  c.on('auth_failure', (message) => recover(c, 'auth_failure', message));

  c.on('ready', () => {
    if (client !== c) return;
    const info = c.info || {};
    setState('CONNECTED', {
      number: info.wid && info.wid.user ? String(info.wid.user) : null,
      name: info.pushname || null,
      last_error: null,
    });
  });

  c.on('disconnected', (reason) => {
    if (client !== c) return;
    const loggedOut = reason === 'LOGOUT';
    setState('DISCONNECTED', loggedOut ? { number: null, name: null } : {});
    setError(`disconnected: ${errText(reason)}`);
    dropClient();
    if (loggedOut) {
      // The phone unlinked this device: make sure the dead session is gone so a new QR shows.
      dropping = dropping.then(() => fs.rmSync(SESSION_DIR, { recursive: true, force: true }));
    }
    scheduleRestart();
  });
}

async function startClient() {
  if (shuttingDown) return;
  setState('STARTING');
  let c;
  try {
    c = buildClient();
    client = c;
    wire(c);
    await c.initialize();
  } catch (e) {
    if (c) {
      recover(c, 'initialize', e);
    } else {
      setState('DISCONNECTED');
      setError(`initialize: ${errText(e)}`);
      scheduleRestart();
    }
    return;
  }
  if (client !== c) return;
  // If Chromium itself dies, the library does not tell us; do it ourselves.
  if (c.pupBrowser && typeof c.pupBrowser.on === 'function') {
    c.pupBrowser.on('disconnected', () => recover(c, 'browser', 'browser closed'));
  }
}

async function logout() {
  if (logoutInFlight) return logoutInFlight;
  logoutInFlight = (async () => {
    log('logout_requested');
    clearTimeout(restartTimer);
    restartTimer = null;
    const c = client;
    client = null; // ignore everything this client emits from now on
    await dropping;
    if (c) {
      try {
        await withTimeout(c.logout(), LOGOUT_TIMEOUT_MS);
      } catch (e) {
        // Not paired yet (QR showing) or WhatsApp Web unresponsive: just close it.
        log('logout_fallback', { message: errText(e) });
        try {
          await c.destroy();
        } catch (e2) {
          log('destroy_failed', { message: errText(e2) });
        }
      }
    }
    fs.rmSync(SESSION_DIR, { recursive: true, force: true }); // whatever happened above
    setState('DISCONNECTED', { number: null, name: null, last_error: null });
    scheduleRestart(1000);
  })().finally(() => {
    logoutInFlight = null;
  });
  return logoutInFlight;
}

// ---------------------------------------------------------------- routes

function handleStatus(res) {
  sendJson(res, 200, {
    state: status.state,
    qr: status.state === 'QR' ? status.qr : null,
    number: status.number,
    name: status.name,
    since: status.since,
    last_error: status.last_error,
  });
}

async function handleSend(req, res) {
  const body = await readJson(req);

  const to = normalizeNumber(body.to);
  if (!to) throw new HttpError(400, 'invalid_number');

  const text = body.text;
  if (typeof text !== 'string' || text.trim() === '') throw new HttpError(400, 'invalid_text');
  if (text.length > MAX_TEXT) throw new HttpError(400, 'text_too_long', { max: MAX_TEXT });

  const c = client;
  if (status.state !== 'CONNECTED' || !c) {
    throw new HttpError(503, 'not_connected', { state: status.state });
  }

  const wait = takeSendSlot();
  if (wait > 0) {
    log('send_rate_limited', { retry_after: wait });
    throw new HttpError(429, 'rate_limited', { retry_after: wait });
  }

  try {
    const id = await withTimeout(c.getNumberId(to), WA_CALL_TIMEOUT_MS);
    if (!id) {
      log('send_rejected', { to: mask(to), reason: 'not_on_whatsapp' });
      throw new HttpError(422, 'not_on_whatsapp');
    }
    const msg = await withTimeout(c.sendMessage(id._serialized, text), WA_CALL_TIMEOUT_MS);
    const messageId = msg && msg.id && msg.id._serialized;
    log('sent', { to: mask(to), msg: msg && msg.id ? msg.id.id : null });
    sendJson(res, 200, { id: messageId, to });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    const timedOut = e instanceof TimeoutError;
    const message = errText(e, text);
    status.last_error = `send: ${message}`;
    log('send_failed', { to: mask(to), reason: timedOut ? 'timeout' : 'error', message });
    throw new HttpError(timedOut ? 504 : 502, timedOut ? 'send_timeout' : 'send_failed');
  }
}

async function handleLogout(res) {
  await logout();
  sendJson(res, 200, { ok: true });
}

const ROUTES = {
  '/status': { GET: (req, res) => handleStatus(res) },
  '/send': { POST: handleSend },
  '/logout': { POST: (req, res) => handleLogout(res) },
};

const server = http.createServer(async (req, res) => {
  try {
    // Every route, known or not, needs the key.
    if (!authorized(req)) {
      log('auth_rejected', { ip: req.socket.remoteAddress });
      return sendJson(res, 401, { error: 'unauthorized' });
    }

    let pathname = '';
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      // falls through to 404
    }
    const route = Object.hasOwn(ROUTES, pathname) ? ROUTES[pathname] : null;
    if (!route) return sendJson(res, 404, { error: 'not_found' });

    const handler = route[req.method];
    if (!handler) {
      return sendJson(res, 405, { error: 'method_not_allowed' }, { allow: Object.keys(route).join(', ') });
    }
    await handler(req, res);
  } catch (e) {
    if (e instanceof HttpError) {
      const headers = {};
      if (e.code === 429) headers['retry-after'] = String(e.body.retry_after);
      if (e.code === 413) headers.connection = 'close';
      return sendJson(res, e.code, e.body, headers);
    }
    log('internal_error', { message: errText(e) });
    sendJson(res, 500, { error: 'internal_error' });
  }
});

// ---------------------------------------------------------------- process

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('shutdown', { signal });
  clearTimeout(restartTimer);
  setTimeout(() => process.exit(1), 10_000).unref();
  server.close();
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  const c = client;
  client = null;
  try {
    await dropping;
    if (c) await c.destroy();
  } catch (e) {
    log('destroy_failed', { message: errText(e) });
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Puppeteer rejects stray promises when a page navigates or closes; those are not fatal.
process.on('unhandledRejection', (reason) => {
  log('unhandled_rejection', { message: errText(reason) });
});
process.on('uncaughtException', (e) => {
  log('uncaught_exception', { message: errText(e) });
  process.exit(1);
});

try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (e) {
  log('data_dir_unavailable', { dir: DATA_DIR, message: errText(e) });
}
clearStaleBrowserLocks();

server.listen(PORT, '0.0.0.0', () => {
  log('listening', { port: PORT, data_dir: DATA_DIR, chrome: CHROME_PATH });
  startClient();
});
