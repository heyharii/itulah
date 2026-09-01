import { AppShell, ScreenHeader, ScreenState } from "@/components/app-shell"
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
  statusLabel,
} from "@/lib/employment"
import { units } from "@/lib/money"
import { cn } from "@/lib/utils"
import type { EmployeeSummary, ExpiringContract } from "@itulah/contract"
import { ApiError } from "@itulah/contract/client"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { CalendarClock } from "lucide-react"
import { useState } from "react"

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
  const navigate = useNavigate()
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

  const rows = employees.data ?? []
  const terms = expiring.data ?? []
  const lapsed = terms.filter((term) => term.days_remaining < 0).length

  const open = (employeeId: string) =>
    void navigate({ to: "/people/$employeeId", params: { employeeId } })

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
          variant={onlyWorking ? "default" : "outline"}
          onClick={() => setOnlyWorking((only) => !only)}
        >
          Working only
        </Button>
      </ScreenHeader>

      {terms.length > 0 && <Expiring terms={terms} lapsed={lapsed} onOpen={open} />}

      <div className="min-h-0 flex-1 overflow-auto">
        {employees.isPending ? (
          <ScreenState>Loading the workforce…</ScreenState>
        ) : employees.isError ? (
          <ScreenState
            tone="problem"
            action={
              <Button size="sm" variant="outline" onClick={() => void employees.refetch()}>
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
            <TableHeader className="bg-muted/50">
              <TableRow className="hover:bg-transparent">
                <TableHead>Number</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Job</TableHead>
                <TableHead>Place</TableHead>
                <TableHead>Contract</TableHead>
                <TableHead>Login</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((person) => (
                <PersonRow
                  key={person.employee_id}
                  person={person}
                  onOpen={() => open(person.employee_id)}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </div>
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
            {units(lapsed)} fixed term{lapsed === 1 ? " has" : "s have"} already ended
            {terms.length > lapsed &&
              `, and ${units(terms.length - lapsed)} more end within 30 days`}
          </span>
        ) : (
          <span>
            {units(terms.length)} fixed term{terms.length === 1 ? "" : "s"} end within 30
            days
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
                    : "hover:bg-muted border-border",
              )}
            >
              <span className="font-medium">{term.full_name ?? term.employee_code}</span>
              <span className="text-muted-foreground"> · {term.position} · </span>
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

function PersonRow({
  person,
  onOpen,
}: {
  person: EmployeeSummary
  onOpen: () => void
}) {
  const working = person.status === "ACTIVE"
  const left = person.status === "TERMINATED"
  return (
    <TableRow
      tabIndex={0}
      role="button"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onOpen()
        }
      }}
      className={cn("cursor-pointer", left && "text-muted-foreground")}
    >
      <TableCell className="font-mono text-xs font-medium">
        {person.employee_code}
      </TableCell>
      <TableCell className="max-w-56 truncate text-xs">
        {/* A record can exist before anybody has typed a name into it — a
            candidate accepted on Friday, enrolled on Monday. Saying so is
            better than an empty cell that reads as a bug. */}
        {person.full_name ?? (
          <span className="text-muted-foreground italic">not enrolled</span>
        )}
      </TableCell>
      <TableCell>
        <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
          <span
            aria-hidden
            className={cn(
              "size-2 shrink-0 rounded-full",
              working
                ? "bg-emerald-500"
                : person.status === "CANDIDATE"
                  ? "bg-sky-500"
                  : person.status === "SUSPENDED"
                    ? "bg-amber-500"
                    : "bg-muted-foreground/40",
            )}
          />
          {statusLabel(person.status)}
        </span>
      </TableCell>
      <TableCell className="text-xs">
        {person.position ?? <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell className="text-xs">
        {person.place_name ?? <span className="text-muted-foreground">unposted</span>}
      </TableCell>
      <TableCell className="text-xs whitespace-nowrap">
        {person.contract_kind ? (
          <>
            {person.contract_kind}
            {person.contract_ends_on && (
              <span className="text-muted-foreground"> · {person.contract_ends_on}</span>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">none</span>
        )}
      </TableCell>
      <TableCell className="font-mono text-[11px]">
        {person.username ?? <span className="text-muted-foreground">—</span>}
      </TableCell>
    </TableRow>
  )
}
