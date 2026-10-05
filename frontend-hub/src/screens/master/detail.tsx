import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Tag } from "@/components/ui/tag"
import { count, day, money, realItemCode } from "@/lib/format"
import {
  articleDetail,
  articleKeys,
  type ArticleDetail,
  type ArticleSku,
} from "@/lib/queries/articles"
import {
  articleImage,
  catalogueVocabulary,
  procurementKeys,
} from "@/lib/queries/procurement"
import { queryState } from "@/lib/query-state"
import { ColourSwatch } from "@/screens/master/colour-picker"
import { ArticleForm } from "@/screens/master/form"
import { markupFrom } from "@/screens/procurement/line-pricing-model"
import { Matrix } from "@/screens/procurement/setups"
import { termLabel } from "@/screens/procurement/shared"
import { cn } from "@/lib/utils"
import { useSupplierName } from "@/screens/procurement/supplier-name"
import type { CatalogueVocabulary } from "@itulah/contract"

/// One article, whole.
///
/// Nowhere in the app showed a product as itself before this: the catalogue was
/// readable only through a price list, which meant a merchandiser asking "what
/// do we sell" got a company price and had to ignore half the answer. What an
/// article actually is spans three panels — what it is called and comes in,
/// which variants were minted from it, and who sells it to us — so they are
/// sub-tabs rather than one column somebody scrolls past.
///
/// The identity is drawn but never offered for editing. An article code and its
/// SKU codes come from a setup session at the centre and are already encoded
/// into the EPCs tagged onto goods; the Edit control opens attributes only.

export function ArticleSheet({
  articleCode,
  open,
  onClose,
}: {
  articleCode: string | null
  open: boolean
  onClose: () => void
}) {
  const [tab, setTab] = useState("overview")
  const [editing, setEditing] = useState(false)

  /// Reset when the sheet moves to a different article, adjusting state during
  /// render rather than in an effect: an effect would let one frame of the new
  /// article draw under the previous one's open tab, and — worse — under an
  /// edit form still holding the previous article's typed values.
  const [shown, setShown] = useState(articleCode)
  if (shown !== articleCode) {
    setShown(articleCode)
    setTab("overview")
    setEditing(false)
  }

  const detail = useQuery({
    queryKey: articleKeys.article(articleCode ?? ""),
    queryFn: ({ signal }) => articleDetail(articleCode!, signal),
    enabled: open && articleCode !== null,
  })

  const vocabulary = useQuery({
    queryKey: procurementKeys.vocabulary(),
    queryFn: ({ signal }) => catalogueVocabulary(signal),
    // Closed sets that change when somebody adds a division, not while
    // somebody is reading an article.
    staleTime: 30 * 60 * 1000,
  })

  return (
    <Sheet
      open={open && articleCode !== null}
      subject={
        articleCode === null ? undefined : { kind: "article", id: articleCode }
      }
      onOpenChange={(next) => !next && onClose()}
      // Wider on the SKUs tab: a colour x size grid is read across, and in
      // a 27.5rem rail five sizes already scrolled sideways.
      width={tab === "skus" && !editing ? "table" : "rail"}
      id={detail.data?.article_code ?? articleCode ?? undefined}
      title={detail.data?.name ?? "Article"}
      actions={
        detail.data && (
          <Button size="sm" onClick={() => setEditing((was) => !was)}>
            {editing ? "Stop editing" : "Edit"}
          </Button>
        )
      }
    >
      {queryState(detail, {
        loading: "Loading the article…",
        render: (article) =>
          editing ? (
            <ArticleForm
              article={article}
              vocabulary={vocabulary.data}
              onSaved={() => setEditing(false)}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <>
              <SubTabs
                tabs={[
                  { value: "overview", label: "Overview" },
                  {
                    value: "skus",
                    label: `SKUs (${article.skus.length})`,
                  },
                  {
                    value: "suppliers",
                    label: `Suppliers (${article.supplier_items.length})`,
                  },
                ]}
                value={tab}
                onChange={setTab}
              />
              {tab === "overview" ? (
                <Overview article={article} vocabulary={vocabulary.data} />
              ) : tab === "skus" ? (
                <Skus article={article} />
              ) : (
                <Suppliers article={article} />
              )}
            </>
          ),
      })}
    </Sheet>
  )
}

