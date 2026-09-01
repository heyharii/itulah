/*
 * Customers — the member directory, the segments cut out of it, and the
 * loyalty programme those two are measured against.
 *
 * Every filter on this screen is a navigation. The tab, the text query, the
 * tier, the segment and the open profile all live in the URL, so a filtered
 * list is a link and the 360 sheet reopens on whatever id the address bar is
 * carrying — the detail fetch is keyed off that id rather than off a click.
 */

import { Link } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import {
  columnFilteringFeature,
  createFilteredRowModel,
  createSortedRowModel,
  filterFn_arrIncludes,
  filterFn_equalsString,
  filterFn_includesString,
  rowSortingFeature,
  sortFn_basic,
  tableFeatures,
  useTable,
  type ColumnFiltersState,
  type SortingState,
} from "@tanstack/react-table"

import { Icon, paths } from "@/components/dashboard/parts"
import { IconButton, Switch } from "@/components/dashboard/nav-sidebar"
import { SheetShell, sheetButton } from "@/components/dashboard/sheet-shell"
import { AppHeading } from "@/components/app-switcher"
import { STORES } from "@/components/commercial/data"
import { CustomerDetail } from "@/components/customers/detail"
import {
  useCustomer360,
  useCustomerDirectory,
} from "@/components/customers/api"
import {
  POINTS_PER_RUPIAH,
  POINT_VALUE,
  SEGMENTS,
  TIER_META,
  hasLastSeen,
  lastSeenOf,
  memberOf,
  pointsOf,
  returnsOf,
  rupiah,
  shortRupiah,
  spendOf,
  tierOf,
  tierLabelOf,
  visitsOf,
  type Customer,
  type Tier,
} from "@/components/customers/data"
import {
  cue,
  readSoundPreference,
  useInteractionSounds,
  writeSoundPreference,
} from "@/components/dashboard/use-interaction-sounds"
import { shortDate } from "@/lib/day"
import { VirtualRows } from "@/shared/table"
import { cn } from "@/lib/utils"
import { Route } from "@/routes/customers"
import {
  AppShell,
  AppShellSidebar,
  SidebarTrigger,
} from "@/components/app-shell"

const PEOPLE_COLUMNS = "minmax(0,1fr) 108px 150px 96px 108px 132px"

const daysSince = (key: string) =>
  Math.round(
    (new Date().setHours(12, 0, 0, 0) - new Date(`${key}T12:00:00`).getTime()) /
      86_400_000
  )

/** One directory row with its derived aggregates resolved once. */
interface PersonRow {
  customer: Customer
  spend: number
  tier: Tier
  tierLabel: string
  points: number
  lastSeen: string
  lastSeenKnown: boolean
  /** The ids of every segment this customer falls into. */
  segments: string[]
  /** Name, member id and phone folded into one haystack for the text filter. */
  haystack: string
}

/* The table owns the row model only — the markup below stays hand-written —
 * so it needs filtering and sorting and nothing else. */
const features = tableFeatures({
  rowSortingFeature,
  columnFilteringFeature,
  sortedRowModel: createSortedRowModel(),
  filteredRowModel: createFilteredRowModel(),
  sortFns: { basic: sortFn_basic },
  filterFns: {
    includesString: filterFn_includesString,
    equalsString: filterFn_equalsString,
    arrIncludes: filterFn_arrIncludes,
  },
})

const TABLE_COLUMNS = [
  {
    id: "haystack",
    accessorFn: (row: PersonRow) => row.haystack,
    filterFn: "includesString" as const,
  },
  {
    id: "tier",
    accessorFn: (row: PersonRow) => row.tier,
    filterFn: "equalsString" as const,
  },
  {
    id: "segment",
    accessorFn: (row: PersonRow) => row.segments,
    filterFn: "arrIncludes" as const,
  },
  {
    id: "spend",
    accessorFn: (row: PersonRow) => row.spend,
    sortFn: "basic" as const,
  },
]

/* The list has always read biggest-spender-first and there is no header to
 * change that, so the sort is a constant rather than a URL param. */
const SORTING: SortingState = [{ id: "spend", desc: true }]

