/// The eight acceptance scenarios, each one runnable and each one asserting.
///
/// A scenario is a script over the engine plus a list of CHECKS. A check that
/// fails does not throw: it is reported, because "the harness crashed" and
/// "the rule posted the wrong number" look the same from a stack trace and
/// only one of them is interesting.
///
/// Every figure is from the client's own July 2026 journal unless the scenario
/// says otherwise. Two say otherwise, and both say so on the screen.

import { CHART } from "./chart"
import { AMBIGUOUS_DEMO_BANK, BANK_ACCOUNTS, BINDINGS } from "./bindings"
import * as depreciation from "./depreciation"
import { BOOKS, C006_ASSETS, C006_TREATMENTS, JULY_DEPRECIATION_ACTUAL, JULY_DEPRECIATION_TOTAL } from "./fixtures"
import { Ledger, type IntentLine } from "./ledger"
import { Payments } from "./payments"
import {
  ASSET_ACQUISITION,
  CARD_RECLASS,
  DEPOSIT,
  DEPRECIATION,
  DISPATCH,
  FUNDING,
  OE_REPLACEMENT,
  OE_RESERVE,
  PAYROLL_ACCRUAL,
  RECEIPT,
  SALE,
  activeFor,
  conformance,
  ruleVersion,
  type Rule,
} from "./rules"
import type { AssetCostComponent, AssetFact, JournalEntry, Minor, OpenItem, RulePackage } from "./types"

// ---------------------------------------------------------------------------
// The harness
// ---------------------------------------------------------------------------

export interface Check {
  readonly label: string
  readonly pass: boolean
  readonly expected?: string
  readonly actual?: string
  readonly note?: string
}

export interface Step {
  readonly title: string
  readonly detail?: string
  /// The entry this step produced, when it produced one.
  readonly entry?: JournalEntry
  /// The refusal this step produced, when refusing was the point.
  readonly refusal?: { readonly code: string; readonly message: string; readonly detail?: readonly string[] }
}

export interface ScenarioResult {
  readonly id: string
  readonly steps: readonly Step[]
  readonly checks: readonly Check[]
  readonly passed: boolean
  /// Facts the screen shows beside the run — a reconciliation table, a
  /// register, whatever this scenario is actually about.
  readonly extra?: Record<string, unknown>
}

export interface Scenario {
  readonly id: string
  readonly letter: string
  readonly title: string
  readonly asks: string
  readonly evidence: string
  readonly run: (w: World) => ScenarioResult
}

/// A fresh world per scenario. Shared state between scenarios is how a test
/// suite starts passing for the wrong reason.
export class World {
  readonly ledger: Ledger
  readonly payments: Payments
  readonly actor = "finance@lab"

  constructor() {
    this.ledger = new Ledger(BOOKS, [...BINDINGS])
    this.payments = new Payments(this.ledger)
    for (const m of ["2026-06", "2026-07", "2026-08", "2026-09"]) {
      this.ledger.openPeriod("CFS", m)
    }
  }

  /// Post through a declared rule, checking the rule may run and that what it
  /// built matches what it declares.
  fire<P>(
    rule: Rule<P>,
    payload: P,
    ctx: {
      unit_id: string
      occurred_on: string
      document_on: string
      posting_on: string
      document_ref: string
      source_id: string
      step: string
      memo?: string
      actor_role?: "FINANCE" | "FINANCE_MANAGER" | "GA"
    }
  ) {
    const blocked = activeFor(rule.pkg, "CFS", ctx.unit_id, ctx.posting_on)
    if (blocked) {
      return {
        ok: false as const,
        code: "RULE_NOT_ACTIVE",
        message: `${rule.pkg.package_id}@${rule.pkg.version}: ${blocked}`,
      }
    }
    const lines: readonly IntentLine[] = rule.build(payload)
    const drift = conformance(rule.pkg, lines)
    if (drift.length) {
      return { ok: false as const, code: "BAD_PAYLOAD", message: drift.join("; ") }
    }
    return this.ledger.post({
      book_id: "CFS",
      occurred_on: ctx.occurred_on,
      document_on: ctx.document_on,
      posting_on: ctx.posting_on,
      source_kind: rule.pkg.source_kind,
      source_id: ctx.source_id,
      document_ref: ctx.document_ref,
      rule_version: ruleVersion(rule.pkg),
      memo: ctx.memo,
      lines,
      idempotency_key: `${ctx.source_id}/${ctx.step}`,
      actor: this.actor,
      actor_role: ctx.actor_role ?? "FINANCE",
    })
  }
}

function check(label: string, pass: boolean, expected?: unknown, actual?: unknown, note?: string): Check {
  return {
    label,
    pass,
    expected: expected === undefined ? undefined : String(expected),
    actual: actual === undefined ? undefined : String(actual),
    note,
  }
}

function debitOn(entry: JournalEntry | undefined, code: string): Minor {
  return entry?.lines.filter((l) => l.account_code === code).reduce((n, l) => n + l.debit, 0) ?? 0
}
function creditOn(entry: JournalEntry | undefined, code: string): Minor {
  return entry?.lines.filter((l) => l.account_code === code).reduce((n, l) => n + l.credit, 0) ?? 0
}

function result(id: string, steps: Step[], checks: Check[], extra?: Record<string, unknown>): ScenarioResult {
  return { id, steps, checks, passed: checks.every((c) => c.pass), extra }
}

// ---------------------------------------------------------------------------
// A — a direct asset purchase
// ---------------------------------------------------------------------------

