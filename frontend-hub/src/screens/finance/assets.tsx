import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { count, day, money } from "@/lib/format"
import {
  assessAsset,
  financeKeys,
  listAssets,
  registerAsset,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import {
  ASSET_CATEGORIES,
  DEPRECIATION_METHODS,
  parseMinor,
  todayIso,
} from "@/screens/finance/chart"
import { LocationSelect, SiteName } from "@/screens/finance/parts"
import type { AssetRow } from "@itulah/contract"

/// What the business owns, and what Finance has decided about it.
///
/// # Why "not assessed" is a state and not a blank
///
/// Operations registers an asset's identity; Finance appends an assessment,
/// and the newest one is in force. An asset nobody has assessed is an open
/// control gap; one assessed and expensed is a closed one. A screen that drew
/// both as an empty cell would hide the first behind the second, which is
/// exactly the gap this register exists to surface.
///
/// # Why corrections are new assessments and never edits
///
/// "Expensed in January, capitalised in March" is the audit trail. Editing the
/// January decision would erase the fact that it was ever made.
///
/// # Why the monthly run is not on this screen
///
/// It was, as a button in this toolbar, and it was in the wrong place twice
/// over. Depreciation is a month-end step, not something you do while looking
/// at the register — and the button always charged the *current* calendar
/// month, whichever month the person was actually closing. It now lives in the
/// Period close checklist, against the month that checklist is for.

const columns: ColumnDef<TableSetup, AssetRow>[] = [
  {
    accessorKey: "asset_number",
    header: "Asset",
    size: 140,
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        {row.original.asset_number}
      </span>
    ),
  },
  {
    accessorKey: "name",
    header: "Name",
    size: 260,
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.name}</span>
    ),
  },
  {
    accessorKey: "category_name",
    header: "Category",
    size: 210,
  },
  {
    accessorKey: "site_id",
    header: "Location",
    size: 130,
    // The client's own name for it. The id stays in `title`, because that is
    // what the account codes carry and what a support call will be about.
    cell: ({ row }) => <SiteName id={row.original.site_id} />,
  },
  {
    id: "treatment",
    // Sorted first and ascending on purpose: an empty decision sorts before
    // both real ones, so the first screenful is the control gap.
    accessorFn: (row) => row.decision ?? "",
    header: "Treatment",
    size: 150,
    cell: ({ row }) =>
      row.original.decision === null ? (
        <Pill tone="warn">Not assessed</Pill>
      ) : row.original.decision === "CAPITALIZE" ? (
        <Pill tone="ok">Capitalised</Pill>
      ) : (
        <Pill tone="neutral">Expensed</Pill>
      ),
  },
  {
    accessorKey: "capitalized_cost_minor",
    header: "Cost",
    size: 150,
    meta: { align: "right" },
    cell: ({ row }) =>
      row.original.capitalized_cost_minor === null ? (
        <span className="text-faint">—</span>
      ) : (
        money(row.original.capitalized_cost_minor)
      ),
  },
  {
    accessorKey: "accumulated_minor",
    header: "Accumulated",
    size: 150,
    meta: { align: "right" },
    // Summed from the depreciation entries on every read; not stored anywhere.
    cell: ({ row }) =>
      row.original.accumulated_minor === 0 ? (
        <span className="text-faint">—</span>
      ) : (
        money(row.original.accumulated_minor)
      ),
  },
  {
    accessorKey: "book_value_minor",
    header: "Book value",
    size: 160,
    meta: { align: "right" },
    cell: ({ row }) =>
      row.original.book_value_minor === null ? (
        <span className="text-faint">—</span>
      ) : (
        <span className="font-medium text-ink tabular-nums">
          {money(row.original.book_value_minor)}
        </span>
      ),
  },
]

