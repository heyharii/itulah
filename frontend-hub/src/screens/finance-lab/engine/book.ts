/// One seeded book, shared by every screen in this module.
///
/// # Why a singleton and not a query
///
/// Because the point of these screens is that ONE transaction appears under
/// several menus without becoming several records. A payroll settlement has to
/// be the same object in Cash & Bank and in Accruals; an asset acquisition has
/// to be the same journal entry the asset detail links to. Fetching each
/// screen's data separately would let them disagree, which is exactly the
/// defect the plan asks the prototype to make impossible.
///
/// It is module state, built once, and it is deliberately not React state:
/// nothing here changes after construction except through the actions the
/// screens offer, and those go through the same engine the scenarios use.
///
/// # What is seeded
///
/// C006's July 2026, compressed: the month's dispatches as one document, the
/// month's takings as a handful of deposits, the sale patterns that actually
/// occur, the payroll triangle, the depreciation run, and the telephone. Not
/// all 2,187 documents — the shapes, with the client's own figures, which is
/// what a person needs to see the flows joined up.

import * as depreciation from "./depreciation"
import { BOOKS, C006_ASSETS, C006_TREATMENTS, UNITS } from "./fixtures"
import { Ledger } from "./ledger"
import { Payments } from "./payments"
import { BINDINGS } from "./bindings"
import {
  ASSET_ACQUISITION,
  CARD_RECLASS,
  DEPOSIT,
  DEPRECIATION,
  DISPATCH,
  FUNDING,
  OE_REPLACEMENT,
  PAYROLL_ACCRUAL,
  PREPAID_RELEASE,
  SALE,
  activeFor,
  conformance,
  ruleVersion,
  type Rule,
} from "./rules"
import type {
  AssetCostComponent,
  AssetFact,
  AssetTreatment,
  OpenItem,
  PostOutcome,
} from "./types"

/// The day this system took the books over. Before it, an asset with no
/// purchase document is ordinary; after it, an exception.
export const CUTOVER = "2026-07-01"

export interface Fired {
  readonly label: string
  readonly outcome: PostOutcome | { ok: false; code: string; message: string }
}

class Book {
  readonly ledger = new Ledger(BOOKS, [...BINDINGS])
  readonly payments = new Payments(this.ledger)
  readonly assets: AssetFact[] = [...C006_ASSETS]
  readonly treatments: AssetTreatment[] = [...C006_TREATMENTS]
  readonly components: AssetCostComponent[] = []
  readonly log: Fired[] = []

  /// Bumped on every write, so React can subscribe without the book knowing
  /// React exists. `useSyncExternalStore` reads this as the snapshot: a number
  /// is a stable identity in a way a freshly-built object is not, and returning
  /// a new object each time is the classic way to make that hook loop forever.
  private version = 0
  private listeners = new Set<() => void>()

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  snapshot = () => this.version

  private changed() {
    this.version += 1
    for (const fn of this.listeners) fn()
  }

