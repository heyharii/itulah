/// The monthly charge, and the convention the client's own numbers proved.
///
/// # The convention, and how it was settled
///
/// The register carries two dates for every row: `TGL BELI` (purchase) and
/// `PERIODE` (the month the asset module files the addition under). They are
/// usually one or two months apart, and which one starts the schedule was an
/// open question — the sort that is invisible until a year-end.
///
/// It is not open any more. Run both conventions over C006's 46 register rows
/// for July 2026:
///
///     PERIODE  → 13 assets charging, Rp15,748,763
///     TGL BELI →  9 assets charging, Rp 4,683,970
///
/// The client's entry `GL-26-07-00004` is Rp4,683,970 across exactly those
/// nine lines, each one matching to the rupiah. So the schedule starts in the
/// month of purchase, and `register_on` is a filing date that must be stored
/// and must not drive arithmetic.
///
/// The four rows that fall away on the right convention are the ten-year
/// assets bought 2016-01-01 and filed under 201702 — Bangunan Tambahan,
/// Air Conditioner, Genset, Instalasi Mekanikal Elektrikal. On the purchase
/// convention their last month was December 2025, which is why July charges
/// nothing for them. On the filing convention they would each still be
/// charging, and the run would have posted Rp11,064,793 the client did not.
///
/// # Truncation, not rounding
///
/// `1,329,100 / 60 = 22,151.67` and the client posted `22,151`. Six of the
/// nine lines have a fraction and all six are truncated. Rounding would put
/// four of them out by one rupiah — small, and exactly the kind of difference
/// that makes a reconciliation report unusable because it is never empty.

import type {
  AssetFact,
  AssetTreatment,
  DepreciationCharge,
  Minor,
  Month,
} from "./types"

export function monthIndex(month: Month): number {
  const [y, m] = month.split("-").map(Number)
  return y * 12 + (m - 1)
}

/// How many months of charge have been taken by the END of `month`, counting
/// the month of purchase as the first.
export function elapsedMonths(in_service_on: string, month: Month): number {
  return monthIndex(month) - monthIndex(in_service_on.slice(0, 7)) + 1
}

/// The monthly amount, truncated to a WHOLE RUPIAH.
///
/// Not to a sen. `1,329,100 / 60 = 22,151.666…` and the client posted
/// `22,151`, not `22,151.66`. Every figure in their ledger export is a whole
/// rupiah, and truncating at the minor unit instead puts the July replay out by
/// Rp3.40 across nine lines — small enough to look like a rounding quibble and
/// large enough that the reconciliation report is never empty, which is the
/// state in which people stop reading it.
///
/// So: divide in rupiah, floor, and return to minor units.
export function monthlyCharge(depreciable_minor: Minor, months: number): Minor {
  if (months <= 0) return 0
  return Math.floor(depreciable_minor / months / 100) * 100
}

/// What one asset charges in one month, or why it does not.
export function charge(
  fact: AssetFact,
  treatment: AssetTreatment | undefined,
  month: Month
): DepreciationCharge {
  const base = {
    asset_id: fact.asset_id,
    period: month,
    asset_class: fact.asset_class,
    unit_id: fact.unit_id,
  }
  if (!treatment || treatment.decision !== "CAPITALISE") {
    return { ...base, amount: 0, skipped: "NOT_CAPITALISED" }
  }
  if (fact.status === "DISPOSED") {
    return { ...base, amount: 0, skipped: "DISPOSED" }
  }
  if (treatment.charge === "NONE" || treatment.method === "NONE") {
    return { ...base, amount: 0, skipped: "NO_MONTHLY_CHARGE" }
  }
  const n = elapsedMonths(treatment.in_service_on, month)
  if (n < 1) return { ...base, amount: 0, skipped: "NOT_IN_SERVICE" }
  if (n > treatment.life_months)
    return { ...base, amount: 0, skipped: "FULLY_DEPRECIATED" }

  return {
    ...base,
    amount: monthlyCharge(
      treatment.cost - treatment.salvage,
      treatment.life_months
    ),
  }
}

/// The whole run for one unit and one month, in register order.
export function run(
  facts: readonly AssetFact[],
  treatments: readonly AssetTreatment[],
  unit_id: string,
  month: Month
): readonly DepreciationCharge[] {
  const byId = new Map(treatments.map((t) => [t.asset_id, t]))
  return facts
    .filter((f) => f.unit_id === unit_id)
    .map((f) => charge(f, byId.get(f.asset_id), month))
}

/// What accumulated depreciation the schedule says an asset carries by the end
/// of a month. Summed, never stored — the same decision the production schema
/// makes for the same reason.
export function accumulated(
  fact: AssetFact,
  treatment: AssetTreatment | undefined,
  upto: Month
): Minor {
  if (!treatment || treatment.decision !== "CAPITALISE") return 0
  if (treatment.charge === "NONE" || treatment.method === "NONE") return 0
  // A disposed asset stops accumulating on the day it leaves. Reading the fact
  // here rather than only in `charge` is what stops the register and the run
  // disagreeing about an asset that was written off mid-life.
  if (fact.status === "DISPOSED" && fact.document_on < upto) return 0
  const n = Math.min(
    Math.max(elapsedMonths(treatment.in_service_on, upto), 0),
    treatment.life_months
  )
  const monthly = monthlyCharge(
    treatment.cost - treatment.salvage,
    treatment.life_months
  )
  const straight = monthly * n
  // The last month takes the truncation remainder, so an asset ends at exactly
  // its salvage value rather than a few rupiah above it.
  if (n === treatment.life_months) return treatment.cost - treatment.salvage
  return straight
}

/// One row of the reconciliation between a replay and what the client posted.
export interface ReconRow {
  readonly label: string
  readonly computed: Minor
  readonly actual: Minor
  readonly matched: boolean
  readonly note?: string
}

/// Line up a replay against the client's own entry.
///
/// Matched by AMOUNT within a class, because the client's entry carries no
/// asset reference — nine lines that say only `DEPRESIASI ASSET JULY 2026`.
/// That is a limitation of their export and not of this function, and it is
/// why the report says "unmatched" rather than pretending to a pairing it
/// cannot prove.
export function reconcile(
  computed: readonly DepreciationCharge[],
  actual: readonly { readonly amount: Minor; readonly name: string }[],
  names: ReadonlyMap<string, string>
): { rows: readonly ReconRow[]; computedTotal: Minor; actualTotal: Minor } {
  const pool = actual.map((a) => ({ ...a, taken: false }))
  const rows: ReconRow[] = []
  for (const c of computed) {
    if (c.amount === 0) continue
    const hit = pool.find((p) => !p.taken && p.amount === c.amount)
    if (hit) hit.taken = true
    rows.push({
      label: names.get(c.asset_id) ?? c.asset_id,
      computed: c.amount,
      actual: hit ? hit.amount : 0,
      matched: Boolean(hit),
      note: hit
        ? undefined
        : "no line of the client's entry carries this amount",
    })
  }
  for (const p of pool.filter((p) => !p.taken)) {
    rows.push({
      label: p.name,
      computed: 0,
      actual: p.amount,
      matched: false,
      note: "the client posted this and the replay did not produce it",
    })
  }
  return {
    rows,
    computedTotal: computed.reduce((n, c) => n + c.amount, 0),
    actualTotal: actual.reduce((n, a) => n + a.amount, 0),
  }
}
