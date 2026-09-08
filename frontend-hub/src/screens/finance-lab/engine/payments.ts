/// Payments, open items and allocation — the part §5 says v0.1 was missing.
///
/// # Why a payment has allocation LINES and not an amount
///
/// The client's own payroll BKK settles four different things in one document:
///
///     C006-BKK-26-07-00046, 31 July 2026
///       Dr Biaya Gaji dan Upah YMHD        57,250,000   an accrual
///       Dr Biaya Asuransi dan BPJS YMHD     1,913,489   a second accrual
///       Dr Biaya Asuransi dan BPJS YMHD     1,249,739   the same accrual again
///       Dr Biaya Rumah Tangga               1,500,000   a cost, incurred and paid
///       Dr Biaya Rumah Tangga                     272   rounding
///       Cr PETTY CASH                      61,913,500
///
/// A payment carrying one amount and one account cannot express that, and the
/// workaround is five payments — at which point Cash & Bank shows five
/// withdrawals where the bank shows one. So allocation is the model, and a
/// target is either an open item or a cost being incurred right now. Both are
/// needed: forcing the parking fee through an invented payable is how a
/// payables ledger fills up with rows nobody ever raised.
///
/// # Why the status list is six long
///
/// Because clicking Pay is not a bank transfer. REQUESTED, APPROVED and
/// INSTRUCTED are all before the money moves; SETTLED is after; FAILED is a
/// real outcome that must not silently look like a draft; RECONCILED is the
/// statement agreeing. Only SETTLED posts, and only once.

import { Ledger, type IntentLine } from "./ledger"
import type {
  Allocation,
  Day,
  Minor,
  OpenItem,
  Payment,
  PaymentAction,
  PaymentSource,
  PaymentStatus,
  Role,
  AccountRole,
} from "./types"

export interface PaymentDraft {
  readonly book_id: string
  readonly unit_id: string
  readonly direction: "OUT" | "IN"
  readonly occurred_on: Day
  readonly document_on: Day
  readonly posting_on: Day
  readonly counterparty: string
  readonly source: PaymentSource
  readonly allocations: readonly Allocation[]
  readonly action: PaymentAction
  readonly document_ref: string
}

/// What a payment may do next, so a screen never has to work it out and get a
/// different answer from the engine.
const NEXT: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  REQUESTED: ["APPROVED", "CANCELLED"],
  APPROVED: ["INSTRUCTED", "CANCELLED"],
  INSTRUCTED: ["SETTLED", "FAILED"],
  SETTLED: ["RECONCILED"],
  FAILED: ["INSTRUCTED", "CANCELLED"],
  CANCELLED: [],
  RECONCILED: [],
}

/// Which role the money side of a payment uses.
function sourceRole(s: PaymentSource): AccountRole {
  return s.kind === "BANK" ? "BANK" : s.kind === "PETTY_CASH" ? "PETTY_CASH" : "CASH_ON_HAND"
}

export class Payments {
  private items = new Map<string, OpenItem>()
  /// What each open item has had settled against it. Never stored on the item:
  /// an outstanding balance and the allocations that made it are two copies of
  /// one number, and they drift.
  private settled: { item_id: string; payment_id: string; amount: Minor }[] = []
  private payments: Payment[] = []
  private counter = 0

  private ledger: Ledger

  constructor(ledger: Ledger) {
    this.ledger = ledger
  }

  // -- open items ---------------------------------------------------------

  open(item: OpenItem) {
    this.items.set(item.item_id, item)
  }

  allItems(): readonly OpenItem[] {
    return [...this.items.values()]
  }

  item(id: string): OpenItem | undefined {
    return this.items.get(id)
  }

  /// What is left on one item. Counts SETTLED payments only — a payment that
  /// is merely approved has reserved nothing yet, and a screen that treated it
  /// as settled would show a debt as paid before the money left.
  outstanding(item_id: string): Minor {
    const item = this.items.get(item_id)
    if (!item) return 0
    const paid = this.settled
      .filter((s) => s.item_id === item_id)
      .reduce((n, s) => n + s.amount, 0)
    return item.original - paid
  }

  /// What an item has reserved against it by payments that are on their way
  /// but not yet settled. Shown separately, because "still owed" and "already
  /// promised to a payment in flight" are different answers to different
  /// questions and one number cannot be both.
  reserved(item_id: string): Minor {
    return this.payments
      .filter((p) => p.status === "APPROVED" || p.status === "INSTRUCTED")
      .flatMap((p) => p.allocations)
      .filter((a) => a.target.kind === "OPEN_ITEM" && a.target.item_id === item_id)
      .reduce((n, a) => n + a.amount, 0)
  }

  // -- payments -----------------------------------------------------------

