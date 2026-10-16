import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Status } from "@/components/ui/pill"
import { KeyValue } from "@/components/ui/rows"
import { Toolbar } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { count, money, monthYear } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  attendancePeriods,
  awaitingOvertime,
  expiringContracts,
  handoverLabel,
  listRuns,
  listWorkforce,
  payKeys,
  peopleKeys,
  pendingLeave,
  punchKeys,
  punchReadiness,
  rosterKeys,
  runStateLabel,
  leaveKeys,
  overtimeKeys,
  useReachableUnits,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { CardFigure, CardMonth, CardName } from "@/components/ui/phone-cards"
import { UnitChoice, useUnit } from "@/screens/people/parts"
import { ActiveLettersCard } from "@/screens/people/discipline"
import type { PayrollRunView, PeriodView } from "@itulah/contract"

/// Overview › Reports: comparing units, without making a second source of
/// the numbers.
///
/// # Three questions, one tab
///
/// The workforce, the state of the time data, and what payroll costs. They
/// are one job — somebody here is comparing places — so they are one tab of
/// the Overview door with a choice of report in its toolbar, the way a door's
/// screen keeps one row of tabs (owner, 2026-10-16).
///
/// # Nothing here is computed twice
///
/// Every figure is read from the route that owns it. The workforce counts are
/// the employee list's own facets, the cost table is the payroll run list with
/// the handover it already carries, and the time figures come from the period
/// and readiness routes. A report that re-derived any of them would be a second
/// answer to a question the app already answers, and the day they disagreed
/// this screen would be the one somebody believed.
///
/// # Two of the three compare places; one cannot yet
///
/// The workforce and the cost tables are cross-unit in one request each.
/// **Time and absence is one unit at a time**: `attendance-periods` and
/// `punch-readiness` are per place, so comparing fourteen would mean
/// twenty-eight requests from a browser. A cross-unit report needs a route
/// of its own.
const TABS = [
  { value: "workforce", label: "Workforce" },
  { value: "time", label: "Time & absence" },
  { value: "cost", label: "Payroll cost" },
] as const

export function PeopleReports() {
  const [tab, setTab] = useState<string>("workforce")
  const unit = useUnit()
  const phone = useLayout() === "phone"
  // A unit is chosen only for the one report that is per unit. On a phone it
  // is the dock's chip, never a control inside the Filters sheet.
  const unitChoice = tab === "time" && (
    <UnitChoice
      unitId={unit.unitId}
      units={unit.units}
      onChange={unit.setUnitId}
    />
  )

  return (
    <PageContent>
      <PageHeader title="Reports" />

      <Toolbar lead={<SubTabs tabs={TABS} value={tab} onChange={setTab} />}>
        {!phone && unitChoice}
      </Toolbar>
      {phone && unitChoice}

      {tab === "workforce" && <Workforce />}
      {tab === "time" && (
        <TimeAndAbsence unitId={unit.unitId} name={unit.name} />
      )}
      {tab === "cost" && <Cost />}
    </PageContent>
  )
}

/// One unit of the workforce table: who works there, and the contracts of
/// theirs that are running out or already ended.
interface UnitRow {
  readonly value: string
  readonly label: string | null
  readonly count: number
  readonly running: number
  readonly ended: number
}

const termsText = (running: number) =>
  running === 0
    ? "No term ending"
    : `${running} term${running === 1 ? "" : "s"} ending`

const unitColumns: ColumnDef<TableSetup, UnitRow>[] = [
  {
    id: "unit",
    accessorFn: (row) => row.label ?? row.value,
    header: "Unit",
    size: 280,
    meta: { card: "hide" },
  },
  {
    accessorKey: "count",
    header: "Working",
    size: 160,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) => count(Number(row.original.count)),
  },
  {
    accessorKey: "running",
    header: "Terms ending",
    size: 160,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) => count(row.original.running),
  },
  {
    // Separated from the column beside it on purpose: a term that has already
    // run out is a person working without a contract, which is a legal problem
    // rather than a planning one — the one figure here in red.
    accessorKey: "ended",
    header: "Already ended",
    size: 160,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) =>
      row.original.ended > 0 ? (
        <span className="text-bad-fg">{count(row.original.ended)}</span>
      ) : (
        count(0)
      ),
  },
  // Three columns that exist only on a card (`cardLead`; a phone): the unit,
  // how many work there as the figure, and the contracts under it.
  {
    id: "head",
    accessorFn: (row) => row.label ?? row.value,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "title" },
    cell: ({ row }) => (
      <CardName name={row.original.label ?? row.original.value} />
    ),
  },
  {
    id: "lead",
    accessorFn: (row) => row.count,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "lead" },
    cell: ({ row }) => (
      <CardFigure value={count(Number(row.original.count))} caption="working" />
    ),
  },
  {
    id: "foot",
    accessorFn: (row) => row.running,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) => termsText(row.original.running),
  },
  {
    id: "tag",
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { align: "right", card: "status" },
    cell: ({ row }) =>
      row.original.ended > 0 && (
        <Status tone="bad">{row.original.ended} already ended</Status>
      ),
  },
]

