import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Day } from "@/components/ui/day"
import { Checkbox, Field, Input } from "@/components/ui/field"
import { PickOne } from "@/components/ui/pick"
import {
  KeyValue,
  MiniCell,
  MiniRow,
  MiniTable,
  SubHead,
} from "@/components/ui/rows"
import { Banner } from "@/components/ui/states"
import { day } from "@/lib/format"
import {
  absenceRules,
  attendanceSettingKeys,
  payKeys,
  stateAbsenceRule,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"

const BASES = [
  { value: "BASE", label: "Base salary" },
  { value: "WAGE", label: "Base and fixed allowances" },
]

/// Potongan absen: what a day absent costs. An absence is a rostered working
/// day gone by with no punch, no approved leave and no approved correction;
/// once the rule is on, each one comes off pay as the base (or the wage) over
/// the month's days, or over a fixed divisor such as 25 working days.
export function AbsenceRuleCard() {
  const client = useQueryClient()
  const rules = useQuery({
    queryKey: attendanceSettingKeys.absenceRules(),
    queryFn: ({ signal }) => absenceRules(signal),
  })
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
      setReason("")
      void client.invalidateQueries({
        queryKey: attendanceSettingKeys.absenceRules(),
      })
      void client.invalidateQueries({ queryKey: payKeys.runs() })
    },
  })
  const describe = (rule: {
    enabled: boolean
    basis: string
    divisor_days: number | null
  }) =>
    !rule.enabled
      ? "No deduction"
      : `${rule.basis === "WAGE" ? "Wage" : "Base"} ÷ ${rule.divisor_days === null ? "the month's days" : `${rule.divisor_days} days`} per day absent`

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Absence deduction</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-4 px-4 pb-4">
        {queryState(rules, {
          loading: "Reading the rule…",
          render: (rows) => {
            const current = rows[0]
            return current === undefined ? null : (
              <div>
                <SubHead aside={`from ${day(current.effective_from)}`}>
                  In force
                </SubHead>
                <KeyValue term="Rule">{describe(current)}</KeyValue>
                {rows.length > 1 && (
                  <div className="mt-3">
                    <MiniTable head={["From", "Rule", "By"]}>
                      {rows.map((row) => (
                        <MiniRow key={row.effective_from}>
                          <MiniCell>{day(row.effective_from)}</MiniCell>
                          <MiniCell>{describe(row)}</MiniCell>
                          <MiniCell>{row.ratified_by}</MiniCell>
                        </MiniRow>
                      ))}
                    </MiniTable>
                  </div>
                )}
              </div>
            )
          },
        })}
        <p className="text-[0.875rem] text-mute">
          An absence is a rostered working day gone by with no punch, no
          approved leave and no approved correction. Each payslip counts them
          either way; the rule decides whether they cost anything.
        </p>
        <SubHead>State the rule from a date</SubHead>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="From" required>
            <Day value={from} onChange={setFrom} />
          </Field>
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
              onChange={(e) => setDivisor(e.target.value.replace(/\D/g, ""))}
              placeholder="25"
            />
          </Field>
          <Field label="Why" required>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
        <Checkbox
          label="An absence costs pay"
          checked={enabled}
          onChange={setEnabled}
        />
        {save.error !== null && (
          <Banner tone="bad">{save.error.message}</Banner>
        )}
        <div>
          <Button
            variant="primary"
            pending={save.isPending}
            disabled={from === "" || reason.trim() === ""}
            onClick={() => save.mutate()}
          >
            Save rule
          </Button>
        </div>
      </div>
    </Card>
  )
}