  request(draft: PaymentDraft, actor: string): Payment | { error: string } {
    const total = draft.allocations.reduce((n, a) => n + a.amount, 0)
    if (total <= 0) return { error: "a payment answers at least one thing" }
    for (const a of draft.allocations) {
      if (!Number.isInteger(a.amount) || a.amount <= 0) {
        return { error: `an allocation of ${a.amount} is not a whole positive amount` }
      }
      if (a.target.kind === "OPEN_ITEM") {
        const item = this.items.get(a.target.item_id)
        if (!item) return { error: `no open item ${a.target.item_id}` }
        const room = this.outstanding(item.item_id) - this.reserved(item.item_id)
        if (a.amount > room) {
          return {
            error:
              `${item.description} has ${room} left once payments in flight are counted; ` +
              `this allocates ${a.amount}`,
          }
        }
        if (item.unit_id !== draft.unit_id) {
          return {
            error:
              `${item.description} belongs to ${item.unit_id} and this payment is from ` +
              `${draft.unit_id}. Head office paying a unit's obligation is a real thing and it ` +
              `needs the inter-unit accounts, which is a different rule — refused rather than ` +
              `posted to the wrong book.`,
          }
        }
      }
    }
    this.counter += 1
    const payment: Payment = {
      payment_id: `PAY-${String(this.counter).padStart(4, "0")}`,
      payment_number: `${draft.unit_id}-${draft.direction === "OUT" ? "BKK" : "BKM"}-SIM-${String(this.counter).padStart(5, "0")}`,
      book_id: draft.book_id,
      unit_id: draft.unit_id,
      direction: draft.direction,
      dates: {
        occurred_on: draft.occurred_on,
        document_on: draft.document_on,
        posting_on: draft.posting_on,
        period: draft.posting_on.slice(0, 7),
      },
      counterparty: draft.counterparty,
      source: draft.source,
      allocations: draft.allocations,
      total,
      status: "REQUESTED",
      history: [{ at: draft.document_on, status: "REQUESTED", actor }],
      action: draft.action,
    }
    this.payments.push(payment)
    return payment
  }

  /// Move a payment along. Refuses a transition the lifecycle does not have,
  /// which is what stops a screen inventing "mark as paid" on a draft.
  advance(
    payment_id: string,
    to: PaymentStatus,
    actor: string,
    actor_role: Role,
    note?: string
  ): Payment | { error: string } {
    const i = this.payments.findIndex((p) => p.payment_id === payment_id)
    if (i < 0) return { error: `no payment ${payment_id}` }
    const p = this.payments[i]
    if (!NEXT[p.status].includes(to)) {
      return {
        error: `${p.payment_number} is ${p.status}; it can only go to ${NEXT[p.status].join(" or ") || "nowhere"}`,
      }
    }
    if (to === "APPROVED" && actor_role !== "FINANCE_MANAGER") {
      return { error: "approval is the finance manager's, not the preparer's" }
    }

    if (to === "SETTLED") {
      const posted = this.post(p, actor, actor_role)
      if ("error" in posted) return posted
      const next: Payment = {
        ...p,
        status: to,
        entry_id: posted.entry_id,
        history: [...p.history, { at: p.dates.posting_on, status: to, actor, note }],
      }
      this.payments[i] = next
      for (const a of p.allocations) {
        if (a.target.kind === "OPEN_ITEM") {
          this.settled.push({ item_id: a.target.item_id, payment_id: p.payment_id, amount: a.amount })
        }
      }
      return next
    }

    const next: Payment = {
      ...p,
      status: to,
      failure_reason: to === "FAILED" ? note : p.failure_reason,
      history: [...p.history, { at: p.dates.posting_on, status: to, actor, note }],
    }
    this.payments[i] = next
    return next
  }

  /// The entry a settlement makes.
  ///
  /// One line per allocation on the obligation side, one for the money. Per
  /// allocation rather than one lumped line, for the same reason the
  /// production supplier payment does it: a single line cannot say which debts
  /// the money answered, and the sub-ledger that could say it would be a
  /// second copy of the general ledger.
  private post(p: Payment, actor: string, actor_role: Role): { entry_id: string } | { error: string } {
    const lines: IntentLine[] = []
    for (const a of p.allocations) {
      if (a.target.kind === "OPEN_ITEM") {
        const item = this.items.get(a.target.item_id)
        if (!item) return { error: `no open item ${a.target.item_id}` }
        lines.push({
          side: p.direction === "OUT" ? "DEBIT" : "CREDIT",
          role: item.role,
          dims: { unit_id: item.unit_id, ...item.narrows },
          amount: a.amount,
          memo: `${item.source_ref} ${item.description}`,
        })
      } else {
        lines.push({
          side: p.direction === "OUT" ? "DEBIT" : "CREDIT",
          role: a.target.role,
          dims: { unit_id: p.unit_id, ...a.target.narrows },
          amount: a.amount,
          memo: a.target.description,
        })
      }
    }
    lines.push({
      side: p.direction === "OUT" ? "CREDIT" : "DEBIT",
      role: sourceRole(p.source),
      dims: {
        unit_id: p.unit_id,
        bank_account_id: p.source.kind === "BANK" ? p.source.bank_account_id : undefined,
      },
      amount: p.total,
      memo: p.counterparty,
    })

    const outcome = this.ledger.post({
      book_id: p.book_id,
      occurred_on: p.dates.occurred_on,
      document_on: p.dates.document_on,
      posting_on: p.dates.posting_on,
      source_kind: "PAYMENT",
      source_id: p.payment_id,
      document_ref: p.payment_number,
      rule_version: "payment_settlement@1",
      memo: `${p.payment_number} — ${p.counterparty}`,
      lines,
      // The step is in the key. One document may post a settlement and, later,
      // a correction; neither is a duplicate of the other.
      idempotency_key: `${p.payment_id}/settlement`,
      actor,
      actor_role,
    })
    if (!outcome.ok) {
      return { error: `${outcome.message}${outcome.detail ? " — " + outcome.detail.join("; ") : ""}` }
    }
    return { entry_id: outcome.entry.entry_id }
  }

  all(): readonly Payment[] {
    return this.payments
  }

  payment(id: string): Payment | undefined {
    return this.payments.find((p) => p.payment_id === id)
  }

  /// Every payment that touched one open item. What makes the same record
  /// appear under Cash & Bank and under Accruals without being two records.
  touching(item_id: string): readonly Payment[] {
    return this.payments.filter((p) =>
      p.allocations.some((a) => a.target.kind === "OPEN_ITEM" && a.target.item_id === item_id)
    )
  }
}
