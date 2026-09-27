import type { RecordKind } from "@itulah/contract"

import type { SheetKey } from "@/lib/sheets"

/// Where a record is SHOWN, for the surfaces that can only name one.
///
/// A notification, an audit line and a search result all have the same problem:
/// they hold `(kind, id)` and need a place to send somebody. The server
/// deliberately stores the record rather than a URL — a stored link would have
/// stranded every old notification the day a route was renamed — so the
/// translation has to live on this side, and it should live in exactly one
/// file rather than once per surface.
///
/// # A kind missing from here is not a bug
///
/// Some records have no screen that shows one by id. A goods receipt is the
/// standing example: naming a delivery is head office's work and it is done on
/// the sourcing side, and no screen takes a receipt id. For those the sentence
/// still says what happened and simply does not offer to take you anywhere —
/// which is honest, and better than a link that lands on a list and leaves
/// somebody scrolling for the row.
///
/// # Why the sheet key and not a query string
///
/// `lib/sheets.ts` owns how a record sheet is opened from a URL, including the
/// parameter's name. Naming the key here and letting that module build the URL
/// keeps one of them in charge of it.
const WHERE: Partial<Record<RecordKind, { to: string; sheet?: SheetKey }>> = {
  // Purchasing
  purchase_price_amendment: {
    to: "/procurement/amendments",
    sheet: "amendment",
  },
  purchase_order: { to: "/procurement/orders", sheet: "order" },
  supplier: { to: "/procurement/suppliers", sheet: "supplier" },

  // The report channel. A thread is a PAGE and not a sheet — the owner asked
  // for that explicitly — so this lands on the module and the thread's own
  // sheet key does the rest.
  discussion: { to: "/discussions", sheet: "thread" },

  // Assets have two doors onto one register, and a notification goes through
  // GA's: what a fault report is about is the thing, not what it is carried
  // at, and the money screen would ask its reader for a rung they may not have.
  asset: { to: "/assets", sheet: "asset" },

  // Finance
  bill: { to: "/finance/payables/bills", sheet: "bill" },
  bank_statement: { to: "/finance/cash-bank/bank-reconciliation", sheet: "statement" },

  // People
  employee: { to: "/people", sheet: "employee" },

  // Marketing. The marketing watch raises notices about a promotion or a
  // campaign that has used up its budget or crossed a guardrail, and both
  // screens open the record from the URL. A price book has no screen of its
  // own, so a rollout notice names it in words and offers no link.
  commercial_rule: { to: "/commercial/promotions", sheet: "rule" },
  campaign: { to: "/commercial/campaigns", sheet: "campaign" },
}

/// The screen a record is on, or `null` when nothing shows that kind by id.
export function recordRoute(
  kind: string | null,
  id: string | null
): { to: string; sheet?: { key: SheetKey; value: string } } | null {
  if (kind === null || id === null) return null
  const where = WHERE[kind as RecordKind]
  if (where === undefined) return null
  return {
    to: where.to,
    sheet:
      where.sheet === undefined ? undefined : { key: where.sheet, value: id },
  }
}
