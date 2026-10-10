import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox, Field, Input } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { SubHead } from "@/components/ui/rows"
import { Banner, EmptyState } from "@/components/ui/states"
import {
  completeLifecycleTask,
  employeeChecklist,
  openChecklist,
  orgKeys,
} from "@/lib/queries/people"
import { hrEmployeeKeys } from "@/lib/queries/hr-employees"
import { queryState } from "@/lib/query-state"
import { OWNER_LABEL } from "@/screens/people/checklist-owners"
import type { LifecycleTaskView } from "@itulah/contract"

/// Somebody's onboarding (and, when they leave, separation) checklist, as
/// Talenta's: each task with who does it, ticked off as it is done. A task
/// the employee owns is ticked from their phone; HR sees it land here.
export function ChecklistPanel({ employeeId }: { employeeId: string }) {
  const client = useQueryClient()
  const tasks = useQuery({
    queryKey: orgKeys.checklist(employeeId),
    queryFn: ({ signal }) => employeeChecklist(employeeId, signal),
  })
  const open = useMutation({
    mutationFn: (kind: "ONBOARDING" | "SEPARATION") =>
      openChecklist(employeeId, kind),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: orgKeys.checklist(employeeId),
      })
      void client.invalidateQueries({ queryKey: hrEmployeeKeys.all() })
    },
  })
  const rows = tasks.data ?? []
  const has = (kind: string) => rows.some((row) => row.kind === kind)

  return (
    <div className="flex flex-col gap-4">
      {queryState(tasks, {
        loading: "Reading the checklist…",
        render: () =>
          rows.length === 0 ? (
            <EmptyState>
              No checklist yet. A hire opens the onboarding checklist by itself;
              somebody hired before it existed gets one here.
            </EmptyState>
          ) : (
            <>
              {(["ONBOARDING", "SEPARATION"] as const)
                .filter(has)
                .map((kind) => (
                  <Checklist
                    key={kind}
                    kind={kind}
                    rows={rows.filter((row) => row.kind === kind)}
                    employeeId={employeeId}
                  />
                ))}
            </>
          ),
      })}
      <div className="flex flex-wrap gap-2">
        {!has("ONBOARDING") && (
          <Button
            variant="ghost"
            pending={open.isPending}
            onClick={() => open.mutate("ONBOARDING")}
          >
            Open onboarding checklist
          </Button>
        )}
        {!has("SEPARATION") && (
          <Button
            variant="ghost"
            pending={open.isPending}
            onClick={() => open.mutate("SEPARATION")}
          >
            Open separation checklist
          </Button>
        )}
      </div>
      {open.error !== null && <Banner tone="bad">{open.error.message}</Banner>}
    </div>
  )
}

function Checklist({
  kind,
  rows,
  employeeId,
}: {
  kind: string
  rows: readonly LifecycleTaskView[]
  employeeId: string
}) {
  const client = useQueryClient()
  const [why, setWhy] = useState("")
  const done = rows.filter((row) => row.state === "DONE").length
  const tick = useMutation({
    mutationFn: (taskId: string) =>
      completeLifecycleTask(taskId, why.trim() === "" ? "done" : why.trim()),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: orgKeys.checklist(employeeId),
      })
      void client.invalidateQueries({ queryKey: hrEmployeeKeys.all() })
    },
  })
  return (
    <div>
      <SubHead aside={`${done} of ${rows.length} done`}>
        {kind === "ONBOARDING" ? "Onboarding" : "Separation"}
      </SubHead>
      <ul className="flex flex-col gap-2">
        {[...rows]
          .sort((a, b) => a.position - b.position)
          .map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-2">
              <Checkbox
                label={row.label}
                checked={row.state === "DONE"}
                disabled={row.state === "DONE" || row.owner === "EMPLOYEE"}
                hint={
                  row.owner === "EMPLOYEE" && row.state !== "DONE"
                    ? "Ticked by the employee from their phone."
                    : undefined
                }
                onChange={() => tick.mutate(row.id)}
              />
              <Pill tone="neutral">{OWNER_LABEL[row.owner] ?? row.owner}</Pill>
              {row.done_by !== null && (
                <span className="text-[0.875rem] text-mute">
                  by {row.done_by}
                </span>
              )}
            </li>
          ))}
      </ul>
      <div className="mt-3 max-w-md">
        <Field label="Note for the next tick" aside="optional">
          <Input value={why} onChange={(event) => setWhy(event.target.value)} />
        </Field>
      </div>
      {tick.error !== null && (
        <Banner tone="bad" className="mt-2">
          {tick.error.message}
        </Banner>
      )}
    </div>
  )
}
