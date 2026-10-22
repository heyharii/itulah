import { Card } from "@/components/ui/card"
import { ListTable, type ListColumn } from "@/components/ui/list-table"
import { articleId, count, sku } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { cn } from "@/lib/utils"
import { swatchBackground } from "@/lib/variants"
import {
  dealsOfCard,
  dealWords,
  sizesLeft,
  type Card as CatalogueCard,
  type Holding,
} from "@/screens/catalogue-model"
import { Photograph, SoldOutStamp } from "@/screens/catalogue-parts"
import { money } from "@itulah/contract/money"

/// The Catalogue as a table — the same cards as the tiles, one to a row, for
/// reading stock and prices down a column rather than across a grid.
///
/// By article, a row is a style: its colours (each dot says which of its
/// sizes are left), its sizes (struck where none is left), the pieces held,
/// and the price a walk-in pays. By SKU, a row is one colour in one size, with
/// its floor and warehouse apart. On a phone the rows
/// become `ListTable`'s card rows — nothing scrolls sideways there.
export function CatalogueTable({
  cards,
  bySku,
  currency,
  holdings,
  onOpen,
}: {
  cards: readonly CatalogueCard[]
  bySku: boolean
  currency: string
  holdings: ReadonlyMap<string, Holding | null>
  onOpen: (sku: string) => void
}) {
  const phone = useLayout() === "phone"
  const columns: ListColumn<CatalogueCard>[] = [
    {
      id: "article",
      header: bySku ? "SKU" : "Article",
      card: "title",
      className: "w-full min-w-[12rem] whitespace-normal",
      cell: (card) => (
        <span className="flex items-center gap-3">
          <span className="size-11 shrink-0 overflow-hidden rounded-inner bg-soft-2">
            <Photograph
              sku={card.lead.row.sku_code}
              has={card.lead.row.has_image}
              name={card.lead.row.name}
            />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[0.9375rem] font-medium text-ink">
              {card.shape.name}
            </span>
            <span className="block truncate font-mono text-[0.875rem] font-normal text-mute">
              {bySku
                ? `${articleId(card.lead.row.article_code, card.lead.row.sku_code)} · ${sku(card.lead.row.sku_code)}`
                : articleId(card.lead.row.article_code, card.lead.row.sku_code)}
            </span>
          </span>
        </span>
      ),
    },
    {
      id: "colour",
      header: bySku ? "Colour" : "Colours",
      card: "meta",
      cell: (card) => {
        const holding = holdings.get(card.lead.key) ?? null
        const sizes = (
          <Sizes
            sizes={
              bySku
                ? card.lead.size === null
                  ? []
                  : [card.lead.size]
                : card.shape.sizes
            }
            holding={bySku ? null : holding}
          />
        )
        if (bySku) {
          const colour = card.shape.colours.find(
            (one) =>
              (one.label ?? "").toLowerCase() ===
              (card.lead.colour ?? "").toLowerCase(),
          )
          return (
            <span className="inline-flex items-center gap-2">
              {colour !== undefined && <Dot paint={colour.paint} />}
              {card.lead.colour ?? "—"}
              {/* A phone row has no Size column beside it. */}
              {phone && card.lead.size !== null && (
                <span className="text-mute">· {sizes}</span>
              )}
            </span>
          )
        }
        return (
          <span className="inline-flex items-center gap-1.5">
            {card.shape.colours.slice(0, DOTS).map((colour) => (
              <Dot
                key={colour.label ?? ""}
                paint={colour.paint}
                gone={
                  holding !== null &&
                  (holding.colours.get((colour.label ?? "").toLowerCase()) ??
                    0) <= 0
                }
                title={
                  holding === null
                    ? (colour.label ?? undefined)
                    : `${colour.label ?? "No colour"} · ${leftOf(holding, colour.label, card.shape.sizes)}`
                }
              />
            ))}
            {card.shape.colours.length > DOTS && (
              <span className="text-[0.875rem] text-mute tabular-nums">
                +{count(card.shape.colours.length - DOTS)}
              </span>
            )}
            {phone && card.shape.sizes.length > 0 && (
              <span className="ml-1 text-mute">· {sizes}</span>
            )}
          </span>
        )
      },
    },
    {
      id: "size",
      header: bySku ? "Size" : "Sizes",
      card: "hide",
      cell: (card) =>
        bySku ? (
          (card.lead.size ?? "—")
        ) : (
          <Sizes
            sizes={card.shape.sizes}
            holding={holdings.get(card.lead.key) ?? null}
          />
        ),
    },
    // Where a SKU's pieces are, floor and warehouse apart. By article the
    // total says enough, and the row has the colours and sizes to carry.
    ...(bySku
      ? ([
          {
            id: "floor",
            header: "Floor",
            align: "right",
            card: "hide",
            className: "max-xl:hidden",
            cell: (card) => <Figure value={card.stock?.floor} />,
          },
          {
            id: "warehouse",
            header: "Warehouse",
            align: "right",
            card: "hide",
            className: "max-xl:hidden",
            cell: (card) => <Figure value={card.stock?.warehouse} />,
          },
        ] satisfies ListColumn<CatalogueCard>[])
      : []),
    {
      id: "stock",
      header: "Stock",
      align: "right",
      card: "status",
      cell: (card) =>
        card.soldOut ? (
          <SoldOutStamp size="small" />
        ) : (
          <span className="tabular-nums">
            <Figure value={card.stock?.total} />
            {phone && card.stock !== null && (
              <span className="text-mute">
                {card.stock.total === 1 ? " pc" : " pcs"}
              </span>
            )}
          </span>
        ),
    },
    {
      id: "price",
      header: "Price",
      align: "right",
      card: "status",
      cell: (card) => <Price card={card} currency={currency} />,
    },
    {
      id: "deals",
      header: "Deals",
      card: "meta",
      className: "max-lg:hidden",
      // One line: the deal that matters most, and how many more. The rest
      // are a hover away, and every one of them is in the article's sheet.
      cell: (card) => {
        const words = dealWords(dealsOfCard(card.items))
        return words.length === 0 ? (
          <span className="text-mute">—</span>
        ) : (
          <span
            title={words.join("\n")}
            className="inline-flex max-w-[11rem] items-baseline gap-1 text-[0.875rem]"
          >
            <span className="truncate text-accent">{words[0]}</span>
            {words.length > 1 && (
              <span className="shrink-0 text-mute tabular-nums">
                +{count(words.length - 1)}
              </span>
            )}
          </span>
        )
      },
    },
  ]
  return (
    <Card>
      <ListTable
        rows={cards}
        columns={columns}
        rowKey={(card) => card.key}
        onOpen={(card) => onOpen(card.lead.row.sku_code)}
        empty="Nothing in the range matches that."
      />
    </Card>
  )
}

