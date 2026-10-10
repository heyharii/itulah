import { useQueries, useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { Card } from "@/components/ui/card"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { EmptyState } from "@/components/ui/states"
import { count, day, money } from "@/lib/format"
import { gaContracts, gaKeys, gaLocations } from "@/lib/queries/ga"
import { useUnits } from "@/lib/queries/organisation"
import {
  expiringContracts,
  listWorkforce,
  peopleKeys,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useScopeUnit } from "@/screens/executive/books"
import { rupiah } from "@/screens/executive/format"
import { Figure, Figures, Head, ReportPage } from "@/screens/executive/parts"
import { usePlaces } from "@/screens/executive/places"
import { useReportScope } from "@/screens/executive/scope"
import { SupplierName } from "@/screens/procurement/supplier-name"

/// Team & Assets — how many people each place has, what is broken, what is due
/// for upkeep, and which agreements run out in the next thirty days.

const SOON = 30

/// Active people at one unit — `total` of a one-row page, so the count is the
/// server's and not the length of whatever page came back.
const ACTIVE = (unitId?: string) =>
  ({ status: "ACTIVE", unitId, limit: 1 }) as const

export function ExecutivePeople() {
  const scope = useReportScope()
  const { nameOf } = usePlaces(scope)

  // People are posted to units, and the report is narrowed to a shop — a
  // site. The workforce is asked about the unit owning it, and each location
  // row counts the unit that owns that location.
  const scopeUnit = useScopeUnit(scope)
  const register = useUnits()
  const unitOfSite = useMemo(
    () =>
      new Map(
        (register.data ?? []).flatMap((unit) =>
          unit.sites.map((site) => [site.id, unit.id] as const)
        )
      ),
    [register.data]
  )

  const locations = useQuery({
    queryKey: gaKeys.locations({}),
    queryFn: ({ signal }) => gaLocations({}, signal),
    retry: false,
  })
  const headcount = useQuery({
    queryKey: peopleKeys.employees(ACTIVE(scopeUnit ?? undefined)),
    queryFn: ({ signal }) =>
      listWorkforce(ACTIVE(scopeUnit ?? undefined), signal),
    enabled: scopeUnit !== null,
  })
  const units = useMemo(
    () => [
      ...new Set(
        (locations.data ?? []).flatMap((row) => {
          const unit = unitOfSite.get(row.site_id)
          return unit === undefined ? [] : [unit]
        })
      ),
    ],
    [locations.data, unitOfSite]
  )
  const perUnit = useQueries({
    queries: units.map((unitId) => ({
      queryKey: peopleKeys.employees(ACTIVE(unitId)),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        listWorkforce(ACTIVE(unitId), signal),
    })),
  })
  const expiring = useQuery({
    queryKey: peopleKeys.expiring(SOON),
    queryFn: ({ signal }) => expiringContracts({ withinDays: SOON }, signal),
  })
  const agreements = useQuery({
    queryKey: [...gaKeys.contracts({ archived: false }), "executive"] as const,
    queryFn: ({ signal }) =>
      gaContracts({ archived: false, limit: 1000 }, signal),
    retry: false,
  })

  /// A GA row belongs to a site, an HR row to a unit: each is here when it is
  /// at the shop the report is narrowed to, or in the unit owning it.
  const here = <T extends { site_id?: string | null; unit_id?: string | null }>(
    row: T
  ) => {
    if (scope.store === undefined) return true
    const site = row.site_id ?? null
    if (site !== null) return site === scope.store
    const unit = row.unit_id ?? null
    return unit !== null && unit === scopeUnit
  }

  const rows = (locations.data ?? []).filter(here)
  const repairs = rows.reduce((sum, row) => sum + row.open_repair_count, 0)
  const people = (expiring.data ?? []).filter(here)
  const deals = (agreements.data?.rows ?? [])
    .filter(
      (row) =>
        row.days_to_end !== null &&
        row.days_to_end >= 0 &&
        row.days_to_end <= SOON &&
        here(row)
    )
    .sort((a, b) => (a.days_to_end ?? 0) - (b.days_to_end ?? 0))

  const heads = new Map(
    units.map((unitId, index) => [unitId, perUnit[index]?.data?.total])
  )

  return (
    <ReportPage title="Team & Assets" scope={scope}>
      <Figures>
        <Figure
          label="Active employees"
          value={headcount.data ? count(headcount.data.total) : "…"}
        />
        <Figure
          label="Employee contracts ending"
          value={expiring.data ? count(people.length) : "…"}
          note={`Within ${SOON} days`}
        />
        <Figure
          label="Open repairs"
          value={locations.data ? count(repairs) : "—"}
          note={
            locations.data
              ? `${count(rows.reduce((sum, row) => sum + row.due_task_count, 0))} maintenance due`
              : undefined
          }
        />
        <Figure
          label="GA contracts ending"
          value={agreements.data ? count(deals.length) : "—"}
          note={`Within ${SOON} days`}
        />
      </Figures>

      <Card className="mb-3 overflow-hidden">
        <Head title="By location" to="/maintenance" link="Open repairs" />
        <div className="overflow-x-auto px-[1.125rem] pb-3">
          {queryState(locations, {
            loading: "Reading the locations…",
            render: () =>
              rows.length === 0 ? (
                <EmptyState>No locations are registered yet.</EmptyState>
              ) : (
                <MiniTable
                  head={[
                    "Location",
                    "Active Employees",
                    "Open Repairs",
                    "Maintenance Due",
                    "Billed This Month",
                  ]}
                  style={{ minWidth: "38rem" }}
                >
                  {rows.map((row) => (
                    <MiniRow key={row.site_id}>
                      <MiniCell className="font-medium text-ink">
                        {row.site_name || nameOf(row.site_id)}
                      </MiniCell>
                      <MiniCell align="right">
                        {count(heads.get(unitOfSite.get(row.site_id) ?? ""))}
                      </MiniCell>
                      <MiniCell align="right">
                        {row.open_repair_count === 0 ? (
                          <span className="text-mute">—</span>
                        ) : (
                          count(row.open_repair_count)
                        )}
                      </MiniCell>
                      <MiniCell align="right">
                        {row.due_task_count === 0 ? (
                          <span className="text-mute">—</span>
                        ) : (
                          count(row.due_task_count)
                        )}
                      </MiniCell>
                      <MiniCell align="right">
                        <span title={money(row.billed_this_month_minor)}>
                          {rupiah(row.billed_this_month_minor)}
                        </span>
                      </MiniCell>
                    </MiniRow>
                  ))}
                </MiniTable>
              ),
          })}
        </div>
      </Card>

      <div className="grid gap-3 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <Head
            title="Employee contracts ending"
            to="/people"
            link="Open People"
          />
          <div className="overflow-x-auto px-[1.125rem] pb-3">
            {queryState(expiring, {
              loading: "Reading the contracts…",
              render: () =>
                people.length === 0 ? (
                  <EmptyState>
                    No contracts end in the next {SOON} days.
                  </EmptyState>
                ) : (
                  <MiniTable
                    head={["Employee", "Location", "Ends", "Remaining"]}
                    style={{ minWidth: "26rem" }}
                  >
                    {people.map((row) => (
                      <MiniRow key={row.employee_id}>
                        <MiniCell>
                          <span className="block font-medium text-ink">
                            {row.full_name ?? row.employee_code}
                          </span>
                          <span className="block text-[0.875rem] text-mute">
                            {row.position}
                          </span>
                        </MiniCell>
                        <MiniCell align="right">
                          {row.unit_id === null ? "—" : nameOf(row.unit_id)}
                        </MiniCell>
                        <MiniCell align="right">{day(row.ends_on)}</MiniCell>
                        <MiniCell align="right">
                          {row.days_remaining} days
                        </MiniCell>
                      </MiniRow>
                    ))}
                  </MiniTable>
                ),
            })}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <Head
            title="GA contracts ending"
            to="/contracts"
            link="Open contracts"
          />
          <div className="overflow-x-auto px-[1.125rem] pb-3">
            {queryState(agreements, {
              loading: "Reading the contracts…",
              render: () =>
                deals.length === 0 ? (
                  <EmptyState>
                    No contracts end in the next {SOON} days.
                  </EmptyState>
                ) : (
                  <MiniTable
                    head={["Contract", "Location", "Ends", "Remaining"]}
                    style={{ minWidth: "26rem" }}
                  >
                    {deals.map((row) => (
                      <MiniRow key={row.contract_id}>
                        <MiniCell>
                          <span className="block font-medium text-ink">
                            {row.objek_name ?? row.contract_type_name}
                          </span>
                          <span className="block text-[0.875rem] text-mute">
                            {row.counterparty_name ?? (
                              <SupplierName
                                code={row.supplier_id}
                                name={row.supplier_name}
                              />
                            )}
                          </span>
                        </MiniCell>
                        <MiniCell align="right">
                          {row.site_id === null ? "All" : nameOf(row.site_id)}
                        </MiniCell>
                        <MiniCell align="right">{day(row.ends_on)}</MiniCell>
                        <MiniCell align="right">
                          {row.days_to_end} days
                        </MiniCell>
                      </MiniRow>
                    ))}
                  </MiniTable>
                ),
            })}
          </div>
        </Card>
      </div>
    </ReportPage>
  )
}
