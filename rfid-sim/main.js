// Handheld RFID simulator — plain JS, no build step beyond Vite's dev server.
// Talks to a DC Edge node through the /edge proxy (see vite.config.mjs).

const EDGE = '/edge';
const OBS_PATH = '/api/v1/rfid/observations';

const LS_KEYS = {
  deviceId: 'rfidsim.deviceId',
  deviceKey: 'rfidsim.deviceKey',
  operatorToken: 'rfidsim.operatorToken',
  poolId: 'rfidsim.poolId',
};

const el = {
  deviceId: document.getElementById('deviceId'),
  deviceKey: document.getElementById('deviceKey'),
  operatorToken: document.getElementById('operatorToken'),
  poolId: document.getElementById('poolId'),
  healthDot: document.getElementById('healthDot'),
  healthText: document.getElementById('healthText'),
  boxes: document.getElementById('boxes'),
  boxesCount: document.getElementById('boxesCount'),
  detailCard: document.getElementById('detailCard'),
  detailTitle: document.getElementById('detailTitle'),
  targetTable: document.getElementById('targetTable').querySelector('tbody'),
  sweepBtn: document.getElementById('sweepBtn'),
  result: document.getElementById('result'),
  banner: document.getElementById('banner'),
  actions: document.getElementById('actions'),
  resultJson: document.getElementById('resultJson'),
};

// ---- persisted settings ------------------------------------------------

for (const [field, key] of Object.entries(LS_KEYS)) {
  const saved = localStorage.getItem(key);
  if (saved) el[field].value = saved;
  el[field].addEventListener('input', () => localStorage.setItem(key, el[field].value));
}

// ---- signing (must match backend/src/edge/rfid.rs exactly) ------------

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toHex(digest);
}

async function hmacSha256Hex(keyBytes, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return toHex(sig);
}

let lastSequence = 0;
function nextSequence() {
  lastSequence = Math.max(Date.now(), lastSequence + 1);
  return lastSequence;
}

async function signRequest(deviceIdUpper, deviceKeyRaw, timestamp, sequence, bodyBytes) {
  const signingKeyHex = await sha256Hex(deviceKeyRaw.trim());
  const signingKeyBytes = new TextEncoder().encode(signingKeyHex);
  const bodyDigest = await sha256Hex(bodyBytes);
  const canonical = `POST\n${OBS_PATH}\n${deviceIdUpper}\n${timestamp}\n${sequence}\n${bodyDigest}`;
  return hmacSha256Hex(signingKeyBytes, canonical);
}

