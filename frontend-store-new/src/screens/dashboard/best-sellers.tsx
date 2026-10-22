import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { CardTable } from "@/components/ui/card-table"
import type { ListColumn } from "@/components/ui/list-table"
import { articleId, count, sku as skuText } from "@/lib/format"
import { catalogueQuery } from "@/lib/queries"
import type { Basket, SoldSku } from "@/lib/queries/dashboard"
import { shapeBook, swatchBackground } from "@/lib/variants"
import { money, units } from "@itulah/contract/money"

/// The ten SKUs that sold most over the span, as a table on a desk and lead
/// cards on a phone.
///
/// Per SKU, not per article: the shop restocks a colour and a size, so "the
/// navy Oxford in M" is the unit anybody acts on. Each row's article, colour and
/// size are read off the resident catalogue the way the Catalogue and the
/// product sheet read them, so the three cannot name a garment differently; a
/// SKU the catalogue no longer holds keeps the name its receipt printed.

const TOP = 10

interface Named {
  readonly rank: number
  readonly sku: SoldSku
  readonly article: string
  readonly codes: string
  readonly colour: string | null
  readonly size: string | null
  readonly paint: readonly string[]
}

const COLUMNS: readonly ListColumn<Named>[] = [
  {
    id: "rank",
    header: "",
    className: "w-11 text-mute",
    cell: (row) => row.rank,
  },
  {
    id: "article",
    header: "Article",
    cell: (row) => (
      <span className="block">
        <span className="font-medium text-ink">{row.article}</span>
        <span className="block font-mono text-id text-mute">{row.codes}</span>
      </span>
    ),
  },
  {
    id: "colour",
    header: "Colour",
    cell: (row) =>
      row.colour === null ? (
        <span className="text-faint">—</span>
      ) : (
        <span className="inline-flex items-center gap-2">
          <Dot paint={row.paint} />
          {row.colour}
        </span>
      ),
  },
  {
    id: "size",
    header: "Size",
    cell: (row) => row.size ?? <span className="text-faint">—</span>,
  },
  {
    id: "sold",
    header: "Sold",
    align: "right",
    cell: (row) => `${units(row.sku.units)} ${row.sku.units === 1 ? "pc" : "pcs"}`,
  },
  {
    id: "sales",
    header: "Sales",
    align: "right",
    cell: (row) => (
      <span className="font-medium text-ink">{money(row.sku.sales_minor)}</span>
    ),
  },
]

export function BestSellers({
  basket,
  sub,
}: {
  basket: Basket
  /// The span, written out.
  sub: string
}) {
  // The same read the Catalogue screen files under this key, so on a shop
  // that has opened it this costs nothing.
  const book = useQuery(catalogueQuery())
  const shapes = useMemo(() => shapeBook(book.data?.items ?? []), [book.data])
  const items = useMemo(
    () =>
      new Map(
        (book.data?.items ?? []).map((one) => [one.sku_code, one] as const),
      ),
    [book.data],
  )

  const rows = useMemo<readonly Named[]>(
    () =>
      basket.skus.slice(0, TOP).map((sku, at) => {
        const item = items.get(sku.sku_code)
        const codes = `${articleId(item?.article_code, sku.sku_code)} · ${skuText(sku.sku_code)}`
        const shape =
          item === undefined
            ? undefined
            : shapes.get(item.article_code ?? item.sku_code)
        const variant = shape?.variant.get(sku.sku_code)
        if (shape === undefined || variant === undefined) {
          return {
            rank: at + 1,
            sku,
            article: sku.name,
            codes,
            colour: null,
            size: null,
            paint: [],
          }
        }
        return {
          rank: at + 1,
          sku,
          article: shape.name,
          codes,
          colour: variant.colour,
          size: variant.size,
          paint:
            shape.colours.find((one) =>
              one.skus.some((each) => each.sku_code === sku.sku_code),
            )?.paint ?? [],
        }
      }),
    [basket.skus, items, shapes],
  )

  return (
    <CardTable
      title="Best sellers · top 10"
      sub={sub}
      rows={rows}
      columns={COLUMNS}
      rowKey={(row) => row.sku.sku_code}
      empty="Nothing sold in this period."
      card={(row) => ({
        title: row.article,
        lines: [
          <span className="font-mono" key="codes">
            {row.codes}
          </span>,
          row.colour === null && row.size === null ? null : (
            <span className="inline-flex items-center gap-2">
              {row.colour !== null && <Dot paint={row.paint} />}
              {[row.colour, row.size].filter((one) => one !== null).join(" · ")}
            </span>
          ),
        ],
        lead: {
          figure: money(row.sku.sales_minor),
          caption: `${units(row.sku.units)} ${row.sku.units === 1 ? "pc" : "pcs"}`,
        },
      })}
      foot={
        basket.read < basket.sales ? (
          <p className="px-4 py-3 text-meta text-mute max-md:px-1 md:border-t md:border-hairline">
            Read from the latest {count(basket.read)} of {count(basket.sales)}{" "}
            sales.
          </p>
        ) : undefined
      }
    />
  )
}

/// A colour's dot, before its name.
function Dot({ paint }: { paint: readonly string[] }) {
  return (
    <span
      aria-hidden
      style={{ background: swatchBackground(paint) }}
      className="size-3.5 shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.14)]"
    />
  )
}
