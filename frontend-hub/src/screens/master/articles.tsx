import {
  useQueries,
  useSuspenseInfiniteQuery,
  useSuspenseQueries,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useNavigate } from "@tanstack/react-router"
import { EyeOff } from "lucide-react"
import {
  Suspense,
  useCallback,
  useDeferredValue,
  useMemo,
  useState,
} from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { CardName } from "@/components/ui/phone-cards"
import { Pill, Status } from "@/components/ui/pill"
import { EmptyState, LoadingState, LoadMore } from "@/components/ui/states"
import { FilterPanel } from "@/components/ui/filter-panel"
import { Toolbar } from "@/components/ui/segmented"
import { BarSpacer, ColumnsMenu } from "@/components/ui/list-chrome"
import { useFilterState, type FilterField } from "@/lib/filters"
import { count, money, countPcs } from "@/lib/format"
import { colourwayFill } from "@/lib/colourway-fill"
import { cn } from "@/lib/utils"
import { SubTabs } from "@/components/ui/sub-tabs"
import {
  ACTIVE_ARTICLES,
  articlePagesQuery,
  articleScopeFromFilters,
  searchArticles,
  type ArticleRow,
  type ArticleScope,
  type FacetCount,
} from "@/lib/queries/articles"
import { colourLabelsQuery, type ColourTerm } from "@/lib/queries/colours"
import { catalogueVocabularyQuery } from "@/lib/queries/procurement"
import { useLayout } from "@/lib/layout"
import { useSheet, type SheetSearch } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useFittedVisibility } from "@/screens/procurement/shared"
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
/// The paint of an article's first colourway, for its placeholder in a row.
function firstColourway(article: ArticleRow): readonly string[] | undefined {
  const way = article.colours[0]
  return way && colourwayFill(way.label, way.hex_code)
}

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
  /// Every size, in size order ("M", "L", "XL"): the desk and the phone card
  /// write them all out (owner, 17 Oct); the span above is the grid card's.
  readonly sizeList: readonly string[]
  /// The tags as words, "Kaos", "Basic" — the third line of the Article cell.
  readonly tags: readonly string[]
}

/// The card-only columns, hidden on a desk.
const CARD_ONLY = { head: false, lead: false, foot: false, edit: false }

