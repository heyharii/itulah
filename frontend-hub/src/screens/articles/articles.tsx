import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { LayoutGrid, ListChecks, Rows3, Search } from "lucide-react"
import { useCallback, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
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
import { useSheet } from "@/lib/sheets"
import { useAwaitingIdentity } from "@/screens/articles/queue"
import { SetupSheets } from "@/screens/articles/setups"
import { tableSetup, type TableSetup } from "@/lib/table"
import { FacetGroup } from "@/components/ui/facets"
import { ColourSwatch, Swatches, Thumbnail } from "@/screens/articles/shared"
import { ArticleSheet } from "@/screens/articles/detail"
import { termLabel, toggle } from "@/screens/procurement/shared"

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

/// `03` → "M", using the global size table.
///
/// Sizes are company-wide — `03` is M on every article — but no endpoint lists
/// them, so this is transcribed from the `size_code` seed in
/// `0022_article_master_setup.sql` the same way `lib/queries/articles.ts`
/// transcribes the Rust structs: deliberately, and until there is a real
/// vocabulary call to replace it.
///
/// A code with no entry falls back to the code rather than to a blank. A size
/// added to the table after this was written still filters correctly; it just
/// reads as `21` until somebody adds the word, which is a cosmetic gap rather
/// than a facet that silently does nothing.
const SIZE_LABEL: Readonly<Record<string, string>> = {
  "00": "No size",
  "01": "XS",
  "02": "S",
  "03": "M",
  "04": "L",
  "05": "XL",
  "06": "XXL",
  "07": "XXXL",
  "08": "One size",
  "11": "EU 37",
  "12": "EU 38",
  "13": "EU 39",
  "14": "EU 40",
  "15": "EU 41",
}

function sizeLabel(code: string): string {
  return SIZE_LABEL[code] ?? code
}

/// "XS–XXL", or the one size when there is only one.
///
/// Ends rather than the whole list: an article carrying eight sizes would spend
/// a card's width saying what its two ends already say, and the full set is in
/// the sheet. The server sends `size_codes` in size order, so the ends are the
/// first and last rather than a sort this screen has to redo.
function sizeSpan(codes: readonly string[]): string {
  if (codes.length === 0) return "—"
  if (codes.length === 1) return sizeLabel(codes[0])
  return `${sizeLabel(codes[0])}–${sizeLabel(codes[codes.length - 1])}`
}

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
    cell: ({ row }) => sizeSpan(row.original.article.size_codes),
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

  return (
    <div className="flex h-full min-h-0">
      {/* The filter column, the same 212 the catalogue's third column is given
          everywhere else in this app. Four vocabularies stacked rather than a
          filter bar of chips above the list: these are closed sets a person
          browses to find out what exists, and a chip you have to open a menu
          to read cannot tell you there are eleven divisions. */}
      <aside className="flex w-[13.25rem] shrink-0 flex-col overflow-y-auto border-r border-hairline px-4 py-[1.125rem]">
        <div className="mt-4 flex items-center justify-between">
          <b className="text-[0.9375rem] font-semibold text-ink">Filters</b>
          {filtered && (
            <button
              type="button"
              onClick={clear}
              className="text-[0.75rem] font-medium text-body transition-colors hover:text-ink"
            >
              Clear
            </button>
          )}
        </div>

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
          labelOf={sizeLabel}
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
      </aside>

      <div className="@container min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[77.5rem] px-[1.875rem] pt-6 pb-14">

          <PageHeader
            crumb="Master data"
            title="Articles"
            sub="Every article we sell, with the colourways, sizes and SKUs minted against it."
            actions={<SetupTrigger />}
          />

          {/* The search sits over the list, not in the filter column: it asks a
              different question. The facets narrow what is already being
              shown; this changes what is being looked for.

              One box for six identifiers, because somebody holding a garment
              does not know which of them they are holding: the swing tag has a
              QR, the label has a SKU, the carton has the supplier's own code
              and the tag sewn inside has an EPC. Asking them to pick the right
              box first is asking them for the answer. The server does the
              matching — including decoding an EPC back to its SKU — so all
              this sends is `q`. */}
          <div className="relative mb-4">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-line-ico" />
            <input
              value={search.value ?? ""}
              onChange={(event) =>
                event.target.value === ""
                  ? search.close()
                  : search.open(event.target.value)
              }
              placeholder="Article, SKU, name, QR, EPC or supplier's code"
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
                       width is whatever the rail and the filter column leave
                       it, so a `md:` breakpoint reading the viewport puts
                       three cards in a space that fits two and truncates every
                       name. */
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
                        {catalogue.isFetchingNextPage
                          ? "Fetching…"
                          : "Show more"}
                      </Button>
                    </div>
                  )}
                </>
              ),
          })}
        </div>
      </div>

      <ArticleSheet
        articleCode={article.value ?? null}
        open={article.isOpen}
        onClose={article.close}
      />
      {/* Mounted here rather than behind the trigger, because two of its three
          sheets are opened by URL from elsewhere: `/articles?setup=<id>` is
          the link an article's detail follows back to the delivery that minted
          it. A sheet that only exists while its button has been pressed is a
          link that works for the person who clicked it and nobody else. */}
      <SetupSheets />
    </div>
  )
}

/// The way into a setup, and the count that makes it worth pressing.
///
/// A trigger and not a menu row: a setup is done to one delivery, so what this
/// opens is a queue to pick from. The number is the whole argument for the
/// button — "Set up deliveries" alone says a thing exists, while "3" says
/// three deliveries are sitting in the warehouse under a code nobody can sell
/// against. Nothing is drawn while the count is unknown, and the button goes
/// quiet rather than away at zero: it is still how you reach the sessions
/// already open.
function SetupTrigger() {
  const queue = useSheet("setups")
  const waiting = useAwaitingIdentity()
  const pending = waiting.data?.length ?? 0

  return (
    <Button variant="soft" onClick={() => queue.open(true)}>
      <ListChecks className="size-4 stroke-[1.7]" />
      Set up deliveries
      {pending > 0 && (
        <span className="ml-0.5 rounded-full bg-warn-bg px-[0.375rem] py-px text-[0.65625rem] font-semibold text-warn-fg tabular-nums">
          {count(pending)}
        </span>
      )}
    </Button>
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
            {sizeSpan(article.size_codes)}
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
