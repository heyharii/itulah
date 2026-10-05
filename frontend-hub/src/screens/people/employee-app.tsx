import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Day } from "@/components/ui/day"
import { Checkbox, Field, Input } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { KeyValue, MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { EmptyState } from "@/components/ui/states"
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
import { useCanWrite } from "@/lib/session"
import { ESS_MODULES, useSheetTarget } from "@/screens/people/settings-hooks"
import { FormSheet } from "@/screens/people/settings-parts"
import type { DelegationView, EssModulesView } from "@itulah/contract"

/// Modul ESS: which parts of the employee app the company uses, read-only
/// rows. A module turned off is not offered in the app. The page that shows
/// this owns the "Edit" button and hands its sheet target down.
export function EssModulesList({
  edit,
}: {
  edit: ReturnType<typeof useSheetTarget<null>>
}) {
  const current = useQuery({
    queryKey: delegationKeys.ess(),
    queryFn: ({ signal }) => essModules(signal),
  })
  return (
    <Card className="px-4 py-3">
      {queryState(current, {
        loading: "Reading the modules…",
        render: (view) => (
          <>
            <p className="mb-2 text-[0.875rem] text-mute">
              What employees see in their app. A module turned off is hidden
              there; head office and managers keep their own screens.
            </p>
            {ESS_MODULES.map((one) => (
              <KeyValue key={one.value} term={one.label}>
                {view.modules.includes(one.value) ? (
                  <Pill tone="ok">On</Pill>
                ) : (
                  <Pill tone="neutral">Off</Pill>
                )}
              </KeyValue>
            ))}
            <EssSheet
              key={edit.target.id}
              open={edit.open}
              onClose={edit.close}
              current={view}
            />
          </>
        ),
      })}
    </Card>
  )
}

function EssSheet({
  open,
  onClose,
  current,
}: {
  open: boolean
  onClose: () => void
  current: EssModulesView
}) {
  const client = useQueryClient()
  const [on, setOn] = useState<readonly string[]>(current.modules)
  const [reason, setReason] = useState("")
  const save = useMutation({
    mutationFn: () =>
      setEssModules({ modules: [...on], reason: reason.trim() }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: delegationKeys.ess() })
      onClose()
    },
  })
  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title="Employee app modules"
      error={save.error}
      saving={save.isPending}
      canSave={reason.trim() !== ""}
      onSave={() => save.mutate()}
    >
      <p className="text-[0.875rem] text-mute">
        Turning a module off hides it in the employee app.
      </p>
      <div className="flex flex-col gap-3">
        {ESS_MODULES.map((one) => (
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
      </div>
      <Field label="Why" required>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </FormSheet>
  )
}

/// The employee-app modules as a card with its own Edit button, for a page
/// that is not the settings page itself.
export function EssModulesCard() {
  const canWrite = useCanWrite()
  const edit = useSheetTarget<null>()
  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center justify-between gap-2.5">
        <h3 className="text-card-title font-semibold text-ink">Employee app</h3>
        {canWrite && (
          <Button variant="ghost" onClick={() => edit.show(null)}>
            Edit
          </Button>
        )}
      </div>
      <EssModulesList edit={edit} />
    </div>
  )
}

