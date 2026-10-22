import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Card } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { Pill, Status } from "@/components/ui/pill"
import {
  CardButton,
  CardFigure,
  CardFoot,
  CardName,
  PhoneCards,
} from "@/components/ui/phone-cards"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { Banner, EmptyState } from "@/components/ui/states"
import { money, monthYear } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { monthTitle } from "@/lib/queries/hr-time"
import {
  payKeys,
  periodSlips,
  runStateLabel,
  useReach,
  useReachableUnits,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { HrScope, useHrMonth, useUnitFilter } from "@/screens/people/parts"
import { SlipBreakdown } from "@/screens/people/slip-view"
import type { PayrollSlipRow, PeriodSlipRow } from "@itulah/contract"

/// Payroll › Payslips — every payslip of one month, one row each, across the
/// units the caller reaches and whatever state their run is in.
///
/// A payslip is not a record of its own: the server serves it as a row of its
/// run (`GET /api/v1/payroll/slips`). A row opens the same payslip the run
/// sheet opens (`SlipBreakdown`); holding or releasing pay stays on the run,
/// one link away.

const NO_SLIPS: PeriodSlipRow[] = []

function runTone(state: string) {
  switch (state) {
    case "APPROVED":
      return "ok" as const
    case "SUBMITTED":
      return "info" as const
    default:
      return "warn" as const
  }
}

function nameOf(slip: PayrollSlipRow): string {
  return slip.full_name ?? slip.employee_code
}

/// A unit by its name; the run only carries the id. A manager is offered no
/// list of units, so their own posting names theirs.
function useUnitName(): (id: string) => string {
  const reach = useReach()
  const reachable = useReachableUnits()
  return (id) =>
    reachable.data?.find((one) => one.id === id)?.name ??
    (reach.data?.unit_id === id ? reach.data.unit_name : null) ??
    id
}

/// Where the pay goes, for a desk's column and a phone's line.
function paidTo(slip: PayrollSlipRow): React.ReactNode {
  return slip.payable ? (
    (slip.bank_account_masked ?? "—")
  ) : (
    <span className="text-bad-fg">No account</span>
  )
}

export function Payslips() {
  const phone = useLayout() === "phone"
  const month = useHrMonth()
  const unit = useUnitFilter()
  const unitName = useUnitName()
  const [openKey, setOpenKey] = useState<{
    runId: string
    employeeId: string
  } | null>(null)

  const slips = useQuery({
    queryKey: payKeys.periodSlips(month[0], unit.unitId),
    queryFn: ({ signal }) => periodSlips(month[0], unit.unitId, signal),
  })
  const rows = [...(slips.data ?? NO_SLIPS)].sort(
    (a, b) =>
      unitName(a.unit_id).localeCompare(unitName(b.unit_id)) ||
      nameOf(a.slip).localeCompare(nameOf(b.slip))
  )
  const shown =
    openKey === null
      ? null
      : (rows.find(
          (row) =>
            row.slip.run_id === openKey.runId &&
            row.slip.employee_id === openKey.employeeId
        ) ?? null)
  const open = (row: PeriodSlipRow) =>
    setOpenKey({ runId: row.slip.run_id, employeeId: row.slip.employee_id })

  const where =
    unit.unitId === null
      ? null
      : (unit.units.find((one) => one.id === unit.unitId)?.name ?? unit.unitId)

  return (
    <PageContent>
      <PageHeader title="Payroll" />
      <HrScope unit={unit} month={month} />

      <Card className="overflow-hidden px-4 py-2 max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:p-0 max-md:shadow-none">
        {queryState(slips, {
          loading: "Reading the payslips…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {where === null
                  ? `No payslip for ${monthTitle(month[0])}.`
                  : `${where} has no payslip for ${monthTitle(month[0])}.`}
              </EmptyState>
            ) : phone ? (
              <PhoneCards
                rows={rows}
                onOpen={open}
                rowId={(row) => `${row.slip.run_id}:${row.slip.employee_id}`}
                spec={{
                  title: (row) => (
                    <CardName
                      name={nameOf(row.slip)}
                      line={[
                        unitName(row.unit_id),
                        `Gross ${money(row.slip.gross_minor)}`,
                      ]}
                    />
                  ),
                  lead: (row) => (
                    <CardFigure
                      value={money(row.slip.net_minor)}
                      caption="take-home"
                      tone={row.slip.net_minor === null ? "quiet" : undefined}
                    />
                  ),
                  foot: (row) => (
                    <CardFoot
                      status={
                        <Status tone={runTone(row.run_state)}>
                          {runStateLabel(row.run_state)}
                        </Status>
                      }
                    >
                      {paidTo(row.slip)}
                    </CardFoot>
                  ),
                  action: (row) => (
                    <CardButton
                      label="Open"
                      ariaLabel={`Open the payslip of ${nameOf(row.slip)}`}
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
                  { label: "Run", align: "left" },
                  "Gross",
                  "Deductions",
                  "Take-home",
                  { label: "Paid to", align: "left" },
                ]}
              >
                {rows.map((row) => (
                  <MiniRow key={`${row.slip.run_id}:${row.slip.employee_id}`}>
                    <MiniCell>
                      <button
                        type="button"
                        onClick={() => open(row)}
                        className="text-left text-[0.9375rem] text-ink hover:underline"
                      >
                        {nameOf(row.slip)}
                      </button>{" "}
                      {row.slip.withheld && <Pill tone="warn">Held</Pill>}
                    </MiniCell>
                    <MiniCell>{unitName(row.unit_id)}</MiniCell>
                    <MiniCell>
                      <Status tone={runTone(row.run_state)}>
                        {runStateLabel(row.run_state)}
                      </Status>
                    </MiniCell>
                    <MiniCell align="right">
                      {money(row.slip.gross_minor)}
                    </MiniCell>
                    <MiniCell align="right">
                      {money(row.slip.deduction_total_minor)}
                    </MiniCell>
                    <MiniCell align="right">
                      {money(row.slip.net_minor)}
                    </MiniCell>
                    <MiniCell>{paidTo(row.slip)}</MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
      </Card>

      {shown !== null && (
        <Sheet
          open
          onOpenChange={(next) => {
            if (!next) setOpenKey(null)
          }}
          id={`Payslip · ${monthYear(shown.slip.period)}`}
          title={nameOf(shown.slip)}
          badge={
            <Pill tone={runTone(shown.run_state)}>
              {runStateLabel(shown.run_state)}
            </Pill>
          }
          footer={
            <SheetFooter
              cancelLabel="Close"
              onCancel={() => setOpenKey(null)}
              secondary={
                <AppLink
                  to="/people/payroll"
                  sheet={{ key: "payrollRun", value: shown.slip.run_id }}
                  variant="ghost"
                >
                  Open run
                </AppLink>
              }
            />
          }
        >
          {shown.slip.withheld && (
            <Banner tone="warn" className="mb-4">
              Pay is held on this run.
            </Banner>
          )}
          <SlipBreakdown slip={shown.slip} />
        </Sheet>
      )}
    </PageContent>
  )
}
