import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState, Suspense } from "react"

import type { PayrollScheduleView } from "@itulah/contract"

import { PageContent } from "@/components/shell/app-shell"
import { useLayout } from "@/lib/layout"
import { Fab } from "@/components/ui/fab"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Day } from "@/components/ui/day"
import { Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Sheet } from "@/components/ui/sheet"
import { EmptyState, Problem, LoadingState } from "@/components/ui/states"
import { day } from "@/lib/format"
import {
  payKeys,
  statePayrollSchedule,
  payrollSchedulesQuery,
} from "@/lib/queries/people"
import { useCanWrite } from "@/lib/session"
import { CardName } from "@/components/ui/phone-cards"
import { tableSetup, type TableSetup } from "@/lib/table"
import { SheetFooter } from "@/screens/people/settings-kit"
import { digits, useOpener } from "@/screens/people/settings-lib"

const PRORATE_LABEL: Record<string, string> = {
  CALENDAR: "calendar days",
  WORKDAYS_6: "working days, Monday to Saturday",
  WORKDAYS_5: "working days, Monday to Friday",
}

const monthOf = (row: PayrollScheduleView) =>
  row.cutoff_day === null
    ? "the calendar month"
    : `the ${row.cutoff_day + 1}th of last month to the ${row.cutoff_day}th`

const payDayOf = (row: PayrollScheduleView) =>
  row.pay_day === null ? "the last day of the month" : `the ${row.pay_day}th`

const proratedBy = (row: PayrollScheduleView) =>
  PRORATE_LABEL[row.prorate_basis] ?? row.prorate_basis

const columns: ColumnDef<TableSetup, PayrollScheduleView>[] = [
  {
    id: "from",
    accessorFn: (row) => row.effective_from,
    header: "From",
    size: 220,
    meta: { card: "hide" },
    cell: ({ row }) => (
      <>
        {day(row.original.effective_from)}
        {row.index === 0 && (
          <Pill tone="ok" className="ml-2">
            In force
          </Pill>
        )}
      </>
    ),
  },
  {
    id: "month",
    accessorFn: (row) => monthOf(row),
    header: "Attendance Month",
    size: 320,
    meta: { card: "hide" },
  },
  {
    id: "pay",
    accessorFn: (row) => payDayOf(row),
    header: "Pay Day",
    size: 220,
    meta: { card: "hide" },
  },
  {
    id: "prorate",
    accessorFn: (row) => proratedBy(row),
    header: "Prorated by",
    size: 260,
    meta: { card: "hide" },
  },
  {
    accessorKey: "ratified_by",
    header: "By",
    size: 140,
    meta: { card: "hide" },
  },
  {
    accessorKey: "reason",
    header: "Why",
    size: 260,
    meta: { card: "hide" },
    cell: ({ row }) => (
      <span className="block whitespace-normal">{row.original.reason}</span>
    ),
  },
  // One column that exists only on a card (`cardLead`; a phone): the date it
  // starts, what it says, and who stated it and why.
  {
    id: "head",
    accessorFn: (row) => row.effective_from,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "title" },
    cell: ({ row }) => (
      <CardName
        name={
          <>
            {day(row.original.effective_from)}
            {row.index === 0 && (
              <Pill tone="ok" className="ml-2 align-middle">
                In force
              </Pill>
            )}
          </>
        }
        line={[
          `Attendance month: ${monthOf(row.original)}`,
          `Pay day: ${payDayOf(row.original)}`,
          `Prorated by ${proratedBy(row.original)}`,
          `By ${row.original.ratified_by} · ${row.original.reason}`,
        ]}
      />
    ),
  },
]

/// Settings › Payroll schedule — when the attendance month closes and pay goes
/// out. Leave, overtime and rostered days are counted over the attendance
/// month; salary is prorated over the calendar month. A schedule is stated
/// from a date, so a month already paid keeps the schedule it was paid under.
export function PayrollScheduleSettings() {
  const canWrite = useCanWrite()
  const phone = useLayout() === "phone"
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

      <Card className="mb-4 overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        <Suspense fallback={<LoadingState>Reading the schedule…</LoadingState>}>
          <Schedules />
        </Suspense>
      </Card>

      <NewScheduleSheet
        key={sheet.n}
        open={sheet.isOpen}
        onClose={sheet.hide}
      />
    </PageContent>
  )
}

/// The versions of the schedule, as a table. Here and not in the screen so the
/// head paints at once and this waits alone for its answer.
function Schedules() {
  const schedules = useSuspenseQuery(payrollSchedulesQuery())
  const phone = useLayout() === "phone"
  const versions = schedules.data
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: versions,
        columns,
        getRowId: (row: PayrollScheduleView) => row.effective_from,
        // The card's own column is drawn on a phone and never on a desk.
        state: { columnVisibility: { head: phone } },
      }),
      [versions, phone]
    )
  )
  return versions.length === 0 ? (
    <EmptyState>
      No schedule has been stated. New schedule sets the cut-off day and the pay
      day.
    </EmptyState>
  ) : (
    <DataTable<PayrollScheduleView>
      refresh={[schedules]}
      table={table}
      cardsApart
      cardLead
      cardSort={false}
    />
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
        <p className="text-[0.9375rem] text-mute">
          A short month pays on its last day when the pay day does not exist in
          it.
        </p>
      </div>
    </Sheet>
  )
}
