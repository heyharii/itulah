import { AppShell, ScreenBody, ScreenHeader, ScreenState } from "@/components/app-shell"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/custom/table"
import { Nav } from "@/components/nav"
import { Button } from "@/components/ui/button"
import {
  employeesKey,
  expiringContracts,
  expiringKey,
  expiryTone,
  listEmployees,
} from "@/lib/employment"
import { units } from "@/lib/money"
import { dataTableFeatures } from "@/lib/table/features"
import { cn } from "@/lib/utils"
import type { ExpiringContract } from "@itulah/contract"
import { ApiError } from "@itulah/contract/client"
import { useQuery } from "@tanstack/react-query"
import { PersonSheet } from "@/components/sheets/people/person-sheet"
import { usePersonSheet } from "@/lib/sheets/people"
import { Link } from "@tanstack/react-router"
import type { SortingState } from "@tanstack/react-table"
import { flexRender, useTable } from "@tanstack/react-table"
import { CalendarClock, Clock } from "lucide-react"
import { useMemo, useState } from "react"
import { peopleColumns } from "./columns"

/// Who works here.
///
/// The list carries a name, a job, a place and a contract — and deliberately no
/// NIK, no address and no date of birth. That is not a layout decision: the
/// server sends a different shape to this route than to the one personal data
/// lives on, so this screen could not show them if it wanted to. Reading a rota
/// and reading somebody's national identity number are different privileges,
/// and the split is the reason a rota screen cannot quietly become the other
/// thing.
///
/// The strip at the top is the one saved view that pays for itself. A fixed
/// term nobody renewed does not announce itself — the person keeps coming to
/// work, the payroll keeps running, and the fact only surfaces when somebody is
/// dismissed and the paperwork is looked at. So the terms running out sit above
/// the list rather than behind a filter, and the ones that have *already*
/// lapsed sit first, because those are not a deadline approaching.
export function PeopleView() {
  // Not a saved view yet, just the two questions anybody actually asks of this
  // screen: everyone, or only the people currently working.
  const [onlyWorking, setOnlyWorking] = useState(false)
  const status = onlyWorking ? "ACTIVE" : undefined

  const employees = useQuery({
    queryKey: employeesKey({ status }),
    queryFn: ({ signal }) => listEmployees({ status, limit: 500 }, signal),
  })
  const expiring = useQuery({
    queryKey: expiringKey(30),
    queryFn: ({ signal }) => expiringContracts(30, signal),
  })

  const rows = useMemo(() => employees.data ?? [], [employees.data])
  const terms = expiring.data ?? []
  const lapsed = terms.filter((term) => term.days_remaining < 0).length

  // Opening a record writes a query parameter rather than changing route, so
  // the search that found the name is still here when it closes.
  const sheet = usePersonSheet()
  const open = sheet.open

  /// How the reader has asked to look at the list. Not a saved view and not in
  /// the URL: it is undone by clicking the same header again, which is a
  /// different kind of state from the filter above it that changes what the
  /// server is asked for.
  const [sorting, setSorting] = useState<SortingState>([])

  const table = useTable(
    useMemo(
      () => ({
        features: dataTableFeatures,
        data: rows,
        columns: peopleColumns,
        getRowId: (person: (typeof rows)[number]) => person.employee_id,
        state: {
          sorting,
          /// One page the size of the answer. The shared feature set registers
          /// pagination for every table, and `getRowModel()` routes through it
          /// whenever it is registered — so a table that said nothing here
          /// would quietly draw ten people and look like the whole workforce.
          pagination: { pageIndex: 0, pageSize: Math.max(1, rows.length) },
        },
        onSortingChange: setSorting,
      }),
      [rows, sorting]
    )
  )

  /// `getRowModel()` and not `getFilteredRowModel()`: the filtered model has
  /// not been through the sorter, so clicking a header would update the state
  /// and reorder nothing.
  const visible = table.getRowModel().rows
  /// The same rows as ids, so the sheet's ↑/↓ walk the list on screen.
  const employeeIds = useMemo(
    () => visible.map((row) => row.original.employee_id),
    [visible]
  )

  return (
    <AppShell nav={<Nav />}>
      <ScreenHeader
        title="People"
        subtitle={
          employees.isPending
            ? "loading…"
            : `${units(rows.length)} ${rows.length === 1 ? "person" : "people"}` +
              (terms.length > 0
                ? ` · ${units(terms.length)} contract${terms.length === 1 ? "" : "s"} to renew`
                : "")
        }
      >
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link to="/people/attendance-policy" />}
        >
          <Clock className="size-3.5" />
          Attendance policy
        </Button>
        <Button
          size="sm"
          variant={onlyWorking ? "default" : "outline"}
          onClick={() => setOnlyWorking((only) => !only)}
        >
          Working only
        </Button>
      </ScreenHeader>

      {terms.length > 0 && (
        <Expiring terms={terms} lapsed={lapsed} onOpen={open} />
      )}

      <ScreenBody>
        {employees.isPending ? (
          <ScreenState>Loading the workforce…</ScreenState>
        ) : employees.isError ? (
          <ScreenState
            tone="problem"
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => void employees.refetch()}
              >
                Try again
              </Button>
            }
          >
            {employees.error instanceof ApiError
              ? employees.error.message
              : "The workforce could not be loaded."}
          </ScreenState>
        ) : rows.length === 0 ? (
          <ScreenState>
            {onlyWorking
              ? "Nobody is currently working. Try showing everyone."
              : "No employment record has been created yet."}
          </ScreenState>
        ) : (
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="hover:bg-transparent">
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {visible.map((row) => (
                <TableRow
                  key={row.id}
                  tabIndex={0}
                  role="button"
                  onClick={() => open(row.original.employee_id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault()
                      open(row.original.employee_id)
                    }
                  }}
                  className={cn(
                    "cursor-pointer",
                    // Somebody who has left stays in the list and stays
                    // readable, but greyed: they are a record, not a rota.
                    row.original.status === "TERMINATED" &&
                      "text-muted-foreground"
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ScreenBody>
      <PersonSheet rows={employeeIds} />
    </AppShell>
  )
}

/// The terms running out, worst first.
function Expiring({
  terms,
  lapsed,
  onOpen,
}: {
  terms: readonly ExpiringContract[]
  lapsed: number
  onOpen: (employeeId: string) => void
}) {
  return (
    <div className="border-b bg-amber-50/50 px-3.5 py-2.5 dark:bg-amber-950/10">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-medium">
        <CalendarClock className="size-3.5 text-amber-600" />
        {lapsed > 0 ? (
          <span>
            {units(lapsed)} fixed term{lapsed === 1 ? " has" : "s have"} already
            ended
            {terms.length > lapsed &&
              `, and ${units(terms.length - lapsed)} more ${
                terms.length - lapsed === 1 ? "ends" : "end"
              } within 30 days`}
          </span>
        ) : (
          <span>
            {units(terms.length)} fixed term{terms.length === 1 ? "" : "s"} end
            within 30 days
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {terms.map((term) => {
          const tone = expiryTone(term.days_remaining)
          return (
            <button
              key={term.employee_id}
              type="button"
              onClick={() => onOpen(term.employee_id)}
              className={cn(
                "rounded border px-2 py-1 text-[11px] transition-colors",
                tone === "gone"
                  ? "border-destructive/40 text-destructive hover:bg-destructive/10"
                  : tone === "urgent"
                    ? "border-amber-500/50 text-amber-700 hover:bg-amber-100/60 dark:text-amber-400 dark:hover:bg-amber-950/30"
                    : "border-border hover:bg-muted"
              )}
            >
              <span className="font-medium">
                {term.full_name ?? term.employee_code}
              </span>
              <span className="text-muted-foreground">
                {" "}
                · {term.position} ·{" "}
              </span>
              {tone === "gone"
                ? `ended ${Math.abs(term.days_remaining)}d ago`
                : `${term.days_remaining}d left`}
            </button>
          )
        })}
      </div>
    </div>
  )
}
