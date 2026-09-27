import { useQuery } from "@tanstack/react-query"
import { useRouterState } from "@tanstack/react-router"
import { Plus } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { count, money, span } from "@/lib/format"
import { gaContracts, gaKeys } from "@/lib/queries/ga"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { ContractComposer } from "@/screens/contracts/composer"
import { monthLabel, partyOf, siteOf } from "@/screens/contracts/format"
import { ContractHubSheet } from "@/screens/contracts/hub"
import { CONTRACT_GROUPS } from "@/screens/contracts/nav"
import { FinanceMark, StandingPill } from "@/screens/contracts/parts"
import type { GaContractRow } from "@itulah/contract"

/// The contract register — six group doors plus the two hidden views, all
/// reading one screen.
///
/// # The URL decides the reading
///
/// `/contracts/sewa` and `/contracts/jasa` are the same table narrowed by
/// `group`; `/contracts/utilities` is Langganan read per PLACE; `/contracts/
/// cleaning` is Jasa narrowed to `JASA_CLEANING`. One screen and one endpoint,
/// because the register answers one question — "what have we signed" — and a
/// screen per door would be six copies of the same columns drifting apart.
///
/// # What the strip above the table is allowed to sum
///
/// The page the server sends carries rows, a total and facets — no sums. The
/// strip reads the SAME rows the table draws, so the two can never disagree;
/// `limit` stays at the register's working size (the whole point of the six
/// groups is that none of them is a report).
///
/// # Ditagih reads zero today, and that is honest
///
/// `billed_minor` counts POSTED bill lines pointing at the contract, and the
/// column that lets a bill line point (`contract_id`) lands in tahap 6. Until
/// then the figure is zero because nothing CAN point yet — the mark beside it
/// says the figure is Finance's ledger, and the hub says where it is computed
/// from. Dropping the column until tahap 6 would hide the place the number
/// will live.
type Reading = {
  title: string
  sub: string
  /// The `group=` the register is narrowed by, when this is a group door.
  group?: string
  /// The `type=` for Cleaning, which narrows Jasa to one kind instead.
  type?: string
  /// The group the composer starts on, when Tambah kontrak is pressed here.
  composerGroup: string
  /// Utilities re-sorts by site and swaps its columns; cleaning only drops
  /// the Jenis column, whose every row would say the same word.
  kind: "group" | "utilities" | "cleaning"
}

function readingFor(pathname: string): Reading {
  const slug = pathname.replace("/contracts/", "")
  const group = CONTRACT_GROUPS.find((one) =>
    slug.startsWith(one.label.toLowerCase())
  )
  if (group) {
    return {
      kind: "group",
      title: group.label,
      sub: GROUP_LEADS[group.group_code],
      group: group.group_code,
      composerGroup: group.group_code,
    }
  }
  if (slug === "utilities") {
    return {
      kind: "utilities",
      title: "Langganan per lokasi",
      sub: "Lihat kontrak listrik, air, telepon, dan internet menurut tempatnya.",
      group: "LANGGANAN",
      composerGroup: "LANGGANAN",
    }
  }
  return {
    kind: "cleaning",
    title: "Jasa kebersihan",
    sub: "Lihat kontrak kebersihan dan masa berlakunya.",
    type: "JASA_CLEANING",
    composerGroup: "JASA",
  }
}

/// The group leads, in the prototype's words.
const GROUP_LEADS: Record<string, string> = {
  SEWA: "Tanah, toko, gudang, kantor, rumah/mess, dan kendaraan yang disewa perusahaan.",
  JASA: "Layanan rutin seperti pemeliharaan dan kebersihan.",
  ASURANSI: "Polis properti dan kendaraan, dengan tanggal habisnya.",
  IZIN: "Izin usaha, STNK/KIR, PBB dan pajak reklame: semua yang punya tanggal habis dan harus diperpanjang.",
  LANGGANAN:
    "Sambungan listrik, air, telepon, dan internet untuk setiap lokasi.",
  DISEWAKAN: "Ruang dan peralatan yang perusahaan sewakan ke pihak lain.",
}