async function postObservations(bodyBytes) {
  const deviceIdUpper = el.deviceId.value.trim().toUpperCase();
  const deviceKeyRaw = el.deviceKey.value;
  if (!deviceIdUpper || !deviceKeyRaw) {
    throw new Error('Device ID and Device key are required');
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const sequence = nextSequence();
  const signature = await signRequest(deviceIdUpper, deviceKeyRaw, timestamp, sequence, bodyBytes);
  const headers = {
    'Content-Type': 'application/json',
    'X-Device-Id': deviceIdUpper,
    'X-Device-Timestamp': String(timestamp),
    'X-Device-Sequence': String(sequence),
    'X-Device-Signature': signature,
  };
  const token = el.operatorToken.value.trim();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(`${EDGE}${OBS_PATH}`, { method: 'POST', headers, body: bodyBytes });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = json && json.error ? json.error : `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return json;
}

// ---- health ------------------------------------------------------------

let siteId = null;

async function pollHealth() {
  try {
    const response = await fetch(`${EDGE}/api/v1/health`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    siteId = data.site_id ?? null;
    el.healthDot.className = 'dot ok';
    el.healthText.textContent = `Connected — site ${data.site_id ?? '?'} (${data.node_role ?? '?'})`;
    if (siteId && !el.poolId.value.trim()) {
      el.poolId.value = `${siteId}.outbound.picking`;
      localStorage.setItem(LS_KEYS.poolId, el.poolId.value);
    }
  } catch (error) {
    el.healthDot.className = 'dot err';
    el.healthText.textContent = `Edge unreachable: ${error.message}`;
  }
}

// ---- open boxes ----------------------------------------------------------

let boxes = [];
let selectedSessionId = null;

// Shops as people read them ("C001 · Cikupa"), from the centre's register —
// never the node's technical id (store-01).
const shopNames = new Map();
async function loadShopNames() {
  try {
    const response = await fetch('/cloud/api/v1/organisation/units');
    if (!response.ok) return;
    const units = await response.json();
    for (const unit of units.items ?? units) {
      const label = unit.code ? `${unit.code} · ${unit.name}` : unit.name;
      shopNames.set(unit.id, label);
      for (const site of unit.sites ?? []) shopNames.set(site.id, label);
    }
  } catch {}
}
window.shopLabel = (id) => shopNames.get(id) ?? id;
loadShopNames();
let candidates = null;

async function pollBoxes() {
  try {
    const response = await fetch(`${EDGE}/api/v1/dc/packing-boxes`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    boxes = data.items ?? [];
    const stillOpen = boxes.some((b) => b.session.session_id === selectedSessionId);
    if (!stillOpen) {
      // The box we were sweeping is sealed (or cancelled): never keep its
      // candidates around, or the next Sweep would send the old carton's tags.
      // Move to the newest open box, which is the one the packer just opened.
      candidates = null;
      if (boxes.length > 0) {
        await selectBox(boxes[0].session.session_id);
      } else {
        selectedSessionId = null;
        el.detailCard.style.display = 'none';
        renderBoxes();
      }
      return;
    }
    renderBoxes();
    await loadCandidates(selectedSessionId, { silent: true });
  } catch (error) {
    el.boxes.innerHTML = `<div class="empty">Could not load boxes: ${escapeHtml(error.message)}</div>`;
  }
}

function renderBoxes() {
  el.boxesCount.textContent = String(boxes.length);
  if (boxes.length === 0) {
    el.boxes.innerHTML = '<div class="empty">No open boxes right now.</div>';
    return;
  }
  el.boxes.innerHTML = '';
  for (const box of boxes) {
    const item = document.createElement('div');
    item.className = 'box-item' + (box.session.session_id === selectedSessionId ? ' selected' : '');
    const lineCount = box.target.length;
    item.innerHTML = `
      <div>
        <div><strong>${escapeHtml(box.koli_number ?? 'Open carton')}</strong> → ${escapeHtml(window.shopLabel(box.destination_store_id))}</div>
        <div class="meta">${lineCount} SKU line${lineCount === 1 ? '' : 's'} · session ${escapeHtml(box.session.session_id)}</div>
      </div>
      <span class="pill ${box.ready ? 'ready' : ''}">${box.ready ? 'ready' : 'filling'}</span>
    `;
    item.addEventListener('click', () => selectBox(box.session.session_id));
    el.boxes.appendChild(item);
  }
}

async function selectBox(sessionId) {
  selectedSessionId = sessionId;
  renderBoxes();
  el.detailCard.style.display = '';
  el.result.style.display = 'none';
  await loadCandidates(sessionId);
}

async function loadCandidates(sessionId, opts = {}) {
  try {
    const response = await fetch(`${EDGE}/api/v1/dc/packing-boxes/${encodeURIComponent(sessionId)}/candidates`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    candidates = await response.json();
    renderDetail();
  } catch (error) {
    if (!opts.silent) {
      el.targetTable.innerHTML = `<tr><td colspan="3">Could not load candidates: ${escapeHtml(error.message)}</td></tr>`;
    }
  }
}

function renderDetail() {
  const box = boxes.find((b) => b.session.session_id === selectedSessionId);
  el.detailTitle.textContent = box
    ? `${box.koli_number ?? 'Open carton'} → ${window.shopLabel(box.destination_store_id)}`
    : 'Box';
  if (!candidates) return;
  el.targetTable.innerHTML = '';
  for (const line of candidates.lines) {
    const short = line.epcs.length < line.target_qty;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(line.sku_code)}</td>
      <td>${line.target_qty}</td>
      <td class="${short ? 'short' : ''}">${line.epcs.length} / ${line.target_qty}${short ? ' — picking area short' : ''}</td>
    `;
    el.targetTable.appendChild(tr);
  }
  if (candidates.lines.length === 0) {
    el.targetTable.innerHTML = '<tr><td colspan="3">No target lines.</td></tr>';
  }
}

