import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query"

import { node } from "@/lib/api"
import type { SpecFilter } from "@/lib/queries/reports"

/// The member directory, and the segments it falls into.
///
/// Until this landed there was no way to find a member you could not already
/// name: the only member reads were `/api/v1/customer/{id}/…`, which answer
/// questions about one shopper whose card number you are holding. A loyalty
/// scheme nobody can list is a foreign key, not a scheme — and the sheet on
/// the sales screen said as much, keying itself on a member id somebody had to
/// type in from memory.
///
/// Shapes transcribed from `cloud/postgres/membership.rs`.

/// The six, exhaustive and mutually exclusive, so the counts add up to the
/// directory and a reader can check the arithmetic.
///
/// That rules out the overlapping kind — "big spenders", "people who buy
/// outerwear" — which are real questions and belong to a query builder rather
/// than to a fixed list. What is here is the axis every retailer starts from,
/// because it is the one that says who to talk to: how long since they came in.
export type SegmentKey =
  "NEW" | "ACTIVE" | "LAPSING" | "LAPSED" | "NEVER" | "BLOCKED"

export const SEGMENT_ORDER: readonly SegmentKey[] = [
  "NEW",
  "ACTIVE",
  "LAPSING",
  "LAPSED",
  "NEVER",
  "BLOCKED",
]

/// The word, and the sentence under it.
///
/// The sentences take the two windows from the server rather than hard-coding
/// ninety and a hundred and eighty, because the server is where the definition
/// lives and a screen that restated them would be the second copy that drifts.
export function describeSegment(
  key: string,
  windows: { readonly active_days: number; readonly lapsing_days: number }
): { readonly label: string; readonly meaning: string } {
  switch (key) {
    case "NEW":
      return {
        label: "New",
        meaning: `First bought within ${windows.active_days} days. Whether they come back a second time is the whole question.`,
      }
    case "ACTIVE":
      return {
        label: "Active",
        meaning: `Bought within ${windows.active_days} days, and not for the first time. The people the shop is currently serving.`,
      }
    case "LAPSING":
      return {
        label: "Lapsing",
        meaning: `Last bought ${windows.active_days}–${windows.lapsing_days} days ago. Late rather than gone — the segment worth a message.`,
      }
    case "LAPSED":
      return {
        label: "Lapsed",
        meaning: `Nothing for over ${windows.lapsing_days} days. Honestly described as former customers.`,
      }
    case "NEVER":
      return {
        label: "Never bought",
        meaning:
          "Holding a card and never used it. Not a gap in the data — an enrolment that never became a customer.",
      }
    case "BLOCKED":
      return {
        label: "Stopped",
        meaning:
          "Membership stopped. Their sales stay attributed to them, which is why the row is blocked rather than deleted.",
      }
    default:
      return { label: key, meaning: "" }
  }
}

export interface MemberRow {
  /// The number on the card — the same value the till writes onto a sale. Not
  /// a uuid: re-keying would detach every sale a member has ever made.
  readonly member_id: string
  readonly display_name: string | null
  readonly joined_on: string
  readonly blocked_at: string | null
  /// Whether a phone has ever been paired to this card. The difference between
  /// a customer the shop can reach and one it can only serve.
  readonly paired: boolean
  readonly transaction_count: number
  readonly spent_minor: number
  readonly saved_minor: number
  /// Pieces, not receipts. Beside `transaction_count` it is the other half of
  /// units per transaction — whether this shopper buys one thing or a basket.
  readonly units_total: number
  /// Every point ever credited on this card.
  readonly points_earned_total: number
  /// What is on the card now: earned, less redeemed, less any reversal. May be
  /// negative — see `0165`, which allows it deliberately when goods that earned
  /// points go back after the points have been spent.
  readonly points_balance: number
  /// What has already been turned into vouchers, as a positive figure.
  readonly points_spent_total: number
  readonly first_purchase_at: string | null
  readonly last_purchase_at: string | null
  /// `null` for somebody who has never bought — which is not the same as a
  /// very large number, and sorting them together would file the two most
  /// different cases side by side.
  readonly days_since_purchase: number | null
  /// What they are still holding on vouchers. Money the shop owes this person
  /// specifically.
  readonly voucher_balance_minor: number
  readonly segment: SegmentKey
}

/// One value the directory can be narrowed by, and how many members it would
/// leave. Counted over what the SEARCH leaves, ignoring the segment currently
/// applied — so "Lapsing 41" means there are 41 lapsing members, not 41 among
/// the ones you already narrowed to lapsing.
export interface MemberFacet {
  readonly value: string
  readonly label: string | null
  readonly count: number
}

