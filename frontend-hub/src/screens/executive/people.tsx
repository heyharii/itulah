import { useQueries, useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { Suspense, useMemo } from "react"

import { Card } from "@/components/ui/card"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { count, day, money } from "@/lib/format"
import { gaExecutiveContractsQuery, gaLocationsQuery } from "@/lib/queries/ga"
import { useUnits } from "@/lib/queries/organisation"
import {
  expiringContracts,
  listWorkforce,
  peopleKeys,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useScopeUnit } from "@/screens/executive/books"
import {
  CardTable,
  field,
  type CardShape,
} from "@/screens/executive/card-table"
import { rupiah } from "@/screens/executive/format"
import { Figure, Figures, Head, ReportPage } from "@/screens/executive/parts"
import { usePlaces } from "@/screens/executive/places"
import { useReportScope, type ReportScope } from "@/screens/executive/scope"
import { SupplierName } from "@/screens/procurement/supplier-name"
import type {
  ExpiringContract,
  GaContractRow,
  GaLocationRow,
} from "@itulah/contract"

/// Team & Assets — how many people each place has, what is broken, what is due
/// for upkeep, and which agreements run out in the next thirty days.

const SOON = 30

/// Active people at one unit — `total` of a one-row page, so the count is the
/// server's and not the length of whatever page came back.
const ACTIVE = (unitId?: string) =>
  ({ status: "ACTIVE", unitId, limit: 1 }) as const

const locationKey = (row: GaLocationRow) => row.site_id
const employeeKey = (row: ExpiringContract) => row.employee_id
const dealKey = (row: GaContractRow) => row.contract_id

/// Whether a GA row (at a site) or an HR row (at a unit) belongs to the shop
/// the report is narrowed to: at that shop, or in the unit owning it.
function here<T extends { site_id?: string | null; unit_id?: string | null }>(
  store: string | undefined,
  scopeUnit: string | undefined | null,
  row: T
): boolean {
  if (store === undefined) return true
  const site = row.site_id ?? null
  if (site !== null) return site === store
  const unit = row.unit_id ?? null
  return unit !== null && unit === scopeUnit
}

/// Employee contracts that end within the next month, at the shop the report
/// is narrowed to. A plain read: it is the people's, and a role without them is
/// shown the figure as "…" rather than a page that does not draw.
function useExpiring(scope: ReportScope) {
  const scopeUnit = useScopeUnit(scope)
  const expiring = useQuery({
    queryKey: peopleKeys.expiring(SOON),
    queryFn: ({ signal }) => expiringContracts({ withinDays: SOON }, signal),
  })
  const people = useMemo(
    () =>
      (expiring.data ?? []).filter((row) => here(scope.store, scopeUnit, row)),
    [expiring.data, scope.store, scopeUnit]
  )
  return { expiring, people }
}

/// The locations GA keeps, at the shop the report is narrowed to. Read inside
/// a `<Suspense>`.
function useLocations(scope: ReportScope) {
  const scopeUnit = useScopeUnit(scope)
  const locations = useSuspenseQuery(gaLocationsQuery())
  const rows = useMemo(
    () => locations.data.filter((row) => here(scope.store, scopeUnit, row)),
    [locations.data, scope.store, scopeUnit]
  )
  return { locations, rows }
}

/// The GA agreements that run out within the next month, soonest first, at the
/// shop the report is narrowed to. Read inside a `<Suspense>`.
function useDeals(scope: ReportScope) {
  const scopeUnit = useScopeUnit(scope)
  const agreements = useSuspenseQuery(gaExecutiveContractsQuery())
  return useMemo(
    () =>
      agreements.data.rows
        .filter(
          (row) =>
            row.days_to_end !== null &&
            row.days_to_end >= 0 &&
            row.days_to_end <= SOON &&
            here(scope.store, scopeUnit, row)
        )
        .sort((a, b) => (a.days_to_end ?? 0) - (b.days_to_end ?? 0)),
    [agreements.data, scope.store, scopeUnit]
  )
}

export function ExecutivePeople() {
  const scope = useReportScope()

  return (
    <ReportPage title="Team & Assets" scope={scope}>
      <Figures>
        <ActiveEmployeesFigure scope={scope} />
        <EndingContractsFigure scope={scope} />
        <Suspense fallback={<Figure label="Open repairs" value="—" />}>
          <RepairsFigure scope={scope} />
        </Suspense>
        <Suspense
          fallback={
            <Figure
              label="GA contracts ending"
              value="—"
              note={`Within ${SOON} days`}
            />
          }
        >
          <DealsFigure scope={scope} />
        </Suspense>
      </Figures>

      <Card className="mb-3 overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        <Head title="By location" to="/maintenance" link="Open repairs" />
        <Suspense
          fallback={<LoadingState>Reading the locations…</LoadingState>}
        >
          <LocationTable scope={scope} />
        </Suspense>
      </Card>

      <div className="grid gap-3 xl:grid-cols-2">
        <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
          <Head
            title="Employee contracts ending"
            to="/people"
            link="Open People"
          />
          <EmployeeContractTable scope={scope} />
        </Card>

        <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
          <Head
            title="GA contracts ending"
            to="/contracts"
            link="Open contracts"
          />
          <Suspense
            fallback={<LoadingState>Reading the contracts…</LoadingState>}
          >
            <DealTable scope={scope} />
          </Suspense>
        </Card>
      </div>
    </ReportPage>
  )
}

/// How many people are on the books at the shop's unit, or the whole company.
function ActiveEmployeesFigure({ scope }: { scope: ReportScope }) {
  // People are posted to units, and the report is narrowed to a shop — a
  // site. The workforce is asked about the unit owning it.
  const scopeUnit = useScopeUnit(scope)
  const headcount = useQuery({
    queryKey: peopleKeys.employees(ACTIVE(scopeUnit ?? undefined)),
    queryFn: ({ signal }) =>
      listWorkforce(ACTIVE(scopeUnit ?? undefined), signal),
    enabled: scopeUnit !== null,
  })
  return (
    <Figure
      label="Active employees"
      value={headcount.data ? count(headcount.data.total) : "…"}
    />
  )
}

/// How many employee contracts end within the month.
function EndingContractsFigure({ scope }: { scope: ReportScope }) {
  const { expiring, people } = useExpiring(scope)
  return (
    <Figure
      label="Employee contracts ending"
      value={expiring.data ? count(people.length) : "…"}
      note={`Within ${SOON} days`}
    />
  )
}

/// Repairs still open, and the maintenance that is due.
function RepairsFigure({ scope }: { scope: ReportScope }) {
  const { rows } = useLocations(scope)
  const repairs = rows.reduce((sum, row) => sum + row.open_repair_count, 0)
  return (
    <Figure
      label="Open repairs"
      value={count(repairs)}
      note={`${count(rows.reduce((sum, row) => sum + row.due_task_count, 0))} maintenance due`}
    />
  )
}

/// How many GA agreements end within the month.
function DealsFigure({ scope }: { scope: ReportScope }) {
  const deals = useDeals(scope)
  return (
    <Figure
      label="GA contracts ending"
      value={count(deals.length)}
      note={`Within ${SOON} days`}
    />
  )
}

/// One row per place: its people, its repairs, its upkeep and its bills.
function LocationTable({ scope }: { scope: ReportScope }) {
  const { nameOf } = usePlaces(scope)
  const { locations, rows } = useLocations(scope)

  // Each location row counts the unit that owns that location.
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
  const units = useMemo(
    () => [
      ...new Set(
        locations.data.flatMap((row) => {
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
  const heads = new Map(
    units.map((unitId, index) => [unitId, perUnit[index]?.data?.total])
  )

  /// The head count of a location is its unit's, so the column is drawn from
  /// the two maps the page has read.
  const locationColumns = [
    field<GaLocationRow>(
      "location",
      "Location",
      (row) => (
        <span className="font-medium text-ink">
          {row.site_name || nameOf(row.site_id)}
        </span>
      ),
      { by: (row) => row.site_name || nameOf(row.site_id) }
    ),
    field<GaLocationRow>(
      "employees",
      "Active Employees",
      (row) => count(heads.get(unitOfSite.get(row.site_id) ?? "")),
      { right: true, card: "hide" }
    ),
    field<GaLocationRow>(
      "repairs",
      "Open Repairs",
      (row) =>
        row.open_repair_count === 0 ? (
          <span className="text-mute">—</span>
        ) : (
          count(row.open_repair_count)
        ),
      { right: true, by: (row) => row.open_repair_count, priority: 2 }
    ),
    field<GaLocationRow>(
      "due",
      "Maintenance Due",
      (row) =>
        row.due_task_count === 0 ? (
          <span className="text-mute">—</span>
        ) : (
          count(row.due_task_count)
        ),
      { right: true, by: (row) => row.due_task_count, priority: 3 }
    ),
    field<GaLocationRow>(
      "billed",
      "Billed This Month",
      (row) => (
        <span title={money(row.billed_this_month_minor)}>
          {rupiah(row.billed_this_month_minor)}
        </span>
      ),
      { right: true, by: (row) => row.billed_this_month_minor }
    ),
  ]
  const locationCard: CardShape<GaLocationRow> = {
    lead: (row) => {
      const people = heads.get(unitOfSite.get(row.site_id) ?? "")
      return {
        value: count(people),
        caption: people === 1 ? "employee" : "employees",
        tone: people === 0 ? "quiet" : undefined,
      }
    },
    foot: (row) =>
      `${count(row.open_repair_count)} open ${row.open_repair_count === 1 ? "repair" : "repairs"} · ${count(row.due_task_count)} maintenance due · ${rupiah(row.billed_this_month_minor)} billed`,
  }

  return rows.length === 0 ? (
    <EmptyState>No locations are registered yet.</EmptyState>
  ) : (
    <CardTable<GaLocationRow>
      columns={locationColumns}
      rows={rows}
      getRowId={locationKey}
      card={locationCard}
    />
  )
}

/// The employees whose contracts end soon.
function EmployeeContractTable({ scope }: { scope: ReportScope }) {
  const { nameOf } = usePlaces(scope)
  const { expiring, people } = useExpiring(scope)

  const employeeColumns = [
    field<ExpiringContract>(
      "employee",
      "Employee",
      (row) => (
        <>
          <span className="block font-medium text-ink">
            {row.full_name ?? row.employee_code}
          </span>
          <span className="block text-[0.9375rem] text-mute">
            {row.position}
          </span>
        </>
      ),
      { by: (row) => row.full_name ?? row.employee_code }
    ),
    field<ExpiringContract>(
      "location",
      "Location",
      (row) => (row.unit_id === null ? "—" : nameOf(row.unit_id)),
      { right: true, priority: 3 }
    ),
    field<ExpiringContract>("ends", "Ends", (row) => day(row.ends_on), {
      right: true,
      by: (row) => row.ends_on,
      priority: 2,
    }),
    field<ExpiringContract>(
      "remaining",
      "Remaining",
      (row) => `${row.days_remaining} days`,
      { right: true, by: (row) => row.days_remaining }
    ),
  ]
  const employeeCard: CardShape<ExpiringContract> = {
    lead: (row) => ({
      value: row.days_remaining,
      caption: row.days_remaining === 1 ? "day left" : "days left",
    }),
    foot: (row) =>
      `Ends ${day(row.ends_on)}${row.unit_id === null ? "" : ` · ${nameOf(row.unit_id)}`}`,
  }

  return queryState(expiring, {
    loading: "Reading the contracts…",
    render: () =>
      people.length === 0 ? (
        <EmptyState>No contracts end in the next {SOON} days.</EmptyState>
      ) : (
        <CardTable<ExpiringContract>
          columns={employeeColumns}
          rows={people}
          getRowId={employeeKey}
          card={employeeCard}
        />
      ),
  })
}

/// The GA agreements that run out soon.
function DealTable({ scope }: { scope: ReportScope }) {
  const { nameOf } = usePlaces(scope)
  const deals = useDeals(scope)

  const dealColumns = [
    field<GaContractRow>(
      "contract",
      "Contract",
      (row) => (
        <>
          <span className="block font-medium text-ink">
            {row.objek_name ?? row.contract_type_name}
          </span>
          <span className="block text-[0.9375rem] text-mute">
            {row.counterparty_name ?? (
              <SupplierName code={row.supplier_id} name={row.supplier_name} />
            )}
          </span>
        </>
      ),
      { by: (row) => row.objek_name ?? row.contract_type_name }
    ),
    field<GaContractRow>(
      "location",
      "Location",
      (row) => (row.site_id === null ? "All" : nameOf(row.site_id)),
      { right: true, priority: 3 }
    ),
    field<GaContractRow>("ends", "Ends", (row) => day(row.ends_on), {
      right: true,
      by: (row) => row.ends_on,
      priority: 2,
    }),
    field<GaContractRow>(
      "remaining",
      "Remaining",
      (row) => `${row.days_to_end} days`,
      { right: true, by: (row) => row.days_to_end }
    ),
  ]
  const dealCard: CardShape<GaContractRow> = {
    lead: (row) => ({
      value: row.days_to_end,
      caption: row.days_to_end === 1 ? "day left" : "days left",
    }),
    foot: (row) =>
      `Ends ${day(row.ends_on)} · ${row.site_id === null ? "All locations" : nameOf(row.site_id)}`,
  }

  return deals.length === 0 ? (
    <EmptyState>No contracts end in the next {SOON} days.</EmptyState>
  ) : (
    <CardTable<GaContractRow>
      columns={dealColumns}
      rows={deals}
      getRowId={dealKey}
      card={dealCard}
    />
  )
}
