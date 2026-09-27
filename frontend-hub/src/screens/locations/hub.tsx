import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronRight, MapPin } from "lucide-react"
import { useState } from "react"

import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/field"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, LoadingState } from "@/components/ui/states"
import { count, money } from "@/lib/format"
import { gaKeys, gaLocation, updateGaLocation } from "@/lib/queries/ga"
import { FinanceMark } from "@/screens/contracts/parts"
import { RepairStagePill, TaskStatePill } from "@/screens/maintenance/parts"
import { intervalLabel } from "@/screens/maintenance/format"
import type {
  GaAssetRow,
  GaContractRow,
  GaLocationHub,
  GaLocationRow,
  GaMaintenanceTaskRow,
  GaRepairRow,
  GaSupplyRequestRow,
} from "@itulah/contract"

/// One place, as GA keeps the facilities half of it — and everything the books
/// already point back at.
///
/// # Why the related lists are tabs
///
/// Because each is a different question about the same place and they would
/// bury each other in one column: what is standing here (assets), what has
/// been agreed for it (contracts), what is connected to it (utilities), what
/// is broken (repairs), what is due (the schedule), what was asked for
/// (supplies) and what it has cost this month (Finance's bills). The site's
/// own detail leads, because filling in an address is the one act this sheet
/// exists for.
///
/// # Utilitas is not a fourth list
///
/// `utilities` is the site's Langganan contracts — the same rows as contracts,
/// with the meter reading carried on each. The server splits them because that
/// is how a facilities person asks, and this draws them with the meter beside
/// them rather than as a second kind of record.
export function LocationHubSheet({
  siteId,
  open,
  onClose,
}: {
  siteId: string | undefined
  open: boolean
  onClose: () => void
}) {
  const hub = useQuery({
    queryKey: gaKeys.location(siteId ?? ""),
    queryFn: ({ signal }) => gaLocation(siteId ?? "", signal),
    enabled: open && siteId !== undefined,
  })

  const row = hub.data?.location

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      width="wide"
      title={row === undefined ? "Lokasi" : row.site_name}
      id={siteId}
      caption={
        row === undefined
          ? undefined
          : `${row.kind ?? row.site_kind}${row.address === null ? "" : ` · ${row.address}`}`
      }
      subject={
        siteId === undefined ? undefined : { kind: "location", id: siteId }
      }
      tabs={
        hub.data === undefined
          ? undefined
          : [
              {
                value: "detail",
                label: "Detail",
                content: <DetailTab hub={hub.data} />,
              },
              {
                value: "assets",
                label: "Aset",
                content: <AssetsTab assets={hub.data.assets} />,
              },
              {
                value: "contracts",
                label: "Kontrak",
                content: <ContractsTab contracts={hub.data.contracts} />,
              },
              {
                value: "utilities",
                label: "Utilitas",
                content: <UtilitiesTab utilities={hub.data.utilities} />,
              },
              {
                value: "repairs",
                label: "Perbaikan",
                content: <RepairsTab repairs={hub.data.repairs} />,
              },
              {
                value: "schedule",
                label: "Jadwal",
                content: <ScheduleTab tasks={hub.data.tasks} />,
              },
              {
                value: "supplies",
                label: "Permintaan barang",
                content: <SuppliesTab supplies={hub.data.supplies} />,
              },
              {
                value: "billing",
                label: "Tagihan (Finance)",
                content: <BillingTab row={hub.data.location} />,
              },
            ]
      }
    >
      {hub.isLoading && <LoadingState>Membuka tempatnya…</LoadingState>}
      {hub.error instanceof Error && (
        <Banner tone="bad">{hub.error.message}</Banner>
      )}
    </Sheet>
  )
}

