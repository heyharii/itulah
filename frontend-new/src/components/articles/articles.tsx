import { useEffect, useMemo, useState } from "react"
import { Link } from "@tanstack/react-router"

import { Icon, paths } from "@/components/dashboard/parts"
import { IconButton, Switch } from "@/components/dashboard/nav-sidebar"
import { SheetShell, sheetButton } from "@/components/dashboard/sheet-shell"
import { AppHeading } from "@/components/app-switcher"
import {
  useArticleCatalogue,
  type Article,
  type ArticleColor,
  type ArticleItem,
  type ArticleSize,
  type Division,
} from "@/components/articles/api"
import { useCreateDivision, useCreateTag } from "@/components/articles/mutations"
import {
  cue,
  readSoundPreference,
  useInteractionSounds,
  writeSoundPreference,
} from "@/components/dashboard/use-interaction-sounds"
import { VirtualRows } from "@/shared/table"
import {
  AppShell,
  AppShellSidebar,
  SidebarTrigger,
} from "@/components/app-shell"
import { cn } from "@/lib/utils"
import { Route } from "@/routes/articles"

const ARTICLE_COLUMNS =
  "minmax(0,1fr) 148px 116px 104px 72px 196px 104px"

/**
 * One row of the articles feed: an article, one of its SKUs while it is
 * expanded, or the note that it has none. Flat rather than nested because a
 * virtualizer positions by index — an expansion has to be a sibling of the row
 * that opened it, not a child of it.
 */
type ArticleFeedEntry =
  | { kind: "article"; article: Article; isOpen: boolean; division: Division | undefined }
  | { kind: "sku"; item: ArticleItem; articleName: string }
  | { kind: "empty"; articleId: string }

const rule =
  "border-b border-b-[color-mix(in_srgb,var(--line)_78%,transparent)]"

/* Keyed by division id as well as code: Go's /divisions serves an id and a
 * name but no code, so keying on the code alone painted every division the
 * same violet and the dot stopped telling them apart. */
const DIVISION_HUE: Record<string, string> = {
  WOMEN: "#ff58ae",
  MEN: "#0086fc",
  KIDS: "#ffbb26",
  ACCESSORIES: "#7b5cfa",
  "div-ladieswear": "#ff58ae",
  "div-menswear": "#0086fc",
  "div-baby-children": "#ffbb26",
  "div-sport": "#12b76a",
  "div-divided": "#7b5cfa",
  "div-home": "#d97706",
}

const hueOf = (division?: Division) =>
  DIVISION_HUE[division?.code ?? ""] ??
  DIVISION_HUE[division?.id ?? ""] ??
  "var(--violet)"

const money = (value: number) =>
  value === 0 ? "—" : `Rp ${Math.round(value).toLocaleString("id-ID")}`

/* Colourways are named, not painted: product_family_colors carries a hex_code
 * column but the catalogue leaves it empty, so a swatch has to come from the
 * name. These are the names the master actually uses — anything outside the
 * list (a numbered "Colour 014", a name added later) falls through to a hue
 * derived from the label, which is stable per name and never two greys apart
 * from each other by accident. */
const SWATCH: Record<string, string> = {
  beige: "#d9c8a9", black: "#181818", blue: "#2563eb", brown: "#7c4a24",
  burgundy: "#79263c", camel: "#c19a6b", coral: "#fa7268", cream: "#f4ead6",
  "dark blue": "#1a3a72", "dark grey": "#4b4f55", gold: "#c9a227",
  green: "#2f8f4e", grey: "#8b9096", indigo: "#3f3d91", ivory: "#f6f2e4",
  khaki: "#9a8f5e", "light blue": "#8fc4e8", "light green": "#a7d7a1",
  "light grey": "#c7cbd0", "light pink": "#f5c3d0", lilac: "#b9a3dd",
  maroon: "#6d2230", mint: "#9fdcc4", multi: "#8b8b8b", mustard: "#d0a02a",
  navy: "#1b2a4a", "off white": "#efece4", olive: "#6b6f36", orange: "#ef7625",
  pink: "#f28ab2", purple: "#7b4bbd", red: "#d5352c", rust: "#a4482a",
  sand: "#dfcfae", silver: "#c0c4c8", teal: "#1f8f8f", turquoise: "#3fbfbf",
  white: "#f8f8f6", yellow: "#e8c020",
}

const swatchOf = (color: ArticleColor) => {
  if (color.hex) return color.hex
  const named = SWATCH[color.name.trim().toLowerCase()]
  if (named) return named
  let hash = 0
  for (const char of color.name) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return `hsl(${Math.abs(hash) % 360} 42% 58%)`
}

/** "XS–XL" once there are more than two; the whole run when there are not. */
const sizeRun = (sizes: ArticleSize[]) =>
  sizes.length === 0
    ? "—"
    : sizes.length > 2
      ? `${sizes[0].label}–${sizes[sizes.length - 1].label}`
      : sizes.map((size) => size.label).join(" ")

