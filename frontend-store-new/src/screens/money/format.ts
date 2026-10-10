import {
  Banknote,
  CreditCard,
  QrCode,
  Ticket,
  Wallet,
  type LucideIcon,
} from "lucide-react"

import { dateText } from "@/lib/format"
import { money } from "@itulah/contract/money"

/// The words and numbers the Money screens share — how a tender is named, how
/// a day is spelled, which way a difference points. Kept apart from
/// `parts.tsx` so that file exports components only.

/// A difference somebody reads across a counter, with its direction on it.
/// `−` is U+2212, not a hyphen: at a figure's size a hyphen reads as a dash.
export function signed(minor: number): string {
  if (minor === 0) return money(0)
  return `${minor < 0 ? "−" : "+"}${money(Math.abs(minor))}`
}

/// Rupiah typed in, as digits.
///
/// One parser for every amount field in the module: a field that accepted
/// "Rp 500.000" and one that accepted "500000" would be two parsers, and the
/// one nobody tested is the one a cashier uses.
export function minorFrom(text: string): number | null {
  const digits = text.replace(/\D/g, "")
  if (digits === "") return null
  const value = Number(digits)
  return Number.isSafeInteger(value) ? value : null
}

// ── Tenders ─────────────────────────────────────────────────────────────────

/// What each tender is called, and who actually settles it.
///
/// One table for Reports and Reconciliation, so a QRIS payment is not "QRIS"
/// on one screen and "Digital" on the next. The third field is why the
/// reconciliation does not lump them together: a card and a QRIS payment wait
/// on an acquirer; a voucher waits on nobody, because it discharges something
/// this estate issued and was already carrying.
export interface TenderKind {
  readonly word: string
  readonly icon: LucideIcon
  readonly settles: string
}

const TENDERS: Readonly<Record<string, TenderKind>> = {
  CASH: { word: "Cash", icon: Banknote, settles: "counted in the drawer" },
  CARD: {
    word: "Card / debit",
    icon: CreditCard,
    settles: "paid by the acquirer",
  },
  QRIS: { word: "QRIS", icon: QrCode, settles: "paid by the acquirer" },
  EWALLET: {
    word: "E-wallet",
    icon: Wallet,
    settles: "paid by the wallet provider",
  },
  VOUCHER: {
    word: "Voucher",
    icon: Ticket,
    settles: "redeems a voucher this estate issued",
  },
  OTHER: { word: "Other", icon: Wallet, settles: "settled off this node" },
}

export function tenderOf(method: string): TenderKind {
  return (
    TENDERS[method] ?? {
      word: method,
      icon: Wallet,
      settles: "settled somewhere this node cannot see",
    }
  )
}

// ── Days ────────────────────────────────────────────────────────────────────

/// How a day is written in this module: the house format (`06 Oct 2026`,
/// weekdays `Tue 06 Oct`), through `dateText` so the months are English.
///
/// Local rather than `day()` from `lib/format.ts`: that one takes an instant,
/// and a day's takings are a calendar day. `new Date(iso)` alone would read the
/// node's `YYYY-MM-DD` as UTC and move a Jakarta shop's day back by one, so the
/// midnight is spelled out and parsed local, the way `isoDay()` writes it.
const at = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`)

const DAY = { day: "2-digit", month: "short" } as const
const DAY_YEAR = { day: "2-digit", month: "short", year: "numeric" } as const

/// A calendar day with its year, no weekday: "06 Oct 2026".
export const dayYear = (iso: string) => dateText(at(iso), DAY_YEAR)

/// An axis tick: as short as a date gets and still be a date.
export const dayTick = (iso: string) => dateText(at(iso), DAY)

/// A tooltip, a caption: the day somebody says out loud, with its year.
export const dayTitle = (iso: string) =>
  `${dateText(at(iso), { weekday: "short" })} ${dateText(at(iso), DAY_YEAR)}`

/// A row's name. The weekday is carried because half of what a daily list is
/// read for is which days are quiet, and a reader should not have to work that
/// out from a number.
export const dayStamp = dayTitle

/// A span, both ends named: "07 Sep – 06 Oct 2026".
export function spanWords(from: string, to: string): string {
  if (from === to) return dayTitle(from)
  return at(from).getFullYear() === at(to).getFullYear()
    ? `${dayTick(from)} – ${dateText(at(to), DAY_YEAR)}`
    : `${dateText(at(from), DAY_YEAR)} – ${dateText(at(to), DAY_YEAR)}`
}

/// A week or a month, named by the day it starts on — the node names a week by
/// its Monday and a month by its first.
export function bucketTick(start: string, bucket: string): string {
  if (bucket === "month") {
    return dateText(at(start), { month: "short", year: "2-digit" })
  }
  return dayTick(start)
}

export function bucketTitle(start: string, bucket: string): string {
  if (bucket === "month") {
    return dateText(at(start), { month: "long", year: "numeric" })
  }
  if (bucket === "week") {
    const end = at(start)
    end.setDate(end.getDate() + 6)
    return `Week of ${dayTick(start)} – ${dateText(end, DAY_YEAR)}`
  }
  return dayTitle(start)
}