const NO_UNITS: UnitRow[] = []

/// Who works where, from the employee list's own facets.
///
/// One request. `facets.units` is the server's count per unit, already bounded
/// by the caller's reach and already labelled — so a store manager gets their
/// own place and no comparison, which is the honest answer rather than an empty
/// table.
function Workforce() {
  const page = useQuery({
    queryKey: peopleKeys.employees({ status: "ACTIVE", limit: 1 }),
    queryFn: ({ signal }) =>
      listWorkforce({ status: "ACTIVE", limit: 1 }, signal),
  })
  const expiring = useQuery({
    queryKey: peopleKeys.expiring(30),
    queryFn: ({ signal }) => expiringContracts({ withinDays: 30 }, signal),
  })

  const units = page.data?.facets.units ?? []
  const contracts = expiring.data ?? []

  // Grouped here rather than asked for per unit: the expiring route answers for
  // every place the caller reaches in one request, and counting them by place
  // is arithmetic rather than a second question.
  const unitRows = useMemo<UnitRow[]>(() => {
    const running = new Map<string, number>()
    const ended = new Map<string, number>()
    for (const contract of expiring.data ?? []) {
      const key = contract.unit_id ?? "—"
      const bucket = Number(contract.days_remaining) < 0 ? ended : running
      bucket.set(key, (bucket.get(key) ?? 0) + 1)
    }
    const facets = page.data?.facets.units
    return facets === undefined
      ? NO_UNITS
      : facets.map((unit) => ({
          value: unit.value,
          label: unit.label,
          count: unit.count,
          running: running.get(unit.value) ?? 0,
          ended: ended.get(unit.value) ?? 0,
        }))
  }, [page.data, expiring.data])
  const phone = useLayout() === "phone"
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: unitRows,
        columns: unitColumns,
        getRowId: (row: UnitRow) => row.value,
        // The card's own columns are drawn on a phone and never on a desk.
        state: {
          columnVisibility: {
            head: phone,
            lead: phone,
            foot: phone,
            tag: phone,
          },
        },
      }),
      [unitRows, phone]
    )
  )

  return (
    <>
      <KpiStrip className="md:grid-cols-2 xl:grid-cols-3">
        <Kpi
          label="Working here"
          value={page.data === undefined ? "—" : count(Number(page.data.total))}
        />
        <Kpi label="Units with staff" value={count(units.length)} />
        <Kpi
          label="Contracts ending in 30 days"
          value={expiring.data === undefined ? "—" : count(contracts.length)}
        />
      </KpiStrip>

      <Card className="mb-4 overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        <CardHeader>
          <CardTitle>By unit</CardTitle>
        </CardHeader>
        {queryState(page, {
          loading: "Counting…",
          render: () =>
            units.length === 0 ? (
              <EmptyState>Nobody is posted yet.</EmptyState>
            ) : (
              <DataTable<UnitRow>
                refresh={[page, expiring]}
                table={table}
                cardsApart
                cardLead
                cardSort={false}
              />
            ),
        })}
      </Card>

      <ActiveLettersCard />
    </>
  )
}

/// A month's sign-off, as a dot and a word.
function PeriodStatus({ status }: { status: string }) {
  return status === "CLOSED" ? (
    <Status tone="ok">Signed off</Status>
  ) : (
    <Status tone="warn">Open</Status>
  )
}

const periodColumns: ColumnDef<TableSetup, PeriodView>[] = [
  {
    accessorKey: "period",
    header: "Month",
    size: 200,
    meta: { card: "hide" },
    cell: ({ row }) => monthYear(row.original.period, true),
  },
  {
    accessorKey: "status",
    header: "Status",
    size: 200,
    meta: { card: "hide" },
    cell: ({ row }) => <PeriodStatus status={row.original.status} />,
  },
  {
    accessorKey: "reopen_count",
    header: "Reopened",
    size: 160,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) =>
      row.original.reopen_count > 0 ? `${row.original.reopen_count}×` : "—",
  },
  // Three columns that exist only on a card (`cardLead`; a phone): the month,
  // where it stands, and how often it was reopened.
  {
    id: "head",
    accessorFn: (row) => row.period,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "title" },
    cell: ({ row }) => <CardName name={monthYear(row.original.period, true)} />,
  },
  {
    id: "foot",
    accessorFn: (row) => row.status,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) => <PeriodStatus status={row.original.status} />,
  },
  {
    id: "tag",
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { align: "right", card: "status" },
    cell: ({ row }) =>
      row.original.reopen_count > 0 && `Reopened ${row.original.reopen_count}×`,
  },
]

