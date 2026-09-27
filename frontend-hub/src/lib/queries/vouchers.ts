import { node } from "@/lib/api"

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
      return "Goodwill"
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
  if (query.cursor) params.set("cursor", query.cursor)
  if (query.limit !== undefined) params.set("limit", String(query.limit))
  const encoded = params.toString()
  return encoded === "" ? "" : `?${encoded}`
}

export function listVouchers(
  query: VoucherQuery,
  signal?: AbortSignal
): Promise<VoucherList> {
  return node.get<VoucherList>(`/api/v1/commercial/vouchers${search(query)}`, {
    signal,
  })
}

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
