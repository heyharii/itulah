import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowRight,
  Banknote,
  FileText,
  MoveRight,
  PackageX,
  Paperclip,
  Repeat,
  Trash2,
  TriangleAlert,
  Users,
} from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Choices } from "@/components/ui/form"
import { Field, Input, Money, Select } from "@/components/ui/field"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, LoadingState } from "@/components/ui/states"
import { Pill } from "@/components/ui/pill"
import { buildOf } from "@/lib/builds"
import { day } from "@/lib/format"
import { financeKeys, listAssets, siteAccounts } from "@/lib/queries/finance"
import {
  gaAssetHub,
  gaAssetBuilds,
  gaKeys,
  gaRepairs,
  recordGaReplacement,
  requestGaDisposal,
  transferGaAsset,
  updateGaAsset,
} from "@/lib/queries/ga"
import { procurementKeys, supplierPage } from "@/lib/queries/procurement"
import { uploadDocument } from "@/lib/queries/workplace"
import type { GaAssetRow, GaDocument } from "@itulah/contract"

/// One asset, as GA keeps it — and nothing about what it is worth.
///
/// # Why there is no rupiah on this sheet
///
/// Finance has the same asset with the cost, the method and the monthly charge
/// on it, and that is the screen for somebody deciding what to do with the
/// money. This one is for the person standing in front of the thing: where it
/// is, what is written on its plate, who holds it, whether it still works, and
/// which papers about it are about to expire. A shop manager can be handed this
/// screen without being shown what the company carries its building at.
///
/// # Why the history is a tab and not a column
///
/// Because it grows without limit and it is read occasionally — when somebody
/// asks "when did this move to C012". The facts are what the sheet is opened
/// for; the history is what it is consulted for.
export function AssetHubSheet({
  assetId,
  open,
  onClose,
  onProposeReplacement,
  onRequestDisposal,
}: {
  assetId: string | undefined
  open: boolean
  onClose: () => void
  /// Opens the replacement sheet when a proposal is filed — the swap is a
  /// record people read in Maintenance › Replacement, and the proposal
  /// should land them on it, not leave them guessing whether it saved.
  onProposeReplacement?: (replacementId: string) => void
  /// Opens the disposal sheet when a request is filed, for the same reason.
  onRequestDisposal?: (disposalId: string) => void
}) {
  const hub = useQuery({
    queryKey: gaKeys.asset(assetId ?? ""),
    queryFn: ({ signal }) => gaAssetHub(assetId ?? "", signal),
    enabled: open && assetId !== undefined,
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      width="wide"
      title={hub.data === undefined ? "Aset" : hub.data.asset.name}
      id={hub.data?.asset.asset_number}
      caption={hub.data?.asset.acquired_via ?? undefined}
      subject={
        assetId === undefined ? undefined : { kind: "asset", id: assetId }
      }
      badge={
        hub.data === undefined ? undefined : (
          <>
            <Pill tone={gaStatusTone(hub.data.asset.status)}>
              {gaStatusWords(hub.data.asset.status)}
            </Pill>
            <Pill
              tone={
                hub.data.asset.finance_decision === null ? "warn" : "neutral"
              }
            >
              {hub.data.asset.finance_decision === null
                ? "Finance belum menilai"
                : "Finance sudah menilai"}
            </Pill>
          </>
        )
      }
      tabs={
        hub.data === undefined
          ? undefined
          : [
              {
                value: "detail",
                label: "Detail",
                content: (
                  <DetailTab
                    asset={hub.data.asset}
                    onProposeReplacement={onProposeReplacement}
                    onRequestDisposal={onRequestDisposal}
                  />
                ),
              },
              {
                value: "documents",
                label: "Dokumen",
                content: (
                  <DocumentsTab
                    asset={hub.data.asset}
                    documents={hub.data.documents}
                  />
                ),
              },
              {
                value: "history",
                label: "Riwayat",
                content: (
                  <ol className="flex flex-col">
                    {hub.data.events.map((event) => (
                      <li
                        key={event.event_id}
                        className="flex items-baseline gap-3 border-b border-hairline py-2.5 last:border-b-0"
                      >
                        <span className="w-24 shrink-0 text-pill text-mute tabular-nums">
                          {day(event.occurred_on)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-cell text-ink">
                            {event.reason}
                          </span>
                          <span className="block text-pill text-mute">
                            {event.recorded_by}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ol>
                ),
              },
              {
                value: "accounts",
                label: "Akun kelas",
                content: <AccountsTab asset={hub.data.asset} />,
              },
            ]
      }
    >
      {hub.isLoading && <LoadingState>Membuka asetnya…</LoadingState>}
      {hub.error instanceof Error && (
        <Banner tone="bad">{hub.error.message}</Banner>
      )}
    </Sheet>
  )
}

/// The facts, and the things GA can do to them from here.
///
/// # Three actions, one open at a time
///
/// Pindahkan, Ganti and Ajukan pelepasan are the three ways an asset leaves
/// this state, and each is a form with a reason in it. They are gated on the
/// asset being LIVE: a draft nobody has walked the floor for cannot be
/// swapped, and an asset already replaced or disposed has no further business
/// on this sheet's action row.
function DetailTab({
  asset,
  onProposeReplacement,
  onRequestDisposal,
}: {
  asset: GaAssetRow
  onProposeReplacement?: (replacementId: string) => void
  onRequestDisposal?: (disposalId: string) => void
}) {
  const client = useQueryClient()
  const [action, setAction] = useState<"move" | "replace" | "dispose" | null>(
    null
  )

  // The build's own field names, so a spec reads "Kapasitas" rather than
  // "capacity". The same cached list the register form uses — one fetch for the
  // whole app, because the eleven do not change.
  const schema = useQuery({
    queryKey: gaKeys.builds(),
    queryFn: ({ signal }) => gaAssetBuilds(signal),
    staleTime: Infinity,
  })
  const specFields = schema.data?.builds.find(
    (one) => one.build === asset.build
  )?.fields

  const sites = useQuery({
    queryKey: financeKeys.assets(false, null),
    queryFn: ({ signal }) => listAssets({ limit: 1 }, signal),
    staleTime: 5 * 60 * 1000,
  })

  const build = buildOf(asset.build)
  const live = asset.status === "REGISTERED" || asset.status === "IN_SERVICE"

  const done = () => {
    setAction(null)
    void client.invalidateQueries({ queryKey: gaKeys.all })
  }

  return (
    <div className="flex flex-col gap-5">
      {asset.status === "DRAFT" && <CompleteDraft asset={asset} />}

      <section>
        <h4 className="mb-2.5 border-b border-hairline pb-1.5 text-card-title font-semibold text-ink">
          Detail
        </h4>
        <Facts>
          <Fact term="Jenis">{build.label}</Fact>
          <Fact term="Kelas client">{asset.class_name}</Fact>
          <Fact term="Site">{asset.site_id}</Fact>
          <Fact term="Lokasi">{asset.sub_location ?? "—"}</Fact>
          <Fact term="Pemegang">{asset.holder ?? "—"}</Fact>
          <Fact term="Kondisi">{conditionWords(asset.condition)}</Fact>
          <Fact term="Serial / plat">{asset.serial_number ?? "—"}</Fact>
          <Fact term="Diperoleh">{day(asset.acquired_on)}</Fact>
          <Fact term="Tagihan pembelian">
            {asset.acquired_via ?? "belum ditautkan"}
          </Fact>
          <Fact term="Status Finance">
            {asset.finance_decision === null
              ? "belum dinilai"
              : asset.finance_decision}
          </Fact>
        </Facts>
      </section>

      {Object.keys(asset.specs).length > 0 && (
        <section>
          <h4 className="mb-2.5 border-b border-hairline pb-1.5 text-card-title font-semibold text-ink">
            {`Detail ${build.label.toLowerCase()}`}
          </h4>
          <Facts>
            {Object.entries(asset.specs).map(([key, value]) => (
              <Fact
                key={key}
                term={
                  specFields?.find((field) => field.key === key)?.label ?? key
                }
              >
                {String(value)}
              </Fact>
            ))}
          </Facts>
        </section>
      )}

      <section>
        <h4 className="mb-2.5 border-b border-hairline pb-1.5 text-card-title font-semibold text-ink">
          Aksi
        </h4>
        {action === null && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="soft" onClick={() => setAction("move")}>
              <MoveRight />
              Pindahkan
            </Button>
            {live && (
              <>
                <Button variant="soft" onClick={() => setAction("replace")}>
                  <Repeat />
                  Ganti
                </Button>
                <Button variant="soft" onClick={() => setAction("dispose")}>
                  <PackageX />
                  Ajukan pelepasan
                </Button>
              </>
            )}
          </div>
        )}
        {action === "move" && (
          <MoveForm
            asset={asset}
            sites={(sites.data?.facets.sites ?? []).map((one) => one.value)}
            onDone={done}
            onCancel={() => setAction(null)}
          />
        )}
        {action === "replace" && (
          <ReplaceForm
            asset={asset}
            onSaved={(replacementId) => {
              setAction(null)
              void client.invalidateQueries({ queryKey: gaKeys.all })
              onProposeReplacement?.(replacementId)
            }}
            onCancel={() => setAction(null)}
          />
        )}
        {action === "dispose" && (
          <DisposeForm
            asset={asset}
            onSaved={(disposalId) => {
              setAction(null)
              void client.invalidateQueries({ queryKey: gaKeys.all })
              onRequestDisposal?.(disposalId)
            }}
            onCancel={() => setAction(null)}
          />
        )}
      </section>
    </div>
  )
}

/// A thing that arrived on a bill and that nobody has walked the floor for.
///
/// The bill came first and made the row; GA's job is to say where the thing
/// actually is and who has it, which is the half a purchase document cannot
/// know.
function CompleteDraft({ asset }: { asset: GaAssetRow }) {
  const client = useQueryClient()
  const [form, setForm] = useState<Record<string, string>>({})
  const set = (key: string, value: string) =>
    setForm((current) => ({ ...current, [key]: value }))

  const schema = useQuery({
    queryKey: gaKeys.builds(),
    queryFn: ({ signal }) => gaAssetBuilds(signal),
    staleTime: Infinity,
  })
  const build = schema.data?.builds.find((one) => one.build === asset.build)

  const save = useMutation({
    mutationFn: () =>
      updateGaAsset(asset.asset_id, {
        name: blank(form.name),
        sub_location: blank(form.sub_location),
        holder: blank(form.holder),
        serial_number: blank(form.serial_number),
        condition: form.condition ?? asset.condition,
        specs: specsOf(build, form),
        // Absent means "no change" on this surface, and the form does not show
        // a note, so it sends the "leave it" spelling rather than the empty
        // string, which the server would take as "erase it".
        notes: null,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: gaKeys.all })
    },
  })

  const ready =
    (form.sub_location ?? "").trim() !== "" && (form.holder ?? "").trim() !== ""

  return (
    <section className="rounded-inner border border-warn-fg/30 bg-warn-bg/40 p-3.5">
      <h4 className="text-card-title font-semibold text-ink">
        Tagihannya datang lebih dulu
      </h4>
      <p className="mt-1 mb-3 text-meta text-body">
        Aset ini dibuat otomatis saat Finance memposting tagihannya. Pastikan
        barangnya ada, lalu lengkapi lokasi dan pemegangnya.
      </p>
      {save.error instanceof Error && (
        <Banner tone="bad">{save.error.message}</Banner>
      )}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Lokasi di site">
          <Input
            value={form.sub_location ?? ""}
            onChange={(event) => set("sub_location", event.target.value)}
            placeholder="Lt. 1 · area kasir"
          />
        </Field>
        <Field label="Pemegang">
          <Input
            value={form.holder ?? ""}
            onChange={(event) => set("holder", event.target.value)}
            placeholder={`Kepala toko ${asset.site_id}`}
          />
        </Field>
        <Field label="Serial / plat">
          <Input
            value={form.serial_number ?? ""}
            onChange={(event) => set("serial_number", event.target.value)}
          />
        </Field>
        <Field label="Kondisi">
          <Select
            value={form.condition ?? asset.condition}
            onChange={(next) => set("condition", next)}
            aria-label="Kondisi"
          >
            <option value="BAIK">Baik</option>
            <option value="PERLU_SERVIS">Perlu servis</option>
            <option value="RUSAK">Rusak</option>
          </Select>
        </Field>
        {(build?.fields ?? []).map((field) => (
          <Field key={field.key} label={field.label}>
            <Input
              type={field.kind === "DATE" ? "date" : "text"}
              value={form[`spec:${field.key}`] ?? ""}
              onChange={(event) => set(`spec:${field.key}`, event.target.value)}
            />
          </Field>
        ))}
      </div>
      <div className="mt-3">
        <Button
          variant="primary"
          disabled={!ready || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Menyimpan…" : "Simpan dan daftarkan"}
        </Button>
      </div>
    </section>
  )
}

/// Moving one, with a reason and a date.
///
/// The reason is required by the server and by the form: a thing that moves
/// without one is a thing nobody can reconcile six months later, and the site
/// is what Finance's next month of depreciation follows.
function MoveForm({
  asset,
  sites,
  onDone,
  onCancel,
}: {
  asset: GaAssetRow
  sites: readonly string[]
  onDone: () => void
  onCancel: () => void
}) {
  const [form, setForm] = useState<Record<string, string>>({
    to_site: sites.find((one) => one !== asset.site_id) ?? "",
    occurred_on: new Date().toISOString().slice(0, 10),
  })
  const set = (key: string, value: string) =>
    setForm((current) => ({ ...current, [key]: value }))

  const move = useMutation({
    mutationFn: () =>
      transferGaAsset(asset.asset_id, {
        to_site: form.to_site ?? "",
        to_sub_location: blank(form.to_sub_location),
        to_holder: blank(form.to_holder),
        reason: (form.reason ?? "").trim(),
        occurred_on: form.occurred_on ?? "",
      }),
    onSuccess: onDone,
  })

  const ready = (form.to_site ?? "") !== "" && (form.reason ?? "").trim() !== ""

  return (
    <div className="flex flex-col gap-3.5">
      {move.error instanceof Error && (
        <Banner tone="bad">{move.error.message}</Banner>
      )}
      <p className="text-meta text-body">
        Dari <b className="text-ink">{asset.site_id}</b> ·{" "}
        {asset.sub_location ?? "tanpa lokasi"}
      </p>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Ke site">
          <Select
            value={form.to_site ?? ""}
            onChange={(next) => set("to_site", next)}
            aria-label="Ke site"
          >
            <option value="">Pilih…</option>
            {sites
              .filter((one) => one !== asset.site_id)
              .map((one) => (
                <option key={one} value={one}>
                  {one}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Lokasi di site">
          <Input
            value={form.to_sub_location ?? ""}
            onChange={(event) => set("to_sub_location", event.target.value)}
            placeholder="Gudang lt. 1"
          />
        </Field>
        <Field label="Pemegang baru">
          <Input
            value={form.to_holder ?? ""}
            onChange={(event) => set("to_holder", event.target.value)}
            placeholder={asset.holder ?? ""}
          />
        </Field>
        <Field label="Tanggal pindah">
          <Input
            type="date"
            value={form.occurred_on ?? ""}
            onChange={(event) => set("occurred_on", event.target.value)}
          />
        </Field>
      </div>
      <Field label="Alasan" aside="masuk riwayat aset">
        <Input
          value={form.reason ?? ""}
          onChange={(event) => set("reason", event.target.value)}
          placeholder="mis. Toko C013 buka"
        />
      </Field>
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          disabled={!ready || move.isPending}
          onClick={() => move.mutate()}
        >
          <ArrowRight />
          {move.isPending ? "Memindahkan…" : "Pindahkan"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Batal
        </Button>
      </div>
    </div>
  )
}

/// Proposing a replacement for this asset — the swap that ends with the old
/// thing marked REPLACED and a new one standing where it stood.
///
/// # Why the vendor and the repair are optional
///
/// The reason is required, because a swap without a why is a question six
/// months later. The vendor and the repair that led here are facts that may
/// not exist yet: a mannequin that cracks was never repaired, and the
/// supplier of the new one may not be chosen. The server takes them null;
/// the form does not invent them.
function ReplaceForm({
  asset,
  onSaved,
  onCancel,
}: {
  asset: GaAssetRow
  onSaved: (replacementId: string) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState<Record<string, string>>({
    proposed_on: new Date().toISOString().slice(0, 10),
  })
  const [problems, setProblems] = useState<Record<string, string>>({})
  const set = (key: string, value: string) => {
    setProblems((current) => ({ ...current, [key]: "" }))
    setForm((current) => ({ ...current, [key]: value }))
  }

  // This asset's own repairs, so the one that led here can be named. Read
  // from the book's first page and sifted here — the register's per-asset
  // question is a small slice of a small book, and a second endpoint for it
  // would be a second answer to keep in step.
  const repairs = useQuery({
    queryKey: gaKeys.repairs({}),
    queryFn: ({ signal }) => gaRepairs({ limit: 200 }, signal),
    staleTime: 5 * 60 * 1000,
  })
  const ownRepairs = (repairs.data?.rows ?? []).filter(
    (one) => one.asset_id === asset.asset_id
  )

  const vendors = useQuery({
    queryKey: [...procurementKeys.suppliers(), "book", "EXPENSE"],
    queryFn: ({ signal }) => supplierPage({ category: "EXPENSE" }, signal),
    staleTime: 5 * 60 * 1000,
  })

  const save = useMutation({
    mutationFn: () =>
      recordGaReplacement({
        old_asset_id: asset.asset_id,
        reason: (form.reason ?? "").trim(),
        repair_id: form.repair === "" ? null : (form.repair ?? null),
        supplier_id: form.vendor === "" ? null : (form.vendor ?? null),
        proposed_on: form.proposed_on ?? "",
      }),
    onSuccess: (row) => {
      setForm({ proposed_on: new Date().toISOString().slice(0, 10) })
      onSaved(row.replacement_id)
    },
  })

  const submit = () => {
    if ((form.reason ?? "").trim() === "") {
      setProblems({ reason: "Tulis alasannya dulu." })
      return
    }
    save.mutate()
  }

  return (
    <div className="flex flex-col gap-3.5">
      {save.error instanceof Error && (
        <Banner tone="bad">{save.error.message}</Banner>
      )}
      <p className="text-meta text-body">
        Penggantian dicatat sebagai kejadian pada aset ini; aset barunya lahir
        saat tahapannya sampai <b className="text-ink">Terpasang</b>, di
        Maintenance › Replacement.
      </p>
      <Field label="Alasan penggantian" problem={problems.reason || undefined}>
        <Input
          value={form.reason ?? ""}
          onChange={(event) => set("reason", event.target.value)}
          placeholder="mis. Rusak berat, tidak ekonomis diperbaiki"
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Perbaikan terkait" aside="opsional">
          <Select
            value={form.repair ?? ""}
            onChange={(next) => set("repair", next)}
            aria-label="Perbaikan terkait"
          >
            <option value="">Tidak ada</option>
            {ownRepairs.map((one) => (
              <option key={one.repair_id} value={one.repair_id}>
                {one.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Vendor" aside="opsional; pemilihan aset barunya menyusul">
          <Select
            value={form.vendor ?? ""}
            onChange={(next) => set("vendor", next)}
            aria-label="Vendor"
          >
            <option value="">Belum dipilih</option>
            {(vendors.data?.rows ?? []).map((one) => (
              <option key={one.supplier_id} value={one.supplier_id}>
                {one.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Tanggal usul">
        <Input
          type="date"
          value={form.proposed_on ?? ""}
          onChange={(event) => set("proposed_on", event.target.value)}
        />
      </Field>
      <div className="flex items-center gap-2">
        <Button variant="primary" disabled={save.isPending} onClick={submit}>
          {save.isPending ? "Mengusulkan…" : "Usulkan penggantian"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Batal
        </Button>
      </div>
    </div>
  )
}

/// The four ways an asset leaves the company, as cards (brief §10.2), with
/// the sale's proceeds asked only when the thing is being SOLD. Filing the
/// request marks the asset DISPOSAL_REQUESTED; Finance's booking of the gain
/// or loss is its own act, in tahap 6.
function DisposeForm({
  asset,
  onSaved,
  onCancel,
}: {
  asset: GaAssetRow
  onSaved: (disposalId: string) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState<Record<string, string>>({
    method: "SOLD",
    requested_on: new Date().toISOString().slice(0, 10),
  })
  const [problems, setProblems] = useState<Record<string, string>>({})
  const set = (key: string, value: string) => {
    setProblems((current) => ({ ...current, [key]: "" }))
    setForm((current) => ({ ...current, [key]: value }))
  }

  const method = form.method ?? "SOLD"

  const save = useMutation({
    mutationFn: () =>
      requestGaDisposal({
        asset_id: asset.asset_id,
        method,
        // Proceeds only make sense for a sale; the wire CHECK agrees, so
        // the other three methods send absence rather than zero.
        proceeds_minor:
          method === "SOLD" && (form.proceeds ?? "") !== ""
            ? Number(form.proceeds)
            : null,
        reason: (form.reason ?? "").trim(),
        requested_on: form.requested_on ?? "",
      }),
    onSuccess: (row) => {
      setForm({
        method: "SOLD",
        requested_on: new Date().toISOString().slice(0, 10),
      })
      onSaved(row.disposal_id)
    },
  })

  const submit = () => {
    const next: Record<string, string> = {}
    if ((form.reason ?? "").trim() === "") next.reason = "Tulis alasannya dulu."
    if (Object.keys(next).length > 0) {
      setProblems(next)
      return
    }
    save.mutate()
  }

  return (
    <div className="flex flex-col gap-3.5">
      {save.error instanceof Error && (
        <Banner tone="bad">{save.error.message}</Banner>
      )}
      <p className="text-meta text-body">
        GA yang mengajukan; asetnya ditandai pelepasan sampai keputusannya, dan
        laba/ruginya Finance yang membukukan.
      </p>
      <Choices
        label="Cara pelepasan"
        columns={2}
        value={method}
        onChange={(next) => set("method", next)}
        options={[
          {
            value: "SOLD",
            label: "Dijual",
            icon: Banknote,
            note: "Ada pihak yang membelinya.",
          },
          {
            value: "SCRAPPED",
            label: "Scrap",
            icon: Trash2,
            note: "Tidak berharga lagi; dibuang.",
          },
          {
            value: "DONATED",
            label: "Dihibahkan",
            icon: Users,
            note: "Diberikan, tanpa bayaran.",
          },
          {
            value: "LOST",
            label: "Hilang",
            icon: TriangleAlert,
            note: "Tidak ditemukan; dicatat rampas/rapuh.",
          },
        ]}
      />
      {method === "SOLD" && (
        <Field
          label="Hasil penjualan"
          aside="kalau angkanya sudah ada; kosong kalau belum"
        >
          <Money
            value={form.proceeds ?? ""}
            onChange={(next) => set("proceeds", next)}
            placeholder="3000000"
          />
        </Field>
      )}
      <Field label="Alasan" problem={problems.reason || undefined}>
        <Input
          value={form.reason ?? ""}
          onChange={(event) => set("reason", event.target.value)}
          placeholder="mis. Rusak berat, diganti unit baru"
        />
      </Field>
      <div className="flex items-center gap-2">
        <Button variant="primary" disabled={save.isPending} onClick={submit}>
          {save.isPending ? "Mengajukan…" : "Ajukan pelepasan"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Batal
        </Button>
      </div>
    </div>
  )
}

/// The papers with a date on them.
///
/// A BPKB has no expiry and a STNK has one, and the difference is the whole
/// reason this tab exists: the certificate that lapses is the one that stops a
/// lift or a lorry working.
///
/// # Why the paper is filed from here and not from the Library
///
/// Because the person who has the paper in their hand is standing at the thing
/// it belongs to. Sending them to another screen to type the asset's number in
/// again is how a register ends up with the documents filed under nothing.
/// What they file still lands in the Library like every other document — this
/// is a door onto the same room, not a second drawer.
function DocumentsTab({
  asset,
  documents,
}: {
  asset: GaAssetRow
  documents: readonly GaDocument[]
}) {
  const client = useQueryClient()
  const [adding, setAdding] = useState(false)

  return (
    <div className="flex flex-col gap-4">
      {documents.length === 0 ? (
        <p className="text-meta text-body">
          Belum ada dokumen. Kertas yang cuma kertas — BPKB, sertifikat laik
          operasi, garansi — ditempel di sini dan terindeks di Library.
        </p>
      ) : (
        <ul className="flex flex-col">
          {documents.map((document) => (
            <li
              key={document.document_id}
              className="flex items-center gap-3 border-b border-hairline py-2.5 last:border-b-0"
            >
              <FileText className="size-4 shrink-0 stroke-[1.7] text-line-ico" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-cell text-ink">
                  {document.doc_type ?? document.title ?? document.name}
                </span>
                <span className="block truncate font-mono text-pill text-mute">
                  {document.doc_number ?? document.name}
                </span>
              </span>
              <span className="shrink-0 text-pill text-mute tabular-nums">
                {document.expires_on === null
                  ? "tanpa masa berlaku"
                  : `s/d ${day(document.expires_on)}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <AttachForm
          asset={asset}
          onDone={() => {
            setAdding(false)
            void client.invalidateQueries({ queryKey: gaKeys.all })
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <div>
          <Button variant="soft" onClick={() => setAdding(true)}>
            <Paperclip />
            Tempel dokumen
          </Button>
        </div>
      )}
    </div>
  )
}

/// Filing one paper against this asset.
///
/// The file is uploaded first and the document filed afterwards, which is the
/// two-step the Library already uses: a slow photograph never blocks the form,
/// and a form that fails does not lose the upload.
function AttachForm({
  asset,
  onDone,
  onCancel,
}: {
  asset: GaAssetRow
  onDone: () => void
  onCancel: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const set = (key: string, value: string) =>
    setForm((current) => ({ ...current, [key]: value }))

  const save = useMutation({
    mutationFn: () => {
      if (file === null) throw new Error("Pilih berkasnya dulu.")
      return uploadDocument(file, {
        title: blank(form.title) ?? undefined,
        doc_type: blank(form.doc_type) ?? undefined,
        doc_number: blank(form.doc_number) ?? undefined,
        issuer: blank(form.issuer) ?? undefined,
        issued_on: blank(form.issued_on) ?? undefined,
        expires_on: blank(form.expires_on) ?? undefined,
        path_tokens: ["GA", asset.asset_number],
        tags: [],
        links: [{ subject_kind: "asset", subject_id: asset.asset_id }],
      })
    },
    onSuccess: onDone,
  })

  return (
    <div className="rounded-inner border border-hairline-2 p-3.5">
      {save.error instanceof Error && (
        <Banner tone="bad">{save.error.message}</Banner>
      )}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Berkasnya">
          <Input
            type="file"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </Field>
        <Field
          label="Jenis kertas"
          hint="STNK, BPKB, sertifikat laik operasi, garansi"
        >
          <Input
            value={form.doc_type ?? ""}
            onChange={(event) => set("doc_type", event.target.value)}
          />
        </Field>
        <Field label="Nomor">
          <Input
            value={form.doc_number ?? ""}
            onChange={(event) => set("doc_number", event.target.value)}
          />
        </Field>
        <Field label="Yang menerbitkan">
          <Input
            value={form.issuer ?? ""}
            onChange={(event) => set("issuer", event.target.value)}
          />
        </Field>
        <Field label="Diterbitkan">
          <Input
            type="date"
            value={form.issued_on ?? ""}
            onChange={(event) => set("issued_on", event.target.value)}
          />
        </Field>
        <Field
          label="Berlaku sampai"
          aside="kosong = kertasnya tanpa masa berlaku"
        >
          <Input
            type="date"
            value={form.expires_on ?? ""}
            onChange={(event) => set("expires_on", event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button
          variant="primary"
          disabled={file === null || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Mengunggah…" : "Simpan dokumen"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Batal
        </Button>
      </div>
    </div>
  )
}

/// Which accounts this class posts to — Finance's decision, read here.
///
/// Read-only, and deliberately so: the class is GA's fact and the account is
/// Finance's, and a GA screen that could set one would be a GA screen that
/// could change the chart. It is shown because the person registering a thing
/// is the person who can tell whether the class is right, and the account is
/// how they check.
function AccountsTab({ asset }: { asset: GaAssetRow }) {
  const map = useQuery({
    queryKey: financeKeys.siteAccounts(asset.site_id),
    queryFn: ({ signal }) => siteAccounts(asset.site_id, signal),
  })

  const rows = (map.data ?? []).filter(
    (row) => row.source_id === asset.class_code
  )

  if (map.isLoading) return <LoadingState>Membaca akun Finance…</LoadingState>

  if (rows.length === 0) {
    return (
      <p className="text-meta text-body">
        Kelas ini belum punya akun di site {asset.site_id}. Finance yang
        memetakannya; sampai itu, penyusutan kelas ini akan ditolak dengan
        kalimat yang menyebut kelas dan site-nya.
      </p>
    )
  }

  return (
    <Facts>
      {rows.map((row) => (
        <Fact key={`${row.role}:${row.source_id}`} term={row.role}>
          <span className="font-mono text-id">{row.account_code}</span>{" "}
          {row.account_name}
        </Fact>
      ))}
    </Facts>
  )
}

/// The register's own lifecycle, in the client's words.
///
/// DISPOSAL_REQUESTED and REPLACED are tahap 4's additions: statuses GA's
/// own actions write (a disposal request, a replacement installed) and that
/// Finance never touches — the money side of leaving service is the other
/// desk's record, not this status.
export function gaStatusWords(status: string): string {
  switch (status) {
    case "DRAFT":
      return "Draft · belum dilengkapi"
    case "IN_PROGRESS":
      return "Dalam pengerjaan"
    case "IN_SERVICE":
      return "Terdaftar"
    case "DISPOSAL_REQUESTED":
      return "Pelepasan diajukan"
    case "REPLACED":
      return "Diganti"
    case "DISPOSED":
      return "Sudah dilepas"
    default:
      return "Terdaftar"
  }
}

function gaStatusTone(status: string): "ok" | "warn" | "neutral" {
  if (status === "DRAFT") return "warn"
  if (status === "DISPOSAL_REQUESTED") return "warn"
  if (status === "DISPOSED" || status === "REPLACED") return "neutral"
  return "ok"
}

function conditionWords(condition: string): string {
  switch (condition) {
    case "PERLU_SERVIS":
      return "Perlu servis"
    case "RUSAK":
      return "Rusak"
    default:
      return "Baik"
  }
}

function specsOf(
  build: { fields: readonly { key: string }[] } | undefined,
  form: Readonly<Record<string, string>>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const field of build?.fields ?? []) {
    const value = (form[`spec:${field.key}`] ?? "").trim()
    if (value !== "") out[field.key] = value
  }
  return out
}

function blank(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim()
  return trimmed === "" ? null : trimmed
}
