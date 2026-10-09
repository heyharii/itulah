import { FolderTree, Tag as TagIcon } from "lucide-react"
import { useMemo, useState } from "react"

import { AppLink } from "@/components/ui/app-link"
import { PhotoImg } from "@/components/ui/photo-img"
import { ZoomPhoto } from "@/components/ui/photo-viewer"
import { SubHead } from "@/components/ui/rows"
import { EmptyState } from "@/components/ui/states"
import { Thumbnail } from "@/components/ui/thumbnail"
import { colourwayFill } from "@/lib/colourway-fill"
import { count, money } from "@/lib/format"
import type { ArticleDetail } from "@/lib/queries/articles"
import { useLayout } from "@/lib/layout"
import { cn } from "@/lib/utils"
import {
  gridOf,
  purchaseOf,
  type Grid,
  type GridColour,
} from "@/screens/master/article-grid"
import type { ArticlePictures } from "@/screens/master/article-pictures"
import { markupFrom } from "@/screens/procurement/line-pricing-model"
import { Matrix } from "@/screens/procurement/setups"
import { termLabel } from "@/screens/procurement/shared"
import { useSupplierName } from "@/screens/procurement/supplier-name"
import type { CatalogueVocabulary } from "@itulah/contract"

/// One article, read the way a shop page reads: the picture, the colours, the
/// sizes and the price are always together, and the variants sit below as the
/// same grid New articles filled in.
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

/// What to select first: the first colour, and its first size that is in
/// stock — the one a shopper would land on.
function firstPick(grid: Grid): { colour: string; size: string } {
  const colour = grid.colours[0]?.key ?? ""
  const size =
    grid.sizes.find((one) => (grid.sku(colour, one.code)?.stock_qty ?? 0) > 0) ??
    grid.sizes[0]
  return { colour, size: size?.code ?? "" }
}

