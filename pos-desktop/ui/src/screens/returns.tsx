import { useEffect, useMemo, useRef, useState } from "react"

import * as api from "@/api"
import { Topbar } from "@/till"
import { readScan } from "@epc"
import { money } from "@itulah/contract/money"

/// Undoing a sale, the two ways a shop is allowed to.
///
/// Two screens rather than one screen with a switch, because they are two
/// different admissions and the cashier has to have chosen which one they are
/// making before they start. A **retur** accepts that the sale happened: the
/// garments come home one tag at a time, and every tag has to be told where it
/// goes. A **void** says the sale should not have happened at all — the whole
/// basket in one movement, with nothing to disposition, because nothing about
/// the garments was ever in question.
///
/// # What both of them ask for, and why
///
/// **A supervisor, typed at the moment.** `verify_supervisor` in
/// `backend/src/edge/till.rs` is a step-up and not a session: the cashier stays
/// signed in, a second person is checked against `edge_user`, and their name is
/// written onto the row that needed them. Nothing is issued back, so there is
/// nothing here to keep — and this screen keeps nothing. The two fields are
/// uncontrolled, read once on the way into the request body, and wiped the
/// moment the node has answered, refusal or not.
///
/// **One key per attempt.** The node files an idempotency key together with the
/// request it arrived with. Pressing again after a refusal that never reached
/// the node has to send the *same* key, or a retry of a call that did land
/// becomes a second refund. Change what is being asked — a tag, a disposition,
/// the method, the reason — and it is a different attempt, so it gets a new key.
///
/// **The node's own words when it refuses.** It knows why it said no, and a
/// sentence invented here could only ever disagree with it — while the cashier
/// is about to repeat that sentence to somebody standing in front of them.

// ── what the node actually accepts ──────────────────────────────────────

/// Where a returned garment goes.
///
/// These two are the whole list: `return_sale` in `backend/src/edge/sqlite.rs`
/// uppercases what it is sent and refuses anything else by name, and the two
/// steer the movement into two different pools — `StoreFloor` and
/// `StoreReject`. `ReturnLineRequest` defaults a missing one to `RESALEABLE`,
/// which is right for a wire format that still has to read a message from an
/// older till and wrong for a screen. So nothing here is pre-selected. A
/// stained shirt the till decided about on the cashier's behalf goes back on
/// the rail, and the shop sells the same damage twice.
const DISPOSITIONS = [
  {
    value: "RESALEABLE",
    label: "Layak jual",
    detail: "Kembali ke lantai jual dan boleh dijual lagi",
  },
  {
    value: "DAMAGED",
    label: "Rusak",
    detail: "Masuk pool reject, tidak kembali ke rak",
  },
] as const

/// How the money goes back.
///
/// The node checks this with `PaymentMethod::from_str`, which knows five, and
/// all five are offered here — including `OTHER`, which the counter itself does
/// not take. A refund that was neither cash nor a reversal has to be able to
/// say so: the shift report buckets `refund_method='CASH'` against the drawer,
/// so a transfer booked as cash is a drawer that comes up short at close with
/// nobody able to say why.
///
/// Nothing is pre-selected here either, and the sale's own tenders are shown
/// beside it rather than copied into it. `ReturnRequest` says why in as many
/// words: a card sale refunded in cash happens every day.
const REFUNDS = [
  { value: "CASH", label: "Tunai" },
  { value: "CARD", label: "Kartu" },
  { value: "QRIS", label: "QRIS" },
  { value: "VOUCHER", label: "Voucher" },
  { value: "OTHER", label: "Lainnya" },
] as const

/// The number printed on the paper is not the id this endpoint wants.
///
/// `receipt_no` is `SITE-YYYYMMDD-XXXXXX` — the site, the day and the last six
/// of the sale id, derived rather than allocated — while
/// `GET /store/sales/{id}/receipt` looks a sale up by its full id, and nothing
/// on the wire turns one into the other. A cashier holding only the receipt has
/// to find the sale another way, and being told that here is worth more than a
/// refusal that says "sale S01-20260913-A1B2C3 not found".
const RECEIPT_NUMBER = /^[A-Za-z0-9]+-\d{8}-[A-Za-z0-9]{1,8}$/

// ── reading what the node sent back ─────────────────────────────────────

