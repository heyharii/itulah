import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox, Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { PickOne } from "@/components/ui/pick"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { EmptyState } from "@/components/ui/states"
import {
  businessUnits,
  groupEntities,
  orgKeys,
  removeGroupEntity,
  saveBusinessUnit,
  saveGroupEntity,
  useReachableUnits,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useCanWrite } from "@/lib/session"
import { FormSheet, NameCell } from "@/screens/people/settings-parts"
import { RELATIONS, useSheetTarget } from "@/screens/people/settings-hooks"

type GroupRow = Awaited<ReturnType<typeof groupEntities>>[number]
type UnitRow = Awaited<ReturnType<typeof businessUnits>>[number]

/// Settings › Group & business units: the holding over this company and its
/// sister companies (records of who they are — this system keeps one
/// company's books), and the business units that read stores and head office
/// together by line of business.
export function GroupSettings() {
  const canWrite = useCanWrite()
  const group = useSheetTarget<GroupRow>()
  const unit = useSheetTarget<UnitRow>()

  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="Group & business units"
        sub="The companies around this one, and the lines of business its units belong to."
        actions={
          canWrite && (
            <>
              <Button variant="ghost" onClick={() => group.show(null)}>
                Add group company
              </Button>
              <Button variant="primary" onClick={() => unit.show(null)}>
                Add business unit
              </Button>
            </>
          )
        }
      />
      <GroupList sheet={group} />
      <BusinessUnitList sheet={unit} />
    </PageContent>
  )
}

function GroupList({
  sheet,
}: {
  sheet: ReturnType<typeof useSheetTarget<GroupRow>>
}) {
  const list = useQuery({
    queryKey: orgKeys.group(),
    queryFn: ({ signal }) => groupEntities(signal),
  })
  const label = new Map(RELATIONS.map((one) => [one.value, one.label]))
  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Group companies</CardTitle>
      </CardHeader>
      <div className="px-4 pb-4">
        {queryState(list, {
          loading: "Reading the group…",
          render: (rows) => (
            <>
              {rows.length === 0 ? (
                <EmptyState>
                  No group recorded. Add the holding over this company and its
                  sister companies, if it has any, with Add group company.
                </EmptyState>
              ) : (
                <MiniTable
                  head={[
                    { label: "Company", align: "left" },
                    { label: "Relation", align: "left" },
                    { label: "NPWP", align: "left" },
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
                        <Pill
                          tone={row.relation === "HOLDING" ? "info" : "neutral"}
                        >
                          {label.get(row.relation) ?? row.relation}
                        </Pill>
                      </MiniCell>
                      <MiniCell>{row.tax_id ?? "—"}</MiniCell>
                    </MiniRow>
                  ))}
                </MiniTable>
              )}
              <GroupSheet
                key={sheet.target.id}
                open={sheet.open}
                onClose={sheet.close}
                row={sheet.target.row}
              />
            </>
          ),
        })}
      </div>
    </Card>
  )
}

function GroupSheet({
  open,
  onClose,
  row,
}: {
  open: boolean
  onClose: () => void
  row: GroupRow | null
}) {
  const client = useQueryClient()
  const [code, setCode] = useState(row?.code ?? "")
  const [name, setName] = useState(row?.name ?? "")
  const [relation, setRelation] = useState<string | null>(row?.relation ?? null)
  const [taxId, setTaxId] = useState(row?.tax_id ?? "")
  const [reason, setReason] = useState("")
  const refresh = () => client.invalidateQueries({ queryKey: orgKeys.group() })
  const save = useMutation({
    mutationFn: () =>
      saveGroupEntity({
        code: code.trim(),
        name: name.trim(),
        relation: relation ?? "",
        tax_id: taxId.trim() === "" ? null : taxId.trim(),
        reason: reason.trim(),
      }),
    onSuccess: () => {
      void refresh()
      onClose()
    },
  })
  const remove = useMutation({
    mutationFn: (one: string) => removeGroupEntity(one),
    onSuccess: () => {
      void refresh()
      onClose()
    },
  })

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={row ? row.name : "Add group company"}
      id={row?.code}
      error={save.error ?? remove.error}
      saveLabel="Save group company"
      saving={save.isPending}
      canSave={
        code.trim() !== "" &&
        name.trim() !== "" &&
        relation !== null &&
        reason.trim() !== ""
      }
      onSave={() => save.mutate()}
      danger={
        row
          ? {
              label: "Remove",
              pending: remove.isPending,
              onClick: () => remove.mutate(row.code),
            }
          : null
      }
    >
      <Field label="Code" required>
        <Input
          value={code}
          readOnly={row !== null}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="INDUK"
        />
      </Field>
      <Field label="Name" required>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="PT Induk Usaha"
        />
      </Field>
      <Field label="Relation" required>
        <PickOne
          label="Relation"
          placeholder="Choose…"
          choices={RELATIONS}
          value={relation}
          onChange={setRelation}
        />
      </Field>
      <Field label="NPWP">
        <Input value={taxId} onChange={(e) => setTaxId(e.target.value)} />
      </Field>
      <Field label="Why" required>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </FormSheet>
  )
}

