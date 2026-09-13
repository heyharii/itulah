import { node } from "@/lib/api"

/// Money a shop took without producing a sale.
///
/// A card settles, the sale is never written — the till died between the
/// terminal's answer and the commit, or a second tender declined and the first
/// could not be reversed at the counter. The shopper has been charged and the
/// branch has money with nothing behind it.
///
/// The reason this needs a screen at head office rather than a note at the
/// shop: **the branch's own Z report balances.** The cash is there, the card
/// batch is there, nothing looks wrong locally. The only party who can see a
/// problem is the customer, on their statement, days later.
///
/// Hand-written rather than generated, the same exception `commercial.ts` makes
/// and for the same reason: the handler builds its body with `json!()` in
/// `cloud/postgres/checkout_exceptions.rs` rather than serialising a struct, so
/// ts-rs has nothing to generate from. If a field moves, this is where it goes
/// stale.
///
/// Money is in minor units and stays an integer until `money()` draws it.

export type ExceptionResolution =
  "OPEN" | "REFUNDED" | "RECOVERED_AS_SALE" | "WRITTEN_OFF"

export interface ExceptionTender {
  readonly tender_seq: number
  readonly method: string
  readonly amount_minor: number
  readonly status: string
  /// The acquirer's own reference. Without it head office has an amount, a
  /// branch and a date — not enough to find one transaction in a day's batch,
  /// and finding it is the entire job.
  readonly external_reference: string | null
  readonly last_error: string | null
}

export interface CheckoutException {
  readonly checkout_id: string
  readonly origin_id: string
  readonly site_id: string | null
  /// Who was on the till, which is who to ask what happened.
  readonly actor_id: string
  /// What the shopper was told they owed.
  readonly total_minor: number
  /// What actually settled and is now in the branch's takings with nothing
  /// against it. This is the number a refund is measured from — not
  /// `total_minor`, which is what the basket came to whether or not it was
  /// paid.
  readonly money_held_minor: number
  readonly opened_at: string
  readonly resolved_at: string
  readonly received_at: string
  readonly last_error: string | null
  readonly resolution: ExceptionResolution
  readonly resolution_note: string | null
  readonly resolved_by: string | null
  readonly resolution_at: string | null
  readonly tenders: readonly ExceptionTender[]
}

export interface CheckoutExceptionPage {
  readonly rows: readonly CheckoutException[]
  /// How many people are owed money, and how much. Summed by the server across
  /// everything that matched, not across the rows on screen — a filtered page
  /// that totalled itself would report a smaller debt every time somebody
  /// narrowed the list.
  readonly open_count: number
  readonly open_money_held_minor: number
}

export interface ResolveExceptionRequest {
  readonly resolution: Exclude<ExceptionResolution, "OPEN">
  readonly resolved_by: string
  readonly note?: string | null
}

export const checkoutExceptionKeys = {
  all: ["checkout-exceptions"] as const,
  list: (site: string | null, openOnly: boolean) =>
    ["checkout-exceptions", "list", site, openOnly] as const,
}

export function listCheckoutExceptions(
  site: string | null,
  openOnly: boolean,
  signal?: AbortSignal
): Promise<CheckoutExceptionPage> {
  const query = new URLSearchParams()
  if (site !== null) query.set("site_id", site)
  // Sent explicitly in both directions rather than relying on a server
  // default: the difference between "the work" and "everything ever reported"
  // is the difference between a list somebody finishes and one nobody opens.
  query.set("open_only", openOnly ? "true" : "false")
  return node.get<CheckoutExceptionPage>(
    `/api/v1/checkout-exceptions?${query.toString()}`,
    { signal }
  )
}

export function resolveCheckoutException(
  checkoutId: string,
  request: ResolveExceptionRequest
): Promise<{ checkout_id: string; resolution: string; resolved_by: string }> {
  return node.post(`/api/v1/checkout-exceptions/${checkoutId}/resolve`, request)
}
