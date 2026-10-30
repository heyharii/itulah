import { Card } from "@/components/ui/card"
import { ListTable, type ListColumn } from "@/components/ui/list-table"
import { articleId, pcs, sku } from "@/lib/format"
import { sumBySku, type StoreReturnAsk, type StoreReturnLine } from "@/lib/returns"
import { useRange } from "@/screens/stock/shared"

/// **Ready to send** (owner, 25 Oct 2026): what head office has already
/// raised for this shop to send back, as the goods — one row per SKU with its
/// pieces, summed over every return it is in — never return by return. The
/// allotment underneath is head office's bookkeeping, not the shop's.
export function ReadyToSend({ asks }: { asks: readonly StoreReturnAsk[] }) {
  const { bySku } = useRange()
  const rows = sumBySku(asks)
  const columns: ListColumn<StoreReturnLine>[] = [
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
      id: "pcs",
      header: "Pieces",
      align: "right",
      card: "status",
      cell: (one) => pcs(one.quantity),
    },
  ]
  return (
    <Card className="overflow-hidden max-md:overflow-visible">
      <ListTable
        rows={rows}
        columns={columns}
        rowKey={(one) => one.sku_code}
        roomy
        empty="Nothing to send."
      />
    </Card>
  )
}