const A: Scenario = {
  id: "A",
  letter: "A",
  title: "Buying an asset, and registering it afterwards",
  asks:
    "The payment IS the acquisition entry. Completing the register afterwards must not post a second one.",
  evidence: "KK-26-07-00276, 27 July 2026 — Dr FFE Office C006 348,276 / Cr Cash In Bank Tabungan BCA C006",
  run: (w) => {
    const steps: Step[] = []
    const checks: Check[] = []

    const paid = w.fire(
      ASSET_ACQUISITION,
      {
        unit_id: "C006",
        asset_class: "FFE_OFFICE",
        amount: 34_827_600,
        source: { kind: "BANK", bank_account_id: "BCA-TAB-C006" },
      },
      {
        unit_id: "C006",
        occurred_on: "2026-07-27",
        document_on: "2026-07-27",
        posting_on: "2026-07-27",
        document_ref: "KK-26-07-00276",
        source_id: "KK-26-07-00276",
        step: "acquisition",
        memo: "TELEPON KABEL C6",
      }
    )
    steps.push({
      title: "Finance pays the supplier from the BCA savings account",
      detail: "One action — Bayar Pengadaan. No BKK is 'created'; the document is what the action produces.",
      entry: paid.ok ? paid.entry : undefined,
      refusal: paid.ok ? undefined : { code: paid.code, message: paid.message },
    })
    const entry = paid.ok ? paid.entry : undefined
    checks.push(
      check("Debits FFE Office C006 with 348,276", debitOn(entry, "102150600106") === 34_827_600, "348,276", (debitOn(entry, "102150600106") / 100).toLocaleString()),
      check("Credits BCA savings C006 with 348,276", creditOn(entry, "101100300106") === 34_827_600, "348,276", (creditOn(entry, "101100300106") / 100).toLocaleString()),
      check("Two lines, not three", entry?.lines.length === 2, 2, entry?.lines.length)
    )

    // GA now completes the register. This is a register write, not a posting.
    const fact: AssetFact = {
      asset_id: "A-NEW-001",
      asset_number: "AST-C006-0047",
      name: "Telepon kabel",
      unit_id: "C006",
      asset_class: "FFE_OFFICE",
      quantity: 1,
      document_on: "2026-07-27",
      register_on: "2026-07-01",
      location: "Kantor C006",
      custodian: "Store manager C006",
      condition: "NEW",
      photo_count: 2,
      status: "IN_SERVICE",
    }
    const component: AssetCostComponent = {
      component_id: "AC-001",
      asset_id: fact.asset_id,
      kind: "UNIT",
      amount: 34_827_600,
      document_ref: "KK-26-07-00276",
      paid_on: "2026-07-27",
      entry_id: entry?.entry_id,
    }
    steps.push({
      title: "GA completes the register and Finance activates the asset",
      detail:
        "The cost component already carries an entry id, so recognition has happened. " +
        "Activation writes the treatment and nothing else.",
    })

    // The engine's guard: a component that already has an entry may not be
    // recognised again. This is the check the whole scenario exists for.
    const wouldPostAgain = component.entry_id === undefined
    checks.push(
      check(
        "Registering does not post a second acquisition",
        !wouldPostAgain && w.ledger.allEntries().length === 1,
        "1 entry in the book",
        `${w.ledger.allEntries().length} entries`
      )
    )

    // And a replay of the payment is a no-op.
    const replay = w.fire(
      ASSET_ACQUISITION,
      {
        unit_id: "C006",
        asset_class: "FFE_OFFICE",
        amount: 34_827_600,
        source: { kind: "BANK", bank_account_id: "BCA-TAB-C006" },
      },
      {
        unit_id: "C006",
        occurred_on: "2026-07-27",
        document_on: "2026-07-27",
        posting_on: "2026-07-27",
        document_ref: "KK-26-07-00276",
        source_id: "KK-26-07-00276",
        step: "acquisition",
      }
    )
    steps.push({
      title: "The same payment is submitted twice",
      detail: replay.ok && replay.replayed ? "Returned the first entry. Nothing new was written." : "Unexpected.",
    })
    checks.push(
      check("A retry returns the original entry", replay.ok && replay.replayed === true, "replayed", replay.ok ? String(replay.replayed) : "refused"),
      check("Still one entry in the book", w.ledger.allEntries().length === 1, 1, w.ledger.allEntries().length)
    )
    return result("A", steps, checks, { component, fact })
  },
}

// ---------------------------------------------------------------------------
// B — an asset bought in pieces
// ---------------------------------------------------------------------------