/** A SKU reads as the article, its colour and its size — in that order. */
const skuName = (articleName: string, colorName: string, sizeCode: string) =>
  [articleName, colorName, sizeCode]
    .filter((part) => part && part !== "—")
    .join(" · ")

/**
 * One row of a multi-select filter rail: a toggle, not a destination.
 *
 * `src/shared/form/fields.tsx` has a `MultiSelectField` with the same
 * semantics, and it does not fit here — it reads its value from TanStack
 * Form's `useFieldContext`, and this rail's value lives in the URL. Its
 * accessibility contract is borrowed rather than reinvented: a `button` with
 * `aria-pressed`, which is what a set-membership control is.
 */
function FilterRow({
  on,
  label,
  count,
  className,
  onToggle,
  dot,
}: {
  on: boolean
  label: string
  count: number
  className: string
  onToggle: () => void
  dot?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={cn(
        className,
        "text-ink-2 hover:bg-hover hover:text-ink",
        on && "bg-hover font-semibold text-ink"
      )}
    >
      {/* Both rails carry the same tick, so "these are sets you add to" reads
          the same in either one; the division dot is extra, not instead. */}
      <span
        aria-hidden
        className={cn(
          "grid size-[13px] shrink-0 place-items-center rounded-[4px] transition-colors",
          on ? "bg-accent text-white" : "shadow-[inset_0_0_0_1px_var(--line-strong)]"
        )}
      >
        {on && <Icon path={paths.check} size={9} width={3} />}
      </span>
      {dot && (
        <span
          style={{ background: dot }}
          className="size-2 shrink-0 rounded-full"
        />
      )}
      <span className="truncate">{label}</span>
      <span className="ml-auto font-mono text-[10.5px] text-ink-4">{count}</span>
    </button>
  )
}

