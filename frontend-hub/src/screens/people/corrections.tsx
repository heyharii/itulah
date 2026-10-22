import { queryOptions, useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { Suspense, useState } from "react"

import type { CorrectionRow } from "@itulah/contract"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Fab } from "@/components/ui/fab"
import { PageHeader } from "@/components/ui/page-header"
import { CardButton, CardName, PhoneCards } from "@/components/ui/phone-cards"
import { Status } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { EmptyState } from "@/components/ui/states"
import { today } from "@/lib/calendar"
import { day } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { useNameOfLogin } from "@/lib/queries/hr-employees"
import { monthTitle } from "@/lib/queries/hr-time"
import {
  listCorrections,
  listEmployees,
  peopleKeys,
  punchKeys,
} from "@/lib/queries/people"
import { useCanWrite } from "@/lib/session"
import { useSheet } from "@/lib/sheets"
import { statusWord } from "@/lib/words"
import { FileCorrectionSheet } from "@/screens/people/attendance-correction-sheet"
import { awaiting } from "@/screens/people/awaiting"
import { HrScope, useHrMonth, useUnitFilter } from "@/screens/people/parts"
import {
  CorrectionSheet,
  correctedTime,
  correctionWords,
  decisionTone,
  effectLabel,
  useUnitName,
} from "@/screens/people/requests"

/// Attendance › Corrections — every correction filed for a month, decided or
/// not, one row each: what a person says the reader should have seen, and what
/// became of the ask.
///
/// The inbox lists only what is waiting; this is the record behind it, so a
/// payroll question ("why was this day paid?") is answered by finding the
/// correction rather than asking around. A row opens the same sheet as the
/// inbox's, which decides it while it is pending and only reads once it is
/// not.
///
/// The unit and the month are HR's shared choice (`parts.tsx`), so the page
/// opens on whatever the last HR page was looking at. The server serves the
/// whole history of the unit and the browser keeps the month's days — a
/// correction is filed against the day it is about, not the day it was asked.
const correctionsQuery = (unit: string | null) =>
  queryOptions({
    queryKey: punchKeys.corrections(unit, false),
    queryFn: ({ signal }) =>
      listCorrections({ unit: unit ?? undefined, pending: false }, signal),
  })

/// The month's corrections, the latest day first.
function inMonth(
  rows: readonly CorrectionRow[],
  month: string
): CorrectionRow[] {
  return rows
    .filter((row) => row.business_date.startsWith(month))
    .sort(
      (a, b) =>
        b.business_date.localeCompare(a.business_date) ||
        a.display_name.localeCompare(b.display_name)
    )
}

export function Corrections() {
  const phone = useLayout() === "phone"
  const canWrite = useCanWrite()
  const correction = useSheet("request")
  const filter = useUnitFilter()
  const hrMonth = useHrMonth()
  const [month] = hrMonth
  const [filing, setFiling] = useState(false)
  const unitName = useUnitName()
  const nameOfLogin = useNameOfLogin()
  const query = correctionsQuery(filter.unitId)

  /// Who a correction can be filed for; the sheet asks which one.
  const team = useQuery({
    queryKey: peopleKeys.employees({ status: "ACTIVE", limit: 1000 }),
    queryFn: ({ signal }) =>
      listEmployees({ status: "ACTIVE", limit: 1000 }, signal),
  })

  const nothing = `No correction${
    filter.unitId === null ? "" : ` at ${unitName(filter.unitId)}`
  } in ${monthTitle(month)}.`
  const open = (row: CorrectionRow) => correction.open(row.id)

  return (
    <PageContent>
      {canWrite && (
        <Fab label="Request correction" onClick={() => setFiling(true)} />
      )}
      <PageHeader
        title="Corrections"
        actions={
          !phone &&
          canWrite && (
            <Button variant="primary" onClick={() => setFiling(true)}>
              Request correction
            </Button>
          )
        }
      />

      <HrScope unit={filter} month={hrMonth} />

      <Card className="overflow-hidden px-4 py-2 max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:p-0 max-md:shadow-none">
        {awaiting(query, {
          loading: "Reading the corrections…",
          render: (all) => {
            const rows = inMonth(all, month)
            if (rows.length === 0) return <EmptyState>{nothing}</EmptyState>
            return phone ? (
              <PhoneCards
                rows={rows}
                onOpen={open}
                rowId={(row) => row.id}
                spec={{
                  title: (row) => (
                    <CardName
                      name={row.display_name}
                      line={[
                        `${day(row.business_date)} · ${unitName(row.unit_id)}`,
                        correctionWords(row),
                      ]}
                    />
                  ),
                  foot: (row) => (
                    <Status tone={decisionTone(row.state)}>
                      {statusWord(row.state)}
                    </Status>
                  ),
                  action: (row) => (
                    <CardButton
                      label="Open"
                      ariaLabel={`Open ${row.display_name}’s correction`}
                      onClick={() => open(row)}
                    />
                  ),
                }}
              />
            ) : (
              <MiniTable
                head={[
                  "Employee",
                  { label: "Unit", align: "left" },
                  { label: "Day", align: "left" },
                  { label: "Claims", align: "left" },
                  { label: "Arrived", align: "left" },
                  { label: "Left", align: "left" },
                  { label: "State", align: "left" },
                  { label: "Asked by", align: "left" },
                ]}
              >
                {rows.map((row) => (
                  <MiniRow key={row.id}>
                    <MiniCell>
                      <button
                        type="button"
                        onClick={() => open(row)}
                        className="text-left text-[0.9375rem] font-medium text-ink hover:underline"
                      >
                        {row.display_name}
                      </button>
                    </MiniCell>
                    <MiniCell>{unitName(row.unit_id)}</MiniCell>
                    <MiniCell>{day(row.business_date)}</MiniCell>
                    <MiniCell>{effectLabel(row.effect)}</MiniCell>
                    <MiniCell>{correctedTime(row.corrected_arrival)}</MiniCell>
                    <MiniCell>
                      {correctedTime(row.corrected_departure)}
                    </MiniCell>
                    <MiniCell>
                      <Status tone={decisionTone(row.state)}>
                        {statusWord(row.state)}
                      </Status>
                    </MiniCell>
                    <MiniCell>{nameOfLogin(row.requested_by)}</MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            )
          },
        })}
      </Card>

      <FileCorrectionSheet
        open={filing}
        onClose={() => setFiling(false)}
        defaultDate={today()}
        people={(team.data ?? []).map((one) => ({
          value: one.employee_id,
          label:
            one.full_name === null
              ? one.employee_code
              : `${one.full_name} · ${one.employee_code}`,
        }))}
      />

      {/* The sheet finds its row in the unit's whole history rather than in
          the month on screen, so changing the month under an open sheet does
          not take the record away from the reader. */}
      {correction.value !== undefined && (
        <Suspense fallback={null}>
          <OpenCorrection
            query={query}
            id={correction.value}
            onClose={correction.close}
          />
        </Suspense>
      )}
    </PageContent>
  )
}

function OpenCorrection({
  query,
  id,
  onClose,
}: {
  query: ReturnType<typeof correctionsQuery>
  id: string
  onClose: () => void
}) {
  const all = useSuspenseQuery(query)
  const open = all.data.find((row) => row.id === id) ?? null
  return <CorrectionSheet key={open?.id} correction={open} onClose={onClose} />
}