const columns: ColumnDef<TableSetup, CatalogueRow>[] = [
  {
    id: "article",
    accessorFn: (row) => `${row.article.name} ${row.article.article_code}`,
    header: "Article",
    size: 300,
    // Takes what the others leave, down to 220px: the name is what the row is.
    meta: { card: "hide", grow: 220 },
    // Three lines, one font, as Pricelist draws an article (owner, 17 Oct):
    // the name; the article id and division; the tags. Division and Tags are
    // not columns of their own. Always three lines tall, so every row is one
    // height and a wrapped colour lines up with the id or the tags beside it.
    cell: ({ row }) => {
      const { article, divisionLabel, tags } = row.original
      return (
        <span className="flex items-start gap-3">
          <Thumbnail
            url={article.image_url}
            name={article.name}
            division={article.division_code}
            colours={firstColourway(article)}
            className="size-12 shrink-0 rounded-[8px]"
          />
          <span className="flex min-h-[3lh] min-w-0 flex-col">
            <span className="truncate font-medium text-ink">
              {article.name}
            </span>
            <span className="truncate text-mute tabular-nums">
              {article.article_code}
              {divisionLabel !== "" && ` · ${divisionLabel}`}
            </span>
            {tags.length > 0 && (
              <span className="truncate text-mute">{tags.join(", ")}</span>
            )}
          </span>
        </span>
      )
    },
  },
  {
    id: "colours",
    // Sorted by how many, not by which: "which colours" has no order, and the
    // question a merchandiser actually sorts on is "what only comes in one".
    accessorFn: (row) => row.article.colours.length,
    header: "Colors",
    // "Black, White, Navy," a line; the Article cell keeps the rest at 1440,
    // so "00000009 · Sandal dan Sepatu" is whole.
    size: 164,
    meta: { card: "hide" },
    cell: ({ row }) => (
      <Words words={row.original.article.colours.map((way) => way.label)} />
    ),
  },
  {
    id: "sizes",
    accessorFn: (row) => row.article.size_codes.length,
    header: "Sizes",
    size: 140,
    meta: { card: "hide", priority: 3 },
    cell: ({ row }) => <Words words={row.original.sizeList} />,
  },
  {
    // Pieces on hand, everywhere, in place of the SKU count (owner,
    // 2026-10-15: "ada stock kali ya, tapi hapus sku di table").
    id: "stock",
    accessorFn: (row) => row.article.stock_qty ?? -1,
    header: "Stock",
    size: 104,
    // On a narrow card Sizes goes first, then Stock (owner, 17 Oct: stock
    // stays); Colors, Price range and Status never go.
    meta: { align: "right", card: "hide", priority: 2 },
    cell: ({ row }) =>
      row.original.article.stock_qty === undefined ? (
        <span className="text-mute">—</span>
      ) : (
        `${countPcs(row.original.article.stock_qty)}`
      ),
  },
  {
    id: "price",
    accessorFn: (row) => row.article.base_price_min_minor ?? -1,
    header: "Price range",
    // "Rp 1.249.000–1.399.000" on one line, never cut (owner, 17 Oct).
    size: 216,
    meta: { align: "right", card: "hide" },
    // `-1` rather than null in the accessor: unpriced articles are what
    // somebody sorting by price is usually looking for, and a null sorts
    // wherever the comparator happens to put it.
    cell: ({ row }) => priceSpan(row.original.article),
  },
  {
    id: "status",
    accessorFn: (row) => row.article.active,
    header: "Status",
    // Room for "Inactive" and the › a row shows under the pointer.
    size: 116,
    meta: { card: "hide" },
    cell: ({ row }) => (
      <Status tone={row.original.article.active ? "ok" : "neutral"}>
        {row.original.article.active ? "Active" : "Inactive"}
      </Status>
    ),
  },
  // Four columns that exist only on a card (`cardLead`; a phone), the same card
  // as every other list, saying what the desk's columns say (owner, 17 Oct):
  // the Article cell's three lines, the price it leads with, a foot of stock,
  // colours and sizes in words, and the Edit button.
  {
    id: "head",
    accessorFn: (row) => row.article.name,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "title" },
    cell: ({ row }) => {
      const { article: one, divisionLabel, tags } = row.original
      return (
        <span className="flex min-w-0 items-start gap-3">
          <Thumbnail
            url={one.image_url}
            name={one.name}
            division={one.division_code}
            colours={firstColourway(one)}
            className="size-11 shrink-0 rounded-inner border border-hairline"
          />
          <CardName
            muted={!one.active}
            name={
              <>
                {!one.active && (
                  <EyeOff
                    aria-label="Inactive"
                    className="mr-2 inline size-4 align-[-0.125em] text-mute"
                  />
                )}
                {one.name}
              </>
            }
            // The narrow column wraps at a dot or a comma, so "Sandal dan
            // Sepatu" and "Lengan Pendek" stay whole on their line.
            line={[
              divisionLabel === ""
                ? one.article_code
                : `${one.article_code}\u00a0· ${wordList([divisionLabel])}`,
              wordList(tags),
            ]}
          />
        </span>
      )
    },
  },
  {
    id: "lead",
    accessorFn: (row) => row.article.base_price_min_minor ?? -1,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "lead" },
    cell: ({ row }) => {
      const { base_price_min_minor: low, base_price_max_minor: high } =
        row.original.article
      const first = low ?? high
      return (
        <span className="flex flex-col items-end tabular-nums">
          <span
            className={cn(
              "text-[1.5rem] leading-tight font-semibold tracking-tight [overflow-wrap:anywhere]",
              first === null ? "text-mute" : "text-ink"
            )}
          >
            {first === null ? "—" : money(first)}
          </span>
          <span className="text-[0.9375rem] text-mute">
            {low !== null && high !== null && high > low
              ? `up to ${money(high)}`
              : "price"}
          </span>
        </span>
      )
    },
  },
  {
    id: "foot",
    accessorFn: (row) => row.article.stock_qty ?? -1,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "foot" },
    // "8 pcs · Black, White · M, L": the desk's Stock, Colors and Sizes in
    // that order (same on every device). A long one wraps at a comma or a dot,
    // never inside "1.204 pcs" or "No Size".
    cell: ({ row }) => {
      const { article, sizeList } = row.original
      const n = article.stock_qty
      return (
        <span className="tabular-nums">
          {[
            n === undefined ? "—" : `${count(n)}\u00a0pcs`,
            wordList(article.colours.map((way) => way.label)),
            wordList(sizeList),
            article.active ? "" : "Inactive",
          ]
            .filter((part) => part !== "")
            .join("\u00a0· ")}
        </span>
      )
    },
  },
  {
    id: "edit",
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { align: "right", card: "status" },
    cell: ({ row }) => (
      <EditArticle
        code={row.original.article.article_code}
        name={row.original.article.name}
      />
    ),
  },
]

