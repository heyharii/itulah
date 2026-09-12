import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { LayoutGrid, ListFilter, Rows3, Search, X } from "lucide-react"
import { useCallback, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { CHIP } from "@/lib/filter-chrome"
import { count, money } from "@/lib/format"
import {
  articleKeys,
  searchArticles,
  type ArticleRow,
  type ArticleScope,
} from "@/lib/queries/articles"
import { colourKeys, listColours, type ColourTerm } from "@/lib/queries/colours"
import { catalogueVocabulary, procurementKeys } from "@/lib/queries/procurement"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { FacetGroup } from "@/components/ui/facets"
import { ColourSwatch, Swatches } from "@/components/ui/swatch"
import { Thumbnail } from "@/components/ui/thumbnail"
import { ArticleSheet } from "@/screens/master/detail"
import {
  sizeLabel,
  sizeSpan,
  termLabel,
  toggle,
} from "@/screens/procurement/shared"

/// The master product catalogue, read as itself.
///
/// Until this screen there was nowhere in the app to see an article whole. The
/// nearest thing was Commercial's price list, which is a pricing document that
/// happens to name products: it always carries a company price, caps at 500
/// rows and cannot be asked about a division or a tag. So "what do we sell"
/// was answered by reading a price list and ignoring half of it, and the
/// colourways and sizes an article actually comes in were not on the page at
/// all.
///
/// Two views over one dataset, because two different people arrive here. A
/// merchandiser who does not yet know what they want needs photographs, and a
/// grid is the only shape that lets a garment catch the eye; whoever is
/// checking that everything is priced and every colourway has SKUs needs the
/// numbers in columns they can compare down. Neither is a decoration of the
/// other, which is why the toggle is a `Segmented` over one query rather than
/// two screens.
///
/// The filters are counted by the server over everything the SEARCH matches —
/// never over the current facet selection. Choosing Menswear must not make the
/// other divisions read zero: the facet list is how somebody sees what else is
/// in the catalogue, and a list that only describes the current selection
/// cannot answer "what if I looked at kids instead".

/// The floor price across an article's SKUs.
///
/// One number when every SKU agrees, which is the usual case — a range that
/// reads "Rp 89.000 – Rp 89.000" is noise pretending to be information. Null
/// stays an em dash rather than becoming zero: nothing priced is not a price
/// of nothing, and a catalogue that draws Rp 0 invites somebody to sell at it.
function priceSpan(row: ArticleRow): string {
  const { base_price_min_minor: low, base_price_max_minor: high } = row
  if (low === null && high === null) return "—"
  if (low === null || high === null) return money(low ?? high)
  if (low === high) return money(low)
  // The currency once, the way every other money range in this app is written
  // — "Rp 229.000 – Rp 249.000" spends a third of a narrow column repeating a
  // symbol that was never in question.
  return `${money(low)}–${money(high).replace(/^\D+/, "")}`
}

/// An article with the words already looked up.
///
/// The division arrives as a code and is read as a label, and a column has to
/// sort by what is on the screen — sorting `MENSWEAR` and `KIDS` alphabetically
/// puts them in an order nobody reading "Menswear" and "Kids" can predict. So
/// the join happens once, here, rather than inside an accessor that would
/// re-run per row per render.
interface CatalogueRow {
  readonly article: ArticleRow
  readonly divisionLabel: string
  /// "XS–XXL", already read out of the size vocabulary.
  ///
  /// On the row rather than looked up in the cell for the same reason the
  /// division label is: a column sorts by what is on the screen, and an
  /// accessor doing the lookup would redo it per row per render. It replaces a
  /// map transcribed from the `size_code` seed, which read `21` for any size
  /// added to the table after it was written — the comment above it said so,
  /// and said this was what would replace it.
  readonly sizes: string
}

const columns: ColumnDef<TableSetup, CatalogueRow>[] = [
  {
    id: "article",
    accessorFn: (row) => `${row.article.name} ${row.article.article_code}`,
    header: "Article",
    size: 300,
    cell: ({ row }) => (
      <span className="flex items-center gap-2.5">
        <Thumbnail
          url={row.original.article.image_url}
          className="size-8 shrink-0 rounded-inner border border-hairline"
        />
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium text-ink">
            {row.original.article.name}
          </span>
          <span className="font-mono text-[0.65625rem] text-mute">
            {row.original.article.article_code}
          </span>
        </span>
      </span>
    ),
  },
  {
    id: "division",
    accessorFn: (row) => row.divisionLabel,
    header: "Division",
    size: 150,
    // Empty rather than an em dash in the accessor, so unfiled articles sort
    // together at one end instead of under D. The dash is drawn by the cell.
    cell: ({ row }) =>
      row.original.article.division_code === null ? (
        <span className="text-mute">—</span>
      ) : (
        <Tag>{row.original.divisionLabel}</Tag>
      ),
  },
  {
    id: "colours",
    // Sorted by how many, not by which: "which colours" has no order, and the
    // question a merchandiser actually sorts on is "what only comes in one".
    accessorFn: (row) => row.article.colours.length,
    header: "Colours",
    size: 150,
    cell: ({ row }) => <Swatches colours={row.original.article.colours} />,
  },
  {
    id: "sizes",
    accessorFn: (row) => row.article.size_codes.length,
    header: "Sizes",
    size: 140,
    cell: ({ row }) => row.original.sizes,
  },
  {
    id: "skus",
    accessorFn: (row) => row.article.sku_count,
    header: "SKUs",
    size: 90,
    meta: { align: "right" },
    // Colourways times sizes, in principle. Where it is less, somebody stopped
    // half way through a setup session — which is the thing this column is
    // sorted on to find.
    cell: ({ row }) => count(row.original.article.sku_count),
  },
  {
    id: "price",
    accessorFn: (row) => row.article.base_price_min_minor ?? -1,
    header: "Price range",
    size: 190,
    meta: { align: "right" },
    // `-1` rather than null in the accessor: unpriced articles are what
    // somebody sorting by price is usually looking for, and a null sorts
    // wherever the comparator happens to put it.
    cell: ({ row }) => priceSpan(row.original.article),
  },
  {
    id: "status",
    accessorFn: (row) => row.article.active,
    header: "Status",
    size: 110,
    cell: ({ row }) => (
      <Pill tone={row.original.article.active ? "ok" : "neutral"}>
        {row.original.article.active ? "Active" : "Retired"}
      </Pill>
    ),
  },
]

/// One facet that is currently on, as the chip row and the trigger both read
/// it. `leading` is the colour swatch and nothing else has one.
interface ChosenFacet {
  readonly key: string
  readonly label: string
  readonly leading?: React.ReactNode
  readonly drop: () => void
}

export function Articles() {
  /// Which article is open. In the URL rather than in state beside the list,
  /// so a merchandiser can send "look at this one" and so the back button
  /// leaves the article rather than the app.
  const article = useSheet("article")
  /// What was typed. Also in the URL: a filtered catalogue is a thing people
  /// send each other, and a `useState` box cannot be sent.
  const search = useSheet("q")

  const [view, setView] = useState<"grid" | "table">("grid")
  const [divisions, setDivisions] = useState<readonly string[]>([])
  const [tags, setTags] = useState<readonly string[]>([])
  const [sizes, setSizes] = useState<readonly string[]>([])
  const [colours, setColours] = useState<readonly string[]>([])
  const [sorting, setSorting] = useState<SortingState>([])

  const needle = (search.value ?? "").trim()

  const vocabulary = useQuery({
    queryKey: procurementKeys.vocabulary(),
    queryFn: ({ signal }) => catalogueVocabulary(signal),
    // The words the catalogue may be described with change when somebody edits
    // the vocabulary table, which is roughly never.
    staleTime: 30 * 60 * 1000,
  })

  /// The colour facets come back as codes, because that is what the filter
  /// sends. A person reads a name and recognises a swatch, so the master is
  /// joined to the counts here — once — rather than asking the list endpoint
  /// to repeat a hundred labels on every page.
  const master = useQuery({
    queryKey: colourKeys.list(),
    queryFn: ({ signal }) => listColours(signal),
    staleTime: 30 * 60 * 1000,
  })
  const colourTerms = useMemo(
    () =>
      new Map<string, ColourTerm>(
        (master.data?.colours ?? []).map((term) => [term.code, term])
      ),
    [master.data]
  )

  /// How each facet's codes are read out loud. Held as callbacks rather than
  /// inlined because `<FacetGroup>` memoises its sifting on them — an arrow
  /// rebuilt every render would re-filter the colour master on every keystroke
  /// anywhere on the page.
  const divisionLabel = useCallback(
    (code: string) => termLabel(vocabulary.data?.divisions, code),
    [vocabulary.data]
  )
  const tagLabel = useCallback(
    (code: string) => termLabel(vocabulary.data?.tags, code),
    [vocabulary.data]
  )
  const colourLabel = useCallback(
    (code: string) => colourTerms.get(code)?.label ?? code,
    [colourTerms]
  )
  const sizeLabelOf = useCallback(
    (code: string) => sizeLabel(vocabulary.data?.sizes, code),
    [vocabulary.data]
  )

  const scope = useMemo<ArticleScope>(
    () => ({
      q: needle === "" ? undefined : needle,
      divisionCodes: divisions.length === 0 ? undefined : divisions,
      tagCodes: tags.length === 0 ? undefined : tags,
      // Colour and size filter SKUs while this list is articles, so they mean
      // "articles having at least one SKU in this colour or size". They narrow
      // which articles appear; they never hide the other variants inside a row,
      // because half an article is not an article.
      sizeCodes: sizes.length === 0 ? undefined : sizes,
      colourCodes: colours.length === 0 ? undefined : colours,
      // No status filter, deliberately. A retired article is still a real one —
      // it is on shelves, in last season's sales and in somebody's stocktake —
      // and a master-data screen that hid it would make the catalogue disagree
      // with the shop floor. Status is a column, not a filter.
    }),
    [needle, divisions, tags, sizes, colours]
  )

  const catalogue = useInfiniteQuery({
    queryKey: articleKeys.list(scope),
    queryFn: ({ pageParam, signal }) =>
      searchArticles({ ...scope, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })

  // Append-only: the list grows as more is asked for, and every article
  // fetched stays in the model. Nothing is sliced away to make it look fast.
  const articles = useMemo(
    () => catalogue.data?.pages.flatMap((page) => page.items) ?? [],
    [catalogue.data]
  )
  // From the first page. Every page reports the same totals, so taking the
  // first is what stops the counts flickering as more pages arrive.
  const facets = catalogue.data?.pages[0]?.facets
  /// How many articles the SEARCH matches — not how many the facets do. The
  /// server computes this from the words alone, so saying "40 of 2.810" with
  /// three facets on would claim a number nobody computed.
  const searchable = catalogue.data?.pages[0]?.total ?? 0

  const rows = useMemo<CatalogueRow[]>(
    () =>
      articles.map((one) => ({
        article: one,
        divisionLabel:
          one.division_code === null
            ? ""
            : termLabel(vocabulary.data?.divisions, one.division_code),
        sizes: sizeSpan(vocabulary.data?.sizes, one.size_codes),
      })),
    [articles, vocabulary.data]
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: CatalogueRow) => row.article.article_code,
        state: { sorting },
        onSortingChange: setSorting,
      }),
      [rows, sorting]
    )
  )

  const filtered =
    needle !== "" ||
    divisions.length > 0 ||
    tags.length > 0 ||
    sizes.length > 0 ||
    colours.length > 0

  function clear() {
    setDivisions([])
    setTags([])
    setSizes([])
    setColours([])
    search.close()
  }

  /// Open or shut in the URL, like every other panel in this app — and the
  /// same `?filters=` flag the tables elsewhere use, so a person who has
  /// learnt one has learnt all of them.
  const panel = useSheet("filters")

  /// What is currently narrowing the list, as one flat row of chips.
  ///
  /// Built here rather than inside the chip row so the count on the trigger
  /// and the chips above the results cannot disagree — they are the same
  /// array, read twice.
  const chosen = useMemo<ChosenFacet[]>(
    () => [
      ...divisions.map((code) => ({
        key: `division:${code}`,
        label: divisionLabel(code),
        drop: () => setDivisions((was) => was.filter((one) => one !== code)),
      })),
      ...tags.map((code) => ({
        key: `tag:${code}`,
        label: tagLabel(code),
        drop: () => setTags((was) => was.filter((one) => one !== code)),
      })),
      ...sizes.map((code) => ({
        key: `size:${code}`,
        // Prefixed, because "M" on its own beside a division and a tag reads
        // as a word rather than as a size.
        label: `Size ${sizeLabelOf(code)}`,
        drop: () => setSizes((was) => was.filter((one) => one !== code)),
      })),
      ...colours.map((code) => ({
        key: `colour:${code}`,
        label: colourLabel(code),
        leading: <ColourSwatch hex={colourTerms.get(code)?.hex_code ?? null} />,
        drop: () => setColours((was) => was.filter((one) => one !== code)),
      })),
    ],
    [
      divisions,
      tags,
      sizes,
      colours,
      divisionLabel,
      tagLabel,
      sizeLabelOf,
      colourLabel,
      colourTerms,
    ]
  )

  return (
    /* One column, not two.
    
       The facets stood in a 15.5rem column on the left until 2026-09-12, which
       made the screen read as three layers of chrome before any work: rail,
       module sidebar, filters, and only then the catalogue. The owner's
       objection is the right one — a filter is not navigation. It does not say
       where you are; it says which part of what you are looking at you want to
       see, and that belongs on the side the rest of this app already puts
       contextual things on.
    
       So the facets moved into the panel every other list in this app uses:
       `<Sheet>`, which at 96rem and up docks a 27.5rem column on the RIGHT and
       lets the shell narrow the page into what is left, and below that arrives
       over the page like any other sheet. Nothing here re-decides that
       boundary, and the panel is wider than the column it replaces — the
       colour master and a nineteen-tag vocabulary were the two things the old
       212-and-then-248px column could never really show. */
    <div className="@container">
      <PageContent>
        <PageHeader
          title="Articles"
          sub="Every article the company sells, with the colourways, sizes and SKUs minted against it."
        />

        {/* The search sits over the list, not in the filter column: it asks a
              different question. The facets narrow what is already being
              shown; this changes what is being looked for.

              One box for the identifiers, because somebody holding a garment
              does not know which of them they are holding: the swing tag has a
              QR, the label has a SKU and the carton has the supplier's own
              code. Asking them to pick the right box first is asking them for
              the answer. The server does the matching, so all this sends is
              `q`.

              EPC is not named, on the owner's instruction of 2026-09-12,
              though the server still accepts one. An EPC identifies a PHYSICAL
              UNIT — one tag sewn into one garment — and this screen is the
              product definition, where the honest answer to a scan is a whole
              article rather than the piece in somebody's hand. That question
              belongs to Inventory and to global search. */}
        <div className="relative mb-4">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-line-ico" />
          <input
            value={search.value ?? ""}
            onChange={(event) =>
              event.target.value === ""
                ? search.close()
                : search.open(event.target.value)
            }
            placeholder="Search article, SKU, name, QR or supplier code"
            aria-label="Search the article master"
            className="h-10 w-full rounded-full border border-transparent bg-soft-2 pr-4 pl-10 text-[0.875rem] text-ink transition-colors outline-none placeholder:text-mute hover:border-hairline-2 hover:bg-soft-3"
          />
        </div>

        <Toolbar>
          <Segmented
            options={[
              {
                value: "grid",
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <LayoutGrid className="size-3.5" />
                    Grid
                  </span>
                ),
              },
              {
                value: "table",
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <Rows3 className="size-3.5" />
                    Table
                  </span>
                ),
              },
            ]}
            value={view}
            onChange={setView}
          />
          {/* The way to the facets, and how many are on.
            
                A chip rather than a permanent column: on a catalogue of five
                hundred articles most people are looking rather than
                narrowing, and the count is what tells somebody who IS
                narrowing that the panel they shut is still doing something. */}
          <button
            type="button"
            onClick={() => (panel.isOpen ? panel.close() : panel.open(true))}
            aria-expanded={panel.isOpen}
            className={cn(
              CHIP,
              "items-center gap-1.5 border border-dashed border-hairline-strong px-2.5 text-body transition-colors hover:bg-soft-2 hover:text-ink",
              // Pressed-looking while the panel stands, so the docked column
              // has a visible origin on the screen it belongs to.
              panel.isOpen && "border-solid bg-soft-2 text-ink"
            )}
          >
            <ListFilter className="size-3.5" />
            Filters
            {chosen.length > 0 && (
              <span className="text-mute tabular-nums">{chosen.length}</span>
            )}
          </button>
          <Toolbar.Spacer />
          <span className="text-[0.84375rem] text-body">
            <b className="font-medium text-ink">{count(articles.length)}</b>{" "}
            {filtered
              ? catalogue.hasNextPage
                ? "shown, more to load"
                : articles.length === 1
                  ? "article matches"
                  : "articles match"
              : `of ${count(searchable)} shown`}
          </span>
        </Toolbar>

        {/* What is narrowing the list, said above the list itself.
          
              The panel is dismissible and the chips are not: a filtered list
              with nothing on screen to say so is how somebody reads a short
              list as the whole catalogue and then reports that half the
              articles are missing. Every chip drops its own facet; the word at
              the end drops the lot, search included. */}
        {chosen.length > 0 && (
          <div className="mb-3.5 flex flex-wrap items-center gap-[0.4375rem]">
            {chosen.map((one) => (
              <button
                key={one.key}
                type="button"
                onClick={one.drop}
                aria-label={`Stop filtering by ${one.label}`}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-hairline-2 bg-soft-2 pr-2 pl-2.5 text-meta font-medium text-ink transition-colors hover:bg-hairline"
              >
                {one.leading}
                {one.label}
                <X className="size-3.5 text-line-ico" />
              </button>
            ))}
            <button
              type="button"
              onClick={clear}
              className="px-1 text-meta font-medium text-body transition-colors hover:text-ink"
            >
              Clear all
            </button>
          </div>
        )}

        {queryState(catalogue, {
          loading: "Reading the article master…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {filtered
                  ? "No article matches that. Widen the filters, or search the whole master."
                  : "No article has been minted yet. Articles are created by an article setup session in Procurement."}
              </EmptyState>
            ) : (
              <>
                {view === "grid" ? (
                  /* Container queries, not viewport ones. This column's
                       width is whatever the rail, the sidebar and — from 96rem
                       up — the docked filter panel leave it, so a `md:`
                       breakpoint reading the viewport puts three cards in a
                       space that fits two and truncates every name. It is also
                       what makes opening the panel re-lay the grid rather than
                       squeeze it. */
                  <div className="grid grid-cols-1 gap-[1.125rem] @sm:grid-cols-2 @2xl:grid-cols-3 @5xl:grid-cols-4">
                    {rows.map((row) => (
                      <ArticleCard
                        key={row.article.article_code}
                        row={row}
                        onOpen={() => article.open(row.article.article_code)}
                      />
                    ))}
                  </div>
                ) : (
                  <Card className="overflow-hidden">
                    {/* Sorting is over what has been loaded, not over the
                          whole catalogue: the cursor is keyed on article code,
                          so a sort by price can only order the pages already
                          fetched. That is honest as long as the count above
                          says how many are shown — which is why it does. */}
                    <DataTable<CatalogueRow>
                      table={table}
                      onRowClick={(row) =>
                        article.open(row.article.article_code)
                      }
                      isSelected={(row) =>
                        row.article.article_code === article.value
                      }
                      className="max-h-[calc(100vh-22rem)]"
                    />
                  </Card>
                )}

                {catalogue.hasNextPage && (
                  <div className="mt-6 flex justify-center">
                    <Button
                      onClick={() => void catalogue.fetchNextPage()}
                      disabled={catalogue.isFetchingNextPage}
                    >
                      {catalogue.isFetchingNextPage ? "Fetching…" : "Show more"}
                    </Button>
                  </div>
                )}
              </>
            ),
        })}
      </PageContent>

      {/* The facets, in the panel this app opens everything else in.
      
          Docked on the right from 96rem up and over the page below that —
          `<Sheet>` decides which, and `lib/layout.ts` decides where the line
          is. Mounted whatever the state of the flag, because a sheet that only
          exists once its button has been pressed is a `?filters=1` link that
          works for the person who clicked it and nobody else. */}
      <Sheet
        open={panel.isOpen}
        onOpenChange={(open) => {
          if (!open) panel.close()
        }}
        title="Filters"
        // Pinned to the foot rather than sitting at the end of the stack: the
        // fullest panel is exactly the one where it would have scrolled out of
        // sight, and a panel with four facets ticked is when somebody most
        // wants to drop the lot.
        footer={
          chosen.length > 0 ? (
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-meta text-mute">
                {chosen.length === 1
                  ? "1 filter is narrowing this list"
                  : `${chosen.length} filters are narrowing this list`}
              </span>
              <Button variant="quiet" onClick={clear}>
                Clear all
              </Button>
            </div>
          ) : undefined
        }
      >
        <FacetGroup
          label="Division"
          values={facets?.divisions}
          selected={divisions}
          onToggle={(value) => setDivisions(toggle(divisions, value))}
          onClear={() => setDivisions([])}
          labelOf={divisionLabel}
        />

        <FacetGroup
          label="Tag"
          shape="chip"
          values={facets?.tags}
          selected={tags}
          onToggle={(value) => setTags(toggle(tags, value))}
          onClear={() => setTags([])}
          labelOf={tagLabel}
        />

        {/* Sizes are global — `03` is M on every article in the company — so
            this is one closed list rather than a set gathered from whatever
            rows came back. That is the whole reason a size filter can be
            trusted across the catalogue. */}
        <FacetGroup
          label="Size"
          values={facets?.sizes}
          selected={sizes}
          onToggle={(value) => setSizes(toggle(sizes, value))}
          onClear={() => setSizes([])}
          labelOf={sizeLabelOf}
        />

        {/* Chips with the colour on them, not a checkbox list. Colour is the
            one facet here that is recognised rather than read — "the navy one"
            is how somebody describes a garment they are holding — and a column
            of ticked words throws that away. */}
        <FacetGroup
          label="Colour"
          shape="chip"
          values={facets?.colours}
          selected={colours}
          onToggle={(value) => setColours(toggle(colours, value))}
          onClear={() => setColours([])}
          labelOf={colourLabel}
          leadingOf={(value) => (
            <ColourSwatch hex={colourTerms.get(value)?.hex_code ?? null} />
          )}
        />
      </Sheet>

      <ArticleSheet
        articleCode={article.value ?? null}
        open={article.isOpen}
        onClose={article.close}
      />
    </div>
  )
}

