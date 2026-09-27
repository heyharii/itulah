import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { Plus, Wrench } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Choices, Section } from "@/components/ui/form"
import { Field, Input, Money, Select } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Sheet } from "@/components/ui/sheet"
import {
  Banner,
  EmptyState,
  LoadMore,
  type Pageable,
} from "@/components/ui/states"
import { count, money } from "@/lib/format"
import { procurementKeys, supplierPage } from "@/lib/queries/procurement"
import {
  gaContracts,
  gaKeys,
  gaRepairObjects,
  gaRepairs,
  gaAssets,
  recordGaRepair,
} from "@/lib/queries/ga"
import { financeKeys, listAssets } from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { RepairSheet } from "@/screens/maintenance/hub"
import { RepairStagePill } from "@/screens/maintenance/parts"
import { repairObjectTiles, repairOver } from "@/screens/maintenance/format"
import { FinanceMark } from "@/screens/contracts/parts"
import type { GaAssetRow, GaRepairRow, GaRepairSummary } from "@itulah/contract"

/// Perbaikan — the book of things that broke.
///
/// # What this screen is allowed to know about money
///
/// The estimate and the approved budget are GA's own facts: they are typed
/// here, by the person filing the job. The ACTUAL is nobody's to type — it
/// is read out of Finance's posted bills that point back at the repair, so
/// the column carries the Finance mark, and in tahap 4 it reads zero because
/// the bill line that could point does not exist yet. The red mark on a row
/// means the ledger has already answered, and answered high.
///
/// # One row per breakdown, not per visit
///
/// A repair is the problem ("AC cassette not cooling"), and the site is
/// required even when no single asset is — a leaking ceiling happens to a
/// building. That is what makes the cost readable per location later.
/// How many repairs one page of the book asks for.
const PAGE = 100

export function Repairs() {
  const open = useSheet("repair")
  const [adding, setAdding] = useState(false)

  /// The book, a page at a time as its foot nears view. Its own key under
  /// the book's prefix: the replacement form reads the same scope as one
  /// plain page, and an infinite answer cannot share its cache entry.
  const book = useInfiniteQuery({
    queryKey: [...gaKeys.repairs({}), "pages"] as const,
    queryFn: ({ pageParam, signal }) =>
      gaRepairs({ limit: PAGE, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: (previous) => previous,
  })

  const rows = useMemo(
    () => book.data?.pages.flatMap((page) => page.rows) ?? [],
    [book.data]
  )
  const head = book.data?.pages[0]

  return (
    <PageContent>
      <PageHeader
        crumb="GA"
        title="Repairs"
        sub="What broke, where, who is fixing it, and the estimate. The actual cost is read from bills that point to this repair."
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus />
            Record repair
          </Button>
        }
      />

      {head !== undefined && <SummaryStrip summary={head.summary} />}

      {queryState(book, {
        loading: "Opening the repair book…",
        render: () =>
          rows.length === 0 ? (
            <Card>
              <EmptyState
                action={
                  <Button variant="ghost" onClick={() => setAdding(true)}>
                    Record the first one
                  </Button>
                }
              >
                No repairs recorded yet. A repair is recorded when something
                breaks — tomorrow from an inspection that finds damage, or
                straight from a store report.
              </EmptyState>
            </Card>
          ) : (
            <RepairTable rows={rows} onOpen={open.open} more={book} />
          ),
      })}

      <RepairComposer
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={(repairId) => {
          setAdding(false)
          open.open(repairId)
        }}
      />

      <RepairSheet
        key={open.value ?? "none"}
        repairId={open.value}
        open={open.isOpen}
        onClose={open.close}
      />
    </PageContent>
  )
}

/// The four figures the book is managed by, counted by the server over the
/// WHOLE book — the table below pages as it scrolls, and a strip summed over
/// the rows it happens to hold would change with the scroll position.
function SummaryStrip({ summary }: { summary: GaRepairSummary }) {
  return (
    <KpiStrip className="md:grid-cols-2 xl:grid-cols-4">
      <Kpi label="Open" value={count(summary.open)} />
      <Kpi
        label="Done in the last 90 days"
        value={count(summary.done_recently)}
      />
      <Kpi label="Actual over estimate/budget" value={count(summary.over)} />
      <Kpi
        label={
          <>
            Actual {summary.year}{" "}
            <FinanceMark className="ml-1 align-[0.125rem]" />
          </>
        }
        value={money(summary.actual_this_year_minor)}
      />
    </KpiStrip>
  )
}

/// The book's table, in the prototype's columns. The register scrolls
/// INSIDE its own box rather than squeezing the columns: eight columns of
/// problems, places and figures do not fit a phone, and a squeezed table
/// overlaps its own cells while the page starts scrolling sideways.
function RepairTable({
  rows,
  onOpen,
  more,
}: {
  rows: readonly GaRepairRow[]
  onOpen: (repairId: string) => void
  more: Pageable
}) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <div className="min-w-[70rem]">
          <div className="grid h-10 grid-cols-[3rem_minmax(14rem,1fr)_10rem_5.5rem_10rem_9rem_9.5rem_8rem] items-center gap-3 border-b border-hairline bg-soft px-3.5 text-eyebrow font-medium text-body">
            <span>No</span>
            <span>Problem</span>
            <span>Object</span>
            <span>Location</span>
            <span>Vendor</span>
            <span className="text-right">Estimate</span>
            <span className="text-right">
              Actual <FinanceMark className="ml-1 align-[0.0625rem]" />
            </span>
            <span>Status</span>
          </div>
          {rows.map((row, index) => (
            <RepairLine
              key={row.repair_id}
              row={row}
              ordinal={index + 1}
              onOpen={onOpen}
            />
          ))}
        </div>
      </div>
      {/* Outside the sideways-scrolling box, which computes as a vertical
          scroller too — see `<LoadMore>`. The page scrolls. */}
      <LoadMore query={more} />
    </Card>
  )
}

