/**
 * Response contracts for `sourcing/api.ts`.
 *
 * Every fetch in this domain is `api.get<unknown>` feeding a defensive
 * mapper (`supplierFromApi`, `sourcingItemFromApi`, `divisionFromApi`,
 * `locationFromApi`, `tagFromApi`, `shortlistListFromApi`, all in `./api.ts`)
 * — the second of the two populations in
 * docs/recipe-response-contracts.md. Each mapper already returns `null` for
 * a row it cannot use and gets filtered out, so a bad row was never going to
 * break the screen. These schemas exist to make that silent drop
 * observable via `checkContract`, not to change what happens to the row.
 */

import { z } from "zod"

/**
 * `/v1/sourcing`'s `unit_cost`. Unlike `po/api.ts`'s procurement totals —
 * confirmed integer IDR by that file's own write-path comment — sourcing
 * pricing sits in the masterdata/pricing boundary, which
 * docs/money-contract.md's wave table lists as **not yet migrated**
 * (`pricemanagement`'s `base_price`/`final_price`/`override_price` are
 * still `float64`). `SourcingItemWriteInput.unit_cost` below is typed as a
 * `string`, not a number, for the same reason. So this is deliberately
 * `z.number()`, not `.int()`: forcing integer here would flag every normal
 * row as a violation. It is still money and still worth naming as such —
 * flagged in the task report as a real finding, not modelled as an integer
 * this layer doesn't actually receive.
 */
const SourcingMoney = z.number()

/** A supplier as `/v1/masterdata/suppliers` returns it. */
export const ApiSupplierRow = z.object({
  // Becomes `Supplier.id`, a React key and the join key `sourcingItemFromApi`
  // looks suppliers up by — the "Identifiers" case for strictness.
  supplier_id: z.string(),
  code: z.string().nullish(),
  name: z.string().nullish(),
  address: z.string().nullish(),
  status: z.string().nullish(),
  primary_division: z.string().nullish(),
  tags: z.array(z.unknown()).nullish(),
})
export type ApiSupplierRow = z.infer<typeof ApiSupplierRow>

/** A row of `/v1/sourcing` (a supplier-product candidate). */
export const ApiSourcingItemRow = z.object({
  // Becomes `Product.id`/`sourcingItemId` — the PO draft's only safe way to
  // resolve a line back to this catalogue. Strict for the same reason as
  // the supplier id above.
  id: z.string(),
  code: z.string().nullish(),
  name: z.string().nullish(),
  // Nested legacy shape `sourcingItemFromApi` reads `id`/`name` off of via
  // `asRecord` when the flat `supplier_id`/`supplier_name` are absent —
  // shape otherwise unconstrained, so left as `unknown`.
  supplier: z.unknown(),
  supplier_id: z.string().nullish(),
  supplier_name: z.string().nullish(),
  division: z.unknown(),
  division_id: z.string().nullish(),
  division_name: z.string().nullish(),
  supplier_product_code: z.string().nullish(),
  color: z.string().nullish(),
  tags: z.array(z.unknown()).nullish(),
  description: z.string().nullish(),
  currency: z.string().nullish(),
  unit_cost: SourcingMoney.nullish(),
  moq: z.number().nullish(),
  lead_time_days: z.number().nullish(),
  primary_image: z.string().nullish(),
  media: z.array(z.unknown()).nullish(),
  status: z.string().nullish(),
  updated_at: z.string().nullish(),
})
export type ApiSourcingItemRow = z.infer<typeof ApiSourcingItemRow>

/** A row of `/v1/masterdata/divisions`. */
export const ApiDivisionRow = z.object({
  // FK target for every PO line's `division_id` and a React key in the
  // filter list — strict for the same reason as the ids above.
  id: z.string(),
  name: z.string().nullish(),
  code: z.string().nullish(),
  is_active: z.boolean().nullish(),
  status: z.string().nullish(),
})
export type ApiDivisionRow = z.infer<typeof ApiDivisionRow>

/** A row of `/v1/masterdata/tags`. */
export const ApiTagRow = z.object({
  id: z.string(),
  name: z.string().nullish(),
  status: z.string().nullish(),
})
export type ApiTagRow = z.infer<typeof ApiTagRow>

/**
 * A row of `/v1/masterdata/locations`. `locationFromApi` reads its id as
 * `location_id` first, falling back to `id` — a real cross-field OR the
 * backend's two location-ish routes both feed through this one mapper, not
 * a defect to collapse in the schema. Both stay optional; enforcing one or
 * the other strict would misreport the rows that only carry the other.
 */
export const ApiLocationRow = z.object({
  location_id: z.string().nullish(),
  id: z.string().nullish(),
  code: z.string().nullish(),
  name: z.string().nullish(),
  location_type: z.string().nullish(),
  type: z.string().nullish(),
  is_active: z.boolean().nullish(),
  status: z.string().nullish(),
})
export type ApiLocationRow = z.infer<typeof ApiLocationRow>

/** A row of `GET /v1/sourcing-shortlists`. */
export const ApiShortlistSummaryRow = z.object({
  // Becomes `SourcingShortlistList.id`, the id every add/remove mutation in
  // `./mutations.ts` addresses — strict for the same reason as the other ids.
  id: z.string(),
  name: z.string().nullish(),
  item_count: z.number().nullish(),
  item_ids: z.array(z.unknown()).nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
})
export type ApiShortlistSummaryRow = z.infer<typeof ApiShortlistSummaryRow>