/// `receipt()` answers a map, so it is read as one.
///
/// The wrappers in `api.ts` declare the shapes this terminal relies on, and the
/// receipt is deliberately not one of them — casting an unchecked body into a
/// generated struct would be asserting a shape nobody looked at. These four
/// read a field if it is there and say null if it is not, which is also what
/// happens when the node answered with something that is not a receipt at all.
const asMap = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const asText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null

const asCount = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null

const asList = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value : []

/// One line of goods, as the receipt document has it.
///
/// Note what is missing: **no EPC**. `ReceiptLine` carries a name, a SKU and
/// money, and the tag is not on it — so these lines say what was sold, and
/// they cannot say which garment on the counter is which. That single fact is
/// why a return below is scanned rather than ticked.
type SaleLine = {
  readonly name: string
  readonly skuCode: string
  readonly quantity: number
  readonly lineTotalMinor: number | null
}

type SaleTender = {
  readonly method: string
  readonly amountMinor: number | null
}

/// One sale, as the node describes it. Money is in minor units and the document
/// carries no currency code of its own — this node prints Rupiah, which is what
/// `money` defaults to.
type Sale = {
  readonly saleId: string
  readonly receiptNo: string | null
  readonly when: string | null
  readonly cashier: string | null
  readonly totalMinor: number | null
  /// `** BATAL **` or `** RETUR **`, set by the node when this sale has already
  /// been undone once. Printed on the reprint, and shown here for the same
  /// reason: a second return against the same basket is refused unit by unit,
  /// and the cashier should see it coming.
  readonly stamp: string | null
  readonly lines: readonly SaleLine[]
  readonly tenders: readonly SaleTender[]
}

function readSale(body: unknown): Sale | null {
  const doc = asMap(body)
  if (doc === null) return null
  const saleId = asText(doc.sale_id)
  if (saleId === null) return null

  const lines: SaleLine[] = []
  for (const row of asList(doc.lines)) {
    const line = asMap(row)
    if (line === null) continue
    const skuCode = asText(line.sku_code)
    if (skuCode === null) continue
    lines.push({
      name: asText(line.name) ?? skuCode,
      skuCode,
      quantity: asCount(line.quantity) ?? 1,
      lineTotalMinor: asCount(line.line_total_minor),
    })
  }

  const tenders: SaleTender[] = []
  for (const row of asList(doc.tenders)) {
    const tender = asMap(row)
    if (tender === null) continue
    const method = asText(tender.method)
    if (method === null) continue
    tenders.push({ method, amountMinor: asCount(tender.amount_minor) })
  }

  return {
    saleId,
    receiptNo: asText(doc.receipt_no),
    when: asText(doc.completed_at),
    cashier: asText(doc.cashier),
    totalMinor: asCount(doc.total_minor),
    stamp: asText(doc.stamp),
    lines,
    tenders,
  }
}

/// What the node said, or the plain fact that it said nothing.
///
/// Never a sentence this file made up to fill the space: the cashier is about
/// to be asked why, and "silakan coba lagi" is not a reason.
function refusal(reply: api.EdgeReply<unknown>): string {
  return (
    reply.problem ??
    `Node toko menolak dengan status ${reply.status} dan tidak menyebut alasannya.`
  )
}

function methodLabel(value: string | null): string {
  return REFUNDS.find((one) => one.value === value)?.label ?? (value ?? "—")
}

// ── the supervisor ──────────────────────────────────────────────────────

/// The supervisor's credentials, for exactly as long as one request takes.
///
/// Uncontrolled on purpose. `useState` would put a password in the fibre tree,
/// in every closure that render made and in any devtools snapshot taken while
/// it sat there; a ref reaches into the field it was typed in, reads it once on
/// the way to the node, and wipes it as soon as the node answers. It is never
/// logged, and the object built for the body dies with the call that sent it.
///
/// The price of that is that the screen cannot watch these two fields — a
/// button that greyed out until the password was filled would be a button that
/// knew what was in it. So they are checked on the press instead, and a blank
/// one is refused here rather than spent on a call.
function useSupervisor() {
  const username = useRef<HTMLInputElement>(null)
  const password = useRef<HTMLInputElement>(null)

  function read(): api.Supervisor | null {
    const who = username.current?.value.trim() ?? ""
    // Not trimmed: a password's spaces are the password's business.
    const secret = password.current?.value ?? ""
    if (who === "" || secret === "") return null
    return { username: who, password: secret }
  }

  function wipe() {
    if (username.current !== null) username.current.value = ""
    if (password.current !== null) password.current.value = ""
  }

  return { username, password, read, wipe }
}