const NO_PERIODS: PeriodView[] = []
const NO_RUNS: PayrollRunView[] = []

/// Whether one unit's time data can be trusted yet.
///
/// The two punch-derived counts come back `null` where a unit has no station
/// reporting, and `null` is rendered as *not assessed* rather than as zero —
/// "the checks passed" and "there was nothing to check" are different facts and
/// only one of them is a number.
function TimeAndAbsence({
  unitId,
  name,
}: {
  unitId: string | null
  name: string | null
}) {
  const periods = useQuery({
    queryKey: rosterKeys.periods(unitId ?? ""),
    queryFn: ({ signal }) => attendancePeriods(unitId ?? "", signal),
    enabled: unitId !== null,
  })
  const leave = useQuery({
    queryKey: leaveKeys.pending(),
    queryFn: ({ signal }) => pendingLeave(signal),
  })
  const overtime = useQuery({
    queryKey: overtimeKeys.awaiting(),
    queryFn: ({ signal }) => awaitingOvertime(signal),
  })

  const month = new Date().toISOString().slice(0, 7)
  const readiness = useQuery({
    queryKey: punchKeys.readiness(unitId ?? "", month),
    queryFn: ({ signal }) => punchReadiness(unitId ?? "", month, signal),
    enabled: unitId !== null,
  })

  const phone = useLayout() === "phone"
  const months = periods.data ?? NO_PERIODS
  const periodTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: months,
        columns: periodColumns,
        getRowId: (row: PeriodView) => row.period,
        // The card's own columns are drawn on a phone and never on a desk.
        state: { columnVisibility: { head: phone, foot: phone, tag: phone } },
      }),
      [months, phone]
    )
  )

  const here = (rows: readonly { unit_id: string }[]) =>
    unitId === null
      ? rows.length
      : rows.filter((r) => r.unit_id === unitId).length

  if (unitId === null) {
    return <Banner tone="warn">Choose a unit.</Banner>
  }

  return (
    <>
      <Card className="mb-4 overflow-hidden">
        <CardHeader>
          <CardTitle>{name ?? unitId} · this month</CardTitle>
        </CardHeader>
        <div className="px-4 pb-4">
          {queryState(readiness, {
            loading: "Reading the month…",
            render: (now) => (
              <>
                <KeyValue term="Punch source">
                  {now.punch_source_connected
                    ? "Reporting"
                    : "No station reporting"}
                </KeyValue>
                <KeyValue term="Corrections still open">
                  {now.open_corrections === null
                    ? "Not assessed"
                    : count(Number(now.open_corrections))}
                </KeyValue>
                <KeyValue term="Punches on days nobody rostered">
                  {now.unrostered_punch_days === null
                    ? "Not assessed"
                    : count(Number(now.unrostered_punch_days))}
                </KeyValue>
                <KeyValue term="Leave waiting on a decision">
                  {count(here(leave.data ?? []))}
                </KeyValue>
                <KeyValue term="Overtime nobody has answered">
                  {count(here(overtime.data ?? []))}
                </KeyValue>
              </>
            ),
          })}
        </div>
      </Card>

      <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        <CardHeader>
          <CardTitle>Months signed off</CardTitle>
        </CardHeader>
        {queryState(periods, {
          loading: "Reading the months…",
          render: (rows) =>
            rows.length === 0 ? (
              <EmptyState>No month signed off yet.</EmptyState>
            ) : (
              <DataTable<PeriodView>
                refresh={[periods]}
                table={periodTable}
                cardsApart
                cardLead
                cardSort={false}
              />
            ),
        })}
      </Card>
    </>
  )
}

/// A run, with the name of its unit.
type CostRow = PayrollRunView & { readonly unit: string }

/// Where a run stands, as one dot and one word: "Approved", or
/// "Waiting on head office, incomplete" for a run that knows it is short.
function RunStatus({ run }: { run: PayrollRunView }) {
  const word = runStateLabel(run.state)
  return run.complete ? (
    <Status tone={run.state === "APPROVED" ? "ok" : "warn"}>{word}</Status>
  ) : (
    <Status tone="warn">{word}, incomplete</Status>
  )
}

