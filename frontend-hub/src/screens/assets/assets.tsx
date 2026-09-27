import { useQuery } from "@tanstack/react-query"
import { useRouterState } from "@tanstack/react-router"
import { ListFilter, Plus } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/field"
import { ChoiceMenu } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { buildOf, BUILD_VIEWS } from "@/lib/builds"
import { count } from "@/lib/format"
import { gaKeys, gaAssets } from "@/lib/queries/ga"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { cn } from "@/lib/utils"
import { AssetHubSheet, gaStatusWords } from "@/screens/assets/hub"
import { RegisterAssetSheet } from "@/screens/assets/register"
import { DisposalSheet, ReplacementSheet } from "@/screens/maintenance/hub"
import type { GaAssetRow } from "@itulah/contract"

/// Assets — the things the company owns, as the people who look after them
/// know them.
///
/// # Why GA has its own door onto the same register
///
/// Because the register answers two different questions and they belong to two
/// different people. Finance asks what an asset is WORTH: the cost, the method,
/// the monthly charge, what is left of it. GA asks where the thing IS: which
/// shop, what serial number is on the plate, is it still working, when was it
/// last serviced.
///
/// The tables were built this way from the start — `fixed_asset` carries no
/// monetary column at all and `asset_capitalization` carries the money — so
/// this screen is not a copy of Finance's. It is the half that was never given
/// a door. See migration 0070, and 0212 for the same argument about vendors.
///
/// # There is not one rupiah on this screen, on purpose
///
/// That is what makes it usable by the people who actually hold the things: a
/// shop manager can be asked to walk the floor and check the register without
/// being shown what the company carries its building at.
///
/// # What the client's own register could never answer
///
/// Their `MASTER ASSET` has 1,342 rows and names them "HANGER", "KOMPUTER",
/// "INTERIOR" — one row is a COST, not a thing. It has a `DEPARTEMEN` column
/// filled with "-" on all 1,342. So nothing anywhere says which air
/// conditioner is in which shop, or who holds which laptop. That is what this
/// screen exists to start recording — from the next purchase forward, because
/// it cannot be back-filled from a schedule of costs.
///
/// # One register, three groups and seven build views
///
/// The sidebar's Register · Software · Projects are this screen, narrowed by
/// the group the URL names. The grouping follows the client's own chart —
/// `asset_class.kind`, with the one exception that work in progress reads as
/// Projects by CLASS, not by kind — and the server owns it, so the screen
/// never spells the class list itself.
///
/// The seven chips narrow by `build` instead, which is how the things are
/// found rather than how the money is filed: four of the fifty-nine classes
/// are one form, and a facilities person looking for the shop's machines wants
/// the machines rather than four AC-shaped lists. See `lib/builds.ts` for why
/// the list is exactly eleven and why seven of them are chips.
type AssetGroup = "register" | "software" | "projects"

/// What the URL is asking for: which group, and which build within it.
///
/// A build view is a reading of Register — Property and Vehicles are plant —
/// so the group is still sent, and the build narrows it. Sending both is what
/// makes the total and the facets agree with the rows: a screen that narrowed
/// only by build would count the whole register in its footer.
function assetViewFor(pathname: string): {
  group: AssetGroup
  view: (typeof BUILD_VIEWS)[number] | undefined
} {
  if (pathname.startsWith("/assets/software")) {
    return { group: "software", view: undefined }
  }
  if (pathname.startsWith("/assets/projects")) {
    return { group: "projects", view: undefined }
  }
  const view = BUILD_VIEWS.find((one) =>
    pathname.startsWith(`/assets/${one.value}`)
  )
  return { group: "register", view }
}

/// Which builds each group can be registered under.
///
/// The register offers the eight physical ones; Software offers its single
/// build and Projects its two. A screen that offered all eleven everywhere
/// would let somebody file a licence from a shop's floor, which is a thing
/// GA does not do and Finance would then have to unpick.
const GROUP_BUILDS: Record<AssetGroup, readonly string[]> = {
  register: ["LAND", "BUILDING", "TECH", "VEHICLE", "FFE", "IT", "AUDIO", "OE"],
  software: ["SOFTWARE"],
  projects: ["DEFERRED", "CIP"],
}