export function Contracts() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const view = readingFor(pathname)
  const open = useSheet("contract")
  const [search, setSearch] = useState("")
  const [archived, setArchived] = useState(false)
  const [adding, setAdding] = useState(false)

  const scope = useMemo(
    () => ({
      q: search.trim() === "" ? undefined : search.trim(),
      group: view.group,
      type: view.type,
      // The archive is the register's only way back out of the list, so the
      // reading is explicit: the default list is the living register, and the
      // archived contracts are one deliberate click away rather than gone.
      archived: archived || undefined,
      limit: 200,
    }),
    [search, archived, view.group, view.type]
  )

  const register = useQuery({
    queryKey: gaKeys.contracts(scope),
    queryFn: ({ signal }) => gaContracts(scope, signal),
  })

  const rows = useMemo(() => {
    const loaded = register.data?.rows ?? []
    // Utilities reads the same rows sorted by PLACE: the question this view
    // answers is "what is connected there", and a register order would
    // scatter one site's sambungan across the table.
    if (view.kind === "utilities") {
      return [...loaded].sort((a, b) =>
        (a.site_id ?? "").localeCompare(b.site_id ?? "")
      )
    }
    return loaded
  }, [register.data, view.kind])

  return (
    <PageContent>
      <PageHeader
        crumb="Kontrak"
        title={view.title}
        sub={view.sub}
        actions={
          <>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nomor, pihak, atau lokasi"
              className="h-8 w-56"
            />
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus />
              Tambah kontrak
            </Button>
          </>
        }
      />

      {register.data !== undefined && <SummaryStrip rows={rows} view={view} />}

      <Toolbar>
        <Segmented
          options={[
            { value: "LIVE" as const, label: "Aktif" },
            { value: "ARCHIVED" as const, label: "Arsip" },
          ]}
          value={archived ? "ARCHIVED" : "LIVE"}
          onChange={(next) => setArchived(next === "ARCHIVED")}
        />
        <Toolbar.Spacer />
        {register.data !== undefined && (
          <span className="text-meta text-body">
            <b className="font-medium text-ink">{count(register.data.total)}</b>{" "}
            kontrak
          </span>
        )}
      </Toolbar>

      {queryState(register, {
        loading: "Memuat daftar kontrak…",
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
                {archived
                  ? "Arsipnya kosong. Kontrak yang diarsipkan pindah ke sini, bukan hilang."
                  : "Belum ada kontrak di bacaan ini. Kontrak dicatat dari perjanjiannya: jenisnya, pihaknya, jendela waktunya."}
              </EmptyState>
            </Card>
          ) : (
            <ContractTable view={view} rows={rows} onOpen={open.open} />
          ),
      })}

      {/* Keyed per door and per record: the composer re-arms on the door it
          is opened from, and the hub drops its archive question (and its own
          tab) whenever another contract opens. Without the key, a cancelled
          form would leak a Sewa type into a Cleaning composer and an abandoned
          archive reason would still be waiting under the next contract. */}
      <ContractComposer
        key={view.composerGroup}
        open={adding}
        group={view.composerGroup}
        onClose={() => setAdding(false)}
        onSaved={(contractId) => {
          setAdding(false)
          open.open(contractId)
        }}
      />

      <ContractHubSheet
        key={open.value ?? "none"}
        contractId={open.value}
        open={open.isOpen}
        onClose={open.close}
      />
    </PageContent>
  )
}