// ---- sweep ---------------------------------------------------------------

function randomHex(length) {
  let out = '';
  while (out.length < length) out += Math.floor(Math.random() * 16).toString(16);
  return out.slice(0, length).toUpperCase();
}

function buildEpcList(mode) {
  const allTarget = candidates.lines.flatMap((line) => line.epcs);
  let epcs = [...allTarget];
  let note = '';
  if (mode === 'missing') {
    if (epcs.length > 0) epcs = epcs.slice(1);
    note = 'Dropped one target EPC.';
  } else if (mode === 'extra') {
    if (candidates.others && candidates.others.length > 0) {
      epcs = [...epcs, candidates.others[0].epc];
      note = `Added a wrong-SKU garment (${candidates.others[0].sku_code}).`;
    } else {
      note = 'No "others" tags available in the picking area — sent correct set only.';
    }
  } else if (mode === 'unknown') {
    epcs = [...epcs, `E280FFFF${randomHex(16)}`];
    note = 'Added a made-up, unrecognised EPC.';
  } else {
    note = 'Every target EPC included.';
  }
  return { epcs, note };
}

async function runSweep() {
  if (!candidates) return;
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const { epcs, note } = buildEpcList(mode);
  const pool = el.poolId.value.trim();
  const site = siteId ?? pool.split('.')[0];
  const readerSessionId = `SIM-${crypto.randomUUID()}`;
  const payload = {
    site_id: site,
    pool,
    reader_session_id: readerSessionId,
    observed_at: new Date().toISOString(),
    idempotency_key: `sim-${crypto.randomUUID()}`,
    observations: epcs.map((epc) => ({
      epc,
      rssi: -40 - Math.floor(Math.random() * 25),
      antenna: 'A1',
      read_count: 1,
    })),
  };
  const bodyBytes = new TextEncoder().encode(JSON.stringify(payload));
  lastSweepBytes = bodyBytes;
  await sendSweep(bodyBytes, { readerSessionId, count: epcs.length, note });
}

let lastSweepBytes = null;
let lastSweepMeta = null;

async function sendSweep(bodyBytes, meta) {
  lastSweepMeta = meta;
  el.result.style.display = '';
  el.actions.innerHTML = '';
  el.banner.className = 'banner';
  el.banner.textContent = 'Sending…';
  el.resultJson.textContent = '';
  el.sweepBtn.disabled = true;
  try {
    const response = await postObservations(bodyBytes);
    el.banner.className = 'banner ok';
    el.banner.textContent =
      `Sent ${meta.count} tags in session ${meta.readerSessionId} — now press "Check this sweep" in Central. ${meta.note}`;
    el.resultJson.textContent = JSON.stringify(response, null, 2);
  } catch (error) {
    el.banner.className = 'banner err';
    el.banner.textContent = `Sweep refused: ${error.message}`;
    el.resultJson.textContent = '';
    const retry = document.createElement('button');
    retry.textContent = 'Retry sweep';
    retry.addEventListener('click', () => sendSweep(lastSweepBytes, lastSweepMeta));
    el.actions.appendChild(retry);
  } finally {
    el.sweepBtn.disabled = false;
  }
}

el.sweepBtn.addEventListener('click', () => {
  runSweep().catch((error) => {
    el.result.style.display = '';
    el.banner.className = 'banner err';
    el.banner.textContent = `Could not build sweep: ${error.message}`;
    el.resultJson.textContent = '';
  });
});

// ---- utils ---------------------------------------------------------------

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// ---- boot ------------------------------------------------------------

pollHealth();
pollBoxes();
setInterval(pollHealth, 5000);
setInterval(pollBoxes, 3000);
