import { useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Checkbox, Input } from "@/components/ui/field"
import { DockedFilters } from "@/components/ui/list-chrome"
import { Meter } from "@/components/ui/meter"
import { PageHeader } from "@/components/ui/page-header"
import { Status } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import {
  matches,
  useFilterState,
  type FilterField,
  type FilterKind,
} from "@/lib/filters"
import { count, day, money, moment } from "@/lib/format"
import {
  changeKeys,
  describeChangeKind,
  describeChangeStatus,
  eventKeys,
  listPriceChanges,
  listPriceEvents,
  needsAttention,
  type ChangeLens,
  type PriceChange,
} from "@/lib/queries/changes"
import {
  commercialFleet,
  commercialKeys,
  priceBookDetail,
} from "@/lib/queries/commercial"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { Named, Quiet } from "@/screens/commercial/parts"
import { ROOMY } from "@/screens/operations/roomy"

/// Changes — the pricing work that is not finished.
///
/// **This screen is a queue, not an archive.** Its default list is outstanding
/// operational work, which is deliberately NOT the same as "its window is
/// open": a regular price change every shop has activated drops off the day it
/// finishes even though its window never closes, and a markdown whose period
/// ended in September with two shops that never switched stays on, because the
/// period ending did not activate those two tills. That rule lives in the
/// server (`postgres/price_changes.rs`) and this screen does not second-guess
/// it — `Settled` asks the server a different question rather than filtering
/// the answer to this one.
///
/// ## Why there is no Markdown menu, and no Clearance menu
///
/// A markdown, a clearance, a correction and a regular re-price are the same
/// kind of object with different intent behind it, and they are worked from one
/// queue. Four menu rows would split that queue four ways and hide the thing
/// worth seeing — that two of the four are indistinguishable in the data, which
/// is exactly why `ChangeKind` is authored by whoever cuts the book rather than
/// guessed from its name. Here it is a column and a filter.
///
/// ## The two dimensions are drawn as two columns, on purpose
///
/// `Period` is the business decision and `Rollout` is what the shops did about
/// it. UI-001 §6 forbids collapsing them, and a reader can see why in one
/// glance down the list: the rows that need somebody are the ones where the
/// two disagree.
function lensOf(change: PriceChange, lens: ChangeLens): boolean {
  switch (lens) {
    case "SCHEDULED":
      return change.status === "SCHEDULED"
    case "ACTIVE":
      return change.status === "ACTIVE"
    case "ATTENTION":
      return needsAttention(change)
    default:
      return true
  }
}

/// What the rail may ask, and how each question is answered off a row.
///
/// Declared here rather than as `meta.filter` on the columns — the same split
/// the order book uses. A column is what the table DRAWS; a field is what
/// somebody may ASK. They are nearly the same list and not quite: "shops
/// outstanding" is a question worth asking and not a column worth a heading,
/// because the Rollout cell already says it in words.
///
/// The narrowing happens in the browser, and that is a deliberate exception to
/// the order book's rule that clauses become request parameters. The endpoint
/// answers one question — settled or not — and returns the whole queue, which
/// is tens of rows, not a year of purchasing. Sending these to the server would
/// mean inventing five query parameters for a list that fits in a browser twice
/// over. If this list ever grows past what a page can hold, this is the comment
/// that has to be deleted along with `narrow` below.
const READ: Record<string, (row: PriceChange) => unknown> = {
  kind: (row) => describeChangeKind(row.kind),
  period: (row) => describeChangeStatus(row.status),
  published: (row) => row.published_by ?? "",
  articles: (row) => row.article_count,
  shops: (row) => row.rollout.pending + row.rollout.failed,
  failed: (row) => row.rollout.failed,
}

const KINDS: Record<string, FilterKind> = {
  kind: "option",
  period: "option",
  published: "option",
  articles: "number",
  shops: "number",
  failed: "number",
}

