/**
 * Wire schema for the supplier directory read.
 *
 * `fetchSupplierDirectory` in `./api.ts` goes `api.get<unknown>` into
 * `listFromPayload` and the defensive `mapSupplier`, which already tolerates
 * a missing or malformed field by falling back or dropping the row. This
 * schema does not replace that path — it runs alongside it through
 * `checkContract`, which never throws, so a renamed or dropped field becomes
 * an observed violation instead of a supplier that silently vanishes from
 * the table.
 *
 * Field names are the wire's snake_case, matching `ApiSupplier` in `api.ts`
 * (kept as-is — this schema describes the payload, it does not replace the
 * hand-written defensive-mapper input type).
 */

import { z } from "zod"

export const SupplierRow = z.object({
  supplier_id: z.string().nullish(),
  code: z.string().nullish(),
  name: z.string().nullish(),
  tax_id: z.string().nullish(),
  address: z.string().nullish(),
  notes: z.string().nullish(),
  // Displayed with a fallback of "active", not switched on via a Record — loose.
  status: z.string().nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  version: z.number().nullish(),
  tags: z.array(z.string()).nullish(),
  contact_count: z.number().nullish(),
  has_primary_contact: z.boolean().nullish(),
  payment_terms_days: z.number().nullish(),
  primary_division: z.string().nullish(),
  /*
   * total_spend / total_revenue read as money on the supplier card, but the
   * wire carries no currency field next to them (see ApiSupplier) — there is
   * nothing to validate an explicit currency against. Loose on `.int()` too:
   * mapSupplier's optionalNumber() accepts a float today and this is a
   * finding, not a fix — see the report for what was actually observed.
   */
  total_spend: z.number().nullish(),
  total_revenue: z.number().nullish(),
  // Stock/units counts are quantities, not money; still not the inventory
  // domain's own read model, so left loose rather than importing that rule.
  total_stock: z.number().nullish(),
  units_sold: z.number().nullish(),
  incoming_qty: z.number().nullish(),
  avg_lead_time_days: z.number().nullish(),
  total_articles: z.number().nullish(),
  store_spread: z.number().nullish(),
  history_events: z.number().nullish(),
})
export type SupplierRow = z.infer<typeof SupplierRow>
