import {
  useMutation,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query"
import { ClipboardCheck, Fuel, Gauge } from "lucide-react"
import { useState } from "react"

import { ConfirmButton } from "@/components/ui/dialog"
import { Day } from "@/components/ui/day"
import { Field, Money } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import {
  MiniCell,
  MiniRow,
  MiniTable,
  SheetSection,
} from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { SheetEmpty, SheetQuery } from "@/components/ui/sheet-states"
import { today } from "@/lib/calendar"
import { EMPTY, count, day, quantity } from "@/lib/format"
import {
  gaRecordKeys,
  recordOdometer,
  removeOdometer,
  type GaOdometerReading,
} from "@/lib/queries/ga-records"
import { useNameOfLogin } from "@/lib/queries/hr-employees"
import { toast } from "@/lib/toast"
import { NameCell } from "@/screens/assets/asset-sections"
import {
  lastOdometer,
  left,
  odometerSourceWords,
  right,
} from "@/screens/assets/asset-words"

/// A vehicle's odometer (0975): the latest reading, every reading before it,
/// and a box to type today's.
///
/// A reading comes from three places — typed here, written with a fuel
/// receipt, read at a service — and the list says which. The server keeps the
/// readings running forward and says which reading a new one disagrees with;
/// a typed reading can be removed, one that came with a receipt goes with the
/// receipt.
export function OdometerSheet({
  asset,
  readings,
  open,
  onClose,
}: {
  asset: { asset_id: string; name: string; asset_number: string }
  readings: UseQueryResult<GaOdometerReading[]>
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const nameOf = useNameOfLogin()
  const [km, setKm] = useState("")
  const [readOn, setReadOn] = useState(today())
  const [problem, setProblem] = useState("")
  const latest = lastOdometer(readings.data ?? [])

  const refresh = () =>
    // The schedule's km tasks and the overview read the same readings.
    client.invalidateQueries({ queryKey: gaRecordKeys.all })
  const save = useMutation({
    mutationFn: () =>
      recordOdometer(asset.asset_id, {
        read_on: readOn,
        odometer_km: Number(km),
      }),
    onSuccess: () => {
      void refresh()
      toast.success("Reading recorded")
      setKm("")
    },
  })
  const remove = useMutation({
    mutationFn: (readingId: string) => removeOdometer(readingId),
    onSuccess: () => {
      void refresh()
      toast.success("Reading removed")
    },
  })

  const submit = () => {
    if (km === "") {
      setProblem("Enter what the odometer reads.")
      return
    }
    setProblem("")
    save.mutate()
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      size="rail"
      stack
      context="Assets"
      id={asset.asset_number}
      title="Odometer"
      caption={asset.name}
      dirty={km !== "" && !save.isSuccess}
      footer={
        <SheetFooter
          error={save.error ?? remove.error}
          onCancel={onClose}
          cancelLabel="Close"
          primary={{
            label: "Save reading",
            pendingLabel: "Saving…",
            pending: save.isPending,
            onClick: submit,
          }}
        />
      }
    >
      <KpiStrip className="mb-2!">
        <Kpi
          label="Latest"
          value={latest === null ? EMPTY : quantity(latest.km, "km")}
        />
        <Kpi label="Read on" value={latest === null ? EMPTY : day(latest.on)} />
        <Kpi label="Readings" value={count(readings.data?.length ?? 0)} />
      </KpiStrip>

      <SheetSection title="New reading">
        <div className="grid gap-6 sm:grid-cols-2">
          <Field label="Odometer" required problem={problem || undefined}>
            <Money
              suffix="km"
              value={km}
              onChange={(next) => {
                setKm(next)
                setProblem("")
              }}
            />
          </Field>
          <Field label="Read on" required>
            <Day
              value={readOn}
              onChange={setReadOn}
              notAfter={today()}
              clearable={false}
              required
              label="Read on"
            />
          </Field>
        </div>
      </SheetSection>

      <SheetSection title="Readings" aside={readings.data?.length}>
        <SheetQuery query={readings} what="readings">
          {(rows) =>
            rows.length === 0 ? (
              <SheetEmpty>No reading yet.</SheetEmpty>
            ) : (
              <MiniTable head={["Date", right("Reading"), left("")]}>
                {rows.map((row) => (
                  <MiniRow key={row.reading_id}>
                    <MiniCell>
                      <NameCell
                        icon={
                          row.source === "EXPENSE"
                            ? Fuel
                            : row.source === "SERVICE"
                              ? ClipboardCheck
                              : Gauge
                        }
                        name={day(row.read_on)}
                        quiet={`${odometerSourceWords(row.source)} · ${nameOf(row.recorded_by)}`}
                      />
                    </MiniCell>
                    <MiniCell align="right">
                      {quantity(row.odometer_km, "km")}
                    </MiniCell>
                    <MiniCell>
                      {row.source !== "EXPENSE" && (
                        <ConfirmButton
                          label="Remove"
                          title="Remove this reading?"
                          description={`${quantity(row.odometer_km, "km")} on ${day(row.read_on)} leaves the vehicle's history.`}
                          confirmLabel="Remove reading"
                          cancelLabel="Keep reading"
                          tone="danger"
                          variant="ghost"
                          size="sm"
                          onConfirm={() => remove.mutateAsync(row.reading_id)}
                        />
                      )}
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            )
          }
        </SheetQuery>
      </SheetSection>
    </Sheet>
  )
}
