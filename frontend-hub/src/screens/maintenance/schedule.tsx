import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { CalendarPlus, ClipboardCheck, Plus } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Choices, Section, Toggle } from "@/components/ui/form"
import { Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Sheet } from "@/components/ui/sheet"
import {
  Banner,
  EmptyState,
  LoadMore,
  type Pageable,
} from "@/components/ui/states"
import { count as formatCount, day } from "@/lib/format"
import { procurementKeys, supplierPage } from "@/lib/queries/procurement"
import {
  gaAssets,
  gaInspections,
  gaKeys,
  gaMaintenanceTasks,
  recordGaInspection,
  recordGaRepair,
  recordGaTask,
} from "@/lib/queries/ga"
import { financeKeys, listAssets } from "@/lib/queries/finance"
import { ResultPill, TaskStatePill } from "@/screens/maintenance/parts"
import { INSPECTION_RESULTS, intervalLabel } from "@/screens/maintenance/format"

/// Jadwal & inspeksi — the quiet half of maintenance.
///
/// # Two tables, one job
///
/// The schedule says what is COMING (a recurring task for one asset or one
/// location); the inspections say what was FOUND (the record of somebody
/// having walked the floor). The second is the evidence the first is checked
/// against, which is why a finding can become a repair with one switch —
/// the finding is already written, and a repair that has to retype it is a
/// repair that loses the detail.
///
/// # Tanpa nominal, on purpose
///
/// A schedule row is a date and a thing; no figure belongs to it. The costs
/// live on the repairs the tasks produce, in the Perbaikan book.
/// How many rows one page of either list asks for.
const PAGE = 100