  constructor() {
    for (const m of ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]) {
      this.ledger.openPeriod("CFS", m)
    }
    // June is closed. Not decoration: it is what makes the period lock visible
    // on the Close screen, and what a late June document runs into.
    this.ledger.closePeriod("CFS", "2026-06", "manager@lab")
    this.seed()
  }

  private fire<P>(
    label: string,
    rule: Rule<P>,
    payload: P,
    ctx: {
      unit_id: string
      on: string
      document_ref: string
      source_id: string
      step: string
      memo?: string
    }
  ) {
    const blocked = activeFor(rule.pkg, "CFS", ctx.unit_id, ctx.on)
    if (blocked) {
      const outcome = { ok: false as const, code: "RULE_NOT_ACTIVE", message: blocked }
      this.log.push({ label, outcome })
      return outcome
    }
    const lines = rule.build(payload)
    const drift = conformance(rule.pkg, lines)
    if (drift.length) {
      const outcome = { ok: false as const, code: "BAD_PAYLOAD", message: drift.join("; ") }
      this.log.push({ label, outcome })
      return outcome
    }
    const outcome = this.ledger.post({
      book_id: "CFS",
      occurred_on: ctx.on,
      document_on: ctx.on,
      posting_on: ctx.on,
      source_kind: rule.pkg.source_kind,
      source_id: ctx.source_id,
      document_ref: ctx.document_ref,
      rule_version: ruleVersion(rule.pkg),
      memo: ctx.memo,
      lines,
      idempotency_key: `${ctx.source_id}/${ctx.step}`,
      actor: "finance@lab",
      actor_role: "FINANCE",
    })
    this.log.push({ label, outcome })
    return outcome
  }

  private seed() {
    // --- goods in, all month -------------------------------------------
    // 147 Surat Jalan Distribusi in July, Rp470,488,453.26 of BDP debits.
    // Seeded as three documents rather than 147: the shape is what matters
    // and the total is the client's.
    const sjd: [string, number][] = [
      ["C006-SJD-26-07-0011", 18_512_339_100],
      ["C006-SJD-26-07-0044", 15_998_402_226],
      ["C006-SJD-26-07-0102", 12_538_104_000],
    ]
    for (const [ref, amount] of sjd) {
      this.fire("Kiriman dari HO", DISPATCH, { unit_id: "C006", from_unit_id: "HO", amount }, {
        unit_id: "C006",
        on: ref.slice(-2) === "11" ? "2026-07-06" : ref.endsWith("44") ? "2026-07-15" : "2026-07-24",
        document_ref: ref,
        source_id: ref,
        step: "dispatch",
        memo: "Surat Jalan Distribusi",
      })
    }

    // --- the day's trade -------------------------------------------------
    this.fire(
      "Penjualan tunai",
      SALE,
      {
        unit_id: "C006",
        net_revenue: 1_462_650_000,
        discount: 0,
        cost_of_goods: 950_722_500,
        tenders: [{ method: "CASH", amount: 1_462_650_000 }],
        card_bank: {},
      },
      { unit_id: "C006", on: "2026-07-06", document_ref: "C006-PJ-26-07-0451", source_id: "SALE-0451", step: "sale", memo: "Penjualan tunai 6/7" }
    )
    this.fire(
      "Penjualan debit BCA",
      SALE,
      {
        unit_id: "C006",
        net_revenue: 384_500_000,
        discount: 0,
        cost_of_goods: 249_925_000,
        tenders: [{ method: "CARD", acquirer: "BCA_DEBIT", amount: 384_500_000 }],
        card_bank: { BCA_DEBIT: "BCA-TAB-C006" },
      },
      { unit_id: "C006", on: "2026-07-15", document_ref: "C006-PJ-26-07-0988", source_id: "SALE-0988", step: "sale", memo: "Penjualan debit card" }
    )
    this.fire(
      "Penjualan tunai + debit",
      SALE,
      {
        unit_id: "C006",
        net_revenue: 45_000_000,
        discount: 5_000_000,
        cost_of_goods: 27_000_000,
        tenders: [
          { method: "CASH", amount: 20_000_000 },
          { method: "CARD", acquirer: "BCA_DEBIT", amount: 25_000_000 },
        ],
        card_bank: { BCA_DEBIT: "BCA-TAB-C006" },
      },
      { unit_id: "C006", on: "2026-07-20", document_ref: "C006-PJ-26-07-1355", source_id: "SALE-1355", step: "sale", memo: "Tunai + debit, satu transaksi" }
    )

    // --- takings banked to head office ------------------------------------
    const deposits: [string, string, number][] = [
      ["C006-BKK-26-07-00001", "2026-07-01", 1_462_650_000],
      ["C006-BKK-26-07-00003", "2026-07-02", 1_377_395_000],
      ["C006-BKK-26-07-00005", "2026-07-03", 1_313_400_000],
    ]
    for (const [ref, on, amount] of deposits) {
      this.fire("Setor hasil penjualan", DEPOSIT, { unit_id: "C006", to_unit_id: "HO", amount, from: "CASH_ON_HAND" }, {
        unit_id: "C006", on, document_ref: ref, source_id: ref, step: "deposit", memo: "penyetoran hasil penjualan",
      })
    }

    // --- the telephone ----------------------------------------------------
    const phone = this.fire(
      "Bayar pengadaan — telepon kabel",
      ASSET_ACQUISITION,
      { unit_id: "C006", asset_class: "FFE_OFFICE", amount: 34_827_600, source: { kind: "BANK", bank_account_id: "BCA-TAB-C006" } },
      { unit_id: "C006", on: "2026-07-27", document_ref: "KK-26-07-00276", source_id: "KK-26-07-00276", step: "acquisition", memo: "TELEPON KABEL C6" }
    )
    const phoneAsset: AssetFact = {
      asset_id: "A-C006-047",
      asset_number: "AST-C006-0047",
      name: "TELEPON KABEL C6",
      unit_id: "C006",
      asset_class: "FFE_OFFICE",
      quantity: 1,
      document_on: "2026-07-27",
      register_on: "2026-07-01",
      location: "Kantor C006",
      custodian: "—",
      condition: "NEW",
      photo_count: 0,
      // Bought and paid for; nobody has completed the register. This is the
      // queue the Assets screen opens on, and it is a real state.
      status: "RECEIVED",
    }
    this.assets.push(phoneAsset)
    this.components.push({
      component_id: "AC-PHONE",
      asset_id: phoneAsset.asset_id,
      kind: "UNIT",
      amount: 34_827_600,
      document_ref: "KK-26-07-00276",
      paid_on: "2026-07-27",
      entry_id: phone.ok ? phone.entry.entry_id : undefined,
    })

    // --- the air conditioner, three payments ------------------------------
    // A SIMULATION, and it is marked as one everywhere it appears. The
    // client's three sources disagree about this asset; see the Assets screen.
    const acAsset: AssetFact = {
      asset_id: "A-C004-AC1",
      asset_number: "AST-C004-0161",
      name: "AC C4",
      unit_id: "C004",
      asset_class: "FFE_TOKO",
      quantity: 1,
      document_on: "2026-07-15",
      register_on: "2026-07-01",
      location: "Toko C004",
      custodian: "Store manager C004",
      condition: "NEW",
      photo_count: 1,
      status: "INSTALLED",
      notes: "Unit dan pemasangan dibayar terpisah; ada pembayaran awal Juni.",
    }
    this.assets.push(acAsset)
    const acParts: [AssetCostComponent["kind"], number, string, string][] = [
      ["ADVANCE", 700_000_000, "C004-BKK-26-06-0311", "2026-06-08"],
      ["UNIT", 2_500_000_000, "C004-BKK-26-07-0142", "2026-07-15"],
      ["INSTALLATION", 139_000_000, "C004-BKK-26-07-0142", "2026-07-15"],
    ]
    for (const [kind, amount, ref, on] of acParts) {
      // The June advance cannot post: June is closed. That refusal is real and
      // it is what the Assets screen shows as an outstanding component.
      const r = this.fire(
        `Bayar pengadaan — AC C4 (${kind.toLowerCase()})`,
        ASSET_ACQUISITION,
        {
          unit_id: "C004",
          asset_class: "FFE_TOKO",
          amount,
          source: { kind: "BANK", bank_account_id: "BCA-TAB-C004" },
          bank_charge: kind === "UNIT" ? 500_000 : undefined,
        },
        { unit_id: "C004", on, document_ref: ref, source_id: `${ref}/${kind}`, step: "acquisition", memo: `AC C4 — ${kind.toLowerCase()}` }
      )
      this.components.push({
        component_id: `AC-${kind}`,
        asset_id: acAsset.asset_id,
        kind,
        amount,
        document_ref: ref,
        paid_on: on,
        entry_id: r.ok ? r.entry.entry_id : undefined,
      })
    }

    // --- payroll: three events, one month ---------------------------------
    this.fire(
      "Pengakuan gaji Juli",
      PAYROLL_ACCRUAL,
      { unit_id: "C006", salary: 5_725_000_000, benefits: 316_322_800, outside_help: 150_000_000 },
      { unit_id: "C006", on: "2026-07-31", document_ref: "C006-GL-26-07-00004", source_id: "PAYROLL-C006-2026-07", step: "accrual", memo: "gaji karyawan juli 2026" }
    )
    const salaryItem: OpenItem = {
      item_id: "OI-SAL-07", kind: "ACCRUAL", book_id: "CFS", unit_id: "C006", role: "SALARY_ACCRUAL", narrows: {},
      counterparty: "Karyawan C006", description: "Gaji dan upah YMHD Juli 2026", opened_on: "2026-07-31",
      due_on: "2026-07-31", original: 5_725_000_000, source_ref: "C006-GL-26-07-00004",
    }
    const bpjsItem: OpenItem = {
      item_id: "OI-BPJS-07", kind: "ACCRUAL", book_id: "CFS", unit_id: "C006", role: "BENEFIT_ACCRUAL", narrows: {},
      counterparty: "BPJS Ketenagakerjaan & Kesehatan", description: "Asuransi dan BPJS YMHD Juli 2026",
      opened_on: "2026-07-31", due_on: "2026-08-10", original: 316_322_800, source_ref: "C006-GL-26-07-00004",
    }
    const augustSalary: OpenItem = {
      item_id: "OI-SAL-08", kind: "ACCRUAL", book_id: "CFS", unit_id: "C006", role: "SALARY_ACCRUAL", narrows: {},
      counterparty: "Karyawan C006", description: "Gaji dan upah YMHD Agustus 2026", opened_on: "2026-08-31",
      due_on: "2026-08-31", original: 5_725_000_000, source_ref: "C006-GL-26-08-00004",
    }
    this.payments.open(salaryItem)
    this.payments.open(bpjsItem)
    this.payments.open(augustSalary)

    this.fire(
      "Terima dana gaji dari HO",
      FUNDING,
      { unit_id: "C006", from_unit_id: "HO", amount: 6_191_350_000, funding_type: "PRINCIPAL_REIMBURSEMENT", into: "PETTY_CASH" },
      { unit_id: "C006", on: "2026-07-31", document_ref: "C006-BKM-26-07-00003", source_id: "BKM-C006-07-3", step: "funding", memo: "penerimaan gaji karyawan juli 2026" }
    )

    const draft = this.payments.request(
      {
        book_id: "CFS", unit_id: "C006", direction: "OUT",
        occurred_on: "2026-07-31", document_on: "2026-07-31", posting_on: "2026-07-31",
        counterparty: "Karyawan dan BPJS C006", source: { kind: "PETTY_CASH" },
        action: "PAY_PAYROLL", document_ref: "C006-BKK-26-07-00046",
        allocations: [
          { target: { kind: "OPEN_ITEM", item_id: "OI-SAL-07" }, amount: 5_725_000_000 },
          { target: { kind: "OPEN_ITEM", item_id: "OI-BPJS-07" }, amount: 316_322_800 },
          { target: { kind: "DIRECT_EXPENSE", role: "ALLOWANCE_EXPENSE", narrows: {}, description: "GAJI PETUGAS LUAR" }, amount: 150_000_000 },
          { target: { kind: "DIRECT_EXPENSE", role: "ROUNDING", narrows: {}, description: "ROUNDED" }, amount: 27_200 },
        ],
      },
      "clerk@lab"
    )
    if (!("error" in draft)) {
      this.payments.advance(draft.payment_id, "APPROVED", "manager@lab", "FINANCE_MANAGER")
      this.payments.advance(draft.payment_id, "INSTRUCTED", "finance@lab", "FINANCE")
      this.payments.advance(draft.payment_id, "SETTLED", "finance@lab", "FINANCE")
    }

    // One payment left mid-flight, so the lifecycle is visible rather than
    // described: the August salary run is approved and nobody has instructed
    // the bank yet.
    const pending = this.payments.request(
      {
        book_id: "CFS", unit_id: "C006", direction: "OUT",
        occurred_on: "2026-09-01", document_on: "2026-09-01", posting_on: "2026-09-01",
        counterparty: "Karyawan C006", source: { kind: "BANK", bank_account_id: "BCA-TAB-C006" },
        action: "PAY_PAYROLL", document_ref: "C006-BKK-26-09-00002",
        allocations: [{ target: { kind: "OPEN_ITEM", item_id: "OI-SAL-08" }, amount: 5_725_000_000 }],
      },
      "clerk@lab"
    )
    if (!("error" in pending)) {
      this.payments.advance(pending.payment_id, "APPROVED", "manager@lab", "FINANCE_MANAGER")
    }

    // --- month end --------------------------------------------------------
    this.fire(
      "Reklas kartu belum cair",
      CARD_RECLASS,
      { unit_id: "C006", acquirer: "BCA_DEBIT", bank_account_id: "BCA-TAB-C006", amount: 409_500_000 },
      { unit_id: "C006", on: "2026-07-31", document_ref: "C006-GL-26-07-00003", source_id: "RECLASS-C006-07", step: "reclass", memo: "piutang debit card belum cair" }
    )
    this.fire(
      "Sewa toko satu bulan",
      PREPAID_RELEASE,
      { unit_id: "C006", amount: 833_333_300 },
      { unit_id: "C006", on: "2026-07-31", document_ref: "C006-GL-26-07-00001", source_id: "PREPAID-C006-07", step: "release", memo: "sewa toko juli 2026" }
    )

    const charges = depreciation
      .run(this.assets, this.treatments, "C006", "2026-07")
      .filter((c) => c.amount > 0)
    this.fire(
      "Depresiasi Juli",
      DEPRECIATION,
      { unit_id: "C006", charges: charges.map((c) => ({ asset_class: c.asset_class, amount: c.amount })) },
      { unit_id: "C006", on: "2026-07-31", document_ref: "GL-26-07-00004", source_id: "DEP-C006-2026-07", step: "run", memo: "DEPRESIASI ASSET JULY 2026" }
    )
  }


  // -------------------------------------------------------------------------
  // Actions a screen may take. Every one of them goes through the same engine
  // the scenarios use — there is no second path, and no screen writes an entry.
  // -------------------------------------------------------------------------

  /// What a month's depreciation would charge, without posting it.
  previewDepreciation(unit_id: string, month: string) {
    return depreciation.run(this.assets, this.treatments, unit_id, month)
  }

  /// Has this run already been posted? Read from the ledger rather than from a
  /// flag, so a screen cannot say "not yet" about an entry that exists.
  depreciationEntry(unit_id: string, month: string) {
    return this.ledger
      .allEntries()
      .find((e) => e.source_kind === "DEPRECIATION" && e.source_id === `DEP-${unit_id}-${month}`)
  }

  /// Post a month. Idempotent: a second press returns the first entry.
  runDepreciation(unit_id: string, month: string, actor = "finance@lab") {
    const charges = this.previewDepreciation(unit_id, month).filter((c) => c.amount > 0)
    if (charges.length === 0) {
      return { ok: false as const, code: "BAD_PAYLOAD", message: `Tidak ada aset yang membebankan di ${month}.` }
    }
    const last = `${month}-${new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()}`
    const out = this.fire(
      `Depresiasi ${month}`,
      DEPRECIATION,
      { unit_id, charges: charges.map((c) => ({ asset_class: c.asset_class, amount: c.amount })) },
      {
        unit_id,
        on: last,
        document_ref: `GL-SIM-${month}`,
        source_id: `DEP-${unit_id}-${month}`,
        step: "run",
        memo: `DEPRESIASI ASSET ${month}`,
      }
    )
    void actor
    this.changed()
    return out
  }

  /// Move a payment along its lifecycle. Only SETTLED posts.
  advancePayment(
    payment_id: string,
    to: "APPROVED" | "INSTRUCTED" | "SETTLED" | "FAILED" | "CANCELLED",
    actor: string,
    role: "FINANCE" | "FINANCE_MANAGER",
    note?: string
  ) {
    const r = this.payments.advance(payment_id, to, actor, role, note)
    this.changed()
    return r
  }

  /// Raise and pay an operating-equipment replacement.
  ///
  /// The whole point is what it does NOT do: no asset row, no treatment, no
  /// schedule, no reserve. Scenario D checks all four.
  replaceOperatingEquipment(input: {
    unit_id: string
    asset_class: string
    amount: number
    bank_account_id: string
    on: string
    description: string
  }) {
    const ref = `${input.unit_id}-BKK-SIM-OE-${this.oeSeq++}`
    const out = this.fire(
      `Bayar Penggantian OE — ${input.description}`,
      OE_REPLACEMENT,
      {
        unit_id: input.unit_id,
        asset_class: input.asset_class,
        amount: input.amount,
        source: { kind: "BANK", bank_account_id: input.bank_account_id },
      },
      { unit_id: input.unit_id, on: input.on, document_ref: ref, source_id: ref, step: "replacement", memo: input.description }
    )
    this.changed()
    return out
  }

  /// Reverse an entry. Uses the original accounts; see `Ledger.reverse`.
  reverseEntry(entry_id: string, on: string, reason: string) {
    const r = this.ledger.reverse(entry_id, on, reason, "manager@lab", "FINANCE_MANAGER")
    this.changed()
    return r
  }

  setPeriod(period: string, closed: boolean) {
    if (closed) this.ledger.closePeriod("CFS", period, "manager@lab")
    else this.ledger.reopenPeriod("CFS", period)
    this.changed()
  }

  private oeSeq = 1

  /// The register rows a person has to finish, and why each one is waiting.
  ///
  /// Two different gaps, kept apart: an asset the books bought that nobody has
  /// described, and an asset in the register the books never bought. The first
  /// is somebody's afternoon; the second is a control finding.
  reviewQueue() {
    const paidFor = new Set(this.components.map((c) => c.asset_id))
    const assessed = new Set(this.treatments.map((t) => t.asset_id))
    return {
      incomplete: this.assets.filter(
        (a) => paidFor.has(a.asset_id) && (a.status === "RECEIVED" || a.custodian === "—")
      ),
      unassessed: this.assets.filter((a) => !assessed.has(a.asset_id)),
      // Only assets acquired since the cutover. An asset the company already
      // owned when this system arrived has no purchase document here and never
      // will, and listing all 46 of them as findings is how a control report
      // becomes something nobody opens. After the cutover it is a real
      // exception: the books say nothing bought it.
      unbacked: this.assets.filter(
        (a) => !paidFor.has(a.asset_id) && a.document_on >= CUTOVER
      ),
    }
  }

  costOf(asset_id: string) {
    return this.components
      .filter((c) => c.asset_id === asset_id)
      .reduce((n, c) => n + c.amount, 0)
  }

  recognisedOf(asset_id: string) {
    return this.components
      .filter((c) => c.asset_id === asset_id && c.entry_id)
      .reduce((n, c) => n + c.amount, 0)
  }
}

let singleton: Book | null = null

export function book(): Book {
  if (!singleton) singleton = new Book()
  return singleton
}

export { UNITS }
export type { Book }