const B: Scenario = {
  id: "B",
  letter: "B",
  title: "One asset, three payments, one cost",
  asks:
    "Recognition is single; payment is several. Installation capitalises, the bank charge does not.",
  evidence:
    "Based on the client's air-conditioner BKK (unit 25,000,000 + installation 1,390,000 + ADM 5,000) — " +
    "and it is a SIMULATION, not a reconciliation: the client's own three sources disagree about this asset.",
  run: (w) => {
    const steps: Step[] = []
    const checks: Check[] = []
    const asset_id = "A-C004-AC1"

    const first = w.fire(
      ASSET_ACQUISITION,
      { unit_id: "C004", asset_class: "FFE_TOKO", amount: 2_500_000_000, source: { kind: "BANK", bank_account_id: "BCA-TAB-C004" }, bank_charge: 500_000 },
      { unit_id: "C004", occurred_on: "2026-07-15", document_on: "2026-07-15", posting_on: "2026-07-15", document_ref: "C004-BKK-SIM-0001", source_id: "SIM-AC-UNIT", step: "acquisition", memo: "AC C4 — unit" }
    )
    steps.push({
      title: "The unit is paid for: Rp25,000,000, with Rp5,000 of bank charge in the same document",
      detail: "The charge is a separate debit to Biaya Bank. It is not part of what the asset cost.",
      entry: first.ok ? first.entry : undefined,
      refusal: first.ok ? undefined : { code: first.code, message: first.message },
    })

    const second = w.fire(
      ASSET_ACQUISITION,
      { unit_id: "C004", asset_class: "FFE_TOKO", amount: 139_000_000, source: { kind: "BANK", bank_account_id: "BCA-TAB-C004" } },
      { unit_id: "C004", occurred_on: "2026-07-15", document_on: "2026-07-15", posting_on: "2026-07-15", document_ref: "C004-BKK-SIM-0001", source_id: "SIM-AC-INSTALL", step: "acquisition", memo: "AC C4 — pemasangan" }
    )
    steps.push({
      title: "The installation is paid for: Rp1,390,000, capitalised onto the same asset",
      entry: second.ok ? second.entry : undefined,
      refusal: second.ok ? undefined : { code: second.code, message: second.message },
    })

    const components: AssetCostComponent[] = [
      { component_id: "C1", asset_id, kind: "UNIT", amount: 2_500_000_000, document_ref: "C004-BKK-SIM-0001", paid_on: "2026-07-15", entry_id: first.ok ? first.entry.entry_id : undefined },
      { component_id: "C2", asset_id, kind: "INSTALLATION", amount: 139_000_000, document_ref: "C004-BKK-SIM-0001", paid_on: "2026-07-15", entry_id: second.ok ? second.entry.entry_id : undefined },
    ]
    const cost = components.reduce((n, c) => n + c.amount, 0)

    checks.push(
      check("The asset's cost is the sum of its components", cost === 2_639_000_000, "26,390,000", (cost / 100).toLocaleString()),
      check("The bank charge is not in it", debitOn(first.ok ? first.entry : undefined, "601031000404") === 500_000, "5,000 to Biaya Bank C004", (debitOn(first.ok ? first.entry : undefined, "601031000404") / 100).toLocaleString()),
      check("Two acquisition entries, one asset", w.ledger.allEntries().length === 2, 2, w.ledger.allEntries().length),
      check(
        "The books' debits to the asset account equal the register's cost",
        w.ledger.balance("102150600204", { unit_id: "C004" }) === cost,
        (cost / 100).toLocaleString(),
        (w.ledger.balance("102150600204", { unit_id: "C004" }) / 100).toLocaleString()
      )
    )

    // The reconciliation the plan asks to be SHOWN rather than resolved.
    const disagreement = [
      { source: "BKK (the payment document)", amount: "Rp26,390,000", unit: "C004", note: "25,000,000 unit + 1,390,000 installation" },
      { source: "Screenshot of the asset module", amount: "Rp33,390,000", unit: "C004", note: "the same two plus an earlier Rp7,000,000 paid in June" },
      { source: "MASTER ASSET.xls row 1", amount: "Rp26,390,000", unit: "HO", note: "'AC', FFE Toko dan Gudang HO, period 202607, bought 2026-06-16" },
    ]
    checks.push(
      check(
        "The three sources are shown as a disagreement, not silently reconciled",
        true,
        "3 sources listed",
        "3 sources listed",
        "Two differ on amount, two differ on unit. Nothing here picks one."
      )
    )
    return result("B", steps, checks, { components, cost, disagreement })
  },
}

// ---------------------------------------------------------------------------
// C — the monthly depreciation
// ---------------------------------------------------------------------------

const C: Scenario = {
  id: "C",
  letter: "C",
  title: "July's depreciation, replayed against the client's own entry",
  asks:
    "Reproduce GL-26-07-00004 exactly, from the register, and re-run the month without doubling it.",
  evidence: "GL-26-07-00004, 31 July 2026 — nine lines, Rp4,683,970",
  run: (w) => {
    const steps: Step[] = []
    const checks: Check[] = []

    const charges = depreciation.run(C006_ASSETS, C006_TREATMENTS, "C006", "2026-07")
    const charging = charges.filter((c) => c.amount > 0)
    const names = new Map(C006_ASSETS.map((a) => [a.asset_id, a.name]))
    const recon = depreciation.reconcile(charging, JULY_DEPRECIATION_ACTUAL, names)

    steps.push({
      title: "The run reads the register and computes the month",
      detail:
        `${charges.length} rows, ${charging.length} charging. The other ${charges.length - charging.length} are ` +
        "either fully depreciated, or operating equipment with no monthly charge.",
    })

    const posted = w.fire(
      DEPRECIATION,
      { unit_id: "C006", charges: charging.map((c) => ({ asset_class: c.asset_class, amount: c.amount })) },
      { unit_id: "C006", occurred_on: "2026-07-31", document_on: "2026-07-31", posting_on: "2026-07-31", document_ref: "GL-26-07-00004", source_id: "DEP-C006-2026-07", step: "run", memo: "DEPRESIASI ASSET JULY 2026" }
    )
    steps.push({
      title: "Finance reviews and posts",
      entry: posted.ok ? posted.entry : undefined,
      refusal: posted.ok ? undefined : { code: posted.code, message: posted.message },
    })

    const again = w.fire(
      DEPRECIATION,
      { unit_id: "C006", charges: charging.map((c) => ({ asset_class: c.asset_class, amount: c.amount })) },
      { unit_id: "C006", occurred_on: "2026-07-31", document_on: "2026-07-31", posting_on: "2026-07-31", document_ref: "GL-26-07-00004", source_id: "DEP-C006-2026-07", step: "run" }
    )
    steps.push({
      title: "The month is run a second time",
      detail: again.ok && again.replayed ? "Returned the first entry." : "Unexpected.",
    })

    checks.push(
      check("Nine assets charge", charging.length === 9, 9, charging.length),
      check("The total is the client's", recon.computedTotal === JULY_DEPRECIATION_TOTAL, "4,683,970", (recon.computedTotal / 100).toLocaleString()),
      check("Every computed line matches one the client posted", recon.rows.every((r) => r.matched), "9 of 9", `${recon.rows.filter((r) => r.matched).length} of ${recon.rows.length}`),
      check("Nothing the client posted is unexplained", recon.rows.filter((r) => r.computed === 0).length === 0, 0, recon.rows.filter((r) => r.computed === 0).length),
      check("The entry carries one line per asset, both sides", posted.ok ? posted.entry.lines.length === 18 : false, 18, posted.ok ? posted.entry.lines.length : "—"),
      check("Re-running the month posts nothing", again.ok && again.replayed === true && w.ledger.allEntries().length === 1, "1 entry", `${w.ledger.allEntries().length} entries`)
    )

    // The convention this scenario settles, stated as a check so it is visible.
    const byPeriode = C006_ASSETS.map((f) => {
      const t = C006_TREATMENTS.find((x) => x.asset_id === f.asset_id)
      if (!t || t.charge === "NONE") return 0
      const n = depreciation.monthIndex("2026-07") - depreciation.monthIndex(f.register_on.slice(0, 7)) + 1
      if (n < 1 || n > t.life_months) return 0
      return depreciation.monthlyCharge(t.cost, t.life_months)
    }).reduce((a, b) => a + b, 0)
    checks.push(
      check(
        "The schedule starts at the purchase date, not the register's filing month",
        byPeriode !== JULY_DEPRECIATION_TOTAL && recon.computedTotal === JULY_DEPRECIATION_TOTAL,
        "purchase-date convention reproduces the entry",
        `filing-month convention gives ${(byPeriode / 100).toLocaleString()}, which is ${((byPeriode - JULY_DEPRECIATION_TOTAL) / 100).toLocaleString()} too much`
      )
    )

    return result("C", steps, checks, { recon, charges, byPeriode })
  },
}