export function Schedule() {
  const [addingTask, setAddingTask] = useState(false)
  const [addingInspection, setAddingInspection] = useState(false)

  // Both lists page from the server in the order they are read — tasks
  // soonest due first (undated last), inspections newest first — so neither
  // is re-sorted here: a sort over the loaded rows would reshuffle as more
  // arrived.
  const tasks = useInfiniteQuery({
    queryKey: [...gaKeys.maintenanceTasks({}), "pages"] as const,
    queryFn: ({ pageParam, signal }) =>
      gaMaintenanceTasks({ limit: PAGE, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })
  const inspections = useInfiniteQuery({
    queryKey: [...gaKeys.inspections({}), "pages"] as const,
    queryFn: ({ pageParam, signal }) =>
      gaInspections({ limit: PAGE, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })

  const taskRows = useMemo(
    () => tasks.data?.pages.flatMap((page) => page.rows) ?? [],
    [tasks.data]
  )
  const inspectionRows = useMemo(
    () => inspections.data?.pages.flatMap((page) => page.rows) ?? [],
    [inspections.data]
  )

  return (
    <PageContent>
      <PageHeader
        crumb="GA"
        title="Service schedule"
        sub="Set up recurring service and record inspection results. A finding can be carried forward as a repair."
        actions={
          <>
            <Button variant="soft" onClick={() => setAddingTask(true)}>
              <Plus />
              Add task
            </Button>
            <Button variant="primary" onClick={() => setAddingInspection(true)}>
              <CalendarPlus />
              Record inspection
            </Button>
          </>
        }
      />

      <TableCard
        title="Tasks"
        count={taskRows.length}
        total={tasks.data?.pages[0]?.total ?? 0}
        more={tasks}
        empty="No recurring tasks yet. A task is recorded for one asset (genset service) or one location (AC wash across 13 stores)."
        emptyAction={
          <Button variant="ghost" onClick={() => setAddingTask(true)}>
            Add the first task
          </Button>
        }
        loading={tasks.isPending}
      >
        <div className="min-w-[66rem]">
          <div className="grid h-10 grid-cols-[minmax(13rem,1fr)_minmax(13rem,1fr)_9rem_9rem_10rem_9rem] items-center gap-3 border-b border-hairline bg-soft px-3.5 text-eyebrow font-medium text-body">
            <span>Task</span>
            <span>Asset / location</span>
            <span>Interval</span>
            <span>Next due</span>
            <span>Contract</span>
            <span>Status</span>
          </div>
          {taskRows.map((row) => (
            <div
              key={row.task_id}
              className="grid grid-cols-[minmax(13rem,1fr)_minmax(13rem,1fr)_9rem_9rem_10rem_9rem] items-center gap-3 border-b border-hairline px-3.5 py-2.5 last:border-b-0"
            >
              <div className="min-w-0">
                <span className="block truncate text-cell font-medium text-ink">
                  {row.title}
                </span>
                {row.notes !== null && (
                  <span className="block truncate text-pill text-mute">
                    {row.notes}
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <span className="block truncate text-meta text-body">
                  {row.asset_name ?? row.site_id}
                </span>
                <span className="block truncate text-pill text-mute">
                  {row.asset_name !== null
                    ? "per asset"
                    : "per location · every point at the location"}
                </span>
              </div>
              <span className="truncate text-meta text-body tabular-nums">
                {intervalLabel(row.interval_kind, row.interval_value)}
              </span>
              <span className="truncate text-meta text-body tabular-nums">
                {row.next_due === null ? "—" : day(row.next_due)}
              </span>
              <span className="min-w-0 truncate font-mono text-id text-body">
                {row.contract_number ??
                  (row.contract_id === null
                    ? "—"
                    : row.contract_id.slice(0, 8))}
              </span>
              <span>
                <TaskStatePill nextDue={row.next_due} />
              </span>
            </div>
          ))}
        </div>
      </TableCard>

      <TableCard
        title="Inspections"
        count={inspectionRows.length}
        total={inspections.data?.pages[0]?.total ?? 0}
        more={inspections}
        empty="No inspections yet. Inspection results are recorded here, and a finding can become a repair right away."
        emptyAction={
          <Button variant="ghost" onClick={() => setAddingInspection(true)}>
            Record the first inspection
          </Button>
        }
        loading={inspections.isPending}
      >
        <div className="min-w-[64rem]">
          <div className="grid h-10 grid-cols-[minmax(14rem,1fr)_9rem_12rem_minmax(14rem,1fr)_10rem] items-center gap-3 border-b border-hairline bg-soft px-3.5 text-eyebrow font-medium text-body">
            <span>Asset</span>
            <span>Date</span>
            <span>By</span>
            <span>Finding</span>
            <span>Result</span>
          </div>
          {inspectionRows.map((row) => (
            <div
              key={row.inspection_id}
              className="grid grid-cols-[minmax(14rem,1fr)_9rem_12rem_minmax(14rem,1fr)_10rem] items-center gap-3 border-b border-hairline px-3.5 py-2.5 last:border-b-0"
            >
              <span className="min-w-0 truncate text-cell font-medium text-ink">
                {row.asset_name ?? "—"}
              </span>
              <span className="truncate text-meta text-body tabular-nums">
                {day(row.inspected_on)}
              </span>
              <span className="min-w-0 truncate text-meta text-body">
                {row.inspected_by}
              </span>
              <span className="min-w-0 truncate text-meta text-body">
                {row.findings}
              </span>
              <span>
                <ResultPill result={row.result} />
              </span>
            </div>
          ))}
        </div>
      </TableCard>

      <TaskComposer open={addingTask} onClose={() => setAddingTask(false)} />

      <InspectionComposer
        open={addingInspection}
        onClose={() => setAddingInspection(false)}
      />
    </PageContent>
  )
}

/// One table, in its own scrolling box — the same answer the register gives:
/// six columns do not fit a phone, and a squeezed table overlaps its own
/// cells while the page itself starts scrolling sideways.
///
/// The box scrolls DOWN too, and pages as its own foot nears view. Two
/// infinite lists stacked on one page cannot both scroll with the page: the
/// first would pull every one of its pages before the second came into view.
function TableCard({
  title,
  count,
  total,
  more,
  empty,
  emptyAction,
  loading,
  children,
}: {
  title: string
  /// Rows loaded so far — what decides between the table and the empty state.
  count: number
  /// Every row the server holds, which is what the header says.
  total: number
  more: Pageable
  empty: string
  emptyAction?: React.ReactNode
  loading: boolean
  children: React.ReactNode
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 border-b border-hairline bg-soft px-3.5 py-2.5">
        <b className="text-card-title font-semibold text-ink">{title}</b>
        <span className="text-pill text-mute">{formatCount(total)}</span>
      </div>
      {loading ? null : count === 0 ? (
        <EmptyState action={emptyAction}>{empty}</EmptyState>
      ) : (
        <div className="max-h-[36rem] overflow-auto">
          {children}
          <LoadMore query={more} />
        </div>
      )}
    </Card>
  )
}

/// Recording a recurring task. The first question is WHOSE task it is — one
/// thing, or one place — because that decides what the rest of the form
/// asks for, and a task that is vaguely for both is a task nobody can tick
/// off.
function TaskComposer({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const [form, setForm] = useState<Record<string, string>>({
    target: "ASSET",
    kind: "MONTHS",
  })
  const [problems, setProblems] = useState<Record<string, string>>({})
  const set = (key: string, value: string) => {
    setProblems((current) => ({ ...current, [key]: "" }))
    setForm((current) => ({ ...current, [key]: value }))
  }

  const forAsset = (form.target ?? "ASSET") === "ASSET"
  const kind = form.kind ?? "MONTHS"
  const nextDueHidden = kind === "KM"

  const assets = useQuery({
    queryKey: gaKeys.assets({}),
    queryFn: ({ signal }) => gaAssets({ limit: 200 }, signal),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  const shape = useQuery({
    queryKey: financeKeys.assets(false, null),
    queryFn: ({ signal }) => listAssets({ limit: 1 }, signal),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  const vendors = useQuery({
    queryKey: [...procurementKeys.suppliers(), "book", "EXPENSE"],
    queryFn: ({ signal }) => supplierPage({ category: "EXPENSE" }, signal),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  const save = useMutation({
    mutationFn: () =>
      recordGaTask({
        title: (form.title ?? "").trim(),
        asset_id: forAsset && form.asset !== "" ? form.asset : null,
        site_id: !forAsset && form.site !== "" ? form.site : null,
        interval_kind: kind,
        interval_value: Number(form.value),
        // A KM task has no next DATE — km is distance. The others must say
        // when they are next due, or the row has no job to do.
        next_due: nextDueHidden ? null : (form.next_due ?? ""),
        contract_id: form.contract === "" ? null : (form.contract ?? null),
        supplier_id: form.vendor === "" ? null : (form.vendor ?? null),
        notes: (form.notes ?? "").trim() === "" ? null : form.notes?.trim(),
      }),
    onSuccess: () => {
      // The schedule's own list and the overview's due-soon list both move.
      void client.invalidateQueries({ queryKey: gaKeys.all })
      setForm({ target: "ASSET", kind: "MONTHS" })
      onClose()
    },
  })

  const submit = () => {
    const next: Record<string, string> = {}
    if ((form.title ?? "").trim() === "") next.title = "Enter the task first."
    if (forAsset && (form.asset ?? "") === "") next.asset = "Choose an asset first."
    if (!forAsset && (form.site ?? "") === "") next.site = "Choose a location first."
    if ((form.value ?? "") === "" || Number(form.value) <= 0)
      next.value = "Enter the interval number."
    if (!nextDueHidden && (form.next_due ?? "") === "")
      next.next_due = "Enter the next due date."
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
      title="New recurring task"
      caption="One schedule for one asset or one location. The next due date is calculated by the server from the interval."
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-pill text-mute">
            {nextDueHidden
              ? "A km task follows the odometer, not a date"
              : forAsset
                ? "Task for one asset"
                : "Task for one location"}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" pending={save.isPending} onClick={submit}>
              {save.isPending ? "Saving…" : "Save task"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {save.error instanceof Error && (
          <Banner tone="bad">{save.error.message}</Banner>
        )}

        <Section title="For">
          <Choices
            label="For"
            columns={2}
            value={form.target ?? "ASSET"}
            onChange={(next) => set("target", next)}
            options={[
              {
                value: "ASSET",
                label: "One asset",
                icon: ClipboardCheck,
                note: "Service for one machine: genset DC, goods lift C001.",
              },
              {
                value: "SITE",
                label: "One location",
                icon: CalendarPlus,
                note: "One job covering every point at one location: AC wash across 13 stores.",
              },
            ]}
          />
          {forAsset ? (
            <Field label="Asset" required problem={problems.asset || undefined}>
              <Select
                value={form.asset ?? ""}
                onChange={(next) => set("asset", next)}
                aria-label="Asset"
              >
                <option value="">Choose…</option>
                {(assets.data?.rows ?? [])
                  .filter((one) => one.status !== "DRAFT")
                  .map((one) => (
                    <option key={one.asset_id} value={one.asset_id}>
                      {one.name} · {one.asset_number} · {one.site_id}
                    </option>
                  ))}
              </Select>
            </Field>
          ) : (
            <Field label="Location" required problem={problems.site || undefined}>
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
          <Field label="Task" required problem={problems.title || undefined}>
            <Input
              value={form.title ?? ""}
              onChange={(event) => set("title", event.target.value)}
              placeholder="e.g. Genset DC service"
            />
          </Field>
        </Section>

        <Section title="Interval" aside="the next due date is calculated from this">
          <div className="grid grid-cols-[1fr_10rem] items-start gap-4">
            <Choices
              label="Interval unit"
              columns={3}
              value={kind}
              onChange={(next) => set("kind", next)}
              options={[
                { value: "DAYS", label: "Days" },
                { value: "MONTHS", label: "Months" },
                { value: "KM", label: "Kilometres" },
              ]}
            />
            <Field
              label="Every"
              required
              problem={problems.value || undefined}
            >
              <Input
                inputMode="numeric"
                value={form.value ?? ""}
                onChange={(event) => set("value", event.target.value)}
                placeholder="3"
              />
            </Field>
          </div>
          {!nextDueHidden && (
            <Field
              label="Next due"
              required
              aside="recalculated by the server each time it's completed"
              problem={problems.next_due || undefined}
            >
              <Input
                type="date"
                value={form.next_due ?? ""}
                onChange={(event) => set("next_due", event.target.value)}
              />
            </Field>
          )}
        </Section>

        <Section title="Assigned to">
          <Field
            label="Vendor"
            aside="optional; a maintenance contract carries more weight"
          >
            <Select
              value={form.vendor ?? ""}
              onChange={(next) => set("vendor", next)}
              aria-label="Vendor"
            >
              <option value="">Not yet decided</option>
              {(vendors.data?.rows ?? []).map((one) => (
                <option key={one.supplier_id} value={one.supplier_id}>
                  {one.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Notes" aside="appears below the task in the schedule">
            <Input
              value={form.notes ?? ""}
              onChange={(event) => set("notes", event.target.value)}
              placeholder="e.g. coordinate with the store manager"
            />
          </Field>
        </Section>
      </div>
    </Sheet>
  )
}

/// Recording an inspection — and, through one switch, the repair the finding
/// calls for.
///
/// # The switch exists only when the answer asks for it
///
/// "Good" has no follow-up, so the switch is not drawn for it (brief §10.2).
/// The two other results do, and the switch lights by default: the finding
/// is already written in Temuan, and the repair should carry it rather than
/// make somebody type it again. The repair appears in the Jadwal's book and
/// in the asset's history, with the inspection as its evidence.
function InspectionComposer({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const [form, setForm] = useState<Record<string, string>>({
    result: "BAIK",
    by: "Staf GA",
    inspected_on: new Date().toISOString().slice(0, 10),
  })
  const [problems, setProblems] = useState<Record<string, string>>({})
  const [makeRepair, setMakeRepair] = useState(true)
  const set = (key: string, value: string) => {
    setProblems((current) => ({ ...current, [key]: "" }))
    setForm((current) => ({ ...current, [key]: value }))
  }

  const result = form.result ?? "BAIK"
  const needsRepair = result !== "BAIK" && makeRepair

  const assets = useQuery({
    queryKey: gaKeys.assets({}),
    queryFn: ({ signal }) => gaAssets({ limit: 200 }, signal),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  const vendors = useQuery({
    queryKey: [...procurementKeys.suppliers(), "book", "EXPENSE"],
    queryFn: ({ signal }) => supplierPage({ category: "EXPENSE" }, signal),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  const asset = (assets.data?.rows ?? []).find(
    (one) => one.asset_id === form.asset
  )

  const save = useMutation({
    mutationFn: async () => {
      // The inspection lands first, because the repair points back at it:
      // the record the finding produced must be able to name its evidence.
      const inspection = await recordGaInspection({
        asset_id: form.asset ?? "",
        inspected_on: form.inspected_on ?? "",
        inspected_by: (form.by ?? "").trim(),
        result,
        findings: (form.findings ?? "").trim(),
        task_id: null,
      })
      if (!needsRepair) return inspection
      return recordGaRepair({
        site_id: asset?.site_id ?? "",
        asset_id: form.asset ?? "",
        // The server derives the object from the asset's class; the form
        // does not get a vote on what a laptop's repair is billed as.
        objek: null,
        title: (form.findings ?? "").trim(),
        supplier_id: form.vendor ?? "",
        contract_id: null,
        task_id: inspection.task_id,
        inspection_id: inspection.inspection_id,
        estimated_cost_minor: null,
        failure_at: form.inspected_on ?? "",
        notes: `From inspection ${day(inspection.inspected_on)}`,
      }).then(() => inspection)
    },
    onSuccess: () => {
      // The schedule's inspection table, the Perbaikan book and the asset's
      // history all read from the GA namespace.
      void client.invalidateQueries({ queryKey: gaKeys.all })
      setForm({
        result: "BAIK",
        by: "Staf GA",
        inspected_on: new Date().toISOString().slice(0, 10),
      })
      setMakeRepair(true)
      onClose()
    },
  })

  const submit = () => {
    const next: Record<string, string> = {}
    if ((form.asset ?? "") === "") next.asset = "Choose an asset first."
    if ((form.findings ?? "").trim() === "")
      next.findings = "Enter the finding first."
    if ((form.by ?? "").trim() === "") next.by = "Enter who inspected it."
    if (needsRepair && (form.vendor ?? "") === "")
      next.vendor = "A repair needs a vendor — choose one first."
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
      title="New inspection"
      caption="The result of inspecting one asset. A finding that needs action can become a repair right away."
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-pill text-mute">
            {result === "BAIK"
              ? "Recorded in the asset's history"
              : needsRepair
                ? "A repair will be created from this finding"
                : "Recorded; the repair follows later if needed"}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" pending={save.isPending} onClick={submit}>
              {save.isPending ? "Saving…" : "Save inspection"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {save.error instanceof Error && (
          <Banner tone="bad">{save.error.message}</Banner>
        )}

        <Section title="Asset and time">
          <Field label="Asset" required problem={problems.asset || undefined}>
            <Select
              value={form.asset ?? ""}
              onChange={(next) => set("asset", next)}
              aria-label="Asset"
            >
              <option value="">Choose…</option>
              {(assets.data?.rows ?? [])
                .filter((one) => one.status !== "DRAFT")
                .map((one) => (
                  <option key={one.asset_id} value={one.asset_id}>
                    {one.name} · {one.asset_number} · {one.site_id}
                  </option>
                ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="By" required problem={problems.by || undefined}>
              <Input
                value={form.by ?? ""}
                onChange={(event) => set("by", event.target.value)}
                placeholder="e.g. Technician from CV Sejuk Teknik"
              />
            </Field>
            <Field label="Date">
              <Input
                type="date"
                value={form.inspected_on ?? ""}
                onChange={(event) => set("inspected_on", event.target.value)}
              />
            </Field>
          </div>
        </Section>

        <Section title="Result" aside="the card chosen decides what follows">
          <Choices
            label="Result"
            columns={3}
            value={result}
            onChange={(next) => set("result", next)}
            options={INSPECTION_RESULTS.map((one) => ({
              value: one.value,
              label: one.label,
              icon: one.icon,
            }))}
          />
        </Section>

        <Section title="Finding">
          <Field
            label="Finding"
            required
            problem={problems.findings || undefined}
          >
            <Input
              value={form.findings ?? ""}
              onChange={(event) => set("findings", event.target.value)}
              placeholder="e.g. Compressor noisy, performance dropping"
              autoFocus
            />
          </Field>

          {result !== "BAIK" && (
            <>
              <Toggle
                on={makeRepair}
                onToggle={() => setMakeRepair((current) => !current)}
                label="Create a repair from this finding"
                note={
                  makeRepair
                    ? "The repair is recorded in the Repairs book and in the asset's history, with this inspection as its evidence."
                    : "The finding is recorded only; the repair can be created later."
                }
              />
              {makeRepair && (
                <Field
                  label="Repair vendor"
                  required
                  problem={problems.vendor || undefined}
                >
                  <Select
                    value={form.vendor ?? ""}
                    onChange={(next) => set("vendor", next)}
                    aria-label="Repair vendor"
                  >
                    <option value="">Choose a vendor…</option>
                    {(vendors.data?.rows ?? []).map((one) => (
                      <option key={one.supplier_id} value={one.supplier_id}>
                        {one.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </>
          )}
        </Section>
      </div>
    </Sheet>
  )
}
