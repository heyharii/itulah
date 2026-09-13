/// The client's chart, read from their own export.
///
/// # What changed and why
///
/// This file used to hold 900 hand-lifted leaves for three units, on the
/// argument that they were the only accounts the scenarios post to. That
/// reasoning belonged to a scenario harness. It is a finance application now,
/// with a `Chart of accounts` menu, and a chart holding an eighth of the
/// accounts answers "do we have an account for this" wrongly — 39 of the
/// client's 76 families had no row at all, including every fixed-asset class
/// above Furniture, every long-term loan, and the whole of Pre-opening.
///
/// So the rows moved to `chart-data.ts`, packed, and all 7,528 of them are
/// here. What stays in this file is what is ours rather than theirs: the
/// posting policy, the index, and the family helper.
///
/// The tuple is `[code, name, unit, active]`. Unit is derived from the
/// client's own two-digit suffix, which is where they put it.

import { CHART_TSV } from "./chart-data"
import type { Account } from "./types"

type Row = readonly [code: string, name: string, unit: string, active: boolean]

const ROWS: readonly Row[] = CHART_TSV.split("\n")
  .filter((line) => line.length > 0)
  .map((line) => {
    const [code, name, unit, active] = line.split("\t")
    return [code, name, unit, active === "1"] as const
  })

/// Accounts the chart lists for a unit that the unit may not post to.
///
/// One entry today and it is a confirmed fact, not a guess: the client said
/// shops do not carry merchandise supplier payable — head office buys the
/// stock and the shop owes head office for goods, which is
/// `2012302* Hutang Affiliasi Atas Barang`. The master still lists
/// `2012001001 Hutang Suppliers Barang Dagangan` per unit, so the chart alone
/// would let a rule post a shop's supplier bill straight into it.
///
/// Kept apart from the chart's own `active` flag deliberately. `active` is the
/// client's declaration about the account; this is OUR posting policy for a
/// unit, and merging them would mean editing the client's chart to express a
/// rule of ours.
const BLOCKED: Readonly<Record<string, readonly string[]>> = {
  // Merchandise supplier payable, blocked at every shop.
  "2012001001": ["C004", "C006"],
}

function blockedFor(code: string): readonly string[] | undefined {
  const family = code.slice(0, 10)
  return BLOCKED[family]
}

export const CHART: readonly Account[] = ROWS.map(
  ([code, name, unit, active]) => ({
    code,
    name,
    root_class: code[0],
    postable: active,
    unit_id: unit || undefined,
    blocked_units: blockedFor(code),
  })
)

const INDEX = new Map(CHART.map((a) => [a.code, a]))

export function account(code: string): Account | undefined {
  return INDEX.get(code)
}

/// The client's ladder is `{1,3,5,7,10,12}` and a family is the seven-digit
/// rung. Used for grouping on screens, never for choosing an account.
export function family(code: string): string {
  return code.slice(0, 7)
}
