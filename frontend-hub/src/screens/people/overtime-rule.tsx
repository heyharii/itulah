import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, Input } from "@/components/ui/field"
import { PickOne } from "@/components/ui/pick"
import {
  KeyValue,
  MiniCell,
  MiniRow,
  MiniTable,
  SubHead,
} from "@/components/ui/rows"
import { Banner } from "@/components/ui/states"
import {
  attendanceSettingKeys,
  defineComponent,
  overtimeTier,
  payComponents,
  payKeys,
  ratifyComponentRate,
  setOvertimeTier,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { KEPMEN_102 } from "@/screens/people/overtime-presets"

const WEEKS = [
  { value: "420", label: "Six-day week — first 7 hours" },
  { value: "480", label: "Five-day week — first 8 hours" },
  { value: "300", label: "The short day — first 5 hours" },
]

/// Aturan lembur, as Kepmenaker 102/2004 lays it out: an hourly wage of
/// 1/173 of the month's wage; a workday's first hour at 1.5× and later hours
/// at 2×; a rest day or holiday at 2× for the first tier, 3× for the hour
/// after, 4× beyond. The multipliers are pay components head office ratifies;
/// the tier is the length of the working week.
export function OvertimeRuleCard() {
  const client = useQueryClient()
  const tier = useQuery({
    queryKey: attendanceSettingKeys.overtimeTier(),
    queryFn: ({ signal }) => overtimeTier(signal),
  })
  const catalogue = useQuery({
    queryKey: payKeys.components(),
    queryFn: ({ signal }) => payComponents(signal),
  })
  const [week, setWeek] = useState<string | null>(null)
  const [reason, setReason] = useState("")
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`)
  const [applied, setApplied] = useState<string | null>(null)

  const saveTier = useMutation({
    mutationFn: () =>
      setOvertimeTier({
        rest_day_first_tier_minutes: Number(week ?? "420"),
        reason: reason.trim(),
      }),
    onSuccess: () => {
      setReason("")
      void client.invalidateQueries({
        queryKey: attendanceSettingKeys.overtimeTier(),
      })
    },
  })

  const have = new Set((catalogue.data ?? []).map((one) => one.code))
  const missing = KEPMEN_102.filter((one) => !have.has(one.code))

  // Each component is defined then ratified, one after the other, through the
  // same routes as the components card — nothing here the server does not
  // check. One that already exists is left alone.
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
    onSuccess: (count) => {
      setApplied(`${count} overtime components defined and ratified.`)
      void client.invalidateQueries({ queryKey: payKeys.components() })
    },
  })

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Overtime rules</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-4 px-4 pb-4">
        {queryState(tier, {
          loading: "Reading the rule…",
          render: (current) => (
            <KeyValue term="Rest day and holiday, first tier">
              {current.rest_day_first_tier_minutes / 60} hours at 2×, then one
              hour at 3×, then 4×
            </KeyValue>
          ),
        })}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
        {saveTier.error !== null && (
          <Banner tone="bad">{saveTier.error.message}</Banner>
        )}
        <div>
          <Button
            variant="ghost"
            pending={saveTier.isPending}
            disabled={week === null || reason.trim() === ""}
            onClick={() => saveTier.mutate()}
          >
            Save working week
          </Button>
        </div>

        <SubHead>Kepmenaker 102/2004 overtime pay</SubHead>
        <MiniTable
          head={[
            "Component",
            "Counts",
            { label: "× hourly", align: "right" },
            "",
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
        <p className="text-[0.875rem] text-mute">
          The hourly wage is 1/173 of base plus fixed allowances. The two
          rest-day tiers past the first carry the extra over the 2× every
          rest-day hour already earns.
        </p>
        {missing.length > 0 && (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Rates from">
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </Field>
            <Button
              variant="primary"
              pending={apply.isPending}
              onClick={() => apply.mutate()}
            >
              Define the {missing.length} missing
            </Button>
          </div>
        )}
        {apply.error !== null && (
          <Banner tone="bad">{apply.error.message}</Banner>
        )}
        {applied !== null && <Banner tone="ok">{applied}</Banner>}
      </div>
    </Card>
  )
}