/// The facilities detail, and the one write this screen owns.
///
/// A place with no detail row says so and offers Lengkapi; one that has been
/// filled in offers Ubah. Both open the same form, because "fill in" and
/// "correct" are the same act on a row that upserts by `site_id`.
function DetailTab({ hub }: { hub: GaLocationHub }) {
  const location = hub.location
  const [editing, setEditing] = useState(false)
  const empty =
    location.address === null &&
    location.kind === null &&
    location.contact_name === null &&
    location.contact_phone === null

  return (
    <div className="flex flex-col gap-5">
      {empty && !editing && (
        <section className="rounded-inner border border-hairline-2 bg-soft p-3.5">
          <div className="flex items-center gap-2">
            <MapPin className="size-4 shrink-0 stroke-[1.7] text-line-ico" />
            <p className="text-meta text-body">
              Tempat ini sudah terdaftar — alamat, jenis dan kontaknya belum
              diisi. Lengkapi detailnya supaya orang yang mengirim barang atau
              teknisi tahu harus ke mana.
            </p>
          </div>
        </section>
      )}

      <section>
        <h4 className="mb-2.5 border-b border-hairline pb-1.5 text-card-title font-semibold text-ink">
          Detail tempat
        </h4>
        <Facts>
          <Fact term="Nama">{location.site_name}</Fact>
          <Fact term="Kode">{location.site_id}</Fact>
          <Fact term="Jenis">{location.kind ?? location.site_kind}</Fact>
          <Fact term="Alamat">{location.address ?? "—"}</Fact>
          <Fact term="Luas">
            {location.floor_area_sqm === null
              ? "—"
              : `${count(location.floor_area_sqm)} m²`}
          </Fact>
          <Fact term="Kontak">{location.contact_name ?? "—"}</Fact>
          <Fact term="Telepon">{location.contact_phone ?? "—"}</Fact>
          {location.notes !== null && (
            <Fact term="Catatan">{location.notes}</Fact>
          )}
        </Facts>
      </section>

      {editing ? (
        <LocationEditForm
          row={location}
          onDone={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div>
          <Button variant="soft" onClick={() => setEditing(true)}>
            {empty ? "Lengkapi" : "Ubah detail"}
          </Button>
        </div>
      )}
    </div>
  )
}

/// The form's empty string, as the wire spells "not given".
function blank(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim()
  return trimmed === "" ? null : trimmed
}

/// Filling in or correcting the facility facts. Site creation is deliberately
/// absent: this writes BESIDE a place the register already holds.
function LocationEditForm({
  row,
  onDone,
  onCancel,
}: {
  row: GaLocationRow
  onDone: () => void
  onCancel: () => void
}) {
  const client = useQueryClient()
  const [form, setForm] = useState<Record<string, string>>({
    kind: row.kind ?? "",
    address: row.address ?? "",
    area: row.floor_area_sqm === null ? "" : String(row.floor_area_sqm),
    contact_name: row.contact_name ?? "",
    contact_phone: row.contact_phone ?? "",
    notes: row.notes ?? "",
  })
  const [problems, setProblems] = useState<Record<string, string>>({})
  const set = (key: string, value: string) => {
    // Editing a field takes its error back (brief §10.2): a problem sentence
    // survives only while the field itself is still wrong.
    setProblems((current) => ({ ...current, [key]: "" }))
    setForm((current) => ({ ...current, [key]: value }))
  }

  const save = useMutation({
    mutationFn: () =>
      updateGaLocation(row.site_id, {
        kind: blank(form.kind),
        address: blank(form.address),
        floor_area_sqm:
          (form.area ?? "").trim() === "" ? null : Number(form.area),
        contact_name: blank(form.contact_name),
        contact_phone: blank(form.contact_phone),
        notes: blank(form.notes),
      }),
    onSuccess: () => {
      // The list's address column and this hub are the same answer under the
      // GA prefix; both drop together.
      void client.invalidateQueries({ queryKey: gaKeys.all })
      onDone()
    },
  })

  const submit = () => {
    const next: Record<string, string> = {}
    if (
      (form.area ?? "").trim() !== "" &&
      !/^\d+$/.test((form.area ?? "").trim())
    ) {
      next.area = "Isi angka saja, tanpa titik."
    }
    if (Object.keys(next).length > 0) {
      setProblems(next)
      return
    }
    save.mutate()
  }

  return (
    <div className="rounded-inner border border-hairline-2 p-3.5">
      {save.error instanceof Error && (
        <Banner tone="bad">{save.error.message}</Banner>
      )}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Jenis tempat" aside="toko, gudang, kantor, mess">
          <Input
            value={form.kind ?? ""}
            onChange={(event) => set("kind", event.target.value)}
            placeholder="Toko"
          />
        </Field>
        <Field
          label="Luas"
          aside="meter persegi"
          problem={problems.area || undefined}
        >
          <Input
            type="number"
            inputMode="numeric"
            value={form.area ?? ""}
            onChange={(event) => set("area", event.target.value)}
            placeholder="120"
          />
        </Field>
        <Field label="Alamat">
          <Input
            value={form.address ?? ""}
            onChange={(event) => set("address", event.target.value)}
            placeholder="Jl. … No. …, Kel. …, Kec. …"
          />
        </Field>
        <Field label="Kontak">
          <Input
            value={form.contact_name ?? ""}
            onChange={(event) => set("contact_name", event.target.value)}
            placeholder="Nama yang bisa dihubungi"
          />
        </Field>
        <Field label="Telepon kontak">
          <Input
            value={form.contact_phone ?? ""}
            onChange={(event) => set("contact_phone", event.target.value)}
            placeholder="0812…"
          />
        </Field>
        <Field label="Catatan">
          <Input
            value={form.notes ?? ""}
            onChange={(event) => set("notes", event.target.value)}
            placeholder="mis. mess disewa, satu kontrak beberapa toko"
          />
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button variant="primary" disabled={save.isPending} onClick={submit}>
          {save.isPending ? "Menyimpan…" : "Simpan detail"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Batal
        </Button>
      </div>
    </div>
  )
}

/// The things standing here. Each opens the asset's own hub, the same sheet
/// the register opens — a related list is a door, not a copy.
function AssetsTab({ assets }: { assets: readonly GaAssetRow[] }) {
  if (assets.length === 0) {
    return (
      <p className="text-meta text-body">
        Belum ada aset di tempat ini. Aset dicatat dari register saat barangnya
        datang, dan site-nya ikut tercatat di sana.
      </p>
    )
  }
  return (
    <ul className="flex flex-col">
      {assets.map((asset) => (
        <li key={asset.asset_id}>
          <AppLink
            to="/assets"
            sheet={{ key: "asset", value: asset.asset_id }}
            className="flex items-center gap-3 border-b border-hairline py-2.5 transition-colors last:border-b-0 hover:bg-soft-2"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-cell font-medium text-ink">
                {asset.name}
              </span>
              <span className="block truncate font-mono text-pill text-mute">
                {asset.asset_number}
                {asset.sub_location === null ? "" : ` · ${asset.sub_location}`}
              </span>
            </span>
            <span className="shrink-0 text-pill text-mute">
              {asset.holder ?? "tanpa pemegang"}
            </span>
            <ChevronRight className="size-4 shrink-0 stroke-[1.7] text-faint" />
          </AppLink>
        </li>
      ))}
    </ul>
  )
}

/// The deals that apply to this place. A scope contract (all stores) is not
/// listed here — the server's `contracts` are the ones that name this site,
/// and the estate-wide ones live in Contracts.
function ContractsTab({ contracts }: { contracts: readonly GaContractRow[] }) {
  if (contracts.length === 0) {
    return (
      <p className="text-meta text-body">
        Tidak ada kontrak yang menunjuk tempat ini. Kontrak dicatat dari
        perjanjiannya di GA › Contracts.
      </p>
    )
  }
  return (
    <ul className="flex flex-col">
      {contracts.map((contract) => (
        <li key={contract.contract_id}>
          <AppLink
            to="/contracts/sewa"
            sheet={{ key: "contract", value: contract.contract_id }}
            className="flex items-center gap-3 border-b border-hairline py-2.5 transition-colors last:border-b-0 hover:bg-soft-2"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-cell font-medium text-ink">
                {contract.contract_type_name}
              </span>
              <span className="block truncate font-mono text-pill text-mute">
                {contract.contract_number ?? contract.contract_id.slice(0, 8)}
              </span>
            </span>
            <span className="shrink-0 text-pill text-mute">
              {partyOf(contract)}
            </span>
            <ChevronRight className="size-4 shrink-0 stroke-[1.7] text-faint" />
          </AppLink>
        </li>
      ))}
    </ul>
  )
}

/// The site's subscriptions, with the meter reading carried on each row. The
/// amount billed is Finance's, and wears the mark; the usage is GA's own.
function UtilitiesTab({ utilities }: { utilities: readonly GaContractRow[] }) {
  if (utilities.length === 0) {
    return (
      <p className="text-meta text-body">
        Tidak ada langganan di tempat ini — listrik, air atau telepon belum
        tercatat sebagai kontrak Langganan.
      </p>
    )
  }
  return (
    <ul className="flex flex-col">
      {utilities.map((contract) => (
        <li key={contract.contract_id}>
          <AppLink
            to="/contracts/utilities"
            sheet={{ key: "contract", value: contract.contract_id }}
            className="flex items-center gap-3 border-b border-hairline py-2.5 transition-colors last:border-b-0 hover:bg-soft-2"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-cell font-medium text-ink">
                {partyOf(contract)}
              </span>
              <span className="block truncate text-pill text-mute">
                {contract.contract_type_name}
                {contract.customer_number === null
                  ? ""
                  : ` · ${contract.customer_number}`}
              </span>
            </span>
            <span className="shrink-0 text-right text-pill text-mute tabular-nums">
              {contract.last_usage === null ? (
                "belum ada bacaan"
              ) : (
                <>
                  {count(contract.last_usage)} {contract.last_unit}
                  <span className="block">
                    {contract.billed_minor === 0
                      ? "belum ditagih"
                      : money(contract.billed_minor)}
                  </span>
                </>
              )}
            </span>
            <ChevronRight className="size-4 shrink-0 stroke-[1.7] text-faint" />
          </AppLink>
        </li>
      ))}
    </ul>
  )
}

/// The breakdowns filed here, each opening its own repair sheet.
function RepairsTab({ repairs }: { repairs: readonly GaRepairRow[] }) {
  if (repairs.length === 0) {
    return (
      <p className="text-meta text-body">Tidak ada perbaikan di tempat ini.</p>
    )
  }
  return (
    <ul className="flex flex-col">
      {repairs.map((repair) => (
        <li key={repair.repair_id}>
          <AppLink
            to="/maintenance"
            sheet={{ key: "repair", value: repair.repair_id }}
            className="flex items-center gap-3 border-b border-hairline py-2.5 transition-colors last:border-b-0 hover:bg-soft-2"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-cell font-medium text-ink">
                {repair.title}
              </span>
              <span className="block truncate text-pill text-mute">
                {repair.asset_name ?? "tanpa aset"}
              </span>
            </span>
            <RepairStagePill status={repair.status} />
            <ChevronRight className="size-4 shrink-0 stroke-[1.7] text-faint" />
          </AppLink>
        </li>
      ))}
    </ul>
  )
}

/// The recurring work at this place. A task has no sheet — the schedule IS its
/// surface — so these rows say what is due and stop there.
function ScheduleTab({ tasks }: { tasks: readonly GaMaintenanceTaskRow[] }) {
  if (tasks.length === 0) {
    return (
      <p className="text-meta text-body">
        Tidak ada jadwal servis untuk tempat ini. Jadwal dibuat di Maintenance ›
        Jadwal, untuk satu tempat atau satu aset.
      </p>
    )
  }
  return (
    <ul className="flex flex-col">
      {tasks.map((task) => (
        <li
          key={task.task_id}
          className="flex items-center gap-3 border-b border-hairline py-2.5 last:border-b-0"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-cell text-ink">
              {task.title}
            </span>
            <span className="block truncate text-pill text-mute">
              {intervalLabel(task.interval_kind, task.interval_value)}
              {task.asset_id === null ? "" : " · per aset"}
            </span>
          </span>
          <TaskStatePill nextDue={task.next_due} />
        </li>
      ))}
    </ul>
  )
}

/// What was asked for from this place, each opening its own supply sheet.
function SuppliesTab({
  supplies,
}: {
  supplies: readonly GaSupplyRequestRow[]
}) {
  if (supplies.length === 0) {
    return (
      <p className="text-meta text-body">
        Tidak ada permintaan barang dari tempat ini.
      </p>
    )
  }
  return (
    <ul className="flex flex-col">
      {supplies.map((supply) => (
        <li key={supply.request_id}>
          <AppLink
            to="/supplies"
            sheet={{ key: "supply", value: supply.request_id }}
            className="flex items-center gap-3 border-b border-hairline py-2.5 transition-colors last:border-b-0 hover:bg-soft-2"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-cell font-medium text-ink">
                {supply.item}
              </span>
              <span className="block truncate text-pill text-mute">
                {supply.category_name}
                {supply.quantity === null ? "" : ` · ${supply.quantity}`}
              </span>
            </span>
            <span className="shrink-0 text-pill text-mute">
              {supply.requested_by}
            </span>
            <ChevronRight className="size-4 shrink-0 stroke-[1.7] text-faint" />
          </AppLink>
        </li>
      ))}
    </ul>
  )
}

/// This month's bills that point at the place — Finance's ledger, read over
/// the fence and marked as such. No bill line can point at a site until the
/// relevant references land; the figure is honest about being an em dash when
/// there is nothing to read rather than pretending it is zero spent.
function BillingTab({ row }: { row: GaLocationRow }) {
  return (
    <div className="flex flex-col gap-4">
      <figure>
        <figcaption className="text-eyebrow font-medium text-body">
          Tagihan bulan ini <FinanceMark className="ml-1 align-[0.125rem]" />
        </figcaption>
        <div className="mt-1 text-[1.125rem] leading-none font-semibold tracking-[-0.02em] text-ink tabular-nums">
          {money(row.billed_this_month_minor)}
        </div>
      </figure>
      <p className="text-pill text-mute">
        Dihitung dari baris tagihan POSTED yang ber-site di tempat ini, dan
        site-nya dibaca dari record GA yang dirujuknya (kontrak, perbaikan,
        aset, permintaan). Angka ini milik Finance; GA hanya membacanya.
      </p>
      <Facts>
        <Fact term="Permintaan barang">{count(row.supply_request_count)}</Fact>
        <Fact term="Jadwal jatuh tempo">{count(row.due_task_count)}</Fact>
        <Fact term="Perbaikan terbuka">{count(row.open_repair_count)}</Fact>
        <Fact term="Kontrak">{count(row.contract_count)}</Fact>
      </Facts>
    </div>
  )
}

/// The contract's party, in the words every GA surface already prints. Kept
/// local because this file's lists only need the name.
function partyOf(contract: GaContractRow): string {
  return contract.supplier_name ?? contract.counterparty_name ?? "—"
}