/// Colours or sizes written out with commas, every one of them: the cell wraps
/// rather than cutting ("Black, White, Navy," over "Olive, Maroon"), and a
/// word never splits across lines ("No Size" stays whole).
function Words({ words }: { words: readonly string[] }) {
  if (words.length === 0) return <span className="text-mute">—</span>
  return (
    <span className="block whitespace-normal" title={words.join(", ")}>
      {wordList(words)}
    </span>
  )
}

/// "Black, Light Blue": the words with commas, each one kept whole.
function wordList(words: readonly string[]): string {
  return words.map((word) => word.replace(/ /g, "\u00a0")).join(", ")
}

/// The card's Edit: the article's sheet, already on its edit form.
function EditArticle({ code, name }: { code: string; name: string }) {
  const navigate = useNavigate()
  return (
    <Button
      variant="tint"
      size="card"
      aria-label={`Edit ${name}`}
      onClick={(event) => {
        event.stopPropagation()
        void navigate({
          to: ".",
          search: (prev: SheetSearch) => ({
            ...prev,
            article: code,
            "article-edit": true as const,
          }),
          viewTransition: false,
        })
      }}
    >
      Edit
    </Button>
  )
}

export function Articles() {
  // The title stands at once; the catalogue waits for its first page, the
  // words and the colour names and streams in with them (the server starts the
  // reads too).
  return (
    <PageContent>
      <PageHeader title="Articles" small />
      <Suspense
        fallback={<LoadingState>Reading the article master…</LoadingState>}
      >
        <ArticleCatalogue />
      </Suspense>
    </PageContent>
  )
}

