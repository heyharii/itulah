import { useInfiniteQuery } from "@tanstack/react-query"
import { ListFilter, Plus } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Fab } from "@/components/ui/fab"
import { Input } from "@/components/ui/field"
import { ChoiceMenu } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { EmptyState, LoadMore } from "@/components/ui/states"
import { buildOf, BUILDS, BUILD_VIEWS } from "@/lib/builds"
import { count } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { gaKeys, gaAssets } from "@/lib/queries/ga"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { useDebounced } from "@/lib/use-debounced"
import { cn } from "@/lib/utils"
import { AssetHubSheet, gaStatusWords } from "@/screens/assets/hub"
import { RegisterAssetSheet } from "@/screens/assets/register"
import { DisposalSheet, ReplacementSheet } from "@/screens/maintenance/hub"
import {
  CardName,
  type CardSpec,
  DESK_BAR,
  PhoneCards,
} from "@/components/ui/phone-cards"
import { FilterSheet } from "@/components/ui/filter-sheet"
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
/// # One row in the sidebar, the readings as chips
///
/// Register, Software and Projects were three sidebar rows, and seven build
/// views sat behind them as hidden routes. The owner asked for a shorter menu
/// on 2026-09-27, and the rows were never more than this screen narrowed by
/// build — Software and Projects even showed the whole register, because the
/// group they named was never sent. So there is one Assets row, and every
/// reading is a chip whose value rides in `?asset-view=`: a facilities person
/// who only ever wants the vehicles can still bookmark it and send it.
/// How many assets one page of the register asks for. A step, not a ceiling:
/// the rest arrive as the list is scrolled.
const PAGE = 100

