import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/field"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { Banner } from "@/components/ui/states"
import { count, day } from "@/lib/format"
import {
  listUniformIssuances,
  recordUniformIssuance,
  useReach,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { Quiet } from "@/screens/people/parts"

/// The uniforms one person has been handed — the Uniforms tab of the
/// employee's sheet.
///
/// # On the person, not on a screen of its own
///
/// This was the ledger on the Benefits screen: every active employee in one
/// list, each row its own request, beside a read-only card of the benefit and
/// BPJS numbers. The owner asked for a shorter menu on 2026-09-27; a handover
/// is recorded against one person, so it is recorded on that person's sheet,
/// and the screen and its route are gone. The numbers card went with it: its
/// only editor (Rule numbers) had been removed as a duplicate, and a card of
/// figures nobody can change is not a screen's worth.
///
/// # Who may record one
///
/// The store hands the uniform over, so a place manager records it — and head
/// office too. The server holds the key; this only stops a cashier being
/// offered a form that will be refused.
export function UniformTab({ employeeId }: { employeeId: string }) {
  const client = useQueryClient()
  const reach = useReach()
  const manager =
    reach.data?.role === "ADMIN" || reach.data?.role === "SUPERVISOR"

  const ledger = useQuery({
    // The key the handover form invalidates by its prefix.
    queryKey: ["people", "next", "uniform", employeeId],
    queryFn: ({ signal }) => listUniformIssuances(employeeId, signal),
  })

  return (
    <div className="flex flex-col gap-5">
      <div>
        <SubHead>Handed over</SubHead>
        {queryState(ledger, {
          loading: "Reading the ledger…",
          render: (rows) => {
            const year = new Date().toISOString().slice(0, 4)
            const sets = rows
              .filter((row) => row.issued_on.startsWith(year))
              .reduce((sum, row) => sum + row.sets, 0)
            return rows.length === 0 ? (
              <Quiet>No uniform has been recorded for this person.</Quiet>
            ) : (
              <>
                <p className="mb-2 text-meta text-body">
                  {count(sets)} {sets === 1 ? "set" : "sets"} this year.
                </p>
                <MiniTable
                  head={[
                    "On",
                    { label: "Sets", align: "right" },
                    { label: "Recorded by", align: "left" },
                  ]}
                >
                  {rows.map((row) => (
                    <MiniRow key={row.id}>
                      <MiniCell>{day(row.issued_on)}</MiniCell>
                      <MiniCell align="right">{count(row.sets)}</MiniCell>
                      <MiniCell>{row.recorded_by}</MiniCell>
                    </MiniRow>
                  ))}
                </MiniTable>
              </>
            )
          },
        })}
      </div>

      {manager && (
        <RecordUniform
          employeeId={employeeId}
          onDone={() =>
            client.invalidateQueries({
              queryKey: ["people", "next", "uniform"],
            })
          }
        />
      )}
    </div>
  )
}

function RecordUniform({
  employeeId,
  onDone,
}: {
  employeeId: string
  onDone: () => void
}) {
  const [sets, setSets] = useState("1")
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)
  const record = useMutation({
    mutationFn: () =>
      recordUniformIssuance(employeeId, {
        issued_on: new Date().toISOString().slice(0, 10),
        sets: Number(sets),
        reason,
      }),
    onSuccess: () => {
      onDone()
      setSets("1")
      setReason("")
      setFailed(null)
    },
    onError: (error: Error) => setFailed(error.message),
  })
  return (
    <div className="flex flex-col gap-3">
      <SubHead>Record a handover</SubHead>
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Sets" required>
          <Input
            inputMode="numeric"
            value={sets}
            onChange={(e) => setSets(e.target.value.replace(/[^\d]/g, ""))}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Why" required>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="new starter"
            />
          </Field>
        </div>
      </div>
      {failed ? <Banner tone="bad">{failed}</Banner> : null}
      <div className="flex justify-end">
        <Button
          variant="primary"
          pending={record.isPending}
          disabled={sets === "" || Number(sets) <= 0 || reason.trim() === ""}
          onClick={() => record.mutate()}
        >
          Record the handover
        </Button>
      </div>
    </div>
  )
}
