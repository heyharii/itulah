import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { useLayout } from "@/lib/layout"
import { DockTools } from "@/components/shell/dock-tools"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { ExpandingSearch } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { MiniCell, MiniTable } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import {
  everyoneBalances,
  everyoneBalancesKey,
  useActiveEmployees,
} from "@/lib/queries/hr-time"
import { leaveBalances, leaveKeys, readDays } from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import {
  AdjustBalanceForm,
  HolidayWorkedForm,
  PayOutForm,
} from "@/screens/people/leave-extras"
import { Quiet, UnitFilter, useUnitFilter } from "@/screens/people/parts"
import { CardFigure, CardName } from "@/components/ui/phone-cards"
import { usePeopleAudience } from "@/screens/people/scope"
import type { EmployeeSummary, LeaveBalanceRow } from "@itulah/contract"

/// Time off › Balances — everyone working here, and what each has left.
///
/// The list is people, because a balance is read about a person, and it says
/// the figures somebody plans around — days left per kind, and days asked for
/// and not yet decided — read for everybody at once (`GET /leave-balances`,
/// owner, 2026-10-16: "figures in the list, not only in the sheet"). Opening
/// one shows their balances per kind, and — for head office, whose acts they
/// are — the three things done to a balance by hand: correct or grant days,
/// pay days out into a month's payroll, and give a day back for a holiday
/// worked.

/// A person, with their balances once the read has answered. `undefined`
/// while it has not — and for good if it failed, when the figures say "—"
/// and the list still opens each person's own.
type BalanceRow = EmployeeSummary & {
  readonly balances: readonly LeaveBalanceRow[] | undefined
}

/// One kind that draws on a balance, as the columns name it.
interface Kind {
  readonly code: string
  readonly name: string
}

/// Days asked for and not yet decided, across every kind.
function waitingOf(row: BalanceRow): number | null {
  if (row.balances === undefined) return null
  return row.balances.reduce((sum, one) => sum + one.pending_centidays, 0)
}

/// The Waiting column, beside the kinds' days left.
const waitingColumn: ColumnDef<TableSetup, BalanceRow> = {
  id: "waiting",
  accessorFn: (row) => waitingOf(row),
  header: "Waiting",
  size: 150,
  meta: { align: "right", card: "hide" },
  cell: ({ row }) => {
    const waiting = waitingOf(row.original)
    return waiting === null || waiting === 0 ? "—" : readDays(waiting)
  },
}

function columnsFor(
  kinds: readonly Kind[]
): ColumnDef<TableSetup, BalanceRow>[] {
  return [
    {
      id: "who",
      accessorFn: (row) => row.full_name ?? row.employee_code,
      header: "Employee",
      size: 280,
      meta: { card: "hide" },
    },
    {
      id: "unit",
      accessorFn: (row) => row.unit_name ?? row.unit_id ?? "",
      header: "Unit",
      size: 200,
      meta: { card: "hide" },
      cell: ({ row }) => row.original.unit_name ?? row.original.unit_id ?? "—",
    },
    // A column per kind that draws on a balance, named as the catalogue
    // names it: two kinds' days added together are no figure anybody plans by.
    ...kinds.map((kind): ColumnDef<TableSetup, BalanceRow> => ({
      id: `left:${kind.code}`,
      accessorFn: (row) =>
        row.balances?.find((one) => one.leave_type === kind.code)?.centidays ??
        null,
      header: kind.name,
      size: 170,
      meta: { align: "right", card: "hide" },
      cell: ({ row }) => {
        const left = row.original.balances?.find(
          (one) => one.leave_type === kind.code
        )
        return left === undefined ? "—" : readDays(left.centidays)
      },
    })),
    // Only once the figures have answered: before that, or on a server that
    // does not serve them yet, a column of dashes says nothing.
    ...(kinds.length === 0 ? [] : [waitingColumn]),
    // The columns that exist only on a card (`cardLead`; a phone): the person
    // over their position and place, the first kind's days left as the
    // figure, and what is waiting under it.
    {
      id: "head",
      accessorFn: (row) => row.full_name ?? row.employee_code,
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "title" },
      cell: ({ row }) => (
        <CardName
          name={row.original.full_name ?? row.original.employee_code}
          line={[
            row.original.position,
            row.original.unit_name ?? row.original.unit_id,
          ]
            .filter(Boolean)
            .join(" · ")}
        />
      ),
    },
    {
      id: "lead",
      accessorFn: (row) => row.balances?.[0]?.centidays ?? null,
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "lead" },
      cell: ({ row }) => {
        const first = row.original.balances?.[0]
        return first === undefined ? null : (
          <CardFigure
            value={readDays(first.centidays).split(" ")[0]}
            caption={`${first.name} left`}
          />
        )
      },
    },
    {
      id: "foot",
      accessorFn: (row) => waitingOf(row),
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "foot" },
      cell: ({ row }) => {
        const waiting = waitingOf(row.original)
        return waiting === null || waiting === 0
          ? null
          : `${readDays(waiting)} waiting`
      },
    },
  ]
}

