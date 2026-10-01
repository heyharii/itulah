import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { PickOne } from "@/components/ui/pick"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { EmptyState } from "@/components/ui/states"
import {
  departments,
  orgKeys,
  retireDepartment,
  saveDepartment,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useCanWrite } from "@/lib/session"
import { FormSheet, NameCell } from "@/screens/people/settings-parts"
import { useRetire, useSheetTarget } from "@/screens/people/settings-hooks"
import type { DepartmentView } from "@itulah/contract"

/// Settings › Departments: what somebody works in, across stores and head
/// office — Operasional, Keuangan, HR. Where each person sits is on their own
/// sheet (Position); the whole of it is the Org chart.
export function DepartmentSettings() {
  const canWrite = useCanWrite()
  const list = useQuery({
    queryKey: orgKeys.departments(),
    queryFn: ({ signal }) => departments(signal),
  })
  const sheet = useSheetTarget<DepartmentView>()

  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="Departments"
        sub="What somebody works in, across stores and head office."
        actions={
          canWrite && (
            <Button variant="primary" onClick={() => sheet.show(null)}>
              New department
            </Button>
          )
        }
      />
      <Card className="px-4 py-3">
        {queryState(list, {
          loading: "Reading the departments…",
          render: (rows) => {
            const named = new Map(rows.map((row) => [row.code, row.name]))
            return (
              <>
                {rows.length === 0 ? (
                  <EmptyState>
                    No department yet. A department is what somebody works in,
                    across stores and head office — Operasional, Keuangan, HR.
                    New department adds the first.
                  </EmptyState>
                ) : (
                  <MiniTable
                    head={[
                      { label: "Department", align: "left" },
                      { label: "Inside", align: "left" },
                      { label: "People", align: "right" },
                      { label: "", align: "left" },
                    ]}
                  >
                    {rows.map((row) => (
                      <MiniRow key={row.code}>
                        <MiniCell>
                          <NameCell
                            name={row.name}
                            code={row.code}
                            onOpen={() => sheet.show(row)}
                          />
                        </MiniCell>
                        <MiniCell>
                          {row.parent_code === null
                            ? "—"
                            : (named.get(row.parent_code) ?? row.parent_code)}
                        </MiniCell>
                        <MiniCell align="right">{row.members}</MiniCell>
                        <MiniCell>
                          {row.retired && <Pill tone="neutral">Retired</Pill>}
                        </MiniCell>
                      </MiniRow>
                    ))}
                  </MiniTable>
                )}
                <DepartmentSheet
                  key={sheet.target.id}
                  open={sheet.open}
                  onClose={sheet.close}
                  row={sheet.target.row}
                  all={rows}
                />
              </>
            )
          },
        })}
      </Card>
    </PageContent>
  )
}

function DepartmentSheet({
  open,
  onClose,
  row,
  all,
}: {
  open: boolean
  onClose: () => void
  row: DepartmentView | null
  all: readonly DepartmentView[]
}) {
  const client = useQueryClient()
  const [code, setCode] = useState(row?.code ?? "")
  const [name, setName] = useState(row?.name ?? "")
  const [parent, setParent] = useState<string | null>(row?.parent_code ?? null)
  const [reason, setReason] = useState("")
  const save = useMutation({
    mutationFn: () =>
      saveDepartment({
        code: code.trim(),
        name: name.trim(),
        parent_code: parent,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: orgKeys.departments() })
      void client.invalidateQueries({ queryKey: orgKeys.chart() })
      onClose()
    },
  })
  const retire = useRetire(retireDepartment, orgKeys.departments())

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={row ? row.name : "New department"}
      id={row?.code}
      error={save.error ?? retire.error}
      saveLabel="Save department"
      saving={save.isPending}
      canSave={code.trim() !== "" && name.trim() !== "" && reason.trim() !== ""}
      onSave={() => save.mutate()}
      danger={
        row && !row.retired
          ? {
              label: "Retire",
              pending: retire.isPending,
              disabled: reason.trim() === "",
              onClick: () =>
                retire.mutate(
                  { code: row.code, reason: reason.trim() },
                  { onSuccess: onClose }
                ),
            }
          : null
      }
    >
      <Field label="Code" required>
        <Input
          value={code}
          readOnly={row !== null}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="OPS"
        />
      </Field>
      <Field label="Name" required>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Operasional"
        />
      </Field>
      <Field label="Inside">
        <PickOne
          label="Inside"
          placeholder="Top level"
          choices={all
            .filter((one) => !one.retired && one.code !== code)
            .map((one) => ({ value: one.code, label: one.name }))}
          value={parent}
          onChange={setParent}
        />
      </Field>
      <Field label="Why" required hint="Also asked for when retiring.">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </FormSheet>
  )
}