// ---------------------------------------------------------------------------

/// The floor price across an article's SKUs.
///
/// A range where its variants are priced differently, one figure where they are
/// not, and an em dash where nothing has been priced — absent rather than zero,
/// because no price is not a price of nothing.
function priceSpan(article: ArticleDetail): string {
  const { base_price_min_minor: low, base_price_max_minor: high } = article
  if (low === null && high === null) return "—"
  if (low === null || high === null || low === high) return money(low ?? high)
  return `${money(low)} – ${money(high)}`
}

function Overview({
  article,
  vocabulary,
}: {
  article: ArticleDetail
  vocabulary?: CatalogueVocabulary
}) {
  /// How many SKUs carry each colour digit. Drawn beside the colourway because
  /// it is the number that decides whether that colour can still be changed at
  /// all: a digit with SKUs against it is tagged onto goods on a shelf.
  const perDigit = new Map<string, number>()
  for (const sku of article.skus) {
    if (sku.colour_digit === null) continue
    perDigit.set(sku.colour_digit, (perDigit.get(sku.colour_digit) ?? 0) + 1)
  }

  return (
    <div className="flex flex-col gap-5">
      {article.image_url !== null && (
        <img
          src={article.image_url}
          alt={article.name}
          className="max-h-56 w-full rounded-inner border border-hairline bg-soft object-contain"
        />
      )}

      <div className="flex items-center gap-2">
        <Pill tone={article.active ? "ok" : "neutral"}>
          {article.active ? "Active" : "Cancelled"}
        </Pill>
        <Tag>{article.article_code}</Tag>
      </div>

      <Facts>
        <Fact term="Division">
          {termLabel(vocabulary?.divisions, article.division_code)}
        </Fact>
        <Fact term="Base price">{priceSpan(article)}</Fact>
        <Fact term="SKUs">{count(article.sku_count)}</Fact>
        <Fact term="Colorways">{count(article.colours.length)} of 10</Fact>
        <Fact term="Sizes">{count(article.size_codes.length)}</Fact>
        <Fact term="Currency">{article.currency ?? "—"}</Fact>
        <Fact term="Stock unit">{article.stock_unit_code}</Fact>
        <Fact term="Default purchase unit">
          {article.purchase_unit_code ??
            `${article.stock_unit_code} (stock unit)`}
        </Fact>
        <Fact term="Default sales unit">
          {article.sales_unit_code ?? `${article.stock_unit_code} (stock unit)`}
        </Fact>
        <Fact term="Created">{day(article.created_at)}</Fact>
        <Fact term="Version">{article.version}</Fact>
      </Facts>

      <div>
        <SubHead>UoM</SubHead>
        {article.units.length === 0 ? (
          <p className="text-meta text-mute">
            Only ever counted in {article.stock_unit_code}.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {article.units.map((one) => (
              <li key={one.unit_code} className="text-meta text-ink">
                1 {one.unit_code} = {one.factor} {article.stock_unit_code}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <SubHead>Created By</SubHead>
        {article.created_by_session_id === null ? (
          <p className="text-meta text-mute">
            No setup session is on record. This article predates the sessions
            that mint them.
          </p>
        ) : (
          // No dead ends: the delivery that prompted this product is one click
          // away, which is the only route from a thing back to why it exists.
          //
          // To New articles, the page that answers `?setup=` (2026-10-02).
          <AppLink
            to="/master/new-articles"
            sheet={{ key: "setup", value: article.created_by_session_id }}
            className="font-mono text-id text-accent hover:underline"
          >
            {article.created_by_session_id}
          </AppLink>
        )}
      </div>

      <div>
        <SubHead>Tags</SubHead>
        {article.tags.length === 0 ? (
          <p className="text-meta text-mute">Filed under nothing yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {article.tags.map((tag) => (
              <Tag key={tag}>{termLabel(vocabulary?.tags, tag)}</Tag>
            ))}
          </div>
        )}
      </div>

      <div>
        <SubHead aside={`${article.colours.length} of 10 digits`}>
          Colourways
        </SubHead>
        {article.colours.length === 0 ? (
          <p className="text-meta text-mute">
            No colour has been mapped onto a digit, so this article has no SKUs
            to mint.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {article.colours.map((way) => (
              <Colourway
                key={way.colour_digit}
                articleCode={article.article_code}
                digit={way.colour_digit}
                label={way.label}
                code={way.colour_code}
                hex={way.hex_code}
                skus={perDigit.get(way.colour_digit) ?? 0}
              />
            ))}
          </div>
        )}
      </div>

      <div>
        <SubHead>Sizes</SubHead>
        {article.size_codes.length === 0 ? (
          <p className="text-meta text-mute">
            Nothing has been minted in a size yet.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {article.size_codes.map((size) => (
              <Tag key={size}>{size}</Tag>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/// One colour of one article, with its photograph.
///
/// The picture is filed per colourway rather than per SKU because every size of
/// the red shirt is the same red shirt. It is read-only here: the bucket is
/// written from the setup session that minted the article, and a second place
/// to upload the same key is a second place for the two to disagree.
function Colourway({
  articleCode,
  digit,
  label,
  code,
  hex,
  skus,
}: {
  articleCode: string
  digit: string
  label: string
  code: string
  hex: string | null
  skus: number
}) {
  const image = useQuery({
    queryKey: procurementKeys.articleImage(articleCode, digit),
    queryFn: ({ signal }) => articleImage(articleCode, digit, signal),
    // A photograph does not change; a presigned URL expires. Ten minutes sits
    // inside the server's own read TTL, so this is exactly as fresh as the
    // answer it caches.
    staleTime: 10 * 60 * 1000,
  })

  return (
    <div className="flex items-center gap-3 rounded-inner border border-hairline p-2">
      {image.data ? (
        <img
          src={image.data.url}
          alt={label}
          className="size-12 shrink-0 rounded-inner border border-hairline object-cover"
        />
      ) : (
        <span className="grid size-12 shrink-0 place-items-center rounded-inner bg-soft-2 font-mono text-id text-mute">
          {digit}
        </span>
      )}
      <ColourSwatch className="flex-1" hex={hex} label={label} code={code} />
      <span className="shrink-0 text-right text-[0.875rem] text-mute tabular-nums">
        {skus === 0 ? "no SKUs" : `${count(skus)} SKUs`}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------

/// The variants, as they were minted — colour down, size across, a price in
/// every cell.
///
/// The same grid New articles fills in, on the owner's word of 2026-09-28: a
/// list of fifteen SKUs read one line at a time was "which XXLs cost more" as
/// a sum somebody did in their head, and the grid answers it at a glance. The
/// price most SKUs carry reads plain; one that differs is blue, below cost
/// red. The SKU code rides on the chip under a hovered cell, with the markup
/// when the article has one cost to measure it against.
///
/// Every code here is fixed. A SKU is the article's eight digits, the colour's
/// one and the size's two, and it is already encoded into the EPC on the tag
/// sewn into the garment — so this panel reads and never edits.
function Skus({ article }: { article: ArticleDetail }) {
  if (article.skus.length === 0) {
    return (
      <EmptyState>
        Nothing has been minted from this article yet. SKUs are drawn by a setup
        session, together with their serial ranges and their EPCs.
      </EmptyState>
    )
  }

  // Axes from the SKUs themselves, so a SKU minted without a colour or a size
  // still has a row and a column to stand in.
  const colourKey = (sku: ArticleSku) => sku.colour_digit ?? "none"
  const sizeKey = (sku: ArticleSku) => sku.size_code ?? "none"
  const colours = [
    ...new Map(
      [...article.skus]
        .sort((one, two) => colourKey(one).localeCompare(colourKey(two)))
        .map((sku) => [
          colourKey(sku),
          {
            key: colourKey(sku),
            label: sku.colour_label ?? sku.colour_code ?? "No colour",
          },
        ])
    ).values(),
  ]
  const sizes = [
    ...new Map(
      [...article.skus]
        .sort((one, two) => sizeKey(one).localeCompare(sizeKey(two)))
        .map((sku) => [
          sizeKey(sku),
          {
            code: sizeKey(sku),
            label: sku.size_label ?? sku.size_code ?? "One size",
          },
        ])
    ).values(),
  ]
  const at = new Map(
    article.skus.map((sku) => [`${colourKey(sku)}|${sizeKey(sku)}`, sku])
  )

  // The article's price is the one most of its live SKUs carry.
  const tally = new Map<number, number>()
  for (const sku of article.skus)
    if (sku.active && sku.base_price_minor !== null)
      tally.set(
        sku.base_price_minor,
        (tally.get(sku.base_price_minor) ?? 0) + 1
      )
  const base =
    [...tally.entries()].sort((one, two) => two[1] - one[1])[0]?.[0] ?? null
  const differ = article.skus.filter(
    (sku) =>
      sku.active &&
      sku.base_price_minor !== null &&
      sku.base_price_minor !== base
  ).length
  // One cost to measure a markup against, or none: two suppliers at two
  // prices is not a cost, it is a question this panel cannot answer.
  const costs = new Set(
    article.supplier_items
      .map((offer) => offer.unit_price_minor)
      .filter((price): price is number => price !== null)
  )
  const cost = costs.size === 1 ? [...costs][0] : null

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[0.875rem] text-mute">
        {base === null ? (
          "No SKU has a price yet."
        ) : (
          <>
            <span className="font-medium text-ink">{money(base)}</span>
            {cost !== null && <> · {markupFrom(cost, base) || "0"}% markup</>}
            {differ > 0 && (
              <>
                {" "}
                ·{" "}
                <span className="font-medium text-accent">
                  {count(differ)}
                </span>{" "}
                {differ === 1 ? "SKU priced" : "SKUs priced"} differently
              </>
            )}
          </>
        )}
      </p>
      <Matrix
        colours={colours}
        sizes={sizes}
        columnClass="w-[5.25rem]"
        // `group` so the chip answers to this one cell; `relative` so it
        // anchors to it.
        cellProps={() => ({ className: "group relative" })}
        cell={(colour, size) => {
          const sku = at.get(`${colour.key}|${size.code}`)
          if (sku === undefined) return <span className="text-faint">—</span>
          const price = sku.base_price_minor
          return (
            <>
              <span
                className={cn(
                  "text-[0.875rem]",
                  !sku.active
                    ? "text-mute line-through"
                    : price === null
                      ? "text-faint"
                      : cost !== null && price < cost
                        ? "text-bad"
                        : price !== base
                          ? "font-medium text-accent"
                          : "text-ink"
                )}
              >
                {price === null ? "—" : count(price)}
              </span>
              {/* Above the cell, not under it: the last row has no footer
                  beneath it for a chip to hang into, and the grid's box
                  would cut it off. */}
              <span
                aria-hidden
                className="sku-price-pop pointer-events-none absolute right-1 bottom-[calc(100%-0.25rem)] z-10 hidden rounded-[0.3125rem] bg-tooltip px-2 py-0.5 text-[0.875rem] whitespace-nowrap text-on-dark tabular-nums shadow-pop group-hover:block"
              >
                <span className="font-mono">{sku.sku_code}</span>
                {!sku.active
                  ? " · cancelled"
                  : cost !== null && price !== null
                    ? ` · ${(markupFrom(cost, price) || "0").replace(".", ",")}% markup`
                    : ""}
              </span>
            </>
          )
        }}
      />
    </div>
  )
}

/// Who sells this to us, and under what code of their own.
///
/// Goods arrive carrying the supplier's code and never ours, so this join is
/// the only thing that turns a delivery note into one of our articles.
function Suppliers({ article }: { article: ArticleDetail }) {
  const supplierName = useSupplierName()
  if (article.supplier_items.length === 0) {
    return (
      <EmptyState>
        No supplier is on record as offering this article. Until one is linked,
        a delivery of it arrives under a code nothing here recognises.
      </EmptyState>
    )
  }

  return (
    <MiniTable head={["Supplier", { label: "Unit Price", align: "right" }]}>
      {article.supplier_items.map((offer) => (
        <MiniRow key={offer.supplier_item_id}>
          <MiniCell>
            <AppLink
              to="/procurement/suppliers"
              sheet={{ key: "supplier", value: offer.supplier_id }}
              className="block text-[0.875rem] text-accent hover:underline"
            >
              {supplierName(offer.supplier_id, offer.supplier_name)}
            </AppLink>
            {realItemCode(offer.supplier_article_code) && (
              <span className="block font-mono text-[0.875rem] text-mute">
                {offer.supplier_article_code}
              </span>
            )}
          </MiniCell>
          <MiniCell align="right">{money(offer.unit_price_minor)}</MiniCell>
        </MiniRow>
      ))}
    </MiniTable>
  )
}
