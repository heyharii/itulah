import { AppShell, ScreenBody, ScreenHeader, ScreenState } from "@/components/app-shell"
import { Segmented } from "@/components/custom/segmented"
import { Nav } from "@/components/nav"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { ArticlePrices, CommercialChannel, PriceRung } from "@/lib/commercial"
import {
  articlePrices,
  articlePricesKey,
  CHANNELS,
  describeLevel,
  localInstantToIso,
  rungPrice,
} from "@/lib/commercial"
import { money, units } from "@/lib/money"
import { cn } from "@/lib/utils"
import { ApiError } from "@itulah/contract/client"
import { useForm, useStore } from "@tanstack/react-form"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import {
  BookOpen,
  ChevronRight,
  Clock,
  FlaskConical,
  Radio,
  RotateCcw,
  Search,
} from "lucide-react"
import { useMemo, useState } from "react"

/// How many styles are drawn before the rest wait behind a button.
///
/// The work is styles times shops times cascade rungs, and the browser will
/// draw all of it if asked. Low enough that the first paint is immediate;
/// high enough that a filtered view is almost always whole.
const DRAWN = 40

/// What every shop charges for a style, and what else it could have charged.
///
/// Keyed by style rather than by product, because that is how a merchandiser
/// thinks: a shirt is one decision in three sizes, not three decisions. The
/// sizes are still honest — a rung that covers products priced differently
/// shows both ends of the range rather than the cheaper one.
///
/// Every shop sits side by side, and under each shop the whole cascade rather
/// than only its answer. "Why is Toko 07 charging 99?" is answered by the
/// losers as much as by the winner: a company price of 169 superseded by a
/// clearance, or a shop price that lost to a newer book. That reasoning is the
/// server's — the engine's own `price_stacks` — and this screen renders it
/// without re-deciding any of it.
///
/// Promotions are absent by design. "Buy two, get twenty per cent" is a
/// statement about a basket, not this style's price; a shelf edge advertising
/// it would promise a number the counter will not honour for one item. Test a
/// basket instead.
export function PricesView() {
  /// The question this screen is asking, all of it in one place.
  ///
  /// It was six `useState`s that were read together every render and never
  /// meant anything apart: which channel and which instant go to the server,
  /// and which text, division, tag and markdown flag narrow what comes back.
  /// Splitting them by where they are enforced is a fact about the
  /// implementation, not about the question — a merchandiser asking "what are
  /// we charging for outerwear at Toko 07 on Friday" is asking one thing.
  ///
  /// `drawn` below is deliberately not in here. How much of the answer has been
  /// laid out is not part of the question and must not survive a change to it.
  const form = useForm({
    defaultValues: {
      channel: "STORE" as CommercialChannel,
      /// Empty means now. The engine takes the instant as an argument, so
      /// asking what the fleet will charge on the first morning of a campaign
      /// is the same code path as asking what it charges at this second.
      at: "",
      search: "",
      division: "",
      tag: "",
      onlyMarkdown: false,
    },
  })
  const { channel, at, search, division, tag, onlyMarkdown } = useStore(
    form.store,
    (state) => state.values,
  )
  const [drawn, setDrawn] = useState(DRAWN)

  const scope = { channel, at: localInstantToIso(at) }
  const page = useQuery({
    queryKey: articlePricesKey(scope),
    queryFn: ({ signal }) => articlePrices(scope, signal),
  })

  const all = useMemo(() => page.data?.rows ?? [], [page.data])
  const divisions = useMemo(
    () => [...new Set(all.map((a) => a.division_code).filter((d): d is string => d !== null))].sort(),
    [all],
  )
  const tags = useMemo(
    () => [...new Set(all.flatMap((a) => a.tags))].sort(),
    [all],
  )

  const items = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return all.filter((article) => {
      if (needle !== "") {
        const haystack = `${article.article_name} ${article.article_code}`.toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      if (division !== "" && article.division_code !== division) return false
      if (tag !== "" && !article.tags.includes(tag)) return false
      if (onlyMarkdown && !isCleared(article)) return false
      return true
    })
  }, [all, search, division, tag, onlyMarkdown])

  const cleared = items.filter(isCleared).length
  const shopCount = page.data?.shops.length ?? 0
  // The server prices a bounded number of styles, because the work is styles
  // times shops. Said out loud rather than left to be discovered.
  const total = page.data?.total ?? 0
  const capped = total > all.length

  return (
    <AppShell
      data-cloudhub
      nav={<Nav />}
      facets={
        <Facets
          search={search}
          onSearch={(value) => form.setFieldValue("search", value)}
          divisions={divisions}
          division={division}
          onDivision={(value) => form.setFieldValue("division", value)}
          tags={tags}
          tag={tag}
          onTag={(value) => form.setFieldValue("tag", value)}
          onlyMarkdown={onlyMarkdown}
          onOnlyMarkdown={(value) => form.setFieldValue("onlyMarkdown", value)}
          cleared={cleared}
        />
      }
    >
      <ScreenHeader
        title="Prices"
        eyebrow="Commercial"
        subtitle={
          page.isPending
            ? "loading…"
            : `${units(items.length)} style${items.length === 1 ? "" : "s"} · ${units(shopCount)} shop${shopCount === 1 ? "" : "s"}`
        }
      >
        {/* What changes the question: which channel, and which instant. */}
        <Segmented
          size="sm"
          value={channel}
          onChange={(value) => form.setFieldValue("channel", value)}
          options={CHANNELS.map((option) => ({
            id: option,
            label: option.toLowerCase(),
          }))}
        />

        <form.Field name="at">
          {(field) => (
            <AsOf value={field.state.value} onChange={(value) => field.handleChange(value)} />
          )}
        </form.Field>

        <Button size="sm" variant="outline" nativeButton={false} render={<Link to="/commercial/simulate" />}>
          <FlaskConical className="size-3.5" />
          Test
        </Button>
        <Button size="sm" variant="outline" nativeButton={false} render={<Link to="/commercial/fleet" />}>
          <Radio className="size-3.5" />
          Fleet
        </Button>
        <Button size="sm" variant="outline" nativeButton={false} render={<Link to="/commercial/books" />}>
          <BookOpen className="size-3.5" />
          Books
        </Button>
      </ScreenHeader>

      {capped && (
        <div className="text-muted-foreground border-b px-3.5 py-1.5 text-[0.71875rem]">
          Pricing the first {units(all.length)} of {units(total)} styles. The work is
          styles times shops, so the rest wait — narrow the range to reach them.
        </div>
      )}

      {at !== "" && (
        /* A price screen showing a moment other than now is the one thing on it
           that can be misread as fact, so it says so rather than leaving the
           reader to notice a date box they filled in earlier. */
        <div className="flex items-center gap-2 border-b bg-[var(--os-info-bg,#ddebfa)] px-3.5 py-1.5 text-[0.71875rem] text-[var(--os-info,#2f86d8)]">
          <Clock className="size-3.5 shrink-0" />
          <span>
            Priced as of {new Date(at).toLocaleString("id-ID")} — not what the tills are
            charging now.
          </span>
          <button
            type="button"
            onClick={() => form.setFieldValue("at", "")}
            className="ml-auto shrink-0 underline"
          >
            Back to now
          </button>
        </div>
      )}

      <ScreenBody>
        {page.isPending ? (
          <ScreenState>Pricing every style at every shop…</ScreenState>
        ) : page.isError ? (
          <ScreenState
            tone="problem"
            action={
              <Button size="sm" variant="outline" onClick={() => void page.refetch()}>
                Try again
              </Button>
            }
          >
            {page.error instanceof ApiError
              ? page.error.message
              : "The prices could not be loaded."}
          </ScreenState>
        ) : shopCount === 0 ? (
          <ScreenState>
            No shop is registered, so there is nobody to price for. A price book published
            now would be queued for nobody.
          </ScreenState>
        ) : items.length === 0 ? (
          <ScreenState>
            {all.length === 0
              ? "No style has a published price on this channel."
              : "No style matches these filters."}
          </ScreenState>
        ) : (
          <>
            <table data-os-grid="" className="w-full border-collapse text-left">
              <thead className="sticky top-0 z-10">
                <tr className="border-b">
                  <Th className="w-[30%]">Style</Th>
                  <Th className="w-[16%]">Shop</Th>
                  <Th className="w-[22%] text-right">Price</Th>
                  <Th>Which price</Th>
                </tr>
              </thead>
              {items.slice(0, drawn).map((article) => (
                <ArticleGroup key={article.article_code} article={article} />
              ))}
            </table>
            {items.length > drawn && (
              <div className="flex items-center justify-center gap-3 border-t p-3">
                <span className="text-muted-foreground text-[0.71875rem]">
                  {units(items.length - drawn)} more not drawn
                </span>
                <Button size="sm" variant="outline" onClick={() => setDrawn(drawn + DRAWN * 4)}>
                  Show more
                </Button>
              </div>
            )}
          </>
        )}
      </ScreenBody>
    </AppShell>
  )
}

