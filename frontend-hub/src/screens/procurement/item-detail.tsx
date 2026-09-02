import { useQuery } from "@tanstack/react-query"

import { AppLink } from "@/components/ui/app-link"
import { Fact, Facts } from "@/components/ui/sheet"
import { Tag } from "@/components/ui/tag"
import { count, day, money } from "@/lib/format"
import {
  procurementKeys,
  supplierDetail,
  supplierItemImage,
} from "@/lib/queries/procurement"
import { termLabel } from "@/screens/procurement/shared"
import type {
  CatalogueVocabulary,
  PurchaseHistory,
  SupplierItem,
} from "@itulah/contract"

/// What a supplier item is, drawn once for the two screens that show one.
///
/// Sourcing and Catalogue open the same record for different reasons — one is
/// shopping, the other is master data — so they compose their own sheets and
/// their own composers, and share only this: the photograph, the facts and the
/// words the item is filed under.
///
/// The supplier is read here rather than passed in because the image key needs
/// the supplier's own CODE, which the item does not carry: an item knows the
/// uuid of its supplier, and `catalogue/suppliers/{supplier_code}/items/…` is
/// keyed by the supplier's own numbering. Deriving one from the other is the
/// thing `cloud/media.rs` is explicit cannot be done.
export function ItemDetail({
  item,
  vocabulary,
  bought,
}: {
  item: SupplierItem
  vocabulary?: CatalogueVocabulary
  /// What has already been ordered of this item, when the caller knows.
  /// Handed in rather than fetched: the catalogue row already carries it, and
  /// a second request to learn what is in hand is a request for nothing.
  bought?: PurchaseHistory
}) {
  const supplier = useQuery({
    queryKey: procurementKeys.supplier(item.supplier_id),
    queryFn: ({ signal }) => supplierDetail(item.supplier_id, signal),
  })

  const supplierCode = supplier.data?.supplier_code
  const image = useQuery({
    queryKey: procurementKeys.itemImage(
      supplierCode ?? "",
      item.supplier_item_code
    ),
    queryFn: ({ signal }) =>
      supplierItemImage(supplierCode!, item.supplier_item_code, signal),
    enabled: supplierCode !== undefined,
    // A photograph does not change; a presigned URL expires. Fifteen minutes is
    // the server's own read TTL, so this is exactly as fresh as the answer.
    staleTime: 10 * 60 * 1000,
  })

  return (
    <div className="flex flex-col gap-5">
      {image.data ? (
        <img
          src={image.data.url}
          alt={item.name}
          className="max-h-56 w-full rounded-inner border border-hairline bg-soft object-contain"
        />
      ) : (
        <div className="grid h-24 place-items-center rounded-inner border border-hairline bg-soft text-meta text-mute">
          {image.isPending && supplierCode !== undefined
            ? "Looking for a photograph…"
            : "No photograph of this item."}
        </div>
      )}

      <Facts>
        <Fact term="Supplier">
          {/* No dead ends: the supplier this is offered by is one click away,
              and the same link works in the other direction from there. */}
          <AppLink
            to="/procurement/suppliers"
            sheet={{ key: "supplier", value: item.supplier_id }}
            className="text-accent hover:underline"
          >
            {supplier.data?.name ?? supplier.data?.supplier_code ?? "Supplier"}
          </AppLink>
        </Fact>
        <Fact term="Supplier code">{item.supplier_item_code}</Fact>
        <Fact term="Unit price">{money(item.unit_price_minor)}</Fact>
        <Fact term="Currency">{item.currency}</Fact>
        <Fact term="Division">
          {termLabel(vocabulary?.divisions, item.division_code)}
        </Fact>
        {/* Only when there is a history. "0 bought" on an item nobody has
            ordered reads as a judgement; silence reads as a first order. */}
        {bought !== undefined && bought.orders > 0 && (
          <>
            <Fact term="Bought">{count(bought.units)} pieces</Fact>
            <Fact term="On orders">{count(bought.orders)}</Fact>
            <Fact term="Last ordered">{day(bought.last_ordered_at)}</Fact>
          </>
        )}
        <Fact term="Our article">
          {/* Blank is a real state and it is the one that matters: an item with
              no internal article code can never be tagged, priced or sold. */}
          {item.internal_article_code ?? "Not linked"}
        </Fact>
        <Fact term="Updated">{day(item.updated_at)}</Fact>
        <Fact term="By">{item.updated_by}</Fact>
      </Facts>

      {item.description && (
        <p className="text-[0.8125rem] text-body">{item.description}</p>
      )}

      <div>
        <h4 className="mb-2 text-card-title font-semibold text-ink">Tags</h4>
        {item.tags.length === 0 ? (
          <p className="text-meta text-mute">
            Nobody has said what kind of thing this is.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {item.tags.map((tag) => (
              <Tag key={tag}>{termLabel(vocabulary?.tags, tag)}</Tag>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
