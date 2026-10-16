import type { ExplorerFigures, ExplorerRow } from "@itulah/contract"
import { useMemo } from "react"

import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { SheetError, SheetLoading } from "@/components/ui/sheet-states"
import {
  MiniCell,
  MiniRow,
  MiniTable,
  SheetSection,
} from "@/components/ui/rows"
import { count, money, percent, quantity } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { cn } from "@/lib/utils"
import {
  useExplorerDetail,
  type ExplorerQuery,
  type SalesExplorer,
} from "@/screens/sales/explorer-data"
import {
  marginOf,
  nameParts,
  type GroupKey,
} from "@/screens/sales/explorer-model"

/// One row, opened from the table: its figures as facts, the stores it sold
/// in, and for an article its SKUs against the stores. A side sheet, never a
/// screen of its own.
///
/// An article or a SKU asks the server once more, narrowed to its code, for
/// the stores (the totals of that narrowed question are the row's own, store by
/// store, with stock) and for the SKUs.

export function DetailSheet({
  row,
  group,
  base,
  canCost,
  onClose,
}: {
  readonly row: ExplorerRow | null
  readonly group: GroupKey
  /// The table's own question, so the sheet is about the same days and the
  /// same filters.
  readonly base: ExplorerQuery
  readonly canCost: boolean
  readonly onClose: () => void
}) {
  const article = group === "article"
  const parts = row === null ? null : nameParts(group, row)
  // The code to narrow by: the article's or SKU's own.
  const code = row === null ? null : (parts?.code ?? null)
  const detail = useExplorerDetail(base, code)
  return (
    <Sheet
      open={row !== null}
      onOpenChange={(open) => !open && onClose()}
      title={parts?.title ?? ""}
      id={parts?.code ?? undefined}
      caption={parts?.sub ?? undefined}
      size={article ? "table" : "rail"}
      stack
    >
      {row !== null && (
        <>
          <RowFacts row={row} canCost={canCost} />
          {detail.isPending ? (
            <SheetLoading what="stores" />
          ) : detail.isError ? (
            <SheetError error={detail.error} onRetry={() => detail.refetch()} />
          ) : (
            <>
              <StoreTable
                stores={detail.data.stores}
                cells={
                  new Map(
                    detail.data.store_totals.map((c) => [c.site_id, c.figures])
                  )
                }
                total={row.figures}
              />
              {article && <SkuGrid data={detail.data} />}
            </>
          )}
        </>
      )}
    </Sheet>
  )
}

function RowFacts({ row, canCost }: { row: ExplorerRow; canCost: boolean }) {
  const f = row.figures
  const margin = marginOf(f)
  const rate =
    f.list_minor === 0 ? null : (f.discount_minor / f.list_minor) * 100
  return (
    <Facts>
      <Fact term="Sales">{money(f.sales_minor)}</Fact>
      <Fact term="Sold">{quantity(f.qty)}</Fact>
      <Fact term="Discount">
        {money(f.discount_minor)}
        {rate !== null && ` · ${percent(rate, { digits: 1 })}`}
      </Fact>
      <Fact term="Returns">
        {money(f.returns_minor)}
        {f.returned_qty > 0 && ` · ${quantity(f.returned_qty)}`}
      </Fact>
      {canCost && (
        <>
          <Fact term="Gross profit">
            {f.profit_minor === null ? "—" : money(f.profit_minor)}
            {margin !== null && ` · ${percent(margin, { digits: 1 })}`}
          </Fact>
          {f.uncosted_qty > 0 && (
            <Fact term="Without cost">{quantity(f.uncosted_qty)}</Fact>
          )}
        </>
      )}
      <Fact term="Stock">{f.stock === null ? "—" : quantity(f.stock)}</Fact>
      {canCost && (
        <Fact term="Stock value">
          {f.stock_cost_minor === null ? "—" : money(f.stock_cost_minor)}
        </Fact>
      )}
    </Facts>
  )
}

function StoreTable({
  stores,
  cells,
  total,
}: {
  stores: SalesExplorer["stores"]
  cells: ReadonlyMap<string, ExplorerFigures>
  total: ExplorerFigures
}) {
  const present = stores.filter((store) => {
    const f = cells.get(store.site_id)
    return (
      f !== undefined &&
      (f.qty !== 0 || f.sales_minor !== 0 || (f.stock ?? 0) > 0)
    )
  })
  if (present.length === 0) return null
  return (
    <SheetSection title="Stores" aside={count(present.length)}>
      <MiniTable stack={false} head={["Store", "Sold", "Sales", "Stock"]}>
        {present.map((store) => {
          const f = cells.get(store.site_id)
          return (
            <MiniRow key={store.site_id}>
              <MiniCell className="max-w-0 truncate">{store.name}</MiniCell>
              <MiniCell align="right">{count(f?.qty ?? 0)}</MiniCell>
              <MiniCell align="right">{money(f?.sales_minor ?? 0)}</MiniCell>
              <MiniCell align="right">{count(f?.stock ?? 0)}</MiniCell>
            </MiniRow>
          )
        })}
        <MiniRow>
          <MiniCell className="font-semibold text-ink">All stores</MiniCell>
          <MiniCell align="right" className="font-semibold text-ink">
            {count(total.qty)}
          </MiniCell>
          <MiniCell align="right" className="font-semibold text-ink">
            {money(total.sales_minor)}
          </MiniCell>
          <MiniCell align="right" className="font-semibold text-ink">
            {count(total.stock ?? 0)}
          </MiniCell>
        </MiniRow>
      </MiniTable>
    </SheetSection>
  )
}