function RepairLine({
  row,
  ordinal,
  onOpen,
}: {
  row: GaRepairRow
  ordinal: number
  onOpen: (repairId: string) => void
}) {
  const { over, capWord } = repairOver(row)
  return (
    <div
      onClick={() => onOpen(row.repair_id)}
      className="grid cursor-pointer grid-cols-[3rem_minmax(14rem,1fr)_10rem_5.5rem_10rem_9rem_9.5rem_8rem] items-center gap-3 border-b border-hairline px-3.5 py-2.5 transition-colors last:border-b-0 hover:bg-soft"
    >
      <span className="text-meta text-mute tabular-nums">{ordinal}</span>
      <div className="min-w-0">
        <span className="block truncate text-cell font-medium text-ink">
          {row.title}
        </span>
        <span className="block truncate text-pill text-mute">
          {row.asset_name ?? "no asset"}
        </span>
      </div>
      <span className="min-w-0 truncate text-meta text-body">
        {row.objek_name}
      </span>
      <span className="truncate text-meta text-body">{row.site_id}</span>
      <span className="min-w-0 truncate text-meta text-body">
        {row.supplier_name}
      </span>
      <span className="min-w-0 truncate text-right text-meta text-body tabular-nums">
        {money(row.estimated_cost_minor)}
        {row.approved_budget_minor !== null && (
          <span className="block truncate text-pill text-mute">
            budget {money(row.approved_budget_minor)}
          </span>
        )}
      </span>
      <span className="min-w-0 truncate text-right text-meta tabular-nums">
        <span className={over ? "text-bad" : "text-body"}>
          {money(row.actual_cost_minor)}
        </span>
        {over && (
          <span className="block truncate text-pill text-bad">
            over {capWord}
          </span>
        )}
      </span>
      <span>
        <RepairStagePill status={row.status} />
      </span>
    </div>
  )
}

