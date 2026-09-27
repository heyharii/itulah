import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox, Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState, Problem } from "@/components/ui/states"
import { count, label } from "@/lib/format"
import { financeKeys, saveAssetClass } from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { Code, Grid, Td, Th } from "@/screens/finance-final/parts"
import { useAssetClasses } from "@/screens/finance/hooks"
import {
  EditorCard,
  LinkAccountsButton,
  MasterLayout,
} from "@/screens/finance/master-parts"
import type { AssetClass } from "@itulah/contract"

/// The classes an asset is filed under (ERPNext Asset Category).
///
/// A class carries three answers: its kind (what the books call it), its build
/// (which form GA fills in for one), and the life and method an assessment
/// starts from. Its accounts are account links the class code narrows — cost,
/// accumulated depreciation, the charge — so "Link accounts" opens the cost
/// role with the class as its qualifier, and the others are beside it there.
const KINDS = ["PPE", "OE", "INTANGIBLE", "DEFERRED"] as const
const BUILDS = [
  "LAND",
  "BUILDING",
  "TECH",
  "VEHICLE",
  "FFE",
  "IT",
  "AUDIO",
  "OE",
  "SOFTWARE",
  "DEFERRED",
  "CIP",
] as const
const METHODS = ["STRAIGHT_LINE", "DECLINING", "NONE"] as const

/// The cost role a class's links answer first; the charge and the contra sit
/// beside it on Account links. A deferred cost (pre-opening) is amortised like
/// an intangible, so it answers to the same three roles: intangible_asset,
/// accumulated_amortisation, amortisation_expense (domain/depreciation.rs).
function costRole(kind: string): string | null {
  if (kind === "INTANGIBLE" || kind === "DEFERRED") return "intangible_asset"
  if (kind === "PPE" || kind === "OE") return "fixed_asset"
  return null
}

function lifeWords(months: number | null): string {
  if (months === null) return "—"
  if (months % 12 === 0) return `${months / 12} yr`
  return `${months} mo`
}

