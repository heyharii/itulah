import { useForm } from "@tanstack/react-form"
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Choices, type Tile } from "@/components/ui/form"
import { Day } from "@/components/ui/day"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { BarSeries, type ChartSeries } from "@/components/ui/chart"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Money, Select, Textarea } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import {
  KeyValue,
  MiniCell,
  MiniRow,
  MiniTable,
  SubHead,
} from "@/components/ui/rows"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState, Truncated } from "@/components/ui/states"
import { useFilters } from "@/lib/filters"
import { count, day, label, money } from "@/lib/format"
import {
  assessAsset,
  assetSchedule,
  billDetail,
  disposeAsset,
  financeKeys,
  listAssets,
  listBills,
  registerAsset,
  transferAsset,
} from "@/lib/queries/finance"
import { problemOf } from "@/lib/problem"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import {
  ASSET_CATEGORIES,
  CHARGE_KINDS,
  DEPRECIATION_METHODS,
  impliedChargeKind,
  monthOf,
  parseMinor,
  todayIso,
} from "@/screens/finance/chart"
import {
  moneyAccountValue,
  parseMoneyAccountValue,
  useLocations,
  useMeaningLabel,
  useMoneyAccounts,
} from "@/screens/finance/hooks"
import { LocationSelect, RankedBars, SiteName } from "@/screens/finance/parts"
import type { AssetRow, SupplierBillLine } from "@itulah/contract"

/// What the business owns, what Finance has decided about it, and how it
/// leaves.
///
/// # Why "not assessed" is a state and not a blank
///
/// Operations registers an asset's identity; Finance appends an assessment,
/// and the newest one is in force. An asset nobody has assessed is an open
/// control gap; one assessed and expensed is a closed one. A screen that drew
/// both as an empty cell would hide the first behind the second, which is
/// exactly the gap this register exists to surface.
///
/// # Why corrections are new assessments and never edits
///
/// "Expensed in January, capitalised in March" is the audit trail. Editing the
/// January decision would erase the fact that it was ever made.
///
/// # Why capitalising posts nothing
///
/// There is no acquisition posting rule and there will not be one: an asset is
/// bought by a **supplier bill**, and an expense bill coded to a `10215*`
/// account is that purchase already in the books. An assessment says how the
/// cost already in the books will be spread — it does not put it there. Which
/// is why `acquired_via` matters: a capitalised asset with no bill line behind
/// it is a cost the books never bought.
///
/// # Why the monthly run is not on this screen
///
/// It was, as a button in this toolbar, and it was in the wrong place twice
/// over. Depreciation is a month-end step, not something you do while looking
/// at the register — and the button always charged the *current* calendar
/// month, whichever month the person was actually closing. It now lives in the
/// Period close checklist, against the month that checklist is for.

/// Which treatment is in force, including the one that ends the story.
///
/// Four states and not three: `decision` says what Finance decided, and
/// `disposed_on` says the thing has gone. A disposed asset keeps its decision —
/// it was capitalised right up until it left — so drawing only the decision
/// would show a sold van as an ordinary capitalised one for ever.
/// The assessment, and the disposal, as tiles that say what each one means.
///
/// Both are two-armed decisions with different consequences in the ledger, and
/// both used to be a `<Select>` — which shows one arm at a time and explains
/// neither.
const DECISIONS = [
  {
    value: "CAPITALIZE",
    label: "Capitalise",
    note: "It becomes something the company owns, and is written down over its life.",
  },
  {
    value: "EXPENSE",
    label: "Expense",
    note: "It is a cost of this month and never appears on the balance sheet.",
  },
  {
    value: "IN_PROGRESS",
    label: "Still being built",
    // The client's Contract In Progress, and 668 of the 1,342 rows in their
    // own register. A cost being incurred on something that is not a thing
    // yet: it charges nothing, and the day it is finished a second assessment
    // capitalises it into the family it became.
    note: "A cost on something not finished. It charges nothing until it is.",
  },
] as const satisfies readonly Tile<string>[]

type Decision = (typeof DECISIONS)[number]["value"]

const DISPOSALS = [
  {
    value: "SOLD",
    label: "Sold",
    note: "Somebody paid for it. What they paid goes in below.",
  },
  {
    value: "WRITTEN_OFF",
    label: "Written off",
    note: "It is gone and brought nothing in — the remaining value becomes a loss.",
  },
] as const satisfies readonly Tile<string>[]

type Disposal = (typeof DISPOSALS)[number]["value"]

function Treatment({ asset }: { asset: AssetRow }) {
  if (asset.disposed_on !== null) return <Pill tone="neutral">Disposed</Pill>
  if (asset.decision === null) return <Pill tone="warn">Not assessed</Pill>
  if (asset.decision === "CAPITALIZE") return <Pill tone="ok">Capitalised</Pill>
  // In motion, which is what `info` means everywhere in this app: the money is
  // real and on the balance sheet, and what it will become is not decided yet.
  if (asset.decision === "IN_PROGRESS")
    return <Pill tone="info">Being built</Pill>
  return <Pill tone="neutral">Expensed</Pill>
}

