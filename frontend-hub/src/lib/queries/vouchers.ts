import { infiniteQueryOptions } from "@tanstack/react-query"

import { node } from "@/lib/api"
import type { Filter } from "@/lib/filters"

/// Vouchers — value a customer already holds and can pay with.
///
/// Not pricing, and the distinction is the reason this file is not part of
/// `commercial.ts`. The other three Commercial surfaces all answer "what does
/// this cost": a price, a markdown coming off it, a promotion running over
/// several. A voucher answers "what did they pay with" — it sits beside cash
/// and a card at the counter, and it is *spent*, never *applied*.
///
/// The system this replaces filed both under one voucher table, `percent_off`
/// beside `stored_value`, and booked a gift card settled at the till as a
/// discount against margin. The shop's margin therefore got worse every time
/// somebody spent money the shop was already holding.
///
/// Shapes transcribed from `cloud/postgres/vouchers.rs`. They are generated
/// into `@itulah/contract` by ts-rs once `make contract` has run; until then
/// this file is where the two can drift, and it is the first place to look
/// when a column reads `undefined`.

export type VoucherKind = "GIFT_CARD" | "REFUND" | "GOODWILL"

/// Where a voucher stands. Expiry is deliberately not one of these: a card
/// past its date is still `ACTIVE` with a balance on it — what changed is the
/// clock, not the record — and `expired` on the row below says so separately.
export type VoucherStatus = "ACTIVE" | "SPENT" | "VOIDED"

export type VoucherMovementKind = "ISSUE" | "REDEEM" | "VOID"

/// What each kind means in a sentence, and why the shop cares which it is.
///
/// The three are not decoration: the accounting differs at the moment of
/// issue. A gift card was paid for and is a liability; goodwill was given away
/// and is an expense that day; a refund voucher is a sale being unwound.
export function describeKind(kind: string): string {
  switch (kind) {
    case "GIFT_CARD":
      return "Gift card"
    case "REFUND":
      return "Refund"
    case "GOODWILL":
      return "Complimentary"
    default:
      // A kind this build has not been told about is passed through rather
      // than guessed at, the same rule `describeSource` follows next door.
      return kind
  }
}

export function describeMovement(kind: string): string {
  switch (kind) {
    case "ISSUE":
      return "Issued"
    case "REDEEM":
      return "Spent"
    case "VOID":
      return "Written off"
    default:
      return kind
  }
}

export interface VoucherRow {
  readonly voucher_id: string
  /// What is printed on the card, and what a shopper reads out. The routes are
  /// keyed on this rather than on the uuid for exactly that reason.
  readonly code: string
  readonly kind: VoucherKind
  readonly currency: string
  /// The face value, frozen at issue.
  readonly issued_minor: number
  /// What is left. One card's worth of the shop's liability.
  readonly balance_minor: number
  /// What has come off it. Derived by the server rather than here, so there is
  /// one place the subtraction happens.
  readonly spent_minor: number
  readonly status: VoucherStatus
  readonly member_id: string | null
  readonly member_name: string | null
  readonly expires_at: string | null
  /// Past its date with value still on it. Computed against the database's
  /// clock, not the browser's — a laptop with a wrong date must not be able to
  /// make a live card look dead.
  readonly expired: boolean
  readonly issued_at: string
  readonly issued_by: string
  readonly issued_site: string | null
  readonly note: string | null
  readonly version: number
  readonly movement_count: number
  readonly last_movement_at: string | null
}

export interface VoucherMovementRow {
  readonly movement_id: string
  readonly seq: number
  readonly kind: VoucherMovementKind
  /// Signed: issue adds, redeem and void subtract. The list draws the sign, so
  /// a history reads as arithmetic rather than as a column of positives that
  /// happen to mean opposite things.
  readonly amount_minor: number
  readonly balance_after_minor: number
  readonly sale_id: string | null
  readonly site_id: string | null
  readonly actor: string
  readonly occurred_at: string
  readonly note: string | null
}

export interface VoucherDetail {
  readonly voucher: VoucherRow
  readonly movements: readonly VoucherMovementRow[]
}

/// What the whole book comes to — over every voucher, never over the filter.
///
/// That is a server decision and worth restating here, because it is the sort
/// of thing a reader assumes the other way round: `outstanding_minor` is what
/// the shop owes, and a liability that moved because somebody typed in the
/// search box would be a figure nobody could quote.
export interface VoucherLedger {
  readonly issued_count: number
  readonly issued_minor: number
  readonly outstanding_count: number
  readonly outstanding_minor: number
  readonly redeemed_minor: number
  readonly voided_minor: number
  readonly expired_count: number
  readonly expired_minor: number
}

export interface VoucherList {
  readonly rows: readonly VoucherRow[]
  /// Opaque. Pass it back as `cursor` for the next page; null was the last one.
  readonly next_cursor: string | null
  /// Every card the search and the filters match, not just this page.
  ///
  /// Not the same number as `ledger.issued_count`, and the difference is the
  /// point: this describes the LIST, the ledger describes the BOOK. A search
  /// for one customer's cards says "3" above the rows and the ledger still
  /// says what the shop owes everybody.
  readonly total: number
  readonly facets: {
    readonly statuses: readonly { value: string; count: number }[]
    readonly kinds: readonly { value: string; count: number }[]
  }
  readonly ledger: VoucherLedger
}