const FIELDS: readonly FilterField[] = [
  {
    column: "period",
    label: "Period",
    // A fixed set, not the values present. A list with nothing scheduled on it
    // should still offer Scheduled — a facet that disappears when its count
    // reaches nought is a filter people conclude does not exist.
    spec: {
      kind: "option",
      options: [
        { value: "Scheduled", label: "Scheduled" },
        { value: "Active", label: "Active" },
        { value: "Ended", label: "Ended" },
      ],
    },
  },
  {
    column: "kind",
    label: "Kind",
    spec: {
      kind: "option",
      options: [
        { value: "Regular price change", label: "Regular price change" },
        { value: "Markdown", label: "Markdown" },
        { value: "Clearance", label: "Clearance" },
        { value: "Correction", label: "Correction" },
        { value: "Unclassified", label: "Unclassified" },
      ],
    },
  },
  { column: "published", label: "Published by", spec: { kind: "option" } },
  {
    column: "articles",
    label: "Articles",
    spec: { kind: "number", unit: "articles" },
  },
  {
    column: "shops",
    label: "Stores outstanding",
    spec: { kind: "number", unit: "stores" },
  },
  {
    column: "failed",
    label: "Stores failed",
    spec: { kind: "number", unit: "stores" },
  },
]

/// One value per cell, and nothing stacked under it.
///
/// Every column here used to carry a second line — the version under the name,
/// the dates under the status pill, the shops under the article count, the
/// pending count under the rollout. Four stacked pairs over six rows is
/// twenty-four figures in a grid that reads as six, and the reader cannot tell
/// which line is the answer to the column heading. So the pairs are pulled
/// apart into columns of their own: a table is a grid of single values, and
/// anything that needs a second line is a different column.
///
/// The version is gone from the display and kept in the accessor, so typing
/// "v23" still finds the book without printing an ordinal in every row.
const columns: ColumnDef<TableSetup, PriceChange>[] = [
  {
    id: "change",
    accessorFn: (row) => `${row.name} v${row.version}`,
    header: "Change",
    size: 240,
    meta: { grow: 240 },
    // A ceiling in the cell, not a `size` on the column. `DataTable` only
    // applies `size` when it virtualises (past 150 rows); under that the table
    // is `table-auto` and a long book name — "Harga awal · 2-p basic cotton
    // tights SG" — sets the column's width by itself and pushes Published off
    // the end. The name is the one variable-width thing here, so it is the one
    // that carries the ceiling.
    cell: ({ row }) => (
      <span className="block truncate text-ink">{row.original.name}</span>
    ),
  },
  {
    // What whoever published it declared it to be. "Unclassified" is a
    // change published before a kind could be given, and says so.
    id: "kind",
    accessorFn: (row) => describeChangeKind(row.kind),
    header: "Kind",
    size: 150,
    cell: ({ row }) => (
      <span
        className={
          row.original.kind === "UNCLASSIFIED"
            ? "truncate text-mute"
            : "truncate text-body"
        }
      >
        {describeChangeKind(row.original.kind)}
      </span>
    ),
  },
  {
    id: "status",
    accessorFn: (row) => describeChangeStatus(row.status),
    header: "Status",
    size: 130,
    cell: ({ row }) => {
      const { status } = row.original
      return (
        <Status
          tone={
            status === "ACTIVE"
              ? "ok"
              : status === "SCHEDULED"
                ? "info"
                : undefined
          }
          className="w-fit"
        >
          {describeChangeStatus(status)}
        </Status>
      )
    },
  },
  {
    id: "period",
    accessorFn: (row) => row.effective_from,
    header: "Period",
    size: 210,
    // "· open-ended" is gone. An absent end date was being announced in words
    // on every row, and the absence of a second date already says it — a
    // period written as one date has not ended, which is what open-ended
    // means.
    cell: ({ row }) => {
      const { effective_from, effective_to } = row.original
      return (
        <span className="truncate text-body">
          {day(effective_from)}
          {effective_to === null ? "" : ` – ${day(effective_to)}`}
        </span>
      )
    },
  },
  {
    id: "articles",
    accessorFn: (row) => row.article_count,
    header: "Articles",
    size: 110,
    meta: { align: "right" },
    cell: ({ row }) => (
      <span className="text-ink tabular-nums">
        {count(row.original.article_count)}
      </span>
    ),
  },
  {
    id: "stores",
    accessorFn: (row) =>
      row.reaches_every_shop ? Number.MAX_SAFE_INTEGER : row.store_count,
    header: "Stores",
    size: 130,
    meta: { align: "right" },
    // A company-wide book names no shop and reaches all of them, so the two
    // cases cannot share a number — "0" would be the honest count and the
    // wrong answer. Sorted as if it were the largest, because it is.
    cell: ({ row }) =>
      row.original.reaches_every_shop ? (
        <span className="text-body">Every store</span>
      ) : (
        <span className="text-ink tabular-nums">
          {count(row.original.store_count)}
        </span>
      ),
  },
  {
    id: "rollout",
    accessorFn: (row) =>
      row.rollout.target === 0 ? 0 : row.rollout.activated / row.rollout.target,
    header: "Rollout",
    size: 190,
    meta: { align: "right" },
    // Activated over target, on one line. A failure is not folded into it —
    // a till that tried and could not is a different thing from one that has
    // not got round to it, and it is the one worth interrupting the line for.
    cell: ({ row }) => {
      const { activated, target, failed } = row.original.rollout
      const share = target === 0 ? 0 : activated / target
      return (
        <span className="flex items-center justify-end gap-2">
          <Meter
            value={share}
            tone={failed > 0 ? "bad" : share === 1 ? "ok" : "warn"}
            className="w-12"
          />
          <span className="w-20 text-right tabular-nums">
            <span className="text-ink">
              {count(activated)}/{count(target)}
            </span>
            {failed > 0 && (
              <span className="text-bad"> · {count(failed)}✕</span>
            )}
          </span>
        </span>
      )
    },
  },
  {
    id: "published",
    accessorFn: (row) => row.published_at ?? "",
    header: "Published",
    size: 140,
    // The publisher's name is gone. It was the loudest thing in the column and
    // answered a question nobody asks of a list — "who cut this" belongs to the
    // one book somebody has opened, not to six rows being scanned for what is
    // late. It is still filterable from the rail.
    cell: ({ row }) => (
      <span className="truncate text-body">
        {row.original.published_at === null
          ? "—"
          : day(row.original.published_at)}
      </span>
    ),
  },
]

