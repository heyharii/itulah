import { dateText } from "@/lib/format"

/// The words Sales and Reconciliation share: how a tender is named, how a time
/// and a difference are written. Apart from the components so those files
/// export components only.

/// Every form of payment the till takes, in the order a drawer's tabs read
/// them. `CARD` is one tender here: the node records a card sale as `CARD` and
/// keeps no debit/credit split in what it serves.
export const TENDER_ORDER = [
  "CASH",
  "CARD",
  "QRIS",
  "EWALLET",
  "VOUCHER",
  "BENEFIT",
  "OTHER",
] as const

const WORDS: Readonly<Record<string, string>> = {
  CASH: "Cash",
  CARD: "Card",
  QRIS: "QRIS",
  EWALLET: "E-Wallet",
  VOUCHER: "Voucher",
  BENEFIT: "Saldo karyawan",
  OTHER: "Other",
}

export const tenderWord = (method: string): string => WORDS[method] ?? method

/// A time of day, 24-hour: "21:42".
export function clock(iso: string | null | undefined): string {
  if (!iso) return "—"
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return "—"
  return dateText(parsed, { hour: "2-digit", minute: "2-digit", hour12: false })
}

/// The day a stamp is pressed on: "11 OCT".
export function stampDay(iso: string | null | undefined): string {
  if (!iso) return ""
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return ""
  return dateText(parsed, { day: "2-digit", month: "short" }).toUpperCase()
}

/// A difference's word and colour: over is amber, short is red, even is quiet.
export function differenceWord(minor: number): string {
  return minor === 0 ? "Even" : minor < 0 ? "Short" : "Over"
}

export const differenceTone = (minor: number): string =>
  minor === 0 ? "text-ink" : minor < 0 ? "text-bad-fg" : "text-warn-fg"