const columns: ColumnDef<TableSetup, AssetRow>[] = [
  {
    accessorKey: "asset_number",
    header: "Asset",
    size: 120,
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        {row.original.asset_number}
      </span>
    ),
  },
  {
    accessorKey: "name",
    header: "Name",
    size: 200,
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.name}</span>
    ),
  },
  {
    accessorKey: "category_name",
    header: "Category",
    size: 170,
    // The first column this table gives up when the card is narrow, and the
    // one it can most afford to: the family is on the chart above, and it is
    // the only column here that says nothing about *this* asset's state.
    //
    // It is still worth a question, and the chart above is why: a bar for
    // Kendaraan is a number somebody then wants the rows behind.
    meta: { priority: 2, filter: { kind: "option" } },
  },
  {
    accessorKey: "site_id",
    header: "Location",
    size: 110,
    // The client's own name for it. The id stays in `title`, because that is
    // what the account codes carry and what a support call will be about.
    cell: ({ row }) => <SiteName id={row.original.site_id} />,
  },
  {
    id: "treatment",
    // Sorted first and ascending on purpose: an empty decision sorts before
    // both real ones, so the first screenful is the control gap. A disposed
    // asset sorts last under `ZZ` — it is finished, and finished work does not
    // belong at the top of a list of things to decide.
    accessorFn: (row) =>
      row.disposed_on !== null ? "ZZ" : (row.decision ?? ""),
    header: "Treatment",
    size: 130,
    // The decision metric, so the decision column. The accessor's `ZZ` is a
    // sort trick and never a word anybody reads, so the arms are named here.
    //
    // "Not assessed" is the one arm with no option row of its own: it is the
    // empty string, and an empty cell is what `is empty` asks about — the
    // operator menu carries it. The banner above already counts them.
    meta: {
      filter: {
        kind: "option",
        format: (value) =>
          value === "ZZ"
            ? "Disposed"
            : value === "CAPITALIZE"
              ? "Capitalised"
              : value === "EXPENSE"
                ? "Expensed"
                : "Not assessed",
      },
    },
    cell: ({ row }) => <Treatment asset={row.original} />,
  },
  {
    id: "acquired_via",
    accessorFn: (row) => row.acquired_via ?? "",
    header: "Bought via",
    size: 150,
    // Offered for its empty end and not for its values: "Bought via is empty"
    // beside "Treatment is Capitalised" is the control exception this column
    // draws in warn — something on the balance sheet whose cost never came in
    // on a bill. Nothing else on the screen can ask the pair.
    meta: { filter: { kind: "text" } },
    // Absent is the ordinary state for a thing the company already owned when
    // this system arrived — and an EXCEPTION for one that was capitalised
    // here, because the only way a cost gets into the books is a bill. So the
    // same empty cell is a dash on an expensed asset and a warning on a
    // capitalised one.
    cell: ({ row }) => {
      const asset = row.original
      if (asset.acquired_via !== null) {
        return (
          <span className="font-mono text-[0.71875rem] text-body">
            {asset.acquired_via}
          </span>
        )
      }
      if (asset.decision === "CAPITALIZE") {
        return <Pill tone="warn">not in the books</Pill>
      }
      return <span className="text-faint">—</span>
    },
  },
  {
    accessorKey: "last_depreciated_month",
    header: "Charged through",
    size: 145,
    // A date, and the question is almost always "before": an asset the run has
    // been quietly skipping for four months looks exactly like one capitalised
    // last week until somebody asks which ones stopped. Empty is its own
    // answer — land never charges, and neither does an asset nobody has run.
    meta: { filter: { kind: "date" } },
    // Absent means nothing has ever been charged, which is a real state and not
    // a zero: land never charges, an asset capitalised last week has not been
    // reached yet, and one the run has been silently skipping for four months
    // looks exactly like both until this says so.
    cell: ({ row }) =>
      row.original.last_depreciated_month === null ? (
        <span className="text-faint">—</span>
      ) : (
        <span className="text-body">
          {monthOf(row.original.last_depreciated_month)}
        </span>
      ),
  },
  {
    accessorKey: "capitalized_cost_minor",
    header: "Cost",
    size: 130,
    meta: { align: "right" },
    cell: ({ row }) =>
      row.original.capitalized_cost_minor === null ? (
        <span className="text-faint">—</span>
      ) : (
        money(row.original.capitalized_cost_minor)
      ),
  },
  {
    accessorKey: "accumulated_minor",
    header: "Accumulated",
    size: 130,
    // Given up before anything else: it is cost less book value, and both of
    // those are still on the row.
    meta: { align: "right", priority: 3 },
    // Summed from the depreciation entries on every read; not stored anywhere.
    cell: ({ row }) =>
      row.original.accumulated_minor === 0 ? (
        <span className="text-faint">—</span>
      ) : (
        money(row.original.accumulated_minor)
      ),
  },
  {
    accessorKey: "book_value_minor",
    header: "Book value",
    size: 140,
    // What is left of the cost, which is what a register exists to answer —
    // and the figure the chart above totals. Cost and Accumulated are the two
    // halves of it and are deliberately not offered: three money filters on
    // one row is a panel nobody reads.
    meta: {
      align: "right",
      filter: { kind: "number", unit: "Rp" },
    },
    cell: ({ row }) =>
      row.original.book_value_minor === null ? (
        <span className="text-faint">—</span>
      ) : (
        <span className="font-medium text-ink tabular-nums">
          {money(row.original.book_value_minor)}
        </span>
      ),
  },
]

export function AssetRegister() {
  const [query, setQuery] = useState("")
  const [site, setSite] = useState("")
  const [registering, setRegistering] = useState(false)
  const asset = useSheet("asset")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "treatment", desc: false },
  ])

  // The register, once per location asked for. `?unassessed=true` used to back
  // a second tab here, and asking the server for a subset of a list already in
  // memory is a second loading state and a second cache entry for a filter the
  // sort below already applies — the not-assessed rows are at the top of this
  // list by construction. The location is different: `GET /assets` takes a
  // site, an asset belongs to exactly one, and narrowing on the wire is what
  // keeps this list from being fourteen shops of shelving.
  // The whole envelope, not just its rows. `GET /assets` was given a default
  // limit while this screen was being written, and the `.then(page => page.rows)`
  // that kept it compiling also threw away the one field that says whether the
  // limit bit: `total` counts every asset the filters match, and the rows are
  // one page of them. Keeping both is what lets the banner below be exact
  // instead of a guess — see `<Truncated>`.
  const assets = useQuery({
    queryKey: financeKeys.assets(false, site || null),
    queryFn: ({ signal }) => listAssets({ site: site || undefined }, signal),
  })

  const rows = useMemo(() => assets.data?.rows ?? [], [assets.data])
  /// The server's own count of what it holds, against what it sent. Exact,
  /// because it is the server's subtraction rather than the browser inferring
  /// truncation from having received exactly as many rows as it asked for.
  const held = assets.data?.total ?? rows.length

  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: AssetRow) => row.asset_id,
        state: {
          columnFilters: filters.columnFilters,
          globalFilter: query,
          sorting,
        },
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
      }),
      [rows, filters.columns, filters.columnFilters, query, sorting]
    )
  )

  const gap = rows.filter((row) => row.decision === null).length

  /// What the business owns, by family, at what the books say it is worth.
  ///
  /// Book value and not cost: cost is what was paid, book value is what is
  /// left of it, and a register exists to answer the second. Capitalised
  /// assets only — an expensed one has no book value by construction, and
  /// drawing it at zero would put an empty bar beside a real one and invite
  /// the reader to wonder which families are worthless.
  ///
  /// Horizontal, because these are seven names rather than seven points on an
  /// axis: `<BarSeries>` would thin its own tick labels out and drop the very
  /// family somebody was looking for. Nothing new is fetched — this is the
  /// list the table is already built from.
  const byCategory = useMemo(() => {
    const sums = new Map<string, { name: string; value: number }>()
    for (const row of rows) {
      if (row.book_value_minor === null) continue
      const seen = sums.get(row.category_code)
      sums.set(row.category_code, {
        name: row.category_name,
        value: (seen?.value ?? 0) + row.book_value_minor,
      })
    }
    return [...sums.entries()].map(([code, family]) => ({
      key: code,
      label: family.name,
      value: family.value,
    }))
  }, [rows])

  const booked = byCategory.reduce((sum, family) => sum + family.value, 0)

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Assets"
        sub="Operations records what we own; Finance decides how it is treated, and how it leaves."
        actions={
          <>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="h-8 w-48"
            />
            <Button variant="primary" onClick={() => setRegistering(true)}>
              Register asset
            </Button>
          </>
        }
      />

      <Toolbar>
        <LocationSelect
          value={site}
          onChange={setSite}
          className="h-8 w-44"
          aria-label="Location"
        />
        {/* Location is not among the questions inside: the select beside this
            asks it on the wire, and the figure to the right is the answer for
            whatever it asked. */}
        <FilterPanel model={filters} table={table} />
        <Toolbar.Spacer />
        {/* The effective answer, in words. Which location, and what the rows
            on screen are worth — the same figure the chart below totals, so
            the two cannot disagree. */}
        <span className="text-[0.71875rem] text-mute">
          {site === "" ? "Every location" : <SiteName id={site} />}
          {" · "}
          {count(rows.length)} registered ·{" "}
          <span className="font-medium text-ink tabular-nums">
            {money(booked)}
          </span>{" "}
          at book value
        </span>
      </Toolbar>

      {/* The control gap, stated once and only when there is one. It used to be
          a second tab; a tab that is empty most days is a tab that gets clicked
          most days for nothing, and the rows it would have held are already the
          first ones on this list. Counted from the list on screen, which is the
          whole register — not from a second request. */}
      {gap > 0 && (
        <Banner tone="warn" className="mb-3">
          {count(gap)} assets have never been assessed — nobody has decided
          whether to capitalise or expense them. They sort to the top.
        </Banner>
      )}

      {/* Only when something is capitalised. With every asset expensed the
          chart would be seven empty tracks announcing that the books hold no
          asset value, which the toolbar above says in one figure. */}
      {booked > 0 && (
        <Card className="mb-3">
          <CardHeader>
            <CardTitle>Book value by category</CardTitle>
            <span className="text-[0.71875rem] text-mute">
              Capitalised assets only · cost less what has been depreciated
            </span>
          </CardHeader>
          <div className="px-4 pb-3.5">
            <RankedBars
              rows={byCategory}
              empty="Nothing capitalised in any family."
            />
          </div>
        </Card>
      )}

      {/* Exact, and only when it is true: the server said how many assets match
          and how many it sent, so this is a subtraction rather than the usual
          inference from "we got exactly what we asked for". */}
      {held > rows.length && <Truncated limit={rows.length} noun="assets" />}

      <Card className="overflow-hidden">
        {queryState(assets, {
          loading: "Loading the register…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {site === ""
                  ? "Nothing has been registered yet."
                  : "Nothing has been registered at this location. Widen the location filter to see the rest."}
              </EmptyState>
            ) : (
              <DataTable<AssetRow>
                table={table}
                onRowClick={(row) => asset.open(row.asset_id)}
                isSelected={(row) => row.asset_id === asset.value}
                empty="No asset matches the search and filters in force."
                className={
                  booked > 0
                    ? "max-h-[calc(100vh-31rem)]"
                    : "max-h-[calc(100vh-23rem)]"
                }
              />
            ),
        })}
      </Card>

      <AssetSheet id={asset.value ?? null} onClose={asset.close} />
      <RegisterSheet open={registering} onClose={() => setRegistering(false)} />
    </PageContent>
  )
}

