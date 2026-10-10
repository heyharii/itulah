import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import { Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { count, day } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { problemOf } from "@/lib/problem"
import {
  appointPic,
  organisationKeys,
  unitPicHistory,
  useUnits,
  type UnitView,
} from "@/lib/queries/organisation"
import { listEmployees, peopleKeys } from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"

/// What kind of unit it is, in words.
function kindOf(unit: UnitView): string {
  return unit.kind === "HO"
    ? "Head office"
    : unit.kind === "STORE"
      ? "Store"
      : unit.kind === "ONLINE"
        ? "Online"
        : unit.kind
}

const premisesOf = (unit: UnitView) =>
  unit.sites.map((site) => site.name).join(", ")

const picOf = (unit: UnitView) =>
  unit.pic === null ? "" : (unit.pic.name ?? unit.pic.employee_code)

/// The phone's list: a card per unit (the desk keeps its table). The name over
/// its code, the head count as the figure, and under the hairline who is in
/// charge and where, with the one button this screen has — a word, as every
/// other card's. The first five columns are never drawn: they are what the
/// search reads and the sort sheet names.
function cardColumns(
  onChoose: (unit: UnitView) => void
): ColumnDef<TableSetup, UnitView>[] {
  return [
    {
      id: "name",
      accessorFn: (unit) => unit.name,
      header: "Name",
      meta: { card: "hide" },
    },
    {
      id: "code",
      accessorFn: (unit) => unit.code,
      header: "Code",
      meta: { card: "hide" },
    },
    {
      id: "staff",
      accessorFn: (unit) => unit.headcount,
      header: "Staff",
      meta: { card: "hide" },
    },
    {
      id: "pic",
      accessorFn: picOf,
      header: "Person in Charge",
      enableSorting: false,
      meta: { card: "hide" },
    },
    {
      id: "premises",
      accessorFn: premisesOf,
      header: "Premises",
      enableSorting: false,
      meta: { card: "hide" },
    },
    {
      id: "head",
      accessorFn: (unit) => unit.name,
      header: "",
      enableSorting: false,
      meta: { card: "title" },
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col gap-1">
          <span className="min-w-0 text-[1rem] font-semibold break-words text-ink">
            {row.original.name}
          </span>
          <span className="text-[0.875rem] font-normal text-mute">
            <span className="font-mono">{row.original.code}</span>
            {` · ${kindOf(row.original)}`}
            {row.original.status !== "ACTIVE" &&
              ` · ${row.original.status === "CLOSED" ? "Closed" : row.original.status}`}
          </span>
        </span>
      ),
    },
    {
      id: "lead",
      accessorFn: (unit) => unit.headcount,
      header: "",
      enableSorting: false,
      meta: { card: "lead" },
      cell: ({ row }) => (
        <span className="flex flex-col items-end tabular-nums">
          <span className="text-[1.5rem] leading-tight font-semibold tracking-tight text-ink">
            {count(row.original.headcount)}
          </span>
          <span className="text-[0.875rem] text-mute">staff</span>
        </span>
      ),
    },
    {
      id: "foot",
      accessorFn: picOf,
      header: "",
      enableSorting: false,
      meta: { card: "foot" },
      cell: ({ row }) => {
        const unit = row.original
        const premises = premisesOf(unit)
        return (
          <span className="flex min-w-0 flex-col break-words">
            {unit.pic === null ? (
              <span>Nobody in charge</span>
            ) : (
              <span>
                <span className="text-ink">
                  {unit.pic.name ?? unit.pic.employee_code}
                </span>
                {` · since ${day(unit.pic.valid_from)}`}
              </span>
            )}
            {premises !== "" && <span>{premises}</span>}
          </span>
        )
      },
    },
    {
      id: "set",
      header: "",
      enableSorting: false,
      meta: { align: "right", card: "status" },
      cell: ({ row }) => (
        <Button
          variant="tint"
          size="card"
          disabled={row.original.status !== "ACTIVE"}
          aria-label={`${row.original.pic === null ? "Set PIC" : "Change PIC"} of ${row.original.name}`}
          onClick={(event) => {
            event.stopPropagation()
            onChoose(row.original)
          }}
        >
          {row.original.pic === null ? "Set PIC" : "Change PIC"}
        </Button>
      ),
    },
  ]
}