export function AssetRegister() {
  const [query, setQuery] = useState("")
  const [registering, setRegistering] = useState(false)
  const asset = useSheet("asset")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "treatment", desc: false },
  ])

  // The whole register, once. `?unassessed=true` used to back a second tab
  // here, and asking the server for a subset of a list already in memory is a
  // second loading state and a second cache entry for a filter the sort below
  // already applies — the not-assessed rows are at the top of this list by
  // construction. The overview still asks for it directly, where the count is
  // all it wants and the list is not on screen.
  const assets = useQuery({
    queryKey: financeKeys.assets(false),
    queryFn: ({ signal }) => listAssets({}, signal),
  })

  const rows = useMemo(() => assets.data ?? [], [assets.data])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: AssetRow) => row.asset_id,
        state: { globalFilter: query, sorting },
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
      }),
      [rows, query, sorting]
    )
  )

  const gap = rows.filter((row) => row.decision === null).length

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Asset register"
        sub="Operations records what we own; Finance decides how it is treated."
        actions={
          <>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="h-8 w-48"
            />
            <Button variant="dark" onClick={() => setRegistering(true)}>
              Register asset
            </Button>
          </>
        }
      />

      {/* The control gap, stated once and only when there is one. It used to be
          a second tab; a tab that is empty most days is a tab that gets clicked
          most days for nothing, and the rows it would have held are already the
          first ones on this list. Counted from the list on screen, which is the
          whole register — not from a second request. */}
      {gap > 0 && (
        <Banner tone="warn" className="mb-3">
          {count(gap)} assets have never been assessed — nobody has decided
          whether to capitalise or expense them. They sort to the top.
        </Banner>
      )}

      <Card className="overflow-hidden">
        {queryState(assets, {
          loading: "Loading the register…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>Nothing has been registered yet.</EmptyState>
            ) : (
              <DataTable<AssetRow>
                table={table}
                onRowClick={(row) => asset.open(row.asset_id)}
                isSelected={(row) => row.asset_id === asset.value}
                empty="No asset matches that search."
                className="max-h-[calc(100vh-20rem)]"
              />
            ),
        })}
      </Card>

      <AssetSheet id={asset.value ?? null} onClose={asset.close} />
      <RegisterSheet open={registering} onClose={() => setRegistering(false)} />
    </PageContent>
  )
}

/// An assessment as it is typed. The basis is text until it is submitted —
/// a half-typed number is not a number.
interface AssessmentDraft {
  decision: string
  cost: string
  salvage: string
  life: string
  method: string
  inService: string
  reason: string
}

/// The reason is required on both decisions; the basis only on a capitalisation.
function assessmentReady(draft: AssessmentDraft): boolean {
  const costMinor = parseMinor(draft.cost)
  const salvageMinor = parseMinor(draft.salvage)
  const lifeMonths = parseMinor(draft.life)
  return (
    draft.reason.trim() !== "" &&
    (draft.decision !== "CAPITALIZE" ||
      (costMinor !== null &&
        costMinor > 0 &&
        salvageMinor !== null &&
        lifeMonths !== null &&
        lifeMonths > 0))
  )
}