export interface VoucherQuery {
  readonly status?: VoucherStatus
  readonly kind?: VoucherKind
  readonly member_id?: string
  readonly q?: string
  /// `issued` (the default), `code`, `value`, `balance` or `expires`.
  readonly sort?: string
  /// `asc` or `desc`. Absent means each key's own natural direction — newest
  /// card first, biggest amount first, but a code and an expiry forwards.
  readonly dir?: string
  /// The Status column's reading, which `status` cannot ask for: `EXPIRED` is
  /// a live card past its date — the clock, not a stored status. ANDed with
  /// `status`.
  readonly state?: VoucherStatus | "EXPIRED"
  /// Inclusive bounds on the face value and on what is left, in the same
  /// units as the row (whole rupiah — see `lib/format`'s `money`).
  readonly face_min?: number
  readonly face_max?: number
  readonly balance_min?: number
  readonly balance_max?: number
  /// Issued at or after this instant (ISO), and strictly before this one.
  readonly issued_from?: string
  readonly issued_before?: string
  /// A `next_cursor` from the previous page, verbatim.
  readonly cursor?: string
  readonly limit?: number
}

export interface IssueVoucherRequest {
  /// Only for pre-printed stock, where the card exists before the record does.
  /// Left out, the server mints one from an alphabet without the four
  /// characters people misread off a card.
  readonly code?: string
  readonly kind: VoucherKind
  readonly value_minor: number
  readonly currency?: string
  readonly member_id?: string
  readonly expires_at?: string
  readonly site_id?: string
  readonly note?: string
}

export interface RedeemVoucherRequest {
  readonly amount_minor: number
  readonly sale_id?: string
  readonly site_id?: string
  readonly note?: string
}

export interface VoidVoucherRequest {
  readonly reason: string
}

export const voucherKeys = {
  all: ["vouchers"] as const,
  /// Keyed by the filter, because a different question has a different answer
  /// and backspacing a search should re-use the one it already had. Every
  /// field `search` sends is in here — the Overview's one-row peek at the
  /// ledger once shared a key with the full book, and the Vouchers table then
  /// drew that single row as if it were all of them.
  list: (query: VoucherQuery) =>
    [
      "vouchers",
      "list",
      query.status ?? "any",
      query.kind ?? "any",
      query.member_id ?? "anyone",
      query.q ?? "",
      query.sort ?? "",
      query.dir ?? "",
      query.state ?? "",
      query.face_min ?? "",
      query.face_max ?? "",
      query.balance_min ?? "",
      query.balance_max ?? "",
      query.issued_from ?? "",
      query.issued_before ?? "",
      query.cursor ?? "",
      query.limit ?? "default",
    ] as const,
  detail: (code: string) => ["vouchers", "detail", code] as const,
}

function search(query: VoucherQuery): string {
  const params = new URLSearchParams()
  if (query.status) params.set("status", query.status)
  if (query.kind) params.set("kind", query.kind)
  if (query.member_id) params.set("member_id", query.member_id)
  if (query.q) params.set("q", query.q)
  if (query.sort) params.set("sort", query.sort)
  if (query.dir) params.set("dir", query.dir)
  if (query.state) params.set("state", query.state)
  // Numbers by `!== undefined`: a bound of 0 is a question — "nothing left on
  // it" — and a truthiness test would drop it.
  if (query.face_min !== undefined)
    params.set("face_min", String(query.face_min))
  if (query.face_max !== undefined)
    params.set("face_max", String(query.face_max))
  if (query.balance_min !== undefined)
    params.set("balance_min", String(query.balance_min))
  if (query.balance_max !== undefined)
    params.set("balance_max", String(query.balance_max))
  if (query.issued_from) params.set("issued_from", query.issued_from)
  if (query.issued_before) params.set("issued_before", query.issued_before)
  if (query.cursor) params.set("cursor", query.cursor)
  if (query.limit !== undefined) params.set("limit", String(query.limit))
  const encoded = params.toString()
  return encoded === "" ? "" : `?${encoded}`
}

/// The operators each docked field offers — exactly the questions the request
/// can carry, so no chip narrows nothing.
export const VOUCHER_NUMBER_OPERATORS = [
  "is",
  "gte",
  "gt",
  "lte",
  "lt",
  "between",
] as const
export const VOUCHER_DATE_OPERATORS = [
  "is",
  "onOrAfter",
  "after",
  "onOrBefore",
  "before",
  "between",
] as const

/// Local midnight of a `YYYY-MM-DD`, `days` later, as an instant. Local
/// because "issued on the 3rd" means the shop's 3rd, not Greenwich's.
function midnight(date: string, days = 0): string | undefined {
  const at = new Date(`${date}T00:00:00`)
  if (Number.isNaN(at.getTime())) return undefined
  at.setDate(at.getDate() + days)
  return at.toISOString()
}