/// The organisation's units: head office and each store, with the premises
/// each owns and the person in charge.
///
/// A unit is what owns books and people; a site is a building. The id is
/// internal and never shown here — the client's code (C004) and name
/// (Bumiayu) are what a person reads. How many units there are is data: a
/// store that opens is a row, not a release.
///
/// Setting a PIC is head office's (Admin), and the server refuses anybody who
/// is not an active employee posted at that unit on the day the appointment
/// starts. The predecessor's span is closed the same day, so the history this
/// screen shows under a unit is never rewritten, only continued.
export function Organisation() {
  const units = useUnits()
  const [choosing, setChoosing] = useState<UnitView | null>(null)
  const phone = useLayout() === "phone"
  /// What the phone's dock field typed: a name, a code, a person, a place.
  const [query, setQuery] = useState("")
  const [sorting, setSorting] = useState<SortingState>([])

  const columns = useMemo(() => cardColumns(setChoosing), [])
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: units.data ?? [],
        columns,
        getRowId: (unit: UnitView) => unit.id,
        state: { globalFilter: query, sorting },
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
      }),
      [units.data, columns, query, sorting]
    )
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Master"
        title="Units"
        sub="Head office and the stores — who owns which premises, and who is in charge of each."
      />

      <DockTools
        search={{ value: query, onChange: setQuery, label: "Search units" }}
        sort={dockSortOf(table)}
      />

      <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {queryState(units, {
          loading: "Reading the units…",
          render: (rows) =>
            rows.length === 0 ? (
              <EmptyState>No unit has been set up.</EmptyState>
            ) : phone ? (
              <DataTable<UnitView>
                table={table}
                onRowClick={(unit) =>
                  unit.status === "ACTIVE" && setChoosing(unit)
                }
                empty="Nothing matches that search."
                pageScroll
                cardSort={false}
                cardsApart
                cardLead
              />
            ) : (
              <table className="w-full text-[0.875rem]">
                <thead>
                  <tr className="border-b border-hairline text-left text-meta text-mute">
                    <th className="px-3 py-2 font-medium">Code</th>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Kind</th>
                    <th className="px-3 py-2 font-medium">Premises</th>
                    <th className="px-3 py-2 text-right font-medium">Staff</th>
                    <th className="px-3 py-2 font-medium">Person in Charge</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((unit) => (
                    <tr
                      key={unit.id}
                      className="border-b border-hairline last:border-b-0"
                    >
                      <td className="px-3 py-2 font-mono text-id text-ink">
                        {unit.code}
                      </td>
                      <td className="px-3 py-2 text-ink">
                        {unit.name}
                        {unit.status !== "ACTIVE" && (
                          <Pill tone="neutral" className="ml-2">
                            {unit.status === "CLOSED" ? "Closed" : unit.status}
                          </Pill>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Pill tone={unit.kind === "HO" ? "accent" : "neutral"}>
                          {kindOf(unit)}
                        </Pill>
                      </td>
                      <td className="px-3 py-2 text-body">
                        {unit.sites.length === 0
                          ? "—"
                          : unit.sites.map((site) => site.name).join(", ")}
                      </td>
                      <td className="px-3 py-2 text-right text-body tabular-nums">
                        {count(unit.headcount)}
                      </td>
                      <td className="px-3 py-2">
                        {unit.pic === null ? (
                          <span className="text-mute">Nobody</span>
                        ) : (
                          <span className="text-ink">
                            {unit.pic.name ?? unit.pic.employee_code}
                            <span className="text-mute">
                              {" "}
                              · since {day(unit.pic.valid_from)}
                            </span>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="sm"
                          variant="quiet"
                          disabled={unit.status !== "ACTIVE"}
                          onClick={() => setChoosing(unit)}
                        >
                          {unit.pic === null ? "Set PIC" : "Change PIC"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ),
        })}
      </Card>

      <PicSheet unit={choosing} onClose={() => setChoosing(null)} />
    </PageContent>
  )
}

/// Put somebody in charge of one unit, and show who has been before.
function PicSheet({
  unit,
  onClose,
}: {
  unit: UnitView | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const [employeeId, setEmployeeId] = useState("")
  const [validFrom, setValidFrom] = useState("")
  const [reason, setReason] = useState("")
  const unitId = unit?.id ?? ""

  // Only the people posted here: the server would refuse anybody else, and a
  // picker that offered them would be offering a refusal.
  const staff = useQuery({
    queryKey: peopleKeys.employees({
      status: "ACTIVE",
      unitId,
      limit: 500,
    }),
    queryFn: ({ signal }) =>
      listEmployees({ status: "ACTIVE", unitId, limit: 500 }, signal),
    enabled: unitId !== "",
  })

  const history = useQuery({
    queryKey: organisationKeys.pic(unitId),
    queryFn: ({ signal }) => unitPicHistory(unitId, signal),
    enabled: unitId !== "",
  })

  const appoint = useMutation({
    mutationFn: () =>
      appointPic(unitId, {
        employeeId,
        validFrom: validFrom === "" ? undefined : validFrom,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: organisationKeys.all })
      setEmployeeId("")
      setValidFrom("")
      setReason("")
      appoint.reset()
      onClose()
    },
  })

  const ready =
    unitId !== "" &&
    employeeId !== "" &&
    reason.trim() !== "" &&
    !appoint.isPending
  const problem = problemOf(appoint.error)

  return (
    <Sheet
      open={unit !== null}
      onOpenChange={(next) => {
        if (!next) {
          appoint.reset()
          onClose()
        }
      }}
      title={unit === null ? "Person in charge" : `${unit.code} · ${unit.name}`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!ready}
            onClick={() => appoint.mutate()}
          >
            {appoint.isPending ? "Saving…" : "Put in charge"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3.5">
        <Banner tone="info">
          The person in charge answers for this unit and gets its reach. They
          must be an active employee posted here; whoever holds it now stops on
          the day this starts.
        </Banner>

        {problem !== null && <Banner tone="bad">{problem}</Banner>}

        <Field label="Who" hint="Active staff posted at this unit.">
          <Select value={employeeId} onChange={setEmployeeId}>
            <option value="">Choose somebody…</option>
            {(staff.data ?? []).map((person) => (
              <option key={person.employee_id} value={person.employee_id}>
                {person.full_name ?? person.employee_code} ·{" "}
                {person.employee_code}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="From"
          hint="The first day they are in charge. Today when left blank."
        >
          <Input
            type="date"
            value={validFrom}
            onChange={(event) => setValidFrom(event.target.value)}
          />
        </Field>

        <Field label="Why" hint="Recorded with the appointment.">
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>

        <div>
          <h4 className="mb-2 text-card-title font-semibold text-ink">
            Who has been in charge
          </h4>
          {queryState(history, {
            loading: "Reading the history…",
            render: (rows) =>
              rows.length === 0 ? (
                <EmptyState>Nobody has been put in charge yet.</EmptyState>
              ) : (
                <ul className="flex flex-col gap-1.5 text-[0.875rem]">
                  {rows.map((pic) => (
                    <li
                      key={`${pic.employee_id}-${pic.valid_from}-${pic.set_at}`}
                      className="flex flex-wrap items-baseline gap-x-2"
                    >
                      <span className="text-ink">
                        {pic.name ?? pic.employee_code}
                      </span>
                      <span className="text-mute">
                        {day(pic.valid_from)} –{" "}
                        {pic.valid_to === null ? "now" : day(pic.valid_to)}
                      </span>
                      <span className="text-mute">
                        · set by {pic.set_by}: {pic.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              ),
          })}
        </div>
      </div>
    </Sheet>
  )
}
