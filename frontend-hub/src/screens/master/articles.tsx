import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Search } from "lucide-react"
import { useCallback, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { EmptyState, LoadMore } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { FilterOmnibox } from "@/components/ui/filter-omnibox"
import {
  ChoiceMenu,
  ColumnsMenu,
  DockedFilters,
  ViewPicker,
} from "@/components/ui/list-chrome"
import { useFilterState, type FilterField } from "@/lib/filters"
import { count, money } from "@/lib/format"
import {
  articleKeys,
  articleScopeFromFilters,
  searchArticles,
  type ArticleFacets,
  type ArticleRow,
  type ArticleScope,
  type FacetCount,
} from "@/lib/queries/articles"
import { colourKeys, listColours, type ColourTerm } from "@/lib/queries/colours"
import { catalogueVocabulary, procurementKeys } from "@/lib/queries/procurement"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { ColourSwatch, Swatches } from "@/components/ui/swatch"
import { Thumbnail } from "@/components/ui/thumbnail"
import { ArticleSheet } from "@/screens/master/detail"
import { sizeLabel, sizeSpan, termLabel } from "@/screens/procurement/shared"

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
/// other, which is why the two are one query rather than two screens. The
/// grid is hidden for now (2026-09-29): the page opens as the table, with no
/// switch.
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
          name={row.original.article.name}
          division={row.original.article.division_code}
          className="size-8 shrink-0 rounded-inner border border-hairline"
        />
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium text-ink">
            {row.original.article.name}
          </span>
          <span className="font-mono text-[0.875rem] text-mute">
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
    header: "Price Range",
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
        {row.original.article.active ? "Active" : "Cancelled"}
      </Pill>
    ),
  },
]