/// Whole units, or nothing. A bound that does not parse narrows nothing
/// rather than everything.
function whole(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? Math.round(value) : undefined
}

/// The docked filter clauses as request fields — the voucher list's filters
/// are the SERVER's, so they see every card and not only the pages loaded.
///
/// Each field is `single` on the screen, so one clause per column; bounds are
/// inclusive integers, which is why `gt 5` is sent as `min 6`.
export function voucherScopeFromFilters(
  filters: readonly Filter[]
): Partial<VoucherQuery> {
  const out: {
    -readonly [K in keyof VoucherQuery]?: VoucherQuery[K]
  } = {}
  for (const { column, operator, values } of filters) {
    if (column === "status") {
      if (operator === "is" && values[0])
        out.state = values[0] as VoucherStatus | "EXPIRED"
      continue
    }
    if (column === "face" || column === "balance") {
      const first = whole(values[0])
      const second = whole(values[1])
      let min: number | undefined
      let max: number | undefined
      switch (operator) {
        case "is":
          min = first
          max = first
          break
        case "gte":
          min = first
          break
        case "gt":
          min = first === undefined ? undefined : first + 1
          break
        case "lte":
          max = first
          break
        case "lt":
          max = first === undefined ? undefined : first - 1
          break
        case "between":
          if (first === undefined || second === undefined) break
          min = Math.min(first, second)
          max = Math.max(first, second)
          break
      }
      if (column === "face") {
        out.face_min = min
        out.face_max = max
      } else {
        out.balance_min = min
        out.balance_max = max
      }
      continue
    }
    if (column === "issued") {
      const [first, second] = values
      if (!first) continue
      switch (operator) {
        case "is":
          out.issued_from = midnight(first)
          out.issued_before = midnight(first, 1)
          break
        case "onOrAfter":
          out.issued_from = midnight(first)
          break
        case "after":
          out.issued_from = midnight(first, 1)
          break
        case "onOrBefore":
          out.issued_before = midnight(first, 1)
          break
        case "before":
          out.issued_before = midnight(first)
          break
        case "between": {
          if (!second) break
          const low = first <= second ? first : second
          const high = first <= second ? second : first
          out.issued_from = midnight(low)
          out.issued_before = midnight(high, 1)
          break
        }
      }
    }
  }
  return out
}

export function listVouchers(
  query: VoucherQuery,
  signal?: AbortSignal
): Promise<VoucherList> {
  return node.get<VoucherList>(`/api/v1/commercial/vouchers${search(query)}`, {
    signal,
  })
}

/// The Vouchers list, a page at a time, on the server's cursor. Shared by the
/// screen and its prefetcher (`screens/commercial/prefetch.ts`) so the key and
/// the request cannot drift apart. Its own key beside the plain list's: the
/// Overview reads that one as a single page.
export const voucherPagesQuery = (scope: VoucherQuery) =>
  infiniteQueryOptions({
    queryKey: [...voucherKeys.list(scope), "pages"] as const,
    queryFn: ({ pageParam, signal }) =>
      listVouchers({ ...scope, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    // The rows already drawn stay while a new filter's first page is on its
    // way, rather than the table blinking to a spinner on every keystroke.
    placeholderData: (previous) => previous,
  })

export function voucherDetail(
  code: string,
  signal?: AbortSignal
): Promise<VoucherDetail> {
  return node.get<VoucherDetail>(
    `/api/v1/commercial/vouchers/${encodeURIComponent(code)}`,
    { signal }
  )
}

/// Every write here carries an idempotency key, and the reason is sharper than
/// it is on most screens: a retried issue is a second gift card the shop never
/// sold, and a retried redemption spends the same money twice.
function guarded(idempotencyKey: string): Record<string, string> {
  return { "Idempotency-Key": idempotencyKey }
}

export function issueVoucher(
  request: IssueVoucherRequest,
  idempotencyKey: string,
  signal?: AbortSignal
): Promise<VoucherRow> {
  return node.post<VoucherRow>("/api/v1/commercial/vouchers", request, {
    signal,
    headers: guarded(idempotencyKey),
  })
}

export function redeemVoucher(
  code: string,
  request: RedeemVoucherRequest,
  idempotencyKey: string,
  signal?: AbortSignal
): Promise<VoucherDetail> {
  return node.post<VoucherDetail>(
    `/api/v1/commercial/vouchers/${encodeURIComponent(code)}/redeem`,
    request,
    { signal, headers: guarded(idempotencyKey) }
  )
}

export function voidVoucher(
  code: string,
  request: VoidVoucherRequest,
  idempotencyKey: string,
  signal?: AbortSignal
): Promise<VoucherDetail> {
  return node.post<VoucherDetail>(
    `/api/v1/commercial/vouchers/${encodeURIComponent(code)}/void`,
    request,
    { signal, headers: guarded(idempotencyKey) }
  )
}
