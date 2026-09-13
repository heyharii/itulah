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
import { account } from "./chart"
import { Ledger } from "./ledger"
import { Payments } from "./payments"
import { BINDINGS } from "./bindings"
import {
  ADVANCE_ISSUE,
  ADVANCE_LIQUIDATION,
  ASSET_ACQUISITION,
  BILL,
  BILL_PAYMENT,
  CAPITALISATION,
  CARD_RECLASS,
  CARD_SETTLEMENT,
  DEPOSIT,
  DEPRECIATION,
  DISPATCH,
  EQUITY_MOVEMENT,
  FUNDING,
  GIRO_CLEAR,
  GIRO_ISSUE,
  LOAN_REPAYMENT,
  OE_REPLACEMENT,
  PAYROLL_ACCRUAL,
  PAYROLL_PAYMENT,
  PREOPENING_AMORTISATION,
  PREPAID_PAID,
  PREPAID_RELEASE,
  RECEIPT,
  SALE,
  STOCK_ADJUSTMENT,
  TAX_PAYMENT,
  TRANSFER,
  activeFor,
  conformance,
  ruleVersion,
  type Rule,
} from "./rules"
import type { Minor } from "./types"
import type {
  AssetCostComponent,
  AssetFact,
  AssetTreatment,
  OpenItem,
  PostOutcome,
} from "./types"
import {
  addRule,
  candidates,
  parseCsv,
  removeRule,
  rules,
  suggest,
  type BankLine,
  type BankRule,
  type Candidate,
} from "./bank"
import {
  ADVANCES,
  BILLS,
  CARD_BATCHES,
  INQUIRIES,
  PREPAIDS,
  STATEMENT,
  STORE_DAYS,
  STORE_EXPENSES,
  TRADE,
  VENDORS,
  type Advance,
  type Bill,
  type CardBatch,
  type Inquiry,
  type Prepaid,
  type StoreDay,
  type StoreExpense,
  type Vendor,
} from "./data"
import {
  EQUITY_MOVES,
  GIROS,
  INTERUNIT_MOVES,
  LOAN_SCHEDULE,
  PAYROLL_PAYABLES,
  PAYROLL_RUNS,
  PRE_OPENING,
  PROJECTS,
  PROVISIONS,
  SHIPMENTS,
  STAFF_LOANS,
  STOCK_ADJUSTMENTS,
  TAX_POSITIONS,
  type EquityMove,
  type Giro,
  type InterunitMove,
  type LoanPeriod,
  type PayrollPayable,
  type PayrollRun,
  type PreOpening,
  type Project,
  type Provision,
  type Shipment,
  type StaffLoan,
  type StockAdjustment,
  type TaxPosition,
} from "./subledgers"

/// The day this system took the books over. Before it, an asset with no
/// purchase document is ordinary; after it, an exception.
export const CUTOVER = "2026-07-01"