/// One asset, and Finance's decision about it.
function AssetSheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const client = useQueryClient()
  // What the request answered, not what was typed into it.
  const [saved, setSaved] = useState(false)

  // The same key the register reads, so opening a row costs nothing.
  const assets = useQuery({
    queryKey: financeKeys.assets(false),
    queryFn: ({ signal }) => listAssets({}, signal),
    enabled: id !== null,
  })

  const asset = assets.data?.find((row) => row.asset_id === id)

  const assess = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: (draft: AssessmentDraft) => {
      const capitalising = draft.decision === "CAPITALIZE"
      return assessAsset(id!, {
        decision: draft.decision,
        // An expensed asset carries no basis at all: the five fields below are
        // what a capitalised one depreciates against, and sending them for an
        // expense would imply a schedule that will never run.
        capitalized_cost_minor: capitalising ? parseMinor(draft.cost) : null,
        salvage_value_minor: capitalising ? parseMinor(draft.salvage) : null,
        useful_life_months: capitalising ? parseMinor(draft.life) : null,
        method: capitalising ? draft.method : null,
        in_service_on: capitalising ? draft.inService : null,
        reason: draft.reason.trim(),
      })
    },
    onSuccess: () => {
      setSaved(true)
      // Only the reason is cleared: a correction to the same asset is a second
      // assessment against the same basis, and re-typing it would invite a typo.
      form.setFieldValue("reason", "")
      // An assessment can capitalise an asset, which changes what the next
      // depreciation run charges and what the books will hold — the whole
      // namespace is the honest answer.
      client.invalidateQueries({ queryKey: financeKeys.all })
    },
  })

  const form = useForm({
    defaultValues: {
      decision: "CAPITALIZE",
      cost: "",
      salvage: "0",
      life: "60",
      method: "STRAIGHT_LINE",
      inService: todayIso(),
      reason: "",
    } as AssessmentDraft,
    onSubmit: ({ value }) => assess.mutate(value),
  })

  return (
    <Sheet
      open={id !== null}
      subject={id === null ? undefined : { kind: "asset", id }}
      onOpenChange={(next) => {
        if (!next) {
          setSaved(false)
          onClose()
        }
      }}
      id={asset?.asset_number}
      title={asset?.name ?? "Asset"}
      footer={
        asset ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-[0.71875rem] text-mute">
              The reason is required on both decisions.
            </span>
            <form.Subscribe selector={(state) => assessmentReady(state.values)}>
              {(ready) => (
                <Button
                  variant="dark"
                  disabled={!ready || assess.isPending}
                  onClick={() => form.handleSubmit()}
                >
                  {assess.isPending ? "Saving…" : "Record assessment"}
                </Button>
              )}
            </form.Subscribe>
          </div>
        ) : undefined
      }
    >
      {queryState(assets, {
        loading: "Loading the asset…",
        render: () =>
          asset === undefined ? (
            <EmptyState>No asset on this list has that id.</EmptyState>
          ) : (
            <div className="flex flex-col gap-5">
              {saved && (
                <Banner tone="ok" onDismiss={() => setSaved(false)}>
                  Assessment recorded. The earlier one stays on the record — a
                  correction is a new assessment, never an edit.
                </Banner>
              )}
              {assess.isError && (
                <Banner tone="bad">
                  {assess.error instanceof Error
                    ? assess.error.message
                    : "The assessment was refused."}
                </Banner>
              )}

              <div>
                {asset.decision === null ? (
                  <Pill tone="warn">Not assessed</Pill>
                ) : asset.decision === "CAPITALIZE" ? (
                  <Pill tone="ok">Capitalised</Pill>
                ) : (
                  <Pill tone="neutral">Expensed</Pill>
                )}
              </div>

              <Facts>
                <Fact term="Category">{asset.category_name}</Fact>
                <Fact term="Category code">{asset.category_code}</Fact>
                <Fact term="Location">
                  <SiteName id={asset.site_id} />
                </Fact>
                <Fact term="Status">{asset.status}</Fact>
                <Fact term="Acquired">{day(asset.acquired_on)}</Fact>
                <Fact term="Serial">{asset.serial_number ?? "—"}</Fact>
                <Fact term="In service">{day(asset.in_service_on)}</Fact>
                <Fact term="Method">{asset.method ?? "—"}</Fact>
                <Fact term="Cost">{money(asset.capitalized_cost_minor)}</Fact>
                <Fact term="Accumulated">{money(asset.accumulated_minor)}</Fact>
                <Fact term="Book value">{money(asset.book_value_minor)}</Fact>
                <Fact term="Useful life">
                  {asset.useful_life_months === null
                    ? "—"
                    : `${count(asset.useful_life_months)} months`}
                </Fact>
              </Facts>

              <form
                // The button is in the sheet's footer, outside this element, so
                // its disabled state cannot block an Enter keypress. On an
                // expensed asset this form is a select and a textarea and
                // nothing else, which is exactly the shape a browser submits
                // implicitly — so the gate is repeated here.
                onSubmit={(event) => {
                  event.preventDefault()
                  if (assessmentReady(form.state.values) && !assess.isPending) {
                    form.handleSubmit()
                  }
                }}
                className="flex flex-col gap-3"
              >
                <h4 className="text-card-title font-semibold text-ink">
                  {asset.decision === null
                    ? "Assess this asset"
                    : "Record a new assessment"}
                </h4>

                <form.Field name="decision">
                  {(field) => (
                    <Field label="Decision">
                      <Select
                        value={field.state.value}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                      >
                        <option value="CAPITALIZE">Capitalise</option>
                        <option value="EXPENSE">Expense</option>
                      </Select>
                    </Field>
                  )}
                </form.Field>

                <form.Subscribe
                  selector={(state) => state.values.decision === "CAPITALIZE"}
                >
                  {(capitalising) =>
                    capitalising && (
                      <div className="grid grid-cols-2 gap-3">
                        <form.Field name="cost">
                          {(field) => (
                            <Field
                              label="Capitalised cost"
                              problem={
                                field.state.value.trim() !== "" &&
                                parseMinor(field.state.value) === null
                                  ? "Not a number."
                                  : undefined
                              }
                            >
                              <Input
                                inputMode="numeric"
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(event) =>
                                  field.handleChange(event.target.value)
                                }
                                placeholder="0"
                              />
                            </Field>
                          )}
                        </form.Field>
                        <form.Field name="salvage">
                          {(field) => (
                            <Field label="Salvage value">
                              <Input
                                inputMode="numeric"
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(event) =>
                                  field.handleChange(event.target.value)
                                }
                              />
                            </Field>
                          )}
                        </form.Field>
                        <form.Field name="life">
                          {(field) => (
                            <Field label="Useful life (months)">
                              <Input
                                inputMode="numeric"
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(event) =>
                                  field.handleChange(event.target.value)
                                }
                              />
                            </Field>
                          )}
                        </form.Field>
                        <form.Field name="method">
                          {(field) => (
                            <Field label="Method">
                              <Select
                                value={field.state.value}
                                onChange={(event) =>
                                  field.handleChange(event.target.value)
                                }
                              >
                                {DEPRECIATION_METHODS.map((option) => (
                                  <option
                                    key={option.value}
                                    value={option.value}
                                  >
                                    {option.label}
                                  </option>
                                ))}
                              </Select>
                            </Field>
                          )}
                        </form.Field>
                        <form.Field name="inService">
                          {(field) => (
                            <Field label="In service on" className="col-span-2">
                              <Input
                                type="date"
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(event) =>
                                  field.handleChange(event.target.value)
                                }
                              />
                            </Field>
                          )}
                        </form.Field>
                      </div>
                    )
                  }
                </form.Subscribe>

                <form.Field name="reason">
                  {(field) => (
                    <Field
                      label="Reason"
                      hint="An expensed asset with no reason is the one somebody queries a year later."
                    >
                      <Textarea
                        rows={2}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                      />
                    </Field>
                  )}
                </form.Field>
              </form>
            </div>
          ),
      })}
    </Sheet>
  )
}

