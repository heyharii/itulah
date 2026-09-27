import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Clock } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/field"
import { Meter } from "@/components/ui/meter"
import { PeopleSheet, SheetSection } from "@/components/ui/people-sheet"
import { PeopleTable } from "@/components/ui/people-table"
import { PeopleTabs } from "@/components/ui/people-tabs"
import { Pill } from "@/components/ui/pill"
import { Banner } from "@/components/ui/states"
import {
  completeTask,
  hrKeys,
  lifecycleTasks,
  type StoreScope,
} from "@/lib/queries/hr"
import { cn } from "@/lib/utils"
import { centreState, describeCentre } from "@/screens/hr/centre"
import { Person } from "@/screens/hr/parts"
import { personName, useTeam, type Tone } from "@/screens/hr/words"
import { HrWorkspace } from "@/screens/hr/workspace"
import type { EmployeeList, LifecycleTaskView } from "@itulah/contract"

/// Onboarding and exit — the prototype's store "Onboarding & exit".
///
/// "Checklist masuk dan keluar dari template HO. Tiap tugas punya pemilik":
/// every joiner and every leaver works through head office's checklist, and
/// every row has one owner — the shop, head office, IT, or the employee. The
/// shop closes its own rows here (the uniform handed over, the first rota, the
/// ID card taken back); everybody else's rows are shown so a store head can
/// see what a joiner is still waiting on, and cannot be ticked from a till.
/// The employee's own rows are closed on their phone, IT's at head office.
///
/// Full-and-final settlement is head office's and is not on this screen, as
/// the prototype keeps it off the store's.
export function HrTasks() {
  return (
    <HrWorkspace sub="Joining and leaving checklists from head office's template. Every task has an owner — this shop, head office, IT or the employee — and the shop closes its own.">
      {(scope) => <Tasks scope={scope} />}
    </HrWorkspace>
  )
}

function ownerWord(owner: string): { label: string; tone: Tone } {
  switch (owner) {
    case "STORE":
      return { label: "This shop", tone: "accent" }
    case "HEAD_OFFICE":
      return { label: "Head office", tone: "neutral" }
    case "IT":
      return { label: "IT", tone: "neutral" }
    case "EMPLOYEE":
      return { label: "Employee", tone: "neutral" }
    default:
      return { label: owner, tone: "neutral" }
  }
}

/// One person's checklist of one kind.
interface Checklist {
  readonly key: string
  readonly employeeId: string
  readonly kind: string
  readonly tasks: readonly LifecycleTaskView[]
}

type Tab = "ONBOARDING" | "SEPARATION"