export function Assets() {
  const reading = useSheet("asset-view")
  const view = BUILD_VIEWS.find((one) => one.value === reading.value)
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
  const [filtering, setFiltering] = useState(false)
  const phone = useLayout() === "phone"
  // The search goes to the server, so it waits for the typing to stop: one
  // request per word rather than one per keystroke.
  const needle = useDebounced(search.trim(), 300)

  const scope = useMemo(
    () => ({
      q: needle === "" ? undefined : needle,
      site: site ?? undefined,
      // Every build the reading means. Property is two of them, because land
      // and the building on it are one question to a facilities person even
      // though the chart charges them differently; Projects is two as well.
      build: view?.builds.join(","),
      condition: condition ?? undefined,
      // Asked as the register's OWN lifecycle and not as Finance's decision,
      // because that is the half this screen maintains: a thing that arrived on
      // a bill and that nobody has walked the floor for is the open control gap
      // GA can actually close.
      draft: book === "ALL" ? undefined : book === "DRAFT",
    }),
    [needle, book, site, condition, view]
  )

  /// The register, a page at a time, the next one fetched as the foot of the
  /// list nears view. Its own key under the register's prefix: the pickers
  /// read the same scope as one plain page, and an infinite answer and a plain
  /// one cannot share a cache entry. `gaKeys.all` still reaches it.
  const register = useInfiniteQuery({
    queryKey: [...gaKeys.assets(scope), "pages"] as const,
    queryFn: ({ pageParam, signal }) =>
      gaAssets({ ...scope, limit: PAGE, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    // The previous answer stays on screen while the next is fetched. Without
    // it every search empties the register to a loading line.
    placeholderData: (previous) => previous,
  })

  const rows = useMemo(
    () => register.data?.pages.flatMap((page) => page.rows) ?? [],
    [register.data]
  )
  // Total and facets are the same on every page; the first one says them.
  const head = register.data?.pages[0]
  const sites = head?.facets.sites ?? []
  const conditions = head?.facets.conditions ?? []

  return (
    <PageContent>
      <PageHeader
        crumb="GA"
        title={view === undefined ? "Assets" : `Assets · ${view.label}`}
        sub={
          view?.note ??
          "What the company owns: where each thing is, what state it is in, and who holds it."
        }
        actions={
          // On a phone the search, the readings and the filters are the dock's,
          // and the one thing this page makes is its round button.
          phone ? undefined : (
            <>
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-8 w-56"
              />
              <Button variant="primary" onClick={() => setAdding(true)}>
                <Plus />
                Register asset
              </Button>
            </>
          )
        }
      />

      <Fab label="Register asset" onClick={() => setAdding(true)} />
      <DockTools
        search={{ value: search, onChange: setSearch, label: "Search assets" }}
        filter={{
          count:
            (view === undefined ? 0 : 1) +
            (condition === null ? 0 : 1) +
            (site === null ? 0 : 1),
          onOpen: () => setFiltering(true),
        }}
        status={{
          value: book,
          options: [
            { value: "ALL", label: "All" },
            { value: "DRAFT", label: "Needs details" },
            { value: "REGISTERED", label: "Registered" },
          ],
          onChange: (next) => setBook(next as typeof book),
        }}
      />
      <FilterSheet
        open={filtering}
        onOpenChange={setFiltering}
        groups={[
          {
            key: "reading",
            label: "Reading",
            value: view?.value ?? null,
            options: [
              {
                value: null,
                label: "All",
                count: (head?.facets.builds ?? []).reduce(
                  (sum, one) => sum + one.count,
                  0
                ),
              },
              ...BUILD_VIEWS.map((one) => ({
                value: one.value as string | null,
                label: one.label,
                count: (head?.facets.builds ?? [])
                  .filter((build) =>
                    one.builds.includes(
                      build.value as (typeof one.builds)[number]
                    )
                  )
                  .reduce((sum, build) => sum + build.count, 0),
              })),
            ],
            onChange: (next) =>
              next === null ? reading.close() : reading.replace(next),
          },
          {
            key: "condition",
            label: "Condition",
            value: condition,
            options: [
              { value: null, label: "Any condition" },
              ...conditions.map((one) => ({
                value: one.value as string | null,
                label: conditionWords(one.value),
              })),
            ],
            onChange: setCondition,
          },
          {
            key: "location",
            label: "Location",
            value: site,
            options: [
              { value: null, label: "All locations" },
              ...sites.map((one) => ({
                value: one.value as string | null,
                label: one.label ?? one.value,
              })),
            ],
            onChange: setSite,
          },
        ]}
      />

      <div className={DESK_BAR}>
        <BuildChips
          here={view?.value ?? null}
          counts={head?.facets.builds ?? []}
        />
      </div>

      <div className={DESK_BAR}>
        <Segmented
          options={[
            { value: "ALL" as const, label: "All" },
            { value: "DRAFT" as const, label: "Needs details" },
            { value: "REGISTERED" as const, label: "Registered" },
          ]}
          value={book}
          onChange={setBook}
        />
        <ChoiceMenu
          heading="Condition"
          icon={ListFilter}
          value={condition}
          options={[
            { value: null, label: "Any condition" },
            ...conditions.map((one) => ({
              value: one.value,
              label: conditionWords(one.value),
            })),
          ]}
          onChange={setCondition}
        />
        <ChoiceMenu
          heading="Location"
          icon={ListFilter}
          value={site}
          options={[
            { value: null, label: "All locations" },
            ...sites.map((one) => ({
              value: one.value,
              label: one.label ?? one.value,
            })),
          ]}
          onChange={setSite}
        />
        <Toolbar.Spacer />
        {head !== undefined && (
          <span className="text-meta text-body">
            <b className="font-medium text-ink">{count(head.total)}</b>{" "}
            {head.total === 1 ? "asset" : "assets"}
          </span>
        )}
      </div>

      {queryState(register, {
        loading: "Loading assets…",
        render: () =>
          rows.length === 0 ? (
            <Card>
              <EmptyState
                action={
                  <Button variant="ghost" onClick={() => setAdding(true)}>
                    Register the first one
                  </Button>
                }
              >
                No assets in this reading yet. Register an asset when it
                arrives, then fill in where it is and what state it is in.
              </EmptyState>
            </Card>
          ) : phone ? (
            <PhoneCards
              rows={rows}
              rowId={(row) => row.asset_id}
              spec={ASSET_CARD}
              onOpen={(row) => open.open(row.asset_id)}
              more={register}
            />
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
                    <span>Code</span>
                    <span>Asset</span>
                    <span>Class</span>
                    <span>Location</span>
                    <span>Area</span>
                    <span>Holder</span>
                    <span>Condition</span>
                    <span>GA status</span>
                    <span>Finance status</span>
                  </div>
                  {rows.map((row) => (
                    <AssetLine
                      key={row.asset_id}
                      asset={row}
                      onOpen={() => open.open(row.asset_id)}
                    />
                  ))}
                </div>
              </div>
              {/* Outside the sideways-scrolling box: that box computes as a
                  vertical scroller too, and a marker inside it would always
                  be "in view" and pull every page. The page scrolls. */}
              <LoadMore query={register} />
            </Card>
          ),
      })}

      <RegisterAssetSheet
        open={adding}
        // The builds the reading means, so a licence is not offered from the
        // vehicles; every build when nothing is narrowed.
        builds={view?.builds ?? BUILDS.map((one) => one.value)}
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

/// The readings, as chips with their counts.
///
/// Chips and not sidebar rows: nine rows under Assets would push the rest of
/// GA off the screen to answer a question these answer in one click, and the
/// sidebar is a list of places somebody sets out for while these are readings
/// of the place they are already in.
///
/// Each chip is a LINK and not a button, so the reading is in the address bar:
/// a facilities person who only ever wants the vehicles can bookmark it and
/// send it.
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
      aria-label="Asset readings"
      className="flex flex-wrap items-center gap-1.5"
    >
      <Chip label="All" n={total} active={here === null} />
      {BUILD_VIEWS.map((view) => (
        <Chip
          key={view.value}
          view={view.value}
          label={view.label}
          icon={view.icon}
          n={counts
            .filter((one) =>
              view.builds.includes(one.value as (typeof view.builds)[number])
            )
            .reduce((sum, one) => sum + one.count, 0)}
          active={here === view.value}
        />
      ))}
    </nav>
  )
}

/// One chip. A link, because the reading is a URL; no `view` is every build.
function Chip({
  view,
  label,
  icon: Glyph,
  n,
  active,
}: {
  view?: string
  label: string
  icon?: React.ComponentType<{ className?: string }>
  n: number
  active: boolean
}) {
  return (
    <AppLink
      to="/assets"
      sheet={
        view === undefined ? undefined : { key: "asset-view", value: view }
      }
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
            {asset.serial_number ?? "no serial"}
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
          <span className="text-meta text-body">Good</span>
        ) : (
          <Pill tone={asset.condition === "RUSAK" ? "bad" : "warn"}>
            {conditionWords(asset.condition)}
          </Pill>
        )}
      </span>
      <span>
        {/* The register's own status, not a two-way draft/registered
            switch: a written-off laptop read "Registered" here while its
            sheet and the finance register both said it had gone. */}
        <Pill
          tone={
            draft || asset.status === "DISPOSAL_REQUESTED" ? "warn" : "neutral"
          }
        >
          {draft ? "Needs details" : gaStatusWords(asset.status)}
        </Pill>
      </span>
      <span>
        <Pill tone={asset.finance_decision === null ? "warn" : "neutral"}>
          {asset.finance_decision === null ? "Not assessed" : "Assessed"}
        </Pill>
      </span>
    </div>
  )
}

/// An asset as a phone's card: the thing over its plate number, where it is and
/// who holds it, how it is and whether Finance has looked at it, and the
/// register's own status.
const ASSET_CARD: CardSpec<GaAssetRow> = {
  title: (row) => <CardName name={row.name} code={row.asset_number} />,
  meta: [
    (row) =>
      [row.class_name, row.site_id, row.sub_location]
        .filter((part) => part !== null && part !== "")
        .join(" · "),
    (row) => (row.holder === null ? null : `Held by ${row.holder}`),
  ],
  foot: (row) => (
    <span>
      {conditionWords(row.condition)}
      {row.finance_decision === null && (
        <span className="text-warn-fg"> · Not assessed</span>
      )}
    </span>
  ),
  action: (row) => (
    <Pill
      tone={
        row.status === "DRAFT" || row.status === "DISPOSAL_REQUESTED"
          ? "warn"
          : "neutral"
      }
    >
      {row.status === "DRAFT" ? "Needs details" : gaStatusWords(row.status)}
    </Pill>
  ),
}

function conditionWords(condition: string): string {
  switch (condition) {
    case "PERLU_SERVIS":
      return "Needs service"
    case "RUSAK":
      return "Broken"
    default:
      return "Good"
  }
}