export function AssetClasses() {
  const list = useAssetClasses()
  const [editing, setEditing] = useState<AssetClass | "new" | null>(null)
  const [needle, setNeedle] = useState("")
  const [kind, setKind] = useState("")
  const [inactive, setInactive] = useState(false)

  const rows = useMemo(() => {
    const text = needle.trim().toLowerCase()
    return list.rows.filter(
      (row) =>
        (inactive || row.is_active) &&
        (kind === "" || row.kind === kind) &&
        (text === "" ||
          row.class_code.toLowerCase().includes(text) ||
          row.name.toLowerCase().includes(text) ||
          (row.legacy_code ?? "").includes(text))
    )
  }, [list.rows, needle, kind, inactive])

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Setup"
        title="Asset classes"
        sub="What an asset is filed under: its kind, the form it is registered on, and the life and method it starts from. The accounts are account links narrowed by the class."
        actions={
          <>
            <Input
              value={needle}
              onChange={(event) => setNeedle(event.target.value)}
              placeholder="Search"
              className="h-8 w-48"
            />
            <Button variant="primary" onClick={() => setEditing("new")}>
              New class
            </Button>
          </>
        }
      />

      <Toolbar>
        <Select value={kind} onChange={setKind} className="h-8 w-40">
          <option value="">Every kind</option>
          {KINDS.map((one) => (
            <option key={one} value={one}>
              {one}
            </option>
          ))}
        </Select>
        <Checkbox
          label="Show inactive"
          checked={inactive}
          onChange={setInactive}
        />
        <Toolbar.Spacer />
        <span className="text-[0.875rem] text-mute">
          {count(rows.length)} classes
        </span>
      </Toolbar>

      <MasterLayout
        list={
          <Card className="overflow-hidden">
            {queryState(list, {
              loading: "Reading the asset classes…",
              render: () =>
                rows.length === 0 ? (
                  <EmptyState>No class matches the search.</EmptyState>
                ) : (
                  <Grid>
                    <thead>
                      <tr>
                        <Th>Code</Th>
                        <Th>Name</Th>
                        <Th>Kind</Th>
                        <Th>Form</Th>
                        <Th align="right">Life</Th>
                        <Th>Method</Th>
                        <Th align="right">Assets</Th>
                        <Th />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr
                          key={row.class_code}
                          onClick={() => setEditing(row)}
                          className="cursor-pointer hover:bg-soft"
                        >
                          <Td>
                            <Code>{row.class_code}</Code>
                            {row.legacy_code !== null && (
                              <div className="font-mono text-faint">
                                {row.legacy_code}
                              </div>
                            )}
                          </Td>
                          <Td>
                            <span className="text-ink">{row.name}</span>
                            {!row.is_active && (
                              <Pill tone="neutral" className="ml-2">
                                Inactive
                              </Pill>
                            )}
                          </Td>
                          <Td>{row.kind}</Td>
                          <Td>{label(row.build)}</Td>
                          <Td align="right">
                            {lifeWords(row.default_useful_life_months)}
                          </Td>
                          <Td>
                            {row.default_method === null ? (
                              <span className="text-faint">—</span>
                            ) : (
                              label(row.default_method)
                            )}
                          </Td>
                          <Td align="right">
                            <span
                              className={
                                row.asset_count === 0 ? "text-faint" : ""
                              }
                            >
                              {count(row.asset_count)}
                            </span>
                          </Td>
                          <Td align="right">
                            <LinkAccountsButton
                              role={costRole(row.kind)}
                              sourceType="COMPANY"
                              sourceId={row.class_code}
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
            <ClassForm
              key={editing === "new" ? "new" : editing.class_code}
              assetClass={editing === "new" ? null : editing}
              onDone={() => setEditing(null)}
            />
          )
        }
      />
    </PageContent>
  )
}

function ClassForm({
  assetClass,
  onDone,
}: {
  assetClass: AssetClass | null
  onDone: () => void
}) {
  const client = useQueryClient()
  const [code, setCode] = useState(assetClass?.class_code ?? "")
  const [name, setName] = useState(assetClass?.name ?? "")
  const [kind, setKind] = useState(assetClass?.kind ?? "PPE")
  const [build, setBuild] = useState(assetClass?.build ?? "FFE")
  const [life, setLife] = useState(
    assetClass?.default_useful_life_months == null
      ? ""
      : String(assetClass.default_useful_life_months)
  )
  const [method, setMethod] = useState(assetClass?.default_method ?? "")
  const [active, setActive] = useState(assetClass?.is_active ?? true)

  const months = life.trim() === "" ? null : Number.parseInt(life, 10)
  const lifeValid = months === null || (Number.isInteger(months) && months > 0)

  const save = useMutation({
    mutationFn: () =>
      saveAssetClass({
        class_code: code.trim().toUpperCase(),
        name: name.trim(),
        kind,
        build,
        default_useful_life_months: months,
        default_method: method === "" ? null : method,
        is_active: active,
      }),
    onSuccess: (classes) => {
      client.setQueryData(financeKeys.assetClasses(), classes)
      onDone()
    },
  })

  return (
    <EditorCard
      title={
        assetClass === null
          ? "New asset class"
          : `Edit ${assetClass.class_code}`
      }
      onClose={onDone}
    >
      <Problem error={save.error} />
      <Field
        label="Code"
        required
        aside={assetClass === null ? "Never changes" : undefined}
      >
        <Input
          value={code}
          disabled={assetClass !== null}
          onChange={(event) => setCode(event.target.value)}
          placeholder="AIR_CONDITIONER"
        />
      </Field>
      <Field
        label="Name"
        required
        hint="The client's own name, never translated."
      >
        <Input value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Kind">
          <Select value={kind} onChange={setKind}>
            {KINDS.map((one) => (
              <option key={one} value={one}>
                {one}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Registered on">
          <Select value={build} onChange={setBuild}>
            {BUILDS.map((one) => (
              <option key={one} value={one}>
                {label(one)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Useful life"
          aside="Months"
          problem={lifeValid ? undefined : "A whole number of months."}
        >
          <Input
            value={life}
            inputMode="numeric"
            onChange={(event) => setLife(event.target.value.replace(/\D/g, ""))}
            placeholder="48"
          />
        </Field>
        <Field label="Method">
          <Select value={method} onChange={setMethod}>
            <option value="">Decided per asset</option>
            {METHODS.map((one) => (
              <option key={one} value={one}>
                {label(one)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Checkbox label="Active" checked={active} onChange={setActive} />
      <div className="flex items-center justify-end gap-2">
        {assetClass !== null && (
          <LinkAccountsButton
            role={costRole(assetClass.kind)}
            sourceType="COMPANY"
            sourceId={assetClass.class_code}
          />
        )}
        <Button
          variant="primary"
          pending={save.isPending}
          disabled={code.trim() === "" || name.trim() === "" || !lifeValid}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Saving…" : "Save class"}
        </Button>
      </div>
    </EditorCard>
  )
}
