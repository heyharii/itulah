import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Wrench } from "lucide-react"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Choices, Section } from "@/components/ui/form"
import { Field, Input, Money, Select } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
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
import type { GaAssetRow, GaRepairRow } from "@itulah/contract"

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
/// A repair is the problem ("AC cassette tidak dingin"), and the site is
/// required even when no single asset is — a leaking ceiling happens to a
/// building. That is what makes the cost readable per location later.
export function Repairs() {
  const open = useSheet("repair")
  const [adding, setAdding] = useState(false)

  const book = useQuery({
    queryKey: gaKeys.repairs({}),
    queryFn: ({ signal }) => gaRepairs({ limit: 200 }, signal),
  })

  const rows = book.data?.rows ?? []

  return (
    <PageContent>
      <PageHeader
        crumb="Pemeliharaan"
        title="Perbaikan"
        sub="Apa yang rusak, di mana, siapa yang memperbaiki, dan estimasinya. Biaya aktual dibaca dari bill yang menunjuk perbaikan ini."
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus />
            Catat perbaikan
          </Button>
        }
      />

      {book.data !== undefined && <SummaryStrip rows={rows} />}

      {queryState(book, {
        loading: "Membuka buku perbaikan…",
        render: () =>
          rows.length === 0 ? (
            <Card>
              <EmptyState
                action={
                  <Button variant="ghost" onClick={() => setAdding(true)}>
                    Catat yang pertama
                  </Button>
                }
              >
                Belum ada perbaikan dicatat. Perbaikan dicatat saat sesuatu
                rusak — besok dari inspeksi yang menemukan kerusakan, atau
                langsung dari laporan toko.
              </EmptyState>
            </Card>
          ) : (
            <RepairTable rows={rows} onOpen={open.open} />
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

/// The four figures the book is managed by, counted over the SAME rows the
/// table draws — the server sends no sums, and a strip that fetched its own
/// answer would drift from the table it sits above.
function SummaryStrip({ rows }: { rows: readonly GaRepairRow[] }) {
  const pending = rows.filter((row) => row.status === "OPEN").length
  const today = new Date().toISOString().slice(0, 10)
  const ninetyAgo = new Date(Date.parse(today) - 90 * 86_400_000)
    .toISOString()
    .slice(0, 10)
  const doneRecently = rows.filter(
    (row) =>
      (row.status === "COMPLETED" || row.status === "CLOSED") &&
      row.completed_at !== null &&
      row.completed_at >= ninetyAgo
  ).length
  const over = rows.filter((row) => repairOver(row).over).length
  const thisYear = today.slice(0, 4)
  const actualThisYear = rows
    .filter(
      (row) =>
        row.actual_cost_minor > 0 &&
        (row.completed_at ?? row.failure_at ?? "").startsWith(thisYear)
    )
    .reduce((sum, row) => sum + row.actual_cost_minor, 0)

  return (
    <KpiStrip className="md:grid-cols-2 xl:grid-cols-4">
      <Kpi label="Terbuka" value={count(pending)} />
      <Kpi label="Selesai 90 hari terakhir" value={count(doneRecently)} />
      <Kpi label="Aktual di atas estimasi/budget" value={count(over)} />
      <Kpi
        label={
          <>
            Aktual {thisYear} <FinanceMark className="ml-1 align-[0.125rem]" />
          </>
        }
        value={money(actualThisYear)}
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
}: {
  rows: readonly GaRepairRow[]
  onOpen: (repairId: string) => void
}) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <div className="min-w-[70rem]">
          <div className="grid h-10 grid-cols-[3rem_minmax(14rem,1fr)_10rem_5.5rem_10rem_9rem_9.5rem_8rem] items-center gap-3 border-b border-hairline bg-soft px-3.5 text-eyebrow font-medium text-body">
            <span>No</span>
            <span>Masalah</span>
            <span>Objek</span>
            <span>Site</span>
            <span>Vendor</span>
            <span className="text-right">Estimasi</span>
            <span className="text-right">
              Aktual <FinanceMark className="ml-1 align-[0.0625rem]" />
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
          {row.asset_name ?? "tanpa aset"}
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
            di atas {capWord}
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
    if ((form.title ?? "").trim() === "") next.title = "Tulis masalahnya dulu."
    if (assetId === "" && (form.objek ?? "") === "")
      next.objek = "Pilih objeknya dulu."
    if (assetId === "" && (form.site ?? "") === "")
      next.site = "Pilih site dulu."
    if ((form.vendor ?? "") === "") next.vendor = "Pilih vendor dulu."
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
      title="Perbaikan baru"
      caption="Fakta yang dicatat: apa yang rusak, di mana, dan siapa yang mengurusnya. Angka aktualnya datang dari Finance."
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-pill text-mute">
            {asset === undefined
              ? object === undefined
                ? "Tanpa aset — pilih objek dan site"
                : `Objek ${object.label.toLowerCase()}`
              : "Objek dan site ikut asetnya"}
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
              {save.isPending ? "Menyimpan…" : "Simpan perbaikan"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {save.error instanceof Error && (
          <Banner tone="bad">{save.error.message}</Banner>
        )}

        <Section title="Masalah">
          <Field label="Masalah" problem={problems.title || undefined}>
            <Input
              value={form.title ?? ""}
              onChange={(event) => set("title", event.target.value)}
              placeholder="mis. AC cassette tidak dingin"
              autoFocus
            />
          </Field>
        </Section>

        <Section title="Aset dan objek" aside="objek ikut kelas asetnya">
          <Field
            label="Aset"
            aside={asset === undefined ? "kosong = tanpa aset" : undefined}
          >
            <Select
              value={form.asset ?? ""}
              onChange={(next) => set("asset", next)}
              aria-label="Aset"
            >
              <option value="">Tanpa aset: bangunan, pengecatan, dll.</option>
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
                label="Objek"
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

        <Section title="Tempat dan vendor">
          {asset === undefined && (
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
          <Field label="Vendor" problem={problems.vendor || undefined}>
            <Select
              value={form.vendor ?? ""}
              onChange={(next) => set("vendor", next)}
              aria-label="Vendor"
            >
              <option value="">Pilih vendor…</option>
              {(vendors.data?.rows ?? []).map((one) => (
                <option key={one.supplier_id} value={one.supplier_id}>
                  {one.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Kontrak" aside="kosong = tidak dicover kontrak">
            <Select
              value={form.contract ?? ""}
              onChange={(next) => set("contract", next)}
              aria-label="Kontrak"
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

        <Section title="Estimasi dan waktu">
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Estimasi biaya"
              aside="fakta GA; budget menyusul lewat persetujuan"
            >
              <Money
                value={form.estimate ?? ""}
                onChange={(next) => set("estimate", next)}
                placeholder="5000000"
              />
            </Field>
            <Field label="Dilaporkan">
              <Input
                type="date"
                value={form.failure_at ?? new Date().toISOString().slice(0, 10)}
                onChange={(event) => set("failure_at", event.target.value)}
              />
            </Field>
          </div>
          <Field label="Catatan" aside="muncul di bawah masalah di buku">
            <Input
              value={form.notes ?? ""}
              onChange={(event) => set("notes", event.target.value)}
              placeholder="mis. unit 1-04, lantai 2"
            />
          </Field>
          <p className="flex items-center gap-1.5 text-pill text-mute">
            <Wrench className="size-3.5 text-line-ico" />
            {asset !== undefined
              ? "Objek dan akun mengikuti kelas asetnya; site mengikuti aset."
              : object === undefined
                ? "Pilih objeknya — akun usulan mengikuti objek."
                : `Akun usulan: ${object.tag ?? "—"} (Finance tetap bisa mengganti).`}
          </p>
        </Section>
      </div>
    </Sheet>
  )
}