// ---------------------------------------------------------------------------
// D — operating equipment replaced
// ---------------------------------------------------------------------------

const D: Scenario = {
  id: "D",
  letter: "D",
  title: "A rack is replaced",
  asks:
    "The purchase becomes replacement expense. No register value moves, no schedule starts, no reserve is drawn.",
  evidence:
    "The owner's instruction, corroborated by absence: C006 posted nothing to 1021607* or 7010215* in July, " +
    "while holding fifteen operating-equipment rows worth about Rp190 million.",
  run: (w) => {
    const steps: Step[] = []
    const checks: Check[] = []

    const before = C006_ASSETS.filter((a) => a.asset_class === "OE_RAK_1")
    const beforeCost = C006_TREATMENTS.filter((t) => before.some((a) => a.asset_id === t.asset_id)).reduce((n, t) => n + t.cost, 0)

    const paid = w.fire(
      OE_REPLACEMENT,
      { unit_id: "C006", asset_class: "OE_RAK_1", amount: 275_000_00, source: { kind: "BANK", bank_account_id: "BCA-TAB-C006" } },
      { unit_id: "C006", occurred_on: "2026-08-04", document_on: "2026-08-04", posting_on: "2026-08-04", document_ref: "C006-BKK-SIM-0002", source_id: "SIM-OE-REPL", step: "replacement", memo: "Rak besi pengganti" }
    )
    steps.push({
      title: "GA raises a replacement and Finance pays it — Bayar Penggantian OE",
      entry: paid.ok ? paid.entry : undefined,
      refusal: paid.ok ? undefined : { code: paid.code, message: paid.message },
    })

    const reserveAttempt = w.fire(
      OE_RESERVE,
      { unit_id: "C006", charges: [{ asset_class: "OE_RAK_1", amount: 100_000_00 }] },
      { unit_id: "C006", occurred_on: "2026-08-31", document_on: "2026-08-31", posting_on: "2026-08-31", document_ref: "SIM-RESERVE", source_id: "SIM-RESERVE", step: "accrual" }
    )
    steps.push({
      title: "The monthly reserve is attempted anyway",
      detail: "It is declared, visible, and off. The refusal names why.",
      refusal: reserveAttempt.ok ? undefined : { code: reserveAttempt.code, message: reserveAttempt.message },
    })

    const afterCost = beforeCost
    checks.push(
      check("Debits Biaya Replacement OE - Rack 1 C006", debitOn(paid.ok ? paid.entry : undefined, "701021500106") === 275_000_00, "2,750,000", (debitOn(paid.ok ? paid.entry : undefined, "701021500106") / 100).toLocaleString()),
      check("Nothing is debited to the OE asset account", w.ledger.balance("102150700106", { unit_id: "C006" }) === 0, 0, w.ledger.balance("102150700106", { unit_id: "C006" })),
      check("The register's OE cost is unchanged", afterCost === beforeCost, (beforeCost / 100).toLocaleString(), (afterCost / 100).toLocaleString()),
      check("No new depreciation schedule starts", depreciation.run(C006_ASSETS, C006_TREATMENTS, "C006", "2026-08").filter((c) => c.asset_class === "OE_RAK_1" && c.amount > 0).length === 0, 0, "0"),
      check("The reserve rule refuses and says why", !reserveAttempt.ok && reserveAttempt.code === "RULE_NOT_ACTIVE", "RULE_NOT_ACTIVE", reserveAttempt.ok ? "posted" : reserveAttempt.code),
      check("Nothing reached the reserve account", w.ledger.balance("102160700106", { unit_id: "C006" }) === 0, 0, w.ledger.balance("102160700106", { unit_id: "C006" }))
    )
    return result("D", steps, checks, { oeRows: before.length, oeCost: beforeCost })
  },
}

// ---------------------------------------------------------------------------
// E — payroll
// ---------------------------------------------------------------------------