export interface MemberFacets {
  /// In the six's own reading order, which is the order the segment book
  /// prints them in. Only the ones with anybody in them.
  readonly segments: readonly MemberFacet[]
}

export interface MemberDirectory {
  readonly members: readonly MemberRow[]
  /// Everybody enrolled, not just this page, so a filtered list can say what
  /// it is a fraction of.
  readonly member_count: number
  /// Opaque. Pass it back as `cursor` for the next page; `null` means this was
  /// the last one.
  readonly next_cursor: string | null
  /// Everybody the search and the segment match — as against `member_count`,
  /// which is the whole scheme. A screen wants both: "41 of 9,320".
  readonly total: number
  readonly facets: MemberFacets
}

export interface SegmentRow {
  readonly key: SegmentKey
  readonly members: number
  readonly spent_minor: number
  readonly transaction_count: number
  /// Per member, not per sale. The figure that says whether a segment is worth
  /// a campaign at all.
  readonly average_spend_minor: number
  readonly last_purchase_at: string | null
}

export interface SegmentBook {
  /// All six, always, even the empty ones — "we have no lapsed members" and
  /// "the query did not return that segment" look identical otherwise.
  readonly segments: readonly SegmentRow[]
  readonly member_count: number
  /// Shoppers the till has named on a sale who are not enrolled. Not a
  /// segment, because they are not members; mentioned because leaving them out
  /// makes the directory look like the whole customer base.
  readonly unenrolled_count: number
  readonly unenrolled_spent_minor: number
  readonly active_days: number
  readonly lapsing_days: number
}

/// The sorts the server names. Anything else falls back to `spent`, the house
/// order, rather than being refused — a sort arrives from a URL somebody may
/// have kept from an older build.
export type MemberSort =
  | "spent"
  | "name"
  | "card"
  | "joined"
  | "last_purchase"
  | "transactions"
  | "atv"
  | "units"
  | "upt"
  | "points"
  | "points_spent"

export interface MemberQuery {
  readonly segment?: SegmentKey
  /// A saved segment, by id. The id and not its clauses: a caller holding
  /// clauses is holding a copy, and the list would stop agreeing with the
  /// count on the card that linked to it the moment somebody edited it.
  readonly segmentId?: string
  /// Card number or name. The server runs it, and over those two columns only
  /// — never a phone number or anything else somebody could look a person up
  /// by without being granted it.
  readonly q?: string
  readonly sort?: MemberSort
  /// Absent means each key's own natural direction: money and recency read
  /// downwards, names and card numbers upwards.
  readonly dir?: "asc" | "desc"
  /// The filter bar's clauses over the `member` dataset — the same clause a
  /// saved segment is written in. Run by the server, because the directory is
  /// paged and a clause over the loaded rows would be a filter of the page.
  readonly filters?: readonly SpecFilter[]
  /// A `next_cursor` from the previous page, verbatim.
  readonly cursor?: string
  readonly limit?: number
}

export interface EnrolMemberRequest {
  /// The number on the card the shopper is already holding. Enrolment is
  /// idempotent on it: a cashier who enrols the same card twice has made no
  /// mistake worth an error.
  readonly member_id: string
  readonly display_name?: string
}

export interface MemberIdentity {
  readonly member_id: string
  readonly display_name: string | null
  readonly joined_on: string
}

/// A customer number the till wrote onto a sale that no card was enrolled for.
///
/// The segment book has carried a *count* of these since it existed, which is
/// not something anybody can act on. Naming them is: enrolling one hands that
/// shopper their whole history at once, because the directory joins on
/// `member_id = edge_sale.customer_id` and needs no repair to do it.
///
/// Two different things arrive in this list and the columns are what tell them
/// apart. A real customer whose card was never enrolled has several sales,
/// often at more than one shop, spread over months. A mistyped number has one
/// sale, at one shop, on one day — and nothing can repair that one: the number
/// is written on a completed sale, and a shop's takings are not editable from
/// a customer screen.
export interface UnenrolledRow {
  /// Exactly what the till wrote, untrimmed and un-cased. What is on screen
  /// has to be what would be typed to enrol it, or enrolling would mint a
  /// third number rather than adopting this one.
  readonly customer_id: string
  readonly transaction_count: number
  readonly spent_minor: number
  /// Points already credited to nobody — what enrolling this number gives
  /// back.
  readonly points_earned_total: number
  /// How many shops wrote it. One is the shape of a mistake.
  readonly site_count: number
  readonly first_purchase_at: string
  readonly last_purchase_at: string
}

