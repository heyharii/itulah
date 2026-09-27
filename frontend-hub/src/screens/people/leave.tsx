import { useQuery } from "@tanstack/react-query"

import { PageContent } from "@/components/shell/app-shell"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/states"
import { day } from "@/lib/format"
import {
  leaveBalances,
  leaveKeys,
  listEmployees,
  listLeaveTypes,
  peopleKeys,
  readCalendar,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"

/// Leave: the balances and the calendar the requests move against.
///
/// Deciding a request is the Requests screen's job — one queue, not one
/// screen per kind of waiting. What this screen holds is the other half: the
/// saldo every balance folds out of (entitlement, used, pending — a fold with
/// no stored number anywhere) and the published holiday calendar the year's
/// entitlement is read against. Cuti bersama is marked as such because it
/// comes out of the twelve.

export function Leave() {
  const year = new Date().getFullYear()
  const team = useQuery({
    queryKey: peopleKeys.employees({ status: "ACTIVE", limit: 1000 }),
    queryFn: ({ signal }) => listEmployees({ status: "ACTIVE", limit: 1000 }, signal),
  })
  const calendar = useQuery({
    queryKey: leaveKeys.calendar(year),
    queryFn: ({ signal }) => readCalendar(year, signal),
  })
  const kinds = useQuery({
    queryKey: leaveKeys.types(),
    queryFn: ({ signal }) => listLeaveTypes(signal),
  })
  const people = (team.data ?? []).map((person) => ({ id: person.employee_id, name: person.full_name ?? person.employee_code ?? person.employee_id }))
  const nameOf = (id: string) => people.find((person) => person.id === id)?.name ?? id

  return (
    <PageContent>
      <PageHeader
        crumb="People · Time"
        title="Leave"
        sub="Saldo dihitung dari ledger: jatah, dipakai, diajukan. Jenis cuti, jatah dan hari libur diatur head office; keputusan pengajuan ada di Requests."
      />

      <Card className="mb-4 overflow-hidden">
        <CardHeader>
          <CardTitle>Saldo cuti {year}</CardTitle>
        </CardHeader>
        <BalanceBoard team={people} nameOf={nameOf} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Hari libur {year}</CardTitle>
          </CardHeader>
          {queryState(calendar, {
            loading: "Reading the calendar…",
            render: () =>
              (calendar.data?.holidays ?? []).length === 0 ? (
                <EmptyState>
                  No calendar is published for {year} yet. Head office publishes
                  it; until then nobody's entitlement can be read against it.
                </EmptyState>
              ) : (
                <div className="divide-y">
                  {(calendar.data?.holidays ?? []).map((holiday) => (
                    <div key={holiday.date} className="flex items-baseline justify-between gap-3 px-4 py-2">
                      <span className="text-body">{holiday.name}</span>
                      <span className="text-meta text-mute">
                        {day(holiday.date)}
                        {holiday.consumes_annual_leave ? " · cuti bersama" : ""}
                      </span>
                    </div>
                  ))}
                </div>
              ),
          })}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Jenis cuti</CardTitle>
          </CardHeader>
          {queryState(kinds, {
            loading: "Reading the leave types…",
            render: () =>
              (kinds.data ?? []).length === 0 ? (
                <EmptyState>No leave kind is defined yet.</EmptyState>
              ) : (
                <div className="divide-y">
                  {(kinds.data ?? []).map((kind) => (
                    <div key={kind.code} className="flex items-baseline justify-between gap-3 px-4 py-2">
                      <span className="text-body">{kind.name}</span>
                      <span className="text-meta text-mute">
                        {kind.payment.toLowerCase()}
                        {kind.max_centidays !== null
                          ? ` · maks ${kind.max_centidays / 100} hari`
                          : ""}
                      </span>
                    </div>
                  ))}
                </div>
              ),
          })}
        </Card>
      </div>
    </PageContent>
  )
}

function BalanceBoard({
  team,
  nameOf,
}: {
  team: { id: string; name: string }[]
  nameOf: (id: string) => string
}) {
  if (team.length === 0) {
    return <EmptyState>Nobody to read yet.</EmptyState>
  }
  return (
    <div className="divide-y">
      {team.map((person) => (
        <BalanceOf key={person.id} id={person.id} name={nameOf(person.id)} />
      ))}
    </div>
  )
}

function BalanceOf({ id, name }: { id: string; name: string }) {
  const balances = useQuery({
    queryKey: leaveKeys.balances(id),
    queryFn: ({ signal }) => leaveBalances(id, signal),
  })
  const rows = balances.data ?? []
  return (
    <div className="px-4 py-2">
      <span className="text-body">{name}</span>
      {rows.length === 0 ? (
        <span className="ml-2 text-meta text-mute">no balance-backed leave</span>
      ) : (
        <span className="ml-3 text-meta text-body">
          {rows
            .map(
              (row) =>
                `${row.name}: ${row.centidays / 100} sisa${
                  row.pending_centidays > 0
                    ? ` (${row.pending_centidays / 100} diajukan)`
                    : ""
                }`,
            )
            .join(" · ")}
        </span>
      )}
    </div>
  )
}
