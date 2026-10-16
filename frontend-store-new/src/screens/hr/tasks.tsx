import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, ChevronRight, Clock } from "lucide-react"
import { useState } from "react"

import { Field, Input } from "@/components/ui/field"
import { PeopleSheet, SheetSection } from "@/components/ui/people-sheet"
import { PeopleTable } from "@/components/ui/people-table"
import { PeopleTabs } from "@/components/ui/people-tabs"
import { Stat, StatStrip } from "@/components/ui/stat-strip"
import { Pill, Status } from "@/components/ui/pill"
import {
  completeTask,
  hrKeys,
  lifecycleTasksQuery,
  type StoreScope,
} from "@/lib/queries/hr"
import { cn } from "@/lib/utils"
import { centreState } from "@/screens/hr/centre"
import { Person, personCard, Submit } from "@/screens/hr/parts"
import {
  personByLogin,
  personName,
  useTeam,
  type Tone,
} from "@/screens/hr/words"
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
  return <HrWorkspace>{(scope) => <Tasks scope={scope} />}</HrWorkspace>
}

/// Who a task is waiting on, said of an open one.
function withWord(owner: string): string {
  switch (owner) {
    case "STORE":
      return "This shop"
    case "HEAD_OFFICE":
      return "With head office"
    case "IT":
      return "With IT"
    case "EMPLOYEE":
      return "With the employee"
    default:
      return owner
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

const KIND_WORD: Record<Tab, string> = {
  ONBOARDING: "Onboarding",
  SEPARATION: "Exit",
}

function kindWord(kind: string): string {
  return KIND_WORD[kind as Tab] ?? kind
}

/// The rows this shop still has to close on a checklist.
function ownRows(list: Checklist): LifecycleTaskView[] {
  return list.tasks.filter(
    (task) => task.owner === "STORE" && task.state === "PENDING",
  )
}

/// What a checklist is, in a word — the one that says whose move it is.
function checklistState(list: Checklist): { label: string; tone: Tone } {
  const done = list.tasks.filter((task) => task.state === "DONE").length
  if (done === list.tasks.length) return { label: "Done", tone: "ok" }
  if (ownRows(list).length > 0) return { label: "To do here", tone: "warn" }
  return { label: "With others", tone: "info" }
}

function Tasks({ scope }: { scope: StoreScope }) {
  const team = useTeam(scope)
  const tasks = useQuery(lifecycleTasksQuery())
  const [tab, setTab] = useState<Tab>("ONBOARDING")
  const [open, setOpen] = useState<string | null>(null)
  /// The row being closed. While it is set its form stands in for the
  /// checklist's sheet; closing it returns to the checklist.
  const [marking, setMarking] = useState<LifecycleTaskView | null>(null)

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
  const countOf = (kind: Tab) =>
    lists.filter((list) => list.kind === kind).length
  const shown = lists.filter((list) => list.kind === tab)
  const current = lists.find((list) => list.key === open)

  const toDoHere = lists.filter((list) => ownRows(list).length > 0).length
  const reading = tasks.data === undefined

  return (
    <>
      <StatStrip>
        <Stat label="Onboarding" value={reading ? "—" : countOf("ONBOARDING")} />
        <Stat label="Exit" value={reading ? "—" : countOf("SEPARATION")} />
        <Stat
          label="To do here"
          value={reading ? "—" : toDoHere}
          tone={toDoHere > 0 ? "warn" : undefined}
        />
      </StatStrip>
      <PeopleTabs
        value={tab}
        onChange={setTab}
        tabs={[
          {
            value: "ONBOARDING",
            label: "Onboarding",
            count: countOf("ONBOARDING"),
          },
          { value: "SEPARATION", label: "Exit", count: countOf("SEPARATION") },
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
            empty={tab === "ONBOARDING" ? "Nobody joining." : "Nobody leaving."}
            card={(list) => {
              const done = list.tasks.filter(
                (task) => task.state === "DONE",
              ).length
              const state = checklistState(list)
              return {
                ...personCard(team.data, list.employeeId),
                lead: {
                  figure: `${done}/${list.tasks.length}`,
                  caption: "done",
                },
                foot: {
                  info: <Status tone={state.tone}>{state.label}</Status>,
                  action: { label: "Open", onClick: () => setOpen(list.key) },
                },
              }
            }}
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
                header: "Done",
                cell: (list) =>
                  `${list.tasks.filter((task) => task.state === "DONE").length} of ${list.tasks.length}`,
              },
              {
                key: "mine",
                header: "To do here",
                className: "whitespace-normal",
                cell: (list) => {
                  const mine = ownRows(list)
                  return mine.length === 0 ? (
                    <span className="text-mute">—</span>
                  ) : (
                    mine.map((task) => task.label).join(" · ")
                  )
                },
              },
              {
                key: "others",
                header: "With others",
                align: "right",
                cell: (list) =>
                  list.tasks.filter(
                    (task) =>
                      task.owner !== "STORE" && task.state === "PENDING",
                  ).length,
              },
              {
                key: "state",
                header: "Status",
                cell: (list) => {
                  const state = checklistState(list)
                  return <Status tone={state.tone}>{state.label}</Status>
                },
              },
            ]}
          />
        ),
      })}

      {current !== undefined && marking === null && (
        <ChecklistSheet
          list={current}
          team={team.data}
          onMark={setMarking}
          onClose={() => setOpen(null)}
        />
      )}
      {current !== undefined && marking !== null && (
        <MarkDoneSheet
          key={marking.id}
          list={current}
          task={marking}
          team={team.data}
          onClose={() => setMarking(null)}
        />
      )}
    </>
  )
}

