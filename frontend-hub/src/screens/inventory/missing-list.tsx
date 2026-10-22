import { Radio } from "@base-ui/react/radio"
import { RadioGroup } from "@base-ui/react/radio-group"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ChevronRight,
  Boxes,
  Building2,
  Minus,
  Plus,
  Shirt,
  Store,
  Undo2,
  Warehouse,
  type LucideIcon,
} from "lucide-react"
import { useHydrated } from "@tanstack/react-router"
import { useMemo, useRef, useState } from "react"

import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { FilterChips } from "@/components/ui/filter-chips"
import { Input } from "@/components/ui/field"
import { Kpi, KpiBox, KpiStrip } from "@/components/ui/kpi"
import { CardFigure, CardName, PhoneCard } from "@/components/ui/phone-cards"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { Banner, EmptyState, LoadingState } from "@/components/ui/states"
import { Thumbnail } from "@/components/ui/thumbnail"
import { useColourwayFill } from "@/lib/colourway-fill"
import { count, day, dayMonth, label as humanise, countPcs, sku as skuNumber } from "@/lib/format"
import { useAppNavigate } from "@/lib/navigate"
import { useLayout } from "@/lib/layout"
import { openable } from "@/lib/openable"
import { useCatalogueIdentity, type Identity } from "@/lib/operations/catalogue"
import {
  fleetPoolsQuery,
  idempotencyKey,
  inventoryKeys,
  movementsPage,
  resolveMissing,
  type FleetPool,
  type Movement,
} from "@/lib/queries/inventory"
import { useSiteLabel } from "@/lib/queries/organisation"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import {
  groupMissing,
  placeOfGroup,
  shortRef,
  useMissingRows,
  type MissingGroup,
} from "@/screens/inventory/missing-data"
import { useActor, writablePools } from "@/screens/inventory/shared"
import { pocketNameOf } from "@/screens/inventory/stock-pockets"

/// Missing: one line per article at one place.
///
/// The endpoint answers per tag; a person answers per article, so every
/// missing tag of a SKU at a site is one row here, oldest first. **Found** and
/// **Lost** take a number of pieces and spend it across the group's rows,
/// oldest first — each row is one existing `found` / `lost` call, so nothing
/// new is asked of the server. `canWriteOff` false (Operations' read-only
/// view) shows the record without the two verbs.

const OVERDUE_DAYS = 30

const late = (days: number | null) => days !== null && days > OVERDUE_DAYS

function variantOf(identity: Identity | undefined): string {
  return [identity?.colour, identity?.size]
    .filter((part): part is string => part !== null && part !== undefined)
    .join(" · ")
}

/// Missing date: the date only, red past 30 days.
function Since({ group }: { group: MissingGroup }) {
  return (
    <span className={cn("tabular-nums", late(group.days) && "text-bad-fg")}>
      {group.since === null ? "—" : day(group.since)}
    </span>
  )
}

/// Noticed by, with its document as a way in (owner, 20 Oct 2026): the
/// allotment or the count it went missing on opens from here.
function NoticedBy({ group }: { group: MissingGroup }) {
  const goto = useAppNavigate()
  if (group.from === null) return <span className="text-mute">—</span>
  const doc = group.doc
  return (
    <span className="inline-flex items-center gap-1">
      {group.from}
      {group.fromRef && (
        <span className="text-mute"> · {group.fromRef}</span>
      )}
      {doc !== null && (
        <button
          type="button"
          aria-label={`Open ${group.fromRef ?? group.from}`}
          onClick={(event) => {
            event.stopPropagation()
            goto(doc.path, { key: doc.key, value: doc.value })
          }}
          className="-m-1 rounded-sm p-1 text-mute outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <ChevronRight className="size-4" />
        </button>
      )}
    </span>
  )
}