type Supervision = ReturnType<typeof useSupervisor>

function Authorisation({ hold }: { hold: Supervision }) {
  return (
    <>
      <span className="label">Otorisasi supervisor</span>
      <div className="notice">
        Supervisor mengetik sendiri di sini, dengan kasir tetap masuk. Terminal
        tidak menyimpan apa pun: begitu node menjawab, kedua kolom dikosongkan.
      </div>
      <label className="field">
        Nama pengguna supervisor
        <input
          ref={hold.username}
          autoComplete="off"
          spellCheck={false}
          placeholder="Nama pengguna di node toko"
        />
      </label>
      <label className="field">
        Kata sandi supervisor
        <input ref={hold.password} type="password" autoComplete="off" />
      </label>
    </>
  )
}

// ── finding the sale ────────────────────────────────────────────────────

/// The one lookup both screens start with.
///
/// Kept together because both of them fail in the same three ways — a receipt
/// number typed in place of an id, a node that refuses, and an answer that is
/// not a receipt — and a cashier should get the same sentence for the same
/// mistake on either screen.
function useSaleLookup() {
  const [typed, setTyped] = useState("")
  const [sale, setSale] = useState<Sale | null>(null)
  const [looking, setLooking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function find(): Promise<void> {
    const wanted = typed.trim()
    if (wanted === "") return
    if (RECEIPT_NUMBER.test(wanted)) {
      setTrouble(
        "Itu nomor struk, bukan ID penjualan. Node mencari dengan ID penuh — " +
          "ambil dari layar penjualan yang bersangkutan.",
      )
      return
    }
    setLooking(true)
    setTrouble(null)
    const reply = await api.receipt(wanted)
    setLooking(false)
    if (!reply.ok) {
      // The old sale goes too. A refusal on screen with somebody else's basket
      // still drawn under it is how the wrong sale gets returned against.
      setSale(null)
      setTrouble(refusal(reply))
      return
    }
    const read = readSale(reply.body)
    if (read === null) {
      setSale(null)
      setTrouble(
        "Node menjawab, tapi isinya bukan struk penjualan. Periksa ID-nya.",
      )
      return
    }
    setSale(read)
  }

  return { typed, setTyped, sale, looking, trouble, find }
}

function SaleFinder({
  hold,
  hint,
}: {
  hold: ReturnType<typeof useSaleLookup>
  hint: string
}) {
  return (
    <form
      className="rows"
      onSubmit={(event) => {
        event.preventDefault()
        void hold.find()
      }}
    >
      <label className="field">
        ID penjualan
        <input
          value={hold.typed}
          onChange={(event) => hold.setTyped(event.target.value)}
          placeholder="Tempel ID penjualan…"
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />
      </label>
      <p className="muted">{hint}</p>
      <button className="btn" type="submit" disabled={hold.looking}>
        {hold.looking ? "Mencari…" : "Buka penjualan"}
      </button>
    </form>
  )
}

/// What the sale was. Read-only on both screens, and read from the node rather
/// than from anything this terminal remembers: the receipt is the truth about
/// what happened, and these two screens exist to argue with it.
function SaleSummary({ sale }: { sale: Sale }) {
  return (
    <>
      <span className="label">Penjualan</span>
      {sale.stamp !== null && (
        <div className="notice warn">
          Struk ini sudah bertanda <strong>{sale.stamp}</strong> — sebagian atau
          seluruh isinya pernah kembali. Node menolak unit yang sama dua kali.
        </div>
      )}
      <div>
        <div className="kv">
          <span className="muted">Nomor struk</span>
          <strong className="num">{sale.receiptNo ?? "—"}</strong>
        </div>
        <div className="kv">
          <span className="muted">Waktu</span>
          <span className="num">{sale.when ?? "—"}</span>
        </div>
        <div className="kv">
          <span className="muted">Kasir</span>
          <span>{sale.cashier ?? "—"}</span>
        </div>
        <div className="kv">
          <span className="muted">Dibayar dengan</span>
          <span>
            {sale.tenders.length === 0
              ? "—"
              : sale.tenders
                  .map(
                    (one) =>
                      `${methodLabel(one.method)}${
                        one.amountMinor === null
                          ? ""
                          : ` ${money(one.amountMinor)}`
                      }`,
                  )
                  .join(" · ")}
          </span>
        </div>
        <div className="kv">
          <span className="muted">Total</span>
          <strong className="num">
            {sale.totalMinor === null ? "—" : money(sale.totalMinor)}
          </strong>
        </div>
      </div>
      <div className="receipt-lines">
        {sale.lines.map((line, at) => (
          <div className="receipt-line" key={`${line.skuCode}-${at}`}>
            <span>
              {line.name} <small className="num muted">{line.skuCode}</small>
            </span>
            <strong className="num">
              {line.lineTotalMinor === null ? "—" : money(line.lineTotalMinor)}
            </strong>
          </div>
        ))}
      </div>
    </>
  )
}

// ── retur ───────────────────────────────────────────────────────────────

/// A tag the customer has put back on the counter.
type Coming = {
  readonly epc: string
  readonly skuCode: string
  /// Off the receipt, when this SKU is on it: a name to read and what that line
  /// was charged. Both are for the cashier's eyes only. `record_return` refunds
  /// `charged_minor` from the sale line it finds itself, so this screen never
  /// sends a figure at all — and by SKU it cannot tell two units of one shirt
  /// apart anyway.
  readonly name: string | null
  readonly chargedMinor: number | null
  readonly onReceipt: boolean
  /// Chosen, never defaulted. Null until somebody says where the garment goes.
  readonly disposition: string | null
}

/// What the node wrote down.
type Refunded = {
  readonly refundMinor: number | null
  readonly method: string | null
  readonly approvedBy: string | null
  readonly remaining: number | null
}

export function ReturnScreen({
  actorId,
  onBack,
}: {
  actorId: string
  onBack: () => void
}) {
  const lookup = useSaleLookup()
  const supervisor = useSupervisor()
  const [coming, setComing] = useState<readonly Coming[]>([])
  const [reason, setReason] = useState("")
  const [method, setMethod] = useState<string | null>(null)
  const [reference, setReference] = useState("")
  const [busy, setBusy] = useState(false)
  // Two places to be wrong, kept apart. A tag that would not read is answered
  // beside the tag field; a node that refused the whole return is answered
  // beside the button that sent it. One slot for both would put the sentence
  // half a screen from what caused it.
  const [scanNote, setScanNote] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState<Refunded | null>(null)
  const scan = useRef<HTMLInputElement>(null)

  const sale = lookup.sale
  const openSale = sale?.saleId ?? null

  // Tags scanned against the previous sale are not evidence about this one, so
  // opening a different sale empties the list instead of carrying it over into
  // a return the node would refuse EPC by EPC.
  useEffect(() => {
    setComing([])
    setScanNote(null)
    setProblem(null)
  }, [openSale])

  // The key belongs to the attempt, not to the press: see the file's head.
  // `shape` is everything the node would file the key against except who
  // authorised it, which this screen deliberately cannot see.
  const attempt = useRef<string | null>(null)
  const shape = JSON.stringify([
    sale?.saleId ?? null,
    coming.map((one) => [one.epc, one.disposition]),
    method,
    reference.trim(),
    reason.trim(),
  ])
  useEffect(() => {
    attempt.current = null
  }, [shape])

  // The tag field is where the next thing happens once a sale is open, and a
  // cashier holding a garment in one hand should not have to find it.
  useEffect(() => {
    if (sale !== null && done === null) scan.current?.focus()
  }, [sale, done])

  /// More tags of one SKU than that SKU was sold on this receipt.
  ///
  /// The node refuses the extra one — it matches every EPC against the sale's
  /// own lines — but it refuses *after* a supervisor has typed a password, and
  /// this much is knowable before that.
  const overscanned = useMemo(() => {
    if (sale === null) return [] as readonly string[]
    const sold = new Map<string, number>()
    for (const line of sale.lines) {
      sold.set(
        line.skuCode,
        (sold.get(line.skuCode) ?? 0) + Math.max(1, line.quantity),
      )
    }
    const seen = new Map<string, number>()
    const over: string[] = []
    for (const one of coming) {
      const many = (seen.get(one.skuCode) ?? 0) + 1
      seen.set(one.skuCode, many)
      if (many > (sold.get(one.skuCode) ?? 0) && !over.includes(one.skuCode)) {
        over.push(one.skuCode)
      }
    }
    return over as readonly string[]
  }, [sale, coming])

  const undecided = coming.filter((one) => one.disposition === null).length
  const ready =
    sale !== null &&
    coming.length > 0 &&
    undecided === 0 &&
    reason.trim() !== "" &&
    method !== null

  function onTag(raw: string) {
    const typed = raw.trim()
    if (typed === "") return
    const scanned = readScan(typed)
    // A barcode names a product, not a garment. The shop has forty of that
    // shirt and this says nothing about which one came home — and `lines` on
    // the wire is a list of EPCs, so there is no field for it either.
    if (scanned.kind !== "epc") {
      setScanNote(
        scanned.kind === "sku"
          ? "Itu kode produk, bukan barang yang mana. Retur dicatat per tag — pindai tag RFID di garmennya."
          : `“${typed}” bukan tag yang dikenali terminal ini.`,
      )
      return
    }
    if (coming.some((one) => one.epc === scanned.epc)) {
      setScanNote("Tag itu sudah ada di daftar. Satu tag adalah satu barang.")
      return
    }
    const line =
      sale?.lines.find((one) => one.skuCode === scanned.sku_code) ?? null
    setComing((held) => [
      ...held,
      {
        epc: scanned.epc,
        skuCode: scanned.sku_code,
        name: line?.name ?? null,
        chargedMinor: line?.lineTotalMinor ?? null,
        onReceipt: line !== null,
        disposition: null,
      },
    ])
    setScanNote(null)
  }

  async function send() {
    if (sale === null || method === null) return
    const lines: api.ReturnLine[] = []
    for (const one of coming) {
      if (one.disposition === null) {
        setProblem(
          "Masih ada tag tanpa tujuan. Retur tidak dikirim setengah jadi.",
        )
        return
      }
      lines.push({ epc: one.epc, disposition: one.disposition })
    }
    const trimmed = reference.trim()
    // `screen_reference` guards a *sale* tender against this and never sees
    // `refund_reference`, so the till is the only thing standing in front of
    // it. A card number that reaches a database is a card number somebody has
    // to erase from the backups afterwards.
    if (trimmed.replace(/\D/g, "").length >= 12) {
      setProblem(
        "Referensi itu menyerupai nomor kartu. Tulis kode approval atau nama acquirer, bukan nomor instrumennya.",
      )
      return
    }
    // Read last, and only once everything this screen could refuse on its own
    // has already passed: a password is not touched to be told the form is
    // incomplete.
    const authorisation = supervisor.read()
    if (authorisation === null) {
      setProblem(
        "Nama pengguna dan kata sandi supervisor harus diisi — node yang memeriksanya, bukan terminal ini.",
      )
      return
    }
    attempt.current ??= crypto.randomUUID()

    setBusy(true)
    setProblem(null)
    const reply = await api.returnSale({
      sale_id: sale.saleId,
      lines,
      refund_method: method,
      refund_reference: trimmed === "" ? null : trimmed,
      reason: reason.trim(),
      supervisor: authorisation,
      actor_id: actorId,
      idempotency_key: attempt.current,
    })
    // The moment the node has answered, either way. A refusal is the case
    // where a password is most likely to be left sitting in a field while
    // somebody reads the reason out loud.
    supervisor.wipe()
    setBusy(false)
    if (!reply.ok) {
      setProblem(refusal(reply))
      return
    }
    const body = asMap(reply.body) ?? {}
    setDone({
      refundMinor: asCount(body.refund_minor),
      method: asText(body.refund_method),
      approvedBy: asText(body.approved_by),
      remaining: asCount(body.remaining_lines),
    })
  }

  if (done !== null) {
    return (
      <div id="app" data-screen="sale">
        <Topbar actorId={actorId} />
        <div className="page">
          <div className="page-inner">
            <div className="page-head">
              <div>
                <span className="label">Retur tercatat</span>
                <h1 className="num">
                  {done.refundMinor === null ? "—" : money(done.refundMinor)}
                </h1>
                <p>
                  Angka ini milik node: yang dikembalikan adalah yang tercatat
                  pada baris penjualannya, bukan hitungan layar ini.
                </p>
              </div>
              <button className="btn primary" onClick={onBack}>
                Selesai
              </button>
            </div>
            <div>
              <div className="kv">
                <span className="muted">Disetujui oleh</span>
                <strong>{done.approvedBy ?? "—"}</strong>
              </div>
              <div className="kv">
                <span className="muted">Uang kembali lewat</span>
                <span>{methodLabel(done.method)}</span>
              </div>
              <div className="kv">
                <span className="muted">Masih di tangan pelanggan</span>
                <span className="num">
                  {done.remaining === null ? "—" : `${done.remaining} unit`}
                </span>
              </div>
            </div>
            {done.remaining === 0 && (
              <div className="notice">
                Seluruh keranjang sudah kembali. Penjualannya sendiri tetap ada
                dan tidak menjadi void — void adalah penjualan yang seharusnya
                tidak pernah terjadi.
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div id="app" data-screen="sale">
      <Topbar actorId={actorId} />
      <div className="page">
        <div className="page-inner">
          <div className="page-head">
            <div>
              <span className="label">Retur</span>
              <h1>Barang kembali</h1>
              <p>
                Penjualannya tetap berlaku. Yang kembali dipindai satu per satu,
                dan setiap tag harus diberi tujuan sebelum retur dikirim.
              </p>
            </div>
            <button className="btn ghost" onClick={onBack}>
              ← Konter
            </button>
          </div>

          <div className="steps">
            <span className={sale === null ? "active" : undefined}>
              1 · Cari penjualan
            </span>
            <span
              className={
                sale !== null && coming.length === 0 ? "active" : undefined
              }
            >
              2 · Pindai tag yang kembali
            </span>
            <span
              className={
                coming.length > 0 && !ready ? "active" : undefined
              }
            >
              3 · Tujuan, alasan, cara kembali
            </span>
            <span className={ready ? "active" : undefined}>
              4 · Otorisasi supervisor
            </span>
          </div>

          <SaleFinder
            hold={lookup}
            hint="ID penjualan, bukan nomor struk. Nomor di kertas hanya memuat enam karakter terakhirnya, dan node mencari dengan ID penuh."
          />
          {lookup.trouble !== null && <p className="error">{lookup.trouble}</p>}

          {sale === null ? (
            <div className="empty">
              <h3>Belum ada penjualan dibuka</h3>
              <p>
                Retur selalu melawan satu penjualan: node menolak tag yang tidak
                pernah terjual di struk itu.
              </p>
            </div>
          ) : (
            <>
              <div className="divider" />
              <SaleSummary sale={sale} />

              <div className="divider" />
              <span className="label">Barang yang kembali</span>
              <div className="notice">
                Struk tidak menyebut tag: barisnya hanya nama, SKU dan uang.
                Jadi barang mana yang pulang ditentukan oleh tag yang dipindai
                di sini, bukan oleh baris struk di atas.
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  const field = scan.current
                  if (field === null) return
                  onTag(field.value)
                  field.value = ""
                }}
              >
                <label className="field">
                  Pindai tag yang kembali
                  <input
                    ref={scan}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="Dekatkan tag RFID, atau ketik EPC-nya…"
                  />
                </label>
              </form>
              {scanNote !== null && <p className="error">{scanNote}</p>}

              {coming.length === 0 ? (
                <div className="empty">
                  <h3>Belum ada tag dipindai</h3>
                  <p>Satu tag adalah satu garmen yang pulang.</p>
                </div>
              ) : (
                <div className="rows">
                  {coming.map((one) => (
                    <div className="row-item" key={one.epc}>
                      <div className="grow">
                        <h3>{one.name ?? one.skuCode}</h3>
                        <p className="num">
                          {one.skuCode} · …{one.epc.slice(-8)}
                        </p>
                        <div className="chips">
                          {DISPOSITIONS.map((where) => (
                            <button
                              key={where.value}
                              className={
                                one.disposition === where.value
                                  ? "chip on"
                                  : "chip"
                              }
                              title={where.detail}
                              onClick={() =>
                                setComing((held) =>
                                  held.map((item) =>
                                    item.epc === one.epc
                                      ? { ...item, disposition: where.value }
                                      : item,
                                  ),
                                )
                              }
                            >
                              {where.label}
                            </button>
                          ))}
                          {one.disposition === null && (
                            <span className="badge warn">
                              Tujuan belum dipilih
                            </span>
                          )}
                          {!one.onReceipt && (
                            <span className="badge bad">
                              SKU tidak ada di struk ini
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="num">
                        {one.chargedMinor === null
                          ? "—"
                          : money(one.chargedMinor)}
                      </span>
                      <button
                        className="btn ghost"
                        onClick={() =>
                          setComing((held) =>
                            held.filter((item) => item.epc !== one.epc),
                          )
                        }
                      >
                        Lepas
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {undecided > 0 && (
                <div className="notice warn">
                  {undecided} tag belum diberi tujuan. Tidak ada yang dipilihkan
                  di sini: barang rusak yang diam-diam kembali ke lantai jual
                  adalah barang yang dijual dua kali.
                </div>
              )}
              {overscanned.length > 0 && (
                <div className="notice warn">
                  Tag untuk {overscanned.join(", ")} lebih banyak daripada yang
                  terjual di struk ini. Node akan menolak kelebihannya.
                </div>
              )}

              <div className="divider" />
              <label className="field">
                Alasan retur
                <input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Misalnya: ukuran tidak pas"
                  autoComplete="off"
                />
              </label>

              <span className="label">Uang kembali lewat</span>
              <div className="chips">
                {REFUNDS.map((one) => (
                  <button
                    key={one.value}
                    className={method === one.value ? "chip on" : "chip"}
                    onClick={() => setMethod(one.value)}
                  >
                    {one.label}
                  </button>
                ))}
              </div>
              <p className="muted">
                Tidak diambil dari cara bayarnya dulu — penjualan kartu yang
                dikembalikan tunai terjadi setiap hari.
              </p>

              {method !== null && method !== "CASH" && (
                <label className="field">
                  Referensi pengembalian (boleh kosong)
                  <input
                    value={reference}
                    onChange={(event) => setReference(event.target.value)}
                    placeholder="Misalnya: BCA · approval 8842"
                    autoComplete="off"
                  />
                </label>
              )}

              <div className="divider" />
              <Authorisation hold={supervisor} />

              {problem !== null && <p className="error">{problem}</p>}
              <button
                className="btn primary"
                disabled={busy || !ready}
                onClick={() => void send()}
              >
                {busy ? "Mengirim ke node…" : "Catat retur"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── void ────────────────────────────────────────────────────────────────

type Voided = {
  readonly refundMinor: number | null
  readonly approvedBy: string | null
  readonly voidedAt: string | null
  readonly units: number
}

export function VoidScreen({
  actorId,
  onBack,
}: {
  actorId: string
  onBack: () => void
}) {
  const lookup = useSaleLookup()
  const supervisor = useSupervisor()
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState<Voided | null>(null)

  const sale = lookup.sale

  // One key per attempt, thrown away when the attempt changes. A void has only
  // two things to change: which sale, and why.
  const attempt = useRef<string | null>(null)
  const shape = JSON.stringify([sale?.saleId ?? null, reason.trim()])
  useEffect(() => {
    attempt.current = null
  }, [shape])

  const ready = sale !== null && reason.trim() !== ""

  async function send() {
    if (sale === null) return
    const authorisation = supervisor.read()
    if (authorisation === null) {
      setProblem(
        "Nama pengguna dan kata sandi supervisor harus diisi — node yang memeriksanya, bukan terminal ini.",
      )
      return
    }
    attempt.current ??= crypto.randomUUID()

    setBusy(true)
    setProblem(null)
    const reply = await api.voidSale(sale.saleId, {
      reason: reason.trim(),
      supervisor: authorisation,
      actor_id: actorId,
      idempotency_key: attempt.current,
    })
    // Wiped the moment the node has answered, refusal included.
    supervisor.wipe()
    setBusy(false)
    if (!reply.ok) {
      setProblem(refusal(reply))
      return
    }
    const body = asMap(reply.body) ?? {}
    setDone({
      refundMinor: asCount(body.refund_minor),
      approvedBy: asText(body.approved_by),
      voidedAt: asText(body.voided_at),
      units: asList(body.lines).length,
    })
  }

  if (done !== null) {
    return (
      <div id="app" data-screen="sale">
        <Topbar actorId={actorId} />
        <div className="page">
          <div className="page-inner">
            <div className="page-head">
              <div>
                <span className="label">Penjualan dibatalkan</span>
                <h1 className="num">
                  {done.refundMinor === null ? "—" : money(done.refundMinor)}
                </h1>
                <p>
                  Seluruh isinya kembali ke lantai jual dalam satu gerakan, dan
                  penjualannya berstatus VOIDED di node.
                </p>
              </div>
              <button className="btn primary" onClick={onBack}>
                Selesai
              </button>
            </div>
            <div>
              <div className="kv">
                <span className="muted">Disetujui oleh</span>
                <strong>{done.approvedBy ?? "—"}</strong>
              </div>
              <div className="kv">
                <span className="muted">Waktu</span>
                <span className="num">{done.voidedAt ?? "—"}</span>
              </div>
              <div className="kv">
                <span className="muted">Unit yang pulang</span>
                <span className="num">{done.units} unit</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div id="app" data-screen="sale">
      <Topbar actorId={actorId} />
      <div className="page">
        <div className="page-inner">
          <div className="page-head">
            <div>
              <span className="label">Void</span>
              <h1>Penjualan dibatalkan seluruhnya</h1>
              <p>
                Void bukan retur. Void berarti penjualan ini seharusnya tidak
                pernah terjadi.
              </p>
            </div>
            <button className="btn ghost" onClick={onBack}>
              ← Konter
            </button>
          </div>

          <div className="notice warn">
            <strong>Bedanya dengan retur.</strong> Retur mengakui penjualan yang
            memang terjadi: barangnya dipindai satu per satu dan tiap tag diberi
            tujuan. Void menghapus seluruh penjualannya — salah tekan, salah
            pelanggan, transaksi latihan — seluruh isi keranjang kembali ke
            lantai jual dalam satu gerakan dan seluruh uangnya keluar. Tidak ada
            tujuan yang dipilih di sini, karena tidak ada yang pernah
            dipertanyakan tentang barangnya. Kalau barangnya memang dibeli lalu
            dikembalikan, yang benar adalah retur.
          </div>

          <div className="steps">
            <span className={sale === null ? "active" : undefined}>
              1 · Cari penjualan
            </span>
            <span className={sale !== null && !ready ? "active" : undefined}>
              2 · Alasan pembatalan
            </span>
            <span className={ready ? "active" : undefined}>
              3 · Otorisasi supervisor
            </span>
          </div>

          <SaleFinder
            hold={lookup}
            hint="ID penjualan, bukan nomor struk. Node hanya bisa membatalkan penjualan yang masih berstatus selesai."
          />
          {lookup.trouble !== null && <p className="error">{lookup.trouble}</p>}

          {sale === null ? (
            <div className="empty">
              <h3>Belum ada penjualan dibuka</h3>
              <p>
                Yang dibatalkan harus dilihat dulu: void mengeluarkan seluruh
                uangnya sekaligus.
              </p>
            </div>
          ) : (
            <>
              <div className="divider" />
              <SaleSummary sale={sale} />
              <div className="notice">
                Unit yang sudah diretur tidak ikut terbawa — masing-masing sudah
                pulang lewat pergerakannya sendiri, dan node hanya membawa yang
                masih di tangan pelanggan.
              </div>

              <div className="divider" />
              <label className="field">
                Alasan pembatalan
                <input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Misalnya: salah tekan, keranjang milik pelanggan lain"
                  autoComplete="off"
                />
              </label>

              <div className="divider" />
              <Authorisation hold={supervisor} />

              {problem !== null && <p className="error">{problem}</p>}
              <button
                className="btn danger"
                disabled={busy || !ready}
                onClick={() => void send()}
              >
                {busy
                  ? "Mengirim ke node…"
                  : `Batalkan seluruh penjualan${
                      sale.totalMinor === null
                        ? ""
                        : ` ${money(sale.totalMinor)}`
                    }`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