/// The strip between the header and the table: the four figures a group is
/// managed by. All computed from the rows below, for the reason the type
/// comment gives — the server sends no sums, and a strip that fetched its own
/// answer would drift from the table it sits above.
function SummaryStrip({
  rows,
  view,
}: {
  rows: readonly GaContractRow[]
  view: Reading
}) {
  const active = rows.filter(
    (row) => row.standing === "AKTIF" || row.standing === "SEGERA_HABIS"
  )
  const renew = rows.filter(
    (row) => row.standing === "SEGERA_HABIS" || row.standing === "HABIS"
  )
  const billed = rows.reduce((sum, row) => sum + row.billed_minor, 0)

  if (view.kind === "utilities") {
    return (
      <KpiStrip className="md:grid-cols-2 xl:grid-cols-2">
        <Kpi label="Sambungan" value={count(rows.length)} />
        <Kpi
          label={
            <>
              Ditagih s/d hari ini{" "}
              <FinanceMark className="ml-1 align-[0.125rem]" />
            </>
          }
          value={money(billed)}
        />
      </KpiStrip>
    )
  }

  return (
    <KpiStrip className="md:grid-cols-2 xl:grid-cols-4">
      <Kpi label="Aktif" value={count(active.length)} />
      <Kpi label="Perlu diperpanjang" value={count(renew.length)} />
      <Kpi
        label="Nilai kontrak aktif"
        value={money(
          active.reduce((sum, row) => sum + (row.contract_value_minor ?? 0), 0)
        )}
      />
      {/* Disewakan is the one group where the money flows IN, so the same
          column reads "diterima" there — the ledger behind it is the other
          desk's either way, hence the mark. */}
      <Kpi
        label={
          <>
            {view.group === "DISEWAKAN"
              ? "Diterima s/d hari ini"
              : "Ditagih s/d hari ini"}{" "}
            <FinanceMark className="ml-1 align-[0.125rem]" />
          </>
        }
        value={money(billed)}
      />
    </KpiStrip>
  )
}

