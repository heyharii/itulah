import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { useLayout } from "@/lib/layout"
import { Fab } from "@/components/ui/fab"
import { DockChoice } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Status } from "@/components/ui/pill"
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
  type ChecklistProgress,
} from "@/lib/queries/hr-employees"
import { openChecklist } from "@/lib/queries/people"
import { useCanWrite } from "@/lib/session"
import { tableSetup, type TableSetup } from "@/lib/table"
import { ChecklistPanel } from "@/screens/people/checklist"
import { EmployeePick } from "@/screens/people/employee-pick"
import { CardFigure, CardName } from "@/components/ui/phone-cards"

type Slice = "OPEN" | "DONE"

const COPY = {
  ONBOARDING: {
    title: "Onboarding",
    start: "Start onboarding",
    noun: "onboarding",
  },
  SEPARATION: {
    title: "Offboarding",
    start: "Start offboarding",
    noun: "offboarding",
  },
} as const

const NO_PEOPLE: ChecklistProgress[] = []

function columnsFor(
  nameFor: (employeeId: string) => string
): ColumnDef<TableSetup, ChecklistProgress>[] {
  const state = (row: ChecklistProgress) =>
    row.done === row.total ? (
      <Status tone="done">Completed</Status>
    ) : (
      <Status tone="info">In progress</Status>
    )
  return [
    {
      id: "who",
      accessorFn: (row) => nameFor(row.employeeId),
      header: "Who",
      size: 360,
      meta: { card: "hide" },
      // Read at render: the table caches a row's values, and the names can
      // arrive after the checklists.
      cell: ({ row }) => nameFor(row.original.employeeId),
    },
    {
      id: "done",
      accessorFn: (row) => (row.total === 0 ? 0 : row.done / row.total),
      header: "Done",
      size: 160,
      meta: { align: "right", card: "hide" },
      cell: ({ row }) => `${row.original.done} of ${row.original.total}`,
    },
    {
      id: "state",
      accessorFn: (row) => row.done === row.total,
      header: "State",
      size: 180,
      meta: { align: "right", card: "hide" },
      cell: ({ row }) => state(row.original),
    },
    // Three columns that exist only on a card (`cardLead`; a phone): the
    // person, how many tasks are done as the figure, and where it stands.
    {
      id: "head",
      accessorFn: (row) => nameFor(row.employeeId),
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "title" },
      cell: ({ row }) => <CardName name={nameFor(row.original.employeeId)} />,
    },
    {
      id: "lead",
      accessorFn: (row) => row.done,
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "lead" },
      cell: ({ row }) => (
        <CardFigure
          value={`${row.original.done}/${row.original.total}`}
          caption="tasks done"
          tone={row.original.done === row.original.total ? "quiet" : undefined}
        />
      ),
    },
    {
      id: "foot",
      accessorFn: (row) => row.done === row.total,
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "foot" },
      cell: ({ row }) => state(row.original),
    },
  ]
}

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
  const phone = useLayout() === "phone"
  const tasks = useLifecycleTasks(kind)
  const people = useEveryEmployee()
  const [slice, setSlice] = useState<Slice>("OPEN")
  const [openId, setOpenId] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  const everyone = useMemo(
    () =>
      tasks.data === undefined ? NO_PEOPLE : progressByEmployee(tasks.data),
    [tasks.data]
  )
  const rows = useMemo(
    () =>
      everyone
        .filter((row) =>
          slice === "DONE" ? row.done === row.total : row.done < row.total
        )
        .sort((a, b) =>
          nameOf(people.data, a.employeeId).localeCompare(
            nameOf(people.data, b.employeeId)
          )
        ),
    [everyone, slice, people.data]
  )
  const has = useMemo(
    () => new Set(everyone.map((row) => row.employeeId)),
    [everyone]
  )
  const columns = useMemo(
    () => columnsFor((employeeId) => nameOf(people.data, employeeId)),
    [people.data]
  )
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: ChecklistProgress) => row.employeeId,
        // The card's own columns are drawn on a phone and never on a desk.
        state: { columnVisibility: { head: phone, lead: phone, foot: phone } },
      }),
      [rows, columns, phone]
    )
  )

  return (
    <PageContent>
      <PageHeader
        title={copy.title}
        actions={
          !phone &&
          canWrite && (
            <Button variant="primary" onClick={() => setStarting(true)}>
              {copy.start}
            </Button>
          )
        }
      />

      {/* On a phone the slice is the chip over the bottom bar and starting
          one is the round +. */}
      {phone ? (
        <>
          <DockChoice
            value={slice}
            onChange={(next) => setSlice(next as Slice)}
            options={[
              { value: "OPEN", label: "In progress", short: "In progress" },
              { value: "DONE", label: "Completed", short: "Completed" },
            ]}
          />
          {canWrite && (
            <Fab label={copy.start} onClick={() => setStarting(true)} />
          )}
        </>
      ) : (
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
          <span className="text-[0.9375rem] text-mute tabular-nums">
            {count(rows.length)} {rows.length === 1 ? "person" : "people"}
          </span>
        </Toolbar>
      )}

      <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {tasks.isPending ? (
          <LoadingState>Loading checklists…</LoadingState>
        ) : tasks.isError ? (
          <Problem error={tasks.error} />
        ) : rows.length === 0 ? (
          <EmptyState>
            {slice === "OPEN"
              ? `No ${copy.noun} in progress.`
              : `No ${copy.noun} has been completed yet.`}
          </EmptyState>
        ) : (
          <DataTable<ChecklistProgress>
            refresh={[tasks]}
            table={table}
            onRowClick={(row) => setOpenId(row.employeeId)}
            isSelected={(row) => row.employeeId === openId}
            cardsApart
            cardLead
            cardSort={false}
          />
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
      title={copy.start}
      footer={
        <div className="flex justify-end gap-2">
          <Button data-cancel variant="quiet" onClick={close}>
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
