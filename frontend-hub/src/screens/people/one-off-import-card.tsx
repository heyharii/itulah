import { useMutation } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { Banner } from "@/components/ui/states"
import { csvName, downloadCsv } from "@/lib/csv"
import { money } from "@/lib/format"
import { fileAdjustment } from "@/lib/queries/people"
import {
  type ImportRow,
  type ImportSheet,
  readOneOffSheet,
} from "@/screens/people/one-off-import"

type Outcome =
  { readonly ok: true } | { readonly ok: false; readonly why: string }

/// Import a month's one-offs from a sheet — incentives, commissions, a
/// kasbon instalment — rather than filing forty by hand. Each row is filed
/// through the same route as the form beside it, one at a time, and each
/// gets its own answer: a refused row does not stop the rest, and nothing is
/// filed twice by pressing the button again — rows already filed are skipped.
export function OneOffImport({
  unitId,
  period,
  people,
  components,
  onFiled,
}: {
  unitId: string
  period: string
  people: readonly { employee_id: string; employee_code: string }[]
  components: readonly { code: string }[]
  onFiled: () => void
}) {
  const [sheet, setSheet] = useState<ImportSheet | null>(null)
  const [outcomes, setOutcomes] = useState<ReadonlyMap<number, Outcome>>(
    new Map()
  )
  const byCode = new Map(
    people.map((one) => [one.employee_code, one.employee_id])
  )
  const known = new Set(components.map((one) => one.code))

  const checked = (row: ImportRow): string | null => {
    if (!byCode.has(row.employeeCode))
      return `${row.employeeCode} is not working at this unit`
    if (!known.has(row.componentCode))
      return `${row.componentCode} is not a one-off component`
    return null
  }

  const file = useMutation({
    mutationFn: async (rows: readonly ImportRow[]) => {
      const next = new Map(outcomes)
      for (const row of rows) {
        const employeeId = byCode.get(row.employeeCode)
        if (employeeId === undefined || next.get(row.line)?.ok === true)
          continue
        try {
          await fileAdjustment({
            unitId,
            period,
            employeeId,
            componentCode: row.componentCode,
            amountMinor: row.amountMinor,
            reason: row.reason,
          })
          next.set(row.line, { ok: true })
        } catch (error) {
          next.set(row.line, {
            ok: false,
            why: error instanceof Error ? error.message : "not filed",
          })
        }
        setOutcomes(new Map(next))
      }
      return next
    },
    onSettled: onFiled,
  })

  const rows = sheet?.rows ?? []
  const ready = rows.filter((row) => checked(row) === null)
  const filed = [...outcomes.values()].filter((one) => one.ok).length

  return (
    <div>
      <SubHead aside="CSV: employee_code, component_code, amount, reason">
        Import from a sheet
      </SubHead>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="File">
          <input
            type="file"
            accept=".csv,text/csv"
            className="text-[0.875rem] text-body file:mr-3 file:rounded-inner file:border file:border-hairline-2 file:bg-canvas file:px-3 file:py-1.5 file:text-ink"
            onChange={(event) => {
              const chosen = event.target.files?.[0]
              setOutcomes(new Map())
              if (chosen === undefined) {
                setSheet(null)
                return
              }
              void chosen
                .text()
                .then((text) =>
                  setSheet(readOneOffSheet(text, `import ${period}`))
                )
            }}
          />
        </Field>
        <Button
          variant="quiet"
          onClick={() =>
            downloadCsv(
              csvName("one-offs template"),
              "employee_code,component_code,amount,reason\r\nK0001,INSENTIF,500000,insentif penjualan\r\n"
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
                "Component",
                { label: "Amount", align: "right" },
                "",
              ]}
            >
              {rows.map((row) => {
                const problem = checked(row)
                const outcome = outcomes.get(row.line)
                return (
                  <MiniRow key={row.line}>
                    <MiniCell>{row.line}</MiniCell>
                    <MiniCell>{row.employeeCode}</MiniCell>
                    <MiniCell>{row.componentCode}</MiniCell>
                    <MiniCell align="right">{money(row.amountMinor)}</MiniCell>
                    <MiniCell>
                      {outcome?.ok === true ? (
                        <Pill tone="ok">Filed</Pill>
                      ) : outcome?.ok === false ? (
                        <Pill tone="bad">{outcome.why}</Pill>
                      ) : problem !== null ? (
                        <Pill tone="warn">{problem}</Pill>
                      ) : (
                        <Pill tone="info">Ready</Pill>
                      )}
                    </MiniCell>
                  </MiniRow>
                )
              })}
            </MiniTable>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              pending={file.isPending}
              disabled={ready.length === 0 || unitId === ""}
              onClick={() => file.mutate(ready)}
            >
              File {ready.length} one-off{ready.length === 1 ? "" : "s"}
            </Button>
            {outcomes.size > 0 && (
              <span className="text-[0.875rem] text-mute">
                {filed} filed, {outcomes.size - filed} refused
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