export function Changes() {
  const search = useSheet("q")
  /// One change, opened — its rollout shop by shop, and what it changes.
  const book = useSheet("book")
  const [lens, setLens] = useState<ChangeLens>("ALL")
  const [settled, setSettled] = useState(false)
  // Newest first: the change just published is the one somebody came to see.
  const [sorting, setSorting] = useState<SortingState>([
    { id: "published", desc: true },
  ])

  const list = useQuery({
    queryKey: changeKeys.list(settled),
    queryFn: ({ signal }) => listPriceChanges(settled, signal),
  })

  const all = useMemo(() => list.data ?? [], [list.data])

  const filters = useFilterState(FIELDS)

  // The tab narrows, then the clauses narrow. Both, never one or the other:
  // "Attention" with a Type chip on it is one question, and a screen that let
  // the chip replace the tab would answer a different one without saying so.
  const rows = useMemo(
    () =>
      all
        .filter((change) => lensOf(change, lens))
        .filter((change) =>
          filters.filters.every((clause) => {
            const read = READ[clause.column]
            if (read === undefined) return true
            return matches(read(change), clause, KINDS[clause.column] ?? "text")
          })
        ),
    [all, lens, filters.filters]
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: PriceChange) => row.publication_id,
        state: {
          globalFilter: search.value ?? "",
          sorting,
        },
        onSortingChange: setSorting,
      }),
      [rows, search.value, sorting]
    )
  )

  // Counted over the WHOLE answer, never over the lens. A strip that moved with
  // the tab would say "0 need attention" the moment somebody clicked Scheduled,
  // which is the one reading it must never give.
  const attention = all.filter(needsAttention).length
  const outstanding = all.filter(
    (change) => change.rollout.pending > 0 || change.rollout.failed > 0
  ).length

  return (
    <PageContent>
      <PageHeader crumb="Marketing" title="Changes" />

      {/* The order book's shape: the list at the left, the filters docked in
          a column at the right, and the figures at the top of that column so
          the number and the control that changed it are read in one glance.
          Under 1440px the rail falls below the list rather than squeezing it —
          a 16rem panel beside a thirteen-column table is a table nobody can
          read. */}
      <div className="grid min-w-0 items-start gap-5 dock:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="flex min-w-0 flex-col">
          <Toolbar className="mb-5">
            <Segmented
              options={[
                { value: "ALL", label: "All" },
                { value: "SCHEDULED", label: "Scheduled" },
                { value: "ACTIVE", label: "Active" },
                { value: "ATTENTION", label: "Attention" },
              ]}
              value={lens}
              onChange={setLens}
            />
            <Toolbar.Spacer />
            {/* In the URL like every search box here, so a filtered list can
                be sent. The version is in the row's accessor, so "v23"
                finds it without being printed. */}
            <Input
              value={search.value ?? ""}
              onChange={(event) =>
                event.target.value === ""
                  ? search.close()
                  : search.open(event.target.value)
              }
              aria-label="Search changes"
              className="h-9 w-56"
            />
            {/* A second question for the SERVER, not a fifth tab and not a
                clause. The four tabs narrow the work; this asks for the changes
                that are no longer work at all, which the default list is
                entitled to leave out entirely. */}
            <Checkbox
              checked={settled}
              onChange={setSettled}
              label="Include settled"
            />
          </Toolbar>

          <Card className="overflow-hidden">
            {queryState(list, {
              loading: "Loading…",
              render: () =>
                rows.length === 0 ? (
                  <EmptyState>
                    {lens === "ALL" && filters.filters.length === 0
                      ? "Nothing outstanding."
                      : lens === "ATTENTION"
                        ? "Nothing needs attention."
                        : "No change matches that."}
                  </EmptyState>
                ) : (
                  <DataTable<PriceChange>
                    table={table}
                    onRowClick={(row) => book.open(row.publication_id)}
                    isSelected={(row) => row.publication_id === book.value}
                    empty="No change matches that search."
                    className={`${ROOMY} max-h-[calc(100dvh-20rem)]`}
                  />
                ),
            })}
          </Card>
        </div>

        {/* Counted over the WHOLE answer, never over the lens or the clauses. A
            figure that moved with the filter would say "0 need attention" the
            moment somebody clicked Scheduled, which is the one reading these
            must never give — so each says what it is counting. */}
        <DockedFilters
          model={filters}
          id="price-changes"
          subject="Pricing change"
          kpis={[
            {
              label: "On the list",
              value: count(all.length),
              note: settled ? "with settled" : "outstanding",
            },
            {
              label: "Outstanding",
              value: count(outstanding),
              note: "stores waiting",
            },
            {
              label: "Attention",
              value: count(attention),
              note: "failed or stuck",
            },
          ]}
        />
      </div>

      <ChangeSheet
        id={book.value ?? null}
        change={all.find((one) => one.publication_id === book.value) ?? null}
        onClose={book.close}
      />
    </PageContent>
  )
}