function BusinessUnitList({
  sheet,
}: {
  sheet: ReturnType<typeof useSheetTarget<UnitRow>>
}) {
  const list = useQuery({
    queryKey: orgKeys.businessUnits(),
    queryFn: ({ signal }) => businessUnits(signal),
  })
  const reachable = useReachableUnits()
  const unitName = new Map(
    (reachable.data ?? []).map((one) => [one.id, one.name])
  )
  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Business units</CardTitle>
      </CardHeader>
      <div className="px-4 pb-4">
        {queryState(list, {
          loading: "Reading the business units…",
          render: (rows) => (
            <>
              {rows.length === 0 ? (
                <EmptyState>
                  No business unit yet. A business unit groups stores and head
                  office by line of business, for reading them together. Add
                  business unit makes the first.
                </EmptyState>
              ) : (
                <MiniTable
                  head={[
                    { label: "Business unit", align: "left" },
                    { label: "Units", align: "left" },
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
                        {row.units.length === 0
                          ? "—"
                          : row.units
                              .map((one) => unitName.get(one) ?? one)
                              .join(", ")}
                      </MiniCell>
                    </MiniRow>
                  ))}
                </MiniTable>
              )}
              <BusinessUnitSheet
                key={sheet.target.id}
                open={sheet.open}
                onClose={sheet.close}
                row={sheet.target.row}
              />
            </>
          ),
        })}
      </div>
    </Card>
  )
}

function BusinessUnitSheet({
  open,
  onClose,
  row,
}: {
  open: boolean
  onClose: () => void
  row: UnitRow | null
}) {
  const client = useQueryClient()
  const reachable = useReachableUnits()
  const [code, setCode] = useState(row?.code ?? "")
  const [name, setName] = useState(row?.name ?? "")
  const [units, setUnits] = useState<readonly string[]>(row?.units ?? [])
  const [reason, setReason] = useState("")
  const save = useMutation({
    mutationFn: () =>
      saveBusinessUnit({
        code: code.trim(),
        name: name.trim(),
        units: [...units],
        reason: reason.trim(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: orgKeys.businessUnits() })
      onClose()
    },
  })

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={row ? row.name : "Add business unit"}
      id={row?.code}
      error={save.error}
      saveLabel="Save business unit"
      saving={save.isPending}
      canSave={code.trim() !== "" && name.trim() !== "" && reason.trim() !== ""}
      onSave={() => save.mutate()}
    >
      <Field label="Code" required>
        <Input
          value={code}
          readOnly={row !== null}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="RETAIL"
        />
      </Field>
      <Field label="Name" required>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Retail"
        />
      </Field>
      <Field
        label="Units"
        hint="A unit ticked here leaves whichever business unit it was in."
      >
        <div className="flex flex-col gap-2">
          {(reachable.data ?? []).map((one) => (
            <Checkbox
              key={one.id}
              label={one.name}
              checked={units.includes(one.id)}
              onChange={(on) =>
                setUnits(
                  on ? [...units, one.id] : units.filter((u) => u !== one.id)
                )
              }
            />
          ))}
        </div>
      </Field>
      <Field label="Why" required>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </FormSheet>
  )
}