/// What narrows the answer, in the rail.
///
/// The header carries what changes the QUESTION — which channel, which instant
/// — and the rail carries what narrows the answer. Putting both in the header
/// pushed the name of the screen off it, which is how you can tell there were
/// two different things in there.
function Facets({
  search,
  onSearch,
  divisions,
  division,
  onDivision,
  tags,
  tag,
  onTag,
  onlyMarkdown,
  onOnlyMarkdown,
  cleared,
}: {
  search: string
  onSearch: (value: string) => void
  divisions: readonly string[]
  division: string
  onDivision: (value: string) => void
  tags: readonly string[]
  tag: string
  onTag: (value: string) => void
  onlyMarkdown: boolean
  onOnlyMarkdown: (value: boolean) => void
  cleared: number
}) {
  return (
    <div className="flex flex-col gap-3">
      <label className="relative block">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
        <Input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Style or code…"
          aria-label="Search styles"
          className="w-full pl-7"
        />
      </label>

      <button
        type="button"
        onClick={() => onOnlyMarkdown(!onlyMarkdown)}
        className={cn(
          "flex items-center justify-between rounded-[var(--os-r-inner,0.5625rem)] border px-2.5 py-1.5 text-left text-[0.71875rem] transition-colors",
          onlyMarkdown
            ? "border-[var(--os-warn,#c9892e)] bg-[var(--os-warn-bg,#faeacd)] text-[var(--os-warn,#c9892e)]"
            : "hover:bg-[var(--os-soft-2,#f3f3f5)]",
        )}
      >
        <span>On markdown somewhere</span>
        <span className="font-mono tabular-nums">{units(cleared)}</span>
      </button>

      {divisions.length > 0 && (
        <Chips
          label="Division"
          values={divisions}
          chosen={division}
          onChoose={onDivision}
        />
      )}
      {tags.length > 0 && <Chips label="Tag" values={tags} chosen={tag} onChoose={onTag} />}
    </div>
  )
}

