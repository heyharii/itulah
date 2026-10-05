import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox, Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { EmptyState, Problem } from "@/components/ui/states"
import { count } from "@/lib/format"
import {
  financeKeys,
  saveDimension,
  saveDimensionValue,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { Code, Grid, Td, Th } from "@/screens/finance-final/parts"
import { useDimensions } from "@/screens/finance/master-data"
import {
  EditorCard,
  LinkAccountsButton,
  MasterLayout,
  YesNo,
} from "@/screens/finance/master-parts"
import type { AccountingDimension, DimensionValue } from "@itulah/contract"

/// The accounting dimensions a journal line can carry beside its unit —
/// division, cost center, project (ERPNext Accounting Dimension).
///
/// A dimension is a list of values and two switches: whether a profit-and-loss
/// line must name a value, and whether a balance-sheet line must. The switches
/// are refusals at posting, so turning one on is a decision about every
/// automatic flow that writes such a line — the Dimension results report shows
/// what the values are carrying before somebody makes it.
export function Dimensions() {
  const list = useDimensions()
  const [editing, setEditing] = useState<string | "new" | null>(null)

  const current =
    editing === null || editing === "new"
      ? null
      : ((list.data ?? []).find((one) => one.code === editing) ?? null)

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Setup"
        title="Accounting dimensions"
        sub="What a journal line can be cut by besides its unit, which values it takes, and where naming one is required."
        actions={
          <Button variant="primary" onClick={() => setEditing("new")}>
            New dimension
          </Button>
        }
      />
      <MasterLayout
        list={
          <Card className="overflow-hidden">
            {queryState(list, {
              loading: "Reading the dimensions…",
              render: (rows) =>
                rows.length === 0 ? (
                  <EmptyState>No accounting dimension yet.</EmptyState>
                ) : (
                  <Grid>
                    <thead>
                      <tr>
                        <Th>Code</Th>
                        <Th>Name</Th>
                        <Th align="center">Required on P&amp;L</Th>
                        <Th align="center">Required on balance sheet</Th>
                        <Th align="right">Values</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr
                          key={row.code}
                          onClick={() => setEditing(row.code)}
                          className="cursor-pointer hover:bg-soft"
                        >
                          <Td>
                            <Code>{row.code}</Code>
                          </Td>
                          <Td>
                            <span className="text-ink">{row.name}</span>
                            {!row.is_active && (
                              <Pill tone="neutral" className="ml-2">
                                Inactive
                              </Pill>
                            )}
                          </Td>
                          <Td align="center">
                            <YesNo on={row.mandatory_for_pl} yes="Required" />
                          </Td>
                          <Td align="center">
                            <YesNo on={row.mandatory_for_bs} yes="Required" />
                          </Td>
                          <Td align="right">
                            {count(
                              row.values.filter((value) => value.is_active)
                                .length
                            )}
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
          editing !== null &&
          (editing === "new" || current !== null) && (
            <DimensionForm
              key={editing}
              dimension={current}
              onDone={() => setEditing(null)}
            />
          )
        }
      />
    </PageContent>
  )
}

function DimensionForm({
  dimension,
  onDone,
}: {
  dimension: AccountingDimension | null
  onDone: () => void
}) {
  const client = useQueryClient()
  const [code, setCode] = useState(dimension?.code ?? "")
  const [name, setName] = useState(dimension?.name ?? "")
  const [pl, setPl] = useState(dimension?.mandatory_for_pl ?? false)
  const [bs, setBs] = useState(dimension?.mandatory_for_bs ?? false)
  const [active, setActive] = useState(dimension?.is_active ?? true)

  const save = useMutation({
    mutationFn: () =>
      saveDimension({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        mandatory_for_pl: pl,
        mandatory_for_bs: bs,
        is_active: active,
      }),
    onSuccess: (rows) => {
      client.setQueryData(financeKeys.dimensions(), rows)
      if (dimension === null) onDone()
    },
  })

  return (
    <EditorCard
      title={dimension === null ? "New dimension" : dimension.name}
      onClose={onDone}
    >
      <Problem error={save.error} />
      <Field
        label="Code"
        required
        aside={dimension === null ? "Never changes" : undefined}
      >
        <Input
          value={code}
          disabled={dimension !== null}
          onChange={(event) => setCode(event.target.value)}
        />
      </Field>
      <Field label="Name" required>
        <Input value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Checkbox
        label="Required on profit-and-loss lines"
        hint="A line on an income or expense account without a value is refused."
        checked={pl}
        onChange={setPl}
      />
      <Checkbox
        label="Required on balance-sheet lines"
        checked={bs}
        onChange={setBs}
      />
      <Checkbox label="Active" checked={active} onChange={setActive} />
      <div className="flex justify-end">
        <Button
          variant="primary"
          pending={save.isPending}
          disabled={code.trim() === "" || name.trim() === ""}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Submitting…" : "Submit"}
        </Button>
      </div>

      {dimension !== null && <Values dimension={dimension} />}
    </EditorCard>
  )
}

/// A dimension's values: add one, retire one, bring one back. A division's
/// values are also account-link sources, so they carry "Link accounts".
function Values({ dimension }: { dimension: AccountingDimension }) {
  const client = useQueryClient()
  const [code, setCode] = useState("")
  const [name, setName] = useState("")

  const save = useMutation({
    mutationFn: (value: DimensionValue) =>
      saveDimensionValue(dimension.code, value),
    onSuccess: (rows) => {
      client.setQueryData(financeKeys.dimensions(), rows)
      setCode("")
      setName("")
    },
  })

  return (
    <div className="flex flex-col gap-2 border-t border-hairline pt-3">
      <h4 className="text-card-title font-semibold text-ink">Values</h4>
      <Problem error={save.error} />
      {dimension.values.length === 0 ? (
        <p className="text-[0.875rem] text-mute">No value yet.</p>
      ) : (
        <div className="flex flex-col divide-y divide-hairline">
          {dimension.values.map((value) => (
            <div
              key={value.value_code}
              className="flex items-center gap-2 py-1.5 text-[0.875rem]"
            >
              <Code>{value.value_code}</Code>
              <span
                className={
                  value.is_active
                    ? "min-w-0 flex-1 truncate text-ink"
                    : "min-w-0 flex-1 truncate text-faint line-through"
                }
              >
                {value.name}
              </span>
              {dimension.code === "DIVISION" && value.is_active && (
                <LinkAccountsButton
                  sourceType="DIVISION"
                  sourceId={value.value_code}
                  label="Links"
                />
              )}
              <Button
                size="sm"
                variant="quiet"
                pending={save.isPending}
                onClick={() =>
                  save.mutate({ ...value, is_active: !value.is_active })
                }
              >
                {value.is_active ? "Retire" : "Restore"}
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-[8rem_minmax(0,1fr)_auto] items-end gap-2">
        <Field label="Code" required>
          <Input
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </Field>
        <Field label="Name" required>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Button
          pending={save.isPending}
          disabled={code.trim() === "" || name.trim() === ""}
          onClick={() =>
            save.mutate({
              value_code: code.trim().toUpperCase(),
              name: name.trim(),
              is_active: true,
            })
          }
        >
          Add
        </Button>
      </div>
    </div>
  )
}
