import {
  queryOptions,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query"

import { cacheKey, node } from "@/lib/api"
import { isoDay } from "@/lib/queries"
import type { Receipt, SalesWindow } from "@/lib/queries"
import { hrKeys, teamAt, useCloudIdentity, useReach } from "@/lib/queries/hr"
import { fetchWindowAll, windowAllKey } from "@/lib/sales-window"
import { useIdentity } from "@/lib/session"
import { commandKey, receiptKey, shiftKey } from "@/lib/till"
import type { Identity } from "@itulah/contract/client"
import type {
  CashCount,
  CashMovementRequest,
  CashMovementView,
  CloseShiftRequest,
  ReceiptDocument,
  ShiftReport,
} from "@itulah/contract"

/// A cashier's session — one till shift — as the Sales and Reconciliation
/// screens read it.
///
/// A session is the node's `ShiftReport`: the float, the sales by tender, the
/// cash movements and, once the cashier has finished, the count they declared.
/// Every figure on the cards and in the sheets is the node's own. Nothing here
/// re-adds an evening in TypeScript, because a screen that did would one day
/// disagree with the node about a shop's money and the argument that followed
/// would have no referee.
///
/// ## Finding the day's sessions
///
/// The node lists the drawers that traded on a business day, open and closed
/// alike (`GET /api/v1/store/shifts?business_date=`). A drawer carries the day
/// it trades for from the moment it opens, so one that rings past midnight is
/// still one session of its own day.

// ─────────────────────────────────────────────────────────────────────────────
// The reports

/// A report whose figures a supervisor may read, narrowed back to numbers.
export type WholeReport = ShiftReport & {
  sales_total_minor: number
  cash_sales_minor: number
  non_cash_minor: number
  change_given_minor: number
  cash_refunds_minor: number
  non_cash_refunds_minor: number
  expected_cash_minor: number
}

/// Null when the node withheld the figures — a cashier is served the report
/// blind (`http.rs::blind_for_cashier`), every figure the expectation could be
/// worked back from set to null.
export function whole(report: ShiftReport): WholeReport | null {
  const {
    sales_total_minor,
    cash_sales_minor,
    non_cash_minor,
    change_given_minor,
    cash_refunds_minor,
    non_cash_refunds_minor,
    expected_cash_minor,
  } = report
  if (
    report.blind ||
    sales_total_minor === null ||
    cash_sales_minor === null ||
    non_cash_minor === null ||
    change_given_minor === null ||
    cash_refunds_minor === null ||
    non_cash_refunds_minor === null ||
    expected_cash_minor === null
  ) {
    return null
  }
  return {
    ...report,
    sales_total_minor,
    cash_sales_minor,
    non_cash_minor,
    change_given_minor,
    cash_refunds_minor,
    non_cash_refunds_minor,
    expected_cash_minor,
  }
}

/// The store's calendar day a shift trades for.
export const dayOf = (report: ShiftReport): string =>
  report.business_date ?? isoDay(new Date(report.opened_at))

/// One cashier session of a day.
export interface Session {
  readonly report: WholeReport
  /// 1, 2, 3 … in the order the day's drawers were opened.
  readonly number: number
}

/// Where a session is in its life, as far as this node can tell.
///
///  - `selling` — the drawer is open.
///  - `counted` — the cashier finished and declared what was in it.
///  - `undeclared` — it ended without a count: somebody took the seat over, and
///    its holder (or a supervisor) has not counted it yet.
export type Stage = "selling" | "counted" | "undeclared"

export function stageOf(report: ShiftReport): Stage {
  if (report.status === "OPEN") return "selling"
  return report.declared_cash_minor === null ? "undeclared" : "counted"
}

/// What the day's drawers amount to, and whether any was served blind.
export interface DaySessions {
  readonly sessions: readonly Session[]
  /// A cashier asked: every drawer came back with its figures withheld.
  readonly blind: boolean
}

export const sessionsKey = (day: string) =>
  [...shiftKey(), "sessions", day] as const

async function fetchSessions(
  day: string,
  signal?: AbortSignal,
): Promise<DaySessions> {
  const reports = await node.get<ShiftReport[]>(
    `/api/v1/store/shifts?business_date=${encodeURIComponent(day)}`,
    { signal },
  )
  const sessions = reports.flatMap((report, index) => {
    const figures = whole(report)
    return figures === null ? [] : [{ report: figures, number: index + 1 }]
  })
  return { sessions, blind: reports.some((report) => report.blind) }
}

/// The day's sessions, in the order they were opened.
export const sessionsQuery = (day: string) =>
  queryOptions({
    queryKey: sessionsKey(day),
    queryFn: ({ signal }) => fetchSessions(day, signal),
    // Under `shiftKey()`, so a void, a return or a close from the POS moves
    // these with the figures beside them; and a drawer open all day moves with
    // every sale.
    staleTime: 0,
  })

export function useSessions(day: string) {
  return useQuery({ ...sessionsQuery(day), refetchInterval: 30_000 })
}

/// Open drawers first, the one opened last on top; then the ended ones, the
/// one that ended last on top — what somebody coming to the screen wants is
/// the drawer still running or the one just finished.
export function newestFirst(sessions: readonly Session[]): Session[] {
  const open = (session: Session) => session.report.status === "OPEN"
  const when = (session: Session) =>
    Date.parse(
      open(session)
        ? session.report.opened_at
        : (session.report.closed_at ?? session.report.opened_at),
    )
  return [...sessions].sort((a, b) =>
    open(a) !== open(b) ? (open(a) ? -1 : 1) : when(b) - when(a),
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// The arithmetic the screens read, from the node's figures

/// Cash taken in the drawer net of the change handed back.
export const cashSalesOf = (report: WholeReport): number =>
  report.cash_sales_minor - report.change_given_minor

/// What one tender took, in the shift.
export const tenderTotal = (report: WholeReport, method: string): number =>
  report.tenders.find((one) => one.method === method)?.amount_minor ?? 0

/// Cash drops, and anything put back: the movements that carry takings to the
/// safe and back. An undone drop is a put-back — a correction is a new entry,
/// never an edit.
const isDrop = (movement: CashMovementView) =>
  movement.kind === "DROP" || movement.kind === "PICKUP"

export const dropsOf = (report: ShiftReport): readonly CashMovementView[] =>
  report.movements.filter(isDrop)

/// Net cash carried to the safe so far.
export const droppedOf = (report: ShiftReport): number =>
  Math.max(
    0,
    -dropsOf(report).reduce((sum, movement) => sum + movement.amount_minor, 0),
  )

/// Cash takings still in the drawer above its float — what a drop is for. The
/// node's expectation less the float, so a pay-out is already out of it.
export const toDropOf = (report: WholeReport): number =>
  Math.max(0, report.expected_cash_minor - report.opening_float_minor)

/// Who took the cash a drop carried out. The node keeps the name on the
/// movement (`received_by`); a drop written by an earlier build has it only in
/// its reason, as `Received by Maya Anggraini`.
const RECEIVED = "Received by "

export function receivedBy(movement: CashMovementView): string | null {
  if (movement.received_by !== null) return movement.received_by
  return movement.reason.startsWith(RECEIVED)
    ? movement.reason.slice(RECEIVED.length)
    : null
}

// ─────────────────────────────────────────────────────────────────────────────
// A session's receipts

/// A session's sales, newest first: the window's receipts that its cashier
/// rang while the drawer was theirs.
///
/// The node does not say which shift a receipt belongs to, so it is worked out
/// the way the node itself does it when a sale arrives (`till::shift_for_sale`):
/// the sale belongs to the shift its cashier held at that moment. A sale rung
/// with no drawer open (offline, before a seat was taken) belongs to none.
export function receiptsOf(
  sales: SalesWindow,
  report: ShiftReport,
): readonly Receipt[] {
  const from = Date.parse(report.opened_at)
  const to = report.closed_at === null ? Infinity : Date.parse(report.closed_at)
  return sales.receipts
    .filter((receipt) => {
      const at = Date.parse(receipt.completed_at)
      return receipt.actor_id === report.opened_by && at >= from && at <= to
    })
    .sort((a, b) => Date.parse(b.completed_at) - Date.parse(a.completed_at))
}

/// The window a session's sales are in: from the day it trades for to the day
/// it ended — or today, while it runs. A shift that rings past midnight is
/// still one shift.
export function useSessionReceipts(report: ShiftReport | null) {
  const from = report === null ? "" : dayOf(report)
  const to =
    report === null
      ? ""
      : isoDay(new Date(report.closed_at ?? new Date().toISOString()))
  return useQuery({
    queryKey: windowAllKey(from, to),
    queryFn: ({ signal }) => fetchWindowAll({ from, to }, signal),
    enabled: report !== null,
    staleTime: 0,
    select: (sales) => ({
      receipts: report === null ? [] : receiptsOf(sales, report),
      truncated: sales.receipts_truncated,
    }),
  })
}

/// How many receipts' documents a sheet reads at once: one request each, and
/// the newest are the ones somebody comes to look at.
export const RECEIPT_DOCUMENTS = 100

/// The printed receipts behind a list of sales, by sale id — their numbers,
/// their lines and how each was paid. Shares the cache of `useReceipt`, so
/// opening one afterwards costs nothing.
export function useReceiptDocuments(ids: readonly string[]): {
  readonly documents: Readonly<Partial<Record<string, ReceiptDocument>>>
  readonly pending: boolean
} {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: receiptKey(id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        node.get<ReceiptDocument>(
          `/api/v1/store/sales/${encodeURIComponent(id)}/receipt`,
          { signal },
        ),
      // A receipt is a fact about a completed sale.
      staleTime: Infinity,
      retry: false,
    })),
    combine: (results) => ({
      documents: Object.fromEntries(
        results.flatMap((result, index) =>
          result.data === undefined ? [] : [[ids[index], result.data]],
        ),
      ) as Record<string, ReceiptDocument>,
      pending: results.some((result) => result.isPending),
    }),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Who

/// Names for the logins a shift carries, and the people a drop can be handed
/// to.
///
/// A login is never shown (owner: employees are always full names), so this
/// asks head office who works here when the person signed in can be relayed
/// for. When they cannot — an emergency account, a node with sign-in off —
/// the logins are shown as they are, and the signed-in person is still known.
export interface People {
  readonly nameOf: (login: string) => string
  readonly names: readonly string[]
}

export function usePeople(): People {
  const identity = useIdentity()
  const access = useCloudIdentity()
  const reach = useReach(access.data !== null)
  const place = reach.data?.unit_id ?? null
  const team = useQuery({
    queryKey: hrKeys.team(place ?? ""),
    queryFn: ({ signal }) => teamAt(place ?? "", signal),
    enabled: place !== null,
  })
  const me = identity.data ?? null
  const rows = team.data?.rows ?? []
  return {
    nameOf: (login) => {
      if (me !== null && login === me.username) return me.display_name
      return rows.find((one) => one.username === login)?.full_name ?? login
    },
    names: [
      ...new Set([
        ...(me === null ? [] : [me.display_name]),
        ...rows.flatMap((one) =>
          one.status === "ACTIVE" && one.full_name !== null
            ? [one.full_name]
            : [],
        ),
      ]),
    ].sort((a, b) => a.localeCompare(b)),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes

/// Who is doing this, from the session the app already holds. The node
/// overwrites it from the authenticated principal whenever auth is on.
function actorFrom(client: ReturnType<typeof useQueryClient>): string {
  const me = client.getQueryData<Identity | null>(cacheKey.me())
  return me?.username ?? ""
}

/// Cash to the safe, or back from it.
///
///  - `DROP` carries takings out of the drawer. A drop needs no second
///    signature.
///  - `PICKUP` puts cash back. It is how a drop is undone: the node keeps
///    every movement, and a correction is a new entry rather than an edit.
export function useCashMovement(): UseMutationResult<
  ShiftReport,
  Error,
  {
    shiftId: string
    kind: "DROP" | "PICKUP"
    amountMinor: number
    reason: string
    /// Who took the cash, for a drop.
    receiver?: string
    /// The notes and coins the amount was counted from; they must add up to it.
    counted?: readonly CashCount[]
  }
> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({
      shiftId,
      kind,
      amountMinor,
      reason,
      receiver,
      counted,
    }) => {
      const request: CashMovementRequest = {
        kind,
        // Signed once, here: a drop leaves the drawer, a pickup enters it.
        amount_minor:
          kind === "PICKUP" ? Math.abs(amountMinor) : -Math.abs(amountMinor),
        reason,
        actor_id: actorFrom(client),
        supervisor: null,
        received_by: receiver ?? null,
        counted: [...(counted ?? [])],
        idempotency_key: commandKey(`cash-${kind.toLowerCase()}`),
      }
      return node.post<ShiftReport>(
        `/api/v1/store/shifts/${encodeURIComponent(shiftId)}/movements`,
        request,
      )
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: shiftKey() })
    },
  })
}

/// Count a drawer nobody counted: one a seat-taker left behind. The holder
/// counts what they took out, or a supervisor counts it for them.
export function useCountShift(): UseMutationResult<
  ShiftReport,
  Error,
  {
    shiftId: string
    declaredMinor: number
    counted: readonly CashCount[]
    note: string
  }
> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ shiftId, declaredMinor, counted, note }) => {
      const request: CloseShiftRequest = {
        declared_cash_minor: declaredMinor,
        counted: [...counted],
        note: note.trim() === "" ? null : note.trim(),
        actor_id: actorFrom(client),
        idempotency_key: commandKey("shift-count"),
      }
      return node.post<ShiftReport>(
        `/api/v1/store/shifts/${encodeURIComponent(shiftId)}/count`,
        request,
      )
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: shiftKey() })
    },
  })
}