/// One article, as somebody sees it before they know they want it.
///
/// The photograph leads because that is what a garment IS — a merchandiser
/// scanning for "the striped one" reads pictures, not eight-digit codes. The
/// code is still on the card, small and in mono, because it is what they will
/// type into everything else once they have found it.
function ArticleCard({
  row,
  onOpen,
}: {
  row: CatalogueRow
  onOpen: () => void
}) {
  const { article } = row

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={article.name}
      className="block overflow-hidden rounded-card border border-hairline bg-canvas text-left shadow-soft transition duration-150 hover:-translate-y-0.5 hover:shadow-pop"
    >
      <Thumbnail
        url={article.image_url}
        fallback="No photograph"
        className="h-[9.875rem] w-full"
      >
        {/* The division rides on the photograph: it is what the picture IS, so
            it belongs with the picture rather than in a list of facts below
            it. */}
        {article.division_code !== null && (
          <span className="absolute top-2.5 left-2.5 inline-flex items-center rounded-full bg-canvas/95 px-2 py-[0.1875rem] text-[0.625rem] font-semibold text-ink shadow-[0_1px_3px_rgba(20,20,25,.1)] backdrop-blur-[5px]">
            {row.divisionLabel}
          </span>
        )}
        {/* Retired is said on the picture too, and only when true. An "Active"
            badge on every card would be a badge that means nothing; this one
            is a warning that the article is no longer being sold, on the half
            of the card somebody actually looks at. */}
        {!article.active && (
          <span className="absolute top-2.5 right-2.5">
            <Pill tone="neutral">Retired</Pill>
          </span>
        )}
      </Thumbnail>

      <div className="px-[0.9375rem] pt-3 pb-[0.875rem]">
        <div className="truncate text-[0.875rem] font-medium text-ink">
          {article.name}
        </div>
        <div className="mt-[0.1875rem] truncate font-mono text-[0.6875rem] text-mute">
          {article.article_code}
        </div>

        {/* Colours and sizes on one line: together they are the sentence
            "what this comes in", and splitting them over two rows makes a card
            taller for no more meaning. */}
        <div className="mt-2.5 flex items-center gap-2">
          <Swatches colours={article.colours} cap={5} />
          <span className="min-w-0 flex-1 truncate text-right text-[0.71875rem] text-body">
            {row.sizes}
          </span>
        </div>

        <div className="mt-2 flex items-baseline justify-between gap-2">
          <span className="truncate text-[0.875rem] font-semibold text-ink tabular-nums">
            {priceSpan(article)}
          </span>
          <span className="shrink-0 text-[0.6875rem] text-mute tabular-nums">
            {count(article.sku_count)} SKU
          </span>
        </div>
      </div>
    </button>
  )
}
