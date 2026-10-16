import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState, Suspense } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { useLayout } from "@/lib/layout"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { PickOne } from "@/components/ui/pick"
import { KeyValue } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { Banner, Problem } from "@/components/ui/states"
import {
  attendanceSettingKeys,
  defineComponent,
  overtimeKeys,
  payComponents,
  payKeys,
  ratifyComponentRate,
  readMinutesSpan,
  setOvertimeTier,
  overtimePolicyQuery,
  overtimeTierQuery,
} from "@/lib/queries/people"
import { setOvertimeCaps } from "@/lib/queries/hr-time-settings"
import { useCanWrite } from "@/lib/session"
import { KEPMEN_102 } from "@/screens/people/overtime-presets"
import { CardFigure, CardName } from "@/components/ui/phone-cards"
import { tableSetup, type TableSetup } from "@/lib/table"
import { CardFoot, SheetFooter } from "@/screens/people/settings-kit"
import { useOpener } from "@/screens/people/settings-lib"
import type { OvertimePolicyView } from "@itulah/contract"
import { awaiting } from "@/screens/people/awaiting"

const WEEKS = [
  { value: "420", label: "Six-day week — first 7 hours" },
  { value: "480", label: "Five-day week — first 8 hours" },
  { value: "300", label: "The short day — first 5 hours" },
]

type Preset = (typeof KEPMEN_102)[number]

const PRESETS: Preset[] = [...KEPMEN_102]

function presetColumns(
  have: ReadonlySet<string>
): ColumnDef<TableSetup, Preset>[] {
  const state = (one: Preset) =>
    have.has(one.code) ? (
      <span className="text-mute">in the catalogue</span>
    ) : (
      <span className="text-warn-fg">not defined</span>
    )
  return [
    {
      accessorKey: "label",
      header: "Component",
      size: 360,
      meta: { card: "hide" },
    },
    {
      accessorKey: "rule",
      header: "Counts",
      size: 300,
      meta: { card: "hide" },
    },
    {
      accessorKey: "multiplierBp",
      header: "× Hourly",
      size: 140,
      meta: { align: "right", card: "hide" },
      cell: ({ row }) => `${row.original.multiplierBp / 10_000}×`,
    },
    {
      id: "state",
      accessorFn: (row) => have.has(row.code),
      header: "State",
      size: 180,
      meta: { card: "hide" },
      cell: ({ row }) => state(row.original),
    },
    // Three columns that exist only on a card (`cardLead`; a phone): the
    // component over what it counts, the multiplier as the figure, and
    // whether it is in the catalogue.
    {
      id: "head",
      accessorFn: (row) => row.label,
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "title" },
      cell: ({ row }) => (
        <CardName name={row.original.label} line={row.original.rule} />
      ),
    },
    {
      id: "lead",
      accessorFn: (row) => row.multiplierBp,
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "lead" },
      cell: ({ row }) => (
        <CardFigure
          value={`${row.original.multiplierBp / 10_000}×`}
          caption="hourly"
        />
      ),
    },
    {
      id: "foot",
      accessorFn: (row) => have.has(row.code),
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "foot" },
      cell: ({ row }) => state(row.original),
    },
  ]
}

