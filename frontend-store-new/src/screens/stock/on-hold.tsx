import { Card } from "@/components/ui/card"
import { ListTable, type ListColumn } from "@/components/ui/list-table"
import { Pill } from "@/components/ui/pill"
import { articleId, pcs, sku } from "@/lib/format"
import type { StoreOnHoldLine } from "@/lib/queries"
import { useRange } from "@/screens/stock/shared"

/// **On hold** (owner, 17–18 Oct 2026): what the shop counted beyond what
/// its delivery said — more of a SKU than was sent, or an article nobody sent.
/// It is not stock: set it aside. MD answers the trip's review; what goes
/// back to HO then says so here, and what MD kept is in stock and leaves the
/// list by itself. One row per article, named, not counted.
export function OnHold({ lines }: { lines: readonly StoreOnHoldLine[] }) {
  const { bySku } = useRange()
  const columns: ListColumn<StoreOnHoldLine>[] = [
    {
      id: "article",
      header: "Article",
      card: "title",
      className: "whitespace-normal",
      cell: (one) => (
        <span className="block">
          <span className="font-medium text-ink">
            {one.name ?? bySku.get(one.sku_code)?.name ?? sku(one.sku_code)}
          </span>
          <span className="block font-mono text-id text-mute">
            {articleId(bySku.get(one.sku_code)?.article_code, one.sku_code)} ·{" "}
            {sku(one.sku_code)}
          </span>
        </span>
      ),
    },
    {
      id: "note",
      header: "Delivery note",
      cell: (one) => (
        <span className="font-mono text-id">{one.shipment_reference ?? "—"}</span>
      ),
    },
    {
      id: "pcs",
      header: "Pieces",
      align: "right",
      cell: (one) => pcs(one.on_hold),
    },
    {
      id: "state",
      header: "",
      align: "right",
      card: "status",
      cell: (one) =>
        one.state === "RETURN_TO_HO" ? (
          <Pill tone="bad">Return to HO</Pill>
        ) : (
          <Pill tone="neutral">Waiting for MD</Pill>
        ),
    },
  ]
  return (
    <Card className="overflow-hidden max-md:overflow-visible">
      <ListTable
        rows={lines}
        columns={columns}
        rowKey={(one) => `${one.delivery_id}:${one.sku_code}`}
        roomy
        empty="Nothing is on hold."
      />
    </Card>
  )
}