const GROUP_TITLES: Record<AssetGroup, { title: string; sub: string }> = {
  register: {
    title: "Daftar aset",
    sub: "Catat aset milik perusahaan, lokasinya, kondisinya, dan siapa yang memegangnya.",
  },
  software: {
    title: "Perangkat lunak",
    sub: "Daftar lisensi dan perangkat lunak yang digunakan perusahaan.",
  },
  projects: {
    title: "Proyek",
    sub: "Catat biaya persiapan dan pekerjaan yang masih berjalan sampai hasilnya siap didaftarkan sebagai aset.",
  },
}

export function Assets() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { group, view } = assetViewFor(pathname)
  const { title, sub } = GROUP_TITLES[group]
  const open = useSheet("asset")
  // The two maintenance records an asset can start, opened over the register
  // the moment they are filed from the hub: the proposal should land the
  // proposer on the record it made, not leave them on a form that closed.
  const replacement = useSheet("replacement")
  const disposal = useSheet("disposal")
  const [book, setBook] = useState<"ALL" | "DRAFT" | "REGISTERED">("ALL")
  const [condition, setCondition] = useState<string | null>(null)
  const [site, setSite] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [adding, setAdding] = useState(false)

  const scope = useMemo(
    () => ({
      q: search.trim() === "" ? undefined : search.trim(),
      site: site ?? undefined,
      // Every build the view means. Property is two of them, because land and
      // the building on it are one question to a facilities person even though
      // the chart charges them differently.
      build: view?.builds.join(","),
      condition: condition ?? undefined,
      // Asked as the register's OWN lifecycle and not as Finance's decision,
      // because that is the half this screen maintains: a thing that arrived on
      // a bill and that nobody has walked the floor for is the open control gap
      // GA can actually close.
      draft: book === "ALL" ? undefined : book === "DRAFT",
      limit: 200,
    }),
    [search, book, site, condition, view]
  )

  const register = useQuery({
    queryKey: gaKeys.assets(scope),
    queryFn: ({ signal }) => gaAssets(scope, signal),
  })

  const sites = register.data?.facets.sites ?? []
  const conditions = register.data?.facets.conditions ?? []

  return (
    <PageContent>
      <PageHeader
        crumb="Aset"
        title={view === undefined ? title : `${title} · ${view.label}`}
        sub={view?.note ?? sub}
        actions={
          <>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Kode, nama atau serial"
              className="h-8 w-56"
            />
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus />
              Catat aset
            </Button>
          </>
        }
      />

      {/* The chips, and only on the group they read: Software and Projects have
          no build to narrow by — every class in them is one build — so a chip
          strip there would be a single chip that did nothing. */}
      {group === "register" && (
        <Toolbar>
          <BuildChips
            here={view?.value ?? null}
            counts={register.data?.facets.builds ?? []}
          />
        </Toolbar>
      )}

      <Toolbar>
        <Segmented
          options={[
            { value: "ALL" as const, label: "Semua" },
            { value: "DRAFT" as const, label: "Perlu dilengkapi" },
            { value: "REGISTERED" as const, label: "Terdaftar" },
          ]}
          value={book}
          onChange={setBook}
        />
        <ChoiceMenu
          heading="Kondisi"
          icon={ListFilter}
          value={condition}
          options={[
            { value: null, label: "Semua kondisi" },
            ...conditions.map((one) => ({
              value: one.value,
              label: conditionWords(one.value),
            })),
          ]}
          onChange={setCondition}
        />
        <ChoiceMenu
          heading="Lokasi"
          icon={ListFilter}
          value={site}
          options={[
            { value: null, label: "Semua lokasi" },
            ...sites.map((one) => ({
              value: one.value,
              label: one.label ?? one.value,
            })),
          ]}
          onChange={setSite}
        />
        <Toolbar.Spacer />
        {register.data !== undefined && (
          <span className="text-meta text-body">
            <b className="font-medium text-ink">{count(register.data.total)}</b>{" "}
            {register.data.total === 1 ? "aset" : "aset"}
          </span>
        )}
      </Toolbar>

      {queryState(register, {
        loading: "Memuat daftar aset…",
        render: (page) =>
          page.rows.length === 0 ? (
            <Card>
              <EmptyState
                action={
                  <Button variant="ghost" onClick={() => setAdding(true)}>
                    Catat yang pertama
                  </Button>
                }
              >
                Belum ada aset di daftar ini. Daftarkan aset saat diterima, lalu
                lengkapi lokasi dan kondisinya.
              </EmptyState>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              {/* The register scrolls INSIDE its own box rather than squashing
                  the columns. Nine columns of codes, names and serials do not
                  fit a phone, and the two wrong answers are both worse than a
                  scrollbar: squeezed, the cells overlap and the page itself
                  starts scrolling sideways, which takes the sidebar with it. */}
              <div className="overflow-x-auto">
                <div className="min-w-[72rem]">
                  <div className="grid h-10 grid-cols-[7rem_minmax(14rem,1fr)_11rem_6rem_9rem_9rem_7rem_9rem_9rem] items-center gap-3 border-b border-hairline bg-soft px-3.5 text-eyebrow font-medium text-body">
                    <span>Kode</span>
                    <span>Aset</span>
                    <span>Kelas</span>
                    <span>Lokasi</span>
                    <span>Lokasi</span>
                    <span>Pemegang</span>
                    <span>Kondisi</span>
                    <span>Status GA</span>
                    <span>Status Finance</span>
                  </div>
                  {page.rows.map((row) => (
                    <AssetLine
                      key={row.asset_id}
                      asset={row}
                      onOpen={() => open.open(row.asset_id)}
                    />
                  ))}
                </div>
              </div>
            </Card>
          ),
      })}

      <RegisterAssetSheet
        open={adding}
        builds={GROUP_BUILDS[group]}
        onClose={() => setAdding(false)}
        onRegistered={(assetId) => {
          setAdding(false)
          open.open(assetId)
        }}
      />

      <AssetHubSheet
        assetId={open.value}
        open={open.isOpen}
        onClose={open.close}
        onProposeReplacement={replacement.open}
        onRequestDisposal={disposal.open}
      />

      {/* The key remounts the sheet when a different record is opened, so its
          local state does not follow the id. It is prefixed because the two
          sheets are siblings and both are closed most of the time — two bare
          "none" keys are one duplicate key, and React says so. */}
      <ReplacementSheet
        key={`replacement:${replacement.value ?? "none"}`}
        replacementId={replacement.value}
        open={replacement.isOpen}
        onClose={replacement.close}
      />

      <DisposalSheet
        key={`disposal:${disposal.value ?? "none"}`}
        disposalId={disposal.value}
        open={disposal.isOpen}
        onClose={disposal.close}
      />
    </PageContent>
  )
}