/// Parties the fixture already knows for its own statement lines. Everything
/// imported afterwards starts blank, which is the honest state: a bank export
/// does not carry a counterparty in any form worth trusting.
const SEEDED_PARTY: Record<string, string> = {
  "S-1": "Telkom",
  "S-2": "BCA Debit (acquirer)",
  "S-3": "BCA Debit (acquirer)",
  "S-4": "Bank BCA",
  "S-5": "Bank BCA",
  "S-6": "PT Kencana Mode",
  "S-7": "PT Kencana Mode",
}

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

  /// The subledgers, as state rather than as fixtures.
  ///
  /// # Why this had to change
  ///
  /// They used to be module-level `readonly` arrays that the screens read
  /// directly. Two consequences, both bad. Nothing an action did could move
  /// them, so half the buttons in the module were decoration. And nothing the
  /// ledger did could move them either, so `Bills` reported Rp300m outstanding
  /// while the trial balance's `2012001` knew nothing about it — two numbers
  /// for one fact, and no way to tell which was the lie.
  ///
  /// Now the fixture seeds the register once and every action writes to both:
  /// the journal through a rule, and the register beside it. A figure on a
  /// screen and the figure in the trial balance move together or the action
  /// failed.
  bills: Bill[] = [...BILLS]
  advances: Advance[] = [...ADVANCES]
  prepaids: Prepaid[] = [...PREPAIDS]
  cardBatches: CardBatch[] = [...CARD_BATCHES]
  storeDays: StoreDay[] = [...STORE_DAYS]
  payrollRuns: PayrollRun[] = [...PAYROLL_RUNS]
  payrollPayables: PayrollPayable[] = [...PAYROLL_PAYABLES]
  taxPositions: TaxPosition[] = [...TAX_POSITIONS]
  shipments: Shipment[] = [...SHIPMENTS]
  projects: Project[] = [...PROJECTS]
  stockAdjustments: StockAdjustment[] = [...STOCK_ADJUSTMENTS]
  interunitMoves: InterunitMove[] = [...INTERUNIT_MOVES]
  loanSchedule: LoanPeriod[] = [...LOAN_SCHEDULE]
  equityMoves: EquityMove[] = [...EQUITY_MOVES]
  staffLoans: StaffLoan[] = [...STAFF_LOANS]
  preOpening: PreOpening[] = [...PRE_OPENING]
  provisions: Provision[] = [...PROVISIONS]
  giros: Giro[] = [...GIROS]
  vendors: Vendor[] = [...VENDORS]
  /// The statement, as one list whose rows change status rather than move
  /// between three lists — the tabs are a filter over this, not three stores.
  bankLines: BankLine[] = STATEMENT.map((l) => ({
    line_id: l.line_id,
    bank_account_id: l.bank_account_id,
    on: l.on,
    description: l.description,
    amount: l.amount,
    direction: l.direction,
    status: l.matched_entry ? "POSTED" : "PENDING",
    entry_id: l.matched_entry,
    resolution: l.matched_entry ? "MATCHED" : undefined,
    counterparty: SEEDED_PARTY[l.line_id],
  }))

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

  /// What the subledgers were carrying at the cutover.
  ///
  /// # Why this is one entry and not a stream of events
  ///
  /// A bill issued in June and a prepaid that started in January happened
  /// before this book opened. Replaying them as events would post into periods
  /// the ledger does not hold — one of them is closed — and the poster would
  /// rightly refuse. A cutover is exactly the case an opening balance exists
  /// for: the position is stated, and the history behind it belongs to the
  /// system that produced it.
  ///
  /// What this fixes is a real inconsistency. `Bills` read its register and
  /// reported Rp300m outstanding while `2012001` in the trial balance knew
  /// nothing about it, because the register was a fixture nobody had posted.
  /// Now both sides say the same thing on the day the book opens, and every
  /// action after that moves them together.
  private seedSubledgerOpening() {
    const suffix = (u: string) => (u === "HO" ? "00" : u.slice(-2))
    // Each row carries its OWN unit. Stamping them all `HO` kept the entry
    // balanced and quietly broke every per-unit report: a C006 payable filed
    // under head office is invisible to `trialBalance({ unit_id: "C006" })`,
    // so Consolidated would have shown a shop with no liabilities.
    const rows: {
      code: string
      unit: string
      side: "DEBIT" | "CREDIT"
      amount: Minor
      memo: string
    }[] = []

    for (const bill of this.bills) {
      const left = bill.total - bill.paid
      if (left <= 0) continue
      const s = suffix(bill.unit_id)
      rows.push({
        code: bill.kind === "MERCHANDISE" ? `2012001001${s}` : `2012001003${s}`,
        unit: bill.unit_id,
        side: "CREDIT",
        amount: left,
        memo: `${bill.number} — ${bill.supplier}`,
      })
      rows.push({
        // Merchandise still exists, so it is stock. A utility bill's cost was
        // incurred BEFORE this book opened, so charging it to this period's
        // expenses would make July carry June's electricity — the opening
        // entry would print a loss the business did not make. It belongs to
        // retained earnings, which is what an opening balance is for.
        code: bill.kind === "MERCHANDISE" ? `1011201001${s}` : `3013001002${s}`,
        unit: bill.unit_id,
        side: "DEBIT",
        amount: left,
        memo: bill.number,
      })
    }

    for (const a of this.advances) {
      const left = a.amount - a.liquidated
      if (left <= 0) continue
      const s = suffix(a.unit_id)
      rows.push({
        code: `1011303004${s}`,
        unit: a.unit_id,
        side: "DEBIT",
        amount: left,
        memo: `Uang muka ${a.holder}`,
      })
      rows.push({
        code: `3013001001${s}`,
        unit: a.unit_id,
        side: "CREDIT",
        amount: left,
        memo: "saldo awal",
      })
    }

    for (const p of this.prepaids) {
      const monthly = Math.floor(p.total / p.months / 100) * 100
      const left = p.total - monthly * p.released_months
      if (left <= 0) continue
      const s = suffix(p.unit_id)
      rows.push({
        code: `1011301003${s}`,
        unit: p.unit_id,
        side: "DEBIT",
        amount: left,
        memo: p.description,
      })
      rows.push({
        code: `3013001001${s}`,
        unit: p.unit_id,
        side: "CREDIT",
        amount: left,
        memo: "saldo awal",
      })
    }

    for (const p of this.payrollPayables) {
      const left = p.amount - p.settled
      if (left <= 0) continue
      const s = suffix(p.unit_id)
      rows.push({
        code: p.account.slice(0, 10) + s,
        unit: p.unit_id,
        side: "CREDIT",
        amount: left,
        memo: `${p.kind} ${p.period}`,
      })
      // Same reason as the bills above: pay accrued for a month before the
      // cutover is not this period's cost.
      rows.push({
        code: `3013001002${s}`,
        unit: p.unit_id,
        side: "DEBIT",
        amount: left,
        memo: `${p.kind} ${p.period}`,
      })
    }

    for (const t of this.taxPositions) {
      const s = suffix(t.unit_id)
      if (t.filed_on) continue
      if (t.payable > 0 && t.payable_account) {
        rows.push({
          code: t.payable_account.slice(0, 10) + s,
          unit: t.unit_id,
          side: "CREDIT",
          amount: t.payable,
          memo: `${t.kind} ${t.period}`,
        })
        rows.push({
          code: `3013001001${s}`,
          unit: t.unit_id,
          side: "DEBIT",
          amount: t.payable,
          memo: "saldo awal",
        })
      }
      if (t.prepaid > 0 && t.prepaid_account) {
        rows.push({
          code: t.prepaid_account.slice(0, 10) + s,
          unit: t.unit_id,
          side: "DEBIT",
          amount: t.prepaid,
          memo: `${t.kind} ${t.period}`,
        })
        rows.push({
          code: `3013001001${s}`,
          unit: t.unit_id,
          side: "CREDIT",
          amount: t.prepaid,
          memo: "saldo awal",
        })
      }
    }

    for (const l of this.staffLoans) {
      const left = l.principal - l.repaid
      if (left <= 0) continue
      const s = suffix(l.unit_id)
      rows.push({
        code: l.account.slice(0, 10) + s,
        unit: l.unit_id,
        side: "DEBIT",
        amount: left,
        memo: l.person,
      })
      rows.push({
        code: `3013001001${s}`,
        unit: l.unit_id,
        side: "CREDIT",
        amount: left,
        memo: "saldo awal",
      })
    }

    // Card batches are deliberately NOT here. July's own reclass entry
    // (`C006-GL-26-07-00003`) already moves the uncleared takings onto
    // `Piutang Debit Card`, and stating them again as an opening balance would
    // carry the same receivable twice — which is the exact class of error this
    // whole exercise exists to remove.

    // The facility, and the part of it falling due inside a year.
    const outstanding = this.loanSchedule
      .filter((x) => !x.paid_on)
      .reduce((n, x) => n + x.principal, 0)
    if (outstanding > 0) {
      rows.push({
        code: "202240200100",
        unit: "HO",
        side: "CREDIT",
        amount: outstanding,
        memo: "Pinjaman BCA",
      })
      rows.push({
        code: "301300100100",
        unit: "HO",
        side: "DEBIT",
        amount: outstanding,
        memo: "saldo awal",
      })
    }

    const debits = rows
      .filter((r) => r.side === "DEBIT")
      .reduce((n, r) => n + r.amount, 0)
    const credits = rows
      .filter((r) => r.side === "CREDIT")
      .reduce((n, r) => n + r.amount, 0)
    if (rows.length === 0 || debits !== credits) return

    this.ledger.post({
      book_id: "CFS",
      occurred_on: "2026-06-30",
      document_on: "2026-06-30",
      posting_on: "2026-07-01",
      source_kind: "MANUAL",
      source_id: "OB-SUBLEDGERS",
      document_ref: "OB-SUBLEDGERS",
      rule_version: "opening_balance@1",
      memo: "Opening balance — subledgers",
      idempotency_key: "OB-SUBLEDGERS/open",
      lines: rows.map((r) => ({
        side: r.side,
        role: "CASH_ON_HAND" as never,
        dims: { unit_id: r.unit },
        amount: r.amount,
        memo: r.memo,
        account_code: r.code,
      })),
      actor: "finance@lab",
      actor_role: "FINANCE_MANAGER",
    })
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
      const outcome = {
        ok: false as const,
        code: "RULE_NOT_ACTIVE",
        message: blocked,
      }
      this.log.push({ label, outcome })
      return outcome
    }
    const lines = rule.build(payload)
    const drift = conformance(rule.pkg, lines)
    if (drift.length) {
      const outcome = {
        ok: false as const,
        code: "BAD_PAYLOAD",
        message: drift.join("; "),
      }
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

  /// Opening balances, posted rather than typed.
  ///
  /// The client owns 196 money accounts and holds money in a fraction of them —
  /// every store keeps cash, a float and one or two bank accounts, and head
  /// office keeps the rest. Writing balances onto the accounts would have been
  /// a second source of truth beside the journal; instead each unit gets ONE
  /// opening entry, debiting the accounts it uses and crediting Modal Setor.
  /// Every balance on every screen is then summed from the journal exactly like
  /// the rest, and the trial balance still balances.
  ///
  /// Which accounts a unit uses is deterministic, not random: a fixture that
  /// reshuffles on reload is a fixture nobody can compare two screenshots of.
  private seedOpeningBalances() {
    const units = [
      "HO",
      "C001",
      "C002",
      "C003",
      "C004",
      "C005",
      "C006",
      "C007",
      "C008",
      "C009",
      "C010",
      "C011",
      "C012",
      "C013",
    ]
    // "C001".slice(1) is "001" — three characters — and the codes take two.
    // The suffix is the last two digits of the unit id, which is what the
    // client's own twelve-character leaves carry.
    const suffix = (u: string) => (u === "HO" ? "00" : u.slice(-2))

    for (const [i, u] of units.entries()) {
      const ho = u === "HO"
      const s = suffix(u)
      // A plausible spread, keyed off the unit's own index so it is stable.
      const rows: [string, number][] = [
        [
          `1011001001${s}`,
          ho ? 45_000_000_00 : (18_000_000 + i * 2_400_000) * 100,
        ],
        [
          `1011001002${s}`,
          ho ? 12_000_000_00 : (3_500_000 + i * 180_000) * 100,
        ],
        [`1011001003${s}`, (2_000_000 + i * 100_000) * 100],
        // BCA savings everywhere; the second bank only where the index says so.
        [
          `1011003001${s}`,
          ho ? 1_850_000_000_00 : (120_000_000 + i * 9_400_000) * 100,
        ],
        ...(i % 3 === 0
          ? ([[`1011002001${s}`, (60_000_000 + i * 5_000_000) * 100]] as [
              string,
              number,
            ][])
          : []),
        ...(i % 4 === 1
          ? ([[`1011003004${s}`, (35_000_000 + i * 3_000_000) * 100]] as [
              string,
              number,
            ][])
          : []),
        ...(ho
          ? ([[`1011004001${s}`, 2_500_000_000_00]] as [string, number][])
          : []),
      ]

      const total = rows.reduce((n, [, v]) => n + v, 0)
      const ob = this.ledger.post({
        book_id: "CFS",
        occurred_on: "2026-06-30",
        document_on: "2026-06-30",
        posting_on: "2026-07-01",
        source_kind: "MANUAL",
        source_id: `OB-${u}`,
        document_ref: `OB-${u}`,
        rule_version: "opening_balance@1",
        memo: `Opening balance ${u}`,
        lines: [
          ...rows.map(([code, amount]) => ({
            side: "DEBIT" as const,
            role: "CASH_ON_HAND" as never,
            dims: { unit_id: u },
            amount,
            memo: "opening",
            account_code: code,
          })),
          {
            side: "CREDIT" as const,
            role: "CASH_ON_HAND" as never,
            dims: { unit_id: u },
            amount: total,
            memo: "Modal Setor",
            account_code: `3013001001${s}`,
          },
        ],
        idempotency_key: `OB-${u}/opening`,
        actor: "finance@lab",
        actor_role: "FINANCE",
      })
      this.log.push({ label: `Opening balance ${u}`, outcome: ob })
    }
  }

  private seed() {
    this.seedOpeningBalances()
    this.seedSubledgerOpening()
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
      this.fire(
        "Kiriman dari HO",
        DISPATCH,
        { unit_id: "C006", from_unit_id: "HO", amount },
        {
          unit_id: "C006",
          on:
            ref.slice(-2) === "11"
              ? "2026-07-06"
              : ref.endsWith("44")
                ? "2026-07-15"
                : "2026-07-24",
          document_ref: ref,
          source_id: ref,
          step: "dispatch",
          memo: "Surat Jalan Distribusi",
        }
      )
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
      {
        unit_id: "C006",
        on: "2026-07-06",
        document_ref: "C006-PJ-26-07-0451",
        source_id: "SALE-0451",
        step: "sale",
        memo: "Penjualan tunai 6/7",
      }
    )
    this.fire(
      "Penjualan debit BCA",
      SALE,
      {
        unit_id: "C006",
        net_revenue: 384_500_000,
        discount: 0,
        cost_of_goods: 249_925_000,
        tenders: [
          { method: "CARD", acquirer: "BCA_DEBIT", amount: 384_500_000 },
        ],
        card_bank: { BCA_DEBIT: "BCA-TAB-C006" },
      },
      {
        unit_id: "C006",
        on: "2026-07-15",
        document_ref: "C006-PJ-26-07-0988",
        source_id: "SALE-0988",
        step: "sale",
        memo: "Penjualan debit card",
      }
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
      {
        unit_id: "C006",
        on: "2026-07-20",
        document_ref: "C006-PJ-26-07-1355",
        source_id: "SALE-1355",
        step: "sale",
        memo: "Tunai + debit, satu transaksi",
      }
    )

    // --- takings banked to head office ------------------------------------
    const deposits: [string, string, number][] = [
      ["C006-BKK-26-07-00001", "2026-07-01", 1_462_650_000],
      ["C006-BKK-26-07-00003", "2026-07-02", 1_377_395_000],
      ["C006-BKK-26-07-00005", "2026-07-03", 1_313_400_000],
    ]
    for (const [ref, on, amount] of deposits) {
      this.fire(
        "Setor hasil penjualan",
        DEPOSIT,
        { unit_id: "C006", to_unit_id: "HO", amount, from: "CASH_ON_HAND" },
        {
          unit_id: "C006",
          on,
          document_ref: ref,
          source_id: ref,
          step: "deposit",
          memo: "penyetoran hasil penjualan",
        }
      )
    }

    // --- the telephone ----------------------------------------------------
    const phone = this.fire(
      "Bayar pengadaan — telepon kabel",
      ASSET_ACQUISITION,
      {
        unit_id: "C006",
        asset_class: "FFE_OFFICE",
        amount: 34_827_600,
        source: { kind: "BANK", bank_account_id: "BCA-TAB-C006" },
      },
      {
        unit_id: "C006",
        on: "2026-07-27",
        document_ref: "KK-26-07-00276",
        source_id: "KK-26-07-00276",
        step: "acquisition",
        memo: "TELEPON KABEL C6",
      }
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
        {
          unit_id: "C004",
          on,
          document_ref: ref,
          source_id: `${ref}/${kind}`,
          step: "acquisition",
          memo: `AC C4 — ${kind.toLowerCase()}`,
        }
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
      {
        unit_id: "C006",
        salary: 5_725_000_000,
        benefits: 316_322_800,
        outside_help: 150_000_000,
      },
      {
        unit_id: "C006",
        on: "2026-07-31",
        document_ref: "C006-GL-26-07-00004",
        source_id: "PAYROLL-C006-2026-07",
        step: "accrual",
        memo: "gaji karyawan juli 2026",
      }
    )
    const salaryItem: OpenItem = {
      item_id: "OI-SAL-07",
      kind: "ACCRUAL",
      book_id: "CFS",
      unit_id: "C006",
      role: "SALARY_ACCRUAL",
      narrows: {},
      counterparty: "Karyawan C006",
      description: "Gaji dan upah YMHD Juli 2026",
      opened_on: "2026-07-31",
      due_on: "2026-07-31",
      original: 5_725_000_000,
      source_ref: "C006-GL-26-07-00004",
    }
    const bpjsItem: OpenItem = {
      item_id: "OI-BPJS-07",
      kind: "ACCRUAL",
      book_id: "CFS",
      unit_id: "C006",
      role: "BENEFIT_ACCRUAL",
      narrows: {},
      counterparty: "BPJS Ketenagakerjaan & Kesehatan",
      description: "Asuransi dan BPJS YMHD Juli 2026",
      opened_on: "2026-07-31",
      due_on: "2026-08-10",
      original: 316_322_800,
      source_ref: "C006-GL-26-07-00004",
    }
    const augustSalary: OpenItem = {
      item_id: "OI-SAL-08",
      kind: "ACCRUAL",
      book_id: "CFS",
      unit_id: "C006",
      role: "SALARY_ACCRUAL",
      narrows: {},
      counterparty: "Karyawan C006",
      description: "Gaji dan upah YMHD Agustus 2026",
      opened_on: "2026-08-31",
      due_on: "2026-08-31",
      original: 5_725_000_000,
      source_ref: "C006-GL-26-08-00004",
    }
    this.payments.open(salaryItem)
    this.payments.open(bpjsItem)
    this.payments.open(augustSalary)

    this.fire(
      "Terima dana gaji dari HO",
      FUNDING,
      {
        unit_id: "C006",
        from_unit_id: "HO",
        amount: 6_191_350_000,
        funding_type: "PRINCIPAL_REIMBURSEMENT",
        into: "PETTY_CASH",
      },
      {
        unit_id: "C006",
        on: "2026-07-31",
        document_ref: "C006-BKM-26-07-00003",
        source_id: "BKM-C006-07-3",
        step: "funding",
        memo: "penerimaan gaji karyawan juli 2026",
      }
    )

    const draft = this.payments.request(
      {
        book_id: "CFS",
        unit_id: "C006",
        direction: "OUT",
        occurred_on: "2026-07-31",
        document_on: "2026-07-31",
        posting_on: "2026-07-31",
        counterparty: "Karyawan dan BPJS C006",
        source: { kind: "PETTY_CASH" },
        action: "PAY_PAYROLL",
        document_ref: "C006-BKK-26-07-00046",
        allocations: [
          {
            target: { kind: "OPEN_ITEM", item_id: "OI-SAL-07" },
            amount: 5_725_000_000,
          },
          {
            target: { kind: "OPEN_ITEM", item_id: "OI-BPJS-07" },
            amount: 316_322_800,
          },
          {
            target: {
              kind: "DIRECT_EXPENSE",
              role: "ALLOWANCE_EXPENSE",
              narrows: {},
              description: "GAJI PETUGAS LUAR",
            },
            amount: 150_000_000,
          },
          {
            target: {
              kind: "DIRECT_EXPENSE",
              role: "ROUNDING",
              narrows: {},
              description: "ROUNDED",
            },
            amount: 27_200,
          },
        ],
      },
      "clerk@lab"
    )
    if (!("error" in draft)) {
      this.payments.advance(
        draft.payment_id,
        "APPROVED",
        "manager@lab",
        "FINANCE_MANAGER"
      )
      this.payments.advance(
        draft.payment_id,
        "INSTRUCTED",
        "finance@lab",
        "FINANCE"
      )
      this.payments.advance(
        draft.payment_id,
        "SETTLED",
        "finance@lab",
        "FINANCE"
      )
    }

    // One payment left mid-flight, so the lifecycle is visible rather than
    // described: the August salary run is approved and nobody has instructed
    // the bank yet.
    const pending = this.payments.request(
      {
        book_id: "CFS",
        unit_id: "C006",
        direction: "OUT",
        occurred_on: "2026-09-01",
        document_on: "2026-09-01",
        posting_on: "2026-09-01",
        counterparty: "Karyawan C006",
        source: { kind: "BANK", bank_account_id: "BCA-TAB-C006" },
        action: "PAY_PAYROLL",
        document_ref: "C006-BKK-26-09-00002",
        allocations: [
          {
            target: { kind: "OPEN_ITEM", item_id: "OI-SAL-08" },
            amount: 5_725_000_000,
          },
        ],
      },
      "clerk@lab"
    )
    if (!("error" in pending)) {
      this.payments.advance(
        pending.payment_id,
        "APPROVED",
        "manager@lab",
        "FINANCE_MANAGER"
      )
    }

    // --- month end --------------------------------------------------------
    this.fire(
      "Reklas kartu belum cair",
      CARD_RECLASS,
      {
        unit_id: "C006",
        acquirer: "BCA_DEBIT",
        bank_account_id: "BCA-TAB-C006",
        // Not a typed figure. It is what the batch register says has not been
        // paid over, which is the only way the reclass and Settlements can
        // agree — and they must, because they are the same money.
        amount: this.cardBatches
          .filter((x) => x.unit_id === "C006" && !x.settled_on)
          .reduce((n, x) => n + x.gross, 0),
      },
      {
        unit_id: "C006",
        on: "2026-07-31",
        document_ref: "C006-GL-26-07-00003",
        source_id: "RECLASS-C006-07",
        step: "reclass",
        memo: "piutang debit card belum cair",
      }
    )
    // Releasing through the action rather than the rule, so the schedule and
    // the ledger move together — the whole point of the registers being state.
    this.releasePrepaid("P-1", "2026-07-31")

    const charges = depreciation
      .run(this.assets, this.treatments, "C006", "2026-07")
      .filter((c) => c.amount > 0)
    this.fire(
      "Depresiasi Juli",
      DEPRECIATION,
      {
        unit_id: "C006",
        charges: charges.map((c) => ({
          asset_class: c.asset_class,
          amount: c.amount,
        })),
      },
      {
        unit_id: "C006",
        on: "2026-07-31",
        document_ref: "GL-26-07-00004",
        source_id: "DEP-C006-2026-07",
        step: "run",
        memo: "DEPRESIASI ASSET JULY 2026",
      }
    )

    this.seedTrade()
  }

  /// Post the month's trade, so the statements and the sales screens agree.
  ///
  /// # Why this had to exist
  ///
  /// `TRADE` — seven days of C006's takings — was read straight by the sales
  /// screens while the ledger held only three sample sales. The result was a
  /// module that reported Rp10.5 billion of revenue on one screen and
  /// Rp18.9 million on the profit and loss, from the same month, with no way to
  /// tell which was the lie. This engine's whole claim is that a figure is
  /// summed from the journal rather than typed twice; a fixture that skipped
  /// the journal broke it.
  ///
  /// The sixth is skipped because a sample sale already posted that day, and
  /// posting the day again would count it twice — which is the same mistake in
  /// the opposite direction.
  private seedTrade() {
    for (const t of TRADE) {
      if (t.on === "2026-07-06") continue
      const net = t.cash + t.card - t.returns
      this.fire(
        `Penjualan ${t.on}`,
        SALE,
        {
          unit_id: "C006",
          net_revenue: net,
          discount: t.returns,
          cost_of_goods: t.cogs,
          tenders: [
            ...(t.cash > 0
              ? [{ method: "CASH" as const, amount: t.cash - t.returns }]
              : []),
            ...(t.card > 0
              ? [
                  {
                    method: "CARD" as const,
                    acquirer: "BCA_DEBIT",
                    amount: t.card,
                  },
                ]
              : []),
          ],
          card_bank: { BCA_DEBIT: "BCA-TAB-C006" },
        },
        {
          unit_id: "C006",
          on: t.on,
          document_ref: `C006-PJ-${t.on.slice(2).replace(/-/g, "")}`,
          source_id: `TRADE-${t.on}`,
          step: "sale",
          memo: `Penjualan harian ${t.on}`,
        }
      )
    }
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
      .find(
        (e) =>
          e.source_kind === "DEPRECIATION" &&
          e.source_id === `DEP-${unit_id}-${month}`
      )
  }

  /// Post a month. Idempotent: a second press returns the first entry.
  runDepreciation(unit_id: string, month: string, actor = "finance@lab") {
    const charges = this.previewDepreciation(unit_id, month).filter(
      (c) => c.amount > 0
    )
    if (charges.length === 0) {
      return {
        ok: false as const,
        code: "BAD_PAYLOAD",
        message: `No aset yang membebankan di ${month}.`,
      }
    }
    const last = `${month}-${new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()}`
    const out = this.fire(
      `Depresiasi ${month}`,
      DEPRECIATION,
      {
        unit_id,
        charges: charges.map((c) => ({
          asset_class: c.asset_class,
          amount: c.amount,
        })),
      },
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
      {
        unit_id: input.unit_id,
        on: input.on,
        document_ref: ref,
        source_id: ref,
        step: "replacement",
        memo: input.description,
      }
    )
    this.changed()
    return out
  }

  /// Reverse an entry. Uses the original accounts; see `Ledger.reverse`.
  reverseEntry(entry_id: string, on: string, reason: string) {
    const r = this.ledger.reverse(
      entry_id,
      on,
      reason,
      "manager@lab",
      "FINANCE_MANAGER"
    )
    this.changed()
    return r
  }

  setPeriod(period: string, closed: boolean) {
    if (closed) this.ledger.closePeriod("CFS", period, "manager@lab")
    else this.ledger.reopenPeriod("CFS", period)
    this.changed()
  }

  private oeSeq = 1
  private newSeq = 1

  // -------------------------------------------------------------------------
  // Creating records
  // -------------------------------------------------------------------------

  /// Raise an accrual: recognise the cost and open the obligation.
  ///
  /// One action, two effects, and they are not separable — an obligation with
  /// no journal behind it is a number somebody typed, and a journal with no
  /// obligation cannot be allocated against when the payment comes.
  createAccrual(input: {
    unit_id: string
    kind: "SALARY" | "BENEFIT"
    counterparty: string
    description: string
    amount: Minor
    on: string
    due_on?: string
  }) {
    const id = `OI-NEW-${this.newSeq++}`
    const out = this.fire(
      `Accrual — ${input.description}`,
      PAYROLL_ACCRUAL,
      {
        unit_id: input.unit_id,
        salary: input.kind === "SALARY" ? input.amount : 0,
        benefits: input.kind === "BENEFIT" ? input.amount : 0,
        outside_help: 0,
      },
      {
        unit_id: input.unit_id,
        on: input.on,
        document_ref: `${input.unit_id}-GL-SIM-${this.newSeq}`,
        source_id: id,
        step: "accrual",
        memo: input.description,
      }
    )
    if (out.ok) {
      this.payments.open({
        item_id: id,
        kind: "ACCRUAL",
        book_id: "CFS",
        unit_id: input.unit_id,
        role: input.kind === "SALARY" ? "SALARY_ACCRUAL" : "BENEFIT_ACCRUAL",
        narrows: {},
        counterparty: input.counterparty,
        description: input.description,
        opened_on: input.on,
        due_on: input.due_on,
        original: input.amount,
        source_ref: out.entry.document_ref,
      })
    }
    this.changed()
    return out
  }

  /// Draft a payment against open items. Nothing posts until it settles.
  createPayment(input: {
    unit_id: string
    counterparty: string
    source:
      | { kind: "BANK"; bank_account_id: string }
      | { kind: "PETTY_CASH" }
      | { kind: "CASH" }
    on: string
    items: readonly { item_id: string; amount: Minor }[]
  }) {
    const draft = this.payments.request(
      {
        book_id: "CFS",
        unit_id: input.unit_id,
        direction: "OUT",
        occurred_on: input.on,
        document_on: input.on,
        posting_on: input.on,
        counterparty: input.counterparty,
        source: input.source,
        action: "PAY_BILL",
        document_ref: `${input.unit_id}-BKK-SIM-${this.newSeq++}`,
        allocations: input.items.map((i) => ({
          target: { kind: "OPEN_ITEM" as const, item_id: i.item_id },
          amount: i.amount,
        })),
      },
      "clerk@lab"
    )
    this.changed()
    return draft
  }

  /// Register an asset. GA's action, and it posts nothing — that is the point.
  registerAsset(input: {
    name: string
    unit_id: string
    asset_class: string
    quantity: number
    document_on: string
    location: string
    custodian: string
  }) {
    const n = this.assets.length + 1
    this.assets.push({
      asset_id: `A-NEW-${this.newSeq++}`,
      asset_number: `AST-${input.unit_id}-${String(n).padStart(4, "0")}`,
      name: input.name,
      unit_id: input.unit_id,
      asset_class: input.asset_class,
      quantity: input.quantity,
      document_on: input.document_on,
      register_on: `${input.document_on.slice(0, 7)}-01`,
      location: input.location,
      custodian: input.custodian || "—",
      condition: "NEW",
      photo_count: 0,
      status: "RECEIVED",
    })
    this.changed()
  }

  /// Complete an asset's physical data. Still no posting.
  completeAsset(
    asset_id: string,
    patch: {
      location?: string
      custodian?: string
      condition?: AssetFact["condition"]
    }
  ) {
    const i = this.assets.findIndex((a) => a.asset_id === asset_id)
    if (i < 0) return
    this.assets[i] = { ...this.assets[i], ...patch, status: "IN_SERVICE" }
    this.changed()
  }

  // -------------------------------------------------------------------------
  // Store expense review
  // -------------------------------------------------------------------------

  storeExpenses: StoreExpense[] = [...STORE_EXPENSES]
  inquiries: Inquiry[] = [...INQUIRIES]

  raiseInquiry(batch_id: string, note: string) {
    this.inquiries = [
      ...this.inquiries,
      {
        inquiry_id: `Q-${this.inquiries.length + 1}`,
        batch_id,
        raised_on: "2026-08-01",
        raised_by: "finance@lab",
        status: "OPEN",
        note,
      },
    ]
    this.changed()
  }

  closeInquiry(
    inquiry_id: string,
    status: "ANSWERED" | "RESOLVED",
    note?: string
  ) {
    this.inquiries = this.inquiries.map((q) =>
      q.inquiry_id === inquiry_id
        ? { ...q, status, answered_on: "2026-08-01", note: note ?? q.note }
        : q
    )
    this.changed()
  }

  reviewExpense(
    expense_id: string,
    decision: "APPROVED" | "REJECTED",
    note?: string
  ) {
    this.storeExpenses = this.storeExpenses.map((e) =>
      e.expense_id === expense_id
        ? { ...e, status: decision, note: note ?? e.note }
        : e
    )
    this.changed()
  }

  /// Post an approved store expense against petty cash.
  postExpense(expense_id: string) {
    const e = this.storeExpenses.find((x) => x.expense_id === expense_id)
    if (!e)
      return {
        ok: false as const,
        code: "BAD_PAYLOAD",
        message: "expense not found",
      }
    const outcome = this.ledger.post({
      book_id: "CFS",
      occurred_on: e.on,
      document_on: e.on,
      posting_on: e.on,
      source_kind: "PAYMENT",
      source_id: e.expense_id,
      document_ref: `${e.unit_id}-BKK-EXP-${e.expense_id}`,
      rule_version: "store_expense@1",
      memo: e.description,
      lines: [
        {
          side: "DEBIT",
          role: "HOUSEKEEPING_EXPENSE",
          dims: { unit_id: e.unit_id },
          amount: e.amount,
          memo: e.description,
        },
        {
          side: "CREDIT",
          role: "PETTY_CASH",
          dims: { unit_id: e.unit_id },
          amount: e.amount,
        },
      ],
      idempotency_key: `${e.expense_id}/expense`,
      actor: "finance@lab",
      actor_role: "FINANCE",
    })
    if (outcome.ok) {
      this.storeExpenses = this.storeExpenses.map((x) =>
        x.expense_id === expense_id ? { ...x, status: "POSTED" } : x
      )
    }
    this.changed()
    return outcome
  }

  // -------------------------------------------------------------------------
  // Bank reconciliation
  // -------------------------------------------------------------------------

  /// Entries already claimed by a line, so one journal cannot answer two.
  private takenEntries(): ReadonlySet<string> {
    return new Set(
      this.bankLines.filter((l) => l.entry_id).map((l) => l.entry_id as string)
    )
  }

  matchesFor(line: BankLine): readonly Candidate[] {
    const taken = new Set(
      [...this.takenEntries()].filter((id) => id !== line.entry_id)
    )
    return candidates(line, this.ledger.allEntries(), taken)
  }

  suggestFor(line: BankLine) {
    return suggest(line)
  }

  /// Link a line to an entry the books already have. Writes no journal.
  matchLine(line_id: string, entry_id: string) {
    this.bankLines = this.bankLines.map((l) =>
      l.line_id === line_id
        ? { ...l, status: "POSTED", entry_id, resolution: "MATCHED" }
        : l
    )
    this.changed()
  }

  /// Categorise a line the books do not have, and post it.
  ///
  /// Goes through `Ledger.post` like everything else — the bank screen is not
  /// allowed its own door into the journal.
  postLine(line_id: string, role: string, memo: string) {
    const line = this.bankLines.find((l) => l.line_id === line_id)
    if (!line)
      return {
        ok: false as const,
        code: "BAD_PAYLOAD",
        message: "baris tidak ada",
      }
    const bankBinding = this.ledger
      .allBindings()
      .find(
        (b) =>
          b.role === "BANK" &&
          b.narrows.bank_account_id === line.bank_account_id
      )
    if (!bankBinding) {
      return {
        ok: false as const,
        code: "ACCOUNT_UNRESOLVED",
        message: "rekening bank belum dipetakan",
      }
    }
    const unit = bankBinding.narrows.unit_id
    const outcome = this.ledger.post({
      book_id: "CFS",
      occurred_on: line.on,
      document_on: line.on,
      posting_on: line.on,
      source_kind: "BANK_STATEMENT",
      source_id: line.line_id,
      document_ref: line.reference ?? line.line_id,
      rule_version: "bank_line@1",
      memo,
      lines:
        line.direction === "OUT"
          ? [
              {
                side: "DEBIT",
                role: role as never,
                dims: { unit_id: unit },
                amount: line.amount,
                memo,
              },
              {
                side: "CREDIT",
                role: "BANK",
                dims: { unit_id: unit, bank_account_id: line.bank_account_id },
                amount: line.amount,
              },
            ]
          : [
              {
                side: "DEBIT",
                role: "BANK",
                dims: { unit_id: unit, bank_account_id: line.bank_account_id },
                amount: line.amount,
              },
              {
                side: "CREDIT",
                role: role as never,
                dims: { unit_id: unit },
                amount: line.amount,
                memo,
              },
            ],
      idempotency_key: `${line.line_id}/bank`,
      actor: "finance@lab",
      actor_role: "FINANCE",
    })
    if (outcome.ok) {
      this.bankLines = this.bankLines.map((l) =>
        l.line_id === line_id
          ? {
              ...l,
              status: "POSTED",
              entry_id: outcome.entry.entry_id,
              resolution: "POSTED",
            }
          : l
      )
    }
    this.changed()
    return outcome
  }

  /// Who the money went to or came from. Not derived from the description:
  /// bank narratives are abbreviated beyond recognition, and a guess here is a
  /// counterparty on a journal line that nobody can defend.
  setCounterparty(line_id: string, counterparty: string) {
    this.bankLines = this.bankLines.map((l) =>
      l.line_id === line_id
        ? { ...l, counterparty: counterparty || undefined }
        : l
    )
    this.changed()
  }

  bankRules(): readonly BankRule[] {
    return rules()
  }

  addBankRule(r: {
    contains: string
    role: string
    label: string
    counterparty?: string
  }) {
    const rule = addRule({ ...r, created_by: "finance@lab" })
    this.changed()
    return rule
  }

  removeBankRule(rule_id: string) {
    removeRule(rule_id)
    this.changed()
  }

  /// One statement line, several costs. The client's own BKK does this
  /// routinely — a single withdrawal covering parking, water and a fire
  /// extinguisher refill — so a screen that could only post a line to one
  /// account would send somebody to a manual journal for an ordinary Tuesday.
  splitLine(
    line_id: string,
    parts: readonly { role: string; amount: Minor; memo: string }[]
  ) {
    const line = this.bankLines.find((l) => l.line_id === line_id)
    if (!line)
      return {
        ok: false as const,
        code: "BAD_PAYLOAD",
        message: "line not found",
      }
    const total = parts.reduce((n, p) => n + p.amount, 0)
    if (total !== line.amount) {
      return {
        ok: false as const,
        code: "UNBALANCED",
        message: `the split totals ${total / 100} and the line is ${line.amount / 100}`,
      }
    }
    const bankBinding = this.ledger
      .allBindings()
      .find(
        (b) =>
          b.role === "BANK" &&
          b.narrows.bank_account_id === line.bank_account_id
      )
    if (!bankBinding) {
      return {
        ok: false as const,
        code: "ACCOUNT_UNRESOLVED",
        message: "bank account is not mapped",
      }
    }
    const unit = bankBinding.narrows.unit_id
    const outcome = this.ledger.post({
      book_id: "CFS",
      occurred_on: line.on,
      document_on: line.on,
      posting_on: line.on,
      source_kind: "BANK_STATEMENT",
      source_id: line.line_id,
      document_ref: line.reference ?? line.line_id,
      rule_version: "bank_line_split@1",
      memo: line.description,
      lines: [
        ...parts.map((p) => ({
          side: (line.direction === "OUT" ? "DEBIT" : "CREDIT") as
            "DEBIT" | "CREDIT",
          role: p.role as never,
          dims: { unit_id: unit },
          amount: p.amount,
          memo: p.memo,
        })),
        {
          side: (line.direction === "OUT" ? "CREDIT" : "DEBIT") as
            "DEBIT" | "CREDIT",
          role: "BANK" as never,
          dims: { unit_id: unit, bank_account_id: line.bank_account_id },
          amount: line.amount,
        },
      ],
      idempotency_key: `${line.line_id}/split`,
      actor: "finance@lab",
      actor_role: "FINANCE",
    })
    if (outcome.ok) {
      this.bankLines = this.bankLines.map((l) =>
        l.line_id === line_id
          ? {
              ...l,
              status: "POSTED",
              entry_id: outcome.entry.entry_id,
              resolution: "POSTED",
            }
          : l
      )
    }
    this.changed()
    return outcome
  }

  excludeLine(line_id: string, reason: string) {
    this.bankLines = this.bankLines.map((l) =>
      l.line_id === line_id
        ? { ...l, status: "EXCLUDED", excluded_reason: reason }
        : l
    )
    this.changed()
  }

  restoreLine(line_id: string) {
    this.bankLines = this.bankLines.map((l) =>
      l.line_id === line_id
        ? {
            ...l,
            status: "PENDING",
            entry_id: undefined,
            resolution: undefined,
            excluded_reason: undefined,
          }
        : l
    )
    this.changed()
  }

  /// Import a bank export. Rows already held are skipped by date + amount +
  /// description, so re-uploading the same file twice adds nothing.
  importStatement(bank_account_id: string, csv: string) {
    const parsed = parseCsv(csv)
    const seen = new Set(
      this.bankLines.map(
        (l) => `${l.bank_account_id}|${l.on}|${l.amount}|${l.description}`
      )
    )
    let added = 0
    let duplicate = 0
    for (const l of parsed.lines) {
      const key = `${bank_account_id}|${l.on}|${l.amount}|${l.description}`
      if (seen.has(key)) {
        duplicate += 1
        continue
      }
      seen.add(key)
      this.bankLines = [
        ...this.bankLines,
        { ...l, bank_account_id, status: "PENDING" },
      ]
      added += 1
    }
    this.changed()
    return {
      added,
      duplicate,
      skipped: parsed.skipped,
      problems: parsed.problems,
    }
  }

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
        (a) =>
          paidFor.has(a.asset_id) &&
          (a.status === "RECEIVED" || a.custodian === "—")
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

  // -- the subledger actions ------------------------------------------------
  //
  // Every one of these does the same two things in the same order: post
  // through a rule, and only if that succeeded, move the register. The order
  // matters. A register that moves on a refused posting is a screen telling
  // somebody a bill is paid when the ledger says it is not, and that is the
  // failure mode this whole engine exists to prevent.

  private seq = 0

  private ref(prefix: string, unit: string) {
    this.seq += 1
    return `${unit}-${prefix}-SIM-${String(this.seq).padStart(5, "0")}`
  }

  /// Bank account to use when a caller has not named one. The unit's own BCA
  /// savings, which is where this client's units actually keep money.
  private bankOf(unit_id: string) {
    return `BCA-TAB-${unit_id}`
  }

  recogniseBill(input: {
    number: string
    supplier: string
    unit_id: string
    kind: Bill["kind"]
    issued_on: string
    due_on: string
    total: Minor
  }) {
    const ref = this.ref("INV", input.unit_id)
    const out = this.fire(
      `Bill — ${input.supplier}`,
      BILL,
      { unit_id: input.unit_id, kind: input.kind, amount: input.total },
      {
        unit_id: input.unit_id,
        on: input.issued_on,
        document_ref: input.number,
        source_id: ref,
        step: "bill",
        memo: input.number,
      }
    )
    if (out.ok) {
      this.bills = [
        ...this.bills,
        {
          bill_id: ref,
          number: input.number,
          supplier: input.supplier,
          unit_id: input.unit_id,
          kind: input.kind,
          issued_on: input.issued_on,
          due_on: input.due_on,
          total: input.total,
          paid: 0,
          status: "OPEN",
        },
      ]
      this.changed()
    }
    return out
  }

  payBill(bill_id: string, bank_account_id?: string, on = "2026-08-01") {
    const b = this.bills.find((x) => x.bill_id === bill_id)
    if (!b)
      return {
        ok: false as const,
        code: "NOT_FOUND",
        message: `No bill ${bill_id}.`,
      }
    const left = b.total - b.paid
    if (left <= 0)
      return {
        ok: false as const,
        code: "ALREADY_PAID",
        message: `${b.number} is settled.`,
      }
    const bank = bank_account_id ?? this.bankOf(b.unit_id)
    const out = this.fire(
      `Pay ${b.number}`,
      BILL_PAYMENT,
      { unit_id: b.unit_id, kind: b.kind, amount: left, bank_account_id: bank },
      {
        unit_id: b.unit_id,
        on,
        document_ref: this.ref("BKK", b.unit_id),
        source_id: `PAY-${bill_id}`,
        step: "payment",
        memo: `Pembayaran ${b.number}`,
      }
    )
    if (out.ok) {
      this.bills = this.bills.map((x) =>
        x.bill_id === bill_id
          ? { ...x, paid: x.total, status: "PAID" as const }
          : x
      )
      this.changed()
    }
    return out
  }

  payTax(tax_id: string, on = "2026-08-01") {
    const t = this.taxPositions.find((x) => x.id === tax_id)
    if (!t)
      return {
        ok: false as const,
        code: "NOT_FOUND",
        message: `No tax position ${tax_id}.`,
      }
    const due = t.payable - t.prepaid
    if (due <= 0)
      return {
        ok: false as const,
        code: "NOTHING_DUE",
        message: `${t.kind} ${t.period} is in credit; nothing to remit.`,
      }
    const out = this.fire(
      `File ${t.kind} ${t.period}`,
      TAX_PAYMENT,
      {
        unit_id: t.unit_id,
        tax_kind: TAX_KIND[t.kind] ?? "PPH_25",
        amount: due,
        bank_account_id: this.bankOf(t.unit_id),
      },
      {
        unit_id: t.unit_id,
        on,
        document_ref: this.ref("PJK", t.unit_id),
        source_id: `TAX-${tax_id}`,
        step: "remit",
        memo: `${t.kind} ${t.period}`,
      }
    )
    if (out.ok) {
      this.taxPositions = this.taxPositions.map((x) =>
        x.id === tax_id ? { ...x, filed_on: on } : x
      )
      this.changed()
    }
    return out
  }

  issueAdvance(input: {
    holder: string
    unit_id: string
    purpose: string
    amount: Minor
    on?: string
  }) {
    const on = input.on ?? "2026-08-01"
    const ref = this.ref("UM", input.unit_id)
    const out = this.fire(
      `Advance — ${input.holder}`,
      ADVANCE_ISSUE,
      {
        unit_id: input.unit_id,
        amount: input.amount,
        bank_account_id: this.bankOf(input.unit_id),
      },
      {
        unit_id: input.unit_id,
        on,
        document_ref: ref,
        source_id: ref,
        step: "issue",
        memo: input.purpose,
      }
    )
    if (out.ok) {
      this.advances = [
        ...this.advances,
        {
          advance_id: ref,
          holder: input.holder,
          unit_id: input.unit_id,
          issued_on: on,
          purpose: input.purpose,
          amount: input.amount,
          liquidated: 0,
        },
      ]
      this.changed()
    }
    return out
  }

  liquidateAdvance(advance_id: string, amount: Minor, on = "2026-08-01") {
    const a = this.advances.find((x) => x.advance_id === advance_id)
    if (!a)
      return {
        ok: false as const,
        code: "NOT_FOUND",
        message: `No advance ${advance_id}.`,
      }
    const left = a.amount - a.liquidated
    const take = Math.min(amount > 0 ? amount : left, left)
    if (take <= 0)
      return {
        ok: false as const,
        code: "NOTHING_OPEN",
        message: `${a.holder} has nothing outstanding.`,
      }
    const out = this.fire(
      `Liquidate — ${a.holder}`,
      ADVANCE_LIQUIDATION,
      { unit_id: a.unit_id, amount: take },
      {
        unit_id: a.unit_id,
        on,
        document_ref: this.ref("GL", a.unit_id),
        source_id: `LIQ-${advance_id}-${a.liquidated}`,
        step: "liquidate",
        memo: a.purpose,
      }
    )
    if (out.ok) {
      this.advances = this.advances.map((x) =>
        x.advance_id === advance_id
          ? { ...x, liquidated: x.liquidated + take }
          : x
      )
      this.changed()
    }
    return out
  }

  releasePrepaid(prepaid_id: string, on = "2026-08-31") {
    const p = this.prepaids.find((x) => x.prepaid_id === prepaid_id)
    if (!p)
      return {
        ok: false as const,
        code: "NOT_FOUND",
        message: `No schedule ${prepaid_id}.`,
      }
    if (p.released_months >= p.months) {
      return {
        ok: false as const,
        code: "FULLY_RELEASED",
        message: `${p.description} is fully released.`,
      }
    }
    const monthly = Math.floor(p.total / p.months / 100) * 100
    const out = this.fire(
      `Release — ${p.description}`,
      PREPAID_RELEASE,
      { unit_id: p.unit_id, amount: monthly },
      {
        unit_id: p.unit_id,
        on,
        document_ref: this.ref("GL", p.unit_id),
        source_id: `PREPAID-${prepaid_id}-${p.released_months + 1}`,
        step: "release",
        memo: p.description,
      }
    )
    if (out.ok) {
      this.prepaids = this.prepaids.map((x) =>
        x.prepaid_id === prepaid_id
          ? { ...x, released_months: x.released_months + 1 }
          : x
      )
      this.changed()
    }
    return out
  }

  /// Receiving a delivery. Expected to be REFUSED, and that is the point.
  ///
  /// `interunit_receipt` is off because the journal that would clear BDP has
  /// never been supplied — 147 dispatches in July raised it by Rp470,488,453
  /// and not one credit came back. Wiring the button to a rule that refuses is
  /// better than leaving it dead: the refusal names the missing evidence, on
  /// the screen, to the person who could go and ask for it.
  receiveShipment(shipment_id: string, on = "2026-08-01") {
    const sh = this.shipments.find((x) => x.shipment_id === shipment_id)
    if (!sh)
      return {
        ok: false as const,
        code: "NOT_FOUND",
        message: `No dispatch ${shipment_id}.`,
      }
    const out = this.fire(
      `Receive ${sh.reference}`,
      RECEIPT,
      { unit_id: sh.to_unit, from_unit_id: sh.from_unit, amount: sh.value },
      {
        unit_id: sh.to_unit,
        on,
        document_ref: sh.reference,
        source_id: `RCV-${shipment_id}`,
        step: "receipt",
        memo: sh.reference,
      }
    )
    if (out.ok) {
      this.shipments = this.shipments.map((x) =>
        x.shipment_id === shipment_id ? { ...x, received_on: on } : x
      )
      this.changed()
    }
    return out
  }

  capitaliseProject(
    project_id: string,
    asset_class = "FFE_TOKO",
    on = "2026-08-01"
  ) {
    const p = this.projects.find((x) => x.project_id === project_id)
    if (!p)
      return {
        ok: false as const,
        code: "NOT_FOUND",
        message: `No project ${project_id}.`,
      }
    if (p.status === "CAPITALISED") {
      return {
        ok: false as const,
        code: "ALREADY_CAPITALISED",
        message: `${p.name} is already an asset.`,
      }
    }
    const out = this.fire(
      `Capitalise — ${p.name}`,
      CAPITALISATION,
      { unit_id: p.unit_id, asset_class, amount: p.spent },
      {
        unit_id: p.unit_id,
        on,
        document_ref: this.ref("GL", p.unit_id),
        source_id: `CAP-${project_id}`,
        step: "capitalise",
        memo: p.name,
      }
    )
    if (out.ok) {
      this.projects = this.projects.map((x) =>
        x.project_id === project_id
          ? { ...x, status: "CAPITALISED" as const, capitalised_on: on }
          : x
      )
      this.changed()
    }
    return out
  }

  reviewAdjustment(adj_id: string, decision: "APPROVED" | "SUBMITTED") {
    this.stockAdjustments = this.stockAdjustments.map((x) =>
      x.adj_id === adj_id ? { ...x, status: decision } : x
    )
    this.changed()
    return { ok: true as const }
  }

  postStockAdjustment(adj_id: string) {
    const a = this.stockAdjustments.find((x) => x.adj_id === adj_id)
    if (!a)
      return {
        ok: false as const,
        code: "NOT_FOUND",
        message: `No adjustment ${adj_id}.`,
      }
    if (a.status === "POSTED")
      return {
        ok: false as const,
        code: "ALREADY_POSTED",
        message: `${a.reference} is posted.`,
      }
    const out = this.fire(
      `Adjust — ${a.reference}`,
      STOCK_ADJUSTMENT,
      { unit_id: a.unit_id, cost: a.cost, residual: a.residual },
      {
        unit_id: a.unit_id,
        on: a.on,
        document_ref: a.reference,
        source_id: `ADJ-${adj_id}`,
        step: "adjust",
        memo: a.note ?? a.kind,
      }
    )
    if (out.ok) {
      this.stockAdjustments = this.stockAdjustments.map((x) =>
        x.adj_id === adj_id ? { ...x, status: "POSTED" as const } : x
      )
      this.changed()
    }
    return out
  }

  payInstalment(n: number, on = "2026-08-01") {
    const i = this.loanSchedule.find((x) => x.n === n)
    if (!i)
      return {
        ok: false as const,
        code: "NOT_FOUND",
        message: `No instalment ${n}.`,
      }
    if (i.paid_on)
      return {
        ok: false as const,
        code: "ALREADY_PAID",
        message: `Instalment ${n} was paid on ${i.paid_on}.`,
      }
    const out = this.fire(
      `Instalment ${n}`,
      LOAN_REPAYMENT,
      {
        unit_id: "HO",
        interest: i.interest,
        principal: i.principal,
        bank_account_id: this.bankOf("HO"),
      },
      {
        unit_id: "HO",
        on,
        document_ref: this.ref("BKK", "HO"),
        source_id: `LOAN-${i.loan_id}-${n}`,
        step: "instalment",
        memo: `Angsuran ${n}`,
      }
    )
    if (out.ok) {
      this.loanSchedule = this.loanSchedule.map((x) =>
        x.n === n ? { ...x, paid_on: on } : x
      )
      this.changed()
    }
    return out
  }

  recordEquity(input: {
    kind: EquityMove["kind"]
    unit_id: string
    amount: Minor
    on?: string
    note?: string
  }) {
    const on = input.on ?? "2026-08-01"
    if (input.kind !== "Modal Setor" && input.kind !== "Prive") {
      return {
        ok: false as const,
        code: "SYSTEM_ACCOUNT",
        message: `${input.kind} is produced by the period close. Editing it by hand would break the two.`,
      }
    }
    const signed =
      input.kind === "Prive" ? -Math.abs(input.amount) : Math.abs(input.amount)
    const out = this.fire(
      input.kind,
      EQUITY_MOVEMENT,
      {
        unit_id: input.unit_id,
        amount: signed,
        bank_account_id: this.bankOf(input.unit_id),
      },
      {
        unit_id: input.unit_id,
        on,
        document_ref: this.ref("GL", input.unit_id),
        source_id: `EQ-${this.seq}`,
        step: "equity",
        memo: input.note ?? input.kind,
      }
    )
    if (out.ok) {
      this.equityMoves = [
        ...this.equityMoves,
        {
          id: `EQ-${this.seq}`,
          on,
          kind: input.kind,
          account:
            input.kind === "Prive"
              ? `3013001004${SUFFIX[input.unit_id] ?? "00"}`
              : `3013001001${SUFFIX[input.unit_id] ?? "00"}`,
          unit_id: input.unit_id,
          amount: signed,
          origin: "OWNER",
          note: input.note,
        },
      ]
      this.changed()
    }
    return out
  }

  runPayroll(unit_id: string, period: string, on = "2026-08-31") {
    const r = this.payrollRuns.find(
      (x) => x.unit_id === unit_id && x.period === period
    )
    if (!r)
      return {
        ok: false as const,
        code: "NOT_FOUND",
        message: `No run for ${unit_id} ${period}.`,
      }
    if (
      r.status !== "DRAFT" &&
      this.payrollPayables.some(
        (p) => p.unit_id === unit_id && p.period === period
      )
    ) {
      return {
        ok: false as const,
        code: "ALREADY_RUN",
        message: `${unit_id} ${period} is already accrued.`,
      }
    }
    const out = this.fire(
      `Payroll ${unit_id} ${period}`,
      PAYROLL_ACCRUAL,
      {
        unit_id,
        salary: r.basic + r.allowance + r.overtime,
        benefits: r.bpjs_employer,
        outside_help: 0,
      },
      {
        unit_id,
        on,
        document_ref: this.ref("GL", unit_id),
        source_id: `PAYROLL-${unit_id}-${period}`,
        step: "accrual",
        memo: `Gaji ${period}`,
      }
    )
    if (out.ok) {
      this.payrollRuns = this.payrollRuns.map((x) =>
        x.run_id === r.run_id ? { ...x, status: "POSTED" as const } : x
      )
      this.changed()
    }
    return out
  }

  settlePayrollPayable(id: string, on = "2026-08-05") {
    const p = this.payrollPayables.find((x) => x.id === id)
    if (!p)
      return {
        ok: false as const,
        code: "NOT_FOUND",
        message: `No payable ${id}.`,
      }
    const left = p.amount - p.settled
    if (left <= 0)
      return {
        ok: false as const,
        code: "ALREADY_SETTLED",
        message: `${p.kind} is settled.`,
      }
    // PPh 21 is remitted to the state, not paid to anybody on the payroll, so
    // it clears through the tax rule and lands on the tax account.
    const isTax = p.kind.includes("PPh")
    const out = isTax
      ? this.fire(
          `Remit ${p.kind}`,
          TAX_PAYMENT,
          {
            unit_id: p.unit_id,
            tax_kind: "PPH_21",
            amount: left,
            bank_account_id: this.bankOf(p.unit_id),
          },
          {
            unit_id: p.unit_id,
            on,
            document_ref: this.ref("PJK", p.unit_id),
            source_id: `PAYTAX-${id}`,
            step: "remit",
            memo: p.kind,
          }
        )
      : this.fire(
          `Pay ${p.kind}`,
          PAYROLL_PAYMENT,
          {
            unit_id: p.unit_id,
            amount: left,
            bank_account_id: this.bankOf(p.unit_id),
            leg:
              p.kind.startsWith("Gaji") || p.kind.startsWith("THR")
                ? "SALARY"
                : "BENEFIT",
          },
          {
            unit_id: p.unit_id,
            on,
            document_ref: this.ref("BKK", p.unit_id),
            source_id: `PAYROLL-PAY-${id}`,
            step: "payment",
            memo: p.kind,
          }
        )
    if (out.ok) {
      this.payrollPayables = this.payrollPayables.map((x) =>
        x.id === id ? { ...x, settled: x.amount } : x
      )
      this.changed()
    }
    return out
  }

  amortisePreOpening(id: string, on = "2026-08-31") {
    const p = this.preOpening.find((x) => x.id === id)
    if (!p)
      return {
        ok: false as const,
        code: "NOT_FOUND",
        message: `No pre-opening ${id}.`,
      }
    if (p.amortised_months >= p.months) {
      return {
        ok: false as const,
        code: "FULLY_AMORTISED",
        message: `${p.unit_id} is fully written off.`,
      }
    }
    const monthly = Math.round(p.cost / p.months / 100) * 100
    const out = this.fire(
      `Amortise pre-opening ${p.unit_id}`,
      PREOPENING_AMORTISATION,
      { unit_id: p.unit_id, amount: monthly },
      {
        unit_id: p.unit_id,
        on,
        document_ref: this.ref("GL", p.unit_id),
        source_id: `PREOP-${id}-${p.amortised_months + 1}`,
        step: "amortise",
        memo: `Pre-opening ${p.unit_id}`,
      }
    )
    if (out.ok) {
      this.preOpening = this.preOpening.map((x) =>
        x.id === id ? { ...x, amortised_months: x.amortised_months + 1 } : x
      )
      this.changed()
    }
    return out
  }

  recordDeposit(day_id: string) {
    const d = this.storeDays.find((x) => x.day_id === day_id)
    if (!d)
      return {
        ok: false as const,
        code: "NOT_FOUND",
        message: `No trading day ${day_id}.`,
      }
    if (d.deposited > 0)
      return {
        ok: false as const,
        code: "ALREADY_BANKED",
        message: `${d.on} was banked.`,
      }
    const out = this.fire(
      `Deposit ${d.on}`,
      DEPOSIT,
      {
        unit_id: d.unit_id,
        to_unit_id: "HO",
        amount: d.counted_cash,
        from: "CASH_ON_HAND",
      },
      {
        unit_id: d.unit_id,
        on: d.on,
        document_ref: this.ref("BKK", d.unit_id),
        source_id: `DEP-${day_id}`,
        step: "deposit",
        memo: "penyetoran hasil penjualan",
      }
    )
    if (out.ok) {
      this.storeDays = this.storeDays.map((x) =>
        x.day_id === day_id
          ? { ...x, deposited: x.counted_cash, deposited_on: x.on }
          : x
      )
      this.changed()
    }
    return out
  }

  settleBatch(batch_id: string, on = "2026-08-01") {
    const b = this.cardBatches.find((x) => x.batch_id === batch_id)
    if (!b)
      return {
        ok: false as const,
        code: "NOT_FOUND",
        message: `No batch ${batch_id}.`,
      }
    if (b.settled_on)
      return {
        ok: false as const,
        code: "ALREADY_SETTLED",
        message: `${batch_id} settled on ${b.settled_on}.`,
      }
    const out = this.fire(
      `Settle ${batch_id}`,
      CARD_SETTLEMENT,
      {
        unit_id: b.unit_id,
        acquirer: "BCA_DEBIT",
        bank_account_id: b.settles_into,
        gross: b.gross,
        fee: b.fee,
      },
      {
        unit_id: b.unit_id,
        on,
        document_ref: this.ref("BKM", b.unit_id),
        source_id: `SETTLE-${batch_id}`,
        step: "settlement",
        memo: `${b.acquirer} ${batch_id}`,
      }
    )
    if (out.ok) {
      this.cardBatches = this.cardBatches.map((x) =>
        x.batch_id === batch_id
          ? { ...x, settled_on: on, settled_net: x.gross - x.fee }
          : x
      )
      this.changed()
    }
    return out
  }

  fundUnit(input: {
    to_unit: string
    amount: Minor
    funding_type: "AFFILIATE_FINANCING" | "PRINCIPAL_REIMBURSEMENT"
    reference: string
    on?: string
  }) {
    const on = input.on ?? "2026-08-01"
    const ref = this.ref("BKM", input.to_unit)
    const out = this.fire(
      `Fund ${input.to_unit}`,
      FUNDING,
      {
        unit_id: input.to_unit,
        from_unit_id: "HO",
        amount: input.amount,
        funding_type: input.funding_type,
        into: "BANK",
        bank_account_id: this.bankOf(input.to_unit),
      },
      {
        unit_id: input.to_unit,
        on,
        document_ref: ref,
        source_id: ref,
        step: "funding",
        memo: input.reference,
      }
    )
    if (out.ok) {
      this.interunitMoves = [
        ...this.interunitMoves,
        {
          move_id: ref,
          on,
          from_unit: "HO",
          to_unit: input.to_unit,
          family:
            input.funding_type === "PRINCIPAL_REIMBURSEMENT"
              ? "PRINCIPAL"
              : "FINANCING",
          reference: input.reference,
          amount: input.amount,
          settled: 0,
        },
      ]
      this.changed()
    }
    return out
  }

  createProject(input: {
    name: string
    unit_id: string
    budget: Minor
    started_on?: string
  }) {
    const id = this.ref("PRJ", input.unit_id)
    this.projects = [
      ...this.projects,
      {
        project_id: id,
        name: input.name,
        unit_id: input.unit_id,
        started_on: input.started_on ?? "2026-08-01",
        budget: input.budget,
        spent: 0,
        status: "OPEN",
      },
    ]
    this.changed()
    return { ok: true as const }
  }

  createPrepaid(input: {
    description: string
    unit_id: string
    total: Minor
    months: number
    starts_on: string
  }) {
    if (input.months <= 0) {
      return {
        ok: false as const,
        code: "BAD_TERM",
        message: "A schedule needs a term in months.",
      }
    }
    const id = this.ref("PRE", input.unit_id)
    const out = this.fire(
      `Prepaid — ${input.description}`,
      PREPAID_PAID,
      {
        unit_id: input.unit_id,
        amount: input.total,
        bank_account_id: this.bankOf(input.unit_id),
      },
      {
        unit_id: input.unit_id,
        on: input.starts_on,
        document_ref: id,
        source_id: id,
        step: "prepay",
        memo: input.description,
      }
    )
    if (out.ok) {
      this.prepaids = [
        ...this.prepaids,
        {
          prepaid_id: id,
          description: input.description,
          unit_id: input.unit_id,
          account: `1011301003${SUFFIX[input.unit_id] ?? "00"}`,
          starts_on: input.starts_on,
          months: input.months,
          total: input.total,
          released_months: 0,
        },
      ]
      this.changed()
    }
    return out
  }

  /// A trading party. No posting: a master record is not an event.
  createVendor(input: {
    name: string
    kind: "MERCHANDISE" | "SERVICE" | "UTILITY"
    terms_days?: number
    bank?: string
  }) {
    if (
      this.vendors.some(
        (v) => v.name.toLowerCase() === input.name.trim().toLowerCase()
      )
    ) {
      return {
        ok: false as const,
        code: "DUPLICATE",
        message: `${input.name} is already on the list.`,
      }
    }
    this.vendors = [
      ...this.vendors,
      {
        vendor_id: `V-${this.vendors.length + 1}`,
        name: input.name.trim(),
        kind: input.kind,
        terms_days: input.terms_days,
        bank: input.bank,
      },
    ]
    this.changed()
    return { ok: true as const }
  }

  /// Write a giro against a bill.
  ///
  /// The bill is settled from the supplier's point of view and the debt moves
  /// to whoever presents the paper. Nothing leaves the bank until it clears,
  /// which is what the register's `OUTSTANDING` status means and what makes
  /// the bank statement disagree with the book in the meantime.
  issueGiro(input: {
    bill_id: string
    number: string
    bank_account_id: string
    value_on: string
    issued_on?: string
  }) {
    const bill = this.bills.find((x) => x.bill_id === input.bill_id)
    if (!bill)
      return {
        ok: false as const,
        code: "NOT_FOUND",
        message: `No bill ${input.bill_id}.`,
      }
    const left = bill.total - bill.paid
    if (left <= 0)
      return {
        ok: false as const,
        code: "ALREADY_PAID",
        message: `${bill.number} is settled.`,
      }
    if (!input.number.trim()) {
      return {
        ok: false as const,
        code: "NO_NUMBER",
        message: "A giro needs the number printed on the leaf.",
      }
    }
    if (this.giros.some((g) => g.number === input.number.trim())) {
      return {
        ok: false as const,
        code: "DUPLICATE",
        message: `Giro ${input.number} is already issued.`,
      }
    }
    const on = input.issued_on ?? "2026-08-01"
    const out = this.fire(
      `Giro ${input.number}`,
      GIRO_ISSUE,
      { unit_id: bill.unit_id, amount: left, kind: bill.kind },
      {
        unit_id: bill.unit_id,
        on,
        document_ref: input.number.trim(),
        source_id: `GIRO-${input.number.trim()}`,
        step: "issue",
        memo: `Giro untuk ${bill.number}`,
      }
    )
    if (out.ok) {
      this.giros = [
        ...this.giros,
        {
          giro_id: `G-${this.giros.length + 1}`,
          number: input.number.trim(),
          bank_account_id: input.bank_account_id,
          unit_id: bill.unit_id,
          payee: bill.supplier,
          issued_on: on,
          value_on: input.value_on,
          amount: left,
          status: "OUTSTANDING",
          source: bill.number,
        },
      ]
      this.bills = this.bills.map((x) =>
        x.bill_id === input.bill_id
          ? { ...x, paid: x.total, status: "PAID" as const }
          : x
      )
      this.changed()
    }
    return out
  }

  /// The giro is presented and the money leaves.
  clearGiro(giro_id: string, on = "2026-08-01") {
    const g = this.giros.find((x) => x.giro_id === giro_id)
    if (!g)
      return {
        ok: false as const,
        code: "NOT_FOUND",
        message: `No giro ${giro_id}.`,
      }
    if (g.status !== "OUTSTANDING") {
      return {
        ok: false as const,
        code: "NOT_OUTSTANDING",
        message: `Giro ${g.number} is ${g.status.toLowerCase()}.`,
      }
    }
    const out = this.fire(
      `Giro ${g.number} cleared`,
      GIRO_CLEAR,
      {
        unit_id: g.unit_id,
        amount: g.amount,
        bank_account_id: g.bank_account_id,
      },
      {
        unit_id: g.unit_id,
        on,
        document_ref: g.number,
        source_id: `GIRO-CLEAR-${giro_id}`,
        step: "clear",
        memo: `Giro ${g.number} cair`,
      }
    )
    if (out.ok) {
      this.giros = this.giros.map((x) =>
        x.giro_id === giro_id
          ? { ...x, status: "CLEARED" as const, cleared_on: on }
          : x
      )
      this.changed()
    }
    return out
  }

  /// Money between two of our own accounts.
  transfer(input: {
    unit_id: string
    amount: Minor
    from:
      | { kind: "BANK"; bank_account_id: string }
      | { kind: "CASH_ON_HAND" | "PETTY_CASH" }
    to:
      | { kind: "BANK"; bank_account_id: string }
      | { kind: "CASH_ON_HAND" | "PETTY_CASH" }
    on?: string
    memo?: string
  }) {
    if (JSON.stringify(input.from) === JSON.stringify(input.to)) {
      return {
        ok: false as const,
        code: "SAME_ACCOUNT",
        message: "An account cannot be both sides of a transfer.",
      }
    }
    if (input.amount <= 0) {
      return {
        ok: false as const,
        code: "BAD_AMOUNT",
        message: "A transfer needs an amount.",
      }
    }
    const ref = this.ref("TRF", input.unit_id)
    const out = this.fire(
      "Transfer",
      TRANSFER,
      {
        unit_id: input.unit_id,
        amount: input.amount,
        from: input.from,
        to: input.to,
      },
      {
        unit_id: input.unit_id,
        on: input.on ?? "2026-08-01",
        document_ref: ref,
        source_id: ref,
        step: "transfer",
        memo: input.memo ?? "Pemindahan antar rekening",
      }
    )
    if (out.ok) this.changed()
    return out
  }

  /// A journal entry somebody wrote.
  ///
  /// # Why this names accounts rather than roles
  ///
  /// Every other action here goes through a rule, and a rule resolves a ROLE
  /// to an account so the mapping is stated once and checked. A manual journal
  /// is the deliberate exception: it exists precisely for the entry no rule
  /// covers, and forcing it through a role would mean inventing a role for
  /// every one-off. `IntentLine.account_code` is the same escape hatch the
  /// production poster has, and it is narrow — the period lock, the balance
  /// check and the authorisation all still apply, because they live in
  /// `post()` rather than in the rule.
  postJournal(input: {
    unit_id: string
    on: string
    memo: string
    lines: readonly {
      account_code: string
      side: "DEBIT" | "CREDIT"
      amount: Minor
      memo?: string
    }[]
  }) {
    const lines = input.lines.filter(
      (l) => l.account_code.trim() && l.amount > 0
    )
    if (lines.length < 2) {
      return {
        ok: false as const,
        code: "TOO_FEW_LINES",
        message: "A journal entry needs at least two lines.",
      }
    }
    const missing = lines.filter((l) => !account(l.account_code.trim()))
    if (missing.length) {
      return {
        ok: false as const,
        code: "UNKNOWN_ACCOUNT",
        message: `${missing.map((l) => l.account_code).join(", ")} is not in the chart.`,
      }
    }
    const d = lines
      .filter((l) => l.side === "DEBIT")
      .reduce((n, l) => n + l.amount, 0)
    const c = lines
      .filter((l) => l.side === "CREDIT")
      .reduce((n, l) => n + l.amount, 0)
    if (d !== c) {
      return {
        ok: false as const,
        code: "OUT_OF_BALANCE",
        message: `Debits are ${d / 100} and credits are ${c / 100}. An entry must balance before it can post.`,
      }
    }
    const ref = this.ref("GL", input.unit_id)
    const out = this.ledger.post({
      book_id: "CFS",
      occurred_on: input.on,
      document_on: input.on,
      posting_on: input.on,
      source_kind: "MANUAL",
      source_id: ref,
      document_ref: ref,
      rule_version: "manual_journal@1",
      memo: input.memo,
      idempotency_key: `${ref}/manual`,
      lines: lines.map((l) => ({
        side: l.side,
        role: "CASH_ON_HAND" as never,
        dims: { unit_id: input.unit_id },
        amount: l.amount,
        memo: l.memo,
        account_code: l.account_code.trim(),
      })),
      actor: "finance@lab",
      actor_role: "FINANCE_MANAGER",
    })
    if (out.ok) this.changed()
    return out
  }

  /// A unit paying an affiliate balance back. The client does it by remitting
  /// takings, which is the same document as a deposit — so it is the same rule.
  settleInterunit(move_id: string, on = "2026-08-01") {
    const m = this.interunitMoves.find((x) => x.move_id === move_id)
    if (!m)
      return {
        ok: false as const,
        code: "NOT_FOUND",
        message: `No movement ${move_id}.`,
      }
    const left = m.amount - m.settled
    if (left <= 0)
      return {
        ok: false as const,
        code: "SETTLED",
        message: `${m.reference} is settled.`,
      }
    const payer = m.to_unit === "HO" ? m.from_unit : m.to_unit
    const out = this.fire(
      `Settle ${m.reference}`,
      DEPOSIT,
      { unit_id: payer, to_unit_id: "HO", amount: left, from: "CASH_ON_HAND" },
      {
        unit_id: payer,
        on,
        document_ref: this.ref("BKK", payer),
        source_id: `IU-SETTLE-${move_id}`,
        step: "settlement",
        memo: m.reference,
      }
    )
    if (out.ok) {
      this.interunitMoves = this.interunitMoves.map((x) =>
        x.move_id === move_id ? { ...x, settled: x.amount } : x
      )
      this.changed()
    }
    return out
  }

  /// Recovering a staff loan out of pay. No posting of its own: it rides on
  /// the payroll payment, which is where the money actually moves.
  deductStaffLoan(loan_id: string) {
    const l = this.staffLoans.find((x) => x.loan_id === loan_id)
    if (!l)
      return {
        ok: false as const,
        code: "NOT_FOUND",
        message: `No loan ${loan_id}.`,
      }
    if (!l.instalment) {
      return {
        ok: false as const,
        code: "NO_DEDUCTION",
        message: `${l.person} has no deduction set, so nothing comes back on its own.`,
      }
    }
    const take = Math.min(l.instalment, l.principal - l.repaid)
    if (take <= 0)
      return {
        ok: false as const,
        code: "REPAID",
        message: `${l.person} has repaid in full.`,
      }
    this.staffLoans = this.staffLoans.map((x) =>
      x.loan_id === loan_id ? { ...x, repaid: x.repaid + take } : x
    )
    this.changed()
    return { ok: true as const }
  }
}

/// The client's own five tax accounts, keyed by the name a position carries.
const TAX_KIND: Record<string, string> = {
  "PPh Pasal 21": "PPH_21",
  "PPh Pasal 23 dipotong": "PPH_23",
  "PPN — Masukan vs Keluaran": "VAT_OUT",
  PBB: "PBB",
  "PPh Pasal 25": "PPH_25",
  "PPh Pasal 29 — kurang bayar tahunan": "PPH_25",
}

/// The client puts the unit in the last two digits of a twelve-character code.
const SUFFIX: Record<string, string> = { HO: "00", C004: "04", C006: "06" }

let singleton: Book | null = null

export function book(): Book {
  if (!singleton) singleton = new Book()
  return singleton
}

export { UNITS }
export type { Book }