// ---------------------------------------------------------------------------
// Server refusals
// ---------------------------------------------------------------------------

/// The server's own sentence, with the meaning it names made clickable.
///
/// Every refusal on this screen is written to be read by the person who pressed
/// the button, so it is quoted verbatim and never paraphrased. The one thing
/// worth adding is a way out: a disposal into an unmapped
/// `asset_disposal_result` is refused with "no account is mapped for
/// 'asset_disposal_result' at dc; set it on the Account Map screen before
/// posting" — and telling somebody to go to a screen without taking them there
/// is the smallest possible unkindness.
///
/// The key is matched out of the quotes the server puts around it, so any
/// meaning refused this way is linked without this file keeping a list of them.
function Refusal({ error }: { error: unknown }) {
  const message = problemOf(error)
  if (message === null) return null

  // Narrow on the whole sentence and not on any quoted word: the server quotes
  // other things — a kind of bill, a client's own account name — and turning
  // one of those into a link to the account map would send somebody to a screen
  // that has nothing to say about it.
  const match = /no account is mapped for '([a-z][a-z0-9_]*)'/.exec(message)
  if (match === null) {
    return <Banner tone="bad">{message}</Banner>
  }
  const [, key] = match
  const quoted = `'${key}'`
  const at = message.indexOf(quoted, match.index)
  return (
    <Banner tone="bad">
      {message.slice(0, at)}
      <AppLink
        to="/finance/account-map"
        sheet={{ key: "mapping", value: key }}
        className="underline underline-offset-2"
      >
        {quoted}
      </AppLink>
      {message.slice(at + quoted.length)}
    </Banner>
  )
}

// ---------------------------------------------------------------------------
// What bought it
// ---------------------------------------------------------------------------

/// Every posted expense-bill line coded to a capital-purchase account.
///
/// The candidates for "which bill bought this". `10215*` is the client's own
/// fixed-asset family, so a line coded there is a capital purchase by
/// construction — and the register is the only place anybody says which *thing*
/// it bought.
///
/// # What this costs
///
/// One read per posted expense bill, because `GET /bills` sends `lines: null`
/// on every row and what a bill was for is only readable one bill at a time.
/// The set is bounded by the thing being counted: expense bills are a small
/// minority of the book, and posted ones a smaller one. Each read is under the
/// key the bill sheet already owns, so opening a bill afterwards finds it warm.
///
/// It is deliberately not the `lines_without_an_asset` half of
/// `GET /assets/unbacked`: that is the exception list — lines nobody has
/// claimed — and a picker built from it could not show the line an asset is
/// *already* linked to, so re-opening an assessment would offer to unlink it.
interface AcquisitionLine {
  readonly line: SupplierBillLine
  readonly invoiceNumber: string
  readonly siteId: string
}