/// The seven build views, as chips with their counts.
///
/// Chips and not a second sidebar: eleven rows under Assets would push
/// Contracts and Maintenance off the screen to answer a question these answer
/// in one click, and the sidebar is a list of places somebody sets out for
/// while these are readings of the place they are already in.
///
/// Each chip is a LINK and not a button, so the reading is in the address bar:
/// a facilities person who only ever wants the vehicles can bookmark it, send
/// it, and land on it from ⌘K — which is the whole reason the seven have
/// routes of their own.
///
/// The counts are the server's facets, counted over the SEARCH and not over the
/// filters, so "Vehicles 41" means there are forty-one vehicles rather than
/// forty-one among whatever the reader has already narrowed to. A chip that
/// counted the filtered set would read zero the moment somebody clicked a
/// different one.
function BuildChips({
  here,
  counts,
}: {
  here: string | null
  counts: readonly { value: string; count: number }[]
}) {
  const total = counts.reduce((sum, one) => sum + one.count, 0)
  return (
    <nav
      aria-label="Build views"
      className="flex flex-wrap items-center gap-1.5"
    >
      <Chip to="/assets" label="Semua" n={total} active={here === null} />
      {BUILD_VIEWS.map((view) => {
        const Glyph = view.icon
        return (
          <Chip
            key={view.value}
            to={`/assets/${view.value}`}
            label={view.label}
            icon={Glyph}
            n={counts
              .filter((one) =>
                view.builds.includes(one.value as (typeof view.builds)[number])
              )
              .reduce((sum, one) => sum + one.count, 0)}
            active={here === view.value}
          />
        )
      })}
    </nav>
  )
}

