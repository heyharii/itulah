import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Banner, EmptyState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import {
  completeLifecycleTask,
  listEmployees,
  listLifecycleTasks,
  nextKeys,
  peopleKeys,
  useReach,
  type LifecycleTaskView,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"

/// Onboarding and separation: the two checklists every joiner and leaver
/// works through, each task owned by exactly one party.
///
/// The prototype's rule is the point: HR toko, HR HO, IT and the employee
/// each own their rows, and a task belongs to whoever can actually do it —
/// which is why the phone closes the employee's rows and cannot close IT's,
/// and why a store cannot mark an account provisioned. Progress is a count
/// of rows, so nothing here computes anything; it reads.
///
/// A separation checklist is opened by the machine when a separation change
/// proposal is applied; an onboarding one opens with the employment record a
/// hire creates. Neither is filed by hand.

const OWNER_LABEL: Record<LifecycleTaskView["owner"], string> = {
  HEAD_OFFICE: "HR HO",
  STORE: "HR toko",
  IT: "IT",
  EMPLOYEE: "Karyawan",
}

export function Lifecycle() {
  const client = useQueryClient()
  const reach = useReach()
  const [kind, setKind] = useState("ONBOARDING")
  const [task, setTask] = useState<LifecycleTaskView | null>(null)
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const team = useQuery({
    queryKey: peopleKeys.employees({ status: "ACTIVE", limit: 1000 }),
    queryFn: ({ signal }) =>
      listEmployees({ status: "ACTIVE", limit: 1000 }, signal),
  })
  const tasks = useQuery({
    queryKey: nextKeys.tasks(kind),
    queryFn: ({ signal }) => listLifecycleTasks({ kind }, signal),
  })
  const people = (team.data ?? []).map((person) => ({
    id: person.employee_id,
    name: person.full_name ?? person.employee_code ?? person.employee_id,
  }))
  const nameOf = (id: string) =>
    people.find((person) => person.id === id)?.name ?? id

  const complete = useMutation({
    mutationFn: () => {
      if (task === null) throw new Error("no task is open")
      return completeLifecycleTask(task.id, reason)
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: nextKeys.tasks() })
      setTask(null)
      setReason("")
    },
    onError: (error: Error) => setFailed(error.message),
  })

  const rows = tasks.data ?? []
  const byPerson = new Map<string, LifecycleTaskView[]>()
  for (const row of rows) {
    const list = byPerson.get(row.employee_id) ?? []
    list.push(row)
    byPerson.set(row.employee_id, list)
  }
  // The employee's own rows are closed from the phone and IT's from System —
  // what this screen offers is the store's and head office's halves.
  const mine = reach.data?.role === "ADMIN" || reach.data?.role === "SUPERVISOR"

  return (
    <PageContent>
      <PageHeader
        crumb="People · Talent"
        title="Onboarding & exit"
        sub="Checklists from head office's template. Each task has one owner; progress is the count that says who is still waiting on whom."
      />

      <SubTabs
        tabs={[
          { value: "ONBOARDING", label: "Onboarding" },
          { value: "SEPARATION", label: "Separation" },
        ]}
        value={kind}
        onChange={setKind}
      />

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>
            {kind === "ONBOARDING" ? "People joining" : "People leaving"}
          </CardTitle>
        </CardHeader>
        {queryState(tasks, {
          loading: "Reading the checklists…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {kind === "ONBOARDING"
                  ? "Nobody is onboarding. A checklist opens with the employment record a hire creates."
                  : "Nobody is leaving. A separation checklist opens when a separation proposal is applied."}
              </EmptyState>
            ) : (
              <div className="divide-y">
                {[...byPerson.entries()].map(([employeeId, personTasks]) => {
                  const done = personTasks.filter(
                    (t) => t.state === "DONE"
                  ).length
                  return (
                    <div key={employeeId} className="px-4 py-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-medium text-ink">
                          {nameOf(employeeId)}
                        </span>
                        <span className="text-meta text-mute">
                          {done}/{personTasks.length}
                        </span>
                      </div>
                      <ul className="mt-1.5 space-y-1">
                        {personTasks.map((t) => (
                          <li
                            key={t.id}
                            className="flex items-baseline justify-between gap-3"
                          >
                            <span
                              className={
                                t.state === "DONE"
                                  ? "text-mute line-through"
                                  : "text-body"
                              }
                            >
                              {t.label}
                              <span className="ml-2 text-meta text-mute">
                                {OWNER_LABEL[t.owner]}
                              </span>
                            </span>
                            {t.state === "DONE" ? (
                              <Pill tone="ok">Done</Pill>
                            ) : mine &&
                              t.owner !== "EMPLOYEE" &&
                              t.owner !== "IT" ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setTask(t)
                                  setFailed(null)
                                }}
                              >
                                Mark done
                              </Button>
                            ) : (
                              <Pill tone="neutral">
                                Waiting on {OWNER_LABEL[t.owner]}
                              </Pill>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </div>
            ),
        })}
      </Card>

      {task !== null && (
        <Card>
          <CardHeader>
            <CardTitle>Mark done: {task.label}</CardTitle>
          </CardHeader>
          <div className="space-y-3">
            <Field label="Why now" required>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            {failed ? <Banner tone="bad">{failed}</Banner> : null}
            <div className="flex justify-end gap-2">
              <Button variant="quiet" onClick={() => setTask(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                pending={complete.isPending}
                disabled={reason.trim() === ""}
                onClick={() => complete.mutate()}
              >
                Record it
              </Button>
            </div>
          </div>
        </Card>
      )}
    </PageContent>
  )
}