export interface UnenrolledList {
  readonly strangers: readonly UnenrolledRow[]
  /// Over the whole backlog rather than the page, so a truncated list can say
  /// what it is a fraction of.
  readonly unenrolled_count: number
  readonly unenrolled_spent_minor: number
}

export function listUnenrolled(
  limit: number,
  signal?: AbortSignal
): Promise<UnenrolledList> {
  return node.get<UnenrolledList>(`/api/v1/members/unenrolled?limit=${limit}`, {
    signal,
  })
}

export const memberKeys = {
  all: ["members"] as const,
  unenrolled: (limit: number) => ["members", "unenrolled", limit] as const,
  directory: (query: MemberQuery) =>
    [
      "members",
      "directory",
      query.segment ?? "all",
      query.segmentId ?? "",
      query.q ?? "",
      query.sort ?? "spent",
      query.dir ?? "",
      // Not the cursor: the directory is an infinite query, which keeps its
      // pages under one key.
      JSON.stringify(query.filters ?? []),
    ] as const,
  segments: () => ["members", "segments"] as const,
}

export function listMembers(
  query: MemberQuery,
  signal?: AbortSignal
): Promise<MemberDirectory> {
  const params = new URLSearchParams()
  if (query.segment) params.set("segment", query.segment)
  if (query.segmentId) params.set("segment_id", query.segmentId)
  if (query.q) params.set("q", query.q)
  if (query.sort) params.set("sort", query.sort)
  if (query.dir) params.set("dir", query.dir)
  if (query.filters && query.filters.length > 0)
    params.set("filters", JSON.stringify(query.filters))
  if (query.cursor) params.set("cursor", query.cursor)
  if (query.limit !== undefined) params.set("limit", String(query.limit))
  const encoded = params.toString()
  return node.get<MemberDirectory>(
    `/api/v1/members${encoded === "" ? "" : `?${encoded}`}`,
    { signal }
  )
}

export function memberSegments(signal?: AbortSignal): Promise<SegmentBook> {
  return node.get<SegmentBook>("/api/v1/members/segments", { signal })
}

/// The segment book as a query: what the Members directory reads for its two
/// window lengths, and what the Segments screen and the Executive's Customers
/// page are made of. Shared with their prefetchers (`screens/members/
/// prefetch.ts`, `screens/executive/prefetch.ts`).
export const memberSegmentsQuery = () =>
  queryOptions({
    queryKey: memberKeys.segments(),
    queryFn: ({ signal }) => memberSegments(signal),
  })

/// Rows per request of the directory. Small enough that the first page is
/// quick, and the table asks for the next as it nears the bottom.
export const MEMBERS_PAGE = 200