/// One chip. A link, because the reading is a URL.
function Chip({
  to,
  label,
  icon: Glyph,
  n,
  active,
}: {
  to: string
  label: string
  icon?: React.ComponentType<{ className?: string }>
  n: number
  active: boolean
}) {
  return (
    <AppLink
      to={to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-full border px-3 text-meta font-medium transition-colors",
        active
          ? "border-accent bg-accent-bg text-accent"
          : "border-hairline-2 bg-canvas text-text hover:bg-soft"
      )}
    >
      {Glyph && (
        <Glyph
          className={cn(
            "size-4 stroke-[1.7]",
            active ? "text-accent" : "text-line-ico"
          )}
        />
      )}
      {label}
      <span
        className={cn(
          "text-pill tabular-nums",
          active ? "text-accent" : "text-mute"
        )}
      >
        {count(n)}
      </span>
    </AppLink>
  )
}

function AssetLine({
  asset,
  onOpen,
}: {
  asset: GaAssetRow
  onOpen: () => void
}) {
  const Glyph = buildOf(asset.build).icon
  const draft = asset.status === "DRAFT"
  return (
    <div
      onClick={onOpen}
      className={cn(
        "grid cursor-pointer grid-cols-[7rem_minmax(14rem,1fr)_11rem_6rem_9rem_9rem_7rem_9rem_9rem] items-center gap-3 border-b border-hairline px-3.5 py-2.5 transition-colors last:border-b-0 hover:bg-soft",
        // A row that arrived from a bill and that nobody has walked the floor
        // for is the one thing on this list that is somebody's job today, so it
        // is the one row drawn differently.
        draft && "bg-warn-bg/30"
      )}
    >
      <span className="truncate font-mono text-id text-body">
        {asset.asset_number}
      </span>
      <div className="flex min-w-0 items-center gap-2.5">
        {/* The build, as a glyph. Fifty-nine classes are eleven pictures, and
            the glyph is what the eye finds before it reads the name — which is
            how somebody scanning for "the vehicles" does it. */}
        <span className="grid size-[1.875rem] shrink-0 place-items-center rounded-inner bg-soft-2 text-body">
          <Glyph className="size-4 stroke-[1.7]" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-cell font-medium text-ink">
            {asset.name}
          </span>
          <span className="block truncate font-mono text-pill text-mute">
            {asset.serial_number ?? "tanpa serial"}
          </span>
        </span>
      </div>
      <span className="min-w-0 truncate text-meta text-body">
        {asset.class_name}
        <span className="block truncate text-pill text-mute">
          {buildOf(asset.build).label}
        </span>
      </span>
      <span className="truncate text-meta text-body">{asset.site_id}</span>
      <span className="truncate text-meta text-body">
        {asset.sub_location ?? "—"}
      </span>
      <span className="truncate text-meta text-body">
        {asset.holder ?? "—"}
      </span>
      <span>
        {asset.condition === "BAIK" ? (
          <span className="text-meta text-body">Baik</span>
        ) : (
          <Pill tone={asset.condition === "RUSAK" ? "bad" : "warn"}>
            {conditionWords(asset.condition)}
          </Pill>
        )}
      </span>
      <span>
        {/* The register's own status, not a two-way draft/registered
            switch: a written-off laptop read "Terdaftar" here while its sheet
            and the finance register both said it had gone. */}
        <Pill
          tone={
            draft || asset.status === "DISPOSAL_REQUESTED" ? "warn" : "neutral"
          }
        >
          {draft ? "Perlu dilengkapi" : gaStatusWords(asset.status)}
        </Pill>
      </span>
      <span>
        <Pill tone={asset.finance_decision === null ? "warn" : "neutral"}>
          {asset.finance_decision === null ? "Belum dinilai" : "Sudah dinilai"}
        </Pill>
      </span>
    </div>
  )
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
