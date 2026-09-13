import { Search } from "lucide-react"
import { useCallback, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { PickMany } from "@/components/ui/pick"
import { Toolbar } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState, Problem } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { Thumbnail } from "@/components/ui/thumbnail"
import { count } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useCatalogueIdentity, type Identity } from "@/lib/operations/catalogue"

/// One SKU the warehouse is being asked about, as the node counts it.
///
/// Two numbers, and they are deliberately two. `needed` is what the paperwork
/// says — allotment lines, added up. `available` is what is physically there
/// to answer it with. A screen that showed only their minimum would make "the
/// shop does not want more" and "nobody has fetched it yet" look identical,
/// and those call for very different next actions.
export interface Demand {
  readonly sku_code: string
  readonly needed: number
  /// What can honestly be committed right now. `null` where the question does
  /// not arise — picking takes off a rack whose contents it is not counting.
  readonly available: number | null
}

/// The rows of one article, and what the article IS.
///
/// Identity is lifted off the catalogue rather than off the demand: the node
/// answers in SKU codes, and a SKU code is not a garment anybody recognises.
interface ArticleGroup {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly division: string | null
  readonly image: string | null
  readonly tags: readonly string[]
  readonly needed: number
  readonly available: number | null
  readonly skus: readonly Row[]
}

interface Row {
  readonly demand: Demand
  readonly identity: Identity | undefined
}

/// A picker compacted into a toolbar, the way the allotment matrix does it.
const PICKER = "min-h-8 w-auto max-w-52 px-2.5 text-[0.78125rem]"