interface RegistrationDraft {
  assetNumber: string
  name: string
  category: string
  siteId: string
  acquired: string
  serial: string
  notes: string
}

/// What identifies the thing. Everything else the register will default.
function registrationReady(draft: RegistrationDraft): boolean {
  return (
    draft.assetNumber.trim() !== "" &&
    draft.name.trim() !== "" &&
    draft.siteId.trim() !== ""
  )
}

/// Registering an asset's identity. Deliberately carries no money: what it is
/// worth and how it wears out are Finance's assessment, which comes after.
function RegisterSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  // What the request answered, not what was typed into it.
  const [receipt, setReceipt] = useState<string | null>(null)

  const register = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: (draft: RegistrationDraft) =>
      registerAsset({
        asset_number: draft.assetNumber.trim(),
        name: draft.name.trim(),
        category_code: draft.category,
        site_id: draft.siteId.trim(),
        acquired_on: draft.acquired,
        serial_number: draft.serial.trim() === "" ? null : draft.serial.trim(),
        notes: draft.notes.trim() === "" ? null : draft.notes.trim(),
      }),
    onSuccess: (saved) => {
      setReceipt(saved.asset_number)
      // Only what identifies this one asset is cleared: a delivery of twenty
      // identical shelves is twenty registrations at the same site, same
      // category, same day.
      form.setFieldValue("assetNumber", "")
      form.setFieldValue("name", "")
      form.setFieldValue("serial", "")
      form.setFieldValue("notes", "")
      // Registering posts nothing; only the register itself moved.
      client.invalidateQueries({ queryKey: financeKeys.assets(false) })
      client.invalidateQueries({ queryKey: financeKeys.assets(true) })
    },
  })

  const form = useForm({
    defaultValues: {
      assetNumber: "",
      name: "",
      category: ASSET_CATEGORIES[0].code,
      siteId: "",
      acquired: todayIso(),
      serial: "",
      notes: "",
    } as RegistrationDraft,
    onSubmit: ({ value }) => register.mutate(value),
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Register an asset"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-[0.71875rem] text-mute">
            No money here — Finance assesses it next.
          </span>
          <form.Subscribe selector={(state) => registrationReady(state.values)}>
            {(ready) => (
              <Button
                variant="dark"
                disabled={!ready || register.isPending}
                onClick={() => form.handleSubmit()}
              >
                {register.isPending ? "Registering…" : "Register"}
              </Button>
            )}
          </form.Subscribe>
        </div>
      }
    >
      <form
        // The button is in the sheet's footer, outside this element, so its
        // disabled state cannot block an Enter keypress.
        onSubmit={(event) => {
          event.preventDefault()
          if (registrationReady(form.state.values) && !register.isPending) {
            form.handleSubmit()
          }
        }}
        className="flex flex-col gap-3.5"
      >
        {receipt && (
          <Banner tone="ok" onDismiss={() => setReceipt(null)}>
            {receipt} is on the register, and shows as not assessed until
            Finance decides how to treat it.
          </Banner>
        )}
        {register.isError && (
          <Banner tone="bad">
            {register.error instanceof Error
              ? register.error.message
              : "The asset was refused."}
          </Banner>
        )}

        <div className="grid grid-cols-2 gap-3">
          <form.Field name="assetNumber">
            {(field) => (
              <Field label="Asset number">
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="siteId">
            {(field) => (
              <Field label="Location">
                {/* Where the thing physically is. A typed id put an asset at a
                    location that does not exist, which the register then
                    happily listed. */}
                <LocationSelect
                  value={field.state.value}
                  onChange={(next) => field.handleChange(next)}
                  emptyLabel="Choose a location"
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="name">
            {(field) => (
              <Field label="Name" className="col-span-2">
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="category">
            {(field) => (
              <Field label="Category" className="col-span-2">
                <Select
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                >
                  {ASSET_CATEGORIES.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.code} · {option.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </form.Field>
          <form.Field name="acquired">
            {(field) => (
              <Field label="Acquired on">
                <Input
                  type="date"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="serial">
            {(field) => (
              <Field label="Serial number" hint="Optional.">
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
        </div>

        <form.Field name="notes">
          {(field) => (
            <Field label="Notes" hint="Optional.">
              <Textarea
                rows={2}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>
      </form>
    </Sheet>
  )
}