function ArticleCatalogue() {
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

  /// The words the catalogue may be described with (they change when somebody
  /// edits the vocabulary table, which is roughly never), and the colour
  /// facets, which come back as codes, because that is what the filter sends.
  /// A person reads a name and recognises a swatch, so the master is joined to
  /// the counts here — once — rather than asking the list endpoint to repeat a
  /// hundred labels on every page.
  const [vocabulary, master] = useSuspenseQueries({
    queries: [catalogueVocabularyQuery(), colourLabelsQuery()],
  })
  const colourTerms = useMemo(
    () =>
      new Map<string, ColourTerm>(
        master.data.colours.map((term) => [term.code, term])
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
        label: "Color",
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

  /// Active, Sold out or Inactive (owner, 2026-10-15). An article goes
  /// inactive only by hand — selling out does not retire it; Sold out is the
  /// active articles with nothing on hand anywhere.
  const [tab, setTab] = useState<ArticleTab>("ACTIVE")

  const base = useMemo<ArticleScope>(
    () => ({
      ...articleScopeFromFilters(filters.filters),
      q: needle === "" ? undefined : needle,
      sort: articleOrder.value === "oldest" ? "oldest" : undefined,
    }),
    [filters.filters, needle, articleOrder.value]
  )
  const scope = useMemo<ArticleScope>(
    () => ({ ...base, ...TAB_SCOPE[tab] }),
    [base, tab]
  )
  /// Each tab's count: the same search under that tab, one row asked for —
  /// the total is what is wanted.
  const tabCounts = useQueries({
    queries: ARTICLE_TABS.map((one) => ({
      queryKey: ["articles", "count", { ...base, ...TAB_SCOPE[one.value] }],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        searchArticles({ ...base, ...TAB_SCOPE[one.value], limit: 1 }, signal),
    })),
  })
  const countOf = (value: ArticleTab) =>
    tabCounts[ARTICLE_TABS.findIndex((one) => one.value === value)]?.data?.total

  // A tab or a filter changed: the list in hand stays (dimmed, below) until
  // the new one lands, instead of blinking to the loading state between — the
  // deferred scope keeps the old question on screen while the new one is read.
  const asked = useDeferredValue(scope)
  const catalogue = useSuspenseInfiniteQuery(articlePagesQuery(asked))

  // Append-only: the list grows as more is asked for, and every article
  // fetched stays in the model. Nothing is sliced away to make it look fast.
  const articles = useMemo(
    () => catalogue.data.pages.flatMap((page) => page.items),
    [catalogue.data]
  )
  // From the first page. Every page reports the same totals, so taking the
  // first is what stops the counts flickering as more pages arrive.
  const facets = catalogue.data.pages[0]?.facets
  /// How many articles the SEARCH matches — not how many the facets do. The
  /// server computes this from the words alone, so saying "40 of 2.810" with
  /// three facets on would claim a number nobody computed.
  const searchable = catalogue.data.pages[0]?.total ?? 0

  const rows = useMemo<CatalogueRow[]>(
    () =>
      articles.map((one) => ({
        article: one,
        divisionLabel:
          one.division_code === null
            ? ""
            : termLabel(vocabulary.data?.divisions, one.division_code),
        sizes: sizeSpan(vocabulary.data?.sizes, one.size_codes),
        sizeList: one.size_codes.map((code) =>
          sizeLabel(vocabulary.data?.sizes, code)
        ),
        tags: one.tags.map((code) => termLabel(vocabulary.data?.tags, code)),
      })),
    [articles, vocabulary.data]
  )

  const phone = useLayout() === "phone"
  const edit = useSheet("article-edit")
  const navigate = useNavigate()
  /// Closing clears the edit flag with the article, in one write, so the next
  /// plain tap on a row opens the overview.
  const closeArticle = useCallback(() => {
    void navigate({
      to: ".",
      replace: true,
      search: (prev: SheetSearch) => ({
        ...prev,
        article: undefined,
        "article-edit": undefined,
      }),
      viewTransition: false,
    })
  }, [navigate])

  /// What fits the card: the columns with a `priority` go, one at a time,
  /// before the table would scroll sideways (owner, 2026-10-10).
  const fit = useFittedVisibility(columns, CARD_ONLY)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: CatalogueRow) => row.article.article_code,
        state: {
          sorting,
          // The card's own columns are drawn on a phone and never on a desk.
          columnVisibility: phone
            ? { head: true, lead: true, foot: true, edit: true }
            : fit.shown,
        },
        onSortingChange: setSorting,
        onColumnVisibilityChange: fit.change,
      }),
      [rows, sorting, phone, fit.hidden, fit.visibility]
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
    <>
      {/* The same head as the order book, New Articles and Divisions: the
          figures, then one line of controls over the table. The facets that
          stood in a panel beside the list are in that line now (owner,
          2026-10-05), as they are on Purchase Orders. */}
      {facets !== undefined && (
        <KpiStrip className="grid-cols-2 md:grid-cols-4 xl:grid-cols-4">
          <Kpi label="Articles" value={count(searchable)} />
          <Kpi label="Divisions" value={count(facets.divisions.length)} />
          <Kpi label="Colors" value={count(facets.colours.length)} />
          <Kpi label="Sizes" value={count(facets.sizes.length)} />
        </KpiStrip>
      )}

      <SubTabs
        className="max-md:hidden"
        tabs={ARTICLE_TABS.map((one) => ({
          value: one.value,
          label: <TabLabel text={one.label} n={countOf(one.value)} />,
        }))}
        value={tab}
        onChange={(next) => setTab(next as ArticleTab)}
      />

      <div className="grid min-w-0 items-start">
        <div className="@container flex min-w-0 flex-col">
          {/* One bar, as every list draws it (owner, 17 Oct): the search, which
              also offers Division, Tag, Color and Size by name with the
              server's counts, then Columns at the right. A table sorts
              by its headings, so there is no order control on a desk.
              The box is one box for every identifier, because somebody holding
              a garment does not know which of them they are holding — the QR on
              the swing tag, the SKU on the label, the supplier's own code on
              the carton. The server does the matching; this only sends `q`.
              EPC is not named (owner, 2026-09-12): it identifies one physical
              unit, and this screen is the product definition. */}
          <div className="max-md:hidden">
            <Toolbar className="group/bar">
              <FilterPanel
                model={{ ...filters, fields: counted }}
                search={{
                  value: search.value ?? "",
                  onChange: (next) =>
                    next ? search.open(next) : search.close(),
                  label: "Search articles",
                }}
              />
              <BarSpacer />
              {view === "table" && <ColumnsMenu table={table} />}
            </Toolbar>
          </div>

          {/* On a phone the search, the facets and the order are the dock's,
              as on every list (owner, 2026-10-06): nothing at the top of the
              page but the figures. */}
          <DockTools
            search={{
              value: search.value ?? "",
              onChange: (next) => (next ? search.open(next) : search.close()),
              label: "Search articles",
            }}
            status={{
              value: tab,
              options: ARTICLE_TABS.map((one) => ({
                value: one.value,
                label: one.label,
                count: countOf(one.value) ?? 0,
              })),
              onChange: (next) => setTab(next as ArticleTab),
            }}
            filter={{
              count: filters.filters.length,
              panel: { model: { ...filters, fields: counted } },
            }}
            sort={{
              label:
                articleOrder.value === "oldest"
                  ? "Oldest first"
                  : "Newest first",
              choices: {
                options: [
                  { value: "newest", label: "Newest first" },
                  { value: "oldest", label: "Oldest first" },
                ],
                value: articleOrder.value ?? "newest",
                desc: false,
                onChange: (next) =>
                  next === "oldest"
                    ? articleOrder.open("oldest")
                    : articleOrder.close(),
              },
            }}
          />

          <div
            // The list being replaced steps back while the next is read, and
            // comes forward when it lands — a transition, so a second tab
            // pressed mid-way retargets instead of restarting (Emil).
            aria-busy={asked !== scope || undefined}
            className="list-swap"
          >
            {rows.length === 0 ? (
              <EmptyState>
                {filtered
                  ? "No article matches that. Widen the filters, or search the whole master."
                  : "No article has been created yet. Articles are created in New Articles."}
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
                  <Card ref={fit.ref} className="overflow-clip">
                    {/* Sorting is over what has been loaded, not over the
                          whole catalogue: the cursor is keyed on article code,
                          so a sort by price can only order the pages already
                          fetched. That is honest as long as the count above
                          says how many are shown — which is why it does. */}
                    <DataTable<CatalogueRow>
                      refresh={[catalogue]}
                      table={table}
                      onRowClick={(row) =>
                        article.open(row.article.article_code)
                      }
                      isSelected={(row) =>
                        row.article.article_code === article.value
                      }
                      more={catalogue}
                      // The window scrolls, not the table (owner,
                      // 2026-10-05): no box inside the card with its own bars.
                      pageScroll
                      cellsTop
                      cardsApart
                      cardLead
                      cardSort={false}
                    />
                    <div className="flex h-11 items-center border-t border-hairline bg-soft px-5 text-[0.9375rem] text-body">
                      <b className="mr-1 font-medium text-ink">
                        {count(articles.length)}
                      </b>
                      {filtered
                        ? catalogue.hasNextPage
                          ? "shown, more to load"
                          : articles.length === 1
                            ? "article matches"
                            : "articles match"
                        : `of ${count(searchable)} shown`}
                    </div>
                  </Card>
                )}

                {/* The grid scrolls with the page, so its foot is watched
                      here; the table scrolls itself and watches its own. */}
                {view === "grid" && (
                  <LoadMore query={catalogue} className="mt-6" />
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <ArticleSheet
        articleCode={article.value ?? null}
        open={article.isOpen}
        onClose={closeArticle}
        edit={edit.isOpen}
      />
    </>
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
  // The colourway a pointer rests on over the dots, so the placeholder can be
  // seen in each colour without opening the article.
  const [shown, setShown] = useState(0)
  const way = article.colours[shown] ?? article.colours[0]

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
        colours={way && colourwayFill(way.label, way.hex_code)}
        fallback="No Photo"
        className="h-[9.875rem] w-full"
      >
        {/* The division rides on the photograph: it is what the picture IS, so
            it belongs with the picture rather than in a list of facts below
            it. */}
        {article.division_code !== null && (
          <span className="absolute top-2.5 left-2.5 inline-flex items-center rounded-full bg-canvas/95 px-2 py-[0.1875rem] text-[0.9375rem] font-semibold text-ink shadow-[0_1px_3px_rgba(20,20,25,.1)] backdrop-blur-[5px]">
            {row.divisionLabel}
          </span>
        )}
        {/* Retired is said on the picture too, and only when true. An "Active"
            badge on every card would be a badge that means nothing; this one
            is a warning that the article is no longer being sold, on the half
            of the card somebody actually looks at. */}
        {!article.active && (
          <span className="absolute top-2.5 right-2.5">
            <Pill tone="neutral">Inactive</Pill>
          </span>
        )}
      </Thumbnail>

      <div className="px-[0.9375rem] pt-3 pb-[0.875rem]">
        <div className="truncate text-[0.9375rem] font-medium text-ink">
          {article.name}
        </div>
        <div className="mt-[0.1875rem] truncate font-mono text-[0.9375rem] text-mute">
          {article.article_code}
        </div>

        {/* Colours and sizes on one line: together they are the sentence
            "what this comes in", and splitting them over two rows makes a card
            taller for no more meaning. */}
        <div className="mt-2.5 flex items-center gap-2">
          <Swatches
            colours={article.colours}
            cap={5}
            onShow={(at) => setShown(at ?? 0)}
          />
          <span className="min-w-0 flex-1 truncate text-right text-[0.9375rem] text-body">
            {row.sizes}
          </span>
        </div>

        <div className="mt-2 flex items-baseline justify-between gap-2">
          <span className="truncate text-[0.9375rem] font-semibold text-ink tabular-nums">
            {priceSpan(article)}
          </span>
          <span className="shrink-0 text-[0.9375rem] text-mute tabular-nums">
            {article.stock_qty === undefined
              ? "—"
              : `${countPcs(article.stock_qty)}`}
          </span>
        </div>
      </div>
    </button>
  )
}

type ArticleTab = "ACTIVE" | "SOLD_OUT" | "INACTIVE"

const ARTICLE_TABS: readonly { value: ArticleTab; label: string }[] = [
  { value: "ACTIVE", label: "Active" },
  { value: "SOLD_OUT", label: "Sold out" },
  { value: "INACTIVE", label: "Inactive" },
]

/// What each tab asks the server for.
const TAB_SCOPE: Record<
  ArticleTab,
  Pick<ArticleScope, "active" | "inStock">
> = {
  ACTIVE: ACTIVE_ARTICLES,
  SOLD_OUT: { active: true, inStock: false },
  INACTIVE: { active: false },
}

/// A tab's word and its count, the count quiet (as Colors draws it).
function TabLabel({ text, n }: { text: string; n: number | undefined }) {
  return (
    <span>
      {text}
      {n !== undefined && (
        <span className="ml-1.5 text-body tabular-nums">{count(n)}</span>
      )}
    </span>
  )
}