/// **The sheet both outbound documents are written on.**
///
/// Picking and packing ask the same question twice, one station apart: *which
/// garments, and how many of each*. Picking asks it of the racks with no shop
/// in mind; packing asks it of the picking area on behalf of one shop. The
/// numbers behind them come from different endpoints and mean different
/// things, and everything a person does with them is identical — search for
/// the article, narrow by division or tag, read the photograph, type a number.
///
/// So it is one component with the demand passed in, rather than two screens
/// that drift apart the first time somebody improves one of them.
///
/// **The list is what is owed, never the whole catalogue.** A composer that
/// opened onto two thousand articles with zero against every one of them would
/// be a search box with a warehouse behind it; this opens onto the work.
export function DemandSheet({
  open,
  onOpenChange,
  title,
  id,
  sub,
  demand,
  neededLabel,
  availableLabel,
  submitLabel,
  submitting,
  error,
  header,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  id?: React.ReactNode
  sub: string
  demand: readonly Demand[]
  /// What the left number means at this station — "owed", "still coming".
  neededLabel: string
  /// What the right number means, where there is one — "picked and free".
  availableLabel?: string
  submitLabel: string
  submitting: boolean
  error: unknown
  /// Anything the station needs settled before the lines make sense: the rack
  /// stock comes off, the shop a carton is for.
  header?: React.ReactNode
  /// The lines, in the order they were typed. Never zero-quantity rows: an
  /// emptied box is a box nobody typed in.
  onSubmit: (lines: readonly { sku_code: string; quantity: number }[]) => void
}) {
  const [needle, setNeedle] = useState("")
  const [divisions, setDivisions] = useState<readonly string[]>([])
  const [tags, setTags] = useState<readonly string[]>([])
  /// The draft, by SKU code. The only state here worth anything — everything
  /// else is a way of deciding where to type.
  const [drawn, setDrawn] = useState<Readonly<Record<string, number>>>({})

  const catalogue = useCatalogueIdentity()

  const rows = useMemo<Row[]>(
    () =>
      demand.map((line) => ({
        demand: line,
        identity: catalogue.get(line.sku_code),
      })),
    [demand, catalogue]
  )

  const sifted = useMemo(() => {
    const wanted = needle.trim().toLowerCase()
    if (wanted === "") return rows
    return rows.filter(
      (row) =>
        row.demand.sku_code.toLowerCase().includes(wanted) ||
        (row.identity?.article_code ?? "").toLowerCase().includes(wanted) ||
        (row.identity?.article_name ?? "").toLowerCase().includes(wanted)
    )
  }, [rows, needle])

  /// Counted over the search and never over the selection, the rule Articles
  /// and the allotment matrix both hold to: ticking MENSWEAR must not make
  /// WOMENSWEAR vanish, or the second choice becomes unreachable.
  const facets = useMemo(() => {
    const byDivision = new Map<string, number>()
    const byTag = new Map<string, number>()
    for (const row of sifted) {
      const division = row.identity?.division_code ?? ""
      if (division !== "")
        byDivision.set(division, (byDivision.get(division) ?? 0) + 1)
      for (const tag of row.identity?.tags ?? [])
        byTag.set(tag, (byTag.get(tag) ?? 0) + 1)
    }
    const sort = (map: Map<string, number>) =>
      [...map.entries()]
        .map(([value, total]) => ({
          value,
          label: `${value} · ${count(total)}`,
        }))
        .sort((left, right) => left.value.localeCompare(right.value))
    return { divisions: sort(byDivision), tags: sort(byTag) }
  }, [sifted])

  const matching = useMemo(
    () =>
      sifted.filter(
        (row) =>
          (divisions.length === 0 ||
            divisions.includes(row.identity?.division_code ?? "")) &&
          (tags.length === 0 ||
            (row.identity?.tags ?? []).some((tag) => tags.includes(tag)))
      ),
    [sifted, divisions, tags]
  )

  /// SKUs folded into their articles, in the order a person browses: by name,
  /// and inside an article by SKU code — which sorts colour then size, because
  /// that is how the code is built.
  const groups = useMemo<ArticleGroup[]>(() => {
    const byArticle = new Map<string, Row[]>()
    for (const row of matching) {
      // A SKU the catalogue has never heard of still has to be pickable: the
      // demand is the node's, and a garment missing from the cloud snapshot is
      // a sync gap, not a reason to hide work.
      const key = row.identity?.article_id ?? `sku:${row.demand.sku_code}`
      const bucket = byArticle.get(key)
      if (bucket) bucket.push(row)
      else byArticle.set(key, [row])
    }
    return [...byArticle.entries()]
      .map(([key, skus]) => {
        const sorted = [...skus].sort((left, right) =>
          left.demand.sku_code.localeCompare(right.demand.sku_code)
        )
        const first = sorted[0].identity
        const available = sorted.every((row) => row.demand.available === null)
          ? null
          : sorted.reduce(
              (total, row) => total + (row.demand.available ?? 0),
              0
            )
        return {
          id: key,
          code: first?.article_code ?? "",
          name: first?.article_name ?? sorted[0].demand.sku_code,
          division: first?.division_code ?? null,
          image: first?.image_url ?? null,
          tags: first?.tags ?? [],
          needed: sorted.reduce((total, row) => total + row.demand.needed, 0),
          available,
          skus: sorted,
        } satisfies ArticleGroup
      })
      .sort((left, right) => left.name.localeCompare(right.name))
  }, [matching])

  const set = useCallback((sku: string, quantity: number) => {
    setDrawn((current) => {
      if (quantity <= 0) {
        if (current[sku] === undefined) return current
        // Deleted rather than set to zero: an emptied box is a box nobody
        // typed in, and the lines are `Object.entries` over this.
        const rest = { ...current }
        delete rest[sku]
        return rest
      }
      if (current[sku] === quantity) return current
      return { ...current, [sku]: quantity }
    })
  }, [])

  const lines = useMemo(
    () =>
      Object.entries(drawn)
        .filter(([, quantity]) => quantity > 0)
        .map(([sku_code, quantity]) => ({ sku_code, quantity })),
    [drawn]
  )
  const pieces = lines.reduce((total, line) => total + line.quantity, 0)

  /// Typed, then filtered out of sight. Never dropped — a filter is a way of
  /// finding a row, not of un-typing one — but said out loud, because a total
  /// that does not match what is on screen is otherwise a defect.
  const hidden = useMemo(() => {
    const shown = new Set(matching.map((row) => row.demand.sku_code))
    return lines
      .filter((line) => !shown.has(line.sku_code))
      .reduce((total, line) => total + line.quantity, 0)
  }, [lines, matching])

  /// Everything still owed, in one gesture, over what is on screen. The
  /// ordinary case at both stations is "fetch all of it" and "send all of it",
  /// and typing forty numbers to say so is forty chances to mistype one.
  const fillAll = () =>
    setDrawn((current) => {
      const next = { ...current }
      for (const group of groups)
        for (const row of group.skus) {
          const most =
            row.demand.available === null
              ? row.demand.needed
              : Math.min(row.demand.needed, row.demand.available)
          if (most > 0) next[row.demand.sku_code] = most
        }
      return next
    })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setDrawn({})
      }}
      width="table"
      id={id}
      title={title}
      footer={
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[0.75rem] text-mute">
            {lines.length === 0
              ? "Nothing drawn yet"
              : `${count(lines.length)} ${lines.length === 1 ? "line" : "lines"} · ${count(pieces)} pieces`}
            {hidden > 0 && (
              <span className="text-warn-fg">
                {" "}
                · {count(hidden)} behind the filter
              </span>
            )}
          </span>
          <div className="flex-1" />
          {lines.length > 0 && (
            <Button variant="ghost" onClick={() => setDrawn({})}>
              Clear
            </Button>
          )}
          <Button
            variant="primary"
            disabled={lines.length === 0 || submitting}
            onClick={() => onSubmit(lines)}
          >
            {submitting ? "Working…" : submitLabel}
          </Button>
        </div>
      }
    >
      <p className="text-[0.78125rem] text-body">{sub}</p>

      {header}

      <Toolbar className="mt-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-line-ico" />
          <input
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
            placeholder="Find an article or SKU"
            aria-label="Find an article or SKU"
            className="h-8 w-52 rounded-full border border-transparent bg-soft-2 pr-3 pl-7 text-[0.78125rem] text-ink transition-colors outline-none placeholder:text-mute hover:border-hairline-2 focus:border-hairline-strong focus:bg-canvas"
          />
        </div>
        <PickMany
          label="Division"
          placeholder="Every division"
          choices={facets.divisions}
          values={divisions}
          onChange={setDivisions}
          className={PICKER}
        />
        <PickMany
          label="Tags"
          placeholder="Any tag"
          choices={facets.tags}
          values={tags}
          onChange={setTags}
          className={PICKER}
        />
        <div className="flex-1" />
        <Button variant="ghost" onClick={fillAll}>
          Draw everything
        </Button>
      </Toolbar>

      {catalogue.size === 0 && demand.length > 0 && (
        <Banner tone="info" className="mt-3">
          The photographs and divisions come from the centre and have not
          arrived yet. The quantities below are this node's own and are correct
          either way.
        </Banner>
      )}

      <div className="mt-3 overflow-hidden rounded-inner border border-hairline">
        <div className="flex h-9 items-stretch border-b border-hairline bg-soft">
          <div className="flex flex-1 items-center px-3 text-eyebrow font-semibold text-mute uppercase">
            Article
          </div>
          <div className="flex w-[5.5rem] shrink-0 items-center justify-end px-2 text-eyebrow font-semibold text-mute uppercase">
            {neededLabel}
          </div>
          {availableLabel !== undefined && (
            <div className="flex w-[5.5rem] shrink-0 items-center justify-end px-2 text-eyebrow font-semibold text-mute uppercase">
              {availableLabel}
            </div>
          )}
          <div className="flex w-[6rem] shrink-0 items-center justify-center px-2 text-eyebrow font-semibold text-mute uppercase">
            Draw
          </div>
        </div>

        {groups.length === 0 ? (
          <EmptyState>
            {demand.length === 0
              ? "Nothing is owed. Every accepted allotment line has been dealt with."
              : "Nothing matches. The filter is hiding every line, not emptying the list."}
          </EmptyState>
        ) : (
          groups.map((group) => (
            <div key={group.id}>
              <div className="flex items-stretch border-b border-hairline bg-soft">
                <div className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2">
                  <Thumbnail
                    url={group.image}
                    className="size-9 shrink-0 rounded-inner"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[0.8125rem] font-medium text-ink">
                        {group.name}
                      </span>
                      {group.division !== null && (
                        <Tag tone="accent">{group.division}</Tag>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 overflow-hidden">
                      {group.code !== "" && (
                        <span className="shrink-0 font-mono text-[0.65625rem] text-faint">
                          {group.code}
                        </span>
                      )}
                      {group.tags.slice(0, 3).map((tag) => (
                        <Tag key={tag} className="shrink-0">
                          {tag}
                        </Tag>
                      ))}
                      {group.tags.length > 3 && (
                        <span className="shrink-0 text-[0.65625rem] text-faint">
                          +{group.tags.length - 3}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex w-[5.5rem] shrink-0 items-center justify-end px-2 text-[0.8125rem] font-medium text-ink tabular-nums">
                  {count(group.needed)}
                </div>
                {availableLabel !== undefined && (
                  <div className="flex w-[5.5rem] shrink-0 items-center justify-end px-2 text-[0.8125rem] text-body tabular-nums">
                    {group.available === null ? "—" : count(group.available)}
                  </div>
                )}
                <div className="flex w-[6rem] shrink-0 items-center justify-center px-2 text-[0.8125rem] font-medium tabular-nums">
                  <ArticleTotal group={group} drawn={drawn} />
                </div>
              </div>

              {group.skus.map((row) => (
                <SkuRow
                  key={row.demand.sku_code}
                  row={row}
                  showAvailable={availableLabel !== undefined}
                  value={drawn[row.demand.sku_code] ?? 0}
                  onChange={(quantity) => set(row.demand.sku_code, quantity)}
                />
              ))}
            </div>
          ))
        )}
      </div>

      <Problem error={error} className="mt-3" />
    </Sheet>
  )
}

function ArticleTotal({
  group,
  drawn,
}: {
  group: ArticleGroup
  drawn: Readonly<Record<string, number>>
}) {
  const total = group.skus.reduce(
    (sum, row) => sum + (drawn[row.demand.sku_code] ?? 0),
    0
  )
  return (
    <span className={total > 0 ? "text-accent" : "text-faint"}>
      {total > 0 ? count(total) : "—"}
    </span>
  )
}

/// One colourway and size, and the number going against it.
///
/// The SKU code is on the row rather than only in the search box, because this
/// is the line a picker reads off a rack ticket — unlike the allotment matrix,
/// where the same code appeared two thousand times and was noise.
function SkuRow({
  row,
  showAvailable,
  value,
  onChange,
}: {
  row: Row
  showAvailable: boolean
  value: number
  onChange: (quantity: number) => void
}) {
  const most =
    row.demand.available === null
      ? row.demand.needed
      : Math.min(row.demand.needed, row.demand.available)
  // Drawing more than can be answered is refused by the node, and finding that
  // out after pressing Create is finding it out too late.
  const over = value > most

  return (
    <div className="flex items-stretch border-b border-hairline last:border-b-0">
      <div className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 pl-[3.625rem]">
        <span className="truncate text-cell text-ink">
          {[row.identity?.colour, row.identity?.size]
            .filter(Boolean)
            .join(" · ") || "—"}
        </span>
        <span className="shrink-0 font-mono text-[0.65625rem] text-faint">
          {row.demand.sku_code}
        </span>
      </div>
      <div className="flex w-[5.5rem] shrink-0 items-center justify-end px-2 text-cell text-body tabular-nums">
        {count(row.demand.needed)}
      </div>
      {showAvailable && (
        <div
          className={cn(
            "flex w-[5.5rem] shrink-0 items-center justify-end px-2 text-cell tabular-nums",
            (row.demand.available ?? 0) === 0 ? "text-faint" : "text-body"
          )}
        >
          {row.demand.available === null ? "—" : count(row.demand.available)}
        </div>
      )}
      <div className="flex w-[6rem] shrink-0 items-center px-2">
        <input
          type="text"
          inputMode="numeric"
          aria-label={`Pieces of ${row.demand.sku_code}`}
          value={value === 0 ? "" : String(value)}
          onChange={(event) => {
            const digits = event.target.value.replace(/\D/g, "")
            onChange(digits === "" ? 0 : Number(digits))
          }}
          onFocus={(event) => event.target.select()}
          className={cn(
            "h-[1.75rem] w-full rounded-inner border border-transparent bg-transparent text-center text-cell tabular-nums transition-colors outline-none",
            "hover:border-hairline-2 hover:bg-soft-2 focus:border-hairline-strong focus:bg-canvas",
            over
              ? "bg-bad-bg font-medium text-bad-fg"
              : value > 0
                ? "bg-accent-bg font-medium text-accent"
                : "text-ink"
          )}
        />
      </div>
    </div>
  )
}