/// A SKU's colour and size and its code, whichever way the server wrote them:
/// as "code · name" over "colour / size", or as "name · colour / size" over
/// the code.
function skuParts(row: ExplorerRow): { label: string; code: string | null } {
  const { title, code, sub } = nameParts("sku", row)
  if (sub !== null) return { label: sub, code }
  const rest = title.split(" · ").slice(1).join(" · ")
  return { label: rest === "" ? title : rest, code }
}

/// An article's SKUs against the stores: pieces sold, colour and size down the
/// side. On a phone each SKU is a block listing its stores, as nothing there
/// scrolls sideways.
function SkuGrid({ data }: { data: SalesExplorer }) {
  const phone = useLayout() === "phone"
  const skus = useMemo(
    () =>
      data.rows.map((sku) => ({
        sku,
        ...skuParts(sku),
        cells: new Map(sku.cells.map((c) => [c.site_id, c.figures])),
      })),
    [data.rows]
  )
  const stores = data.stores.filter((store) =>
    skus.some(({ cells }) => (cells.get(store.site_id)?.qty ?? 0) !== 0)
  )
  if (skus.length === 0) return null
  return (
    <SheetSection title="SKUs" aside={count(skus.length)}>
      {phone ? (
        <ul className="flex flex-col gap-4">
          {skus.map(({ sku, label, code, cells }) => (
            <li key={sku.key} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-medium text-ink">
                  {label}
                </span>
                <span className="shrink-0 text-ink tabular-nums">
                  {quantity(sku.figures.qty)}
                </span>
              </div>
              {code !== null && (
                <span className="font-mono text-[0.9375rem] text-mute">
                  {code}
                </span>
              )}
              {stores.map((store) => {
                const f = cells.get(store.site_id)
                if (f === undefined || f.qty === 0) return null
                return (
                  <div
                    key={store.site_id}
                    className="flex items-baseline justify-between gap-3 text-[0.9375rem]"
                  >
                    <span className="min-w-0 truncate text-text">
                      {store.name}
                    </span>
                    <span className="text-ink tabular-nums">
                      {count(f.qty)}
                    </span>
                  </div>
                )
              })}
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[0.9375rem]">
            <thead>
              <tr className="text-body">
                <th className="pr-3 pb-2.5 text-left text-[0.9375rem] font-medium whitespace-nowrap">
                  Colour / size
                </th>
                {stores.map((store) => (
                  <th
                    key={store.site_id}
                    title={store.name}
                    className="px-2 pb-2.5 text-right text-[0.9375rem] font-medium whitespace-nowrap"
                  >
                    {(store.code ?? store.name).replace(/-TOKO$/i, "")}
                  </th>
                ))}
                <th className="pb-2.5 pl-3 text-right text-[0.9375rem] font-medium whitespace-nowrap">
                  Sold
                </th>
                <th className="pb-2.5 pl-3 text-right text-[0.9375rem] font-medium whitespace-nowrap">
                  Stock
                </th>
              </tr>
            </thead>
            <tbody>
              {skus.map(({ sku, label, code, cells }) => (
                <tr key={sku.key} className="h-12 border-t border-hairline">
                  <td className="pr-3">
                    <span className="flex flex-col">
                      <span className="whitespace-nowrap text-ink">
                        {label}
                      </span>
                      {code !== null && (
                        <span className="font-mono text-[0.9375rem] text-mute">
                          {code}
                        </span>
                      )}
                    </span>
                  </td>
                  {stores.map((store) => {
                    const qty = cells.get(store.site_id)?.qty ?? 0
                    return (
                      <td
                        key={store.site_id}
                        className={cn(
                          "px-2 text-right tabular-nums",
                          qty === 0 ? "text-mute" : "text-ink"
                        )}
                      >
                        {qty === 0 ? "—" : count(qty)}
                      </td>
                    )
                  })}
                  <td className="pl-3 text-right text-ink tabular-nums">
                    {count(sku.figures.qty)}
                  </td>
                  <td className="pl-3 text-right text-ink tabular-nums">
                    {count(sku.figures.stock ?? 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SheetSection>
  )
}
