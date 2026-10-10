import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { useLayout } from "@/lib/layout"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Day } from "@/components/ui/day"
import { Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { PickOne } from "@/components/ui/pick"
import { Pill } from "@/components/ui/pill"
import { KeyValue, MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { EmptyState, Problem } from "@/components/ui/states"
import { day } from "@/lib/format"
import {
  benefitKeys,
  benefitSettings,
  stateBenefitSetting,
} from "@/lib/queries/hr-benefit"
import { queryState } from "@/lib/query-state"
import { useCanWrite } from "@/lib/session"
import { ListCard, PageFoot, SheetFooter } from "@/screens/people/settings-kit"
import { digits, useOpener } from "@/screens/people/settings-lib"
import type { BenefitSettingView } from "@itulah/contract"

const STATES = [
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
]

/// Settings › Benefit — whether the employee benefit is on, and how long a
/// code from the employee's app stays good.
export function BenefitSettings() {
  const canWrite = useCanWrite()
  const phone = useLayout() === "phone"
  const settings = useQuery({
    queryKey: benefitKeys.settings(),
    queryFn: ({ signal }) => benefitSettings(signal),
  })
  const sheet = useOpener()

  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="Benefit"
        sub="Turn the employee benefit on or off, and set how long a code stays good."
        actions={
          !phone &&
          canWrite && (
            <Button variant="primary" onClick={() => sheet.show()}>
              Edit
            </Button>
          )
        }
      />

      {queryState(settings, {
        loading: "Reading the setting…",
        render: (rows) => (
          <>
            <Card className="mb-4 px-4 py-3">
              <KeyValue term="Benefit">
                {rows.length > 0 && rows[0].enabled ? "On" : "Off"}
              </KeyValue>
              {rows.length > 0 && (
                <KeyValue term="A code stays good for">
                  {rows[0].code_minutes} minutes
                </KeyValue>
              )}
              <KeyValue term="Promotions">
                Does not combine with promotions
              </KeyValue>
              <KeyValue term="Booking">
                Spent part is booked by Finance as a sales discount
              </KeyValue>
              {rows.length > 0 && (
                <>
                  <KeyValue term="Since">
                    {day(rows[0].effective_from)}
                  </KeyValue>
                  <KeyValue term="Set by">{rows[0].set_by}</KeyValue>
                </>
              )}
            </Card>
            <ListCard title="History">
              {rows.length === 0 ? (
                <EmptyState>
                  Nothing has been set, so the benefit is off. Edit turns it on
                  from a date.
                </EmptyState>
              ) : (
                <MiniTable head={["From", "State", "Code", "By", "Why"]}>
                  {rows.map((row, index) => (
                    <MiniRow key={`${row.effective_from}-${index}`}>
                      <MiniCell>
                        {day(row.effective_from)}
                        {index === 0 && (
                          <Pill tone="ok" className="ml-2">
                            In force
                          </Pill>
                        )}
                      </MiniCell>
                      <MiniCell>{row.enabled ? "On" : "Off"}</MiniCell>
                      <MiniCell>{row.code_minutes} min</MiniCell>
                      <MiniCell>{row.set_by}</MiniCell>
                      <MiniCell>{row.reason}</MiniCell>
                    </MiniRow>
                  ))}
                </MiniTable>
              )}
            </ListCard>
            <EditSheet
              key={sheet.n}
              open={sheet.isOpen}
              onClose={sheet.hide}
              current={rows[0] ?? null}
            />
          </>
        ),
      })}
      {canWrite && <PageFoot label="Edit" onClick={() => sheet.show()} />}
    </PageContent>
  )
}

function EditSheet({
  open,
  onClose,
  current,
}: {
  open: boolean
  onClose: () => void
  current: BenefitSettingView | null
}) {
  const client = useQueryClient()
  const [from, setFrom] = useState("")
  const [state, setState] = useState<string | null>(
    current?.enabled === false ? "off" : "on"
  )
  const [minutes, setMinutes] = useState(String(current?.code_minutes ?? 5))
  const [reason, setReason] = useState("")
  const mins = digits(minutes)
  const save = useMutation({
    mutationFn: () =>
      stateBenefitSetting({
        effective_from: from,
        enabled: state !== "off",
        code_minutes: mins ?? 5,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: benefitKeys.settings() })
      onClose()
    },
  })
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Edit benefit setting"
      footer={
        <SheetFooter
          onCancel={onClose}
          onSave={() => save.mutate()}
          saveLabel="Submit"
          pending={save.isPending}
          disabled={
            from === "" ||
            reason.trim() === "" ||
            mins === null ||
            mins < 1 ||
            mins > 60
          }
        />
      }
    >
      <div className="flex flex-col gap-3.5">
        <Problem error={save.error} />
        <Field label="From" required>
          <Day value={from} onChange={setFrom} />
        </Field>
        <Field label="Benefit" required>
          <PickOne
            label="Benefit"
            choices={STATES}
            value={state}
            onChange={setState}
            required
          />
        </Field>
        <Field label="A code stays good for" aside="minutes, 1 to 60" required>
          <Input
            inputMode="numeric"
            value={minutes}
            onChange={(event) =>
              setMinutes(event.target.value.replace(/\D/g, ""))
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