export function Articles() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { layout } = search
  const query = search.query ?? ""
  const divisionIds = useMemo(() => search.divisionIds ?? [], [search.divisionIds])
  const tagNames = useMemo(() => search.tagNames ?? [], [search.tagNames])
  const supplierIds = useMemo(() => search.supplierIds ?? [], [search.supplierIds])
  const expanded = search.expanded ?? []
  const openId = search.open

  /* The hub answers the search and both rails — see `articleListQuery` in
   * ./api.ts. Nothing below filters the result again. */
  const catalogue = useArticleCatalogue({
    query: search.query,
    divisionIds,
    tagNames,
    supplierIds,
  })

  /* The URL stays the source of truth for the search, but a keystroke is no
   * longer free: `query` is on the wire now, so committing every character
   * would be one request (and three aggregates) per letter. The box is typed
   * into locally and the URL catches up on a pause. */
  const [typed, setTyped] = useState(query)
  /* Adjusted during render rather than in an effect: a URL that changed under
   * the box (Back, a copied link, the rail clearing the search) has to be in
   * the input on the SAME render, and an effect would paint the stale text
   * first. https://react.dev/learn/you-might-not-need-an-effect */
  const [lastQuery, setLastQuery] = useState(query)
  if (lastQuery !== query) {
    setLastQuery(query)
    setTyped(query)
  }
  useEffect(() => {
    if (typed === query) return
    const timer = setTimeout(() => {
      void navigate({
        search: (prev) => ({ ...prev, query: typed || undefined }),
        replace: true,
      })
    }, 250)
    return () => clearTimeout(timer)
  }, [typed, query, navigate])

  /** Adds or removes one value from a rail, leaving the other rail alone. A
   *  rail is a set: picking a second division widens the answer rather than
   *  replacing the first. */
  const toggleFilter = (
    key: "divisionIds" | "tagNames" | "supplierIds",
    value: string
  ) =>
    void navigate({
      search: (prev) => {
        const current = prev[key] ?? []
        const next = current.includes(value)
          ? current.filter((entry) => entry !== value)
          : [...current, value]
        return { ...prev, [key]: next.length > 0 ? next : undefined }
      },
      replace: true,
    })

  const [creating, setCreating] = useState<"tag" | "division" | null>(null)
  const [draft, setDraft] = useState({ name: "", code: "" })
  const [saveError, setSaveError] = useState<string | null>(null)
  const createTag = useCreateTag()
  const createDivision = useCreateDivision()
  const saving = createTag.isLoading || createDivision.isLoading
  const [railHidden, setRailHidden] = useState(false)
  const [soundOn, setSoundOn] = useState(readSoundPreference)

  useInteractionSounds(soundOn)

  const articles = useMemo(
    () => catalogue.data?.articles ?? [],
    [catalogue.data?.articles]
  )
  const divisions = useMemo(
    () => catalogue.data?.divisions ?? [],
    [catalogue.data?.divisions]
  )
  const tags = useMemo(
    () => (catalogue.data?.tags ?? []).filter((tag) => tag.active),
    [catalogue.data?.tags]
  )
  /* Only suppliers the hub counted at least one article for. The supplier
   * master holds every supplier we have ever dealt with, and most of them
   * supply nothing in this catalogue yet — a rail of zeroes is a list of rows
   * that can only empty the screen. A supplier's own count survives its own
   * selection (the facet excludes it), so a selected row never disappears. */
  const suppliers = useMemo(
    () =>
      (catalogue.data?.suppliers ?? []).filter(
        (supplier) =>
          (catalogue.data?.supplierCounts ?? {})[supplier.id] !== undefined ||
          (search.supplierIds ?? []).includes(supplier.id)
      ),
    [catalogue.data?.suppliers, catalogue.data?.supplierCounts, search.supplierIds]
  )
  /* The tag vocabulary is served even by backends that never say which items
   * carry which tag. Filtering by a tag none of the loaded articles carries
   * can only ever empty the screen, so on those backends the filter stands
   * down and says why instead of listing every tag with a zero beside it. */
  const tagsFilterable = catalogue.data?.tagsAvailable ?? false
  /* Counts come from the hub's facets, each computed with its own rail's
   * selection excluded — so "Menswear 41" still says 41 after you select it,
   * and a row's number means "articles you would get", not "articles left in
   * the page the browser happened to load". */
  const divisionCounts = catalogue.data?.divisionCounts ?? {}
  const tagCounts = catalogue.data?.tagCounts ?? {}
  const supplierCounts = catalogue.data?.supplierCounts ?? {}
  const articleTotal = catalogue.data?.total ?? 0
  const matchedTotal = catalogue.data?.matched ?? 0
  const anyFilter = Boolean(
    query || divisionIds.length || tagNames.length || supplierIds.length
  )

  const divisionOf = (id: string) =>
    divisions.find((division) => division.id === id)

  /* Every predicate that used to live here — division, tag, the search — is
   * now a query param the hub applied. What is left is presentation order,
   * which is a property of this screen and not of the request. */
  const rows = useMemo(
    () => [...articles].sort((a, b) => a.name.localeCompare(b.name)),
    [articles]
  )

  /* One flat list: a virtualizer positions by index, so an expanded article's
   * SKUs have to be entries beside it rather than nested inside its row. */
  const feed = useMemo<ArticleFeedEntry[]>(
    () =>
      rows.flatMap((article): ArticleFeedEntry[] => {
        const isOpen = expanded.includes(article.id)
        const head: ArticleFeedEntry = {
          kind: "article",
          article,
          isOpen,
          division: divisionOf(article.divisionId),
        }
        if (!isOpen) return [head]

        const items = article.items ?? []
        if (items.length === 0) {
          return [head, { kind: "empty", articleId: article.id }]
        }
        return [
          head,
          ...items.map((item): ArticleFeedEntry => ({
            kind: "sku",
            item,
            articleName: article.name,
          })),
        ]
      }),
    [rows, expanded, divisionOf]
  )

  /* The catalogue read carries every SKU, so opening a row or the sheet is a
   * lookup, not a second request. */
  const open = openId
    ? (articles.find((article) => article.id === openId) ?? null)
    : null

  const toggleRow = (article: Article) => {
    void navigate({
      search: (prev) => {
        const current = prev.expanded ?? []
        return {
          ...prev,
          expanded: current.includes(article.id)
            ? current.filter((id) => id !== article.id)
            : [...current, article.id],
        }
      },
      replace: true,
    })
  }

  const closeArticle = () =>
    void navigate({
      search: (prev) => ({ ...prev, open: undefined }),
      replace: true,
    })

  const save = async () => {
    setSaveError(null)
    try {
      if (creating === "tag") {
        await createTag.execute(draft.name)
      } else {
        await createDivision.execute({ code: draft.code, name: draft.name })
      }
      setCreating(null)
      setDraft({ name: "", code: "" })
    } catch (error: unknown) {
      setSaveError(
        error instanceof Error ? error.message : "The request was refused."
      )
    }
  }

  const navRow =
    "flex h-8 w-full items-center gap-2 rounded-control px-2 text-left text-[13px] font-medium transition-colors duration-[110ms]"

  return (
    <AppShell
      label="Articles navigation"
      railWidth={240}
      cols={
        railHidden
          ? "grid-cols-[0px_minmax(0,1fr)]"
          : "grid-cols-[240px_minmax(0,1fr)]"
      }
    >
      <AppShellSidebar className={cn(railHidden && "invisible")}>
        <aside className="flex h-full min-h-0 flex-col overflow-hidden bg-page">
          <div className="flex h-[52px] shrink-0 items-center gap-1.5 pr-2 pl-2.5">
            <AppHeading app="articles" />
            <IconButton
              label="Collapse sidebar"
              onClick={() => setRailHidden((v) => !v)}
            >
              <Icon path={paths.panel} size={17} />
            </IconButton>
          </div>

          <nav className="flex-1 overflow-auto px-2 pt-0.5 pb-2">
            <Link
              from="/articles"
              to="/articles"
              replace
              search={(prev) => ({
                ...prev,
                divisionIds: undefined,
                tagNames: undefined,
                supplierIds: undefined,
              })}
              className={cn(
                navRow,
                "text-ink-2 hover:bg-hover hover:text-ink",
                divisionIds.length === 0 &&
                  tagNames.length === 0 &&
                  supplierIds.length === 0 &&
                  "bg-hover font-semibold text-ink"
              )}
            >
              <Icon path={paths.grid} className="shrink-0 text-ink-4" />
              All articles
              <span className="ml-auto font-mono text-[10.5px] text-ink-4">
                {articleTotal}
              </span>
            </Link>

            <div className="mt-3.5 flex h-7 items-center gap-1 px-2">
              <span className="text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
                Divisions
              </span>
              <button
                type="button"
                aria-label="Add a division"
                onClick={() => {
                  setCreating("division")
                  setDraft({ name: "", code: "" })
                  setSaveError(null)
                }}
                className="ml-auto grid size-[20px] place-items-center rounded-chip text-ink-4 transition-colors hover:bg-hover hover:text-ink"
              >
                <Icon path={paths.plus} size={12} width={2.2} />
              </button>
            </div>
            {divisions.map((division) => {
              const on = divisionIds.includes(division.id)
              return (
                <FilterRow
                  key={division.id}
                  on={on}
                  label={division.name}
                  count={divisionCounts[division.id] ?? 0}
                  className={navRow}
                  onToggle={() => toggleFilter("divisionIds", division.id)}
                  dot={hueOf(division)}
                />
              )
            })}

            <div className="mt-3.5 flex h-7 items-center gap-1 px-2">
              <span className="text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
                Tags
              </span>
              <button
                type="button"
                aria-label="Add a tag"
                onClick={() => {
                  setCreating("tag")
                  setDraft({ name: "", code: "" })
                  setSaveError(null)
                }}
                className="ml-auto grid size-[20px] place-items-center rounded-chip text-ink-4 transition-colors hover:bg-hover hover:text-ink"
              >
                <Icon path={paths.plus} size={12} width={2.2} />
              </button>
            </div>
            {tagsFilterable ? (
              tags.map((tag) => (
                <FilterRow
                  key={tag.id}
                  on={tagNames.includes(tag.name)}
                  label={tag.name}
                  count={tagCounts[tag.name] ?? 0}
                  className={navRow}
                  onToggle={() => toggleFilter("tagNames", tag.name)}
                />
              ))
            ) : (
              <p className="px-2 py-1 text-[10.5px] leading-[1.5] text-ink-4">
                {catalogue.data
                  ? "This backend does not say which articles carry which tag, so there is nothing to filter by yet."
                  : "…"}
              </p>
            )}

            {/* Suppliers has no "+" beside it: a supplier is created in the
                supplier master and attached to an article by a sourcing offer,
                not invented from a filter rail. */}
            <div className="mt-3.5 flex h-7 items-center gap-1 px-2">
              <span className="text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
                Suppliers
              </span>
            </div>
            {suppliers.length > 0 ? (
              suppliers.map((supplier) => (
                <FilterRow
                  key={supplier.id}
                  on={supplierIds.includes(supplier.id)}
                  label={supplier.name}
                  count={supplierCounts[supplier.id] ?? 0}
                  className={navRow}
                  onToggle={() => toggleFilter("supplierIds", supplier.id)}
                />
              ))
            ) : (
              <p className="px-2 py-1 text-[10.5px] leading-[1.5] text-ink-4">
                {catalogue.data
                  ? "No supplier is linked to an article yet. A sourcing candidate carries the link once it is attached to an article."
                  : "…"}
              </p>
            )}
          </nav>

          <div className="shrink-0 p-2">
            <button
              type="button"
              role="switch"
              aria-checked={soundOn}
              data-sound-silent
              onClick={() => {
                const next = !soundOn
                setSoundOn(next)
                writeSoundPreference(next)
                if (next) cue("toggle")
              }}
              className="flex h-[34px] w-full items-center gap-[9px] rounded-control px-2 text-xs font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink"
            >
              <Icon
                path={paths.sound}
                size={16}
                className="shrink-0 text-ink-4"
              />
              Interaction sounds
              <Switch on={soundOn} className="ml-auto" />
            </button>
          </div>
        </aside>
      </AppShellSidebar>

      <main className="flex h-full min-h-0 flex-col overflow-hidden p-2 pl-0 max-lg:pl-2">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-window bg-surface shadow-card">
          <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-3.5">
            <SidebarTrigger className="-ml-1" />
            <span className="text-sm font-semibold text-ink">Articles</span>
            <span className="ml-2 truncate text-[11.5px] text-ink-3">
              {catalogue.status === "loading"
                ? "Loading the article master…"
                : anyFilter
                  ? `${matchedTotal} of ${articleTotal} · what we sell`
                  : `${articleTotal} · what we sell`}
            </span>

            <span className="relative ml-auto">
              <Icon
                path={paths.search}
                size={14}
                width={1.9}
                className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-4"
              />
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="Name or article code"
                className="h-[32px] w-[220px] rounded-control bg-field pr-2.5 pl-8 text-xs text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none placeholder:text-ink-4 focus:bg-surface focus:shadow-[inset_0_0_0_1px_var(--accent)]"
              />
            </span>

            <span className="flex h-[28px] items-center gap-0.5 rounded-control bg-inset p-0.5 shadow-[inset_0_0_0_1px_var(--line)]">
              {(["grid", "table"] as const).map((option) => (
                <Link
                  key={option}
                  from="/articles"
                  to="/articles"
                  replace
                  aria-label={`${option} view`}
                  search={(prev) => ({ ...prev, layout: option })}
                  className={cn(
                    "grid h-[24px] w-[28px] place-items-center rounded-[7px] transition-colors",
                    layout === option
                      ? "bg-surface text-ink shadow-btn"
                      : "text-ink-3 hover:text-ink"
                  )}
                >
                  <Icon
                    path={option === "grid" ? paths.grid : paths.table}
                    size={14}
                    width={1.9}
                  />
                </Link>
              ))}
            </span>
          </header>

          <div className="min-h-0 flex-1 overflow-auto">
            {catalogue.error && (
              <p className="px-3.5 py-6 text-center text-xs text-ember">
                Unable to load the article master: {catalogue.error.message}
              </p>
            )}

            {layout === "grid" ? (
              <div className="grid gap-2 p-3.5 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
                {rows.map((article) => {
                  const division = divisionOf(article.divisionId)
                  return (
                    <Link
                      key={article.id}
                      from="/articles"
                      to="/articles"
                      search={(prev) => ({ ...prev, open: article.id })}
                      className="overflow-hidden rounded-card bg-surface text-left shadow-btn transition-shadow hover:shadow-card"
                    >
                      {/* The article master carries no photograph, so the tile
                          shows the article's own code rather than borrowing a
                          picture that belongs to a different product. */}
                      <span
                        style={{
                          background: `color-mix(in srgb, ${hueOf(division)} 10%, var(--inset))`,
                          color: `color-mix(in srgb, ${hueOf(division)} 62%, var(--ink))`,
                        }}
                        className="flex aspect-square items-center justify-center overflow-hidden"
                      >
                        {article.image ? (
                          <img
                            src={article.image}
                            alt=""
                            loading="lazy"
                            className="size-full object-cover"
                          />
                        ) : (
                          <span className="font-mono text-[13px] font-medium tracking-[-0.02em]">
                            {article.code}
                          </span>
                        )}
                      </span>
                      <span className="block p-2">
                        <span className="block truncate text-[11.5px] font-medium text-ink">
                          {article.name}
                        </span>
                        <span className="flex items-center gap-1.5 pt-1">
                          <span
                            style={{ background: hueOf(division) }}
                            className="size-1.5 shrink-0 rounded-full"
                          />
                          <span className="truncate text-[10px] text-ink-3">
                            {division?.name ?? "Unassigned"}
                          </span>
                          <span className="ml-auto shrink-0 font-mono text-[10px] text-ink-4">
                            {article.itemCount}
                          </span>
                        </span>

                        {/* The colourways and the size run: what an article is
                            actually made in, which is the pair a merchandiser
                            reads a card for. */}
                        <span className="flex items-center gap-1.5 pt-1.5">
                          <ColorDots colors={article.colors} max={5} />
                          <span className="ml-auto shrink-0 font-mono text-[10px] whitespace-nowrap text-ink-3">
                            {sizeRun(article.sizes)}
                          </span>
                        </span>

                        {article.tags.length > 0 && (
                          <span className="flex flex-wrap gap-1 pt-1.5">
                            {article.tags.map((name: string) => (
                              <span
                                key={name}
                                className="inline-flex h-[18px] items-center rounded-[5px] bg-inset px-1.5 text-[10px] text-ink-3"
                              >
                                {name}
                              </span>
                            ))}
                          </span>
                        )}
                      </span>
                    </Link>
                  )
                })}
              </div>
            ) : (
              <VirtualRows
                rows={feed}
                rowKey={(entry) =>
                  entry.kind === "article"
                    ? entry.article.id
                    : entry.kind === "empty"
                      ? `${entry.articleId}-empty`
                      : entry.item.id
                }
                columns={ARTICLE_COLUMNS}
                rowHeight={(entry) => (entry.kind === "article" ? 46 : 34)}
                className="min-w-[1040px]"
                onRowClick={(entry) => {
                  if (entry.kind === "article") toggleRow(entry.article)
                }}
                header={
                  <>
                    <span className="pl-3.5">Article</span>
                    <span className="px-3">Division</span>
                    <span className="px-3">Colours</span>
                    <span className="px-3">Sizes</span>
                    <span className="px-3 text-right">SKUs</span>
                    <span className="px-3">Tags</span>
                    <span className="pr-3.5 pl-3">Status</span>
                  </>
                }
                renderRow={(entry) => {
                  if (entry.kind === "empty") {
                    return (
                      <span
                        role="gridcell"
                        style={{ gridColumn: "1 / -1" }}
                        className="flex h-full items-center bg-[color-mix(in_srgb,var(--inset)_45%,var(--surface))] pl-[46px] text-[11px] text-ink-4"
                      >
                        No SKUs are recorded under this article.
                      </span>
                    )
                  }

                  if (entry.kind === "sku") {
                    const { item } = entry
                    return (
                      <>
                        <span role="gridcell" className="min-w-0 pr-3 pl-3.5">
                          <span className="block truncate pl-[21px] text-[11.5px] text-ink-2">
                            {skuName(entry.articleName, item.colorName, item.sizeLabel)}
                          </span>
                        </span>
                        <span role="gridcell" className="min-w-0 px-3 font-mono text-[10.5px] text-ink-4">
                          <span className="block truncate">{item.sku}</span>
                        </span>
                        <span role="gridcell" className="flex min-w-0 items-center gap-1.5 px-3">
                          <span
                            title={item.colorName}
                            style={{
                              background: swatchOf({
                                id: item.colorId,
                                name: item.colorName,
                                number: item.colorNumber,
                                code: item.colorId || null,
                                hex: item.colorHex,
                              }),
                            }}
                            className="size-[9px] shrink-0 rounded-full shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ink)_16%,transparent)]"
                          />
                          <span className="truncate text-[11px] text-ink-3">{item.colorName}</span>
                        </span>
                        <span role="gridcell" className="px-3 font-mono text-[11px] text-ink-3">
                          {item.sizeLabel}
                        </span>
                        <span role="gridcell" className="px-3 text-right font-mono text-xs text-ink tabular-nums">
                          {money(item.sellingPrice)}
                        </span>
                        <span role="gridcell" className="min-w-0 px-3 font-mono text-[10.5px] text-ink-4">
                          <span className="block truncate">{item.barcode || "\u2014"}</span>
                        </span>
                        <span role="gridcell" className="pr-3.5 pl-3" />
                      </>
                    )
                  }

                  const { article, isOpen, division } = entry
                  return (
                    <>
                      <span role="gridcell" className="flex min-w-0 items-center gap-2 pr-3 pl-3.5">
                        <Icon
                          path={paths.chevronRight}
                          size={13}
                          width={2.2}
                          className={cn(
                            "shrink-0 text-ink-4 transition-transform duration-[140ms]",
                            isOpen && "rotate-90"
                          )}
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-medium text-ink">
                            {article.name}
                          </span>
                          <span className="block truncate font-mono text-[10.5px] text-ink-4">
                            {article.code}
                          </span>
                        </span>
                      </span>

                      <span role="gridcell" className="min-w-0 px-3">
                        <span
                          style={{ color: hueOf(division) }}
                          className="flex items-center gap-1.5 text-[11.5px] font-medium"
                        >
                          <span
                            style={{ background: hueOf(division) }}
                            className="size-1.5 shrink-0 rounded-full"
                          />
                          {division?.name ?? "Unassigned"}
                        </span>
                      </span>

                      <span role="gridcell" className="flex items-center gap-1.5 px-3">
                        <ColorDots colors={article.colors} max={4} />
                        {article.colors.length > 0 && (
                          <span className="font-mono text-[10.5px] text-ink-4">
                            {article.colors.length}
                          </span>
                        )}
                      </span>

                      <span role="gridcell" className="min-w-0 px-3 font-mono text-[11px] text-ink-2">
                        <span className="block truncate">{sizeRun(article.sizes)}</span>
                      </span>

                      <span role="gridcell" className="px-3 text-right font-mono text-xs text-ink-2 tabular-nums">
                        {article.itemCount}
                      </span>

                      <span role="gridcell" className="min-w-0 px-3">
                        {article.tags.length === 0 ? (
                          <span className="text-[11px] text-ink-4">\u2014</span>
                        ) : (
                          <span className="flex flex-wrap gap-1">
                            {article.tags.map((name: string) => (
                              <span
                                key={name}
                                className="inline-flex h-[19px] items-center rounded-[6px] bg-inset px-1.5 text-[10.5px] text-ink-3"
                              >
                                {name}
                              </span>
                            ))}
                          </span>
                        )}
                      </span>

                      <span role="gridcell" className="pr-3.5 pl-3">
                        <span className="flex items-center gap-1.5 text-[11px] font-medium text-ink-3">
                          <span
                            style={{
                              background:
                                article.status === "active" ? "var(--grass)" : "var(--honey)",
                            }}
                            className="size-1.5 rounded-full"
                          />
                          {article.status}
                        </span>
                      </span>
                    </>
                  )
                }}
              />
            )}

            {catalogue.status !== "loading" && rows.length === 0 && (
              <p className="py-10 text-center text-xs text-ink-4">
                Nothing matches that.
              </p>
            )}
          </div>
        </div>
      </main>

      {/* create a tag or a division without leaving the screen */}
      <SheetShell
        open={creating !== null}
        eyebrow={creating === "tag" ? "New tag" : "New division"}
        title={draft.name || (creating === "tag" ? "Tag" : "Division")}
        onRequestClose={() => setCreating(null)}
        footer={
          <>
            {saveError && (
              <span className="flex-1 truncate text-[11.5px] text-ember">
                {saveError}
              </span>
            )}
            {!saveError && <span className="flex-1" />}
            <button
              type="button"
              onClick={() => setCreating(null)}
              className={sheetButton.secondary}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={
                saving ||
                !draft.name.trim() ||
                (creating === "division" && !draft.code.trim())
              }
              onClick={() => void save()}
              className={cn(
                sheetButton.primary,
                "disabled:pointer-events-none disabled:opacity-45"
              )}
            >
              <Icon path={paths.check} size={14} width={2.2} />
              {saving ? "Saving…" : "Create"}
            </button>
          </>
        }
      >
        <div className="px-[18px] pt-4 pb-[18px]">
          <label
            htmlFor="art-name"
            className="block pb-1.5 text-xs font-medium text-ink-2"
          >
            Name <span className="text-ember">*</span>
          </label>
          <input
            id="art-name"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder={creating === "tag" ? "Linen, Outerwear…" : "Footwear"}
            className="mb-4 h-[36px] w-full rounded-control bg-field px-2.5 text-[13px] font-medium text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none placeholder:font-normal placeholder:text-ink-4 focus:bg-surface focus:shadow-[inset_0_0_0_1px_var(--accent)]"
          />

          {creating === "division" && (
            <>
              <label
                htmlFor="art-code"
                className="block pb-1.5 text-xs font-medium text-ink-2"
              >
                Code <span className="text-ember">*</span>
              </label>
              <input
                id="art-code"
                value={draft.code}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    code: e.target.value.toUpperCase(),
                  }))
                }
                placeholder="FOOTWEAR"
                className="mb-4 h-[36px] w-full rounded-control bg-field px-2.5 font-mono text-[13px] text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none focus:bg-surface focus:shadow-[inset_0_0_0_1px_var(--accent)]"
              />
            </>
          )}

          <p className="text-[11px] leading-[1.5] text-ink-4">
            {creating === "tag"
              ? "Tags are shared across the whole system, so a name added here shows up wherever tags are used."
              : "A division groups articles for reporting and for the price cascade."}
          </p>
        </div>
      </SheetShell>

      <SheetShell
        open={Boolean(open)}
        size="wide"
        eyebrow={divisionOf(open?.divisionId ?? "")?.name ?? "Article"}
        title={open?.name ?? ""}
        onRequestClose={closeArticle}
        footer={
          <>
            <span className="flex-1" />
            <button
              type="button"
              onClick={closeArticle}
              className={sheetButton.secondary}
            >
              Close
            </button>
          </>
        }
      >
        {open && <ArticleDetail article={open} />}
      </SheetShell>
    </AppShell>
  )
}

