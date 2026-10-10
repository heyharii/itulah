import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { useLayout } from "@/lib/layout"
import { Fab } from "@/components/ui/fab"
import { Button } from "@/components/ui/button"
import { Day } from "@/components/ui/day"
import { Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { EmptyState, Problem } from "@/components/ui/states"
import { day } from "@/lib/format"
import {
  payKeys,
  payrollSchedules,
  statePayrollSchedule,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useCanWrite } from "@/lib/session"
import { ListCard, SheetFooter } from "@/screens/people/settings-kit"
import { digits, useOpener } from "@/screens/people/settings-lib"

const PRORATE_LABEL: Record<string, string> = {
  CALENDAR: "calendar days",
  WORKDAYS_6: "working days, Monday to Saturday",
  WORKDAYS_5: "working days, Monday to Friday",
}

/// Settings › Payroll schedule — when the attendance month closes and pay goes
/// out. Leave, overtime and rostered days are counted over the attendance
/// month; salary is prorated over the calendar month. A schedule is stated
/// from a date, so a month already paid keeps the schedule it was paid under.
export function PayrollScheduleSettings() {
  const canWrite = useCanWrite()
  const phone = useLayout() === "phone"
  const schedules = useQuery({
    queryKey: payKeys.schedules(),
    queryFn: ({ signal }) => payrollSchedules(signal),
  })
  const sheet = useOpener()

  return (
    <PageContent>
      {canWrite && <Fab label="New schedule" onClick={() => sheet.show()} />}
      <PageHeader
        crumb="People"
        title="Payroll Schedule"
        sub="When the attendance month closes, when pay goes out, and how a part month is prorated."
        actions={
          !phone &&
          canWrite && (
            <Button variant="primary" onClick={() => sheet.show()}>
              New schedule
            </Button>
          )
        }
      />

      <ListCard>
        {queryState(schedules, {
          loading: "Reading the schedule…",
          render: (rows) =>
            rows.length === 0 ? (
              <EmptyState>
                No schedule has been stated. New schedule sets the cut-off day
                and the pay day.
              </EmptyState>
            ) : (
              <MiniTable
                head={[
                  "From",
                  "Attendance Month",
                  "Pay Day",
                  "Prorated by",
                  "By",
                  "Why",
                ]}
              >
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
                    <MiniCell>
                      {row.cutoff_day === null
                        ? "the calendar month"
                        : `the ${row.cutoff_day + 1}th of last month to the ${row.cutoff_day}th`}
                    </MiniCell>
                    <MiniCell>
                      {row.pay_day === null
                        ? "the last day of the month"
                        : `the ${row.pay_day}th`}
                    </MiniCell>
                    <MiniCell>
                      {PRORATE_LABEL[row.prorate_basis] ?? row.prorate_basis}
                    </MiniCell>
                    <MiniCell>{row.ratified_by}</MiniCell>
                    <MiniCell>{row.reason}</MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
      </ListCard>

      <NewScheduleSheet
        key={sheet.n}
        open={sheet.isOpen}
        onClose={sheet.hide}
      />
    </PageContent>
  )
}

function NewScheduleSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const [from, setFrom] = useState("")
  const [cutoff, setCutoff] = useState("")
  const [payDay, setPayDay] = useState("")
  const [prorate, setProrate] = useState("CALENDAR")
  const [reason, setReason] = useState("")

  const save = useMutation({
    mutationFn: () =>
      statePayrollSchedule({
        effective_from: from,
        cutoff_day: digits(cutoff),
        pay_day: digits(payDay),
        prorate_basis: prorate,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: payKeys.schedules() })
      void client.invalidateQueries({ queryKey: payKeys.runs() })
      onClose()
    },
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="New schedule"
      footer={
        <SheetFooter
          onCancel={onClose}
          onSave={() => save.mutate()}
          saveLabel="State this schedule"
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
        <Field label="Cut-off day" aside="1–28, empty for the calendar month">
          <Input
            inputMode="numeric"
            value={cutoff}
            onChange={(event) => setCutoff(event.target.value)}
          />
        </Field>
        <Field label="Pay day" aside="1–31, empty for the last day">
          <Input
            inputMode="numeric"
            value={payDay}
            onChange={(event) => setPayDay(event.target.value)}
          />
        </Field>
        <Field label="Prorate a part month by">
          <Select value={prorate} onChange={setProrate}>
            {Object.entries(PRORATE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Why" required>
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <p className="text-[0.875rem] text-mute">
          A short month pays on its last day when the pay day does not exist in
          it.
        </p>
      </div>
    </Sheet>
  )
}