export function TimeOffBalances() {
  const phone = useLayout() === "phone"
  const { people, team } = useActiveEmployees()
  const [search, setSearch] = useState("")
  // The unit is HR's own, kept as you move between its pages.
  const place = useUnitFilter()
  const [opened, setOpened] = useState<EmployeeSummary | null>(null)

  /// Everybody's figures in one read. Not a reason to hold the list back:
  /// the people draw at once, and the figures fill in when they come.
  const figures = useQuery({
    queryKey: everyoneBalancesKey(),
    queryFn: ({ signal }) => everyoneBalances(signal),
  })
  const byPerson = useMemo(
    () =>
      new Map(
        (figures.data ?? []).map((one) => [one.employee_id, one.balances])
      ),
    [figures.data]
  )
  /// The kinds the columns name, off the answer itself: every person carries
  /// the same balance-backed kinds, so the first one says which.
  const kinds = useMemo<Kind[]>(
    () =>
      (figures.data?.[0]?.balances ?? []).map((one) => ({
        code: one.leave_type,
        name: one.name,
      })),
    [figures.data]
  )
  const columns = useMemo(() => columnsFor(kinds), [kinds])

  const needle = search.trim().toLowerCase()
  const rows = useMemo<BalanceRow[]>(
    () =>
      people
        .filter((one) => place.unitId === null || one.unit_id === place.unitId)
        .filter(
          (one) =>
            needle === "" ||
            (one.full_name ?? "").toLowerCase().includes(needle) ||
            one.employee_code.toLowerCase().includes(needle) ||
            (one.position ?? "").toLowerCase().includes(needle)
        )
        .map((one) => ({ ...one, balances: byPerson.get(one.employee_id) })),
    [people, place.unitId, needle, byPerson]
  )
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: BalanceRow) => row.employee_id,
        // The card's own columns are drawn on a phone and never on a desk.
        state: { columnVisibility: { head: phone, lead: phone, foot: phone } },
      }),
      [rows, columns, phone]
    )
  )

  return (
    <PageContent>
      <PageHeader title="Balances" />

      {/* On a phone the search and the unit are in the dock over the bottom
          bar. */}
      {phone ? (
        <>
          <UnitFilter
            unitId={place.unitId}
            units={place.units}
            onChange={place.setUnitId}
          />
          <DockTools
            search={{
              value: search,
              onChange: setSearch,
              label: "Search People",
            }}
          />
        </>
      ) : (
        <Toolbar className="group/bar">
          <UnitFilter
            unitId={place.unitId}
            units={place.units}
            onChange={place.setUnitId}
          />
          <ExpandingSearch
            value={search}
            onChange={setSearch}
            label="Search people"
          />
        </Toolbar>
      )}

      <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {queryState(team, {
          loading: "Reading the people…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {people.length === 0
                  ? "Nobody is employed here yet."
                  : "Nobody matches that search."}
              </EmptyState>
            ) : (
              <DataTable<BalanceRow>
                refresh={[team, figures]}
                table={table}
                onRowClick={(one) => setOpened(one)}
                isSelected={(one) => one.employee_id === opened?.employee_id}
                cardsApart
                cardLead
                cardSort={false}
              />
            ),
        })}
      </Card>

      <BalanceSheet person={opened} onClose={() => setOpened(null)} />
    </PageContent>
  )
}

function BalanceSheet({
  person,
  onClose,
}: {
  person: EmployeeSummary | null
  onClose: () => void
}) {
  const employer = usePeopleAudience() === "employer"
  const balances = useQuery({
    queryKey: leaveKeys.balances(person?.employee_id ?? ""),
    queryFn: ({ signal }) => leaveBalances(person?.employee_id ?? "", signal),
    enabled: person !== null,
  })

  if (person === null) return null
  const id = person.employee_id

  const overview = queryState(balances, {
    loading: "Reading the balances…",
    render: (rows) =>
      rows.length === 0 ? (
        <Quiet>No leave with a balance for this person.</Quiet>
      ) : (
        <MiniTable head={[{ label: "Kind", align: "left" }, "Left", "Waiting"]}>
          {rows.map((row) => (
            <tr key={row.leave_type} className="border-t border-hairline">
              <MiniCell>{row.name}</MiniCell>
              <MiniCell align="right">{readDays(row.centidays)}</MiniCell>
              <MiniCell align="right">
                {row.pending_centidays === 0
                  ? "—"
                  : readDays(row.pending_centidays)}
              </MiniCell>
            </tr>
          ))}
        </MiniTable>
      ),
  })

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={person.employee_code}
      title={person.full_name ?? person.employee_code}
      caption={[person.position, person.unit_name].filter(Boolean).join(" · ")}
      width={employer ? "wide" : "rail"}
      tabs={
        employer
          ? [
              { value: "balances", label: "Balances", content: overview },
              {
                value: "adjust",
                label: "Adjust balance",
                content: <AdjustBalanceForm key={id} employeeId={id} />,
              },
              {
                value: "payout",
                label: "Pay out days",
                content: <PayOutForm key={id} employeeId={id} />,
              },
              {
                value: "holiday",
                label: "Holiday worked",
                content: <HolidayWorkedForm key={id} employeeId={id} />,
              },
            ]
          : undefined
      }
    >
      {employer ? null : overview}
    </Sheet>
  )
}