export function MissingList({ canWriteOff }: { canWriteOff: boolean }) {
  const { query, rows } = useMissingRows()
  // The list is a plain read the server does not draw: wait for the page to
  // hydrate so the server's HTML and the first render agree.
  const hydrated = useHydrated()
  const groups = useMemo(() => groupMissing(rows), [rows])
  const placeName = useSiteLabel()
  const identities = useCatalogueIdentity()
  const fill = useColourwayFill()
  const phone = useLayout() === "phone"
  const [needle, setNeedle] = useState("")
  const [openKey, setOpenKey] = useState<string | null>(null)
  // Lost/Found on a row open the sheet straight on that form.
  const [openMode, setOpenMode] = useState<Mode>("view")
  const open = (key: string, mode: Mode = "view") => {
    setOpenMode(mode)
    setOpenKey(key)
  }
  const actions = (group: MissingGroup) =>
    canWriteOff && !group.nodeOwned && group.left > 0 ? (
      <span
        className="flex justify-end gap-2"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <Button size="sm" variant="danger" onClick={() => open(group.key, "lost")}>
          Lost
        </Button>
        <Button size="sm" variant="tint" onClick={() => open(group.key, "found")}>
          Found
        </Button>
      </span>
    ) : null

  const shown = useMemo(() => {
    const q = needle.trim().toLowerCase()
    if (q === "") return groups
    return groups.filter((group) =>
      [group.name ?? "", group.sku, placeOfGroup(group, placeName)].some((part) =>
        part.toLowerCase().includes(q)
      )
    )
  }, [groups, needle, placeName])

  if (!hydrated || query.isPending)
    return <LoadingState>Reading what is missing…</LoadingState>
  if (query.isError)
    return <Banner tone="bad">The missing list could not be read.</Banner>

  const pieces = groups.reduce((sum, group) => sum + group.left, 0)
  const old = groups.filter((group) => late(group.days)).length
  const red = (value: number) => (
    <span className={value > 0 ? "text-bad-fg" : undefined}>
      {count(value)}
    </span>
  )

  return (
    <>
      <KpiStrip className="xl:grid-cols-4">
        <Kpi
          label="Missing"
          value={<span className={pieces > 0 ? "text-bad-fg" : undefined}>{countPcs(pieces)}</span>}
        />
        <Kpi
          label="Articles"
          value={count(new Set(groups.map((group) => group.sku)).size)}
        />
        <Kpi
          label="Places"
          value={count(new Set(groups.map((group) => group.site)).size)}
        />
        <Kpi label="Over 30 days" value={red(old)} />
      </KpiStrip>

      {phone ? (
        <DockTools
          search={{
            value: needle,
            onChange: setNeedle,
            label: "Search Missing",
          }}
        />
      ) : (
        <div className="mb-3.5">
          <Input
            type="search"
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
            placeholder="Search article, SKU or place"
            aria-label="Search Missing"
            className="max-w-sm"
          />
        </div>
      )}

      <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {shown.length === 0 ? (
          <EmptyState>
            {needle.trim() === "" ? "Nothing missing." : "Nothing here"}
          </EmptyState>
        ) : phone ? (
          <ul className="flex flex-col gap-2.5">
            {shown.map((group) => {
              const identity = identities.get(group.sku)
              const variant = variantOf(identity)
              return (
                <PhoneCard
                  key={group.key}
                  onOpen={() => open(group.key)}
                  head={
                    <CardName
                      name={group.name ?? skuNumber(group.sku)}
                      code={[variant, group.name ? skuNumber(group.sku) : ""]
                        .filter((part) => part !== "")
                        .join(" · ")}
                    />
                  }
                  lead={
                    <CardFigure
                      value={count(group.left)}
                      caption="missing"
                      tone="bad"
                    />
                  }
                  body={
                    <div className="flex flex-col gap-1 text-[0.9375rem]">
                      <span className="text-ink">{placeOfGroup(group, placeName)}</span>
                    </div>
                  }
                  foot={
                    <span className="flex items-center justify-between gap-3">
                      <Since group={group} />
                      {actions(group)}
                    </span>
                  }
                />
              )
            })}
          </ul>
        ) : (
          <table className="w-full border-collapse text-body">
            <colgroup>
              <col />
              <col className="w-[16%]" />
              <col className="w-[7rem]" />
              <col className="w-[16%]" />
              <col className="w-[11rem]" />
            </colgroup>
            <thead>
              <tr className="h-12 border-b border-hairline bg-soft text-left text-[0.9375rem] font-medium text-body">
                <th className="pl-4">Article</th>
                <th>Place</th>
                <th className="text-right">Quantity</th>
                <th className="pl-6">Missing date</th>
                <th className="pr-4" aria-label="Actions" />
              </tr>
            </thead>
            <tbody className="text-[0.9375rem]">
              {shown.map((group) => {
                const identity = identities.get(group.sku)
                const variant = variantOf(identity)
                return (
                  <tr
                    key={group.key}
                    {...openable(() => open(group.key))}
                    onClick={() => open(group.key)}
                    className="h-[4.5rem] cursor-pointer border-b border-hairline last:border-b-0 hover:bg-soft"
                  >
                    <td className="pl-4">
                      <span className="flex min-w-0 items-center gap-3">
                        <Thumbnail
                          url={identity?.image_url ?? null}
                          name={group.name ?? ""}
                          division={identity?.division_code}
                          colours={fill(identity?.colour ?? null)}
                          className="size-10 shrink-0 rounded-[8px]"
                        />
                        <span className="flex min-w-0 flex-col">
                          <span className="leading-snug font-medium text-ink">
                            {group.name ?? skuNumber(group.sku)}
                          </span>
                          <span className="text-mute">
                            {[variant, skuNumber(group.sku)]
                              .filter((part) => part !== "")
                              .join(" · ")}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="text-ink">{placeOfGroup(group, placeName)}</td>
                    <td className="text-right font-semibold text-ink tabular-nums">
                      {count(group.left)}
                    </td>
                    <td className="pl-6">
                      <Since group={group} />
                    </td>
                    <td className="pr-4">{actions(group)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>

      <MissingSheet
        group={groups.find((group) => group.key === openKey) ?? null}
        canResolve={canWriteOff}
        startMode={openMode}
        onClose={() => setOpenKey(null)}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// The record sheet
// ---------------------------------------------------------------------------

/// The pockets a place has, and the pool each one is. HO: Unallotted (its
/// stockroom) and Return; a store: Floor, Stockroom and Return.
interface Pocket {
  readonly name: string
  readonly icon: LucideIcon
  readonly pool: FleetPool
}

function pocketsOf(pools: readonly FleetPool[], siteId: string): Pocket[] {
  const here = pools
    .filter((pool) => pool.site_id === siteId)
    .sort((a, b) => a.display_order - b.display_order)
  const ho = here.some((pool) => pool.site_kind !== "STORE")
  const wanted: readonly {
    name: string
    icon: LucideIcon
    codes: readonly string[]
  }[] = ho
    ? [
        { name: "Unallotted", icon: Boxes, codes: ["WAREHOUSE"] },
        { name: "Return", icon: Undo2, codes: ["REJECT", "DC_REJECT"] },
      ]
    : [
        { name: "Floor", icon: Shirt, codes: ["FLOOR"] },
        { name: "Stockroom", icon: Warehouse, codes: ["WAREHOUSE"] },
        { name: "Return", icon: Undo2, codes: ["REJECT", "STORE_REJECT"] },
      ]
  const out: Pocket[] = []
  for (const one of wanted) {
    const pool = here.find((candidate) =>
      one.codes.includes(candidate.pool_code)
    )
    if (pool) out.push({ name: one.name, icon: one.icon, pool })
  }
  return out
}

const TH = "h-11 text-left text-[0.9375rem] font-medium text-body"

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-3 text-card-title font-semibold text-ink">{children}</h3>
  )
}

/// One missing article's record, opened over whatever list it came from:
/// the Missing page, or a place's Missing tab on Stock.
export function MissingSheet({
  group,
  canResolve,
  startMode = "view",
  onClose,
}: {
  group: MissingGroup | null
  canResolve: boolean
  startMode?: Mode
  onClose: () => void
}) {
  // The sheet keeps its last record while it slides away.
  const held = useRef(group)
  if (group !== null) held.current = group
  const shown = group ?? held.current
  if (shown === null) return null
  return (
    <MissingRecord
      key={`${shown.key}:${startMode}`}
      group={shown}
      open={group !== null}
      canResolve={canResolve}
      startMode={startMode}
      onClose={onClose}
    />
  )
}

/// What the Missing foot lets a person do, and the form it swaps in.
type Mode = "view" | "found" | "lost"

function MissingRecord({
  group,
  open,
  canResolve,
  startMode,
  onClose,
}: {
  group: MissingGroup
  open: boolean
  canResolve: boolean
  startMode: Mode
  onClose: () => void
}) {
  const client = useQueryClient()
  const actor = useActor()
  const placeName = useSiteLabel()
  const identities = useCatalogueIdentity()
  const variant = variantOf(identities.get(group.sku))
  const [mode, setMode] = useState<Mode>(startMode)
  const [pieces, setPieces] = useState(1)
  const [loc, setLoc] = useState<string | null>(null)
  const [pocketName, setPocketName] = useState<string | null>(null)

  const fleet = useQuery(fleetPoolsQuery())
  const pools = useMemo(
    () => writablePools(fleet.data?.items ?? []),
    [fleet.data]
  )
  const sites = useMemo(() => {
    const seen = new Map<string, FleetPool>()
    for (const pool of pools)
      if (!seen.has(pool.site_id)) seen.set(pool.site_id, pool)
    // Only places a piece can be put back into: a shop run by its own
    // server books its own shelves, so it offers no pocket here.
    return [...seen.values()]
      .filter((pool) => pocketsOf(pools, pool.site_id).length > 0)
      .map((pool) => ({
        id: pool.site_id,
        ho: pool.site_kind !== "STORE",
        label: placeName(pool.site_id),
      }))
      .sort((a, b) =>
        a.ho === b.ho ? a.label.localeCompare(b.label) : a.ho ? -1 : 1
      )
  }, [pools, placeName])

  const site =
    loc ??
    (sites.some((one) => one.id === group.site)
      ? group.site
      : (sites[0]?.id ?? group.site))
  const pockets = useMemo(() => pocketsOf(pools, site), [pools, site])
  // Default: the pocket it went missing from.
  const wentFrom = pockets.find((one) => one.pool.id === group.pool)?.name
  const pocket =
    pockets.find((one) => one.name === (pocketName ?? wentFrom)) ?? pockets[0]

  const history = useQuery({
    queryKey: inventoryKeys.movements({
      q: group.sku,
      pool_id: group.pool,
      limit: 100,
    }),
    queryFn: ({ signal }) =>
      movementsPage({ q: group.sku, pool_id: group.pool, limit: 100 }, signal),
  })

  const resolve = useMutation({
    mutationFn: async (kind: "found" | "lost") => {
      let remaining = pieces
      for (const row of group.rows) {
        if (remaining <= 0) break
        const take = Math.min(remaining, row.quantity)
        const destination = kind === "found" ? pocket?.pool.id : undefined
        await resolveMissing(row.id, kind, {
          actor_id: actor,
          idempotency_key: idempotencyKey(),
          quantity: take,
          destination_pool_id:
            destination !== undefined && destination !== row.origin_pool
              ? destination
              : null,
          reason: kind === "found" ? "Found" : "Written off",
          reference: null,
        })
        remaining -= take
      }
    },
    onSuccess: (_done, kind) => {
      const where =
        pocket === undefined
          ? ""
          : site === group.site
            ? pocket.name
            : `${pocket.name} · ${placeName(site)}`
      toast.success(
        kind === "found"
          ? `${countPcs(pieces)} moved to ${where}`
          : `${countPcs(pieces)} marked lost`,
        {
          description: [group.name ?? group.sku, placeOfGroup(group, placeName)].join(
            " · "
          ),
        }
      )
      setMode("view")
      setPieces(1)
      if (pieces >= group.left) onClose()
    },
    onSettled: () => {
      client.invalidateQueries({ queryKey: inventoryKeys.missing() })
      client.invalidateQueries({ queryKey: inventoryKeys.fleet() })
      client.invalidateQueries({ queryKey: inventoryKeys.movements() })
      client.invalidateQueries({ queryKey: ["inventory", "pools"] })
    },
  })

  const days = group.days
  const red = (node: React.ReactNode, on: boolean) => (
    <span className={on ? "text-bad-fg" : undefined}>{node}</span>
  )
  const figures = (
    <KpiBox
      items={[
        { label: "Missing", value: red(`${countPcs(group.left)}`, true) },
        {
          label: "Since",
          value: red(group.since === null ? "—" : day(group.since), late(days)),
        },
        {
          label: "Days",
          value: red(days === null ? "—" : count(days), late(days)),
        },
        {
          label: "Lost in",
          value: (() => {
            const items = fleet.data?.items ?? []
            const pool = items.find((one) => one.id === group.pool)
            return pool ? pocketNameOf(pool, items) : group.poolLabel || "—"
          })(),
        },
        { label: "Noticed by", value: <NoticedBy group={group} /> },
      ]}
    />
  )

  // What the foot says -------------------------------------------------------
  const destinationWords =
    pocket === undefined
      ? "…"
      : site === group.site
        ? pocket.name
        : `${pocket.name} · ${placeName(site)}`
  const foot =
    mode === "view" ? (
      canResolve && !group.nodeOwned && group.left > 0 ? (
        <SheetFooter
          secondary={
            <Button variant="danger" onClick={() => setMode("lost")}>
              Lost
            </Button>
          }
          primary={
            <Button variant="primary" onClick={() => setMode("found")}>
              Found
            </Button>
          }
        />
      ) : undefined
    ) : (
      <SheetFooter
        error={resolve.error}
        onCancel={() => {
          resolve.reset()
          setMode("view")
        }}
        cancelLabel="Back"
        primary={
          mode === "found" ? (
            <Button
              variant="primary"
              pending={resolve.isPending}
              disabled={actor === "" || pocket === undefined}
              onClick={() => resolve.mutate("found")}
            >
              Move {countPcs(pieces)} to {destinationWords}
            </Button>
          ) : (
            <Button
              variant="destructive"
              pending={resolve.isPending}
              disabled={actor === ""}
              onClick={() => resolve.mutate("lost")}
            >
              Mark {countPcs(pieces)} lost
            </Button>
          )
        }
      />
    )

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      size="wide"
      title={group.name ?? skuNumber(group.sku)}
      caption={[variant, skuNumber(group.sku), placeOfGroup(group, placeName)]
        .filter((part) => part !== "")
        .join(" · ")}
      footer={foot}
    >
      <div className="flex flex-col gap-6">
        {/* The figures under the title, as every record sheet has them —
            beside it they squeezed the article's name onto three lines. */}
        {figures}
        {mode === "view" ? (
          <RecordBody
            group={group}
            history={history.data?.rows}
            done={history.isSuccess}
            more={history.data?.next_cursor != null}
          />
        ) : (
          <div className="flex flex-col gap-6">
            <div>
              <SectionTitle>Pieces</SectionTitle>
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Fewer"
                  disabled={pieces <= 1}
                  onClick={() => setPieces(pieces - 1)}
                >
                  <Minus />
                </Button>
                <b className="min-w-8 text-center text-[1.125rem] tabular-nums">
                  {pieces}
                </b>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="More"
                  disabled={pieces >= group.left}
                  onClick={() => setPieces(pieces + 1)}
                >
                  <Plus />
                </Button>
                <span className="text-[0.9375rem] text-mute">
                  of {count(group.left)} missing
                </span>
              </div>
            </div>
            {mode === "found" && (
              <>
                <div>
                  <SectionTitle>Location</SectionTitle>
                  <FilterChips
                    label="Location"
                    value={site}
                    onChange={(next) => {
                      if (next !== null) setLoc(next)
                    }}
                    options={sites.map((one) => ({
                      value: one.id,
                      label: one.label,
                      icon: one.ho ? Building2 : Store,
                    }))}
                  />
                </div>
                <div>
                  <SectionTitle>Pocket</SectionTitle>
                  <RadioGroup
                    aria-label="Pocket"
                    value={pocket?.name ?? ""}
                    onValueChange={(next) => setPocketName(next as string)}
                    className="grid grid-cols-3 gap-2.5 max-md:grid-cols-1"
                  >
                    {pockets.map((one) => {
                      const on = one.name === pocket?.name
                      const Glyph = one.icon
                      return (
                        <Radio.Root
                          key={one.name}
                          value={one.name}
                          className={cn(
                            "flex h-14 cursor-pointer items-center gap-2.5 rounded-card border px-4 text-[0.9375rem] font-medium transition-[background-color,border-color,color,scale] duration-(--t-press) ease-(--ease-out) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-[0.98]",
                            on
                              ? "border-accent bg-accent-bg text-accent"
                              : "border-hairline-2 bg-canvas text-ink hover:bg-soft-2"
                          )}
                        >
                          <Glyph
                            aria-hidden
                            className={cn(
                              "size-5 stroke-[1.7]",
                              on ? "text-accent" : "text-body"
                            )}
                          />
                          {one.name}
                        </Radio.Root>
                      )
                    })}
                  </RadioGroup>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </Sheet>
  )
}

/// History: the ledger's account of how the pieces went missing.
function RecordBody({
  group,
  history,
  done,
  more,
}: {
  group: MissingGroup
  history: readonly Movement[] | undefined
  done: boolean
  more: boolean
}) {
  // Oldest first, with the Missing balance running after every line. Only
  // shown when the read reached the start of the ledger for this pool.
  const lines = useMemo(() => {
    // Only the pieces that went missing: every other piece of the SKU in
    // the pocket was a page of Opening lines nobody asked about.
    const mine = new Set(group.rows.map((row) => row.subject_id))
    const ordered = [...(history ?? [])]
      .filter((move) => mine.has(move.subject_id))
      .reverse()
    let running = 0
    return ordered.map((move) => {
      const into = move.to.endsWith(":missing")
      const out = move.from.endsWith(":missing")
      const change = into ? move.quantity : out ? -move.quantity : 0
      running += change
      return { move, change, running }
    })
  }, [history, group.rows])

  return (
    <>
      <section>
        <SectionTitle>History</SectionTitle>
        {!done ? (
          <LoadingState>Reading the history…</LoadingState>
        ) : lines.length === 0 ? (
          <EmptyState>Nothing has been posted for this SKU.</EmptyState>
        ) : (
          <div className="overflow-hidden rounded-card border border-hairline">
            <table className="w-full border-collapse text-[0.9375rem]">
              <colgroup>
                <col className="w-[7rem]" />
                <col />
                <col className="w-[16%] max-md:hidden" />
                <col className="w-[18%] max-md:hidden" />
                <col className="w-[7.5rem]" />
              </colgroup>
              <thead>
                <tr className="border-b border-hairline bg-soft">
                  <th className={cn(TH, "pl-4")}>Date</th>
                  <th className={TH}>What</th>
                  <th className={cn(TH, "max-md:hidden")}>Document</th>
                  <th className={cn(TH, "max-md:hidden")}>By</th>
                  <th className={cn(TH, "pr-4 text-right")}>Missing</th>
                </tr>
              </thead>
              <tbody>
                {lines.map(({ move, change, running }) => {
                  const hit = change > 0
                  return (
                    <tr
                      key={move.movement_id}
                      className={cn(
                        "h-12 border-b border-hairline last:border-b-0",
                        hit && "bg-bad-bg/50"
                      )}
                    >
                      <td
                        className={cn(
                          "pl-4 tabular-nums",
                          hit ? "text-bad-fg" : "text-mute"
                        )}
                      >
                        {day(move.occurred_at)}
                      </td>
                      <td className="py-2 text-ink">
                        {humanise(move.cause)}
                        {hit && (
                          <span className="text-bad-fg"> · into Missing</span>
                        )}
                      </td>
                      <td className="text-mute max-md:hidden">
                        {move.reference_type === "OFFICIAL_COUNT"
                          ? `Count · ${dayMonth(move.occurred_at)}`
                          : move.allotment_id !== null &&
                              move.allotment_id === group.doc?.value
                            ? (group.fromRef ?? "—")
                            : (shortRef(move.reference_id ?? null) ?? "—")}
                      </td>
                      <td className="text-mute max-md:hidden">
                        {move.actor_id}
                      </td>
                      <td
                        className={cn(
                          "pr-4 text-right tabular-nums",
                          hit && "text-bad-fg"
                        )}
                      >
                        {change === 0 ? (
                          <span className="text-mute">—</span>
                        ) : (
                          <>
                            <span className="font-semibold">
                              {change > 0 ? "+" : "−"}
                              {count(Math.abs(change))}
                            </span>
                            {!more && (
                              <span className="font-normal text-mute">
                                {" "}
                                → {count(running)}
                              </span>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
