import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { count } from "@/lib/format"
import { moneyOverviewQuery } from "@/lib/queries/finance"
import type { GiroRow } from "@itulah/contract"

/// BG Keluar from writing to clearing: what is already promised out of which
/// bank, and when. The words of the Giro screen, as `scr-cash2.js` has them.
///
/// The server's ladder is ISSUED, DELIVERED, DUE, CLEARED, REJECTED (and
/// VOIDED). The screen reads it as four states:
///
/// | Screen        | Server            |
/// | ------------- | ----------------- |
/// | Written       | ISSUED            |
/// | With supplier | DELIVERED, DUE    |
/// | Cleared       | CLEARED           |
/// | Bounced       | REJECTED          |

export type GiroLane = "written" | "with" | "cleared" | "bounced"

export type GiroTab = "board" | "list" | "opening"

/// The list's chips.
export type GiroFilter =
  "all" | "written" | "with" | "week" | "late" | "cleared" | "bounced"

export type GiroTone = "neutral" | "info" | "ok" | "bad"

/// A voided giro (its payment was reversed) has no place on the screen.
export function laneOf(row: GiroRow): GiroLane | null {
  switch (row.status) {
    case "ISSUED":
      return "written"
    case "DELIVERED":
    case "DUE":
      return "with"
    case "CLEARED":
      return "cleared"
    case "REJECTED":
      return "bounced"
    default:
      return null
  }
}

/// Still to leave the bank.
export function isOut(row: GiroRow): boolean {
  const lane = laneOf(row)
  return lane === "written" || lane === "with"
}

/// With the supplier and past its date. `days_overdue` is measured against
/// the day the board was drawn for.
export function isLate(row: GiroRow): boolean {
  return laneOf(row) === "with" && row.days_overdue > 0
}

/// Due from today to six days on.
export function isThisWeek(row: GiroRow): boolean {
  return isOut(row) && row.days_overdue <= 0 && row.days_overdue >= -6
}

export function lateWord(days: number): string {
  return `${count(days)} ${days === 1 ? "day" : "days"} late`
}

/// The pill word and its tone.
export function giroWord(row: GiroRow): readonly [string, GiroTone] {
  if (isLate(row)) return [lateWord(row.days_overdue), "bad"]
  switch (laneOf(row)) {
    case "written":
      return ["Written", "neutral"]
    case "with":
      return ["With supplier", "info"]
    case "cleared":
      return ["Cleared", "ok"]
    case "bounced":
      return ["Bounced", "bad"]
    default:
      return ["Voided", "neutral"]
  }
}

/// 7Soft's three words for a giro: New (not yet through the bank), Cair
/// (cleared), Tolakan (bounced). A voided giro has none.
export type GiroWord = "New" | "Cair" | "Tolakan" | "Void"

export function giroStatusWord(row: GiroRow): GiroWord {
  switch (row.status) {
    case "ISSUED":
    case "DELIVERED":
    case "DUE":
      return "New"
    case "CLEARED":
      return "Cair"
    case "REJECTED":
      return "Tolakan"
    default:
      return "Void"
  }
}

/// The giro's own bank account, in the unit whose books it is drawn in.
function accountKey(row: GiroRow): string {
  return `${row.unit_id}\t${row.bank.toUpperCase()}`
}

export interface GiroAccount {
  readonly name: string
  readonly number: string | null
  readonly books: number
}

/// Each giro's bank account out of the money overview: the bank pot of the
/// giro's unit whose qualifier is the giro's bank. `balanceOf` is the
/// account's books, less every BG still out that falls due on or before this
/// one (null for a BG that is no longer out, or whose account is not mapped).
export function useGiroAccounts(rows: readonly GiroRow[]) {
  const money = useQuery(moneyOverviewQuery())
  return useMemo(() => {
    const accounts = new Map<string, GiroAccount>()
    for (const account of money.data?.rows ?? []) {
      if (account.pot !== "BANK") continue
      if (account.semantic_key.includes("giro_outstanding")) continue
      const key = `${account.unit_id}\t${account.qualifier.toUpperCase()}`
      if (!accounts.has(key))
        accounts.set(key, {
          name: account.account_name,
          number: null,
          books: account.per_books_minor,
        })
    }
    const out = rows.filter(isOut)
    return {
      accountOf: (row: GiroRow): GiroAccount | null =>
        accounts.get(accountKey(row)) ?? null,
      balanceOf: (row: GiroRow): number | null => {
        if (!isOut(row)) return null
        const account = accounts.get(accountKey(row))
        if (account === undefined) return null
        const ahead = out
          .filter(
            (other) =>
              accountKey(other) === accountKey(row) &&
              (other.due_date < row.due_date ||
                (other.due_date === row.due_date && other.number <= row.number))
          )
          .reduce((sum, other) => sum + other.amount_minor, 0)
        return account.books - ahead
      },
    }
  }, [money.data, rows])
}

export function sumOf(rows: readonly GiroRow[]): number {
  return rows.reduce((sum, row) => sum + row.amount_minor, 0)
}

/// The first day of the month the books opened in: a BG written before it was
/// still out when they opened (Saldo Awal BG). The server keeps no opening
/// register, so it is read from the earliest issue date that sits before the
/// earliest period.
export function isOpeningGiro(row: GiroRow, began: string | null): boolean {
  return began !== null && row.issue_date < began
}