/// Where the run's handover stands with Finance.
function FinanceStatus({ run }: { run: PayrollRunView }) {
  return run.handover === null ? (
    <span className="text-mute">Not handed over</span>
  ) : (
    <Status tone={handoverLabel(run.handover.state) === "Paid" ? "ok" : "info"}>
      {handoverLabel(run.handover.state)}
    </Status>
  )
}

const costColumns: ColumnDef<TableSetup, CostRow>[] = [
  {
    accessorKey: "period",
    header: "Month",
    size: 160,
    meta: { card: "hide" },
    cell: ({ row }) => monthYear(row.original.period, true),
  },
  {
    accessorKey: "unit",
    header: "Unit",
    size: 200,
    meta: { card: "hide" },
  },
  {
    accessorKey: "state",
    header: "State",
    size: 260,
    meta: { card: "hide" },
    cell: ({ row }) => <RunStatus run={row.original} />,
  },
  {
    id: "gross",
    accessorFn: (row) => Number(row.handover?.gross_minor ?? 0),
    header: "Gross",
    size: 180,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) =>
      row.original.handover === null
        ? "—"
        : money(Number(row.original.handover.gross_minor)),
  },
  {
    id: "finance",
    accessorFn: (row) => row.handover?.state ?? "",
    header: "Finance",
    size: 180,
    meta: { card: "hide" },
    cell: ({ row }) => <FinanceStatus run={row.original} />,
  },
  // Four columns that exist only on a card (`cardLead`; a phone): the unit,
  // the month as the figure, what was handed over to Finance, and where the
  // run stands.
  {
    id: "head",
    accessorFn: (row) => row.unit,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "title" },
    cell: ({ row }) => <CardName name={row.original.unit} />,
  },
  {
    id: "lead",
    accessorFn: (row) => row.period,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "lead" },
    cell: ({ row }) => <CardMonth period={row.original.period} />,
  },
  {
    id: "foot",
    accessorFn: (row) => row.state,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) => <RunStatus run={row.original} />,
  },
  {
    id: "tag",
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { align: "right", card: "status" },
    cell: ({ row }) =>
      row.original.handover === null
        ? "Not handed over"
        : `${money(Number(row.original.handover.gross_minor))} · ${handoverLabel(row.original.handover.state)}`,
  },
]

/// What payroll came to, per unit and month.
///
/// One request. The run list already carries the handover it produced, so the
/// gross figure and how far it has got towards being paid are on the row rather
/// than a fetch away — which is what makes a cross-unit table possible here and
/// not in the tab beside it.
///
/// **Gross, and it says so.** The handover crosses the run's gross; the
/// accrual behind it splits PPh 21 and BPJS off to what the company owes the
/// tax office and BPJS (0800). A column headed only "cost" would be read as
/// take-home pay by the first person who saw it.
function Cost() {
  const runs = useQuery({
    queryKey: payKeys.runs(),
    queryFn: ({ signal }) => listRuns(signal),
  })
  const units = useReachableUnits()
  const rows = useMemo<CostRow[]>(() => {
    const names = new Map((units.data ?? []).map((one) => [one.id, one.name]))
    return (runs.data ?? NO_RUNS).map((run) => ({
      ...run,
      unit: names.get(run.unit_id) ?? run.unit_id,
    }))
  }, [runs.data, units.data])
  const phone = useLayout() === "phone"
  const costTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: costColumns,
        getRowId: (row: CostRow) => row.id,
        // The card's own columns are drawn on a phone and never on a desk.
        state: {
          columnVisibility: {
            head: phone,
            lead: phone,
            foot: phone,
            tag: phone,
          },
        },
      }),
      [rows, phone]
    )
  )
  const crossed = rows.filter((row) => row.handover !== null)
  const gross = crossed.reduce(
    (total, row) => total + Number(row.handover?.gross_minor ?? 0),
    0
  )

  return (
    <>
      <KpiStrip className="md:grid-cols-2 xl:grid-cols-3">
        <Kpi label="Runs" value={count(rows.length)} />
        <Kpi label="With Finance" value={count(crossed.length)} />
        <Kpi
          label="Gross with Finance"
          value={crossed.length === 0 ? "—" : money(gross)}
        />
      </KpiStrip>

      <Card className="mb-4 overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        <CardHeader>
          <CardTitle>By unit and month</CardTitle>
        </CardHeader>
        {queryState(runs, {
          loading: "Reading the runs…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>No payroll yet.</EmptyState>
            ) : (
              <DataTable<CostRow>
                refresh={[runs]}
                table={costTable}
                cardsApart
                cardLead
                cardSort={false}
              />
            ),
        })}
      </Card>
    </>
  )
}