function useAcquisitionLines(): {
  readonly lines: readonly AcquisitionLine[]
  readonly pending: boolean
} {
  const bills = useQuery({
    queryKey: financeKeys.bills(null),
    queryFn: ({ signal }) => listBills({}, signal).then((page) => page.rows),
    staleTime: 60_000,
  })

  const candidates = useMemo(
    () =>
      (bills.data ?? []).filter(
        (bill) =>
          bill.kind === "EXPENSE" && bill.status.toUpperCase() === "POSTED"
      ),
    [bills.data]
  )

  // `combine` and not a `useMemo` over the results: `useQueries` hands back a
  // fresh array on every render, so a memo over it would either recompute
  // constantly or need a hand-rolled fingerprint as its dependency. The
  // reduction happens inside the hook, which memoises it against the results
  // themselves.
  const details = useQueries({
    queries: candidates.map((bill) => ({
      queryKey: financeKeys.bill(bill.invoice_id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        billDetail(bill.invoice_id, signal),
      // A bill that is not there and a node that does not answer the per-bill
      // read are the two ways this fails, and asking either three times changes
      // nothing.
      retry: false,
      staleTime: 60_000,
    })),
    combine: (results) => ({
      lines: results.flatMap((result) => {
        const bill = result.data
        if (bill === undefined) return []
        return (bill.lines ?? [])
          .filter((line) => line.account_code.startsWith("10215"))
          .map((line): AcquisitionLine => ({
            line,
            invoiceNumber: bill.invoice_number,
            siteId: bill.site_id,
          }))
      }),
      pending: results.some((result) => result.isPending),
    }),
  })

  return {
    lines: details.lines,
    pending: bills.isPending || details.pending,
  }
}

/// Which bill line bought this thing, when one did.
///
/// Optional on both forms it appears on, and for two different reasons: most
/// assets on day one predate this system, and the bill usually arrives after
/// the warehouse has registered the thing.
function AcquisitionField({
  value,
  onChange,
  site,
}: {
  value: string
  onChange: (lineId: string) => void
  /// The asset's own location. Lines elsewhere are still offered — the bill for
  /// a van bought by head office and kept at a shop is at head office — but the
  /// location is shown so a mismatch is a decision rather than a surprise.
  site: string
}) {
  const { lines, pending } = useAcquisitionLines()
  // An `<option>` is text and cannot hold `<SiteName>`, so the lookup is the
  // string form. The raw `store-01` was here, which is the one thing a select
  // full of invoice numbers has no room to explain.
  const name = useSiteLabel()

  return (
    <Field
      label="Bought via bill line"
      hint={
        pending
          ? "Reading the posted expense bills…"
          : lines.length === 0
            ? "No posted expense bill has a line coded to 10215*. Record the purchase as an expense bill and post it, and it will appear here."
            : "Optional. Capitalising posts nothing — the bill is the acquisition, and this is what says which one."
      }
    >
      <Select
        value={value}
        disabled={lines.length === 0}
        onChange={(next) => onChange(next)}
      >
        <option value="">Not bought through a bill on this system</option>
        {lines.map((row) => (
          <option key={row.line.line_id} value={row.line.line_id}>
            {row.invoiceNumber} line {row.line.line_number} ·{" "}
            {row.line.account_name} · {money(row.line.amount_minor)}
            {row.siteId === site ? "" : ` · at ${name(row.siteId)}`}
          </option>
        ))}
      </Select>
    </Field>
  )
}

// ---------------------------------------------------------------------------
// The schedule
// ---------------------------------------------------------------------------

const CHARGE_SERIES: readonly ChartSeries[] = [
  { key: "total", label: "Charged", tone: "accent" },
]

/// What has been charged against one asset, and what is left to charge.
///
/// The record beside the projection, which is the only way to see that a run
/// has been quietly skipping an asset: a month the run never reached is simply
/// not in the bars, while `months_remaining` counts the calendar and does not
/// care how many entries there are.
function Schedule({ assetId }: { assetId: string }) {
  const schedule = useQuery({
    queryKey: financeKeys.assetSchedule(assetId),
    queryFn: ({ signal }) => assetSchedule(assetId, signal),
  })

  return (
    <div>
      <SubHead aside="what was actually posted">Depreciation</SubHead>
      {queryState(schedule, {
        loading: "Reading what has been charged…",
        render: (data) => (
          <div className="flex flex-col gap-3">
            <div>
              {data.opening_accumulated_minor !== null && (
                // Kept apart from what this system charged. One is a figure
                // somebody carried in at cutover; the other is a list of
                // journals this screen can link to.
                <KeyValue term="Carried in">
                  {money(data.opening_accumulated_minor)}
                  <span className="text-body">
                    {" "}
                    · through {monthOf(data.opening_through)}
                  </span>
                </KeyValue>
              )}
              <KeyValue term="Charged so far">
                {money(data.charged_total_minor)}
              </KeyValue>
              <KeyValue term="Charged through">
                {monthOf(data.last_depreciated_month)}
              </KeyValue>
              <KeyValue term="Months remaining">
                {count(data.months_remaining)}
              </KeyValue>
              <KeyValue term="Left to spread">
                {money(data.remaining_depreciable_minor)}
              </KeyValue>
            </div>

            {data.charged.length === 0 ? (
              <p className="text-[0.71875rem] text-body">
                Nothing has been charged yet. Land never charges, and an asset
                capitalised this month has not been reached — the run is a
                month-end step on{" "}
                <AppLink
                  to="/finance/periods"
                  className="text-accent hover:underline"
                >
                  Period close
                </AppLink>
                .
              </p>
            ) : (
              <>
                <BarSeries
                  rows={data.charged.map((row) => ({
                    bucket: row.period_month,
                    total: row.amount_minor,
                  }))}
                  series={CHARGE_SERIES}
                  format={money}
                  // The month in three letters on the axis and in full in the
                  // tooltip: a life of sixty months is sixty ticks.
                  labelOf={(bucket) => monthOf(bucket).slice(0, 3)}
                  titleOf={(bucket) => monthOf(bucket)}
                  className="h-[8rem]"
                />
                <MiniTable head={["Month", "Entry", "Charged"]}>
                  {[...data.charged].reverse().map((row) => (
                    <MiniRow key={row.period_month}>
                      <MiniCell>{monthOf(row.period_month)}</MiniCell>
                      <MiniCell>
                        <AppLink
                          to="/finance/journal"
                          sheet={{ key: "entry", value: row.entry_id }}
                          className="font-mono text-[0.71875rem] text-accent hover:underline"
                        >
                          {row.entry_number}
                        </AppLink>
                      </MiniCell>
                      <MiniCell align="right">
                        {money(row.amount_minor)}
                      </MiniCell>
                    </MiniRow>
                  ))}
                </MiniTable>
              </>
            )}
          </div>
        ),
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// One asset
// ---------------------------------------------------------------------------

/// An assessment as it is typed. The basis is text until it is submitted —
/// a half-typed number is not a number.
interface AssessmentDraft {
  decision: string
  cost: string
  salvage: string
  life: string
  method: string
  /// Empty means "take the suggestion the category implies". Stored that way
  /// rather than pre-filled, because the sheet's form is built before the
  /// asset it is about has arrived.
  chargeKind: string
  inService: string
  /// What the system this one replaced had already depreciated, and the last
  /// month that figure covers. Both or neither: a figure nobody can date
  /// cannot stop a run from charging a month the old ledger already charged.
  /// Empty on anything bought after the cutover, which is most things.
  openingAccumulated: string
  openingThrough: string
  reason: string
  acquiredVia: string
  /// The family work in progress becomes when it is finished. Empty on every
  /// other assessment — an asset already in a family stays in it, and the
  /// server refuses anything else.
  becomes: string
}

/// The reason is required on every decision; the basis only on a
/// capitalisation; and the family only when finished work is leaving Contract
/// In Progress — the server refuses that one outright, and a button that let
/// somebody try would be a button that fails.
function assessmentReady(
  draft: AssessmentDraft,
  fromProgress = false
): boolean {
  const costMinor = parseMinor(draft.cost)
  const salvageMinor = parseMinor(draft.salvage)
  const lifeMonths = parseMinor(draft.life)
  // Half a cutover is refused here rather than at the server, because the
  // server's refusal arrives after somebody has pressed the button.
  const carriedInIsWhole =
    (draft.openingAccumulated.trim() === "") ===
    (draft.openingThrough.trim() === "")
  return (
    draft.reason.trim() !== "" &&
    carriedInIsWhole &&
    (draft.decision !== "CAPITALIZE" ||
      (costMinor !== null &&
        costMinor > 0 &&
        salvageMinor !== null &&
        lifeMonths !== null &&
        lifeMonths > 0 &&
        (!fromProgress || draft.becomes !== "")))
  )
}

/// One asset, Finance's decision about it, and the two ways it can leave.
function AssetSheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const client = useQueryClient()
  // What the request answered, not what was typed into it.
  const [saved, setSaved] = useState(false)

  // The whole register, unnarrowed. Deliberately not the location-filtered
  // key the list is showing: a sheet is opened from a link as often as from a
  // row, and one that could only find an asset at the location somebody
  // happened to be filtered to would 'not find' assets that plainly exist.
  const assets = useQuery({
    queryKey: financeKeys.assets(false, null),
    // The whole envelope, exactly as the list above keeps it — and that is not
    // a preference. Both queries write to `financeKeys.assets(false, null)`
    // whenever no site is chosen, so they share one cache entry; one of them
    // unwrapping to an array while the other kept the envelope meant whichever
    // resolved first decided the shape, and the other threw
    // `assets.data?.find is not a function` on a screen that had been fine a
    // moment earlier. One key, one shape.
    queryFn: ({ signal }) => listAssets({}, signal),
    enabled: id !== null,
  })

  const asset = assets.data?.rows.find((row) => row.asset_id === id)

  /// The families finished work can become: every category the register knows
  /// except work in progress itself. Read off the facets rather than from a
  /// list of ours — the chart IS the category register.
  const families = assets.data?.facets.categories.filter(
    (one) => !one.value.startsWith("1031803")
  )

  const assess = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: (draft: AssessmentDraft) => {
      const capitalising = draft.decision === "CAPITALIZE"
      return assessAsset(id!, {
        decision: draft.decision,
        // An expensed asset carries no basis at all: the five fields below are
        // what a capitalised one depreciates against, and sending them for an
        // expense would imply a schedule that will never run.
        capitalized_cost_minor: capitalising ? parseMinor(draft.cost) : null,
        salvage_value_minor: capitalising ? parseMinor(draft.salvage) : null,
        useful_life_months: capitalising ? parseMinor(draft.life) : null,
        method: capitalising ? draft.method : null,
        // What the charge is called travels with the basis and only with it.
        // The suggestion the category implies is what the select is showing,
        // so sending it is sending what somebody looked at — not an inference
        // made behind their back.
        charge_kind: capitalising
          ? draft.chargeKind || impliedChargeKind(asset?.category_code ?? "")
          : null,
        in_service_on: capitalising ? draft.inService : null,
        // The pair travels together or not at all. Absent is the ordinary
        // answer and it means nothing was carried in — see migration 0237.
        opening_accumulated_minor:
          capitalising && draft.openingAccumulated.trim() !== ""
            ? (parseMinor(draft.openingAccumulated) ?? undefined)
            : undefined,
        opening_through:
          capitalising && draft.openingThrough.trim() !== ""
            ? draft.openingThrough
            : undefined,
        // Only ever sent when finished work is being capitalised out of the
        // work-in-progress family, which is the one re-filing the server
        // allows. See migration 0213.
        category_code:
          capitalising && draft.becomes !== "" ? draft.becomes : undefined,
        reason: draft.reason.trim(),
        // Absent and not `""`: the field is optional on the wire, and an empty
        // string is a line id that does not exist rather than the absence of
        // one.
        acquired_via_line_id:
          draft.acquiredVia === "" ? undefined : draft.acquiredVia,
      })
    },
    onSuccess: () => {
      setSaved(true)
      // Only the reason is cleared: a correction to the same asset is a second
      // assessment against the same basis, and re-typing it would invite a typo.
      form.setFieldValue("reason", "")
      // An assessment can capitalise an asset, which changes what the next
      // depreciation run charges and what the books will hold — the whole
      // namespace is the honest answer.
      client.invalidateQueries({ queryKey: financeKeys.all })
    },
  })

  const form = useForm({
    defaultValues: {
      decision: "CAPITALIZE",
      cost: "",
      salvage: "0",
      life: "60",
      method: "STRAIGHT_LINE",
      chargeKind: "",
      inService: todayIso(),
      openingAccumulated: "",
      openingThrough: "",
      reason: "",
      acquiredVia: "",
      becomes: "",
    } as AssessmentDraft,
    onSubmit: ({ value }) => assess.mutate(value),
  })

  const gone = asset?.disposed_on !== null && asset?.disposed_on !== undefined
  const capitalised = asset?.decision === "CAPITALIZE"

  return (
    <Sheet
      open={id !== null}
      subject={id === null ? undefined : { kind: "asset", id }}
      onOpenChange={(next) => {
        if (!next) {
          setSaved(false)
          onClose()
        }
      }}
      id={asset?.asset_number}
      title={asset?.name ?? "Asset"}
      className="w-[32rem]"
      footer={
        asset && !gone ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-[0.71875rem] text-mute">
              The reason is required on both decisions.
            </span>
            <form.Subscribe
              selector={(state) =>
                assessmentReady(state.values, asset?.decision === "IN_PROGRESS")
              }
            >
              {(ready) => (
                <Button
                  variant="primary"
                  disabled={!ready || assess.isPending}
                  onClick={() => form.handleSubmit()}
                >
                  {assess.isPending ? "Saving…" : "Record assessment"}
                </Button>
              )}
            </form.Subscribe>
          </div>
        ) : undefined
      }
    >
      {queryState(assets, {
        loading: "Loading the asset…",
        render: () =>
          asset === undefined ? (
            <EmptyState>No asset on this list has that id.</EmptyState>
          ) : (
            <div className="flex flex-col gap-5">
              {saved && (
                <Banner tone="ok" onDismiss={() => setSaved(false)}>
                  Assessment recorded. The earlier one stays on the record — a
                  correction is a new assessment, never an edit. Nothing was
                  posted: the bill is the acquisition.
                </Banner>
              )}
              <Refusal error={assess.error} />

              <div className="flex flex-wrap gap-1.5">
                <Treatment asset={asset} />
                {/* The exception, on the record itself and not only in the
                    column: `fixed_asset` has no acquisition posting rule, so a
                    capitalised asset with no bill line behind it is a cost the
                    books never bought. */}
                {capitalised && asset.acquired_via === null && (
                  <Pill tone="warn">The books never bought this</Pill>
                )}
              </div>

              <Facts>
                <Fact term="Category">{asset.category_name}</Fact>
                <Fact term="Category code">{asset.category_code}</Fact>
                <Fact term="Location">
                  <SiteName id={asset.site_id} />
                </Fact>
                {/* `ACTIVE`, as the server shouts it, was on the page. The
                    screen does not have to. */}
                <Fact term="Status">{label(asset.status)}</Fact>
                <Fact term="Acquired">{day(asset.acquired_on)}</Fact>
                <Fact term="Bought via">{asset.acquired_via ?? "—"}</Fact>
                <Fact term="Serial">{asset.serial_number ?? "—"}</Fact>
                <Fact term="In service">{day(asset.in_service_on)}</Fact>
                {/* The client’s own word for it — "Garis Lurus", not
                    `STRAIGHT_LINE`. The same list the assessment form offers,
                    so what is shown and what can be chosen cannot drift. */}
                <Fact term="Method">
                  {asset.method === null
                    ? "—"
                    : (DEPRECIATION_METHODS.find(
                        (method) => method.value === asset.method
                      )?.label ?? label(asset.method))}
                </Fact>
                {/* What the monthly charge is called, in the client's own
                    word. Operating equipment reads "Cadangan Penggantian"
                    because their 1021607 is a reserve, not accumulated
                    depreciation — and a screen that called it depreciation
                    would be the only place that lie was told. */}
                <Fact term="Charge">
                  {asset.charge_kind === null
                    ? "—"
                    : (CHARGE_KINDS.find(
                        (kind) => kind.value === asset.charge_kind
                      )?.label ?? label(asset.charge_kind))}
                </Fact>
                <Fact term="Cost">{money(asset.capitalized_cost_minor)}</Fact>
                <Fact term="Accumulated">{money(asset.accumulated_minor)}</Fact>
                <Fact term="Book value">{money(asset.book_value_minor)}</Fact>
                <Fact term="Useful life">
                  {asset.useful_life_months === null
                    ? "—"
                    : `${count(asset.useful_life_months)} months`}
                </Fact>
                {gone && (
                  <>
                    <Fact term="Disposed on">{day(asset.disposed_on)}</Fact>
                    <Fact term="How">
                      {asset.disposal_method === "SOLD"
                        ? "Sold"
                        : asset.disposal_method === null
                          ? "—"
                          : "Written off"}
                    </Fact>
                    <Fact term="Proceeds">
                      {money(asset.disposal_proceeds_minor)}
                    </Fact>
                    {asset.disposal_journal_entry_id && (
                      <Fact term="Disposal entry">
                        <AppLink
                          to="/finance/journal"
                          sheet={{
                            key: "entry",
                            value: asset.disposal_journal_entry_id,
                          }}
                          className="font-mono text-id text-accent hover:underline"
                        >
                          Open the entry
                        </AppLink>
                      </Fact>
                    )}
                  </>
                )}
              </Facts>

              {capitalised && <Schedule assetId={asset.asset_id} />}

              {/* Both irreversible, and both only for an asset that is
                  capitalised and still here. An expensed asset has nothing in
                  the books to move or to take out; a disposed one is frozen —
                  everything the disposal entry quotes is evidence now. */}
              {capitalised && !gone && (
                <>
                  <TransferForm asset={asset} />
                  <DisposeForm asset={asset} />
                </>
              )}

              {gone ? (
                <p className="text-[0.71875rem] text-body">
                  This asset left the books on {day(asset.disposed_on)}. Nothing
                  more can be recorded against it — reverse its disposal entry
                  if it should not have gone.
                </p>
              ) : (
                <form
                  // The button is in the sheet's footer, outside this element,
                  // so its disabled state cannot block an Enter keypress. On an
                  // expensed asset this form is a select and a textarea and
                  // nothing else, which is exactly the shape a browser submits
                  // implicitly — so the gate is repeated here.
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (
                      assessmentReady(
                        form.state.values,
                        asset?.decision === "IN_PROGRESS"
                      ) &&
                      !assess.isPending
                    ) {
                      form.handleSubmit()
                    }
                  }}
                  className="flex flex-col gap-3"
                >
                  <SubHead>
                    {asset.decision === null
                      ? "Assess this asset"
                      : "Record a new assessment"}
                  </SubHead>

                  {/* Tiles, not a dropdown. These two are not settings, they
                      are the decision this whole screen exists to record, and
                      they land in different places in the books — one becomes
                      a thing the company owns and depreciates for years, the
                      other is gone this month. A dropdown shows one of them at
                      a time and explains neither. */}
                  <form.Field name="decision">
                    {(field) => (
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[0.78125rem] font-medium text-text">
                          Decision
                        </span>
                        <Choices
                          options={DECISIONS}
                          value={field.state.value as Decision}
                          onChange={(next) => field.handleChange(next)}
                          label="What to do with this line"
                        />
                      </div>
                    )}
                  </form.Field>

                  {/* What the finished work became.
                      
                      Only for an asset that is still being built: everything
                      else keeps the family it is filed under, and the server
                      refuses a re-filing that is not this one. The options are
                      the client's own families — the chart is the category
                      register, and there is no second list. */}
                  {asset?.decision === "IN_PROGRESS" && (
                    <form.Subscribe
                      selector={(state) =>
                        state.values.decision === "CAPITALIZE"
                      }
                    >
                      {(capitalising) =>
                        capitalising && (
                          <form.Field name="becomes">
                            {(field) => (
                              <Field
                                label="It became"
                                hint="The family this finished work now belongs to — it leaves Contract In Progress."
                              >
                                <Select
                                  value={field.state.value}
                                  onChange={(next) => field.handleChange(next)}
                                  aria-label="It became"
                                >
                                  <option value="">Choose…</option>
                                  {(families ?? []).map((one) => (
                                    <option key={one.value} value={one.value}>
                                      {one.label ?? one.value}
                                    </option>
                                  ))}
                                </Select>
                              </Field>
                            )}
                          </form.Field>
                        )
                      }
                    </form.Subscribe>
                  )}

                  <form.Subscribe
                    selector={(state) => state.values.decision === "CAPITALIZE"}
                  >
                    {(capitalising) =>
                      capitalising && (
                        <div className="grid grid-cols-2 gap-3">
                          <form.Field name="cost">
                            {(field) => (
                              <Field
                                label="Capitalised cost"
                                problem={
                                  field.state.value.trim() !== "" &&
                                  parseMinor(field.state.value) === null
                                    ? "Not a number."
                                    : undefined
                                }
                              >
                                <Money
                                  value={field.state.value}
                                  onBlur={field.handleBlur}
                                  onChange={field.handleChange}
                                  placeholder="0"
                                />
                              </Field>
                            )}
                          </form.Field>
                          <form.Field name="salvage">
                            {(field) => (
                              <Field label="Salvage value">
                                <Money
                                  value={field.state.value}
                                  onBlur={field.handleBlur}
                                  onChange={field.handleChange}
                                />
                              </Field>
                            )}
                          </form.Field>
                          <form.Field name="life">
                            {(field) => (
                              <Field label="Useful life (months)">
                                <Input
                                  inputMode="numeric"
                                  value={field.state.value}
                                  onBlur={field.handleBlur}
                                  onChange={(event) =>
                                    field.handleChange(event.target.value)
                                  }
                                />
                              </Field>
                            )}
                          </form.Field>
                          <form.Field name="method">
                            {(field) => (
                              <Field label="Method">
                                <Select
                                  value={field.state.value}
                                  onChange={(next) => field.handleChange(next)}
                                >
                                  {DEPRECIATION_METHODS.map((option) => (
                                    <option
                                      key={option.value}
                                      value={option.value}
                                    >
                                      {option.label}
                                    </option>
                                  ))}
                                </Select>
                              </Field>
                            )}
                          </form.Field>
                          <form.Field name="chargeKind">
                            {(field) => (
                              <Field label="Charge">
                                <Select
                                  value={
                                    field.state.value ||
                                    impliedChargeKind(asset.category_code)
                                  }
                                  onChange={(next) => field.handleChange(next)}
                                >
                                  {CHARGE_KINDS.map((option) => (
                                    <option
                                      key={option.value}
                                      value={option.value}
                                    >
                                      {option.label}
                                    </option>
                                  ))}
                                </Select>
                              </Field>
                            )}
                          </form.Field>
                          <form.Field name="inService">
                            {(field) => (
                              <Field
                                label="In service on"
                                className="col-span-2"
                              >
                                <Day
                                  value={field.state.value}
                                  onBlur={field.handleBlur}
                                  onChange={field.handleChange}
                                />
                              </Field>
                            )}
                          </form.Field>
                          {/* Carried in from the ledger this system replaced.
                              Left empty for anything bought since, which is
                              why it sits below the basis rather than inside
                              it: most assessments never touch it, and the one
                              that does is a cutover. */}
                          <form.Field name="openingAccumulated">
                            {(field) => (
                              <Field
                                label="Already depreciated elsewhere"
                                hint="From the old ledger's accumulated balance — their register leaves this column empty."
                                problem={
                                  field.state.value.trim() !== "" &&
                                  parseMinor(field.state.value) === null
                                    ? "Not a number."
                                    : undefined
                                }
                              >
                                <Money
                                  value={field.state.value}
                                  onBlur={field.handleBlur}
                                  onChange={field.handleChange}
                                  placeholder="0"
                                />
                              </Field>
                            )}
                          </form.Field>
                          <form.Field name="openingThrough">
                            {(field) => (
                              <Field
                                label="Covers through"
                                hint="The last month it charged. The run refuses that month and every one before it."
                              >
                                <Day
                                  value={field.state.value}
                                  onBlur={field.handleBlur}
                                  onChange={field.handleChange}
                                />
                              </Field>
                            )}
                          </form.Field>
                        </div>
                      )
                    }
                  </form.Subscribe>

                  {/* Offered here as well as at registration, because the bill
                      usually arrives after the thing does — and because this is
                      the moment a cost is named, which is the moment the two
                      figures can be checked against each other. */}
                  <form.Field name="acquiredVia">
                    {(field) => (
                      <AcquisitionField
                        value={field.state.value}
                        onChange={(next) => field.handleChange(next)}
                        site={asset.site_id}
                      />
                    )}
                  </form.Field>

                  <form.Field name="reason">
                    {(field) => (
                      <Field
                        label="Reason"
                        hint="An expensed asset with no reason is the one somebody queries a year later."
                      >
                        <Textarea
                          rows={2}
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(event) =>
                            field.handleChange(event.target.value)
                          }
                        />
                      </Field>
                    )}
                  </form.Field>
                </form>
              )}
            </div>
          ),
      })}
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Moving one
// ---------------------------------------------------------------------------

/// Moving an asset, and moving its cost and accumulated depreciation with it.
///
/// Both halves, because the client keeps a profit and loss per location: moving
/// the cost alone leaves two locations wrong by the same amount in opposite
/// directions, which a trial balance cannot see.
///
/// A move to where it already is is not offered at all — the destination select
/// drops the current site. The database refuses it too, and for a reason worth
/// knowing: that entry would debit and credit the same account at the same
/// location, so it balances perfectly and says nothing.
function TransferForm({ asset }: { asset: AssetRow }) {
  const client = useQueryClient()
  const [to, setTo] = useState("")
  const [movedOn, setMovedOn] = useState(todayIso)
  const [memo, setMemo] = useState("")
  const [confirming, setConfirming] = useState(false)
  const [receipt, setReceipt] = useState<string | null>(null)
  const name = useSiteLabel()

  const move = useMutation({
    mutationFn: () =>
      transferAsset(asset.asset_id, {
        to_site: to,
        moved_on: movedOn,
        memo: memo.trim() === "" ? null : memo.trim(),
      }),
    onSuccess: (moved) => {
      setConfirming(false)
      setReceipt(name(moved.site_id))
      setTo("")
      setMemo("")
      // A transfer writes a journal entry, so the register, both statements and
      // the trial balance moved with it.
      client.invalidateQueries({ queryKey: financeKeys.all })
    },
  })

  return (
    <div className="flex flex-col gap-3 rounded-inner border border-hairline p-3.5">
      <SubHead aside="posts an entry">Move it</SubHead>
      {receipt && (
        <Banner tone="ok" onDismiss={() => setReceipt(null)}>
          Moved to {receipt}. Its cost and accumulated depreciation went with
          it.
        </Banner>
      )}
      <Refusal error={move.error} />

      <div className="grid grid-cols-2 gap-3">
        <Field label="To">
          <LocationSelect
            value={to}
            onChange={setTo}
            emptyLabel="Choose a location"
            // Where it already is, taken out of the list rather than left in to
            // be refused.
            exclude={[asset.site_id]}
          />
        </Field>
        <Field label="Moved on">
          <Day value={movedOn} onChange={setMovedOn} />
        </Field>
      </div>
      <Field label="Memo" hint="Optional; why it moved.">
        <Input value={memo} onChange={(event) => setMemo(event.target.value)} />
      </Field>

      {confirming ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-[0.71875rem] text-body">
            Move it to <SiteName id={to} className="font-medium text-ink" /> on{" "}
            {day(movedOn)}? A transfer is a record of a move — correcting one
            means moving it back.
          </span>
          <div className="flex shrink-0 gap-1.5">
            <Button variant="quiet" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={move.isPending}
              onClick={() => move.mutate()}
            >
              {move.isPending ? "Moving…" : "Move"}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="soft"
          disabled={to === "" || movedOn === ""}
          onClick={() => setConfirming(true)}
        >
          Transfer
        </Button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Letting one go
// ---------------------------------------------------------------------------

/// Taking an asset off the books: cost out, accumulated depreciation out,
/// proceeds in, and the difference to the gain-or-loss account.
///
/// Two-step, exactly as sealing a month is, and for the same reason: it is not
/// reversible from any screen. Once it is gone, everything the disposal entry
/// quotes — the cost family, the location, the proceeds — is frozen, and the
/// only correction is a reversal of the entry itself.
///
/// `proceeds_account_key` is a meaning and a qualifier, never a client account
/// code — which pot the money arrived in, resolved through `account_map` at
/// posting time exactly as a payment says which pot money left. So the select
/// offers only meanings somebody has actually mapped at this location; the
/// alternative is a list whose every other answer is refused.
function DisposeForm({ asset }: { asset: AssetRow }) {
  const client = useQueryClient()
  const [disposedOn, setDisposedOn] = useState(todayIso)
  const [method, setMethod] = useState("SOLD")
  const [proceeds, setProceeds] = useState("0")
  const [account, setAccount] = useState("")
  const [memo, setMemo] = useState("")
  const [confirming, setConfirming] = useState(false)
  const [receipt, setReceipt] = useState(false)

  const accounts = useMoneyAccounts(asset.site_id)
  const meaning = useMeaningLabel()

  const proceedsMinor = parseMinor(proceeds)
  // A write-off fetches nothing by definition, and the database refuses one
  // that claims otherwise. So the amount is forced rather than validated: there
  // is no answer other than zero for the form to reject.
  const written = method === "WRITTEN_OFF"
  const amount = written ? 0 : (proceedsMinor ?? 0)
  const needsAccount = amount > 0
  const ready =
    disposedOn !== "" &&
    (written || proceedsMinor !== null) &&
    (!needsAccount || account !== "")

  const dispose = useMutation({
    mutationFn: () => {
      const picked =
        account === ""
          ? { account_key: undefined, account_qualifier: "" }
          : parseMoneyAccountValue(account)
      return disposeAsset(asset.asset_id, {
        disposed_on: disposedOn,
        proceeds_minor: amount,
        method,
        // Required when there are proceeds and meaningless without them.
        proceeds_account_key: needsAccount ? picked.account_key : undefined,
        proceeds_account_qualifier: needsAccount
          ? picked.account_qualifier
          : "",
        memo: memo.trim() === "" ? null : memo.trim(),
      })
    },
    onSuccess: () => {
      setConfirming(false)
      setReceipt(true)
      // Disposal writes a journal entry that empties two balances and lands the
      // difference in a third — the whole namespace is the honest answer.
      client.invalidateQueries({ queryKey: financeKeys.all })
    },
  })

  const book = asset.book_value_minor ?? 0
  // What the entry will land in the gain-or-loss account. Shown before the
  // decision because it is the decision: an asset sold for less than it is
  // worth in the books is a loss, and that is the number somebody is about to
  // put in the profit and loss.
  const result = amount - book

  return (
    <div className="flex flex-col gap-3 rounded-inner border border-hairline p-3.5">
      <SubHead aside="posts an entry · not reversible">Let it go</SubHead>
      {receipt && (
        <Banner tone="ok" onDismiss={() => setReceipt(false)}>
          It has left the books. Reverse the disposal entry if it should not
          have gone — the asset itself is evidence now.
        </Banner>
      )}
      {/* The server's own sentence, with the meaning it names linked. The
          disposal refuses outright while `asset_disposal_result` has no
          account at this location, and telling somebody to visit a screen
          without taking them there is the smallest possible unkindness. */}
      <Refusal error={dispose.error} />

      <div className="grid grid-cols-2 gap-3">
        <Field label="Left on">
          <Day value={disposedOn} onChange={setDisposedOn} />
        </Field>
        {/* Two different endings, and only one of them brings money in — the
            proceeds field below appears for one and not the other, which is
            the clearest sign these are two decisions rather than one setting
            with two values. */}
        <div className="col-span-2 flex flex-col gap-1.5">
          <span className="text-[0.78125rem] font-medium text-text">How</span>
          <Choices
            options={DISPOSALS}
            value={method as Disposal}
            onChange={setMethod}
            label="How this asset left"
          />
        </div>
        {!written && (
          <>
            <Field
              label="Proceeds"
              problem={
                proceeds.trim() !== "" && proceedsMinor === null
                  ? "Not a number."
                  : undefined
              }
            >
              <Money value={proceeds} onChange={setProceeds} placeholder="0" />
            </Field>
            <Field
              label="Into"
              hint={
                accounts.length === 0
                  ? "No cash or bank meaning is mapped at this location."
                  : !needsAccount
                    ? "Only needed when it fetched something."
                    : undefined
              }
            >
              <Select
                value={account}
                disabled={accounts.length === 0 || !needsAccount}
                onChange={(next) => setAccount(next)}
              >
                <option value="">Choose an account</option>
                {accounts.map((row) => (
                  <option
                    key={moneyAccountValue(row)}
                    value={moneyAccountValue(row)}
                  >
                    {meaning(row.account_key)}
                    {row.account_qualifier === ""
                      ? ""
                      : ` · ${row.account_qualifier}`}
                    {` — ${row.account_name}`}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}
      </div>
      <Field
        label="Memo"
        hint="Optional; the buyer, the condition, the reason."
      >
        <Input value={memo} onChange={(event) => setMemo(event.target.value)} />
      </Field>

      <div className="flex items-baseline justify-between gap-3 text-[0.71875rem]">
        <span className="text-mute">
          Book value{" "}
          <span className="text-ink tabular-nums">{money(book)}</span>
        </span>
        <span className="text-mute">
          {result < 0 ? "Loss on disposal " : "Gain on disposal "}
          <span
            className={
              result < 0
                ? "font-medium text-bad-fg tabular-nums"
                : "font-medium text-ink tabular-nums"
            }
          >
            {money(Math.abs(result))}
          </span>
        </span>
      </div>

      {confirming ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-[0.71875rem] text-body">
            Take {asset.asset_number} off the books on {day(disposedOn)} for{" "}
            {money(amount)}? Nothing can be recorded against it afterwards.
          </span>
          <div className="flex shrink-0 gap-1.5">
            <Button variant="quiet" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={dispose.isPending}
              onClick={() => dispose.mutate()}
            >
              {dispose.isPending ? "Disposing…" : "Dispose"}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="danger"
          disabled={!ready}
          onClick={() => setConfirming(true)}
        >
          Dispose
        </Button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Registering one
// ---------------------------------------------------------------------------

/// A `site_id` as the client says it, for a receipt written after the fact.
///
/// `<SiteName>` is the component and covers every other case; this is the one
/// place a *string* is wanted — a sentence that has already happened, held in
/// state rather than rendered from a row.
function useSiteLabel(): (siteId: string) => string {
  const map = useLocations()
  return (siteId) =>
    map.data?.locations.find((row) => row.site_id === siteId)?.name ?? siteId
}

interface RegistrationDraft {
  assetNumber: string
  name: string
  category: string
  siteId: string
  acquired: string
  serial: string
  notes: string
  acquiredVia: string
}

/// What identifies the thing. Everything else the register will default.
function registrationReady(draft: RegistrationDraft): boolean {
  return (
    draft.assetNumber.trim() !== "" &&
    draft.name.trim() !== "" &&
    draft.siteId.trim() !== ""
  )
}

/// Registering an asset's identity. Deliberately carries no money: what it is
/// worth and how it wears out are Finance's assessment, which comes after.
function RegisterSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  // What the request answered, not what was typed into it.
  const [receipt, setReceipt] = useState<string | null>(null)

  const register = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: (draft: RegistrationDraft) =>
      registerAsset({
        asset_number: draft.assetNumber.trim(),
        name: draft.name.trim(),
        category_code: draft.category,
        site_id: draft.siteId.trim(),
        acquired_on: draft.acquired,
        serial_number: draft.serial.trim() === "" ? null : draft.serial.trim(),
        notes: draft.notes.trim() === "" ? null : draft.notes.trim(),
        acquired_via_line_id:
          draft.acquiredVia === "" ? undefined : draft.acquiredVia,
      }),
    onSuccess: (saved) => {
      setReceipt(saved.asset_number)
      // Only what identifies this one asset is cleared: a delivery of twenty
      // identical shelves is twenty registrations at the same site, same
      // category, same day. The bill line goes with it — one line bought one
      // thing, and carrying it forward would claim it bought twenty.
      form.setFieldValue("assetNumber", "")
      form.setFieldValue("name", "")
      form.setFieldValue("serial", "")
      form.setFieldValue("notes", "")
      form.setFieldValue("acquiredVia", "")
      // Registering posts nothing; only the register itself moved.
      // The prefix, not one key: the register is now cached per location, so
      // naming a single key would leave every other shop’s list stale.
      client.invalidateQueries({ queryKey: ["finance", "assets"] })
    },
  })

  const form = useForm({
    defaultValues: {
      assetNumber: "",
      name: "",
      category: ASSET_CATEGORIES[0].code,
      siteId: "",
      acquired: todayIso(),
      serial: "",
      notes: "",
      acquiredVia: "",
    } as RegistrationDraft,
    onSubmit: ({ value }) => register.mutate(value),
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Register an asset"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-[0.71875rem] text-mute">
            No money here — Finance assesses it next.
          </span>
          <form.Subscribe selector={(state) => registrationReady(state.values)}>
            {(ready) => (
              <Button
                variant="primary"
                disabled={!ready || register.isPending}
                onClick={() => form.handleSubmit()}
              >
                {register.isPending ? "Registering…" : "Register"}
              </Button>
            )}
          </form.Subscribe>
        </div>
      }
    >
      <form
        // The button is in the sheet's footer, outside this element, so its
        // disabled state cannot block an Enter keypress.
        onSubmit={(event) => {
          event.preventDefault()
          if (registrationReady(form.state.values) && !register.isPending) {
            form.handleSubmit()
          }
        }}
        className="flex flex-col gap-3.5"
      >
        {receipt && (
          <Banner tone="ok" onDismiss={() => setReceipt(null)}>
            {receipt} is on the register, and shows as not assessed until
            Finance decides how to treat it.
          </Banner>
        )}
        <Refusal error={register.error} />

        <div className="grid grid-cols-2 gap-3">
          <form.Field name="assetNumber">
            {(field) => (
              <Field label="Asset number">
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="siteId">
            {(field) => (
              <Field label="Location">
                {/* Where the thing physically is. A typed id put an asset at a
                    location that does not exist, which the register then
                    happily listed. */}
                <LocationSelect
                  value={field.state.value}
                  onChange={(next) => field.handleChange(next)}
                  emptyLabel="Choose a location"
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="name">
            {(field) => (
              <Field label="Name" className="col-span-2">
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="category">
            {(field) => (
              <Field label="Category" className="col-span-2">
                <Select
                  value={field.state.value}
                  onChange={(next) => field.handleChange(next)}
                >
                  {ASSET_CATEGORIES.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.code} · {option.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </form.Field>
          <form.Field name="acquired">
            {(field) => (
              <Field label="Acquired on">
                <Day
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={field.handleChange}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="serial">
            {(field) => (
              <Field label="Serial number" hint="Optional.">
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
        </div>

        {/* Optional, because most assets on day one predate this system — and
            because the bill often arrives after the warehouse has registered
            the thing, which is what the assessment form's copy of this field is
            for. */}
        <form.Subscribe selector={(state) => state.values.siteId}>
          {(site) => (
            <form.Field name="acquiredVia">
              {(field) => (
                <AcquisitionField
                  value={field.state.value}
                  onChange={(next) => field.handleChange(next)}
                  site={site}
                />
              )}
            </form.Field>
          )}
        </form.Subscribe>

        <form.Field name="notes">
          {(field) => (
            <Field label="Notes" hint="Optional.">
              <Textarea
                rows={2}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>
      </form>
    </Sheet>
  )
}