/// One value at a time, and clicking the chosen one lets it go.
function Chips({
  label,
  values,
  chosen,
  onChoose,
}: {
  label: string
  values: readonly string[]
  chosen: string
  onChoose: (value: string) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-muted-foreground text-[0.6875rem] font-medium">{label}</span>
      <div className="flex flex-wrap gap-1">
        {values.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onChoose(chosen === value ? "" : value)}
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[0.65625rem] font-medium transition-colors",
              chosen === value
                ? "bg-[var(--os-accent-bg,#e9ebfc)] text-[var(--os-accent,#3c52f0)]"
                : "bg-[var(--os-soft-2,#f3f3f5)] text-[var(--os-body,#74747b)] hover:text-[var(--os-ink,#1d1d1f)]",
            )}
          >
            {value}
          </button>
        ))}
      </div>
    </div>
  )
}

/// A style is being cleared somewhere if any shop's winning rung is a markdown.
function isCleared(article: ArticlePrices): boolean {
  return article.shops.some((shop) =>
    shop.stack.some((rung) => rung.source === "MARKDOWN" && rung.in_force_for > 0),
  )
}

/// One style and every shop under it, as its own table body.
///
/// A `tbody` per style rather than one flat list: it is what lets the style
/// cell span its shops without the browser guessing, and it gives the group a
/// border of its own so a long fleet does not read as one undifferentiated run
/// of rows.
function ArticleGroup({ article }: { article: ArticlePrices }) {
  const rows = article.shops.flatMap((shop) =>
    shop.stack.map((rung, index) => ({ shop, rung, first: index === 0 })),
  )
  if (rows.length === 0) {
    return (
      <tbody className="border-b-4 border-b-muted/60">
        <tr>
          <Td className="align-top">
            <Style article={article} />
          </Td>
          <Td colSpan={3} className="text-muted-foreground text-[0.71875rem]">
            No shop has a published price for this style on this channel.
          </Td>
        </tr>
      </tbody>
    )
  }
  return (
    <tbody className="border-b-4 border-b-muted/60">
      {rows.map(({ shop, rung, first }, index) => (
        <tr
          key={`${shop.site_id}:${rung.rank}:${rung.markdown_id ?? rung.publication_version}`}
          className={cn(
            "border-b last:border-b-0",
            // A rung nothing is charging from is context, not an answer, and
            // must not read with the same weight as the price being taken.
            rung.in_force_for === 0 && "text-muted-foreground bg-muted/20",
            rung.source === "MARKDOWN" &&
              rung.in_force_for > 0 &&
              "bg-[var(--os-warn-bg,#faeacd)]/50",
          )}
        >
          {index === 0 && (
            <Td rowSpan={rows.length} className="border-r align-top">
              <Style article={article} />
            </Td>
          )}
          <Td className={cn("align-top", !first && "text-transparent")}>
            {/* The shop is named once per shop, not once per rung: repeating it
                down a cascade would read as several shops charging several
                prices, which is the opposite of what it means. */}
            <span className={cn("text-xs", !first && "invisible")}>{shop.label}</span>
          </Td>
          <Td className="align-top">
            <Price rung={rung} />
          </Td>
          <Td className="align-top">
            <WhichPrice rung={rung} />
          </Td>
        </tr>
      ))}
    </tbody>
  )
}