export function Customers() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { tab, tier, segment } = search
  const query = search.query ?? ""

  const customerResource = useCustomerDirectory()
  const customers = useMemo(
    () => customerResource.data?.customers ?? [],
    [customerResource.data?.customers]
  )

  /* The open profile is an id in the URL; the 360 read is keyed off it, so it
   * survives a reload and a Back with no click to replay. */
  const openId = search.open ?? null
  const detailResource = useCustomer360(openId)
  const detail = detailResource.data
  const openCustomer = openId
    ? (customers.find((c) => c.id === openId) ?? detail?.customer ?? null)
    : null

  const [railHidden, setRailHidden] = useState(false)
  const [soundOn, setSoundOn] = useState(readSoundPreference)

  useInteractionSounds(soundOn)

  const openCustomerAt = (id: string) =>
    void navigate({ search: (prev) => ({ ...prev, open: id }) })
  const closeCustomer = () =>
    void navigate({
      search: (prev) => ({ ...prev, open: undefined }),
      replace: true,
    })

  const source = useMemo<PersonRow[]>(
    () =>
      customers.map((customer) => ({
        customer,
        spend: spendOf(customer),
        tier: tierOf(customer),
        tierLabel: tierLabelOf(customer),
        points: pointsOf(customer),
        lastSeen: lastSeenOf(customer),
        lastSeenKnown: hasLastSeen(customer),
        segments: SEGMENTS.filter((s) => s.holds(customer)).map((s) => s.id),
        haystack: `${customer.name} ${customer.id} ${customer.phone}`,
      })),
    [customers]
  )

  /* The URL is the only filter state there is: it goes into the table, and
   * nothing writes back — the controls below are links and navigations. */
  const columnFilters = useMemo<ColumnFiltersState>(() => {
    const filters: ColumnFiltersState = []
    const needle = query.trim()
    if (needle) filters.push({ id: "haystack", value: needle })
    if (tier !== "all") filters.push({ id: "tier", value: tier })
    if (segment) filters.push({ id: "segment", value: segment })
    return filters
  }, [query, tier, segment])

  const table = useTable({
    features,
    data: source,
    columns: TABLE_COLUMNS,
    getRowId: (row) => row.customer.id,
    state: { columnFilters, sorting: SORTING },
  })

  const rows = table.getRowModel().rows.map((row) => row.original)

  const totalSpend = rows.reduce((sum, r) => sum + r.spend, 0)
  const members = customers.filter(memberOf).length

  const navRow =
    "flex h-8 w-full items-center gap-2.5 rounded-control px-2 text-left text-[13px] font-medium transition-colors duration-[110ms]"

  return (
    <AppShell
      label="Customers navigation"
      railWidth={240}
      cols={
        railHidden
          ? "grid-cols-[0px_minmax(0,1fr)]"
          : "grid-cols-[240px_minmax(0,1fr)]"
      }
    >
      <AppShellSidebar className={cn(railHidden && "invisible")}>
        <aside className="flex h-full min-h-0 flex-col overflow-hidden bg-page">
          <div className="flex h-[52px] shrink-0 items-center gap-1.5 pr-2 pl-2.5">
            <AppHeading app="customers" />
            <IconButton
              label="Collapse sidebar"
              onClick={() => setRailHidden((v) => !v)}
            >
              <Icon path={paths.panel} size={17} />
            </IconButton>
          </div>

          <nav className="flex-1 overflow-auto px-2 pt-0.5 pb-2">
            {(
              [
                ["people", "Customers", paths.people, customers.length],
                ["segments", "Segments", paths.list, SEGMENTS.length],
                ["loyalty", "Loyalty", paths.star, 0],
              ] as const
            ).map(([id, label, icon, count]) => {
              const on = tab === id
              return (
                <Link
                  key={id}
                  from="/customers"
                  to="/customers"
                  data-sound="page"
                  replace
                  search={(prev) => ({
                    ...prev,
                    tab: id,
                    // a segment only narrows the people list
                    segment: id === "people" ? prev.segment : undefined,
                  })}
                  className={cn(
                    navRow,
                    "group/nav relative text-ink-2 hover:bg-hover hover:text-ink",
                    on && "font-semibold text-ink",
                    on &&
                      "before:absolute before:top-2 before:bottom-2 before:-left-2 before:w-[2.5px] before:rounded-r-full before:bg-ink before:content-['']"
                  )}
                >
                  <Icon
                    path={icon}
                    className={cn(
                      "shrink-0 text-ink-4 group-hover/nav:text-ink-2",
                      on && "text-ink-2"
                    )}
                  />
                  {label}
                  {count > 0 && (
                    <span className="ml-auto font-mono text-[10.5px] text-ink-4">
                      {count}
                    </span>
                  )}
                </Link>
              )
            })}

            <div className="mt-3.5 flex h-7 items-center px-2 text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
              Tier
            </div>
            {(["all", "gold", "silver", "none"] as const).map((option) => {
              const on = tier === option
              const count =
                option === "all"
                  ? customers.length
                  : customers.filter((c) => tierOf(c) === option).length
              return (
                <Link
                  key={option}
                  from="/customers"
                  to="/customers"
                  replace
                  search={(prev) => ({ ...prev, tier: option, tab: "people" })}
                  className={cn(
                    navRow,
                    "text-ink-2 hover:bg-hover hover:text-ink",
                    on && "bg-hover font-semibold text-ink"
                  )}
                >
                  {option !== "all" && (
                    <span
                      style={{ background: TIER_META[option].hue }}
                      className="size-2 shrink-0 rounded-full"
                    />
                  )}
                  <span className="truncate">
                    {option === "all" ? "Everyone" : TIER_META[option].label}
                  </span>
                  <span className="ml-auto font-mono text-[10.5px] text-ink-4">
                    {count}
                  </span>
                </Link>
              )
            })}
          </nav>

          <div className="shrink-0 p-2">
            <button
              type="button"
              role="switch"
              aria-checked={soundOn}
              data-sound-silent
              onClick={() => {
                const next = !soundOn
                setSoundOn(next)
                writeSoundPreference(next)
                if (next) cue("toggle")
              }}
              className="flex h-[34px] w-full items-center gap-[9px] rounded-control px-2 text-xs font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink"
            >
              <Icon
                path={paths.sound}
                size={16}
                className="shrink-0 text-ink-4"
              />
              Interaction sounds
              <Switch on={soundOn} className="ml-auto" />
            </button>
          </div>
        </aside>
      </AppShellSidebar>

      <main className="flex h-full min-h-0 flex-col overflow-hidden p-2 pl-0 max-lg:pl-2">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-window bg-surface shadow-card">
          <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-3.5">
            <SidebarTrigger className="-ml-1" />
            <span className="text-sm font-semibold text-ink">
              {tab === "people"
                ? "Customers"
                : tab === "segments"
                  ? "Segments"
                  : "Loyalty"}
            </span>
            {tab === "people" && (
              <span className="ml-2 flex items-center gap-3 text-[11.5px] text-ink-3">
                <span>
                  <span className="font-mono text-ink">{rows.length}</span>{" "}
                  shown
                </span>
                <span>
                  <span className="font-mono text-ink">
                    {shortRupiah(totalSpend)}
                  </span>{" "}
                  lifetime
                </span>
                <span>
                  <span className="font-mono text-ink">{members}</span> members
                </span>
              </span>
            )}

            {segment && (
              <Link
                from="/customers"
                to="/customers"
                replace
                search={(prev) => ({ ...prev, segment: undefined })}
                className="ml-2 inline-flex h-[24px] items-center gap-1.5 rounded-chip bg-accent-tint px-2 text-[11px] font-medium text-accent-ink"
              >
                {SEGMENTS.find((s) => s.id === segment)?.name ?? segment}
                <Icon path={paths.close} size={10} width={2.6} />
              </Link>
            )}

            {tab === "people" && (
              <span className="relative ml-auto">
                <Icon
                  path={paths.search}
                  size={14}
                  width={1.9}
                  className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-4"
                />
                <input
                  value={query}
                  onChange={(e) =>
                    void navigate({
                      search: (prev) => ({
                        ...prev,
                        query: e.target.value || undefined,
                      }),
                      replace: true,
                    })
                  }
                  placeholder="Name, member id or phone"
                  className="h-[32px] w-[240px] rounded-control bg-field pr-2.5 pl-8 text-xs text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none placeholder:text-ink-4 focus:bg-surface focus:shadow-[inset_0_0_0_1px_var(--accent)]"
                />
              </span>
            )}
          </header>

          {customerResource.isLoading && !customerResource.data && (
            <div className="border-b border-line bg-inset px-3.5 py-2 text-[11.5px] text-ink-3">
              Loading customers from Internal…
            </div>
          )}
          {customerResource.errorMessage && (
            <div className="flex items-center gap-2 border-b border-ember/20 bg-ember/5 px-3.5 py-2 text-[11.5px] text-ember">
              <span className="min-w-0 flex-1 truncate">
                Customer directory unavailable: {customerResource.errorMessage}
              </span>
              <button
                type="button"
                onClick={() => customerResource.reload()}
                className="shrink-0 underline underline-offset-2"
              >
                Retry
              </button>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-auto">
            {tab === "people" &&
              (customers.length === 0 &&
              !customerResource.isLoading &&
              !customerResource.errorMessage ? (
                <div className="flex h-[240px] items-center justify-center px-6 text-center text-xs text-ink-4">
                  No customers have been recorded in Internal yet.
                </div>
              ) : (
                <VirtualRows
                  rows={rows}
                  rowKey={({ customer }) => customer.id}
                  columns={PEOPLE_COLUMNS}
                  rowHeight={46}
                  className="min-w-[900px]"
                  onRowClick={({ customer }) => openCustomerAt(customer.id)}
                  header={
                    <>
                      <span className="pl-3.5">Customer</span>
                      <span className="px-3">Tier</span>
                      <span className="px-3 text-right">Lifetime spend</span>
                      <span className="px-3 text-right">Visits</span>
                      <span className="px-3 text-right">Points</span>
                      <span className="pr-3.5 pl-3 text-right">Last seen</span>
                    </>
                  }
                  renderRow={({
                    customer,
                    spend,
                    tier: t,
                    tierLabel,
                    points,
                    lastSeen,
                    lastSeenKnown,
                  }) => (
                    <>
                      <span role="gridcell" className="flex min-w-0 items-center gap-2.5 pr-3 pl-3.5">
                        <span
                          style={{ background: customer.hue }}
                          className="grid size-[28px] shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white uppercase"
                        >
                          {customer.name.split(" ").slice(0, 2).map((part) => part[0]).join("")}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-medium text-ink">
                            {customer.name}
                          </span>
                          <span className="block truncate font-mono text-[10.5px] text-ink-4">
                            {customer.id}
                            {customer.homeStoreId && (
                              <>
                                {" "}
                                \u00b7{" "}
                                {STORES.find((st) => st.id === customer.homeStoreId)?.name ??
                                  customer.homeStoreId}
                              </>
                            )}
                          </span>
                        </span>
                      </span>

                      <span role="gridcell" className="px-3">
                        <span
                          style={{ color: TIER_META[t].hue }}
                          className="flex items-center gap-1.5 text-[11px] font-medium"
                        >
                          <span style={{ background: TIER_META[t].hue }} className="size-1.5 rounded-full" />
                          {tierLabel}
                        </span>
                      </span>

                      <span role="gridcell" className="px-3 text-right font-mono text-[12.5px] text-ink tabular-nums">
                        {rupiah(spend)}
                      </span>

                      <span role="gridcell" className="px-3 text-right font-mono text-xs text-ink-3 tabular-nums">
                        {visitsOf(customer) || "\u2014"}
                      </span>

                      <span role="gridcell" className="px-3 text-right font-mono text-xs text-ink-2 tabular-nums">
                        {points.toLocaleString()}
                      </span>

                      <span role="gridcell" className="pr-3.5 pl-3 text-right">
                        <span className="block font-mono text-[11.5px] text-ink-3 tabular-nums">
                          {lastSeenKnown ? shortDate(lastSeen) : "\u2014"}
                        </span>
                        <span
                          className={cn(
                            "block text-[10px]",
                            lastSeenKnown && daysSince(lastSeen) > 180 ? "text-honey" : "text-ink-4"
                          )}
                        >
                          {lastSeenKnown ? `${daysSince(lastSeen)}d ago` : "No activity data"}
                        </span>
                      </span>
                    </>
                  )}
                />
              ))}

            {tab === "segments" && (
              <div className="grid gap-2.5 p-3.5 sm:grid-cols-2 xl:grid-cols-3">
                {SEGMENTS.map((seg) => {
                  const inside = customers.filter(seg.holds)
                  const value = inside.reduce((sum, c) => sum + spendOf(c), 0)
                  return (
                    <Link
                      key={seg.id}
                      from="/customers"
                      to="/customers"
                      search={(prev) => ({
                        ...prev,
                        segment: seg.id,
                        tab: "people",
                      })}
                      className="rounded-panel border border-line-strong px-3.5 py-3 text-left transition-colors hover:bg-hover"
                    >
                      <span className="block text-[13px] font-semibold text-ink">
                        {seg.name}
                      </span>
                      <span className="block pt-0.5 text-[11px] text-ink-4">
                        {seg.description}
                      </span>
                      <span className="flex items-baseline gap-2 pt-2.5">
                        <span className="font-mono text-[19px] font-medium tracking-[-0.02em] text-ink">
                          {inside.length}
                        </span>
                        <span className="font-mono text-[11px] text-ink-4">
                          {shortRupiah(value)} lifetime
                        </span>
                      </span>
                      <span className="mt-2 block h-[5px] overflow-hidden rounded-full bg-inset">
                        <span
                          style={{
                            width: `${customers.length ? (inside.length / customers.length) * 100 : 0}%`,
                          }}
                          className="block h-full rounded-full bg-accent"
                        />
                      </span>
                    </Link>
                  )
                })}
              </div>
            )}

            {tab === "loyalty" && <Loyalty customers={customers} />}
          </div>
        </div>
      </main>

      <SheetShell
        open={Boolean(openId)}
        size="wide"
        eyebrow={
          openCustomer
            ? `${tierLabelOf(openCustomer)} · ${openCustomer.id}`
            : "Customer"
        }
        title={openCustomer?.name ?? ""}
        onRequestClose={closeCustomer}
        footer={
          <>
            <span className="flex-1" />
            <button
              type="button"
              onClick={closeCustomer}
              className={sheetButton.secondary}
            >
              Close
            </button>
          </>
        }
      >
        {openId && (
          <>
            {detailResource.isLoading && (
              <div className="border-b border-line bg-inset px-4 py-2 text-[11.5px] text-ink-3">
                Loading profile, loyalty, vouchers, and purchases from Internal…
              </div>
            )}
            {detailResource.errorMessage && (
              <div className="border-b border-ember/20 bg-ember/5 px-4 py-2 text-[11.5px] text-ember">
                Customer detail unavailable: {detailResource.errorMessage}
              </div>
            )}
            {openCustomer && (
              <CustomerDetail
                customer={detail?.customer ?? openCustomer}
                detail={detail}
              />
            )}
          </>
        )}
      </SheetShell>
    </AppShell>
  )
}

/** The programme itself: what a tier costs to reach, and what a point is worth. */
function Loyalty({ customers }: { customers: Customer[] }) {
  const counts = (["gold", "silver", "none"] as const).map((tier) => ({
    tier,
    people: customers.filter((c) => tierOf(c) === tier),
  }))
  const totalPoints = customers.reduce((sum, c) => sum + pointsOf(c), 0)
  const returners = customers.filter((c) => returnsOf(c).length > 0).length

  return (
    <div className="p-3.5">
      <div className="grid gap-2.5 pb-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Points outstanding", value: totalPoints.toLocaleString() },
          {
            label: "Owed if redeemed",
            value: shortRupiah(totalPoints * POINT_VALUE),
          },
          {
            label: "Members",
            value: String(customers.filter(memberOf).length),
          },
          { label: "Have returned something", value: String(returners) },
        ].map((tile) => (
          <div
            key={tile.label}
            className="rounded-panel bg-inset px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--line)]"
          >
            <div className="pb-1 text-[10.5px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
              {tile.label}
            </div>
            <div className="truncate font-mono text-[17px] font-medium tracking-[-0.02em] text-ink">
              {tile.value}
            </div>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-panel border border-line-strong">
        <div className="border-b border-line px-3.5 py-2.5">
          <div className="text-[12.5px] font-semibold text-ink">Tiers</div>
          <div className="text-[11px] text-ink-4">
            Reached on lifetime spend, net of anything returned
          </div>
        </div>
        {counts.map(({ tier, people }) => (
          <div
            key={tier}
            className="flex items-center gap-3 border-b border-line px-3.5 py-2.5 last:border-b-0"
          >
            <span
              style={{ background: TIER_META[tier].hue }}
              className="size-2.5 shrink-0 rounded-full"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium text-ink">
                {TIER_META[tier].label}
              </span>
              <span className="block truncate text-[11px] text-ink-4">
                {tier === "none"
                  ? "Below the first threshold"
                  : `From ${rupiah(TIER_META[tier].from)} lifetime`}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block font-mono text-[13px] text-ink tabular-nums">
                {people.length}
              </span>
              <span className="block text-[10.5px] text-ink-4">
                {Math.round(
                  (people.length / Math.max(1, customers.length)) * 100
                )}
                %
              </span>
            </span>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-panel bg-inset px-3.5 py-3 text-[11.5px] leading-[1.6] text-ink-3 shadow-[inset_0_0_0_1px_var(--line)]">
        One point for every {rupiah(1 / POINTS_PER_RUPIAH)} spent, and a point
        is worth {rupiah(POINT_VALUE)} back. Points are earned on what was kept
        — a returned line takes its points with it, which is why the balances
        here never drift from the purchase history.
      </div>
    </div>
  )
}