// ── one change, opened ──────────────────────────────────────────────────────

/// Where one shop stands with one change. Worst first: a failure is the row
/// somebody has to do something about.
type ShopState = "FAILED" | "PENDING" | "ACTIVE"

const STATE_ORDER: Record<ShopState, number> = {
  FAILED: 0,
  PENDING: 1,
  ACTIVE: 2,
}

interface ShopLine {
  readonly siteId: string
  readonly state: ShopState
  /// Queued to the shop, as opposed to not reached at all. Pending only.
  readonly sent: boolean
  /// When the shop last said something about it, on its own clock.
  readonly at: string | null
  /// The shop's own words when it could not apply the change.
  readonly detail: string | null
}

/// One change: what kind it is, when it runs, which shops have it in service,
/// which are still waiting and which failed — and the prices it carries.
///
/// No endpoint answers this whole, so it is read from three that do: the
/// change's own detail (what it carries, where it reaches), its events (what
/// each shop did) and the shop list (names, and "all shops" when it names
/// none).
function ChangeSheet({
  id,
  change,
  onClose,
}: {
  id: string | null
  /// The list's row, when the list holds it. A link to a settled change with
  /// "Include settled" off still opens, from the detail alone.
  change: PriceChange | null
  onClose: () => void
}) {
  const detail = useQuery({
    queryKey: commercialKeys.book(id ?? ""),
    queryFn: ({ signal }) => priceBookDetail(id!, signal),
    enabled: id !== null,
  })
  const version = change?.version ?? detail.data?.version ?? null
  /// Every event of this one change. 1000 is the server's own ceiling, and
  /// one change's events are a few per shop.
  const events = useQuery({
    queryKey: eventKeys.list(version, null),
    queryFn: ({ signal }) => listPriceEvents(version, null, 1000, signal),
    enabled: version !== null,
  })
  const fleet = useQuery({
    queryKey: commercialKeys.fleet(),
    queryFn: ({ signal }) => commercialFleet(signal),
  })

  const shopName = useMemo(() => {
    const map = new Map<string, string>()
    for (const one of fleet.data?.items ?? []) {
      if (one.site_id !== null) map.set(one.site_id, one.label ?? one.site_id)
    }
    return map
  }, [fleet.data])
  const nameOf = (siteId: string) => shopName.get(siteId) ?? siteId

  const shops = useMemo<readonly ShopLine[]>(() => {
    const by = new Map<string, ShopLine>()
    // The shops it is meant to reach: every shop when it names none,
    // otherwise the ones its prices name.
    const named = new Set<string>()
    if (change?.reaches_every_shop === true) {
      for (const one of fleet.data?.items ?? [])
        if (one.site_id !== null) named.add(one.site_id)
    } else {
      for (const rule of [
        ...(detail.data?.price_rules ?? []),
        ...(detail.data?.markdowns ?? []),
      ]) {
        if (rule.site_id !== null) named.add(rule.site_id)
        for (const site of rule.site_ids ?? []) named.add(site)
      }
    }
    for (const siteId of named)
      by.set(siteId, {
        siteId,
        state: "PENDING",
        sent: false,
        at: null,
        detail: null,
      })
    // Newest first from the server, so the first word from a shop is its
    // latest. In service outranks a failure, which outranks a delivery.
    for (const event of events.data ?? []) {
      if (event.site_id === null) continue
      const held = by.get(event.site_id)
      const rank =
        event.kind === "ACTIVATED" ? 2 : event.kind === "FAILED" ? 1 : 0
      const heldRank =
        held === undefined
          ? -1
          : held.state === "ACTIVE"
            ? 2
            : held.state === "FAILED"
              ? 1
              : held.sent
                ? 0
                : -1
      if (rank <= heldRank) continue
      by.set(event.site_id, {
        siteId: event.site_id,
        state:
          event.kind === "ACTIVATED"
            ? "ACTIVE"
            : event.kind === "FAILED"
              ? "FAILED"
              : "PENDING",
        sent: true,
        at: event.at,
        detail: event.detail,
      })
    }
    return [...by.values()].sort(
      (left, right) =>
        STATE_ORDER[left.state] - STATE_ORDER[right.state] ||
        nameOf(left.siteId).localeCompare(nameOf(right.siteId))
    )
    // `nameOf` reads `shopName`, which is listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [change, detail.data, events.data, fleet.data, shopName])

  const counted = (state: ShopState) =>
    shops.filter((one) => one.state === state).length

  /// Where a price reaches, said as a place.
  const where = (siteId: string | null, siteIds: readonly string[] | null) =>
    siteId !== null
      ? nameOf(siteId)
      : siteIds !== null && siteIds.length > 0
        ? `${count(siteIds.length)} stores`
        : "All stores"

  const name = change?.name ?? detail.data?.name ?? "Price change"
  const from = change?.effective_from ?? detail.data?.effective_from ?? null
  const to = change?.effective_to ?? detail.data?.effective_to ?? null

  return (
    <Sheet
      open={id !== null}
      onOpenChange={(next) => !next && onClose()}
      title={name}
      badge={
        change === null ? undefined : (
          <Status
            tone={
              change.status === "ACTIVE"
                ? "ok"
                : change.status === "SCHEDULED"
                  ? "info"
                  : undefined
            }
          >
            {describeChangeStatus(change.status)}
          </Status>
        )
      }
    >
      {id === null ? null : (
        <div className="flex flex-col gap-6">
          <Facts>
            <Fact term="Kind">
              {change === null ? "—" : describeChangeKind(change.kind)}
            </Fact>
            <Fact term="Period">
              {day(from)}
              {to === null ? " onwards" : ` – ${day(to)}`}
            </Fact>
            <Fact term="Published">
              {day(change?.published_at ?? detail.data?.published_at ?? null)}
              {(change?.published_by ?? detail.data?.published_by) &&
                ` · ${change?.published_by ?? detail.data?.published_by}`}
            </Fact>
            <Fact term="Reaches">
              {change === null
                ? "—"
                : change.reaches_every_shop
                  ? "All stores"
                  : `${count(change.store_count)} stores`}
            </Fact>
          </Facts>

          <div>
            <SubHead
              aside={
                shops.length === 0
                  ? undefined
                  : `${count(counted("ACTIVE"))} of ${count(shops.length)} in service`
              }
            >
              Rollout
            </SubHead>
            {(events.isPending && version !== null) || detail.isPending ? (
              <Quiet>Loading…</Quiet>
            ) : shops.length === 0 ? (
              <Quiet>No stores.</Quiet>
            ) : (
              <MiniTable
                head={["Store", { label: "State", align: "left" }, "Since"]}
              >
                {shops.map((one) => (
                  <MiniRow key={one.siteId}>
                    <MiniCell>
                      <span className="block text-[0.875rem] text-ink">
                        {nameOf(one.siteId)}
                      </span>
                      {one.detail !== null && one.state === "FAILED" && (
                        <span className="block text-[0.875rem] text-bad">
                          {one.detail}
                        </span>
                      )}
                    </MiniCell>
                    <MiniCell>
                      <Status
                        tone={
                          one.state === "FAILED"
                            ? "bad"
                            : one.state === "ACTIVE"
                              ? "ok"
                              : "warn"
                        }
                      >
                        {one.state === "FAILED"
                          ? "Failed"
                          : one.state === "ACTIVE"
                            ? "In service"
                            : one.sent
                              ? "Sent"
                              : "Not sent yet"}
                      </Status>
                    </MiniCell>
                    <MiniCell align="right">
                      <span className="text-[0.875rem] text-mute">
                        {one.at === null ? "—" : moment(one.at)}
                      </span>
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            )}
          </div>

          {queryState(detail, {
            loading: "Loading…",
            render: (data) => (
              <>
                {data.markdowns.length > 0 && (
                  <div>
                    <SubHead aside={`${count(data.markdowns.length)} rows`}>
                      Sale prices
                    </SubHead>
                    <MiniTable
                      head={[
                        "Article",
                        { label: "Where", align: "left" },
                        "Price",
                      ]}
                    >
                      {data.markdowns.map((one) => (
                        <MiniRow key={one.markdown_id}>
                          <MiniCell>
                            <Named
                              name={one.article_code ?? one.sku_code ?? "—"}
                            />
                          </MiniCell>
                          <MiniCell>
                            <span className="text-[0.875rem] text-body">
                              {where(one.site_id, one.site_ids)}
                            </span>
                          </MiniCell>
                          <MiniCell align="right">
                            {money(one.replacement_unit_price_minor)}
                          </MiniCell>
                        </MiniRow>
                      ))}
                    </MiniTable>
                  </div>
                )}
                {data.price_rules.length > 0 && (
                  <div>
                    <SubHead aside={`${count(data.price_rules.length)} rows`}>
                      New prices
                    </SubHead>
                    <MiniTable
                      head={["SKU", { label: "Where", align: "left" }, "Price"]}
                    >
                      {data.price_rules.map((one) => (
                        <MiniRow
                          key={`${one.sku_code}|${one.site_id ?? one.site_ids?.join(",") ?? "*"}|${one.channel}`}
                        >
                          <MiniCell>
                            <Named
                              name={one.article_name}
                              code={one.sku_code}
                            />
                          </MiniCell>
                          <MiniCell>
                            <span className="text-[0.875rem] text-body">
                              {where(one.site_id, one.site_ids)}
                            </span>
                          </MiniCell>
                          <MiniCell align="right">
                            {money(one.unit_price_minor)}
                          </MiniCell>
                        </MiniRow>
                      ))}
                    </MiniTable>
                  </div>
                )}
                {data.markdowns.length === 0 &&
                  data.price_rules.length === 0 && <Quiet>No prices.</Quiet>}
              </>
            ),
          })}
        </div>
      )}
    </Sheet>
  )
}
