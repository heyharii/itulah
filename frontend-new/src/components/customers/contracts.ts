/**
 * Wire schemas for the customer directory and customer-360 reads.
 *
 * Every fetch in `./api.ts` goes `api.get<unknown>` into a defensive mapper
 * (`mapCustomer`, `map360Purchase`, `map360Voucher`, `map360Point`) that
 * already tolerates a missing field with a fallback or drops the row. These
 * schemas run alongside that path through `checkContract`, which never
 * throws — the value is the report, not a guard.
 *
 * Field names are the wire's snake_case, matching the `Api*` interfaces in
 * `api.ts` (kept as-is — they are the defensive mapper's input type, not a
 * second description this schema replaces).
 */

import { z } from "zod"

export const CustomerRow = z.object({
  customer_id: z.string().nullish(),
  member_id: z.string().nullish(),
  name: z.string().nullish(),
  display_name: z.string().nullish(),
  phone: z.string().nullish(),
  email: z.string().nullish(),
  tier: z.string().nullish(),
  points: z.number().nullish(),
  points_balance: z.number().nullish(),
  /*
   * total_spend / lifetime_spend are money on the customer card, but the
   * wire carries no currency field beside them — nothing to check an
   * explicit currency against. Loose on `.int()` too: numberValue() already
   * accepts a float and rounds nothing, so a float here is a pre-existing
   * silent acceptance, not something this pass changes — see the report.
   */
  total_spend: z.number().nullish(),
  lifetime_spend: z.number().nullish(),
  created_at: z.string().nullish(),
  joined_on: z.string().nullish(),
  home_store: z.string().nullish(),
})
export type CustomerRow = z.infer<typeof CustomerRow>

export const LoyaltyBalanceRow = z.object({
  points_balance: z.number().nullish(),
  tier: z.string().nullish(),
  tier_progress: z.number().nullish(),
})
export type LoyaltyBalanceRow = z.infer<typeof LoyaltyBalanceRow>

export const PurchaseRow = z.object({
  id: z.string().nullish(),
  store_id: z.string().nullish(),
  store_name: z.string().nullish(),
  // Money, no currency field on the wire — see CustomerRow's note above.
  total: z.number().nullish(),
  item_count: z.number().nullish(),
  points_earned: z.number().nullish(),
  points_used: z.number().nullish(),
  transaction_at: z.string().nullish(),
})
export type PurchaseRow = z.infer<typeof PurchaseRow>

export const VoucherRow = z.object({
  id: z.string().nullish(),
  code: z.string().nullish(),
  title: z.string().nullish(),
  description: z.string().nullish(),
  voucher_type: z.string().nullish(),
  // Stored-value money, no currency field on the wire — see the note above.
  initial_value: z.number().nullish(),
  balance: z.number().nullish(),
  single_use: z.boolean().nullish(),
  expires_at: z.string().nullish(),
  // Displayed with a fallback of "active", not switched on via a Record — loose.
  status: z.string().nullish(),
})
export type VoucherRow = z.infer<typeof VoucherRow>

export const LoyaltyTransactionRow = z.object({
  id: z.string().nullish(),
  // The UI derives a signed `kind` ("earn"/"spend"/"expire"/"adjust") from
  // this via a lowercase string match with an "adjust" fallback for anything
  // unrecognised, so an unknown wire value is already handled gracefully —
  // loose.
  type: z.string().nullish(),
  points: z.number().nullish(),
  reference: z.string().nullish(),
  description: z.string().nullish(),
  created_at: z.string().nullish(),
})
export type LoyaltyTransactionRow = z.infer<typeof LoyaltyTransactionRow>
