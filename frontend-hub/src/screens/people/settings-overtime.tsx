import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { PickOne } from "@/components/ui/pick"
import { KeyValue, MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { Banner, Problem } from "@/components/ui/states"
import {
  attendanceSettingKeys,
  defineComponent,
  overtimeKeys,
  overtimeTier,
  payComponents,
  payKeys,
  ratifyComponentRate,
  readMinutesSpan,
  readOvertimePolicy,
  setOvertimeTier,
} from "@/lib/queries/people"
import { setOvertimeCaps } from "@/lib/queries/hr-time-settings"
import { queryState } from "@/lib/query-state"
import { useCanWrite } from "@/lib/session"
import { KEPMEN_102 } from "@/screens/people/overtime-presets"
import { ListCard, SheetFooter } from "@/screens/people/settings-kit"
import { useOpener } from "@/screens/people/settings-lib"
import type { OvertimePolicyView } from "@itulah/contract"

const WEEKS = [
  { value: "420", label: "Six-day week — first 7 hours" },
  { value: "480", label: "Five-day week — first 8 hours" },
  { value: "300", label: "The short day — first 5 hours" },
]

/// Settings › Overtime — the caps on what may be ordered, the length of the
/// working week that sets the rest-day tiers, and the Kepmenaker 102/2004 pay
/// components overtime is paid by (an hourly wage of 1/173 of the month's wage;
/// a workday's first hour at 1.5× and later hours at 2×; rest day and holiday
/// at 2×, 3× and 4× by tier).
export function OvertimeSettings() {
  const canWrite = useCanWrite()
  const policy = useQuery({
    queryKey: overtimeKeys.policy(),
    queryFn: ({ signal }) => readOvertimePolicy(signal),
  })
  const tier = useQuery({
    queryKey: attendanceSettingKeys.overtimeTier(),
    queryFn: ({ signal }) => overtimeTier(signal),
  })
  const catalogue = useQuery({
    queryKey: payKeys.components(),
    queryFn: ({ signal }) => payComponents(signal),
  })

  const have = new Set((catalogue.data ?? []).map((one) => one.code))
  const missing = KEPMEN_102.filter((one) => !have.has(one.code))

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
          {queryState(policy, {
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
          {queryState(tier, {
            loading: "Reading the rule…",
            render: (current) => (
              <KeyValue term="Rest day and holiday, first tier">
                {current.rest_day_first_tier_minutes / 60} hours at 2×, then one
                hour at 3×, then 4×
              </KeyValue>
            ),
          })}
        </div>
      </Card>

      <ListCard title="Kepmenaker 102/2004 overtime pay">
        <MiniTable
          head={[
            "Component",
            "Counts",
            { label: "× hourly", align: "right" },
            "State",
          ]}
        >
          {KEPMEN_102.map((one) => (
            <MiniRow key={one.code}>
              <MiniCell>{one.label}</MiniCell>
              <MiniCell>{one.rule}</MiniCell>
              <MiniCell align="right">{one.multiplierBp / 10_000}×</MiniCell>
              <MiniCell>
                {have.has(one.code) ? (
                  <span className="text-mute">in the catalogue</span>
                ) : (
                  <span className="text-warn-fg">not defined</span>
                )}
              </MiniCell>
            </MiniRow>
          ))}
        </MiniTable>
        <p className="mt-2 text-[0.875rem] text-mute">
          The hourly wage is 1/173 of base plus fixed allowances. The two
          rest-day tiers past the first carry the extra over the 2× every
          rest-day hour already earns.
        </p>
      </ListCard>

      <CapsSheet
        key={`caps-${caps.n}`}
        open={caps.isOpen}
        onClose={caps.hide}
        current={policy.data ?? null}
      />
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
        <p className="text-[0.875rem] text-body">
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
            placeholder="PP 35/2021 pasal 26 ayat 1"
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
            placeholder="Choose…"
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
        <p className="text-[0.875rem] text-body">
          Defines and ratifies the Kepmenaker 102/2004 components the catalogue
          does not have yet:
        </p>
        <ul className="list-disc pl-5 text-[0.875rem] text-ink">
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
