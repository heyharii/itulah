import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CalendarPlus, ClipboardCheck, Plus } from "lucide-react"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Choices, Section, Toggle } from "@/components/ui/form"
import { Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { day } from "@/lib/format"
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
export function Schedule() {
  const [addingTask, setAddingTask] = useState(false)
  const [addingInspection, setAddingInspection] = useState(false)

  const tasks = useQuery({
    queryKey: gaKeys.maintenanceTasks({}),
    queryFn: ({ signal }) => gaMaintenanceTasks({ limit: 200 }, signal),
  })
  const inspections = useQuery({
    queryKey: gaKeys.inspections({}),
    queryFn: ({ signal }) => gaInspections({ limit: 100 }, signal),
  })

  const taskRows = [...(tasks.data?.rows ?? [])].sort((a, b) =>
    (a.next_due ?? "9999") < (b.next_due ?? "9999") ? -1 : 1
  )
  const inspectionRows = [...(inspections.data?.rows ?? [])].sort((a, b) =>
    a.inspected_on < b.inspected_on ? 1 : -1
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Pemeliharaan"
        title="Jadwal servis"
        sub="Atur servis berkala dan catat hasil pemeriksaan aset. Temuan dapat dilanjutkan sebagai perbaikan."
        actions={
          <>
            <Button variant="soft" onClick={() => setAddingTask(true)}>
              <Plus />
              Catat tugas
            </Button>
            <Button variant="primary" onClick={() => setAddingInspection(true)}>
              <CalendarPlus />
              Catat inspeksi
            </Button>
          </>
        }
      />

      <TableCard
        title="Tugas"
        count={taskRows.length}
        empty="Belum ada tugas berkala. Tugas dicatat untuk satu aset (servis genset) atau satu lokasi (cuci AC 13 toko)."
        emptyAction={
          <Button variant="ghost" onClick={() => setAddingTask(true)}>
            Catat tugas pertama
          </Button>
        }
        loading={tasks.isPending}
      >
        <div className="min-w-[66rem]">
          <div className="grid h-10 grid-cols-[minmax(13rem,1fr)_minmax(13rem,1fr)_9rem_9rem_10rem_9rem] items-center gap-3 border-b border-hairline bg-soft px-3.5 text-eyebrow font-medium text-body">
            <span>Tugas</span>
            <span>Aset / lokasi</span>
            <span>Interval</span>
            <span>Berikutnya</span>
            <span>Kontrak</span>
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
                    ? "per aset"
                    : "per lokasi · semua titik di site"}
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
        title="Inspeksi terakhir"
        count={inspectionRows.length}
        empty="Belum ada inspeksi. Hasil pemeriksaan dicatat di sini, dan temuannya bisa langsung jadi perbaikan."
        emptyAction={
          <Button variant="ghost" onClick={() => setAddingInspection(true)}>
            Catat inspeksi pertama
          </Button>
        }
        loading={inspections.isPending}
      >
        <div className="min-w-[64rem]">
          <div className="grid h-10 grid-cols-[minmax(14rem,1fr)_9rem_12rem_minmax(14rem,1fr)_10rem] items-center gap-3 border-b border-hairline bg-soft px-3.5 text-eyebrow font-medium text-body">
            <span>Aset</span>
            <span>Tanggal</span>
            <span>Oleh</span>
            <span>Temuan</span>
            <span>Hasil</span>
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
function TableCard({
  title,
  count,
  empty,
  emptyAction,
  loading,
  children,
}: {
  title: string
  count: number
  empty: string
  emptyAction?: React.ReactNode
  loading: boolean
  children: React.ReactNode
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 border-b border-hairline bg-soft px-3.5 py-2.5">
        <b className="text-card-title font-semibold text-ink">{title}</b>
        <span className="text-pill text-mute">{count}</span>
      </div>
      {loading ? null : count === 0 ? (
        <EmptyState action={emptyAction}>{empty}</EmptyState>
      ) : (
        <div className="overflow-x-auto">{children}</div>
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
    if ((form.title ?? "").trim() === "") next.title = "Tulis tugasnya dulu."
    if (forAsset && (form.asset ?? "") === "") next.asset = "Pilih aset dulu."
    if (!forAsset && (form.site ?? "") === "") next.site = "Pilih site dulu."
    if ((form.value ?? "") === "" || Number(form.value) <= 0)
      next.value = "Isi angka intervalnya."
    if (!nextDueHidden && (form.next_due ?? "") === "")
      next.next_due = "Isi tanggal berikutnya."
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
      title="Tugas berkala baru"
      caption="Satu jadwal untuk satu aset atau satu lokasi. Tanggal berikutnya dihitung server dari intervalnya."
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-pill text-mute">
            {nextDueHidden
              ? "Tugas km mengikuti odometer, bukan tanggal"
              : forAsset
                ? "Tugas untuk satu aset"
                : "Tugas untuk satu lokasi"}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              Batal
            </Button>
            <Button
              variant="primary"
              disabled={save.isPending}
              onClick={submit}
            >
              {save.isPending ? "Menyimpan…" : "Simpan tugas"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {save.error instanceof Error && (
          <Banner tone="bad">{save.error.message}</Banner>
        )}

        <Section title="Untuk">
          <Choices
            label="Untuk"
            columns={2}
            value={form.target ?? "ASSET"}
            onChange={(next) => set("target", next)}
            options={[
              {
                value: "ASSET",
                label: "Satu aset",
                icon: ClipboardCheck,
                note: "Servis untuk satu mesin: genset DC, lift barang C001.",
              },
              {
                value: "SITE",
                label: "Satu lokasi",
                icon: CalendarPlus,
                note: "Satu pekerjaan untuk semua titik di satu site: cuci AC 13 toko.",
              },
            ]}
          />
          {forAsset ? (
            <Field label="Aset" problem={problems.asset || undefined}>
              <Select
                value={form.asset ?? ""}
                onChange={(next) => set("asset", next)}
                aria-label="Aset"
              >
                <option value="">Pilih…</option>
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
            <Field label="Site" problem={problems.site || undefined}>
              <Select
                value={form.site ?? ""}
                onChange={(next) => set("site", next)}
                aria-label="Site"
              >
                <option value="">Pilih…</option>
                {(shape.data?.facets.sites ?? []).map((one) => (
                  <option key={one.value} value={one.value}>
                    {one.label ?? one.value}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Tugas" problem={problems.title || undefined}>
            <Input
              value={form.title ?? ""}
              onChange={(event) => set("title", event.target.value)}
              placeholder="mis. Servis genset DC"
            />
          </Field>
        </Section>

        <Section title="Interval" aside="tanggal berikutnya dihitung dari sini">
          <div className="grid grid-cols-[1fr_10rem] items-start gap-4">
            <Choices
              label="Satuan interval"
              columns={3}
              value={kind}
              onChange={(next) => set("kind", next)}
              options={[
                { value: "DAYS", label: "Hari" },
                { value: "MONTHS", label: "Bulan" },
                { value: "KM", label: "Kilometer" },
              ]}
            />
            <Field label="Setiap" problem={problems.value || undefined}>
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
              label="Berikutnya"
              aside="dihitung ulang server tiap selesai"
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

        <Section title="Pelaksana">
          <Field
            label="Vendor"
            aside="opsional; kontrak maintenance mengikat lebih kuat"
          >
            <Select
              value={form.vendor ?? ""}
              onChange={(next) => set("vendor", next)}
              aria-label="Vendor"
            >
              <option value="">Belum ditentukan</option>
              {(vendors.data?.rows ?? []).map((one) => (
                <option key={one.supplier_id} value={one.supplier_id}>
                  {one.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Catatan" aside="muncul di bawah tugas di jadwal">
            <Input
              value={form.notes ?? ""}
              onChange={(event) => set("notes", event.target.value)}
              placeholder="mis. koordinasi dengan store manager"
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
/// "Baik" has no follow-up, so the switch is not drawn for it (brief §10.2).
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
        notes: `Dari inspeksi ${day(inspection.inspected_on)}`,
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
    if ((form.asset ?? "") === "") next.asset = "Pilih aset dulu."
    if ((form.findings ?? "").trim() === "")
      next.findings = "Tulis temuannya dulu."
    if ((form.by ?? "").trim() === "") next.by = "Isi pemeriksanya dulu."
    if (needsRepair && (form.vendor ?? "") === "")
      next.vendor = "Perbaikan butuh vendor — pilih dulu."
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
      title="Inspeksi baru"
      caption="Hasil pemeriksaan satu aset. Temuan yang perlu tindakan bisa langsung jadi perbaikan."
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-pill text-mute">
            {result === "BAIK"
              ? "Dicatat sebagai riwayat aset"
              : needsRepair
                ? "Temuan akan dibuatkan perbaikan"
                : "Dicatat; perbaikannya menyusul kalau perlu"}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              Batal
            </Button>
            <Button
              variant="primary"
              disabled={save.isPending}
              onClick={submit}
            >
              {save.isPending ? "Menyimpan…" : "Simpan inspeksi"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {save.error instanceof Error && (
          <Banner tone="bad">{save.error.message}</Banner>
        )}

        <Section title="Aset dan waktu">
          <Field label="Aset" problem={problems.asset || undefined}>
            <Select
              value={form.asset ?? ""}
              onChange={(next) => set("asset", next)}
              aria-label="Aset"
            >
              <option value="">Pilih…</option>
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
            <Field label="Oleh" problem={problems.by || undefined}>
              <Input
                value={form.by ?? ""}
                onChange={(event) => set("by", event.target.value)}
                placeholder="mis. Teknisi CV Sejuk Teknik"
              />
            </Field>
            <Field label="Tanggal">
              <Input
                type="date"
                value={form.inspected_on ?? ""}
                onChange={(event) => set("inspected_on", event.target.value)}
              />
            </Field>
          </div>
        </Section>

        <Section title="Hasil" aside="kartunya yang menentukan lanjutannya">
          <Choices
            label="Hasil"
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

        <Section title="Temuan">
          <Field label="Temuan" problem={problems.findings || undefined}>
            <Input
              value={form.findings ?? ""}
              onChange={(event) => set("findings", event.target.value)}
              placeholder="mis. Kompresor berisik, performa turun"
              autoFocus
            />
          </Field>

          {result !== "BAIK" && (
            <>
              <Toggle
                on={makeRepair}
                onToggle={() => setMakeRepair((current) => !current)}
                label="Buat perbaikan dari temuan ini"
                note={
                  makeRepair
                    ? "Perbaikan tercatat di buku Perbaikan dan di riwayat aset, dengan inspeksi ini sebagai buktinya."
                    : "Temuan dicatat saja; perbaikannya dibuat lain waktu."
                }
              />
              {makeRepair && (
                <Field
                  label="Vendor perbaikan"
                  problem={problems.vendor || undefined}
                >
                  <Select
                    value={form.vendor ?? ""}
                    onChange={(next) => set("vendor", next)}
                    aria-label="Vendor perbaikan"
                  >
                    <option value="">Pilih vendor…</option>
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