export function Articles() {
  /// Which article is open. In the URL rather than in state beside the list,
  /// so a merchandiser can send "look at this one" and so the back button
  /// leaves the article rather than the app.
  const article = useSheet("article")
  /// What was typed. Also in the URL: a filtered catalogue is a thing people
  /// send each other, and a `useState` box cannot be sent.
  const search = useSheet("q")
  /// Which way the master is read. In the URL for the same reason, and absent
  /// rather than `oldest` when nobody has chosen: the plain URL is the plain
  /// catalogue, and one spelling of "no order chosen" is what stops two query
  /// keys standing for the same page.
  const articleOrder = useSheet("articleOrder")

  /// Table only for now: the owner hid the grid (2026-09-29) — 12k articles
  /// are read as rows. The grid code stays so it can come back as a switch.
  const [view] = useState<"grid" | "table">("table")
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
  /// inlined because the field list below is memoised on them — an arrow
  /// rebuilt every render would rebuild every field, and with it the counted
  /// copy, on every keystroke anywhere on the page.
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

  /// The four questions this catalogue can be narrowed by, in the shape the
  /// filter model reads — the same declaration Sourcing makes next door, so a
  /// merchandiser who has learnt one catalogue has learnt both.
  ///
  /// Uncounted here on purpose. The counts arrive in the response, the response
  /// comes from the scope and the scope comes from these clauses, so a field
  /// list carrying counts could not be built before the request it shapes; the
  /// counted copy is assembled below, once there is an answer to count.
  ///
  /// Each operator list is cut to what `GET /api/v1/articles` actually answers:
  /// four repeated positive sets and nothing else. There is no parameter for
  /// "is none of" or "is empty", so offering one would be a chip that narrows
  /// nothing while claiming to.
  ///
  /// No Status field, deliberately, for the reason the scope used to carry in a
  /// comment: a retired article is still a real one — on shelves, in last
  /// season's sales, in somebody's stocktake — and a master-data screen that
  /// hid it would make the catalogue disagree with the shop floor. Status is a
  /// column, not a filter.
  const fields = useMemo<FilterField[]>(
    () => [
      {
        column: "division",
        label: "Division",
        spec: {
          kind: "option",
          format: divisionLabel,
          single: true,
          operators: ["isAnyOf"],
        },
      },
      {
        column: "tag",
        label: "Tag",
        spec: {
          kind: "multi",
          format: tagLabel,
          single: true,
          operators: ["includesAnyOf"],
        },
      },
      // Colour and size filter SKUs while this list is articles, so they mean
      // "articles having at least one SKU in this colour or size". They narrow
      // which articles appear; they never hide the other variants inside a row,
      // because half an article is not an article.
      //
      // `multi` and not `option` for the same reason Tag is: an article is sold
      // in several colours and several sizes at once, and "is navy" would be a
      // chip that lies about a tee sold in five.
      {
        column: "colour",
        label: "Colour",
        spec: {
          kind: "multi",
          format: colourLabel,
          single: true,
          operators: ["includesAnyOf"],
          // The swatch beside the name. Colour is the one facet here that is
          // recognised rather than read — "the navy one" is how somebody
          // describes a garment they are holding — and a list of ticked words
          // throws that away.
          leading: (value) => (
            <ColourSwatch hex={colourTerms.get(value)?.hex_code ?? null} />
          ),
        },
      },
      {
        column: "size",
        label: "Size",
        spec: {
          kind: "multi",
          format: sizeLabelOf,
          single: true,
          operators: ["includesAnyOf"],
        },
      },
    ],
    [divisionLabel, tagLabel, colourLabel, sizeLabelOf, colourTerms]
  )

  /// The clauses, read out of `?f=` rather than out of four `useState` boxes.
  ///
  /// That is the whole point of the move: a facet selection held in component
  /// state cannot be sent to a colleague and does not survive the reload a
  /// shop's browser gets every morning, and "look at this" is exactly what
  /// somebody does with a narrowed catalogue.
  const filters = useFilterState(fields)

  const scope = useMemo<ArticleScope>(
    () => ({
      ...articleScopeFromFilters(filters.filters),
      q: needle === "" ? undefined : needle,
      sort: articleOrder.value === "oldest" ? "oldest" : undefined,
    }),
    [filters.filters, needle, articleOrder.value]
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

  /// The same fields, now carrying the server's counts.
  ///
  /// The number beside a value is the whole affordance of a facet: it is how
  /// somebody decides whether a filter is worth pressing before they press it.
  /// These are counted over everything the SEARCH matches rather than over the
  /// current selection, which is what stops ticking one division making the
  /// others read zero — a list that only describes what you have already chosen
  /// cannot answer "what if I looked at kids instead".
  const counted = useMemo<FilterField[]>(() => {
    const source: Record<string, readonly FacetCount[] | undefined> = {
      division: facets?.divisions,
      tag: facets?.tags,
      colour: facets?.colours,
      size: facets?.sizes,
    }
    return fields.map((field) => {
      const values = source[field.column]
      return values
        ? { ...field, spec: { ...field.spec, counted: values } }
        : field
    })
  }, [fields, facets])

  /// Whether anything is narrowing the list, which is a different question
  /// from whether the list is empty: "there are none" and "none match what you
  /// asked for" have different fixes.
  const filtered = needle !== "" || filters.filters.length > 0

  return (
    <PageContent>
      <PageHeader
        title="Articles"
        sub="Every article the company sells, with the colourways, sizes and SKUs minted against it."
      />

      {/* Two columns from 1440 up: the catalogue, and the facets standing
          beside it.

          The facets stood in a 15.5rem column on the LEFT until 2026-09-12,
          which made the screen read as three layers of chrome before any work —
          rail, module sidebar, filters, and only then the catalogue. Then they
          spent a day inside `<Sheet>`, behind a button, which cost a click
          before a merchandiser could see what else the catalogue holds.

          This is the shape Sourcing already wears, and it is the right one for
          the same reason: a catalogue is BROWSED, not queried. Somebody arrives
          without knowing what they want, and the counted facets are how they
          discover that the thing they are after is filed under a division they
          had not thought of — which a panel they have to open first cannot do.
          Below 1440 it is the same model, reached from the omnibox. */}
      <div className="grid min-w-0 items-start gap-5 dock:grid-cols-[minmax(0,1fr)_16rem]">
        {/* `@container` on the column the cards are laid out in, not on the
            page: this column's width is whatever the rail, the sidebar and the
            filter panel leave it, and a `md:` breakpoint reading the VIEWPORT
            would put four cards in the space for three. */}
        <div className="@container flex min-w-0 flex-col">
          {/* One line, the width of the grid, carrying everything that acts
              on it — the same line the order book wears, in the same order:
              what narrows it at the left, what orders and shapes it in the
              middle, which view it is at the right.

              It was a full-width pill above a second row of controls until
              2026-09-13. Two rows of chrome over a catalogue is one row too
              many, and the owner said so: the order book says all of this in
              one line, and this screen had no reason to be louder.

              The box is one box for the identifiers, because somebody holding
              a garment does not know which of them they are holding: the swing
              tag has a QR, the label has a SKU and the carton has the
              supplier's own code. Asking them to pick the right box first is
              asking them for the answer. The server does the matching, so all
              this sends is `q`.

              EPC is not named, on the owner's instruction of 2026-09-12,
              though the server still accepts one. An EPC identifies a PHYSICAL
              UNIT — one tag sewn into one garment — and this screen is the
              product definition, where the honest answer to a scan is a whole
              article rather than the piece in somebody's hand. That question
              belongs to Inventory and to global search. */}
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {/* The plain box, where the panel beside it is carrying the
                filters. Below 1440 the panel is gone and the omnibox below
                takes both jobs, so only one of the two is ever on screen. */}
            <span className="relative mr-auto hidden dock:block">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-line-ico" />
              <input
                value={search.value ?? ""}
                onChange={(event) =>
                  event.target.value
                    ? search.open(event.target.value)
                    : search.close()
                }
                aria-label="Search the article master — article code, SKU, name, QR payload or the supplier's own code"
                className="h-control w-64 rounded-inner border border-hairline-2 bg-canvas pr-2.5 pl-8 text-[0.875rem] text-ink shadow-soft outline-none placeholder:text-body focus:border-accent"
              />
            </span>
            <span className="mr-auto text-[0.875rem] text-body dock:mr-0">
              <b className="font-medium text-ink">{count(articles.length)}</b>{" "}
              {filtered
                ? catalogue.hasNextPage
                  ? "shown, more to load"
                  : articles.length === 1
                    ? "article matches"
                    : "articles match"
                : `of ${count(searchable)} shown`}
            </span>
            {/* The order the SERVER reads the master in, so it applies to the
                whole catalogue rather than to the pages that happen to have
                loaded — and to both views, because it is a property of the
                list and not of the table.
            
                It replaces a `<SortMenu>` that was over the table only. That
                one reads the TanStack columns, which can only order what is in
                hand; on a catalogue paged sixty at a time, "sort by price"
                meant "sort the first sixty by price", which is a control that
                answers a different question from the one it is asked. The
                headers still sort what is loaded, and now there is something
                beside them that sorts the whole thing. */}
            <ChoiceMenu
              heading="Order"
              value={articleOrder.value ?? null}
              options={ORDERS}
              onChange={(next) =>
                next ? articleOrder.open(next) : articleOrder.close()
              }
            />
            {/* Only over the table. A grid of photographs has no columns to
                hide, and a menu that can only disappoint is worse than no
                menu. */}
            {view === "table" && <ColumnsMenu table={table} />}
            <ViewPicker model={filters} id="articles" all="All articles" />
          </div>

          {/* The same model as the panel, drawn as one line, for the widths
              where the panel is not on screen. Searching and filtering are one
              thought — "kaus, kidswear, size M" is a sentence somebody says in
              one breath — and this is the control that lets them say it
              without a column to spare. */}
          <FilterOmnibox
            model={{ ...filters, fields: counted }}
            text={search.value ?? undefined}
            onText={(next) => (next ? search.open(next) : search.close())}
            className="mb-3 dock:hidden"
          />

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
                        more={catalogue}
                        className="max-h-[calc(100vh-22rem)]"
                      />
                    </Card>
                  )}

                  {/* The grid scrolls with the page, so its foot is watched
                      here; the table scrolls itself and watches its own. */}
                  {view === "grid" && (
                    <LoadMore query={catalogue} className="mt-6" />
                  )}
                </>
              ),
          })}
        </div>

        {/* The facets, standing beside the catalogue rather than behind a
            button — the same panel the order book, the supplier book and
            Sourcing wear, so somebody who has learnt one list has learnt all of
            them. `<DockedFilters>` carries its own clause editor and field
            picker, which is where an operator is changed and where somebody
            chooses which of the four questions this panel asks at all. */}
        <DockedFilters
          model={{ ...filters, fields: counted }}
          kpis={catalogueKpis(searchable, facets)}
          id="articles"
          subject="Article"
          className="hidden dock:flex"
        />
      </div>

      <ArticleSheet
        articleCode={article.value ?? null}
        open={article.isOpen}
        onClose={article.close}
      />
    </PageContent>
  )
}

