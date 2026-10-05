// Receive at store — the shop's half of the handheld.
//
// A real handheld sweeps the cartons that came off the lorry and posts what it
// read to the store edge (`POST /api/v1/store/inbound/{id}/receive`). The
// store never shows the expected count first: that is the blind count. Here
// the "cartons in front of us" are the tags the DC sent on that surat jalan,
// read from the centre's reconciliation (DC_ONLY = sent, not yet received).

const STORE = '/store';
const CLOUD = '/cloud';
const $ = (id) => document.getElementById(id);

let deliveries = [];
// Which shop this handheld stands in: the store node's own site, named as the
// register names it.
let storeSite = '';
fetch(`${STORE}/api/v1/health`).then((r) => r.json()).then((h) => { storeSite = h.site_id ?? ''; }).catch(() => {});
let selected = null;
let epcs = [];

function esc(value) {
  return String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Tab switch between the two halves of the handheld.
for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => {
    for (const other of document.querySelectorAll('.tab')) other.classList.toggle('on', other === tab);
    const store = tab.dataset.view === 'store';
    $('dcView').style.display = store ? 'none' : '';
    $('storeView').style.display = store ? '' : 'none';
    try { localStorage.setItem('rfid-sim.view', tab.dataset.view); } catch {}
    if (store) pollDeliveries();
  });
}
try {
  if (localStorage.getItem('rfid-sim.view') === 'store') document.querySelector('.tab[data-view="store"]').click();
} catch {}

async function pollDeliveries() {
  try {
    const response = await fetch(`${STORE}/api/v1/store/inbound`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    deliveries = (data.deliveries ?? data.items ?? []).filter((d) => d.status === 'IN_TRANSIT');
    if (selected && !deliveries.some((d) => d.delivery_id === selected.delivery_id)) {
      // Received (by us or anyone): move on rather than keep a stale delivery.
      selected = null;
      epcs = [];
    }
    if (!selected && deliveries.length > 0) await selectDelivery(deliveries[0]);
    renderDeliveries();
    if (!selected) $('delCard').style.display = 'none';
  } catch (error) {
    $('deliveries').innerHTML = `<div class="empty">Could not reach the shop's node: ${esc(error.message)}</div>`;
  }
}

function renderDeliveries() {
  $('delCount').textContent = String(deliveries.length);
  if (deliveries.length === 0) {
    $('deliveries').innerHTML = '<div class="empty">Nothing on the way to this shop.</div>';
    return;
  }
  $('deliveries').innerHTML = '';
  for (const d of deliveries) {
    const item = document.createElement('div');
    item.className = 'box-item' + (selected?.delivery_id === d.delivery_id ? ' selected' : '');
    item.innerHTML = `<div><div><strong>${esc(d.shipment_reference)}</strong> from ${esc(d.source_site_id)}</div>
      <div class="meta">${d.koli_count} ${d.koli_count === 1 ? 'carton' : 'cartons'} · departed ${esc(new Date(d.departed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</div></div>
      <span class="pill">in transit</span>`;
    item.addEventListener('click', () => selectDelivery(d).then(renderDeliveries));
    $('deliveries').appendChild(item);
  }
}

async function selectDelivery(delivery) {
  selected = delivery;
  epcs = [];
  $('delCard').style.display = '';
  $('rResult').style.display = 'none';
  $('delTitle').textContent = `${delivery.shipment_reference} → ${window.shopLabel?.(storeSite) || 'this shop'} · ${delivery.koli_count} ${delivery.koli_count === 1 ? 'carton' : 'cartons'}`;
  $('delTags').textContent = 'Reading the cartons…';
  try {
    const response = await fetch(`${CLOUD}/api/v1/inventory/reconciliations?limit=5000`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    epcs = (data.rows ?? [])
      .filter((row) => row.shipment_reference === delivery.shipment_reference && row.status === 'DC_ONLY')
      .map((row) => row.epc);
    // The count itself stays blind on the shop's screen; the handheld only
    // says how many tags it can hear.
    $('delTags').textContent = epcs.length
      ? `${epcs.length} tags in range`
      : 'No tags heard yet — the centre may still be catching up. Try again in a few seconds.';
    $('receiveBtn').disabled = epcs.length === 0;
  } catch (error) {
    $('delTags').textContent = `Could not read the cartons: ${error.message}`;
    $('receiveBtn').disabled = true;
  }
}

function countFor(mode) {
  if (mode === 'missing') return epcs.slice(1);
  if (mode === 'extra') {
    const hex = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    return [...epcs, `E280FFFF${hex}`];
  }
  return [...epcs];
}

$('receiveBtn').addEventListener('click', async () => {
  if (!selected) return;
  const mode = document.querySelector('input[name="rmode"]:checked')?.value ?? 'correct';
  const read = countFor(mode);
  $('receiveBtn').disabled = true;
  try {
    const response = await fetch(`${STORE}/api/v1/store/inbound/${encodeURIComponent(selected.delivery_id)}/receive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ epcs: read, actor_id: 'handheld', idempotency_key: `sim-receive-${crypto.randomUUID()}` }),
    });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
    const r = body.result ?? body.delivery?.result ?? body;
    const short = (r.missing_units ?? 0) > 0 || (r.extra_units ?? 0) > 0;
    $('rBanner').className = `banner ${short ? 'err' : 'ok'}`;
    $('rBanner').textContent = r.expected_units !== undefined
      ? `Received ${r.received_units} of ${r.expected_units}` +
        (r.missing_units ? ` · ${r.missing_units} missing` : '') +
        (r.extra_units ? ` · ${r.extra_units} extra` : '') +
        ' — now open Receive in the shop app.'
      : `Sent ${read.length} tags — now open Receive in the shop app.`;
    $('rJson').textContent = JSON.stringify(body, null, 2);
    $('rResult').style.display = '';
    selected = null;
    setTimeout(pollDeliveries, 1500);
  } catch (error) {
    $('rBanner').className = 'banner err';
    $('rBanner').textContent = `The shop's node refused the count: ${error.message}`;
    $('rJson').textContent = '';
    $('rResult').style.display = '';
    $('receiveBtn').disabled = false;
  }
});

setInterval(() => {
  if ($('storeView').style.display !== 'none') pollDeliveries();
}, 4000);