/// Settings › Overtime — the caps on what may be ordered, the length of the
/// working week that sets the rest-day tiers, and the Kepmenaker 102/2004 pay
/// components overtime is paid by (an hourly wage of 1/173 of the month's wage;
/// a workday's first hour at 1.5× and later hours at 2×; rest day and holiday
/// at 2×, 3× and 4× by tier).
export function OvertimeSettings() {
  const canWrite = useCanWrite()
  const phone = useLayout() === "phone"
  const catalogue = useQuery({
    queryKey: payKeys.components(),
    queryFn: ({ signal }) => payComponents(signal),
  })

  const have = useMemo(
    () => new Set((catalogue.data ?? []).map((one) => one.code)),
    [catalogue.data]
  )
  const missing = KEPMEN_102.filter((one) => !have.has(one.code))
  const columns = useMemo(() => presetColumns(have), [have])
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: PRESETS,
        columns,
        getRowId: (row: Preset) => row.code,
        // The card's own columns are drawn on a phone and never on a desk.
        state: { columnVisibility: { head: phone, lead: phone, foot: phone } },
      }),
      [columns, phone]
    )
  )

  const caps = useOpener()
  const week = useOpener()
  const define = useOpener()

  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="Overtime"
        sub="The most overtime that may be ordered, the working week it is counted against, and how each hour is paid."
        actions={
          !phone &&
          canWrite && (
            <>
              {missing.length > 0 && catalogue.isSuccess && (
                <Button onClick={() => define.show()}>
                  Define {missing.length} missing
                </Button>
              )}
              <Button onClick={() => week.show()}>Working week</Button>
              <Button variant="primary" onClick={() => caps.show()}>
                Set caps
              </Button>
            </>
          )
        }
      />

      <Card className="mb-4 overflow-hidden">
        <CardHeader>
          <CardTitle>Rules in force</CardTitle>
        </CardHeader>
        <div className="px-4 pb-3">
          {awaiting(overtimePolicyQuery(), {
            loading: "Reading the caps…",
            render: (current) =>
              current === null ? (
                <Banner tone="warn">
                  No overtime caps have been ratified, so no overtime can be
                  ordered. Set caps states them.
                </Banner>
              ) : (
                <>
                  <KeyValue term="Most in a day">
                    {readMinutesSpan(current.max_per_day_minutes)}
                  </KeyValue>
                  <KeyValue term="Most in a week">
                    {readMinutesSpan(current.max_per_week_minutes)}
                  </KeyValue>
                </>
              ),
          })}
          {awaiting(overtimeTierQuery(), {
            loading: "Reading the rule…",
            render: (current) => (
              <KeyValue term="Rest day and holiday, first tier">
                {current.rest_day_first_tier_minutes / 60} hours at 2×, then one
                hour at 3×, then 4×
              </KeyValue>
            ),
          })}
        </div>
        {canWrite && (
          <CardFoot label="Set caps" onClick={() => caps.show()}>
            <Button variant="tint" size="card" onClick={() => week.show()}>
              Working week
            </Button>
          </CardFoot>
        )}
      </Card>

      <Card className="mb-4 overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        <CardHeader>
          <CardTitle>Kepmenaker 102/2004 overtime pay</CardTitle>
        </CardHeader>
        <DataTable<Preset> table={table} cardsApart cardLead cardSort={false} />
        <p className="px-4 py-3 text-[0.9375rem] text-mute max-md:px-1">
          The hourly wage is 1/173 of base plus fixed allowances. The two
          rest-day tiers past the first carry the extra over the 2× every
          rest-day hour already earns.
        </p>
        {canWrite && missing.length > 0 && catalogue.isSuccess && (
          <CardFoot
            label={`Define ${missing.length} missing`}
            onClick={() => define.show()}
          />
        )}
      </Card>

      {/* The sheet starts from the caps in force, so it reads them itself. */}
      <Suspense fallback={null}>
        <CapsSheetFromPolicy
          key={`caps-${caps.n}`}
          open={caps.isOpen}
          onClose={caps.hide}
        />
      </Suspense>
      <WeekSheet
        key={`week-${week.n}`}
        open={week.isOpen}
        onClose={week.hide}
      />
      <DefineSheet
        key={`define-${define.n}`}
        open={define.isOpen}
        onClose={define.hide}
        missing={missing}
      />
    </PageContent>
  )
}