/// The directory for one question, a page at a time on the server's cursor.
/// Shared by the screen and its prefetcher so the key and the request cannot
/// drift apart.
export const memberDirectoryQuery = (scope: MemberQuery) =>
  infiniteQueryOptions({
    queryKey: memberKeys.directory(scope),
    queryFn: ({ pageParam, signal }) =>
      listMembers({ ...scope, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })

/// Enrol a card at the counter.
///
/// No idempotency key, and that is the server's shape rather than an omission
/// here: `enrol_member` upserts on the card number, because the card is a
/// physical object somebody is already holding and enrolling it twice is not a
/// mistake worth an error.
export function enrolMember(
  request: EnrolMemberRequest,
  signal?: AbortSignal
): Promise<MemberIdentity> {
  return node.post<MemberIdentity>("/api/v1/members", request, { signal })
}

/// The six digits a cashier reads out, and the one moment they are knowable.
///
/// `code` is in this response and nowhere else — the server keeps a hash, no
/// log line carries it, and there is no route that reads it back. A code lost
/// between the screen and the shopper is replaced, not looked up, which is why
/// the screen showing it must not put it anywhere it can be lost: not in the
/// URL, not in a cache that outlives the sheet.
export interface IssuedPairingCode {
  readonly member_id: string
  readonly code: string
  /// Ten minutes out. Shown as a countdown rather than a time, because the
  /// question at a counter is "have I still got it", not "what time is it".
  readonly expires_at: string
}

/// Activate a card so the shopper's own app can sign in.
///
/// A mutation with no cache to invalidate, and that is not an oversight: what
/// it produces is read aloud and then gone. Anything that kept it — a query
/// key, a toast that outlives the sheet, a router state — would be a copy of a
/// credential in a place nobody thought about.
export function issuePairingCode(
  memberId: string,
  signal?: AbortSignal
): Promise<IssuedPairingCode> {
  return node.post<IssuedPairingCode>(
    `/api/v1/members/${encodeURIComponent(memberId)}/pairing-code`,
    {},
    { signal }
  )
}

/* -------------------------------------------------------------------------- */
/*  Segments somebody wrote down                                               */
/* -------------------------------------------------------------------------- */

/// The other species of segment, and it is worth being clear which is which.
///
/// The six above are **derived**: exhaustive, mutually exclusive, worked out on
/// every read from one axis. These are **written**: overlapping, arbitrary in
/// number, and a statement of what somebody wanted to reach — "lapsing, and has
/// spent at least five million". They are never mixed on a screen, because the
/// six can be checked by arithmetic and these cannot.
///
/// What is stored is still only the definition. The membership is worked out on
/// every read, by the same `FROM` the directory itself uses, so everything the
/// six argue about a stored segment being silently wrong holds here too.
///
/// Shapes transcribed from `cloud/postgres/segments.rs`.

/// How the clauses combine. The only structural choice a definition gets: a
/// tree of nested groups is a query language, and a query language needs an
/// editor and a way of explaining itself to somebody who did not write it.
export type SegmentMatch = "ALL" | "ANY"

export interface SegmentDefinition {
  readonly match: SegmentMatch
  /// `SpecFilter`, the same clause the report builder and the filter bar write.
  /// Not a shape of this module's own — that would be a second author of what
  /// "is at least" means.
  readonly filters: readonly SpecFilter[]
}

/// What a definition matches right now, in the same four figures a derived
/// segment reports — so one card can draw either.
export interface SegmentTally {
  readonly members: number
  readonly spent_minor: number
  readonly transaction_count: number
  readonly average_spend_minor: number
  readonly last_purchase_at: string | null
  /// The directory's total, so a share can be stated without a second read
  /// that might disagree with this one.
  readonly member_count: number
}

export interface SavedSegment {
  readonly segment_id: string
  readonly name: string
  /// Why it exists, in the author's words. The clauses say what it matches and
  /// never why, and why is what the next person needs.
  readonly purpose: string | null
  readonly owner_username: string
  readonly version: number
  readonly catalogue_version: number
  readonly definition: SegmentDefinition
  readonly created_at: string
  readonly updated_at: string
  /// Everybody may read every segment; editing stays with the author.
  readonly editable: boolean
  readonly tally?: SegmentTally
}

export interface SegmentInput {
  readonly name: string
  readonly purpose?: string
  readonly definition: SegmentDefinition
}

export const savedSegmentKeys = {
  all: ["members", "saved-segments"] as const,
  list: () => ["members", "saved-segments", "list"] as const,
  preview: (definition: SegmentDefinition) =>
    ["members", "saved-segments", "preview", definition] as const,
}

export function savedSegments(signal?: AbortSignal): Promise<SavedSegment[]> {
  return node.get<SavedSegment[]>("/api/v1/members/segments/saved", { signal })
}

/// The segments somebody wrote, as a query.
export const savedSegmentsQuery = () =>
  queryOptions({
    queryKey: savedSegmentKeys.list(),
    queryFn: ({ signal }) => savedSegments(signal),
  })

export function createSegment(
  input: SegmentInput,
  signal?: AbortSignal
): Promise<SavedSegment> {
  return node.post<SavedSegment>("/api/v1/members/segments/saved", input, {
    signal,
  })
}

/// Editing appends a version rather than overwriting one, which is what makes
/// "who was in this list when we sent that" a question with an answer.
export function reviseSegment(
  id: string,
  input: SegmentInput,
  signal?: AbortSignal
): Promise<SavedSegment> {
  return node.post<SavedSegment>(
    `/api/v1/members/segments/saved/${encodeURIComponent(id)}`,
    input,
    { signal }
  )
}

export function retireSegment(id: string, signal?: AbortSignal): Promise<void> {
  return node.post<void>(
    `/api/v1/members/segments/saved/${encodeURIComponent(id)}/retire`,
    {},
    { signal }
  )
}

/// What a definition would match, before anybody saves it.
///
/// The server counts it, and that is not an optimisation: the directory screen
/// loads the directory a page at a time, and a count taken over the pages in
/// hand would be a count of those pages. It would also disagree with the card afterwards,
/// which is the one comparison a reader is guaranteed to make.
export function previewSegment(
  definition: SegmentDefinition,
  signal?: AbortSignal
): Promise<SegmentTally> {
  return node.post<SegmentTally>(
    "/api/v1/members/segments/preview",
    definition,
    { signal }
  )
}
