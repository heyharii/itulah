import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { count, day } from "@/lib/format"
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

  return (
    <PageContent>
      <PageHeader
        crumb="System"
        title="Units"
        sub="Head office and the stores — who owns which premises, and who is in charge of each."
      />

      <Card className="overflow-hidden">
        {queryState(units, {
          loading: "Reading the units…",
          render: (rows) =>
            rows.length === 0 ? (
              <EmptyState>No unit has been set up.</EmptyState>
            ) : (
              <table className="w-full text-[0.875rem]">
                <thead>
                  <tr className="border-b border-hairline text-left text-meta text-mute">
                    <th className="px-3 py-2 font-medium">Code</th>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Kind</th>
                    <th className="px-3 py-2 font-medium">Premises</th>
                    <th className="px-3 py-2 text-right font-medium">Staff</th>
                    <th className="px-3 py-2 font-medium">Person in charge</th>
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
                          {unit.kind === "HO"
                            ? "Head office"
                            : unit.kind === "STORE"
                              ? "Store"
                              : unit.kind === "ONLINE"
                                ? "Online"
                                : unit.kind}
                        </Pill>
                      </td>
                      <td className="px-3 py-2 text-body">
                        {unit.sites.length === 0
                          ? "—"
                          : unit.sites.map((site) => site.name).join(", ")}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-body">
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

        <Field label="From" hint="The first day they are in charge. Today when left blank.">
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
            placeholder="New store manager"
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