/// The register's table, drawn per reading. The columns are the prototype's:
/// the paper's number, the parties, the deal's shape, where it applies, its
/// window and its two money columns — the last marked Finance's, because they
/// are read out of Finance's bill lines, not out of this register.
function ContractTable({
  view,
  rows,
  onOpen,
}: {
  view: Reading
  rows: readonly GaContractRow[]
  onOpen: (contractId: string) => void
}) {
  return (
    <Card className="overflow-hidden">
      {/* The register scrolls INSIDE its own box rather than squeezing the
          columns: eight columns of numbers, names and windows do not fit a
          phone, and a squeezed table overlaps its own cells while the page
          itself starts scrolling sideways. The same answer the asset register
          gives. */}
      <div className="overflow-x-auto">
        {view.kind === "utilities" ? (
          <div className="min-w-[61rem]">
            <div className="grid h-10 grid-cols-[minmax(13rem,1fr)_6.5rem_10rem_9rem_10rem_9rem] items-center gap-3 border-b border-hairline bg-soft px-3.5 text-eyebrow font-medium text-body">
              <span>Penyedia</span>
              <span>Site</span>
              <span>ID pelanggan</span>
              <span className="text-right">
                Ditagih <FinanceMark className="ml-1 align-[0.0625rem]" />
              </span>
              <span>Pemakaian terakhir</span>
              <span>Status</span>
            </div>
            {rows.map((row) => (
              <UtilityRow key={row.contract_id} row={row} onOpen={onOpen} />
            ))}
          </div>
        ) : view.kind === "cleaning" ? (
          <div className="min-w-[68rem]">
            <div className="grid h-10 grid-cols-[7rem_minmax(13rem,1fr)_6.5rem_11rem_8.5rem_8.5rem_9rem] items-center gap-3 border-b border-hairline bg-soft px-3.5 text-eyebrow font-medium text-body">
              <span>Nomor</span>
              <span>Pihak</span>
              <span>Site</span>
              <span>Periode</span>
              <span className="text-right">Nilai kontrak</span>
              <span className="text-right">
                Ditagih <FinanceMark className="ml-1 align-[0.0625rem]" />
              </span>
              <span>Status</span>
            </div>
            {rows.map((row) => (
              <GroupRow
                key={row.contract_id}
                row={row}
                onOpen={onOpen}
                showType={false}
              />
            ))}
          </div>
        ) : (
          <div className="min-w-[78rem]">
            <div className="grid h-10 grid-cols-[7rem_minmax(12rem,1fr)_10rem_6.5rem_11rem_8.5rem_8.5rem_9rem] items-center gap-3 border-b border-hairline bg-soft px-3.5 text-eyebrow font-medium text-body">
              <span>Nomor</span>
              <span>Pihak</span>
              <span>Jenis</span>
              <span>Site</span>
              <span>Periode</span>
              <span className="text-right">Nilai kontrak</span>
              <span className="text-right">
                {view.group === "DISEWAKAN" ? "Diterima" : "Ditagih"}{" "}
                <FinanceMark className="ml-1 align-[0.0625rem]" />
              </span>
              <span>Status</span>
            </div>
            {rows.map((row) => (
              <GroupRow
                key={row.contract_id}
                row={row}
                onOpen={onOpen}
                showType
              />
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

/// One contract, in the group reading.
function GroupRow({
  row,
  onOpen,
  showType,
}: {
  row: GaContractRow
  onOpen: (contractId: string) => void
  showType: boolean
}) {
  return (
    <div
      onClick={() => onOpen(row.contract_id)}
      className="grid cursor-pointer grid-cols-[7rem_minmax(12rem,1fr)_10rem_6.5rem_11rem_8.5rem_8.5rem_9rem] items-center gap-3 border-b border-hairline px-3.5 py-2.5 transition-colors last:border-b-0 hover:bg-soft"
    >
      <span className="truncate font-mono text-id text-body">
        {row.contract_number ?? "—"}
      </span>
      <div className="min-w-0">
        <span className="block truncate text-cell font-medium text-ink">
          {partyOf(row)}
        </span>
        {row.notes !== null && (
          <span className="block truncate text-pill text-mute">
            {row.notes}
          </span>
        )}
      </div>
      {showType && (
        <span className="min-w-0 truncate text-meta text-body">
          {row.contract_type_name}
          {/* Objek rides under the type, because it only exists for
              maintenance contracts and a column of mostly-dashes is not a
              column. */}
          {row.objek_name !== null && (
            <span className="block truncate text-pill text-mute">
              Objek: {row.objek_name}
            </span>
          )}
        </span>
      )}
      <span className="truncate text-meta text-body">{siteOf(row)}</span>
      <span className="truncate text-meta text-body tabular-nums">
        {span(row.starts_on, row.ends_on)}
      </span>
      <span className="truncate text-right text-meta text-body tabular-nums">
        {money(row.contract_value_minor)}
      </span>
      <span className="min-w-0 truncate text-right text-meta text-body tabular-nums">
        {money(row.billed_minor)}
        {/* The rest of the value, while there is a value to rest from. */}
        {row.remaining_minor !== null && (
          <span className="block truncate text-pill text-mute">
            sisa {money(row.remaining_minor)}
          </span>
        )}
      </span>
      <span>
        <StandingPill row={row} />
      </span>
    </div>
  )
}

/// One sambungan, in the utilities reading: the place leads, because that is
/// what a facilities person scans for.
function UtilityRow({
  row,
  onOpen,
}: {
  row: GaContractRow
  onOpen: (contractId: string) => void
}) {
  return (
    <div
      onClick={() => onOpen(row.contract_id)}
      className="grid cursor-pointer grid-cols-[minmax(13rem,1fr)_6.5rem_10rem_9rem_10rem_9rem] items-center gap-3 border-b border-hairline px-3.5 py-2.5 transition-colors last:border-b-0 hover:bg-soft"
    >
      <div className="min-w-0">
        <span className="block truncate text-cell font-medium text-ink">
          {partyOf(row)}
        </span>
        <span className="block truncate text-pill text-mute">
          {row.contract_type_name}
        </span>
      </div>
      <span className="truncate text-meta text-body">{siteOf(row)}</span>
      <span className="truncate font-mono text-id text-body">
        {row.customer_number ?? "—"}
      </span>
      <span className="truncate text-right text-meta text-body tabular-nums">
        {money(row.billed_minor)}
      </span>
      <span className="min-w-0 truncate text-meta text-body tabular-nums">
        {row.last_usage === null ? (
          "—"
        ) : (
          <>
            {count(row.last_usage)} {row.last_unit}
            <span className="block truncate text-pill text-mute">
              {monthLabel(row.last_usage_period)}
            </span>
          </>
        )}
      </span>
      <span>
        <StandingPill row={row} />
      </span>
    </div>
  )
}