/**
 * An article's colourways as swatches. Past `max` it stops drawing dots and
 * says how many are left, so a ten-colour article does not push everything
 * else off a card that is only ~150px wide.
 */
function ColorDots({
  colors,
  max = 6,
  size = 9,
}: {
  colors: ArticleColor[]
  max?: number
  size?: number
}) {
  if (colors.length === 0) {
    return <span className="text-[10px] text-ink-4">No colourway</span>
  }
  const shown = colors.slice(0, max)
  return (
    <span className="flex min-w-0 items-center gap-[3px] overflow-hidden">
      {shown.map((color) => (
        <span
          key={color.id}
          title={color.name}
          style={{ background: swatchOf(color), width: size, height: size }}
          className="shrink-0 rounded-full shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ink)_16%,transparent)]"
        />
      ))}
      {colors.length > shown.length && (
        <span className="shrink-0 font-mono text-[10px] text-ink-4">
          +{colors.length - shown.length}
        </span>
      )}
    </span>
  )
}

/** One article, opened into the SKUs beneath it. */
function ArticleDetail({ article }: { article: Article }) {
  const items = article.items ?? []
  const prices = items
    .map((item) => item.sellingPrice)
    .filter((price) => price > 0)
  const low = prices.length ? Math.min(...prices) : 0
  const high = prices.length ? Math.max(...prices) : 0

  return (
    <div className="px-4 py-4">
      <div className="mb-3 grid grid-cols-3 gap-2">
        {[
          { label: "Article code", value: article.code },
          { label: "SKUs", value: String(items.length || article.itemCount) },
          {
            label: "Selling price",
            value: low === high ? money(low) : `${money(low)} – ${money(high)}`,
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-panel bg-inset px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--line)]"
          >
            <div className="pb-1 text-[10.5px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
              {stat.label}
            </div>
            <div className="truncate font-mono text-[14px] font-medium text-ink">
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {/* Every colourway named, not only swatched: the sheet has the room the
          card does not, and a name is what a buyer orders by. */}
      <div className="mb-3 grid grid-cols-2 gap-2">
        <div className="rounded-panel bg-inset px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--line)]">
          <div className="pb-1.5 text-[10.5px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
            Colourways · {article.colors.length}
          </div>
          {article.colors.length === 0 ? (
            <span className="text-[11px] text-ink-4">—</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {article.colors.map((color) => (
                <span
                  key={color.id}
                  className="inline-flex h-[20px] items-center gap-1.5 rounded-[6px] bg-surface px-1.5 text-[11px] text-ink-2 shadow-[inset_0_0_0_1px_var(--line)]"
                >
                  <span
                    style={{ background: swatchOf(color) }}
                    className="size-[9px] shrink-0 rounded-full shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ink)_16%,transparent)]"
                  />
                  {color.name}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-panel bg-inset px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--line)]">
          <div className="pb-1.5 text-[10.5px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
            Sizes · {article.sizes.length}
          </div>
          {article.sizes.length === 0 ? (
            <span className="text-[11px] text-ink-4">—</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {article.sizes.map((size) => (
                <span
                  key={size.code}
                  title={`Size code ${size.code}`}
                  className="inline-flex h-[20px] items-center rounded-[6px] bg-surface px-1.5 font-mono text-[11px] text-ink-2 shadow-[inset_0_0_0_1px_var(--line)]"
                >
                  {size.label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Who may supply this article — the sourcing link, not purchase
          history. Many suppliers per article is the normal case; one is not
          special and none is not an error, only an article nobody has quoted
          yet. No cost is shown: each supplier quotes its own, so there is no
          single number that belongs here. */}
      <div className="mb-3 rounded-panel bg-inset px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--line)]">
        <div className="pb-1.5 text-[10.5px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
          Suppliers · {article.suppliers.length}
        </div>
        {article.suppliers.length === 0 ? (
          <span className="text-[11px] text-ink-4">
            No supplier is linked to this article yet.
          </span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {article.suppliers.map((supplier) => (
              <span
                key={supplier.id}
                title={supplier.id}
                className="inline-flex h-[20px] items-center rounded-[6px] bg-surface px-1.5 text-[11px] text-ink-2 shadow-[inset_0_0_0_1px_var(--line)]"
              >
                {supplier.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {article.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 pb-3">
          {article.tags.map((name: string) => (
            <span
              key={name}
              className="inline-flex h-[20px] items-center rounded-[6px] bg-inset px-1.5 text-[11px] text-ink-3"
            >
              {name}
            </span>
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <p className="rounded-panel bg-inset py-8 text-center text-xs text-ink-4 shadow-[inset_0_0_0_1px_var(--line)]">
          No SKUs are recorded under this article.
        </p>
      ) : (
        <table className="w-full table-fixed border-separate border-spacing-0 text-[13px]">
          <colgroup>
            <col />
            <col style={{ width: 132 }} />
            <col style={{ width: 116 }} />
            <col style={{ width: 66 }} />
            <col style={{ width: 112 }} />
            <col style={{ width: 132 }} />
          </colgroup>
          <thead>
            <tr className="[&>th]:h-9 [&>th]:border-y [&>th]:border-y-line-strong [&>th]:bg-surface [&>th]:px-2.5 [&>th]:text-[11px] [&>th]:font-semibold [&>th]:tracking-[0.04em] [&>th]:text-ink-3 [&>th]:uppercase">
              <th className="text-left">SKU</th>
              <th className="text-left">Code</th>
              <th className="text-left">Colour</th>
              <th className="text-left">Size</th>
              <th className="text-right">Price</th>
              <th className="text-left">Barcode</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="hover:[&>td]:bg-hover">
                <td
                  className={cn(
                    "h-row px-2.5 align-middle text-xs text-ink",
                    rule
                  )}
                >
                  <span className="block truncate">
                    {skuName(article.name, item.colorName, item.sizeLabel)}
                  </span>
                </td>
                <td
                  className={cn(
                    "px-2.5 align-middle font-mono text-[11px] text-ink-3",
                    rule
                  )}
                >
                  {item.sku}
                </td>
                <td className={cn("px-2.5 align-middle", rule)}>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      style={{
                        background: swatchOf({
                          id: item.colorId,
                          name: item.colorName,
                          number: item.colorNumber,
                          code: item.colorId || null,
                          hex: item.colorHex,
                        }),
                      }}
                      className="size-[9px] shrink-0 rounded-full shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ink)_16%,transparent)]"
                    />
                    <span className="truncate text-[11px] text-ink-2">
                      {item.colorName}
                    </span>
                  </span>
                </td>
                <td
                  className={cn(
                    "px-2.5 align-middle font-mono text-[11px] text-ink-2",
                    rule
                  )}
                >
                  {item.sizeLabel}
                </td>
                <td
                  className={cn(
                    "px-2.5 text-right align-middle font-mono text-xs text-ink tabular-nums",
                    rule
                  )}
                >
                  {money(item.sellingPrice)}
                </td>
                <td
                  className={cn(
                    "px-2.5 align-middle font-mono text-[10.5px] text-ink-4",
                    rule
                  )}
                >
                  <span className="block truncate">{item.barcode || "—"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