/// The photo, the name and what the thing is. No SKU: a style is one decision,
/// and the codes underneath it are not what anybody is looking for here.
function Style({ article }: { article: ArticlePrices }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      {article.image_url === null ? (
        <span
          aria-label={`${article.article_name} has no photo`}
          className="bg-muted text-muted-foreground grid size-11 shrink-0 place-items-center rounded-md text-[0.625rem]"
        >
          no photo
        </span>
      ) : (
        <img
          src={article.image_url}
          alt={article.article_name}
          loading="lazy"
          className="bg-muted size-11 shrink-0 rounded-md object-cover"
        />
      )}
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-xs font-medium">{article.article_name}</span>
        <span className="text-muted-foreground font-mono text-[0.625rem]">
          {article.article_code} · {units(article.sku_count)} SKU
        </span>
        {(article.tags.length > 0 || article.division_code !== null) && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {article.division_code !== null && (
              <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[0.625rem]">
                {article.division_code}
              </span>
            )}
            {article.tags.map((code) => (
              <span
                key={code}
                className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[0.625rem]"
              >
                {code}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/// The amount, and — when the sizes disagree about it — the sizes.
///
/// A range is a summary of several prices, and the question it provokes is
/// always "which size is the expensive one". Answered by opening the same rung
/// rather than by a second screen, so the detail cannot drift from the summary
/// it sits under.
function Price({ rung }: { rung: PriceRung }) {
  const [open, setOpen] = useState(false)
  const spread = rung.points.length > 1
  const superseded = rung.in_force_for === 0
  const amount = (
    <span
      className={cn(
        "font-mono text-xs tabular-nums whitespace-nowrap",
        rung.source === "MARKDOWN" && !superseded && "font-medium text-[var(--os-warn,#c9892e)]",
        superseded && "line-through",
      )}
    >
      {rungPrice(rung)}
    </span>
  )
  return (
    <div className="flex flex-col items-end gap-0.5">
      {spread ? (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1 hover:underline"
          aria-expanded={open}
        >
          <ChevronRight
            aria-hidden
            className={cn("size-3 transition-transform", open && "rotate-90")}
          />
          {amount}
        </button>
      ) : (
        amount
      )}

      {/* How many products this rung is actually charged on, not how many it
          covers. When a shop price takes one size, the company rung under it
          reads "2 of 3 sizes" — the number that would be a lie as a boolean. */}
      {rung.sku_count > 1 && (
        <span className="text-muted-foreground text-[0.625rem]">
          {superseded
            ? `${units(rung.sku_count)} sizes`
            : rung.in_force_for === rung.sku_count
              ? `${units(rung.sku_count)} sizes`
              : `${units(rung.in_force_for)} of ${units(rung.sku_count)} sizes`}
        </span>
      )}

      {open && (
        <ul className="mt-1 flex w-full flex-col items-end gap-0.5 border-t pt-1">
          {rung.points.map((point) => {
            // A size the rung does not actually win is struck here too. The
            // summary above already says "2 of 3", and an opened list that
            // showed all three the same way would take that back — the reader
            // would leave believing the medium is charged at this price when a
            // shop price took it.
            const taken = superseded || point.in_force_for === 0
            return (
              <li
                key={point.unit_price_minor}
                className="flex w-full items-baseline justify-end gap-2"
              >
                <span className="text-muted-foreground truncate font-mono text-[0.625rem]">
                  {point.sku_codes.join(", ")}
                </span>
                <span
                  className={cn(
                    "font-mono text-[0.65625rem] tabular-nums",
                    taken && "text-muted-foreground line-through",
                  )}
                >
                  {money(point.unit_price_minor, rung.currency)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/// Which of the shop\'s prices this row is.
///
/// This replaced three columns — a scope, a book version and a word nobody
/// could read ("Standing") — which between them answered one question: what
/// kind of price is this, and is it the one being taken. Splitting one answer
/// across three columns is how a table gets wide without getting clearer.
///
/// Whether it is charged is not said in words here: the amount beside it is
/// struck through and the row is greyed when it is not. Saying it twice would
/// be the fourth column.
function WhichPrice({ rung }: { rung: PriceRung }) {
  const superseded = rung.in_force_for === 0
  const scope = describeLevel(rung.applies_to)
  const what =
    rung.source === "MARKDOWN"
      ? "clearance"
      : rung.applies_to.level === "COMPANY"
        ? "company price"
        : rung.applies_to.level === "SITE"
          ? "price for this shop"
          : rung.applies_to.level === "SITE_GROUP"
            ? `price for ${scope}`
            : `price for ${scope}`
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5 text-[0.6875rem]">
      <span className={cn(!superseded && rung.source === "MARKDOWN" && "text-[var(--os-warn,#c9892e)]")}>
        {what}
      </span>
      {rung.markdown_id !== null && (
        <span className="text-muted-foreground font-mono text-[0.625rem]">{rung.markdown_id}</span>
      )}
      {/* The book that decided it, kept as a footnote rather than a column: it
          is what you follow when a price is wrong, and not what you scan for. */}
      <span className="text-muted-foreground font-mono text-[0.625rem]">
        v{rung.publication_version}
      </span>
    </div>
  )
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        "px-3 py-2 text-left align-middle whitespace-nowrap uppercase",
        className,
      )}
    >
      {children}
    </th>
  )
}

function Td({
  children,
  className,
  rowSpan,
  colSpan,
}: {
  children?: React.ReactNode
  className?: string
  rowSpan?: number
  colSpan?: number
}) {
  return (
    <td rowSpan={rowSpan} colSpan={colSpan} className={cn("px-3 py-2", className)}>
      {children}
    </td>
  )
}

/// The instant to price at.
///
/// Blank is now, and blank is the normal state — the box exists for the two
/// questions a list of current prices cannot answer: what the fleet charged
/// last Tuesday, and what it will charge when the campaign starts.
function AsOf({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      <Input
        type="datetime-local"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Price as of"
        className="w-44"
      />
      {value !== "" && (
        <Button size="sm" variant="ghost" onClick={() => onChange("")} aria-label="Price as of now">
          <RotateCcw className="size-3.5" />
        </Button>
      )}
    </div>
  )
}
