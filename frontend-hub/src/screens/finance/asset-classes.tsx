import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox, Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState, Problem } from "@/components/ui/states"
import { DockTools } from "@/components/shell/dock-tools"
import { Fab } from "@/components/ui/fab"
import { count, label } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { financeKeys, saveAssetClass } from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { Grid, Td, Th } from "@/screens/finance-final/parts"
import { useAssetClasses } from "@/screens/finance/hooks"
import { PhoneCard, PhoneList } from "@/components/ui/phone-cards"
import { FilterSheet } from "@/components/ui/filter-sheet"
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
  const phone = useLayout() === "phone"
  const [filtering, setFiltering] = useState(false)
  const list = useAssetClasses()
  const [editing, setEditing] = useState<AssetClass | "new" | null>(null)
  const [needle, setNeedle] = useState("")
  const [kind, setKind] = useState("")
  const [inactive, setInactive] = useState(false)

  const rows = useMemo(() => {
    const text = needle.trim().toLowerCase()
    return (
      list.rows
        .filter(
          (row) =>
            (inactive || row.is_active) &&
            (kind === "" || row.kind === kind) &&
            (text === "" ||
              row.class_code.toLowerCase().includes(text) ||
              row.name.toLowerCase().includes(text) ||
              (row.legacy_code ?? "").includes(text))
        )
        // The categories that hold assets first: most of the chart's families
        // have none yet, and the ones in use should not be found by scrolling.
        .sort(
          (a, b) =>
            b.asset_count - a.asset_count || a.name.localeCompare(b.name)
        )
    )
  }, [list.rows, needle, kind, inactive])

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Assets"
        title="Asset Category"
        // Search, the kind and the new class are in the dock on a phone.
        actions={
          phone ? undefined : (
            <>
              <Input
                value={needle}
                onChange={(event) => setNeedle(event.target.value)}
                className="h-control w-48"
              />
              <Button variant="primary" onClick={() => setEditing("new")}>
                New class
              </Button>
            </>
          )
        }
      />

      {phone ? (
        <>
          <Fab label="New class" onClick={() => setEditing("new")} />
          <DockTools
            search={{
              value: needle,
              onChange: setNeedle,
              label: "Search classes",
            }}
            filter={{
              count: inactive ? 1 : 0,
              onOpen: () => setFiltering(true),
            }}
            status={{
              value: kind,
              options: [
                { value: "", label: "All kinds" },
                ...KINDS.map((one) => ({ value: one, label: one })),
              ],
              onChange: setKind,
            }}
          />
          <FilterSheet open={filtering} onOpenChange={setFiltering}>
            <Checkbox
              label="Show inactive"
              checked={inactive}
              onChange={setInactive}
            />
          </FilterSheet>
        </>
      ) : (
        <Toolbar>
          <Select value={kind} onChange={setKind} className="h-control w-40">
            <option value="">All kinds</option>
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
      )}

      <MasterLayout
        list={
          <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
            {queryState(list, {
              loading: "Reading the asset classes…",
              render: () =>
                rows.length === 0 ? (
                  <EmptyState>No class matches the search.</EmptyState>
                ) : phone ? (
                  <PhoneList>
                    {rows.map((row) => (
                      <PhoneCard
                        key={row.class_code}
                        title={row.name}
                        muted={!row.is_active}
                        line={`${label(row.kind)} · ${label(row.build)}${row.is_active ? "" : " · inactive"}`}
                        lead={count(row.asset_count)}
                        caption={row.asset_count === 1 ? "asset" : "assets"}
                        tone={row.asset_count === 0 ? "quiet" : undefined}
                        foot={
                          row.default_method === null
                            ? "Not set"
                            : `${label(row.default_method)} · ${lifeWords(row.default_useful_life_months)}`
                        }
                        action={
                          <LinkAccountsButton
                            role={costRole(row.kind)}
                            sourceType="COMPANY"
                            sourceId={row.class_code}
                          />
                        }
                        onOpen={() => setEditing(row)}
                      />
                    ))}
                  </PhoneList>
                ) : (
                  <Grid>
                    <thead>
                      <tr>
                        <Th>Category</Th>
                        <Th>Depreciation</Th>
                        <Th align="right">Assets</Th>
                        <Th />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr
                          key={row.class_code}
                          onClick={() => setEditing(row)}
                          className="cursor-pointer"
                        >
                          {/* The code rides as the name's title: it is what
                              the chart links key on, not what anyone reads. */}
                          <Td>
                            <span className="text-ink" title={row.class_code}>
                              {row.name}
                            </span>
                            {!row.is_active && (
                              <span className="text-mute"> · inactive</span>
                            )}
                            {/* What it is, once: kind and form together, not
                                two columns of the same two words. */}
                            <span className="block text-[0.875rem] text-mute">
                              {label(row.kind)} · {label(row.build)}
                            </span>
                          </Td>
                          <Td>
                            {row.default_method === null ? (
                              <span className="text-mute">Not set</span>
                            ) : (
                              <>
                                {label(row.default_method)}
                                <span className="block text-[0.875rem] text-mute">
                                  {lifeWords(row.default_useful_life_months)}
                                </span>
                              </>
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
          {save.isPending ? "Submitting…" : "Submit"}
        </Button>
      </div>
    </EditorCard>
  )
}