function Tasks({ scope }: { scope: StoreScope }) {
  const team = useTeam(scope)
  const tasks = useQuery({
    queryKey: hrKeys.lifecycle(),
    queryFn: ({ signal }) => lifecycleTasks(signal),
  })
  const [tab, setTab] = useState<Tab>("ONBOARDING")
  const [open, setOpen] = useState<string | null>(null)

  const lists: Checklist[] = []
  for (const task of tasks.data ?? []) {
    const key = `${task.employee_id}-${task.kind}`
    const found = lists.find((list) => list.key === key)
    if (found === undefined) {
      lists.push({
        key,
        employeeId: task.employee_id,
        kind: task.kind,
        tasks: [task],
      })
    } else {
      ;(found.tasks as LifecycleTaskView[]).push(task)
    }
  }
  for (const list of lists) {
    ;(list.tasks as LifecycleTaskView[]).sort(
      (left, right) => left.position - right.position,
    )
  }
  const count = (kind: Tab) => lists.filter((list) => list.kind === kind).length
  const shown = lists.filter((list) => list.kind === tab)
  const current = lists.find((list) => list.key === open)

  return (
    <>
      <PeopleTabs
        value={tab}
        onChange={setTab}
        tabs={[
          {
            value: "ONBOARDING",
            label: "Onboarding",
            count: count("ONBOARDING"),
          },
          { value: "SEPARATION", label: "Exit", count: count("SEPARATION") },
        ]}
      />
      {centreState(tasks, {
        loading: "Reading the checklists…",
        what: "this shop's checklists",
        render: () => (
          <PeopleTable
            rows={shown}
            rowKey={(list) => list.key}
            onRowClick={(list) => setOpen(list.key)}
            empty={
              tab === "ONBOARDING"
                ? "Nobody is joining. Onboarding opens with the record a hire creates."
                : "Nobody is leaving. An exit checklist opens when head office applies a separation."
            }
            columns={[
              {
                key: "who",
                header: "Employee",
                cell: (list) => (
                  <Person team={team.data} id={list.employeeId} />
                ),
              },
              {
                key: "progress",
                header: "Progress",
                card: "meta",
                cell: (list) => {
                  const done = list.tasks.filter(
                    (task) => task.state === "DONE",
                  ).length
                  return (
                    <span className="flex min-w-[8rem] items-center gap-2">
                      <Meter
                        value={done / Math.max(1, list.tasks.length)}
                        tone="accent"
                      />
                      <span className="text-meta text-mute tabular-nums">
                        {done}/{list.tasks.length}
                      </span>
                    </span>
                  )
                },
              },
              {
                key: "mine",
                header: "Open, owned by this shop",
                card: "meta",
                className: "whitespace-normal",
                cell: (list) => {
                  const mine = list.tasks.filter(
                    (task) =>
                      task.owner === "STORE" && task.state === "PENDING",
                  )
                  return mine.length === 0 ? (
                    <span className="text-mute">—</span>
                  ) : (
                    mine.map((task) => task.label).join(" · ")
                  )
                },
              },
              {
                key: "others",
                header: "Waiting on others",
                align: "right",
                cell: (list) =>
                  list.tasks.filter(
                    (task) =>
                      task.owner !== "STORE" && task.state === "PENDING",
                  ).length,
              },
            ]}
          />
        ),
      })}

      {current !== undefined && (
        <ChecklistSheet
          list={current}
          team={team.data}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  )
}

function ChecklistSheet({
  list,
  team,
  onClose,
}: {
  list: Checklist
  team: EmployeeList | undefined
  onClose: () => void
}) {
  const done = list.tasks.filter((task) => task.state === "DONE").length
  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      crumb={list.kind === "ONBOARDING" ? "Onboarding" : "Exit"}
      title={personName(team, list.employeeId)}
      sub={`${done} of ${list.tasks.length} done`}
    >
      <SheetSection title="Tasks">
        <ul className="flex flex-col gap-2">
          {list.tasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </ul>
      </SheetSection>
      <p className="text-meta text-mute">
        Only this shop's tasks can be closed here. The employee's are closed in
        their app; head office's and IT's at head office.
      </p>
    </PeopleSheet>
  )
}

/// One row of a checklist, and — when it is this shop's and still open — the
/// act of closing it. The centre refuses a completion with no reason.
function TaskRow({ task }: { task: LifecycleTaskView }) {
  const client = useQueryClient()
  const [closing, setClosing] = useState(false)
  const [reason, setReason] = useState("")
  const complete = useMutation({
    mutationFn: () => completeTask({ id: task.id, reason }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: hrKeys.lifecycle() })
      client.invalidateQueries({ queryKey: hrKeys.tasks() })
    },
  })
  const owner = ownerWord(task.owner)
  const finished = task.state === "DONE"
  const mine = task.owner === "STORE" && !finished

  return (
    <li className="rounded-inner border border-hairline px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-full [&_svg]:size-3.5",
            finished ? "bg-ok-bg text-ok-fg" : "bg-soft-2 text-mute",
          )}
        >
          {finished ? <Check /> : <Clock />}
        </span>
        <span className="min-w-0 flex-1 text-cell">
          <span className={finished ? "text-mute line-through" : "text-ink"}>
            {task.label}
          </span>
          {finished && task.done_by !== null && (
            <span className="block text-[0.6875rem] text-mute">
              by {task.done_by}
            </span>
          )}
        </span>
        <Pill tone={owner.tone}>{owner.label}</Pill>
      </div>
      {mine &&
        (closing ? (
          <div className="mt-2.5 flex flex-col gap-2">
            <Field
              label="Why now"
              hint="Required — the record of what was done."
            >
              <Input
                value={reason}
                placeholder="Two sets handed over"
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
            {complete.error !== null && (
              <Banner tone="bad">{describeCentre(complete.error)}</Banner>
            )}
            <div className="flex gap-2 [&>button]:min-w-0 [&>button]:flex-1 [&>button]:shrink">
              <Button variant="quiet" onClick={() => setClosing(false)}>
                Not now
              </Button>
              <Button
                variant="primary"
                disabled={reason.trim() === "" || complete.isPending}
                onClick={() => complete.mutate()}
              >
                Mark done
              </Button>
            </div>
          </div>
        ) : (
          <Button className="mt-2.5" block onClick={() => setClosing(true)}>
            Mark done
          </Button>
        ))}
    </li>
  )
}
