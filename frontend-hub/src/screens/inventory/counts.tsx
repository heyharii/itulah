import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { Suspense, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { DayRange, type DayWindow } from "@/components/ui/day-range"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { Thumbnail } from "@/components/ui/thumbnail"
import { today } from "@/lib/calendar"
import { count, day, sku as skuNumber } from "@/lib/format"
import {
  approveCount,
  countDetail,
  countsBookQuery,
  fleetPoolsQuery,
  idempotencyKey,
  inventoryKeys,
  type CountDetail,
  type CountKind,
  type CountRow,
  type FleetPool,
} from "@/lib/queries/inventory"
import { queryState } from "@/lib/query-state"
import { useSiteLabel } from "@/lib/queries/organisation"
import { useSheet } from "@/lib/sheets"
import { useCatalogueIdentity } from "@/lib/operations/catalogue"
import { cn } from "@/lib/utils"
import { ITEMS_CELL, ITEMS_HEAD } from "@/screens/procurement/items-table"
import {
  placements,
  signed,
  sitesOf,
  useActor,
} from "@/screens/inventory/shared"

/// Counts. A count is a task for the RFID device: New count sends it, the
/// device counts, and the result comes back with its lines per SKU. There is no
/// draft, no counting and no review on this screen (owner, 19 Oct 2026:
/// "terlalu ribet … count kita pakai RFID") — a count is To do until it is
/// Done.
///
/// The backend still has a REVIEW step whose approval books the result. With no
/// review on screen, a count that reaches REVIEW shows one primary, "Apply
/// count", which is that approval; it is Done afterwards.

/// A count is Done once it is closed; everything else is still to do.
const isDone = (status: CountRow["status"]) => status === "CLOSED"

/// The result exists once the device has answered.
const hasResult = (status: CountRow["status"]) =>
  status === "REVIEW" || status === "CLOSED"

const DUE_DAYS = 30

/// This many days ago, as an ISO day.
function daysBefore(iso: string, days: number): string {
  const at = new Date(`${iso}T00:00:00`)
  at.setDate(at.getDate() - days)
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
}

/// The window the page opens on: 1 September to today.
function defaultWindow(): DayWindow {
  const now = today()
  const year = Number(now.slice(0, 4))
  const month = Number(now.slice(5, 7))
  return { from: `${month >= 9 ? year : year - 1}-09-01`, to: now }
}

const dayOf = (iso: string) => iso.slice(0, 10)

/// A pool id read as the place and the shelf the rest of the hub calls it.
type PoolNames = ReadonlyMap<string, { site: string; pool: string }>

function poolNamesOf(
  items: readonly FleetPool[],
  placeName: (siteId: string) => string
): PoolNames {
  return new Map(
    items.map((pool) => [
      pool.id,
      { site: placeName(pool.site_id), pool: pool.label },
    ])
  )
}

/// Counted, red with its gap beside it when it does not match the book.
export function CountedCell({
  expected,
  found,
}: {
  expected: number
  found: number
}) {
  const difference = found - expected
  if (difference === 0) return <span className="text-ink">{count(found)}</span>
  return (
    <span className="text-bad-fg">
      {count(found)} <span className="font-medium">({signed(difference)})</span>
    </span>
  )
}

function differenceCell(expected: number, found: number, shown = true) {
  if (!shown) return <span className="text-mute">—</span>
  const difference = found - expected
  return (
    <span
      className={cn(
        "tabular-nums",
        difference < 0 ? "text-bad-fg" : "text-mute"
      )}
    >
      {difference === 0 ? "—" : signed(difference)}
    </span>
  )
}

const KIND_WORD: Record<CountKind, string> = {
  FULL: "Full",
  CYCLE: "Pocket",
  TARGETED: "Targeted",
}

export function Counts() {
  const sheet = useSheet("count")

  return (
    <PageContent>
      <PageHeader
        title="Counts"
        small
      />


      <Suspense
        fallback={<LoadingState>Reading the count board…</LoadingState>}
      >
        <CountBoard />
      </Suspense>

      <CountSheet id={sheet.value ?? null} onClose={sheet.close} />
    </PageContent>
  )
}

function CountBoard() {
  const sheet = useSheet("count")
  const [range, setRange] = useState<DayWindow>(defaultWindow)

  const fleet = useSuspenseQuery(fleetPoolsQuery())
  const placeName = useSiteLabel()
  const names = useMemo(
    () => poolNamesOf(fleet.data.items, placeName),
    [fleet.data, placeName]
  )

  // Newest first; the server's house order is created_at, newest first.
  const board = useSuspenseInfiniteQuery(
    countsBookQuery({ sort: "created_at", desc: true })
  )
  const rows = useMemo(
    () => board.data.pages.flatMap((page) => page.rows),
    [board.data]
  )

  // Newest first, whatever order the pages arrive in.
  const shown = useMemo(
    () =>
      rows
        .filter((row) => {
          const at = dayOf(row.created_at)
          return (
            (range.from === "" || at >= range.from) &&
            (range.to === "" || at <= range.to)
          )
        })
        .sort((left, right) => right.created_at.localeCompare(left.created_at)),
    [rows, range]
  )

  const month = today().slice(0, 7)
  const doneThisMonth = rows.filter(
    (row) =>
      isDone(row.status) &&
      dayOf(row.closed_at ?? row.created_at).startsWith(month)
  ).length

  // A place is due when none of its pools has ever been counted, or the newest
  // count is older than a month.
  const due = useMemo(() => {
    const limit = daysBefore(today(), DUE_DAYS)
    return sitesOf(placements(fleet.data.items)).filter((site) => {
      const newest = placements(fleet.data.items)
        .filter((pool) => pool.site_id === site.site_id)
        .map((pool) => pool.last_counted_at)
        .filter((at): at is string => typeof at === "string")
        .reduce<string | null>(
          (best, at) => (best === null || at > best ? at : best),
          null
        )
      return newest === null || dayOf(newest) < limit
    }).length
  }, [fleet.data])

  return (
    <>
      <KpiStrip className="grid-cols-2 md:grid-cols-2 xl:grid-cols-2">
        <Kpi label="Counted this month" value={count(doneThisMonth)} />
        <Kpi label="Due" value={count(due)} />
      </KpiStrip>

      <div className="mt-5 mb-3 flex flex-wrap items-center gap-2">
        <DayRange
          label="Period"
          placeholder="Period"
          value={range}
          onChange={setRange}
          className="h-control min-h-0 w-52 shrink-0 py-0"
        />
      </div>

      {shown.length === 0 ? (
        <EmptyState>No counts in these dates.</EmptyState>
      ) : (
        <div className="items-box overflow-hidden rounded-inner border border-hairline">
          <table className="w-full table-fixed border-collapse">
            <colgroup>
              {/* On a phone the place stands under the date, one cell: four
                  columns in 382px cut the date into the place's name */}
              <col className="w-[7.5rem] max-md:w-auto" />
              <col className="max-md:hidden" />
              <col className="w-[14rem] max-md:hidden" />
              <col className="w-[6.5rem] max-lg:hidden" />
              <col className="w-[8.5rem] max-md:w-[6.5rem]" />
            </colgroup>
            <thead>
              <tr>
                <th className={cn(ITEMS_HEAD, "text-left")}>
                  Date<span className="md:hidden"> · Place</span>
                </th>
                <th className={cn(ITEMS_HEAD, "text-left max-md:hidden")}>
                  Place
                </th>
                <th className={cn(ITEMS_HEAD, "text-left max-md:hidden")}>
                  Count
                </th>
                <th className={cn(ITEMS_HEAD, "text-right max-lg:hidden")}>
                  Book
                </th>
                <th className={cn(ITEMS_HEAD, "text-right")}>Counted</th>
              </tr>
            </thead>
            <tbody className="[&>tr:first-child>td]:border-t-0">
              {shown.map((row) => {
                const name = names.get(row.pool_id)
                const done = hasResult(row.status)
                return (
                  <tr
                    key={row.id}
                    className={cn(
                      "cursor-pointer transition-colors hover:bg-soft",
                      row.id === sheet.value && "bg-accent-bg"
                    )}
                    onClick={() => sheet.open(row.id)}
                  >
                    <td
                      className={cn(
                        ITEMS_CELL,
                        "whitespace-nowrap text-ink tabular-nums"
                      )}
                    >
                      {day(row.created_at)}
                      <span className="block truncate text-mute md:hidden">
                        {name?.site ?? row.site_id}
                      </span>
                    </td>
                    <td
                      className={cn(
                        ITEMS_CELL,
                        "truncate text-ink max-md:hidden"
                      )}
                    >
                      {name?.site ?? row.site_id}
                    </td>
                    <td
                      className={cn(
                        ITEMS_CELL,
                        "truncate text-ink max-md:hidden"
                      )}
                    >
                      {KIND_WORD[row.kind]}
                      <span className="text-mute"> · {row.id.slice(0, 8)}</span>
                    </td>
                    <td
                      className={cn(
                        ITEMS_CELL,
                        "text-right text-ink tabular-nums max-lg:hidden"
                      )}
                    >
                      {done ? count(row.expected) : "—"}
                    </td>
                    <td
                      className={cn(
                        ITEMS_CELL,
                        "text-right tabular-nums"
                      )}
                    >
                      {done ? <CountedCell expected={row.expected} found={row.found} /> : "—"}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {board.hasNextPage && (
        <div className="flex justify-center py-3">
          <Button
            variant="ghost"
            pending={board.isFetchingNextPage}
            onClick={() => board.fetchNextPage()}
          >
            Show more
          </Button>
        </div>
      )}
    </>
  )
}

/// One count. Without a result it says where it is — on the RFID device; with
/// one, the figures and the lines per SKU, short ones first. A count in REVIEW
/// carries the one verb, "Apply count".
function CountSheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const actor = useActor()

  const detail = useQuery({
    queryKey: inventoryKeys.count(id ?? ""),
    queryFn: ({ signal }) => countDetail(id!, signal),
    enabled: id !== null,
  })
  const fleet = useQuery(fleetPoolsQuery())
  const placeName = useSiteLabel()
  const names = useMemo(
    () => poolNamesOf(fleet.data?.items ?? [], placeName),
    [fleet.data, placeName]
  )

  const approve = useMutation({
    mutationFn: () =>
      approveCount(id!, { actor_id: actor, idempotency_key: idempotencyKey() }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: inventoryKeys.counts() })
      client.invalidateQueries({ queryKey: inventoryKeys.fleet() })
      client.invalidateQueries({ queryKey: inventoryKeys.missing() })
      client.invalidateQueries({ queryKey: ["inventory", "pools"] })
    },
  })

  const data = detail.data
  const name = data === undefined ? undefined : names.get(data.pool_id)

  const footer =
    data !== undefined &&
    data.status === "REVIEW" &&
    data.edge_adjustment_status === null ? (
      <SheetFooter
        error={approve.error}
        primary={{
          label: "Apply count",
          onClick: () => approve.mutate(),
          pending: approve.isPending,
          disabled: actor === "",
        }}
      />
    ) : undefined

  return (
    <Sheet
      open={id !== null}
      subject={id === null ? undefined : { kind: "count", id }}
      onOpenChange={(open) => !open && onClose()}
      id={name?.site ?? data?.site_id}
      title={
        data === undefined
          ? "Count"
          : `${KIND_WORD[data.kind]} count · ${name?.pool ?? data.pool_id}`
      }
      footer={footer}
      width="wide"
    >
      {queryState(detail, {
        loading: "Opening the count…",
        render: (data) =>
          hasResult(data.status) ? (
            <Result data={data} />
          ) : (
            <div className="flex flex-col gap-6">
              <KpiStrip className="mb-2!">
                <Kpi label="Place" value={name?.site ?? data.site_id} />
                <Kpi label="Count" value={KIND_WORD[data.kind]} />
                <Kpi label="Sent" value={day(data.created_at)} />
              </KpiStrip>
              <EmptyState>On the RFID device</EmptyState>
            </div>
          ),
      })}
    </Sheet>
  )
}

function Result({ data }: { data: CountDetail }) {
  return (
    <div className="flex flex-col gap-6">
      {data.edge_adjustment_status === "REJECTED" && (
        <p className="rounded-inner border border-bad-fg/30 bg-bad-bg px-4 py-3 text-bad-fg">
          Not applied: {data.edge_adjustment_reason ?? "the store refused it"}.
          Nothing was booked; count this place again.
        </p>
      )}
      <KpiStrip className="mb-2!">
        <Kpi label="Book" value={count(data.summary.expected)} />
        <Kpi label="Counted" value={count(data.summary.found)} />
        <Kpi
          label="Difference"
          value={differenceCell(data.summary.expected, data.summary.found)}
        />
        <Kpi label="By" value={data.created_by} />
      </KpiStrip>
      {data.lines.length === 0 ? (
        <EmptyState>Nothing was counted.</EmptyState>
      ) : (
        <CountItems lines={data.lines} />
      )}
    </div>
  )
}

/// The articles of a count, one row per SKU: Book, Counted, Difference, the
/// short ones first.
function CountItems({ lines }: { lines: CountDetail["lines"] }) {
  // A count line names only its SKU code; the catalogue gives the variant and
  // the photograph, so a line reads "Article · Variant" with its picture.
  const identities = useCatalogueIdentity()
  const skus = useMemo(() => {
    const by = new Map<
      string,
      {
        sku: string
        name: string | null
        photo: string | null
        book: number
        counted: number
      }
    >()
    for (const line of lines) {
      const identity = identities.get(line.sku_code)
      const variant = [identity?.colour, identity?.size]
        .filter(
          (part): part is string =>
            part !== null && part !== undefined && part !== ""
        )
        .join(" · ")
      const article = line.article_name ?? identity?.article_name ?? null
      const one = by.get(line.sku_code) ?? {
        sku: line.sku_code,
        name:
          article === null
            ? null
            : variant === ""
              ? article
              : `${article} · ${variant}`,
        photo: identity?.image_url ?? null,
        book: 0,
        counted: 0,
      }
      one.book += line.expected_quantity
      one.counted += line.found_quantity
      by.set(line.sku_code, one)
    }
    return [...by.values()].sort(
      (left, right) =>
        left.counted - left.book - (right.counted - right.book) ||
        (left.name ?? left.sku).localeCompare(right.name ?? right.sku)
    )
  }, [lines, identities])

  return (
    <div className="items-box overflow-hidden rounded-inner border border-hairline">
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col />
          <col className="w-[6rem] md:w-[8rem]" />
          <col className="w-[6rem] md:w-[8rem]" />
          <col className="w-[7rem] md:w-[9rem]" />
        </colgroup>
        <thead>
          <tr>
            <th className={cn(ITEMS_HEAD, "text-left")}>Article</th>
            <th className={cn(ITEMS_HEAD, "text-right")}>Book</th>
            <th className={cn(ITEMS_HEAD, "text-right")}>Counted</th>
            <th className={cn(ITEMS_HEAD, "text-right")}>Difference</th>
          </tr>
        </thead>
        <tbody className="[&_tr:first-child_td]:border-t-0">
          {skus.map((one, at) => (
            <tr key={one.sku}>
              <td className={ITEMS_CELL}>
                <div className="flex min-w-0 items-center gap-3">
                  <Thumbnail
                    url={one.photo}
                    name={one.name ?? one.sku}
                    division={null}
                    fallback="—"
                    className="size-10 shrink-0 rounded-inner"
                    eager={at < 24}
                  />
                  <div className="flex min-w-0 flex-col">
                    <span className="line-clamp-2 text-ink">
                      {one.name ?? skuNumber(one.sku)}
                    </span>
                    <span className="truncate text-[0.9375rem] text-mute">
                      {skuNumber(one.sku)}
                    </span>
                  </div>
                </div>
              </td>
              <td
                className={cn(
                  ITEMS_CELL,
                  "text-right whitespace-nowrap text-ink tabular-nums"
                )}
              >
                {count(one.book)}
              </td>
              <td
                className={cn(
                  ITEMS_CELL,
                  "text-right whitespace-nowrap text-ink tabular-nums"
                )}
              >
                {count(one.counted)}
              </td>
              <td
                className={cn(
                  ITEMS_CELL,
                  "text-right font-medium whitespace-nowrap tabular-nums"
                )}
              >
                {differenceCell(one.book, one.counted)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