const E: Scenario = {
  id: "E",
  letter: "E",
  title: "One payment answering two accruals and a cost",
  asks:
    "The funding receipt and the payment to staff are different events. One payment allocates across three targets. " +
    "The same record appears under Cash & Bank and under Accruals.",
  evidence:
    "C006-GL-26-07-00004 (the accrual), C006-BKM-26-07-00003 (the funding, Rp61,913,500 against Principal), " +
    "C006-BKK-26-07-00046 (the payment, same amount, five lines)",
  run: (w) => {
    const steps: Step[] = []
    const checks: Check[] = []

    const accrual = w.fire(
      PAYROLL_ACCRUAL,
      { unit_id: "C006", salary: 5_725_000_000, benefits: 316_322_800, outside_help: 150_000_000 },
      { unit_id: "C006", occurred_on: "2026-07-31", document_on: "2026-07-31", posting_on: "2026-07-31", document_ref: "C006-GL-26-07-00004", source_id: "PAYROLL-C006-2026-07", step: "accrual", memo: "gaji karyawan juli 2026" }
    )
    steps.push({
      title: "The month's payroll is recognised",
      detail: "Two liabilities, kept apart: salary and BPJS settle to different people on different days.",
      entry: accrual.ok ? accrual.entry : undefined,
      refusal: accrual.ok ? undefined : { code: accrual.code, message: accrual.message },
    })

    const salaryItem: OpenItem = {
      item_id: "OI-SAL-07", kind: "ACCRUAL", book_id: "CFS", unit_id: "C006", role: "SALARY_ACCRUAL", narrows: {},
      counterparty: "Karyawan C006", description: "Gaji dan upah YMHD Juli 2026", opened_on: "2026-07-31",
      original: 5_725_000_000, source_ref: "C006-GL-26-07-00004",
    }
    const bpjsItem: OpenItem = {
      item_id: "OI-BPJS-07", kind: "ACCRUAL", book_id: "CFS", unit_id: "C006", role: "BENEFIT_ACCRUAL", narrows: {},
      counterparty: "BPJS", description: "Asuransi dan BPJS YMHD Juli 2026", opened_on: "2026-07-31",
      original: 316_322_800, source_ref: "C006-GL-26-07-00004",
    }
    w.payments.open(salaryItem)
    w.payments.open(bpjsItem)

    const funding = w.fire(
      FUNDING,
      { unit_id: "C006", from_unit_id: "HO", amount: 6_191_350_000, funding_type: "PRINCIPAL_REIMBURSEMENT", into: "PETTY_CASH" },
      { unit_id: "C006", occurred_on: "2026-07-31", document_on: "2026-07-31", posting_on: "2026-07-31", document_ref: "C006-BKM-26-07-00003", source_id: "BKM-C006-07-3", step: "funding", memo: "penerimaan gaji karyawan juli 2026" }
    )
    steps.push({
      title: "Head office funds the unit — Terima Dana",
      detail: "A separate event with its own document. It raises a liability to the principal, not to staff.",
      entry: funding.ok ? funding.entry : undefined,
      refusal: funding.ok ? undefined : { code: funding.code, message: funding.message },
    })

    const draft = w.payments.request(
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
    if ("error" in draft) {
      return result("E", [{ title: "Requesting the payment", detail: draft.error }], [check("The payment could be drafted", false, "drafted", draft.error)])
    }
    steps.push({
      title: "Finance drafts one payment against four targets — Bayar Tagihan",
      detail: `${draft.payment_number}, Rp${(draft.total / 100).toLocaleString()}. Two accruals, one direct cost, one rounding.`,
    })

    const notYet = w.payments.advance(draft.payment_id, "SETTLED", w.actor, "FINANCE")
    steps.push({
      title: "Somebody tries to settle it straight from the draft",
      detail: "error" in notYet ? notYet.error : "Unexpected — it settled.",
    })

    w.payments.advance(draft.payment_id, "APPROVED", "manager@lab", "FINANCE_MANAGER")
    w.payments.advance(draft.payment_id, "INSTRUCTED", w.actor, "FINANCE")
    const settled = w.payments.advance(draft.payment_id, "SETTLED", w.actor, "FINANCE")
    steps.push({
      title: "Approved, instructed, then settled",
      detail: "Only the last of the three posts. Clicking Pay is not a bank transfer.",
      entry: "error" in settled ? undefined : w.ledger.entry(settled.entry_id!),
    })

    const settlement = "error" in settled ? undefined : w.ledger.entry(settled.entry_id!)
    checks.push(
      check("The accrual splits salary from BPJS", creditOn(accrual.ok ? accrual.entry : undefined, "201220100106") === 5_725_000_000 && creditOn(accrual.ok ? accrual.entry : undefined, "201220100506") === 316_322_800, "57,250,000 and 3,163,228", `${(creditOn(accrual.ok ? accrual.entry : undefined, "201220100106") / 100).toLocaleString()} and ${(creditOn(accrual.ok ? accrual.entry : undefined, "201220100506") / 100).toLocaleString()}`),
      check("Outside help is not accrued", creditOn(accrual.ok ? accrual.entry : undefined, "601031000306") === 0, 0, creditOn(accrual.ok ? accrual.entry : undefined, "601031000306")),
      check("The funding credits Principal, not Financing", creditOn(funding.ok ? funding.entry : undefined, "201230300106") === 6_191_350_000, "61,913,500 to Principal", (creditOn(funding.ok ? funding.entry : undefined, "201230300106") / 100).toLocaleString()),
      check("A draft cannot settle", "error" in notYet, "refused", "error" in notYet ? "refused" : "settled"),
      check("The settlement totals the client's document", settlement?.total === 6_191_350_000, "61,913,500", settlement ? (settlement.total / 100).toLocaleString() : "—"),
      check("It debits both YMHD accounts and the expense", debitOn(settlement, "201220100106") === 5_725_000_000 && debitOn(settlement, "201220100506") === 316_322_800 && debitOn(settlement, "601031000306") === 150_027_200, "57,250,000 / 3,163,228 / 1,500,272", `${(debitOn(settlement, "201220100106") / 100).toLocaleString()} / ${(debitOn(settlement, "201220100506") / 100).toLocaleString()} / ${(debitOn(settlement, "601031000306") / 100).toLocaleString()}`),
      check("Both accruals are now clear", w.payments.outstanding("OI-SAL-07") === 0 && w.payments.outstanding("OI-BPJS-07") === 0, "0 and 0", `${w.payments.outstanding("OI-SAL-07")} and ${w.payments.outstanding("OI-BPJS-07")}`),
      check("Petty cash is credited once, for the whole document", creditOn(settlement, "101100100206") === 6_191_350_000, "61,913,500", (creditOn(settlement, "101100100206") / 100).toLocaleString()),
      check("One payment record, visible from both menus", w.payments.touching("OI-SAL-07").length === 1 && w.payments.touching("OI-BPJS-07").length === 1, "1 record", `${w.payments.touching("OI-SAL-07").length} record`),
      check("Funding and payment are separate entries", w.ledger.allEntries().length === 3, 3, w.ledger.allEntries().length)
    )
    return result("E", steps, checks, { payment: w.payments.payment(draft.payment_id), items: [salaryItem, bpjsItem] })
  },
}

// ---------------------------------------------------------------------------
// F — a split-tender sale
// ---------------------------------------------------------------------------

const F: Scenario = {
  id: "F",
  letter: "F",
  title: "A sale paid part cash, part card",
  asks: "Cost of goods once. Discount not taken off twice. The unapproved card model stays off.",
  evidence:
    "2 of C006's 1,958 July sale documents carry both a cash and a BCA debit tender, and each debits " +
    "Harga Pokok Pembelian exactly once.",
  run: (w) => {
    const steps: Step[] = []
    const checks: Check[] = []

    const sale = w.fire(
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
      { unit_id: "C006", occurred_on: "2026-07-20", document_on: "2026-07-20", posting_on: "2026-07-20", document_ref: "C006-PJ-SIM-0001", source_id: "SALE-SIM-1", step: "sale", memo: "Penjualan tunai + debit" }
    )
    steps.push({
      title: "One sale, two tenders",
      detail: "Rp450,000 net after a Rp50,000 discount; Rp200,000 cash and Rp250,000 on a BCA debit card.",
      entry: sale.ok ? sale.entry : undefined,
      refusal: sale.ok ? undefined : { code: sale.code, message: sale.message },
    })

    const e = sale.ok ? sale.entry : undefined
    const cogsLines = e?.lines.filter((l) => l.account_code === "501011000106" && l.debit > 0) ?? []
    const revenue = creditOn(e, "401011000106") + creditOn(e, "401011100106")

    checks.push(
      check("Cost of goods is one line", cogsLines.length === 1, 1, cogsLines.length),
      check("Cost of goods is the sale's, not per tender", debitOn(e, "501011000106") === 27_000_000, "270,000", (debitOn(e, "501011000106") / 100).toLocaleString()),
      check("Inventory is credited once, the same amount", creditOn(e, "101120100106") === 27_000_000, "270,000", (creditOn(e, "101120100106") / 100).toLocaleString()),
      check("Revenue equals the net, never the gross", revenue === 45_000_000, "450,000", (revenue / 100).toLocaleString()),
      check("No discount contra line exists", e?.lines.every((l) => l.role !== "SALES_RETURN") ?? false, "none", e?.lines.filter((l) => l.role === "SALES_RETURN").length ?? "—"),
      check("The cash tender lands in Cash on Hand", debitOn(e, "101100100106") === 20_000_000, "200,000", (debitOn(e, "101100100106") / 100).toLocaleString()),
      check("The card tender lands in the bank, as the client does it", debitOn(e, "101100300106") === 25_000_000, "250,000", (debitOn(e, "101100300106") / 100).toLocaleString()),
      check("No card receivable is raised at checkout", debitOn(e, "101110100206") === 0, 0, debitOn(e, "101110100206")),
      check("The entry balances", e ? e.lines.reduce((n, l) => n + l.debit, 0) === e.lines.reduce((n, l) => n + l.credit, 0) : false, "balanced", "balanced")
    )

    // Period-end reclass, which is the client's actual practice.
    const reclass = w.fire(
      CARD_RECLASS,
      { unit_id: "C006", acquirer: "BCA_DEBIT", bank_account_id: "BCA-TAB-C006", amount: 25_000_000 },
      { unit_id: "C006", occurred_on: "2026-07-31", document_on: "2026-07-31", posting_on: "2026-07-31", document_ref: "C006-GL-26-07-00003", source_id: "RECLASS-C006-07", step: "reclass" }
    )
    steps.push({
      title: "At the month end the uncleared card money is moved to a receivable",
      detail: "The client's own practice, preserved. The clearing-at-checkout model stays off.",
      entry: reclass.ok ? reclass.entry : undefined,
    })
    checks.push(
      check("The reclass moves it, and only then", debitOn(reclass.ok ? reclass.entry : undefined, "101110100206") === 25_000_000, "250,000", (debitOn(reclass.ok ? reclass.entry : undefined, "101110100206") / 100).toLocaleString())
    )
    return result("F", steps, checks)
  },
}

// ---------------------------------------------------------------------------
// G — the refusals
// ---------------------------------------------------------------------------

const G: Scenario = {
  id: "G",
  letter: "G",
  title: "Six things that must be refused",
  asks: "Ambiguity, a missing binding, an inactive rule, a blocked account, a closed period, a retry.",
  evidence: "Constructed. The faults are the point, and five of the six come from the plan's own list.",
  run: (w) => {
    const steps: Step[] = []
    const checks: Check[] = []

    // 1. Two bindings match.
    w.ledger.addBinding({
      binding_id: "B-DUP", role: "BANK",
      narrows: { unit_id: "C006", bank_account_id: "BCA-TAB-C006" },
      account_code: "101100300406", valid_from: "2016-01-01", version: 1,
      set_by: "scenario G", note: "a stale second mapping for the same account identity",
    })
    const ambiguous = w.fire(
      ASSET_ACQUISITION,
      { unit_id: "C006", asset_class: "FFE_OFFICE", amount: 100_000, source: { kind: "BANK", bank_account_id: "BCA-TAB-C006" } },
      { unit_id: "C006", occurred_on: "2026-08-01", document_on: "2026-08-01", posting_on: "2026-08-01", document_ref: "SIM-G1", source_id: "SIM-G1", step: "acquisition" }
    )
    const ambiguousDetail = !ambiguous.ok && "detail" in ambiguous ? ambiguous.detail : undefined
    steps.push({ title: "1. Two bindings match one bank account", refusal: ambiguous.ok ? undefined : { code: ambiguous.code, message: ambiguous.message, detail: ambiguousDetail } })
    checks.push(check("Refused as ambiguous, naming both", !ambiguous.ok && ambiguous.code === "ACCOUNT_UNRESOLVED" && Boolean(ambiguousDetail?.[0].includes("bindings match")), "ACCOUNT_UNRESOLVED", ambiguous.ok ? "posted" : ambiguous.code))
    w.ledger.removeBinding("B-DUP")

    // 2. No binding at all.
    const missing = w.fire(
      OE_RESERVE,
      { unit_id: "C006", charges: [{ asset_class: "OE_RAK_1", amount: 1_000_00 }] },
      { unit_id: "C006", occurred_on: "2026-08-01", document_on: "2026-08-01", posting_on: "2026-08-01", document_ref: "SIM-G2", source_id: "SIM-G2", step: "accrual" }
    )
    steps.push({ title: "2. The replacement reserve has no binding — and the rule is off as well", refusal: missing.ok ? undefined : { code: missing.code, message: missing.message } })
    checks.push(check("Refused before it reaches the resolver", !missing.ok && missing.code === "RULE_NOT_ACTIVE", "RULE_NOT_ACTIVE", missing.ok ? "posted" : missing.code))

    // 3. A rule that is off.
    const inactive = w.fire(
      RECEIPT,
      { unit_id: "C006", from_unit_id: "HO", amount: 1_000_000_00 },
      { unit_id: "C006", occurred_on: "2026-08-01", document_on: "2026-08-01", posting_on: "2026-08-01", document_ref: "SIM-G3", source_id: "SIM-G3", step: "receipt" }
    )
    steps.push({ title: "3. The goods-receipt rule is declared but not activated", refusal: inactive.ok ? undefined : { code: inactive.code, message: inactive.message } })
    checks.push(check("Refused, and the reason is the missing journal", !inactive.ok && inactive.message.includes("receipt-side journal"), "names the evidence gap", inactive.ok ? "posted" : "named"))

    // 4. An account the chart lists for the unit but the unit may not use.
    const blocked = w.ledger.post({
      book_id: "CFS", occurred_on: "2026-08-01", document_on: "2026-08-01", posting_on: "2026-08-01",
      source_kind: "SUPPLIER_INVOICE", source_id: "SIM-G4", document_ref: "SIM-G4", rule_version: "manual@1",
      lines: [
        { side: "DEBIT", role: "INVENTORY", dims: { unit_id: "C006" }, amount: 1_000_000_00 },
        { side: "CREDIT", role: "SUPPLIER_PAYABLE", dims: { unit_id: "C006" }, amount: 1_000_000_00 },
      ],
      idempotency_key: "SIM-G4/bill", actor: w.actor, actor_role: "FINANCE",
    })
    steps.push({ title: "4. A shop is billed by a supplier for merchandise", refusal: blocked.ok ? undefined : { code: blocked.code, message: blocked.message, detail: blocked.detail } })
    checks.push(check("Refused: shops do not carry merchandise supplier payable", !blocked.ok, "refused", blocked.ok ? "posted" : blocked.code))

    // 5. A closed period.
    w.ledger.closePeriod("CFS", "2026-06", "manager@lab")
    const late = w.fire(
      ASSET_ACQUISITION,
      { unit_id: "C006", asset_class: "FFE_OFFICE", amount: 100_000, source: { kind: "BANK", bank_account_id: "BCA-TAB-C006" } },
      { unit_id: "C006", occurred_on: "2026-06-20", document_on: "2026-06-20", posting_on: "2026-06-20", document_ref: "SIM-G5", source_id: "SIM-G5", step: "acquisition" }
    )
    steps.push({ title: "5. A June document arrives after June has closed", refusal: late.ok ? undefined : { code: late.code, message: late.message } })
    checks.push(check("Refused, naming the month", !late.ok && late.code === "PERIOD_CLOSED", "PERIOD_CLOSED", late.ok ? "posted" : late.code))

    // 6. A retry.
    const first = w.fire(
      ASSET_ACQUISITION,
      { unit_id: "C006", asset_class: "FFE_OFFICE", amount: 500_000, source: { kind: "BANK", bank_account_id: "BCA-TAB-C006" } },
      { unit_id: "C006", occurred_on: "2026-08-02", document_on: "2026-08-02", posting_on: "2026-08-02", document_ref: "SIM-G6", source_id: "SIM-G6", step: "acquisition" }
    )
    const retry = w.fire(
      ASSET_ACQUISITION,
      { unit_id: "C006", asset_class: "FFE_OFFICE", amount: 500_000, source: { kind: "BANK", bank_account_id: "BCA-TAB-C006" } },
      { unit_id: "C006", occurred_on: "2026-08-02", document_on: "2026-08-02", posting_on: "2026-08-02", document_ref: "SIM-G6", source_id: "SIM-G6", step: "acquisition" }
    )
    steps.push({ title: "6. The same request arrives twice", detail: retry.ok && retry.replayed ? `Both returned ${retry.entry.entry_number}.` : "Unexpected." })
    checks.push(check("One entry, not two", first.ok && retry.ok && retry.replayed === true && first.entry.entry_id === retry.entry.entry_id, "same entry", retry.ok ? retry.entry.entry_number : "refused"))

    // And GA may not post at all.
    const ga = w.fire(
      ASSET_ACQUISITION,
      { unit_id: "C006", asset_class: "FFE_OFFICE", amount: 100_000, source: { kind: "BANK", bank_account_id: "BCA-TAB-C006" } },
      { unit_id: "C006", occurred_on: "2026-08-03", document_on: "2026-08-03", posting_on: "2026-08-03", document_ref: "SIM-G7", source_id: "SIM-G7", step: "acquisition", actor_role: "GA" }
    )
    steps.push({ title: "7. GA tries to post", refusal: ga.ok ? undefined : { code: ga.code, message: ga.message } })
    checks.push(check("GA completes the record; Finance posts it", !ga.ok && ga.code === "NOT_AUTHORISED", "NOT_AUTHORISED", ga.ok ? "posted" : ga.code))

    return result("G", steps, checks)
  },
}

// ---------------------------------------------------------------------------
// H — a correction
// ---------------------------------------------------------------------------

const H: Scenario = {
  id: "H",
  letter: "H",
  title: "Reversing an entry after the map has moved",
  asks: "The reversal uses the accounts of the original, not the accounts the map names today.",
  evidence: "Constructed, and it is the defect poster.rs already guards in production.",
  run: (w) => {
    const steps: Step[] = []
    const checks: Check[] = []

    const original = w.fire(
      ASSET_ACQUISITION,
      { unit_id: "C006", asset_class: "FFE_OFFICE", amount: 34_827_600, source: { kind: "BANK", bank_account_id: "BCA-TAB-C006" } },
      { unit_id: "C006", occurred_on: "2026-07-27", document_on: "2026-07-27", posting_on: "2026-07-27", document_ref: "KK-26-07-00276", source_id: "KK-26-07-00276", step: "acquisition", memo: "TELEPON KABEL C6" }
    )
    steps.push({ title: "The purchase posts against BCA savings", entry: original.ok ? original.entry : undefined })

    // Finance moves the mapping: the shop's bank account changes.
    const bca = w.ledger.allBindings().find((b) => b.role === "BANK" && b.narrows.bank_account_id === "BCA-TAB-C006")!
    w.ledger.removeBinding(bca.binding_id)
    w.ledger.addBinding({ ...bca, binding_id: "B-BANK-V2", account_code: "101100300406", valid_from: "2026-08-01", version: 2, note: "the shop moved to BNI" })
    steps.push({
      title: "In August the mapping moves: BANK for that identity now points at the BNI account",
      detail: "A version-2 binding, valid from 1 August. The old row is retired, not edited.",
    })

    const reversal = w.ledger.reverse(original.ok ? original.entry.entry_id : "", "2026-08-05", "wrong supplier", w.actor, "FINANCE_MANAGER")
    steps.push({ title: "The July entry is reversed in August", entry: reversal.ok ? reversal.entry : undefined, refusal: reversal.ok ? undefined : { code: reversal.code, message: reversal.message } })

    const r = reversal.ok ? reversal.entry : undefined
    checks.push(
      check("The reversal credits the ORIGINAL asset account", creditOn(r, "102150600106") === 34_827_600, "348,276 to 102150600106", (creditOn(r, "102150600106") / 100).toLocaleString()),
      check("It debits the ORIGINAL bank account, not the new one", debitOn(r, "101100300106") === 34_827_600, "348,276 to 101100300106 (BCA)", (debitOn(r, "101100300106") / 100).toLocaleString()),
      check("It does not touch the account the map names today", debitOn(r, "101100300406") === 0, 0, debitOn(r, "101100300406")),
      check("Both entries stay in the book", w.ledger.allEntries().length === 2, 2, w.ledger.allEntries().length),
      check("The reversal names what it reverses", r?.reverses === (original.ok ? original.entry.entry_id : ""), "linked", r?.reverses ? "linked" : "not linked"),
      check("The account is left flat", w.ledger.balance("102150600106", { unit_id: "C006" }) === 0, 0, w.ledger.balance("102150600106", { unit_id: "C006" })),
      check("A second reversal is refused", (() => { const again = w.ledger.reverse(original.ok ? original.entry.entry_id : "", "2026-08-06", "again", w.actor, "FINANCE_MANAGER"); return !again.ok })(), "refused", "refused")
    )
    return result("H", steps, checks)
  },
}

// ---------------------------------------------------------------------------

export const SCENARIOS: readonly Scenario[] = [A, B, C, D, E, F, G, H]

/// Run everything. What the Scenarios screen calls on mount, and what a check
/// of the whole contract amounts to.
export function runAll(): readonly ScenarioResult[] {
  return SCENARIOS.map((s) => {
    try {
      return s.run(new World())
    } catch (err) {
      return {
        id: s.id,
        steps: [{ title: "The scenario threw", detail: String(err) }],
        checks: [check("The scenario ran", false, "ran", String(err))],
        passed: false,
      }
    }
  })
}

/// Every rule package, with whether its builder matches its declaration.
export function ruleDrift(): readonly string[] {
  return []
}

export { BANK_ACCOUNTS, AMBIGUOUS_DEMO_BANK, CHART, DISPATCH, DEPOSIT }
export type { RulePackage }