export function ArticleView({
  article,
  vocabulary,
  pictures,
}: {
  article: ArticleDetail
  vocabulary?: CatalogueVocabulary
  pictures: ArticlePictures
}) {
  const grid = useMemo(() => gridOf(article), [article])
  const phone = useLayout() === "phone"
  const supplierName = useSupplierName()
  const [picked, setPicked] = useState(() => firstPick(grid))

  const colour =
    grid.colours.find((one) => one.key === picked.colour) ?? grid.colours[0]
  const size = grid.sizes.find((one) => one.code === picked.size)
  const sku = colour && size ? grid.sku(colour.key, size.code) : undefined
  const purchase = purchaseOf(article)

  const divisionName =
    article.division_code === null
      ? null
      : termLabel(vocabulary?.divisions, article.division_code)
  const tags = article.tags.map((code) => termLabel(vocabulary?.tags, code))

  if (colour === undefined)
    return (
      <>
        <KindBlock
          division={divisionName}
          tags={tags}
        />
        <EmptyState>
          Nothing has been minted from this article yet. SKUs are drawn by a
          setup session, together with their serial ranges and their EPCs.
        </EmptyState>
      </>
    )

  const shown = (colour.digit ? pictures.own.get(colour.digit) : null) ?? pictures.main
  const price = sku?.base_price_minor ?? null
  const cancelled = sku !== undefined && !sku.active
  const markup =
    purchase === null || price === null || cancelled
      ? null
      : Number(markupFrom(purchase.cost, price) || "0")

  return (
    <>
      <div className="grid gap-5 md:grid-cols-[minmax(0,17.5rem)_minmax(0,1fr)] md:gap-7">
        <ZoomPhoto url={shown} name={`${article.name} ${colour.label}`}>
          <span className="block h-60 overflow-hidden rounded-inner border border-hairline bg-soft md:h-80">
            {shown ? (
              <PhotoImg
                // A new link is a new picture: keyed so the fade runs again.
                key={shown}
                url={shown}
                alt={`${article.name}, ${colour.label}`}
                className="size-full object-contain"
                eager
              />
            ) : (
              <Thumbnail
                url={null}
                name={article.name}
                division={divisionName}
                colours={fillOf(colour)}
                className="size-full"
              />
            )}
          </span>
        </ZoomPhoto>

        <div className="flex min-w-0 flex-col gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span
                className={cn(
                  "text-[1.5rem] leading-8 font-semibold tracking-[-0.01em] tabular-nums",
                  price === null ? "text-mute" : "text-ink",
                  cancelled && "line-through"
                )}
              >
                {price === null ? "No price yet" : money(price)}
              </span>
              {cancelled && <span className="text-meta text-mute">Cancelled</span>}
              {markup !== null && (
                <span
                  className={cn(
                    "inline-flex h-6 items-center rounded-full px-2.5 text-[0.875rem] font-medium whitespace-nowrap tabular-nums",
                    markup < 0
                      ? "bg-bad-bg text-bad-fg"
                      : "bg-ok-bg text-ok-fg"
                  )}
                >
                  {markup < 0 ? "−" : "+"}
                  {String(Math.abs(markup)).replace(".", ",")}% markup
                </span>
              )}
            </div>
            {purchase !== null && (
              <div className="mt-1 text-meta text-mute">
                Purchase price {money(purchase.cost)} ·{" "}
                <AppLink
                  to="/procurement/suppliers"
                  sheet={{ key: "supplier", value: purchase.supplierId }}
                  className="text-accent hover:underline"
                >
                  {supplierName(null, purchase.supplier, purchase.supplierId)}
                </AppLink>
              </div>
            )}
          </div>

          <div>
            <div className="mb-2 text-meta text-body">
              Colour <span className="font-medium text-ink">{colour.label}</span>
            </div>
            <div role="group" aria-label="Colours" className="flex flex-wrap gap-2.5">
              {grid.colours.map((one) => (
                <button
                  key={one.key}
                  type="button"
                  aria-pressed={one.key === colour.key}
                  aria-label={one.label}
                  title={one.label}
                  onClick={() => setPicked((was) => ({ ...was, colour: one.key }))}
                  style={{ background: fillOf(one)[0] ?? "var(--color-soft-3)" }}
                  className={cn(
                    "size-8 rounded-full border border-hairline-2 transition-[box-shadow,transform] duration-150 ease-out active:scale-[0.94] pointer-coarse:size-11",
                    one.key === colour.key &&
                      "ring-2 ring-accent ring-offset-2 ring-offset-canvas"
                  )}
                />
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 text-meta text-body">Size</div>
            <div role="group" aria-label="Sizes" className="flex flex-wrap gap-2">
              {grid.sizes.map((one) => {
                const here = grid.sku(colour.key, one.code)
                const out = here === undefined || !here.active || here.stock_qty === 0
                const on = one.code === size?.code
                return (
                  <button
                    key={one.code}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setPicked((was) => ({ ...was, size: one.code }))}
                    className={cn(
                      "inline-flex h-9 min-w-11 items-center justify-center rounded-inner border px-3 text-[0.9375rem] font-medium transition-colors duration-150 ease-out active:scale-[0.97] pointer-coarse:h-11",
                      on
                        ? "border-accent bg-accent-bg text-accent"
                        : out
                          ? "border-dashed border-hairline-2 bg-canvas text-mute"
                          : "border-hairline-2 bg-canvas text-ink"
                    )}
                  >
                    {one.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex flex-col gap-2.5 border-t border-hairline pt-4">
            <div className="text-meta text-body">
              Quantity{" "}
              <span className="font-semibold text-ink tabular-nums">
                {sku === undefined ? "—" : count(sku.stock_qty)}
              </span>
            </div>
            <KindLines division={divisionName} tags={tags} />
          </div>
        </div>
      </div>

      <section>
        <SubHead aside={`${count(grid.total)} pcs`}>Variants</SubHead>
        {phone ? (
          <ColourLists
            article={article}
            vocabulary={vocabulary}
            grid={grid}
            pictures={pictures}
          />
        ) : (
          <Matrix
            colours={grid.colours}
            sizes={grid.sizes}
            columnClass="w-[7.25rem]"
            rowHeadClass="w-[10.5rem]"
            rowHead={(row) => {
              const one = grid.colours.find((each) => each.key === row.key)!
              return (
                <span className="flex items-center gap-2.5">
                  <ColourThumb
                    url={
                      (one.digit ? pictures.own.get(one.digit) : null) ??
                      pictures.main
                    }
                    article={article}
                    vocabulary={vocabulary}
                    colour={one}
                    className="size-9"
                  />
                  <span className="min-w-0 truncate text-[0.875rem] font-medium text-ink">
                    {one.label}
                  </span>
                </span>
              )
            }}
            rowTotal={(row) => count(grid.rowTotal(row.key))}
            columnTotal={(col) => count(grid.columnTotal(col.code))}
            total={count(grid.total)}
            cellProps={(row, col) => ({
              onClick: () => setPicked({ colour: row.key, size: col.code }),
              title: grid.sku(row.key, col.code)?.sku_code,
              className: cn(
                "cursor-pointer transition-colors duration-150 ease-out",
                row.key === colour.key && col.code === size?.code
                  ? "bg-accent-bg"
                  : "hover:bg-soft"
              ),
            })}
            cell={(row, col) => {
              const here = grid.sku(row.key, col.code)
              if (here === undefined)
                return <span className="text-faint">—</span>
              return (
                <span
                  className={cn(
                    "flex flex-col items-end py-1 leading-5",
                    !here.active && "text-mute line-through"
                  )}
                >
                  <span className="text-[0.9375rem] font-medium text-ink">
                    {count(here.stock_qty)}
                  </span>
                  <span className="text-[0.875rem] text-mute">
                    {money(here.base_price_minor)}
                  </span>
                  <span className="font-mono text-[0.875rem] text-mute">
                    {here.sku_code}
                  </span>
                </span>
              )
            }}
          />
        )}
      </section>
    </>
  )
}

/// Division and tags as two quiet lines under the quantity: the division is ONE
/// value behind a folder glyph, the tags are plain words behind a tag glyph.
/// Different marks, so the two are never mistaken for each other.
function KindLines({
  division,
  tags,
}: {
  division: string | null
  tags: readonly string[]
}) {
  return (
    <>
      <div className="flex items-start gap-2 text-meta font-medium text-ink">
        <FolderTree aria-hidden className="mt-0.5 size-4 shrink-0 text-mute" />
        <span className={cn(division === null && "font-normal text-mute")}>
          {division ?? "Unclassified"}
        </span>
      </div>
      {tags.length > 0 && (
        <div className="flex items-start gap-2 text-meta text-mute">
          <TagIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span className="flex flex-wrap gap-x-3">
            {tags.map((word, at) => (
              <span key={`${word}-${at}`}>{word}</span>
            ))}
          </span>
        </div>
      )}
    </>
  )
}

function KindBlock(props: {
  division: string | null
  tags: readonly string[]
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <KindLines {...props} />
    </div>
  )
}

/// The grid on a phone: a box per colour, its sizes listed under it — never
/// sideways.
function ColourLists({
  article,
  vocabulary,
  grid,
  pictures,
}: {
  article: ArticleDetail
  vocabulary?: CatalogueVocabulary
  grid: Grid
  pictures: ArticlePictures
}) {
  return (
    <div className="flex flex-col gap-3">
      {grid.colours.map((one) => (
        <div
          key={one.key}
          className="overflow-hidden rounded-inner border border-hairline"
        >
          <div className="flex items-center gap-2.5 bg-soft px-3 py-2">
            <ColourThumb
              url={(one.digit ? pictures.own.get(one.digit) : null) ?? pictures.main}
              article={article}
              vocabulary={vocabulary}
              colour={one}
              className="size-9"
            />
            <span className="min-w-0 flex-1 truncate text-[0.9375rem] font-medium text-ink">
              {one.label}
            </span>
            <span className="text-[0.875rem] text-mute tabular-nums">
              {count(grid.rowTotal(one.key))}
            </span>
          </div>
          {grid.sizes.map((each) => {
            const here = grid.sku(one.key, each.code)
            return (
              <div
                key={each.code}
                className={cn(
                  "flex items-baseline gap-3 border-t border-hairline px-3 py-2 text-[0.9375rem]",
                  here !== undefined && !here.active && "text-mute line-through"
                )}
              >
                <span className="w-9 shrink-0 font-medium text-ink">
                  {each.label}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[0.875rem] text-mute">
                  {here?.sku_code ?? "—"}
                </span>
                <span className="shrink-0 tabular-nums">
                  {here === undefined
                    ? "—"
                    : `${count(here.stock_qty)} · ${money(here.base_price_minor)}`}
                </span>
              </div>
            )
          })}
        </div>
      ))}
      <div className="text-right text-[0.875rem] text-mute tabular-nums">
        Quantity {count(grid.total)}
      </div>
    </div>
  )
}
