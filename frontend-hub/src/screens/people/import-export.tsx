import { useMutation, useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { Banner } from "@/components/ui/states"
import { csvName, downloadCsv, toCsv } from "@/lib/csv"
import { money } from "@/lib/format"
import { agreePay, listEmployees, peopleKeys } from "@/lib/queries/people"
import { type PayRow, readPaySheet } from "@/screens/people/pay-import"
import type { EmployeeSummary } from "@itulah/contract"

const EXPORT_COLUMNS = [
  {
    label: "employee_code",
    value: (row: EmployeeSummary) => row.employee_code,
  },
  { label: "full_name", value: (row: EmployeeSummary) => row.full_name },
  { label: "status", value: (row: EmployeeSummary) => row.status },
  {
    label: "unit",
    value: (row: EmployeeSummary) => row.unit_name ?? row.unit_id,
  },
  { label: "position", value: (row: EmployeeSummary) => row.position },
  { label: "contract", value: (row: EmployeeSummary) => row.contract_kind },
  {
    label: "contract_ends_on",
    value: (row: EmployeeSummary) => row.contract_ends_on,
  },
  { label: "login", value: (row: EmployeeSummary) => row.username },
] as const

type Outcome = { ok: true } | { ok: false; why: string }

/// Import and export, as Talenta's Employee › Import/export: the people as a
/// sheet, and a sheet of pay changes in. Each pay change is a dated
/// agreement like one entered by hand, so a month it lands in is prorated
/// by the payroll schedule's basis — calendar or working days.
export function ImportExportSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const everyone = useQuery({
    queryKey: peopleKeys.employees({ limit: 1000 }),
    queryFn: ({ signal }) => listEmployees({ limit: 1000 }, signal),
    enabled: open,
  })
  const [sheet, setSheet] = useState<{
    rows: PayRow[]
    problems: string[]
  } | null>(null)
  const [outcomes, setOutcomes] = useState<ReadonlyMap<number, Outcome>>(
    new Map()
  )
  const byCode = new Map(
    (everyone.data ?? []).map((one) => [one.employee_code, one.employee_id])
  )

  const apply = useMutation({
    mutationFn: async (rows: readonly PayRow[]) => {
      const next = new Map(outcomes)
      for (const row of rows) {
        const id = byCode.get(row.employeeCode)
        if (id === undefined || next.get(row.line)?.ok === true) continue
        try {
          await agreePay(id, {
            effectiveFrom: row.effectiveFrom,
            baseMinor: row.baseMinor,
            allowances: row.allowances,
            reason: row.reason,
          })
          next.set(row.line, { ok: true })
        } catch (error) {
          next.set(row.line, {
            ok: false,
            why: error instanceof Error ? error.message : "not saved",
          })
        }
        setOutcomes(new Map(next))
      }
    },
  })
  const rows = sheet?.rows ?? []
  const ready = rows.filter((row) => byCode.has(row.employeeCode))

  if (!open) return null
  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id="import-export"
      title="Import & export"
    >
      <SubHead>Export</SubHead>
      <p className="mb-2 text-[0.9375rem] text-mute">
        Everybody on record, as a CSV for Excel.
      </p>
      <Button
        variant="ghost"
        disabled={(everyone.data ?? []).length === 0}
        onClick={() =>
          downloadCsv(
            csvName("employees"),
            toCsv(EXPORT_COLUMNS, everyone.data ?? [])
          )
        }
      >
        Export employees
      </Button>

      <div className="mt-6">
        <SubHead aside="employee_code, effective_from, base_salary, allowances, reason">
          Import pay changes
        </SubHead>
        <p className="mb-2 text-[0.9375rem] text-mute">
          Each row is a new pay agreement from its date. A month a change falls
          in is prorated by the payroll schedule.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="File">
            <input
              type="file"
              accept=".csv,text/csv"
              className="text-[0.9375rem] text-body file:mr-3 file:rounded-inner file:border file:border-hairline-2 file:bg-canvas file:px-3 file:py-1.5 file:text-ink"
              onChange={(event) => {
                const chosen = event.target.files?.[0]
                setOutcomes(new Map())
                if (chosen === undefined) {
                  setSheet(null)
                  return
                }
                void chosen
                  .text()
                  .then((text) => setSheet(readPaySheet(text, "pay import")))
              }}
            />
          </Field>
          <Button
            variant="quiet"
            onClick={() =>
              downloadCsv(
                csvName("pay changes template"),
                "employee_code,effective_from,base_salary,allowances,reason\r\nK0001,2026-10-01,5000000,JABATAN:500000;MAKAN:300000,salary raise\r\n"
              )
            }
          >
            Template
          </Button>
        </div>
        {sheet !== null && sheet.problems.length > 0 && (
          <Banner tone="warn" className="mt-2">
            {sheet.problems.join(" ")}
          </Banner>
        )}
        {rows.length > 0 && (
          <>
            <div className="mt-3">
              <MiniTable
                head={[
                  "Line",
                  "Who",
                  "From",
                  { label: "Base", align: "right" },
                  "",
                ]}
              >
                {rows.map((row) => {
                  const outcome = outcomes.get(row.line)
                  return (
                    <MiniRow key={row.line}>
                      <MiniCell>{row.line}</MiniCell>
                      <MiniCell>{row.employeeCode}</MiniCell>
                      <MiniCell>{row.effectiveFrom}</MiniCell>
                      <MiniCell align="right">
                        {money(row.baseMinor)}
                        {row.allowances.length > 0 && (
                          <span className="block text-[0.9375rem] text-mute">
                            +{row.allowances.length} allowance
                            {row.allowances.length === 1 ? "" : "s"}
                          </span>
                        )}
                      </MiniCell>
                      <MiniCell>
                        {outcome?.ok === true ? (
                          <Pill tone="ok">Saved</Pill>
                        ) : outcome?.ok === false ? (
                          <Pill tone="bad">{outcome.why}</Pill>
                        ) : byCode.has(row.employeeCode) ? (
                          <Pill tone="info">Ready</Pill>
                        ) : (
                          <Pill tone="warn">No such employee</Pill>
                        )}
                      </MiniCell>
                    </MiniRow>
                  )
                })}
              </MiniTable>
            </div>
            <div className="mt-3">
              <Button
                variant="primary"
                pending={apply.isPending}
                disabled={ready.length === 0}
                onClick={() => apply.mutate(ready)}
              >
                Save {ready.length} pay change{ready.length === 1 ? "" : "s"}
              </Button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  )
}
