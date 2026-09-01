/**
 * Wire schemas for the article catalogue read.
 *
 * `fetchArticleCatalogue` in `./api.ts` goes `api.get<unknown>` into
 * defensive parsing (`str`, `num`, `list`, inline `.map()`s) that already
 * tolerates a missing field with a fallback or drops the row. These schemas
 * run alongside that path through `checkContract`, which never throws — the
 * value is the report, not a guard.
 *
 * Field names are the wire's snake_case, matching what `api.ts` reads off
 * `row.*` / `m.*` — these describe the payload, not the mapped `Article*`
 * shape it becomes.
 */

import { z } from "zod"

/** One variant group — `/v1/masterdata/variant-groups`. Becomes an `Article`. */
export const VariantGroupRow = z.object({
  id: z.string().nullish(),
  parent_sku: z.string().nullish(),
  group_name: z.string().nullish(),
  // Displayed with an "active" fallback, not switched on via a Record — loose.
  status: z.string().nullish(),
})
export type VariantGroupRow = z.infer<typeof VariantGroupRow>

/** One SKU from `/v1/masterdata/items/enriched`. Becomes an `ArticleItem`. */
export const EnrichedItemRow = z.object({
  sku: z.string().nullish(),
  category_id: z.string().nullish(),
  default_image_url: z.string().nullish(),
  // Union of all members' tags feeds the article's own tag chips — loose,
  // an unrecognised tag is still a valid tag, only its vocabulary is a filter.
  tags: z.array(z.string()).nullish(),
  color_digit: z.string().nullish(),
  color_label: z.string().nullish(),
  color_hex: z.string().nullish(),
  size_code: z.string().nullish(),
  size_label: z.string().nullish(),
  // Not a wire enum — `order` on a size purely fixes display order (XS
  // before XL), so a float here is presentational, not a units/money finding.
  size_order: z.number().nullish(),
  status: z.string().nullish(),
  // The article's selling price. Loose on `.int()`: unlike inventory
  // valuations, sourcing has no explicit currency field on this row either,
  // and no docs/money-contract.md wave names this route — recorded as a
  // finding rather than assumed to be minor-units already.
  sell_price: z.number().nullish(),
  /* Suppliers who may supply this item's ARTICLE (sourcing_items.family_id).
   * Loose like `tags`: an unrecognised supplier is still a supplier, and the
   * screen drops a row with no id rather than rejecting the payload. Older
   * binaries omit the field entirely, which is why it is nullish and not a
   * required array — a hub that does not serve it must not fail the contract
   * check for every row it returns.
   *
   * No cost here on purpose: a buying price belongs to one supplier's offer
   * and is bigint minor units on that offer, not a number on this row. */
  suppliers: z
    .array(
      z.object({
        supplier_id: z.string().nullish(),
        name: z.string().nullish(),
      })
    )
    .nullish(),
})
export type EnrichedItemRow = z.infer<typeof EnrichedItemRow>

/** One supplier as `/v1/masterdata/suppliers` returns it — read for the
 *  filter rail's labels, so only identity and name are described. */
export const SupplierRow = z.object({
  supplier_id: z.string().nullish(),
  name: z.string().nullish(),
})
export type SupplierRow = z.infer<typeof SupplierRow>

export const DivisionRow = z.object({
  id: z.string().nullish(),
  name: z.string().nullish(),
  code: z.string().nullish(),
})
export type DivisionRow = z.infer<typeof DivisionRow>

export const TagRow = z.object({
  id: z.string().nullish(),
  name: z.string().nullish(),
  is_active: z.boolean().nullish(),
})
export type TagRow = z.infer<typeof TagRow>