function CapsSheetFromPolicy({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const policy = useSuspenseQuery(overtimePolicyQuery())
  return <CapsSheet open={open} onClose={onClose} current={policy.data} />
}

function CapsSheet({
  open,
  onClose,
  current,
}: {
  open: boolean
  onClose: () => void
  current: OvertimePolicyView | null
}) {
  const client = useQueryClient()
  const [perDay, setPerDay] = useState(
    String((current?.max_per_day_minutes ?? 240) / 60)
  )
  const [perWeek, setPerWeek] = useState(
    String((current?.max_per_week_minutes ?? 1080) / 60)
  )
  const [reason, setReason] = useState("")
  const hours = (raw: string) => {
    const value = Number(raw.replace(",", "."))
    return raw.trim() !== "" && Number.isFinite(value) && value > 0
      ? Math.round(value * 60)
      : null
  }
  const day = hours(perDay)
  const week = hours(perWeek)

  const save = useMutation({
    mutationFn: () =>
      setOvertimeCaps(current, {
        max_per_day_minutes: day ?? 0,
        max_per_week_minutes: week ?? 0,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: overtimeKeys.policy() })
      onClose()
    },
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Overtime caps"
      footer={
        <SheetFooter
          onCancel={onClose}
          onSave={() => save.mutate()}
          pending={save.isPending}
          disabled={day === null || week === null || reason.trim() === ""}
        />
      }
    >
      <div className="flex flex-col gap-3.5">
        <Problem error={save.error} />
        <p className="text-[0.9375rem] text-body">
          PP 35/2021 art. 26(1) allows at most four hours a day and eighteen a
          week. These are yours to state — nothing in the system supplies them —
          and an order past either is refused.
        </p>
        <Field label="Most in a day" aside="hours" required>
          <Input
            inputMode="decimal"
            value={perDay}
            onChange={(event) => setPerDay(event.target.value)}
          />
        </Field>
        <Field label="Most in a week" aside="hours" required>
          <Input
            inputMode="decimal"
            value={perWeek}
            onChange={(event) => setPerWeek(event.target.value)}
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

function WeekSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = useQueryClient()
  const [week, setWeek] = useState<string | null>(null)
  const [reason, setReason] = useState("")
  const save = useMutation({
    mutationFn: () =>
      setOvertimeTier({
        rest_day_first_tier_minutes: Number(week ?? "420"),
        reason: reason.trim(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: attendanceSettingKeys.overtimeTier(),
      })
      onClose()
    },
  })
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Working week"
      footer={
        <SheetFooter
          onCancel={onClose}
          onSave={() => save.mutate()}
          pending={save.isPending}
          disabled={week === null || reason.trim() === ""}
        />
      }
    >
      <div className="flex flex-col gap-3.5">
        <Problem error={save.error} />
        <Field label="Working week" required>
          <PickOne
            label="Working week"
            choices={WEEKS}
            value={week}
            onChange={setWeek}
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

/// Each missing component is defined then ratified, one after the other,
/// through the same routes the components list uses — nothing here the server
/// does not check. One that already exists is left alone.
function DefineSheet({
  open,
  onClose,
  missing,
}: {
  open: boolean
  onClose: () => void
  missing: readonly (typeof KEPMEN_102)[number][]
}) {
  const client = useQueryClient()
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`)
  const apply = useMutation({
    mutationFn: async () => {
      for (const one of missing) {
        await defineComponent({
          code: one.code,
          label: one.label,
          kind: "EARNING",
          basis: "FRACTION_OF_BASE_PER_UNIT",
          base_ref: "STATUTORY_BASE",
          unit: one.unit,
          reason: "Kepmenaker 102/2004",
        })
        await ratifyComponentRate(one.code, {
          effective_from: from,
          hours_divisor: 173,
          multiplier_bp: one.multiplierBp,
          reason: `Kepmenaker 102/2004: ${one.rule}`,
        })
      }
      return missing.length
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: payKeys.components() })
      onClose()
    },
  })
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Define the missing overtime components"
      footer={
        <SheetFooter
          onCancel={onClose}
          onSave={() => apply.mutate()}
          saveLabel={`Define ${missing.length}`}
          pendingLabel="Defining…"
          pending={apply.isPending}
          disabled={from === "" || missing.length === 0}
        />
      }
    >
      <div className="flex flex-col gap-3.5">
        <Problem error={apply.error} />
        <p className="text-[0.9375rem] text-body">
          Defines and ratifies the Kepmenaker 102/2004 components the catalogue
          does not have yet:
        </p>
        <ul className="list-disc pl-5 text-[0.9375rem] text-ink">
          {missing.map((one) => (
            <li key={one.code}>
              {one.label} — {one.multiplierBp / 10_000}×
            </li>
          ))}
        </ul>
        <Field label="Rates from" required>
          <Input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </Field>
      </div>
    </Sheet>
  )
}