/// Recording a repair, the way the prototype's form asks for it.
///
/// # Aset first, objek follows
///
/// Name an asset and the object (and the site) come from it: the server
/// derives the object from the asset's class, so the form hides the choice
/// it would only be second-guessing. No asset — a ceiling, a paint job — and
/// the object and site are the human's to give, because the cost still has
/// to land somewhere readable.
export function RepairComposer({
  open,
  onClose,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  onSaved: (repairId: string) => void
}) {
  const client = useQueryClient()
  const [form, setForm] = useState<Record<string, string>>({})
  const [problems, setProblems] = useState<Record<string, string>>({})
  const set = (key: string, value: string) => {
    // Editing a field takes its error back (brief §10.2): a problem sentence
    // survives only while the field itself is still wrong.
    setProblems((current) => ({ ...current, [key]: "" }))
    setForm((current) => ({ ...current, [key]: value }))
  }

  const assetId = form.asset ?? ""

  // The registered things, for the Aset picker — the same cached answer the
  // register reads, so a name here is a name there.
  const assets = useQuery({
    queryKey: gaKeys.assets({}),
    queryFn: ({ signal }) => gaAssets({ limit: 200 }, signal),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  // Sites, from Finance's facet — the same list the asset register and the
  // contract composer offer, because a site is a site in every form.
  const shape = useQuery({
    queryKey: financeKeys.assets(false, null),
    queryFn: ({ signal }) => listAssets({ limit: 1 }, signal),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  // The eleven objects and their accounts — the server's list, the same one
  // the request is validated against.
  const objects = useQuery({
    queryKey: gaKeys.repairObjects(),
    queryFn: ({ signal }) => gaRepairObjects(signal),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  // The vendors, from the book of parties that send bills.
  const vendors = useQuery({
    queryKey: [...procurementKeys.suppliers(), "book", "EXPENSE"],
    queryFn: ({ signal }) => supplierPage({ category: "EXPENSE" }, signal),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  // Maintenance contracts, for the one optional field that says "this is
  // covered": a repair under contract still gets recorded, so the cost is
  // not invented later — the contract is what the bills belong to.
  const contracts = useQuery({
    queryKey: gaKeys.contracts({ type: "JASA_MAINTENANCE" }),
    queryFn: ({ signal }) =>
      gaContracts({ type: "JASA_MAINTENANCE", limit: 50 }, signal),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  const asset = (assets.data?.rows ?? []).find(
    (one: GaAssetRow) => one.asset_id === assetId
  )
  const object = repairObjectTiles(objects.data ?? []).find(
    (one) => one.code === form.objek
  )

  const save = useMutation({
    mutationFn: () =>
      recordGaRepair({
        // The site follows the asset when there is one; without an asset it
        // is the human's answer, and it is what makes the cost readable per
        // location either way.
        site_id: asset !== undefined ? asset.site_id : (form.site ?? ""),
        asset_id: assetId === "" ? null : assetId,
        objek: assetId === "" ? (form.objek ?? null) : null,
        title: (form.title ?? "").trim(),
        supplier_id: form.vendor ?? "",
        contract_id: form.contract === "" ? null : (form.contract ?? null),
        task_id: null,
        inspection_id: null,
        estimated_cost_minor:
          (form.estimate ?? "") === "" ? null : Number(form.estimate),
        failure_at: form.failure_at ?? new Date().toISOString().slice(0, 10),
        notes: (form.notes ?? "").trim() === "" ? null : form.notes?.trim(),
      }),
    onSuccess: (row) => {
      void client.invalidateQueries({ queryKey: gaKeys.all })
      setForm({})
      onSaved(row.repair_id)
    },
  })

  const submit = () => {
    const next: Record<string, string> = {}
    if ((form.title ?? "").trim() === "")
      next.title = "Enter the problem first."
    if (assetId === "" && (form.objek ?? "") === "")
      next.objek = "Choose the object first."
    if (assetId === "" && (form.site ?? "") === "")
      next.site = "Choose a location first."
    if ((form.vendor ?? "") === "") next.vendor = "Choose a vendor first."
    if (Object.keys(next).length > 0) {
      setProblems(next)
      return
    }
    save.mutate()
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      width="wide"
      title="New repair"
      caption="The facts recorded: what broke, where, and who is handling it. The actual figure comes from Finance."
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-pill text-mute">
            {asset === undefined
              ? object === undefined
                ? "No asset — choose an object and location"
                : `Object ${object.label.toLowerCase()}`
              : "Object and location follow the asset"}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" pending={save.isPending} onClick={submit}>
              {save.isPending ? "Saving…" : "Save repair"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {save.error instanceof Error && (
          <Banner tone="bad">{save.error.message}</Banner>
        )}

        <Section title="Problem">
          <Field label="Problem" required problem={problems.title || undefined}>
            <Input
              value={form.title ?? ""}
              onChange={(event) => set("title", event.target.value)}
              placeholder="e.g. AC cassette not cooling"
              autoFocus
            />
          </Field>
        </Section>

        <Section
          title="Asset and object"
          aside="object follows the asset's class"
        >
          <Field
            label="Asset"
            aside={asset === undefined ? "empty = no asset" : undefined}
          >
            <Select
              value={form.asset ?? ""}
              onChange={(next) => set("asset", next)}
              aria-label="Asset"
            >
              <option value="">No asset: building, painting, etc.</option>
              {(assets.data?.rows ?? [])
                .filter((one: GaAssetRow) => one.status !== "DRAFT")
                .map((one: GaAssetRow) => (
                  <option key={one.asset_id} value={one.asset_id}>
                    {one.name} · {one.asset_number} · {one.site_id}
                  </option>
                ))}
            </Select>
          </Field>

          {asset === undefined && (
            <>
              <Choices
                label="Object"
                columns={3}
                value={form.objek ?? ""}
                onChange={(next) => set("objek", next)}
                options={repairObjectTiles(objects.data ?? [])}
              />
              {problems.objek !== undefined && problems.objek !== "" && (
                <p className="text-pill text-bad">{problems.objek}</p>
              )}
            </>
          )}
        </Section>

        <Section title="Location and vendor">
          {asset === undefined && (
            <Field
              label="Location"
              required
              problem={problems.site || undefined}
            >
              <Select
                value={form.site ?? ""}
                onChange={(next) => set("site", next)}
                aria-label="Location"
              >
                <option value="">Choose…</option>
                {(shape.data?.facets.sites ?? []).map((one) => (
                  <option key={one.value} value={one.value}>
                    {one.label ?? one.value}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Vendor" required problem={problems.vendor || undefined}>
            <Select
              value={form.vendor ?? ""}
              onChange={(next) => set("vendor", next)}
              aria-label="Vendor"
            >
              <option value="">Choose a vendor…</option>
              {(vendors.data?.rows ?? []).map((one) => (
                <option key={one.supplier_id} value={one.supplier_id}>
                  {one.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Contract" aside="empty = not covered by a contract">
            <Select
              value={form.contract ?? ""}
              onChange={(next) => set("contract", next)}
              aria-label="Contract"
            >
              <option value="">—</option>
              {(contracts.data?.rows ?? []).map((one) => (
                <option key={one.contract_id} value={one.contract_id}>
                  {one.contract_number ?? one.contract_id.slice(0, 8)} ·{" "}
                  {one.supplier_name ?? one.counterparty_name}
                </option>
              ))}
            </Select>
          </Field>
        </Section>

        <Section title="Estimate and timing">
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Cost estimate"
              aside="GA's own fact; the budget follows through approval"
            >
              <Money
                value={form.estimate ?? ""}
                onChange={(next) => set("estimate", next)}
                placeholder="5000000"
              />
            </Field>
            <Field label="Reported">
              <Input
                type="date"
                value={form.failure_at ?? new Date().toISOString().slice(0, 10)}
                onChange={(event) => set("failure_at", event.target.value)}
              />
            </Field>
          </div>
          <Field label="Notes" aside="appears below the problem in the book">
            <Input
              value={form.notes ?? ""}
              onChange={(event) => set("notes", event.target.value)}
              placeholder="e.g. unit 1-04, floor 2"
            />
          </Field>
          <p className="flex items-center gap-1.5 text-pill text-mute">
            <Wrench className="size-3.5 text-line-ico" />
            {asset !== undefined
              ? "Object and account follow the asset's class; location follows the asset."
              : object === undefined
                ? "Choose the object — the proposed account follows it."
                : `Proposed account: ${object.tag ?? "—"} (Finance can still change it).`}
          </p>
        </Section>
      </div>
    </Sheet>
  )
}
