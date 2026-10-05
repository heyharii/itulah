import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Day } from "@/components/ui/day"
import { Checkbox, Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { PickOne } from "@/components/ui/pick"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { EmptyState, Problem } from "@/components/ui/states"
import { day } from "@/lib/format"
import {
  absenceRules,
  attendanceSettingKeys,
  payKeys,
  stateAbsenceRule,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useCanWrite } from "@/lib/session"
import { ListCard, SheetFooter } from "@/screens/people/settings-kit"
import { useOpener } from "@/screens/people/settings-lib"

const BASES = [
  { value: "BASE", label: "Base salary" },
  { value: "WAGE", label: "Base and fixed allowances" },
]

function describe(rule: {
  enabled: boolean
  basis: string
  divisor_days: number | null
}): string {
  return !rule.enabled
    ? "No deduction"
    : `${rule.basis === "WAGE" ? "Wage" : "Base"} ÷ ${rule.divisor_days === null ? "the month's days" : `${rule.divisor_days} days`} per day absent`
}

/// Settings › Absence deduction (potongan absen) — what a day absent costs.
///
/// An absence is a rostered working day gone by with no punch, no approved
/// leave and no approved correction. Each payslip counts them either way; the
/// rule decides whether they cost anything: the base (or the wage) over the
/// month's days, or over a fixed divisor such as 25 working days.
export function AbsenceSettings() {
  const canWrite = useCanWrite()
  const rules = useQuery({
    queryKey: attendanceSettingKeys.absenceRules(),
    queryFn: ({ signal }) => absenceRules(signal),
  })
  const sheet = useOpener()

  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="Absence deduction"
        sub="What a day absent costs on a payslip. Each payslip counts absences either way; the rule decides whether they cost anything."
        actions={
          canWrite && (
            <Button variant="primary" onClick={() => sheet.show()}>
              New rule
            </Button>
          )
        }
      />

      <ListCard>
        {queryState(rules, {
          loading: "Reading the rule…",
          render: (rows) =>
            rows.length === 0 ? (
              <EmptyState>
                No rule has been stated, so an absence costs nothing. New rule
                states one from a date.
              </EmptyState>
            ) : (
              <MiniTable head={["From", "Rule", "By", "Why"]}>
                {rows.map((row, index) => (
                  <MiniRow key={row.effective_from}>
                    <MiniCell>
                      {day(row.effective_from)}
                      {index === 0 && (
                        <Pill tone="ok" className="ml-2">
                          In force
                        </Pill>
                      )}
                    </MiniCell>
                    <MiniCell>{describe(row)}</MiniCell>
                    <MiniCell>{row.ratified_by}</MiniCell>
                    <MiniCell>{row.reason}</MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
      </ListCard>

      <NewRuleSheet key={sheet.n} open={sheet.isOpen} onClose={sheet.hide} />
    </PageContent>
  )
}

function NewRuleSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const [from, setFrom] = useState("")
  const [enabled, setEnabled] = useState(true)
  const [basis, setBasis] = useState<string | null>("BASE")
  const [divisor, setDivisor] = useState("")
  const [reason, setReason] = useState("")
  const save = useMutation({
    mutationFn: () =>
      stateAbsenceRule({
        effective_from: from,
        enabled,
        basis: basis ?? "BASE",
        divisor_days: divisor.trim() === "" ? null : Number(divisor),
        reason: reason.trim(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: attendanceSettingKeys.absenceRules(),
      })
      void client.invalidateQueries({ queryKey: payKeys.runs() })
      onClose()
    },
  })
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="New absence rule"
      footer={
        <SheetFooter
          onCancel={onClose}
          onSave={() => save.mutate()}
          saveLabel="Submit"
          pending={save.isPending}
          disabled={from === "" || reason.trim() === ""}
        />
      }
    >
      <div className="flex flex-col gap-3.5">
        <Problem error={save.error} />
        <Field label="From" required>
          <Day value={from} onChange={setFrom} />
        </Field>
        <Checkbox
          label="An absence costs pay"
          checked={enabled}
          onChange={setEnabled}
        />
        <Field label="A day is a share of" required>
          <PickOne
            label="A day is a share of"
            choices={BASES}
            value={basis}
            onChange={setBasis}
            disabled={!enabled}
          />
        </Field>
        <Field label="Divided by" aside="days; empty for the month's days">
          <Input
            inputMode="numeric"
            value={divisor}
            disabled={!enabled}
            onChange={(event) =>
              setDivisor(event.target.value.replace(/\D/g, ""))
            }
          />
        </Field>
        <Field label="Why" required>
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </div>
    </Sheet>
  )
}
