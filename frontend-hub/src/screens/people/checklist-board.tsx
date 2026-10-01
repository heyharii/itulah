import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { EmptyState, LoadingState, Problem } from "@/components/ui/states"
import { count } from "@/lib/format"
import {
  hrEmployeeKeys,
  nameOf,
  progressByEmployee,
  useEveryEmployee,
  useLifecycleTasks,
} from "@/lib/queries/hr-employees"
import { openChecklist } from "@/lib/queries/people"
import { useCanWrite } from "@/lib/session"
import { ChecklistPanel } from "@/screens/people/checklist"
import { EmployeePick } from "@/screens/people/employee-pick"

type Slice = "OPEN" | "DONE"

const COPY = {
  ONBOARDING: {
    title: "Onboarding",
    sub: "Each new hire's first-days checklist, and how far along it is.",
    start: "Start onboarding",
    startSheet: "Start onboarding",
    startHint:
      "A hire opens the checklist by itself. Use this for somebody hired before it existed.",
    noun: "onboarding",
  },
  SEPARATION: {
    title: "Offboarding",
    sub: "Each leaver's exit checklist — handover, return of things, access closed.",
    start: "Start offboarding",
    startSheet: "Start offboarding",
    startHint:
      "Opens the separation checklist for somebody who is leaving, so each task has an owner.",
    noun: "offboarding",
  },
} as const

/// People with an onboarding or an offboarding checklist, one row each, with
/// how many of their tasks are done. The two pages differ only in the kind of
/// checklist, so they share this board.
export function ChecklistBoard({
  kind,
}: {
  kind: "ONBOARDING" | "SEPARATION"
}) {
  const copy = COPY[kind]
  const canWrite = useCanWrite()
  const tasks = useLifecycleTasks(kind)
  const people = useEveryEmployee()
  const [slice, setSlice] = useState<Slice>("OPEN")
  const [openId, setOpenId] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  const everyone = progressByEmployee(tasks.data ?? [])
  const rows = everyone
    .filter((row) =>
      slice === "DONE" ? row.done === row.total : row.done < row.total
    )
    .sort((a, b) =>
      nameOf(people.data, a.employeeId).localeCompare(
        nameOf(people.data, b.employeeId)
      )
    )
  const has = new Set(everyone.map((row) => row.employeeId))

  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title={copy.title}
        sub={copy.sub}
        actions={
          canWrite && (
            <Button variant="primary" onClick={() => setStarting(true)}>
              {copy.start}
            </Button>
          )
        }
      />

      <Toolbar>
        <Segmented<Slice>
          options={[
            { value: "OPEN", label: "In progress" },
            { value: "DONE", label: "Completed" },
          ]}
          value={slice}
          onChange={setSlice}
        />
        <Toolbar.Spacer />
        <span className="text-[0.875rem] text-mute tabular-nums">
          {count(rows.length)} {rows.length === 1 ? "person" : "people"}
        </span>
      </Toolbar>

      <Card className="overflow-hidden px-4 py-3">
        {tasks.isPending ? (
          <LoadingState>Loading checklists…</LoadingState>
        ) : tasks.isError ? (
          <Problem error={tasks.error} />
        ) : rows.length === 0 ? (
          <EmptyState>
            {slice === "OPEN"
              ? `Nobody has an ${copy.noun} checklist in progress. “${copy.start}” in the header opens one.`
              : `No ${copy.noun} checklist has been completed yet.`}
          </EmptyState>
        ) : (
          <MiniTable head={["Who", "Progress", "Done", ""]}>
            {rows.map((row) => (
              <MiniRow key={row.employeeId}>
                <MiniCell>
                  <button
                    type="button"
                    onClick={() => setOpenId(row.employeeId)}
                    className="font-medium text-ink hover:underline"
                  >
                    {nameOf(people.data, row.employeeId)}
                  </button>
                </MiniCell>
                <MiniCell align="right">
                  <ProgressBar done={row.done} total={row.total} />
                </MiniCell>
                <MiniCell align="right">
                  {row.done} of {row.total}
                </MiniCell>
                <MiniCell align="right">
                  <Pill tone={row.done === row.total ? "ok" : "warn"}>
                    {row.done === row.total ? "Completed" : "In progress"}
                  </Pill>
                </MiniCell>
              </MiniRow>
            ))}
          </MiniTable>
        )}
      </Card>

      <Sheet
        open={openId !== null}
        onOpenChange={(next) => !next && setOpenId(null)}
        title={openId === null ? copy.title : nameOf(people.data, openId)}
        caption={`${copy.title} checklist`}
      >
        {openId !== null && <ChecklistPanel employeeId={openId} />}
      </Sheet>

      <StartSheet
        open={starting}
        kind={kind}
        exclude={has}
        onClose={() => setStarting(false)}
        onStarted={(employeeId) => {
          setStarting(false)
          setOpenId(employeeId)
        }}
      />
    </PageContent>
  )
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const share = total === 0 ? 0 : Math.round((done / total) * 100)
  return (
    <span
      role="progressbar"
      aria-valuenow={share}
      aria-valuemin={0}
      aria-valuemax={100}
      className="ml-auto inline-block h-1.5 w-28 overflow-hidden rounded-full bg-soft-2 align-middle"
    >
      <span
        className="block h-full rounded-full bg-ink"
        style={{ width: `${share}%` }}
      />
    </span>
  )
}

function StartSheet({
  open,
  kind,
  exclude,
  onClose,
  onStarted,
}: {
  open: boolean
  kind: "ONBOARDING" | "SEPARATION"
  exclude: ReadonlySet<string>
  onClose: () => void
  onStarted: (employeeId: string) => void
}) {
  const copy = COPY[kind]
  const client = useQueryClient()
  const [who, setWho] = useState<string | null>(null)
  const start = useMutation({
    mutationFn: (employeeId: string) => openChecklist(employeeId, kind),
    onSuccess: (_rows, employeeId) => {
      void client.invalidateQueries({ queryKey: hrEmployeeKeys.all() })
      setWho(null)
      onStarted(employeeId)
    },
  })
  const close = () => {
    start.reset()
    setWho(null)
    onClose()
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && close()}
      title={copy.startSheet}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="quiet" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={who === null}
            pending={start.isPending}
            onClick={() => who !== null && start.mutate(who)}
          >
            {start.isPending ? "Opening…" : copy.start}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3.5">
        <p className="text-[0.875rem] text-body">{copy.startHint}</p>
        <Field label="Employee" required>
          <EmployeePick
            value={who}
            onChange={setWho}
            statuses={["ACTIVE"]}
            exclude={exclude}
          />
        </Field>
        <Problem error={start.error} />
      </div>
    </Sheet>
  )
}
