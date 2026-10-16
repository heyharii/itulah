// Fake PO data for the running hub: every PO detail / Review Count branch.
(() => {
  const BPS = 250
  const ART = [
    { code: 'KMJ-LN-01', name: 'Kemeja Linen Lengan Panjang', price: 90000, qty: 120, div: 'MEN', tags: ['TOPS', 'LINEN'] },
    { code: 'CLN-CH-02', name: 'Celana Chino Slim Fit', price: 125000, qty: 80, div: 'MEN', tags: ['BOTTOMS'] },
    { code: 'KOS-PL-03', name: 'Kaos Polos Cotton Combed 30s', price: 45000, qty: 200, div: 'WOMEN', tags: ['TOPS', 'BASIC'], kodi: true },
  ]
  const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const lineId = (s, i) => uid(s * 10 + i + 1000)
  const day = (d) => `2026-10-${String(d).padStart(2, '0')}`
  const at = (d, h = 10) => `2026-10-${String(d).padStart(2, '0')}T0${h - 7}:12:00Z`
  const val = (a, n) => a.price * n
  const disc = (n) => Math.round((n * BPS) / 10000)

  // r: [{q, ex, wr, d}] receipts per line; cs: closed short pcs; v: variants
  function line(s, i, o = {}) {
    const a = ART[i]
    const qty = o.qty ?? a.qty
    const receipts = (o.r ?? []).map((x, k) => ({
      receipt_number: `GRN-2610-${String(s).padStart(2, "0")}${k}`,
      quantity: x.q + (x.ex ?? 0) + (x.wr ?? 0),
      matched_quantity: x.q,
      excess_quantity: (x.ex ?? 0) + (x.wr ?? 0),
      wrong_quantity: x.wr ?? 0,
      received_at: at(x.d ?? 14),
      received_by: 'dimas',
    }))
    const received = receipts.reduce((t, x) => t + x.matched_quantity, 0)
    const excess = receipts.reduce((t, x) => t + x.excess_quantity, 0)
    const wrong = receipts.reduce((t, x) => t + x.wrong_quantity, 0)
    const cs = o.cs ?? null
    return {
      po_line_id: lineId(s, i), line_number: i + 1, supplier_item_id: null,
      unit_price_minor: a.price, ordered_value_minor: val(a, qty),
      expected_value_minor: val(a, received) - disc(val(a, received)),
      article_code: a.code, article_name: a.name, image_url: null,
      division_code: a.div, tags: a.tags, promised_date: null,
      ordered_quantity: qty, cancelled_quantity: 0, expected_stock_units: qty,
      received_quantity: received, discount_minor: disc(val(a, qty)), receipts,
      outstanding_stock_units: Math.max(0, qty - received - (cs ?? 0)),
      excess_quantity: excess, excess_pending_quantity: o.returned ? 0 : excess,
      wrong_quantity: wrong, closed_short_units: cs, closed_short_by: cs ? 'rina' : null,
      closed_short_reason: cs ? 'Supplier out of stock' : null,
      line_status: 'OPEN', variants: o.v ?? [],
      ...(a.kodi && !o.v ? { order_unit_code: 'KODI', order_unit_quantity: String(qty / 20), unit_factor: '20', order_unit_price_minor: a.price * 20 } : {}),
    }
  }

  function order(s, b) {
    const lines = b.lines.map((o, i) => (o === null ? null : line(s, i, o))).filter(Boolean)
    const gross = lines.reduce((t, l) => t + l.ordered_value_minor, 0)
    const discount = disc(gross)
    const stays = lines.reduce((t, l) => t + l.unit_price_minor * (l.ordered_quantity - (l.closed_short_units ?? 0)), 0)
    const returns = (b.returns ?? []).map((r, k) => ({
      return_id: uid(9000 + s * 10 + k), return_number: `RS-2610-00${s}${k}`,
      purchase_order_id: uid(s), po_number: `PO-2610-0${100 + s}`, supplier_id: uid(500),
      supplier_name: 'CV Sinar Garmen Abadi', site_id: uid(600), status: r.status,
      note: null, raised_by: 'rina', raised_at: at(15), handed_over_by: r.status === 'HANDED_OVER' ? 'dimas' : null,
      handed_over_at: r.status === 'HANDED_OVER' ? at(16) : null, note_generated_at: r.note ? at(15, 14) : null,
      quantity: r.lines.reduce((t, x) => t + x.q, 0),
      lines: r.lines.map((x) => ({ receipt_line_id: uid(7000 + s * 10 + x.i), po_line_id: lineId(s, x.i), article_code: ART[x.i].code, article_name: ART[x.i].name, quantity: x.q, wrong_quantity: x.wr ?? 0 })),
    }))
    return {
      purchase_order_id: uid(s), po_number: `PO-2610-0${100 + s}`, supplier_id: uid(500), supplier_ref_id: null,
      notes: b.notes ?? null, payment_terms_code: 'NET30', payment_terms_name: '30 days', payment_method: 'GIRO',
      terms_and_conditions: 'Goods are received Monday to Saturday, 08:00–15:00, with a break from 12:00 to 13:00. On Fridays the break is from 11:30 to 13:00.',
      discount_bps: BPS, editable: b.editable ?? false, edit_blocked_reason: null,
      cancellable: b.cancellable ?? false, cancel_blocked_reason: null,
      supplier_name: 'CV Sinar Garmen Abadi', destination_site_id: uid(600), origin_kind: 'HUB',
      lifecycle: b.life, order_status: b.life === 'ACTIVE' || b.life === 'PARTIALLY_RECEIVED' ? 'ISSUED' : 'CLOSED',
      currency: 'IDR', created_by: 'rina', issued_at: at(8), activation_command_id: null,
      fully_received: b.life === 'FULLY_RECEIVED',
      expected_value_minor: stays - disc(stays), gross_minor: gross, discount_minor: discount,
      net_minor: gross - discount, expected_arrival: day(b.due ?? 20), created_at: at(8),
      revisions: b.life === 'CANCELLED' ? [{ revision_id: uid(8000 + s), revised_by: 'rina', revised_at: at(13), changes: [{ kind: 'cancelled', to: 'Supplier raised prices after the order was placed' }] }]
        : b.life === 'SHORT_RECEIVED' ? [{ revision_id: uid(8000 + s), revised_by: 'rina', revised_at: at(15), changes: [] }] : [],
      lines, returns,
    }
  }

  // counts: per line {c (matched counted), wr, prev}
  function counts(s, o, b) {
    return (b.count ?? []).map((c, k) => {
      const l = o.lines.find((x) => x.po_line_id === lineId(s, c.i))
      const left = l.ordered_quantity - l.received_quantity
      return {
        count_id: uid(5000 + s * 10 + k), receipt_id: uid(5500 + s), po_line_id: l.po_line_id, po_number: o.po_number,
        supplier_id: o.supplier_id, article_code: l.article_code, article_name: l.article_name,
        counted_quantity: c.c + (c.wr ?? 0), wrong_quantity: c.wr ?? 0, counted_by: 'dimas', counted_at: at(16, 9),
        expected_stock_units: l.ordered_quantity, variance: c.c - left, outstanding_stock_units: left,
        unit_price_minor: l.unit_price_minor, raised_by: 'rina',
        order_unit_code: c.kodi ? 'KODI' : null, order_unit_quantity: c.kodi ? String(l.ordered_quantity / 20) : null, unit_factor: c.kodi ? '20' : null,
        counted_unit_code: c.kodi ? 'KODI' : null, counted_unit_quantity: c.kodi ? String(c.c / 20) : null,
        stock_unit_code: 'PCS', previous_counted_quantity: c.prev ?? null,
        variants: (c.v ?? []).map((v) => ({ colour_code: v[0], colour_label: v[0] === 'WHITE' ? 'White' : 'Navy', size_code: v[1], size_label: v[1], image_urls: [], ordered_quantity: v[2], outstanding_quantity: v[2], counted_quantity: v[3] })),
        recount_reason: c.prev != null ? 'Box 3 was not opened' : null, first_counted_at: c.prev != null ? at(15, 9) : null,
      }
    })
  }

  const ALL = [120, 80, 200]
  const B = [
    { id: 'new', g: 'Open', n: 'New', life: 'ACTIVE', editable: true, cancellable: true, lines: [{}, {}, {}] },
    { id: 'late', g: 'Open', n: 'Late', life: 'ACTIVE', due: 12, editable: true, cancellable: true, lines: [{}, {}, {}] },
    { id: 'variants', g: 'Open', n: 'Colour & size', life: 'ACTIVE', editable: true, cancellable: true, lines: [
      { v: [{ colour_code: 'WHITE', size_code: 'M', quantity: 40, base_price_minor: null }, { colour_code: 'WHITE', size_code: 'L', quantity: 40, base_price_minor: null }, { colour_code: 'NAVY', size_code: 'M', quantity: 40, base_price_minor: null }] }, {}, null] },
    { id: 'recalled', g: 'Open', n: 'Recalled by warehouse', life: 'ACTIVE', editable: true, cancellable: true, lines: [{}, {}, {}], recall: true },
    { id: 'count-match', g: 'Count waiting', n: 'Counted · matches', life: 'ACTIVE', editable: true, cancellable: true, lines: [{}, {}, {}], count: [{ i: 0, c: 120 }, { i: 1, c: 80 }, { i: 2, c: 200 }] },
    { id: 'count-short', g: 'Count waiting', n: 'Counted · short', life: 'ACTIVE', editable: true, cancellable: true, lines: [{}, {}, {}], count: [{ i: 0, c: 100 }, { i: 1, c: 80 }, { i: 2, c: 160 }] },
    { id: 'count-over', g: 'Count waiting', n: 'Counted · extra', life: 'ACTIVE', editable: true, cancellable: true, lines: [{}, {}, {}], count: [{ i: 0, c: 130 }, { i: 1, c: 80 }, { i: 2, c: 200 }] },
    { id: 'count-nao', g: 'Count waiting', n: 'Counted · not as ordered', life: 'ACTIVE', editable: true, cancellable: true, lines: [{}, {}, {}], count: [{ i: 0, c: 120, wr: 12 }, { i: 1, c: 80 }, { i: 2, c: 200 }] },
    { id: 'count-mixed', g: 'Count waiting', n: 'Counted · short + extra + NaO', life: 'ACTIVE', editable: true, cancellable: true, lines: [{}, {}, {}], count: [{ i: 0, c: 110 }, { i: 1, c: 90, wr: 6 }, { i: 2, c: 200 }] },
    { id: 'recount', g: 'Count waiting', n: 'Recounted', life: 'ACTIVE', editable: true, cancellable: true, lines: [{}, {}, {}], count: [{ i: 0, c: 120, prev: 108 }, { i: 1, c: 80 }, { i: 2, c: 196, prev: 180 }] },
    { id: 'part-count', g: 'Count waiting', n: 'Part received + count', life: 'PARTIALLY_RECEIVED', lines: [{ r: [{ q: 60 }] }, { r: [{ q: 80 }] }, { r: [{ q: 100 }] }], count: [{ i: 0, c: 50 }, { i: 2, c: 100 }] },
    { id: 'part', g: 'Partly received', n: 'Partially received', life: 'PARTIALLY_RECEIVED', lines: [{ r: [{ q: 60 }] }, { r: [{ q: 80 }] }, {}] },
    { id: 'part-late', g: 'Partly received', n: 'Partially received · late', life: 'PARTIALLY_RECEIVED', due: 11, lines: [{ r: [{ q: 60, d: 10 }] }, { r: [{ q: 40, d: 10 }] }, { r: [{ q: 100, d: 10 }] }] },
    { id: 'part-two', g: 'Partly received', n: 'Two receivings', life: 'PARTIALLY_RECEIVED', lines: [{ r: [{ q: 40, d: 12 }, { q: 50, d: 15 }] }, { r: [{ q: 80, d: 12 }] }, { r: [{ q: 120, d: 15 }] }] },
    { id: 'part-extra', g: 'Partly received', n: 'Partial + extra to return', life: 'PARTIALLY_RECEIVED', lines: [{ r: [{ q: 120, ex: 15 }] }, { r: [{ q: 50 }] }, {}] },
    { id: 'full', g: 'Done', n: 'Fully received', life: 'FULLY_RECEIVED', lines: [{ r: [{ q: 120 }] }, { r: [{ q: 80 }] }, { r: [{ q: 200 }] }] },
    { id: 'full-extra', g: 'Done', n: 'Full + extra (to return)', life: 'FULLY_RECEIVED', lines: [{ r: [{ q: 120, ex: 30 }] }, { r: [{ q: 80 }] }, { r: [{ q: 200 }] }] },
    { id: 'full-nao', g: 'Done', n: 'Full + not as ordered', life: 'FULLY_RECEIVED', lines: [{ r: [{ q: 120, wr: 12 }] }, { r: [{ q: 80 }] }, { r: [{ q: 200 }] }] },
    { id: 'full-both', g: 'Done', n: 'Full + extra + NaO', life: 'FULLY_RECEIVED', lines: [{ r: [{ q: 120, ex: 20 }] }, { r: [{ q: 80, wr: 8 }] }, { r: [{ q: 200 }] }] },
    { id: 'ret-raised', g: 'Return PO', n: 'Return raised', life: 'FULLY_RECEIVED', lines: [{ r: [{ q: 120, ex: 30 }], returned: true }, { r: [{ q: 80, wr: 8 }], returned: true }, { r: [{ q: 200 }] }], returns: [{ status: 'OPEN', lines: [{ i: 0, q: 30 }, { i: 1, q: 8, wr: 8 }] }] },
    { id: 'ret-note', g: 'Return PO', n: 'Return note printed', life: 'FULLY_RECEIVED', lines: [{ r: [{ q: 120, ex: 30 }], returned: true }, { r: [{ q: 80 }] }, { r: [{ q: 200 }] }], returns: [{ status: 'OPEN', note: true, lines: [{ i: 0, q: 30 }] }] },
    { id: 'ret-done', g: 'Return PO', n: 'Returned', life: 'FULLY_RECEIVED', lines: [{ r: [{ q: 120, ex: 30 }], returned: true }, { r: [{ q: 80 }] }, { r: [{ q: 200 }] }], returns: [{ status: 'HANDED_OVER', note: true, lines: [{ i: 0, q: 30 }] }] },
    { id: 'short', g: 'Done', n: 'Closed short', life: 'SHORT_RECEIVED', lines: [{ r: [{ q: 100 }], cs: 20 }, { r: [{ q: 80 }] }, { r: [{ q: 160 }], cs: 40 }] },
    { id: 'cancelled', g: 'Done', n: 'Cancelled', life: 'CANCELLED', lines: [{}, {}, {}] },
    { id: 'rc-kodi', g: 'Review Count', n: 'Counted in kodi', rc: true, life: 'ACTIVE', editable: true, cancellable: true, lines: [{}, {}, {}], count: [{ i: 0, c: 120 }, { i: 1, c: 80 }, { i: 2, c: 190, kodi: true }] },
    { id: 'rc-variants', g: 'Review Count', n: 'Counted per colour & size', rc: true, life: 'ACTIVE', editable: true, cancellable: true, lines: [{ v: [{ colour_code: 'WHITE', size_code: 'M', quantity: 40, base_price_minor: null }, { colour_code: 'WHITE', size_code: 'L', quantity: 40, base_price_minor: null }, { colour_code: 'NAVY', size_code: 'M', quantity: 40, base_price_minor: null }] }, {}, null], count: [{ i: 0, c: 118, v: [['WHITE', 'M', 40, 38], ['WHITE', 'L', 40, 40], ['NAVY', 'M', 40, 40]] }, { i: 1, c: 80 }] },
    { id: 'rc-one', g: 'Review Count', n: 'One line counted', rc: true, life: 'ACTIVE', editable: true, cancellable: true, lines: [{}, {}, {}], count: [{ i: 1, c: 80 }] },
    { id: 'rc-part-over', g: 'Review Count', n: 'Part received + extra', rc: true, life: 'PARTIALLY_RECEIVED', lines: [{ r: [{ q: 60 }] }, { r: [{ q: 40 }] }, {}], count: [{ i: 0, c: 70 }, { i: 1, c: 40 }, { i: 2, c: 200 }] },
    { id: 'rc-part-nao', g: 'Review Count', n: 'Part received + short + NaO', rc: true, life: 'PARTIALLY_RECEIVED', lines: [{ r: [{ q: 60 }] }, { r: [{ q: 40 }, { q: 20, d: 15 }] }, {}], count: [{ i: 0, c: 60, wr: 10 }, { i: 1, c: 15 }, { i: 2, c: 180 }] },
    { id: 'rc-recount-short', g: 'Review Count', n: 'Recounted · still short', rc: true, life: 'ACTIVE', editable: true, cancellable: true, lines: [{}, {}, {}], count: [{ i: 0, c: 112, prev: 100 }, { i: 1, c: 80 }, { i: 2, c: 170, prev: 160 }] },
  ]
  void ALL
  const orders = {}, byPo = {}, countRows = [], recounts = []
  B.forEach((b, k) => {
    const s = k + 1
    const o = order(s, b)
    b.oid = o.purchase_order_id
    b.po = o.po_number
    orders[o.purchase_order_id] = o
    byPo[o.po_number] = o
    countRows.push(...counts(s, o, b))
    if (b.recall) recounts.push({ po_number: o.po_number, reason: 'Count again', recalled_by: 'dimas', recalled_at: at(16, 9), was: 380 })
  })
  const rowOf = (o) => ({
    purchase_order_id: o.purchase_order_id, po_number: o.po_number, supplier_id: o.supplier_id, supplier_name: o.supplier_name,
    destination_site_id: o.destination_site_id, lifecycle: o.lifecycle, order_status: o.order_status, currency: 'IDR',
    issued_at: o.issued_at, expected_arrival: o.expected_arrival, line_count: o.lines.length, gross_minor: o.gross_minor,
    discount_minor: o.discount_minor, net_minor: o.net_minor, expected_stock_units: o.lines.reduce((t, l) => t + l.ordered_quantity, 0),
    ordered_label: null, received_stock_units: o.lines.reduce((t, l) => t + l.received_quantity, 0),
    outstanding_stock_units: o.lines.reduce((t, l) => t + l.outstanding_stock_units, 0), invoiced_stock_units: 0,
    excess_stock_units: o.lines.reduce((t, l) => t + l.excess_quantity, 0), excess_pending_stock_units: o.lines.reduce((t, l) => t + l.excess_pending_quantity, 0),
    fully_received: o.fully_received, received_value_minor: 0, fulfilled_at: null, updated_at: o.created_at, overdue: false,
  })
  window.__PO_BRANCHES = B

  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  const real = window.__realFetch ?? window.fetch.bind(window)
  window.__realFetch = real
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.origin)
    const p = url.pathname
    const m = p.match(/^\/api\/v1\/purchase-orders\/([0-9a-f-]{36})$/)
    if (m && orders[m[1]]) return json(orders[m[1]])
    if (p === '/api/v1/purchase-orders' && url.searchParams.get('q') && byPo[url.searchParams.get('q')]) {
      return json({ rows: [rowOf(byPo[url.searchParams.get('q')])], next_cursor: null, total: 1, facets: { order_status: [], supplier: [] } })
    }
    if (p === '/edge/api/v1/dc/purchase-counts') return json({ items: countRows })
    if (p === '/edge/api/v1/dc/purchase-orders/summary') {
      const r = await real(input, init)
      const body = await r.json().catch(() => ({}))
      return json({ ...body, recounts: [...(body.recounts ?? []), ...recounts] })
    }
    return real(input, init)
  }
  return B.map((b) => `${b.id} ${b.oid} ${b.po}`).join('\n')
})()
