import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { PickOne } from "@/components/ui/pick"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { EmptyState } from "@/components/ui/states"
import {
  checklistTemplates,
  orgKeys,
  retireChecklistTemplate,
  saveChecklistTemplate,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useCanWrite } from "@/lib/session"
import { OWNER_CHOICES, OWNER_LABEL } from "@/screens/people/checklist-owners"
import { FormSheet } from "@/screens/people/settings-parts"
import {
  CHECKLIST_KINDS,
  useSheetTarget,
} from "@/screens/people/settings-hooks"

type TaskRow = Awaited<ReturnType<typeof checklistTemplates>>[number]

const LISTS = [
  {
    kind: "ONBOARDING",
    title: "Onboarding tasks",
    empty:
      "No onboarding task yet. These are the tasks every hire gets, in order — New task adds the first.",
  },
  {
    kind: "SEPARATION",
    title: "Offboarding tasks",
    empty:
      "No offboarding task yet. These are the tasks every leaver gets, in order — New task adds the first.",
  },
]

/// Settings › Checklists: the tasks every hire (and every leaver) gets, in
/// order, with who does each. A change reaches the next checklist opened; the
/// ones already open keep what they were opened with.
export function ChecklistSettings() {
  const canWrite = useCanWrite()
  const sheet = useSheetTarget<TaskRow>()
  const list = useQuery({
    queryKey: orgKeys.checklistTemplates(),
    queryFn: ({ signal }) => checklistTemplates(signal),
  })

  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="Checklists"
        sub="The tasks every hire and every leaver gets, in order, and who does each."
        actions={
          canWrite && (
            <Button variant="primary" onClick={() => sheet.show(null)}>
              New task
            </Button>
          )
        }
      />
      {queryState(list, {
        loading: "Reading the checklists…",
        render: (rows) => (
          <>
            {LISTS.map((one) => {
              const mine = rows.filter((row) => row.kind === one.kind)
              return (
                <Card key={one.kind} className="mb-4">
                  <CardHeader>
                    <CardTitle>{one.title}</CardTitle>
                  </CardHeader>
                  <div className="px-4 pb-4">
                    {mine.length === 0 ? (
                      <EmptyState>{one.empty}</EmptyState>
                    ) : (
                      <MiniTable
                        head={[
                          { label: "#", align: "right" },
                          { label: "Task", align: "left" },
                          { label: "Who", align: "left" },
                          { label: "", align: "left" },
                        ]}
                      >
                        {mine.map((row) => (
                          <MiniRow key={row.id}>
                            <MiniCell align="right">{row.position}</MiniCell>
                            <MiniCell>
                              <button
                                type="button"
                                className="text-left hover:underline"
                                onClick={() => sheet.show(row)}
                              >
                                {row.label}
                              </button>
                            </MiniCell>
                            <MiniCell>
                              {OWNER_LABEL[row.owner] ?? row.owner}
                            </MiniCell>
                            <MiniCell>
                              {row.retired && (
                                <Pill tone="neutral">Retired</Pill>
                              )}
                            </MiniCell>
                          </MiniRow>
                        ))}
                      </MiniTable>
                    )}
                  </div>
                </Card>
              )
            })}
            <TaskSheet
              key={sheet.target.id}
              open={sheet.open}
              onClose={sheet.close}
              row={sheet.target.row}
            />
          </>
        ),
      })}
    </PageContent>
  )
}

function TaskSheet({
  open,
  onClose,
  row,
}: {
  open: boolean
  onClose: () => void
  row: TaskRow | null
}) {
  const client = useQueryClient()
  const [id, setId] = useState(row?.id ?? "")
  const [label, setLabel] = useState(row?.label ?? "")
  const [owner, setOwner] = useState<string | null>(row?.owner ?? null)
  const [kind, setKind] = useState<string | null>(row?.kind ?? "ONBOARDING")
  const [position, setPosition] = useState(row ? String(row.position) : "")
  const [reason, setReason] = useState("")
  const refresh = () =>
    client.invalidateQueries({ queryKey: orgKeys.checklistTemplates() })
  const save = useMutation({
    mutationFn: () =>
      saveChecklistTemplate({
        id: id.trim(),
        label: label.trim(),
        owner: owner ?? "",
        kind: kind ?? "",
        position: Number(position),
        reason: reason.trim(),
      }),
    onSuccess: () => {
      void refresh()
      onClose()
    },
  })
  const retire = useMutation({
    mutationFn: (one: string) => retireChecklistTemplate(one, reason.trim()),
    onSuccess: () => {
      void refresh()
      onClose()
    },
  })

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={row ? row.label : "New task"}
      id={row?.id}
      error={save.error ?? retire.error}
      saveLabel="Submit"
      saving={save.isPending}
      canSave={
        id.trim() !== "" &&
        label.trim() !== "" &&
        owner !== null &&
        kind !== null &&
        Number(position) >= 1 &&
        reason.trim() !== ""
      }
      onSave={() => save.mutate()}
      danger={
        row && !row.retired
          ? {
              label: "Retire",
              pending: retire.isPending,
              disabled: reason.trim() === "",
              onClick: () => retire.mutate(row.id),
            }
          : null
      }
    >
      <Field label="Id" required>
        <Input
          value={id}
          readOnly={row !== null}
          onChange={(e) => setId(e.target.value.toLowerCase())}
        />
      </Field>
      <Field label="Task" required>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <Field label="Who does it" required>
        <PickOne
          label="Who does it"
          choices={OWNER_CHOICES}
          value={owner}
          onChange={setOwner}
        />
      </Field>
      <Field label="Checklist" required>
        <PickOne
          label="Checklist"
          choices={CHECKLIST_KINDS}
          value={kind}
          onChange={setKind}
        />
      </Field>
      <Field label="Order" aside="1–99" required>
        <Input
          inputMode="numeric"
          value={position}
          onChange={(e) => setPosition(e.target.value.replace(/\D/g, ""))}
        />
      </Field>
      <Field label="Why" required hint="Also asked for when retiring.">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </FormSheet>
  )
}
