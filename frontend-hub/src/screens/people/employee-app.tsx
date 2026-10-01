import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Day } from "@/components/ui/day"
import { Checkbox, Field, Input } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { Banner, EmptyState } from "@/components/ui/states"
import { day } from "@/lib/format"
import {
  delegate,
  delegationKeys,
  delegations,
  essModules,
  revokeDelegation,
  setEssModules,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import type { EssModulesView } from "@itulah/contract"

const MODULES = [
  { value: "ATTENDANCE", label: "Attendance — clocking in and out" },
  { value: "CORRECTION", label: "Attendance corrections" },
  { value: "SWAP", label: "Roster swaps" },
  { value: "LEAVE", label: "Leave" },
  { value: "OVERTIME", label: "Overtime" },
  { value: "PAY", label: "Pay and payslips" },
  { value: "CLAIMS", label: "Expense claims" },
]

/// Modul ESS: which parts of the employee app the company uses. A module
/// turned off is not offered in the app.
export function EssModulesCard() {
  const current = useQuery({
    queryKey: delegationKeys.ess(),
    queryFn: ({ signal }) => essModules(signal),
  })
  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Employee app</CardTitle>
      </CardHeader>
      <div className="px-4 pb-4">
        {queryState(current, {
          loading: "Reading the modules…",
          render: (view) => <EssForm current={view} />,
        })}
      </div>
    </Card>
  )
}

function EssForm({ current }: { current: EssModulesView }) {
  const client = useQueryClient()
  const [on, setOn] = useState<readonly string[]>(current.modules)
  const [reason, setReason] = useState("")
  const save = useMutation({
    mutationFn: () =>
      setEssModules({ modules: [...on], reason: reason.trim() }),
    onSuccess: () => {
      setReason("")
      void client.invalidateQueries({ queryKey: delegationKeys.ess() })
    },
  })
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[0.875rem] text-mute">
        What employees see in their app. Turning a module off hides it there;
        head office and managers keep their own screens.
      </p>
      {MODULES.map((one) => (
        <Checkbox
          key={one.value}
          label={one.label}
          checked={on.includes(one.value)}
          onChange={(checked) =>
            setOn(
              checked
                ? [...on, one.value]
                : on.filter((value) => value !== one.value)
            )
          }
        />
      ))}
      <Field label="Why" required>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {save.error !== null && <Banner tone="bad">{save.error.message}</Banner>}
      <div>
        <Button
          variant="primary"
          pending={save.isPending}
          disabled={reason.trim() === ""}
          onClick={() => save.mutate()}
        >
          Save
        </Button>
      </div>
    </div>
  )
}

/// Delegasi approval: hand one's decisions — leave, claims, attendance
/// corrections — to a colleague for a span, at one's own rung and nothing
/// else of one's own.
export function DelegationsCard({ administrator }: { administrator: boolean }) {
  const client = useQueryClient()
  const rows = useQuery({
    queryKey: delegationKeys.all(),
    queryFn: ({ signal }) => delegations(signal),
  })
  const [delegator, setDelegator] = useState("")
  const [stand, setStand] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [reason, setReason] = useState("")
  const refresh = () =>
    client.invalidateQueries({ queryKey: delegationKeys.all() })
  const give = useMutation({
    mutationFn: () =>
      delegate({
        delegator: delegator.trim() === "" ? null : delegator.trim(),
        delegate: stand.trim(),
        from_date: from,
        to_date: to,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      setStand("")
      setReason("")
      void refresh()
    },
  })
  const revoke = useMutation({
    mutationFn: (id: string) => revokeDelegation(id),
    onSuccess: () => void refresh(),
  })

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Approvals handed over</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-4 px-4 pb-4">
        {queryState(rows, {
          loading: "Reading the hand-overs…",
          render: (list) =>
            list.length === 0 ? (
              <EmptyState>
                Nothing handed over. Away for a while? Name who decides your
                leave, claims and corrections until you are back.
              </EmptyState>
            ) : (
              <MiniTable head={["From", "To", "When", ""]}>
                {list.map((row) => (
                  <MiniRow key={row.id}>
                    <MiniCell>{row.delegator_name}</MiniCell>
                    <MiniCell>{row.delegate_name}</MiniCell>
                    <MiniCell>
                      {day(row.from_date)} – {day(row.to_date)}
                      <span className="block text-[0.875rem] text-mute">
                        {row.reason}
                      </span>
                    </MiniCell>
                    <MiniCell>
                      {row.revoked ? (
                        <Pill tone="neutral">Revoked</Pill>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          {row.active && <Pill tone="info">Running</Pill>}
                          <Button
                            variant="quiet"
                            pending={revoke.isPending}
                            onClick={() => revoke.mutate(row.id)}
                          >
                            Revoke
                          </Button>
                        </span>
                      )}
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
        <SubHead>Hand over</SubHead>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {administrator && (
            <Field label="Whose approvals" aside="empty: yours">
              <Input
                value={delegator}
                onChange={(e) => setDelegator(e.target.value)}
                placeholder="username"
              />
            </Field>
          )}
          <Field label="To" required>
            <Input
              value={stand}
              onChange={(e) => setStand(e.target.value)}
              placeholder="their username"
            />
          </Field>
          <Field label="From" required>
            <Day value={from} onChange={setFrom} />
          </Field>
          <Field label="Until" required>
            <Day value={to} onChange={setTo} />
          </Field>
          <Field label="Why" required>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="cuti tahunan"
            />
          </Field>
        </div>
        {(give.error ?? revoke.error) !== null && (
          <Banner tone="bad">{(give.error ?? revoke.error)?.message}</Banner>
        )}
        <div>
          <Button
            variant="primary"
            pending={give.isPending}
            disabled={
              stand.trim() === "" ||
              from === "" ||
              to === "" ||
              reason.trim() === ""
            }
            onClick={() => give.mutate()}
          >
            Hand over
          </Button>
        </div>
      </div>
    </Card>
  )
}
