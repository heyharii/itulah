import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox, Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { EmptyState, Problem } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { label } from "@/lib/format"
import {
  financeKeys,
  listTaxTypeSettings,
  saveTaxTemplate,
  saveTaxType,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { Grid, Td, Th } from "@/screens/finance-final/parts"
import { useLocations } from "@/screens/finance/hooks"
import { useTaxTemplates } from "@/screens/finance/master-data"
import {
  EditorCard,
  LinkAccountsButton,
  MasterLayout,
  YesNo,
} from "@/screens/finance/master-parts"
import type { TaxTemplate, TaxType } from "@itulah/contract"

/// Basis points as a rate: 200 → "2.00%".
function rateOf(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`
}

/// A percentage typed by a person, to basis points: "2", "2.5", "2,5".
function bpsOf(text: string): number | null {
  const cleaned = text.trim().replace(",", ".")
  if (cleaned === "") return null
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value < 0 || value > 100) return null
  return Math.round(value * 100)
}

// ---------------------------------------------------------------------------
// Tax Withholding Category
// ---------------------------------------------------------------------------

/// What a supplier payment keeps back, and at what rate (ERPNext Tax
/// Withholding Category). The amount kept back is owed to the tax office on
/// an account link — role `withholding_payable`, source the template.
export function TaxWithholding() {
  const list = useTaxTemplates()
  const [editing, setEditing] = useState<TaxTemplate | "new" | null>(null)

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Tax Masters"
        title="Tax Withholding Category"
        actions={
          <Button variant="primary" onClick={() => setEditing("new")}>
            New category
          </Button>
        }
      />
      <MasterLayout
        list={
          <Card className="overflow-hidden">
            {queryState(list, {
              loading: "Reading the withholding categories…",
              render: (rows) =>
                rows.length === 0 ? (
                  <EmptyState>
                    No withholding category yet. A payment that should keep tax
                    back has nothing to keep it under.
                  </EmptyState>
                ) : (
                  <Grid>
                    <thead>
                      <tr>
                        <Th>Name</Th>
                        <Th>Code</Th>
                        <Th align="right">Rate</Th>
                        <Th align="center">Final</Th>
                        <Th />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr
                          key={row.code}
                          onClick={() => setEditing(row)}
                          className="cursor-pointer hover:bg-soft"
                        >
                          <Td>
                            <span className="text-ink">{row.name}</span>
                            {!row.is_active && (
                              <Pill tone="neutral" className="ml-2">
                                Inactive
                              </Pill>
                            )}
                            {row.note && (
                              <div className="text-mute">{row.note}</div>
                            )}
                          </Td>
                          <Td className="font-mono text-[0.875rem] text-mute">
                            {row.code}
                          </Td>
                          <Td align="right">{rateOf(row.rate_bps)}</Td>
                          <Td align="center">
                            <YesNo on={row.is_final} />
                          </Td>
                          <Td align="right">
                            <LinkAccountsButton
                              role="withholding_payable"
                              sourceType="TAX_TEMPLATE"
                              sourceId={row.code}
                            />
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Grid>
                ),
            })}
          </Card>
        }
        editor={
          editing !== null && (
            <TemplateForm
              key={editing === "new" ? "new" : editing.code}
              template={editing === "new" ? null : editing}
              onDone={() => setEditing(null)}
            />
          )
        }
      />
    </PageContent>
  )
}

function TemplateForm({
  template,
  onDone,
}: {
  template: TaxTemplate | null
  onDone: () => void
}) {
  const client = useQueryClient()
  const [code, setCode] = useState(template?.code ?? "")
  const [name, setName] = useState(template?.name ?? "")
  const [rate, setRate] = useState(
    template === null ? "" : String(template.rate_bps / 100)
  )
  const [final, setFinal] = useState(template?.is_final ?? false)
  const [active, setActive] = useState(template?.is_active ?? true)
  const [note, setNote] = useState(template?.note ?? "")

  const bps = bpsOf(rate)

  const save = useMutation({
    mutationFn: () =>
      saveTaxTemplate({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        rate_bps: bps ?? 0,
        is_final: final,
        is_active: active,
        note: note.trim() === "" ? null : note.trim(),
      }),
    onSuccess: (rows) => {
      client.setQueryData(financeKeys.taxTemplates(), rows)
      onDone()
    },
  })

  return (
    <EditorCard
      title={
        template === null ? "New withholding category" : `Edit ${template.code}`
      }
      onClose={onDone}
    >
      <Problem error={save.error} />
      <Field
        label="Code"
        required
        aside={template === null ? "Never changes" : undefined}
      >
        <Input
          value={code}
          disabled={template !== null}
          onChange={(event) => setCode(event.target.value)}
        />
      </Field>
      <Field label="Name" required>
        <Input value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field
        label="Rate"
        required
        aside="%"
        problem={
          rate.trim() !== "" && bps === null
            ? "A percentage between 0 and 100."
            : undefined
        }
      >
        <Input
          value={rate}
          inputMode="decimal"
          onChange={(event) => setRate(event.target.value)}
        />
      </Field>
      <Checkbox
        label="Final"
        hint="A final tax settles the supplier's liability; nothing is credited against it later."
        checked={final}
        onChange={setFinal}
      />
      <Checkbox label="Active" checked={active} onChange={setActive} />
      <Field label="Note">
        <Input value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      <div className="flex items-center justify-end gap-2">
        {template !== null && (
          <LinkAccountsButton
            role="withholding_payable"
            sourceType="TAX_TEMPLATE"
            sourceId={template.code}
          />
        )}
        <Button
          variant="primary"
          pending={save.isPending}
          disabled={code.trim() === "" || name.trim() === "" || bps === null}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Submitting…" : "Submit"}
        </Button>
      </div>
    </EditorCard>
  )
}

// ---------------------------------------------------------------------------
// Tax types
// ---------------------------------------------------------------------------

/// The taxes the company owes or claims per period — PPh 21, 23, 25, 29, PPN,
/// PBB — each named by the role its account answers to. Adding one used to
/// take a migration.
export function TaxTypes() {
  const list = useQuery({
    queryKey: financeKeys.taxTypes(),
    queryFn: ({ signal }) => listTaxTypeSettings(signal),
  })
  const [editing, setEditing] = useState<TaxType | "new" | null>(null)

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Tax Masters"
        title="Tax Types"
        actions={
          <Button variant="primary" onClick={() => setEditing("new")}>
            New tax type
          </Button>
        }
      />
      <MasterLayout
        list={
          <Card className="overflow-hidden">
            {queryState(list, {
              loading: "Reading the tax types…",
              render: (rows) =>
                rows.length === 0 ? (
                  <EmptyState>No tax type yet.</EmptyState>
                ) : (
                  <Grid>
                    <thead>
                      <tr>
                        <Th>Name</Th>
                        <Th>Code</Th>
                        <Th>Nature</Th>
                        <Th>Role</Th>
                        <Th>Authority</Th>
                        <Th />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr
                          key={row.code}
                          onClick={() => setEditing(row)}
                          className="cursor-pointer hover:bg-soft"
                        >
                          <Td>
                            <span className="text-ink">{row.name}</span>
                            {!row.active && (
                              <Pill tone="neutral" className="ml-2">
                                Inactive
                              </Pill>
                            )}
                          </Td>
                          <Td className="font-mono text-[0.875rem] text-mute">
                            {row.code}
                          </Td>
                          <Td>{label(row.nature)}</Td>
                          <Td>
                            <Tag>{row.semantic_key}</Tag>
                          </Td>
                          <Td>{row.authority}</Td>
                          <Td align="right">
                            <LinkAccountsButton
                              role={row.semantic_key}
                              sourceType="COMPANY"
                              sourceId=""
                            />
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Grid>
                ),
            })}
          </Card>
        }
        editor={
          editing !== null && (
            <TaxTypeForm
              key={editing === "new" ? "new" : editing.code}
              tax={editing === "new" ? null : editing}
              onDone={() => setEditing(null)}
            />
          )
        }
      />
    </PageContent>
  )
}

function TaxTypeForm({
  tax,
  onDone,
}: {
  tax: TaxType | null
  onDone: () => void
}) {
  const client = useQueryClient()
  const roles = useLocations()
  const [code, setCode] = useState(tax?.code ?? "")
  const [name, setName] = useState(tax?.name ?? "")
  const [nature, setNature] = useState(tax?.nature ?? "PAYABLE")
  const [role, setRole] = useState(tax?.semantic_key ?? "")
  const [authority, setAuthority] = useState(tax?.authority ?? "DJP")
  const [active, setActive] = useState(tax?.active ?? true)
  const [note, setNote] = useState(tax?.note ?? "")

  const save = useMutation({
    mutationFn: () =>
      saveTaxType({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        nature,
        semantic_key: role.trim(),
        authority: authority.trim() === "" ? "DJP" : authority.trim(),
        active,
        note: note.trim() === "" ? null : note.trim(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: financeKeys.taxTypes() })
      onDone()
    },
  })

  return (
    <EditorCard
      title={tax === null ? "New tax type" : `Edit ${tax.code}`}
      onClose={onDone}
    >
      <Problem error={save.error} />
      <Field
        label="Code"
        required
        aside={tax === null ? "Never changes" : undefined}
      >
        <Input
          value={code}
          disabled={tax !== null}
          onChange={(event) => setCode(event.target.value)}
        />
      </Field>
      <Field label="Name" required>
        <Input value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label="Nature">
        <Select value={nature} onChange={setNature}>
          <option value="PAYABLE">Payable — owed to the tax office</option>
          <option value="CREDIT">Credit — claimed against one</option>
        </Select>
      </Field>
      <Field
        label="Role"
        required
        hint="The posting role its account answers to on Account links."
      >
        <Input
          value={role}
          onChange={(event) => setRole(event.target.value)}
          list="tax-type-roles"
        />
        <datalist id="tax-type-roles">
          {(roles.data?.roles ?? []).map((one) => (
            <option key={one.key} value={one.key}>
              {one.label}
            </option>
          ))}
        </datalist>
      </Field>
      <Field label="Authority">
        <Input
          value={authority}
          onChange={(event) => setAuthority(event.target.value)}
        />
      </Field>
      <Checkbox label="Active" checked={active} onChange={setActive} />
      <Field label="Note">
        <Input value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      <div className="flex items-center justify-end gap-2">
        {tax !== null && (
          <LinkAccountsButton
            role={tax.semantic_key}
            sourceType="COMPANY"
            sourceId=""
          />
        )}
        <Button
          variant="primary"
          pending={save.isPending}
          disabled={
            code.trim() === "" || name.trim() === "" || role.trim() === ""
          }
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Submitting…" : "Submit"}
        </Button>
      </div>
    </EditorCard>
  )
}