/// Delegasi approval: hand one's decisions — leave, claims, attendance
/// corrections — to a colleague for a span, at one's own rung and nothing
/// else of one's own. The list, the sheet a row opens (with Revoke), and the
/// hand-over sheet; the button that opens the latter is the page's own.
export function DelegationsList({
  administrator,
  handOver,
}: {
  administrator: boolean
  handOver: ReturnType<typeof useSheetTarget<null>>
}) {
  const rows = useQuery({
    queryKey: delegationKeys.all(),
    queryFn: ({ signal }) => delegations(signal),
  })
  const detail = useSheetTarget<DelegationView>()
  return (
    <Card className="px-4 py-3">
      {queryState(rows, {
        loading: "Reading the hand-overs…",
        render: (list) => (
          <>
            {list.length === 0 ? (
              <EmptyState>
                Nothing handed over. Away for a while? Hand over approvals names
                who decides your leave, claims and corrections until you are
                back.
              </EmptyState>
            ) : (
              <MiniTable
                head={[
                  { label: "From", align: "left" },
                  { label: "To", align: "left" },
                  { label: "When", align: "left" },
                  { label: "", align: "left" },
                ]}
              >
                {list.map((row) => (
                  <MiniRow key={row.id}>
                    <MiniCell>
                      <button
                        type="button"
                        className="text-left hover:underline"
                        onClick={() => detail.show(row)}
                      >
                        {row.delegator_name}
                      </button>
                    </MiniCell>
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
                        row.active && <Pill tone="info">Running</Pill>
                      )}
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            )}
            <DelegationSheet
              key={`d${detail.target.id}`}
              open={detail.open}
              onClose={detail.close}
              row={detail.target.row}
            />
            <HandOverSheet
              key={`h${handOver.target.id}`}
              open={handOver.open}
              onClose={handOver.close}
              administrator={administrator}
            />
          </>
        ),
      })}
    </Card>
  )
}

function DelegationSheet({
  open,
  onClose,
  row,
}: {
  open: boolean
  onClose: () => void
  row: DelegationView | null
}) {
  const client = useQueryClient()
  const revoke = useMutation({
    mutationFn: (id: string) => revokeDelegation(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: delegationKeys.all() })
      onClose()
    },
  })
  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={row ? `${row.delegator_name} → ${row.delegate_name}` : "Hand-over"}
      error={revoke.error}
      danger={
        row && !row.revoked
          ? {
              label: "Revoke",
              pending: revoke.isPending,
              onClick: () => revoke.mutate(row.id),
            }
          : null
      }
    >
      {row && (
        <div>
          <KeyValue term="From">{row.delegator_name}</KeyValue>
          <KeyValue term="To">{row.delegate_name}</KeyValue>
          <KeyValue term="When">
            {day(row.from_date)} – {day(row.to_date)}
          </KeyValue>
          <KeyValue term="Why">{row.reason}</KeyValue>
          <KeyValue term="State">
            {row.revoked ? "Revoked" : row.active ? "Running" : "Not running"}
          </KeyValue>
          {!row.revoked && (
            <p className="mt-3 text-[0.875rem] text-mute">
              Revoking returns the decisions to {row.delegator_name} at once.
            </p>
          )}
        </div>
      )}
    </FormSheet>
  )
}

function HandOverSheet({
  open,
  onClose,
  administrator,
}: {
  open: boolean
  onClose: () => void
  administrator: boolean
}) {
  const client = useQueryClient()
  const [delegator, setDelegator] = useState("")
  const [stand, setStand] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [reason, setReason] = useState("")
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
      void client.invalidateQueries({ queryKey: delegationKeys.all() })
      onClose()
    },
  })
  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title="Hand over approvals"
      error={give.error}
      saveLabel="Hand over"
      saving={give.isPending}
      canSave={
        stand.trim() !== "" && from !== "" && to !== "" && reason.trim() !== ""
      }
      onSave={() => give.mutate()}
    >
      {administrator && (
        <Field label="Whose approvals" aside="empty: yours">
          <Input
            value={delegator}
            onChange={(e) => setDelegator(e.target.value)}
          />
        </Field>
      )}
      <Field label="To" required>
        <Input value={stand} onChange={(e) => setStand(e.target.value)} />
      </Field>
      <Field label="From" required>
        <Day value={from} onChange={setFrom} />
      </Field>
      <Field label="Until" required>
        <Day value={to} onChange={setTo} />
      </Field>
      <Field label="Why" required>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </FormSheet>
  )
}

/// The same list as a card with its own header button — for the overview,
/// where it sits among the queues.
export function DelegationsCard({ administrator }: { administrator: boolean }) {
  const canWrite = useCanWrite()
  const handOver = useSheetTarget<null>()
  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center justify-between gap-2.5">
        <h3 className="text-card-title font-semibold text-ink">
          Approvals handed over
        </h3>
        {canWrite && (
          <Button variant="ghost" onClick={() => handOver.show(null)}>
            Hand over approvals
          </Button>
        )}
      </div>
      <DelegationsList administrator={administrator} handOver={handOver} />
    </div>
  )
}
