import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Suspense, useMemo, useState } from "react"

import type { AbsenceRuleView } from "@itulah/contract"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Day } from "@/components/ui/day"
import { Fab } from "@/components/ui/fab"
import { Checkbox, Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { PickOne } from "@/components/ui/pick"
import { Pill } from "@/components/ui/pill"
import { Sheet } from "@/components/ui/sheet"
import { EmptyState, LoadingState, Problem } from "@/components/ui/states"
import { day } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  absenceRulesQuery,
  attendanceSettingKeys,
  payKeys,
  stateAbsenceRule,
} from "@/lib/queries/people"
import { useCanWrite } from "@/lib/session"
import { CardName } from "@/components/ui/phone-cards"
import { tableSetup, type TableSetup } from "@/lib/table"
import { SheetFooter } from "@/screens/people/settings-kit"
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

const columns: ColumnDef<TableSetup, AbsenceRuleView>[] = [
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
    id: "rule",
    accessorFn: (row) => describe(row),
    header: "Rule",
    size: 320,
    meta: { card: "hide" },
  },
  {
    accessorKey: "ratified_by",
    header: "By",
    size: 160,
    meta: { card: "hide" },
  },
  {
    accessorKey: "reason",
    header: "Why",
    size: 300,
    meta: { card: "hide" },
    cell: ({ row }) => (
      <span className="block whitespace-normal">{row.original.reason}</span>
    ),
  },
  // One column that exists only on a card (`cardLead`; a phone): the date it
  // starts, the rule under it, and who stated it and why.
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
          describe(row.original),
          `By ${row.original.ratified_by} · ${row.original.reason}`,
        ]}
      />
    ),
  },
]

/// Settings › Absence deduction (potongan absen) — what a day absent costs.
///
/// An absence is a rostered working day gone by with no punch, no approved
/// leave and no approved correction. Each payslip counts them either way; the
/// rule decides whether they cost anything: the base (or the wage) over the
/// month's days, or over a fixed divisor such as 25 working days.
export function AbsenceSettings() {
  const canWrite = useCanWrite()
  const sheet = useOpener()
  const phone = useLayout() === "phone"

  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="Absence Deduction"
        sub="What a day absent costs on a payslip. Each payslip counts absences either way; the rule decides whether they cost anything."
        actions={
          !phone &&
          canWrite && (
            <Button variant="primary" onClick={() => sheet.show()}>
              New rule
            </Button>
          )
        }
      />
      {canWrite && <Fab label="New rule" onClick={() => sheet.show()} />}

      <Card className="mb-4 overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        <Suspense fallback={<LoadingState>Reading the rule…</LoadingState>}>
          <AbsenceRules />
        </Suspense>
      </Card>

      <NewRuleSheet key={sheet.n} open={sheet.isOpen} onClose={sheet.hide} />
    </PageContent>
  )
}

/// The versions of the rule, as a table. Here and not in the screen so the
/// head paints at once and this waits alone for its answer.
function AbsenceRules() {
  const rules = useSuspenseQuery(absenceRulesQuery())
  const phone = useLayout() === "phone"
  const versions = rules.data
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: versions,
        columns,
        getRowId: (row: AbsenceRuleView) => row.effective_from,
        // The card's own column is drawn on a phone and never on a desk.
        state: { columnVisibility: { head: phone } },
      }),
      [versions, phone]
    )
  )
  return versions.length === 0 ? (
    <EmptyState>
      No rule has been stated, so an absence costs nothing. New rule states one
      from a date.
    </EmptyState>
  ) : (
    <DataTable<AbsenceRuleView>
      refresh={[rules]}
      table={table}
      cardsApart
      cardLead
      cardSort={false}
    />
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