const DOTS = 6

/// Which sizes of a colour are left, said for a tooltip.
function leftOf(
  holding: Holding,
  colour: string | null,
  order: readonly string[],
): string {
  const sizes = sizesLeft(holding, colour, order)
  if (sizes.length === 0) return "sold out"
  return sizes.every((size) => size === "")
    ? "in stock"
    : `${sizes.join(", ")} left`
}

function Figure({ value }: { value: number | undefined }) {
  return value === undefined ? (
    <span className="text-mute">—</span>
  ) : (
    <span className={cn("tabular-nums", value <= 0 && "text-mute")}>
      {count(value)}
    </span>
  )
}

/// The price a walk-in pays, red with the shelf's own price struck under it
/// when a markdown or a promotion brings it down.
function Price({ card, currency }: { card: CatalogueCard; currency: string }) {
  const was = card.lead.row.base_unit_price_minor
  const down = card.lead.final < was
  return (
    <span className="inline-flex flex-col items-end tabular-nums">
      <span className={cn("font-semibold", down ? "text-bad-fg" : "text-ink")}>
        {card.from && <span className="mr-1 font-normal text-mute">From</span>}
        {money(card.lead.final, currency)}
      </span>
      {down && (
        <span className="text-[0.875rem] text-mute line-through">
          {money(was, currency)}
        </span>
      )}
    </span>
  )
}

/// Sizes, each struck through where the article holds none of it.
export function Sizes({
  sizes,
  holding,
}: {
  sizes: readonly string[]
  holding: Holding | null
}) {
  if (sizes.length === 0) return <span className="text-mute">—</span>
  return (
    <span className="inline-flex gap-x-1.5 whitespace-nowrap">
      {sizes.map((size) => {
        const gone = holding !== null && (holding.sizes.get(size) ?? 0) <= 0
        return (
          <span
            key={size}
            className={cn(gone && "text-mute line-through")}
            title={gone ? `${size}: sold out` : undefined}
          >
            {size}
          </span>
        )
      })}
    </span>
  )
}

/// A colour's dot; slashed through where none of it is left.
export function Dot({
  paint,
  gone = false,
  title,
}: {
  paint: readonly string[]
  gone?: boolean
  title?: string
}) {
  return (
    <span
      title={title}
      style={{ background: swatchBackground(paint) }}
      className={cn(
        "relative size-3.5 shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.14)]",
        gone &&
          "opacity-60 after:absolute after:top-1/2 after:left-1/2 after:h-[1.5px] after:w-[130%] after:-translate-1/2 after:-rotate-45 after:bg-canvas after:shadow-[0_0_0_0.75px_rgb(0_0_0/0.55)] after:content-['']",
      )}
    />
  )
}