/// The two orders the master can be read in.
///
/// `null` is newest first. The absent value carries the DEFAULT rather than
/// the historical order, so there is still one spelling of "no order chosen"
/// and the plain URL is still the plain catalogue — the catalogue just leads
/// with what was minted last, which is what a person opening this screen
/// without searching came to see.
///
/// "Newest" is `created_at` and not the article code, which matters here: the
/// codes this server mints do run in order, but the seeded and legacy articles
/// carry hand-written ones — `ART-TSHIRT` — and every one of them sorts above
/// `00000001`. Ordering by code would have put the oldest rows in the company
/// at the top of a list labelled Newest.
const ORDERS = [
  { value: null, label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
]

/// Two figures about the catalogue being browsed, above the controls that
/// narrow it.
///
/// Both are the server's own, counted over everything the SEARCH matches and
/// deliberately not over the current selection — the same numbers the facet
/// lists are drawn from, so a tile and the rows under it cannot disagree.
function catalogueKpis(searchable: number, facets: ArticleFacets | undefined) {
  if (facets === undefined) return undefined
  return [
    { label: "Articles", value: count(searchable) },
    {
      label: "Divisions",
      value: count(facets.divisions.length),
      note: "Divisions something the search matches is filed under.",
    },
  ]
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
        name={article.name}
        division={article.division_code}
        fallback="No photograph"
        className="h-[9.875rem] w-full"
      >
        {/* The division rides on the photograph: it is what the picture IS, so
            it belongs with the picture rather than in a list of facts below
            it. */}
        {article.division_code !== null && (
          <span className="absolute top-2.5 left-2.5 inline-flex items-center rounded-full bg-canvas/95 px-2 py-[0.1875rem] text-[0.875rem] font-semibold text-ink shadow-[0_1px_3px_rgba(20,20,25,.1)] backdrop-blur-[5px]">
            {row.divisionLabel}
          </span>
        )}
        {/* Retired is said on the picture too, and only when true. An "Active"
            badge on every card would be a badge that means nothing; this one
            is a warning that the article is no longer being sold, on the half
            of the card somebody actually looks at. */}
        {!article.active && (
          <span className="absolute top-2.5 right-2.5">
            <Pill tone="neutral">Cancelled</Pill>
          </span>
        )}
      </Thumbnail>

      <div className="px-[0.9375rem] pt-3 pb-[0.875rem]">
        <div className="truncate text-[0.875rem] font-medium text-ink">
          {article.name}
        </div>
        <div className="mt-[0.1875rem] truncate font-mono text-[0.875rem] text-mute">
          {article.article_code}
        </div>

        {/* Colours and sizes on one line: together they are the sentence
            "what this comes in", and splitting them over two rows makes a card
            taller for no more meaning. */}
        <div className="mt-2.5 flex items-center gap-2">
          <Swatches colours={article.colours} cap={5} />
          <span className="min-w-0 flex-1 truncate text-right text-[0.875rem] text-body">
            {row.sizes}
          </span>
        </div>

        <div className="mt-2 flex items-baseline justify-between gap-2">
          <span className="truncate text-[0.875rem] font-semibold text-ink tabular-nums">
            {priceSpan(article)}
          </span>
          <span className="shrink-0 text-[0.875rem] text-mute tabular-nums">
            {count(article.sku_count)} SKU
          </span>
        </div>
      </div>
    </button>
  )
}