function ChecklistSheet({
  list,
  team,
  onMark,
  onClose,
}: {
  list: Checklist
  team: EmployeeList | undefined
  onMark: (task: LifecycleTaskView) => void
  onClose: () => void
}) {
  const done = list.tasks.filter((task) => task.state === "DONE").length
  const state = checklistState(list)
  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      crumb={kindWord(list.kind)}
      title={personName(team, list.employeeId)}
      sub={`${done} of ${list.tasks.length} done`}
      status={<Pill tone={state.tone}>{state.label}</Pill>}
    >
      <SheetSection title="Tasks" aside={list.tasks.length}>
        <ul className="flex flex-col divide-y divide-hairline">
          {list.tasks.map((task) => (
            <li key={task.id}>
              <TaskLine task={task} team={team} onMark={onMark} />
            </li>
          ))}
        </ul>
      </SheetSection>
    </PeopleSheet>
  )
}

/// One row of a checklist. A row this shop owns and has not closed opens the
/// form that closes it; every other row is only read.
function TaskLine({
  task,
  team,
  onMark,
}: {
  task: LifecycleTaskView
  team: EmployeeList | undefined
  onMark: (task: LifecycleTaskView) => void
}) {
  const finished = task.state === "DONE"
  const mine = task.owner === "STORE" && !finished
  const caption = finished
    ? task.done_by === null
      ? "Done"
      : `Done by ${personByLogin(team, task.done_by)}`
    : mine
      ? "To do here"
      : withWord(task.owner)

  const inner = (
    <>
      <span
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-full [&_svg]:size-3.5",
          finished ? "bg-ok-bg text-ok-fg" : "bg-soft-2 text-mute",
        )}
      >
        {finished ? <Check /> : <Clock />}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-cell",
            finished ? "text-mute line-through" : "text-ink",
          )}
        >
          {task.label}
        </span>
        <span
          className={cn(
            "block text-meta",
            mine ? "font-medium text-warn-fg" : "text-mute",
          )}
        >
          {caption}
        </span>
      </span>
      {mine && <ChevronRight className="size-4 shrink-0 text-line-ico" />}
    </>
  )

  return mine ? (
    <button
      type="button"
      onClick={() => onMark(task)}
      className="flex min-h-11 w-full items-center gap-2.5 py-2.5 text-left transition-colors active:bg-soft"
    >
      {inner}
    </button>
  ) : (
    <div className="flex min-h-11 items-center gap-2.5 py-2.5">{inner}</div>
  )
}

/// Closing one of this shop's rows. The centre refuses a completion with no
/// reason, so the note is the one thing asked.
function MarkDoneSheet({
  list,
  task,
  team,
  onClose,
}: {
  list: Checklist
  task: LifecycleTaskView
  team: EmployeeList | undefined
  onClose: () => void
}) {
  const client = useQueryClient()
  const [reason, setReason] = useState("")
  const complete = useMutation({
    mutationFn: () => completeTask({ id: task.id, reason }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: hrKeys.lifecycle() })
      client.invalidateQueries({ queryKey: hrKeys.tasks() })
      onClose()
    },
  })

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      crumb={`${kindWord(list.kind)} · ${personName(team, list.employeeId)}`}
      title={task.label}
      foot={
        <Submit
          label="Mark done"
          pendingLabel="Saving…"
          pending={complete.isPending}
          disabled={reason.trim() === ""}
          error={complete.error}
          onSubmit={() => complete.mutate()}
          onCancel={onClose}
        />
      }
    >
      <Field label="Note" required>
        <Input
          value={reason}
          placeholder="Two sets handed over"
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
    </PeopleSheet>
  )
}
