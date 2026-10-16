import { useMemo } from "react"

import { PhotoImg } from "@/components/ui/photo-img"
import { Section } from "@/components/ui/rows"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { Fact, Facts } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { Thumbnail } from "@/components/ui/thumbnail"
import { colourwayFill } from "@/lib/colourway-fill"
import { count, money } from "@/lib/format"
import type { ArticleDetail } from "@/lib/queries/articles"
import { cn } from "@/lib/utils"
import {
  gridOf,
  purchaseOf,
  type GridColour,
} from "@/screens/master/article-grid"
import type { ArticlePictures } from "@/screens/master/article-pictures"
import { markupFrom } from "@/screens/procurement/line-pricing-model"
import { termLabel } from "@/screens/procurement/shared"
import type { CatalogueVocabulary } from "@itulah/contract"

/// One article in the shared detail-sheet format: compact photo and facts,
/// colour/size selection, then the stock matrix. Variant price and identity
/// live in the selected summary instead of being repeated in every cell.
///
/// Choosing a colour or a size anywhere — a dot, a chip or a cell of the grid —
/// moves the one selection, so the picture, the price, the markup and the
/// quantity all follow it. What is shown is only what New articles set up:
/// the purchase price and its supplier, the selling price, the division, the
/// tags, and what is in stock of each variant.
///
/// Nothing here is edited. Codes are minted at the centre and already encoded
/// into the tags sewn into the goods; the Edit control opens the attributes
/// only (`article-edit.tsx`).

/// The colour the picture is painted in when there is no photograph: the hex
/// the master holds, else a read of the colour's name.
const fillOf = (colour: GridColour) => colourwayFill(colour.label, colour.hex)

/// A small picture of one colour: its photograph, else the article's, else the
/// garment drawn in that colour.
export function ColourThumb({
  url,
  article,
  vocabulary,
  colour,
  className,
}: {
  url: string | null
  article: ArticleDetail
  vocabulary?: CatalogueVocabulary
  colour: GridColour
  className?: string
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden rounded-inner border border-hairline bg-soft",
        className
      )}
    >
      {url ? (
        <PhotoImg
          url={url}
          alt=""
          className="size-full object-cover object-[center_15%]"
        />
      ) : (
        <Thumbnail
          url={null}
          name={article.name}
          division={
            article.division_code === null
              ? null
              : termLabel(vocabulary?.divisions, article.division_code)
          }
          colours={fillOf(colour)}
          className="size-full"
        />
      )}
    </span>
  )
}


/// The article read back as option F of article-allotments-tidy.html (owner,
/// 2026-10-15: "article detail jg perbaiki gini ya"), the PO detail's format:
/// the head (photo, crumb, name, division · tags · supplier) is the sheet's
/// own (`detail.tsx`); here the figures, then one Variants table — colour,
/// size, SKU, price, stock — with a Total, and Activity folded under it.
export function ArticleView({
  article,
  stock: showStock = true,
}: {
  article: ArticleDetail
  /// False hides the Stock figure and column (the Ops flow).
  stock?: boolean
  vocabulary?: CatalogueVocabulary
  pictures: ArticlePictures
}) {
  const grid = useMemo(() => gridOf(article), [article])
  const purchase = purchaseOf(article)

  const rows = grid.colours.flatMap((colour) =>
    grid.sizes.flatMap((size) => {
      const sku = grid.sku(colour.key, size.code)
      return sku === undefined ? [] : [{ colour, size, sku }]
    })
  )
  if (rows.length === 0)
    return (
      <EmptyState>
        Nothing has been minted from this article yet.
      </EmptyState>
    )

  const live = rows.filter((one) => one.sku.active)
  const prices = live
    .map((one) => one.sku.base_price_minor)
    .filter((one): one is number => one !== null)
  const low = prices.length === 0 ? null : Math.min(...prices)
  const high = prices.length === 0 ? null : Math.max(...prices)
  const stock = rows.reduce((sum, one) => sum + one.sku.stock_qty, 0)
  const markup =
    purchase === null || low === null || low !== high
      ? null
      : Number(markupFrom(purchase.cost, low) || "0")

  return (
    <>
      <KpiStrip className="mb-2!">
        <Kpi
          label="Selling price"
          value={
            low === null
              ? "—"
              : low === high
                ? money(low)
                : `${money(low)} – ${money(high!)}`
          }
        />
        <Kpi
          label="Purchase price"
          value={purchase === null ? "—" : money(purchase.cost)}
        />
        <Kpi
          label="Markup"
          value={
            markup === null ? (
              "—"
            ) : (
              <span className={cn(markup < 0 && "text-bad-fg")}>
                {`${String(Math.round(markup)).replace(".", ",")}%`}
              </span>
            )
          }
        />
        {showStock && <Kpi label="Stock" value={`${count(stock)} pcs`} />}
      </KpiStrip>

      {/* The description the supplier item carried from the PO, as a fact —
          only when there is one (owner, 2026-10-16). */}
      {article.description != null && article.description.trim() !== "" && (
        <Facts className="mt-4 mb-2">
          <Fact term="Description" wide>
            <span className="whitespace-pre-line">{article.description}</span>
          </Fact>
        </Facts>
      )}

      <Section
        title={
          <>
            Variants
            <span className="ml-1.5 font-normal text-mute">
              {count(rows.length)}
            </span>
          </>
        }
        rule={false}
        tight
      >
        <div className="items-box overflow-x-auto rounded-card border border-hairline">
          <table className="w-full min-w-[34rem] border-collapse text-[0.9375rem] tabular-nums">
            <thead>
              <tr>
                <th className="items-head px-4 py-3 text-left font-normal text-body">Colour</th>
                <th className="items-head px-4 py-3 text-left font-normal text-body">Size</th>
                <th className="items-head px-4 py-3 text-left font-normal text-body">SKU</th>
                <th className="items-head px-4 py-3 text-right font-normal text-body">Price</th>
                {showStock && (
                  <th className="items-head px-4 py-3 text-right font-normal text-body">Stock</th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ colour, size, sku }) => (
                <tr
                  key={sku.sku_code}
                  className={cn(
                    "border-t border-hairline",
                    !sku.active && "text-mute"
                  )}
                >
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2">
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-full border border-black/10"
                        style={{ background: colour.hex ?? "transparent" }}
                      />
                      {colour.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">{size.label}</td>
                  <td className="px-4 py-3 text-mute">{sku.sku_code}</td>
                  <td
                    className={cn(
                      "px-4 py-3 text-right",
                      !sku.active && "line-through"
                    )}
                  >
                    {sku.base_price_minor === null
                      ? "—"
                      : money(sku.base_price_minor)}
                  </td>
                  {showStock && (
                    <td
                      className={cn(
                        "px-4 py-3 text-right",
                        sku.stock_qty === 0 && "text-mute"
                      )}
                    >
                      {count(sku.stock_qty)} pcs
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            {showStock && (
              <tfoot>
                <tr className="border-t border-hairline bg-soft">
                  <td className="px-4 py-3 text-body" colSpan={4}>
                    Total
                  </td>
                  <td className="px-4 py-3 text-right text-ink">
                    {count(stock)} pcs
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Section>
    </>
  )
}



