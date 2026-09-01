import { useMemo, useState } from "react"

import { Link } from "@tanstack/react-router"

import { Icon, paths } from "@/components/dashboard/parts"
import { IconButton, Switch } from "@/components/dashboard/nav-sidebar"
import { SheetShell, sheetButton } from "@/components/dashboard/sheet-shell"
import { AppHeading } from "@/components/app-switcher"
import {
  ArticleTable,
  LocationTable,
  type Focus,
} from "@/components/inventory/monitor"
import { MissingList, MissingSheet } from "@/components/inventory/missing"
import { Ledger } from "@/components/inventory/ledger"
import { InventoryOperations } from "@/components/inventory/operations"
import { EMPTY_SNAPSHOT, useInventoryData } from "@/components/inventory/api"
import { useSubmitInventoryCount } from "@/components/inventory/mutations"
import { percent, total, type SkuRow } from "@/components/inventory/data"
import {
  cue,
  readSoundPreference,
  useInteractionSounds,
  writeSoundPreference,
} from "@/components/dashboard/use-interaction-sounds"
import { cn } from "@/lib/utils"
import { getErrorMessage } from "@/lib/api"
import { Route } from "@/routes/inventory"
import {
  AppShell,
  AppShellSidebar,
  SidebarTrigger,
} from "@/components/app-shell"

function ReadState({
  variant,
  message,
  detail,
  onRetry,
}: {
  variant: "loading" | "error" | "empty"
  message: string
  detail?: string
  onRetry?: () => void
}) {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center gap-2 px-6 text-center text-ink-4">
      <span className="grid size-[36px] place-items-center rounded-panel bg-inset shadow-[inset_0_0_0_1px_var(--line-strong)]">
        {variant === "loading" ? (
          <span className="size-3.5 animate-spin rounded-full border-2 border-ink-4 border-t-transparent" />
        ) : variant === "error" ? (
          <Icon
            path={paths.alert}
            size={17}
            width={1.8}
            className="text-ember"
          />
        ) : (
          <span className="font-mono text-[15px]">—</span>
        )}
      </span>
      <span className="text-xs font-medium text-ink-2">{message}</span>
      {detail && (
        <span className="max-w-[460px] text-[11px] leading-[1.5]">
          {detail}
        </span>
      )}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 inline-flex h-[28px] items-center rounded-control bg-ink px-2.5 text-[11px] font-medium text-surface transition-opacity hover:opacity-85"
        >
          Retry
        </button>
      )}
    </div>
  )
}

export function Inventory() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { tab, q: query = "", unit: unitId } = search

  /* The drill-down travels as three scalars; it is rebuilt into the shape the
   * monitor tables already speak rather than being carried as an object. */
  const focus: Focus | null = search.location
    ? {
        locationId: search.location,
        bucketId: search.bucket,
        stageId: search.stage,
      }
    : null

  /* The count sheet is an unsaved form: which pool is being counted, the
   * numbers typed into it, and whether it is in flight are all local. */
  const [countFor, setCountFor] = useState<Focus | null>(null)
  const [countValues, setCountValues] = useState<Record<string, number>>({})
  const [countError, setCountError] = useState<string | null>(null)
  const [railHidden, setRailHidden] = useState(false)
  const [soundOn, setSoundOn] = useState(readSoundPreference)
  const inventoryState = useInventoryData()
  const submitInventoryCount = useSubmitInventoryCount()
  const countBusy = submitInventoryCount.isPending
  const snapshot = inventoryState.data ?? EMPTY_SNAPSHOT
  const live = inventoryState.status === "success"

  /* Drilling in opens a destination, so it is pushed and Back walks out of it
   * again; clearing the drill-down replaces, so Back does not put it back. */
  const setFocus = (next: Focus | null) =>
    void navigate({
      search: (prev) => ({
        ...prev,
        location: next?.locationId,
        bucket: next?.bucketId,
        stage: next?.stageId,
      }),
      replace: next === null,
    })

  /** Same rule for the missing-unit sheet: opening pushes, closing replaces. */
  const setUnit = (next: string | undefined) =>
    void navigate({
      search: (prev) => ({ ...prev, unit: next }),
      replace: next === undefined,
    })

  useInteractionSounds(soundOn)

  const unit =
    snapshot.missing.find((candidate) => candidate.epc === unitId) ?? null

  const group = useMemo(() => total(snapshot.rows), [snapshot.rows])
  const openMissing = snapshot.missing.filter((m) => m.status === "open").length
  const countEnabled = snapshot.authority !== "pool"
  const authorityLabel = !live
    ? inventoryState.status === "error"
      ? "API unavailable"
      : "Loading"
    : snapshot.authority === "pool"
      ? "Live · pool projection"
      : snapshot.projection.mode === "shadow"
        ? "Live · signed ledger · pool shadow"
        : snapshot.projection.mode === "disabled"
          ? "Live · signed ledger · pool disabled"
          : snapshot.projection.mode === "unknown"
            ? "Live · signed ledger · pool status unknown"
            : "Live · signed ledger"

  const rowsAt = (locationId: string, bucketId?: string, stageId?: string) =>
    snapshot.rows.filter(
      (row) =>
        row.locationId === locationId &&
        (!bucketId || row.bucketId === bucketId) &&
        (!stageId || row.stageId === stageId)
    )

  const openCount = (target: Focus) => {
    // The pool projection is read-only until the approved count workflow
    // emits a two-sided Movement. Never post a legacy signed variance against
    // a pool-authoritative screen.
    if (snapshot.authority === "pool") return
    const targetLocation = snapshot.locations.find(
      (candidate) => candidate.id === target.locationId
    )
    const targetBucket = targetLocation?.buckets.find(
      (candidate) => candidate.id === target.bucketId
    )
    const targetCountable = targetBucket
      ? targetBucket.countable !== false
      : Boolean(
          targetLocation?.buckets.length &&
          targetLocation.buckets.every(
            (candidate) => candidate.countable !== false
          )
        )
    if (!targetCountable) return
    const rows = rowsAt(target.locationId, target.bucketId, target.stageId)
    setCountFor(target)
    setCountError(null)
    setCountValues(Object.fromEntries(rows.map((row) => [row.id, row.stock])))
  }

  const countRows = countFor
    ? rowsAt(countFor.locationId, countFor.bucketId, countFor.stageId)
    : []

  const submitCount = async () => {
    if (!countFor || countBusy || countRows.length === 0) return
    setCountError(null)
    try {
      /* The mutation invalidates the ["inventory"] namespace itself, so there
       * is no reload() here — the snapshot refetches because the cache says
       * so. */
      await submitInventoryCount.mutateAsync({
        locationId: countFor.locationId,
        rows: countRows.map((row) => ({
          id: row.id,
          sku: row.productId,
          binId: row.binId,
          expectedQty: row.stock,
          countedQty: countValues[row.id] ?? row.stock,
        })),
      })
      cue("success")
      setCountFor(null)
      setCountValues({})
    } catch (error: unknown) {
      setCountError(getErrorMessage(error, "The count could not be submitted."))
    }
  }

  const focusRows: SkuRow[] = focus
    ? rowsAt(focus.locationId, focus.bucketId, focus.stageId)
    : []
  const focusPosition = total(focusRows)
  const location = focus
    ? snapshot.locations.find((candidate) => candidate.id === focus.locationId)
    : undefined
  const bucket = location?.buckets.find((b) => b.id === focus?.bucketId)
  const stage = bucket?.stages?.find((s) => s.id === focus?.stageId)

  const navRow =
    "flex h-8 w-full items-center gap-2.5 rounded-control px-2 text-left text-[13px] font-medium transition-colors duration-[110ms]"

  return (
    <AppShell
      label="Inventory navigation"
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
            <AppHeading app="inventory" />
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
                ["monitor", "Monitor", paths.table, 0],
                ["missing", "Missing", paths.alert, openMissing],
                ["ledger", "Ledger", paths.list, 0],
                ["operations", "Operations", paths.list, 0],
              ] as const
            ).map(([id, label, icon, count]) => {
              const on = tab === id
              /* Monitor and Operations are whole-estate views: arriving at
                 either drops the drill-down, exactly as before. */
              const clearsFocus = id === "monitor" || id === "operations"
              return (
                <Link
                  key={id}
                  from="/inventory"
                  to="/inventory"
                  search={(prev) => ({
                    ...prev,
                    tab: id,
                    ...(clearsFocus
                      ? {
                          location: undefined,
                          bucket: undefined,
                          stage: undefined,
                        }
                      : {}),
                  })}
                  replace
                  data-sound="page"
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
                    <span className="ml-auto rounded-full bg-ember px-1.5 font-mono text-[10.5px] text-white">
                      {count}
                    </span>
                  )}
                </Link>
              )
            })}

            <div className="mt-3.5 flex h-7 items-center px-2 text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
              Locations
            </div>
            {snapshot.locations.map((l) => {
              const on = focus?.locationId === l.id && tab === "monitor"
              const missing = snapshot.missing.filter(
                (m) => m.locationId === l.id && m.status === "open"
              ).length
              return (
                /* One navigation sets the focus and the tab together: picking a
                   location has always meant "show me its monitor". */
                <Link
                  key={l.id}
                  from="/inventory"
                  to="/inventory"
                  search={(prev) => ({
                    ...prev,
                    tab: "monitor" as const,
                    location: l.id,
                    bucket: undefined,
                    stage: undefined,
                  })}
                  className={cn(
                    navRow,
                    "text-ink-2 hover:bg-hover hover:text-ink",
                    on && "bg-hover font-semibold text-ink"
                  )}
                >
                  <span className="truncate">{l.name}</span>
                  {missing > 0 && (
                    <span className="ml-auto font-mono text-[10.5px] text-ink-4">
                      {missing}
                    </span>
                  )}
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
            {focus ? (
              /* the breadcrumb is a real link back to the un-focused monitor */
              <Link
                from="/inventory"
                to="/inventory"
                search={(prev) => ({
                  ...prev,
                  location: undefined,
                  bucket: undefined,
                  stage: undefined,
                })}
                replace
                className="flex min-w-0 items-center gap-1.5 text-left"
              >
                <Icon
                  path={paths.chevronRight}
                  size={14}
                  width={2.2}
                  className="shrink-0 rotate-180 text-ink-4"
                />
                <span className="truncate text-sm font-semibold text-ink">
                  {location?.name}
                  {bucket && (
                    <span className="font-normal text-ink-3">
                      {" "}
                      · {bucket.name}
                    </span>
                  )}
                  {stage && (
                    <span className="font-normal text-ink-3">
                      {" "}
                      · {stage.name}
                    </span>
                  )}
                </span>
              </Link>
            ) : (
              <span className="text-sm font-semibold text-ink">
                {tab === "monitor"
                  ? "Inventory"
                  : tab === "missing"
                    ? "Missing"
                    : tab === "ledger"
                      ? "Ledger"
                      : "Operations"}
              </span>
            )}

            <span className="rounded-full bg-inset px-2 py-0.5 text-[10px] font-medium text-ink-4 shadow-[inset_0_0_0_1px_var(--line)]">
              {authorityLabel}
            </span>

            {live &&
              tab === "monitor" &&
              !focus &&
              (snapshot.authority === "pool" ? (
                <span className="ml-3 flex items-center gap-3 text-[11.5px] text-ink-3">
                  <span>
                    <span className="font-mono text-ink">
                      {group.stock.toLocaleString()}
                    </span>{" "}
                    units in pool
                  </span>
                  <span className="text-ink-4">
                    Observation feed unavailable
                  </span>
                </span>
              ) : (
                <span className="ml-3 flex items-center gap-3 text-[11.5px] text-ink-3">
                  <span>
                    <span className="font-mono text-ink">
                      {group.stock.toLocaleString()}
                    </span>{" "}
                    in stock
                  </span>
                  <span>
                    <span className="font-mono text-grass">
                      {percent(group.observed, group.stock)}%
                    </span>{" "}
                    available
                  </span>
                  <span>
                    <span className="font-mono text-ember">
                      {group.missing.toLocaleString()}
                    </span>{" "}
                    reserved
                  </span>
                </span>
              ))}

            {live &&
              focus &&
              (snapshot.authority === "pool" ? (
                <span className="ml-3 flex items-center gap-3 text-[11.5px] text-ink-3">
                  <span>
                    <span className="font-mono text-ink">
                      {focusPosition.stock.toLocaleString()}
                    </span>{" "}
                    units in pool
                  </span>
                  <span className="text-ink-4">
                    Observation feed unavailable
                  </span>
                </span>
              ) : (
                <span className="ml-3 flex items-center gap-3 text-[11.5px] text-ink-3">
                  <span>
                    <span className="font-mono text-ink">
                      {focusPosition.stock.toLocaleString()}
                    </span>{" "}
                    in stock
                  </span>
                  <span>
                    <span className="font-mono text-ink-3">
                      {focusPosition.missing}
                    </span>{" "}
                    reserved
                  </span>
                </span>
              ))}

            {focus && (
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
                        q: e.target.value || undefined,
                      }),
                      replace: true,
                    })
                  }
                  placeholder="Article or number"
                  className="h-[32px] w-[220px] rounded-control bg-field pr-2.5 pl-8 text-xs text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none placeholder:text-ink-4 focus:bg-surface focus:shadow-[inset_0_0_0_1px_var(--accent)]"
                />
              </span>
            )}
          </header>

          <div className="min-h-0 flex-1 overflow-auto">
            {tab === "operations" ? (
              <InventoryOperations />
            ) : (
              <>
                {live && snapshot.warnings.length > 0 && (
                  <div className="mx-3.5 mt-3 flex items-start gap-2 rounded-panel bg-honey/10 px-3 py-2 text-[11px] leading-[1.45] text-ink-3 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--honey)_30%,transparent)]">
                    <Icon
                      path={paths.alert}
                      size={14}
                      width={1.8}
                      className="mt-px shrink-0 text-honey"
                    />
                    <span>{snapshot.warnings.join(" ")}</span>
                  </div>
                )}
                {inventoryState.status === "loading" && (
                  <ReadState
                    variant="loading"
                    message="Loading inventory"
                    detail="Reading balances, movement history, and bin metadata from the cloud inventory API."
                  />
                )}
                {inventoryState.status === "error" && (
                  <ReadState
                    variant="error"
                    message="Inventory could not be loaded"
                    detail={inventoryState.errorMessage}
                    onRetry={inventoryState.reload}
                  />
                )}
                {live &&
                  tab === "monitor" &&
                  !focus &&
                  snapshot.rows.length > 0 && (
                    <LocationTable
                      locations={snapshot.locations}
                      rows={snapshot.rows}
                      live
                      countEnabled={countEnabled}
                      source={snapshot.authority}
                      onOpen={setFocus}
                      onCount={openCount}
                    />
                  )}
                {live &&
                  tab === "monitor" &&
                  !focus &&
                  snapshot.rows.length === 0 && (
                    <ReadState
                      variant="empty"
                      message="No inventory balances returned"
                      detail="The API is reachable, but there are no balance rows for the current scope."
                    />
                  )}
                {live &&
                  tab === "monitor" &&
                  focus &&
                  focusRows.length === 0 && (
                    <ReadState
                      variant="empty"
                      message="No balances in this pool"
                      detail="There are no inventory balance rows for the selected location or pool."
                    />
                  )}
                {live && tab === "monitor" && focus && focusRows.length > 0 && (
                  <ArticleTable
                    focus={focus}
                    query={query}
                    onCount={openCount}
                    rows={snapshot.rows}
                    live
                    countEnabled={countEnabled}
                    countable={
                      bucket
                        ? bucket.countable !== false
                        : Boolean(
                            location?.buckets.length &&
                            location.buckets.every(
                              (candidate) => candidate.countable !== false
                            )
                          )
                    }
                    source={snapshot.authority}
                  />
                )}
                {live && tab === "missing" && (
                  <MissingList
                    units={snapshot.missing}
                    onOpen={(next) => setUnit(next.epc)}
                  />
                )}
                {live && tab === "ledger" && (
                  <Ledger
                    movements={snapshot.movements}
                    locations={snapshot.locations}
                    live
                  />
                )}
              </>
            )}
          </div>
        </div>
      </main>

      <MissingSheet unit={unit} onClose={() => setUnit(undefined)} />

      {/* the only action on a row: count it */}
      <SheetShell
        open={Boolean(countFor)}
        eyebrow="Official count"
        title={
          countFor
            ? [
                snapshot.locations.find((l) => l.id === countFor.locationId)
                  ?.name,
                snapshot.locations
                  .find((l) => l.id === countFor.locationId)
                  ?.buckets.find((b) => b.id === countFor.bucketId)?.name,
                snapshot.locations
                  .find((l) => l.id === countFor.locationId)
                  ?.buckets.find((b) => b.id === countFor.bucketId)
                  ?.stages?.find((s) => s.id === countFor.stageId)?.name,
              ]
                .filter(Boolean)
                .join(" · ")
            : ""
        }
        onRequestClose={() => {
          if (!countBusy) {
            setCountFor(null)
            setCountError(null)
          }
        }}
        footer={
          <>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => setCountFor(null)}
              className={sheetButton.secondary}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={countBusy || countRows.length === 0}
              onClick={() => void submitCount()}
              className={sheetButton.primary}
            >
              <Icon path={paths.check} size={14} width={2.2} />
              {countBusy ? "Submitting…" : "Submit count"}
            </button>
          </>
        }
      >
        {countFor && (
          <div className="px-[18px] pt-4 pb-[18px]">
            <div className="mb-4 rounded-panel bg-inset px-3 py-2.5 text-[11.5px] leading-[1.5] text-ink-3 shadow-[inset_0_0_0_1px_var(--line)]">
              Enter the physical quantity for each SKU. Only changed rows become
              adjustment lines, submitted as one manual inventory adjustment;
              Internal either posts it or queues it for approval.
            </div>
            {countError && (
              <div className="mb-3 rounded-panel border border-ember/20 bg-ember/5 px-3 py-2 text-[11.5px] text-ember">
                {countError}
              </div>
            )}
            <div className="mb-4 overflow-hidden rounded-panel shadow-[inset_0_0_0_1px_var(--line)]">
              <div className="grid grid-cols-[minmax(0,1fr)_90px_110px_70px] gap-2 border-b border-line bg-inset px-3 py-2 text-[10.5px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
                <span>SKU</span>
                <span className="text-right">Book</span>
                <span className="text-right">Counted</span>
                <span className="text-right">Variance</span>
              </div>
              <div className="max-h-[260px] overflow-auto">
                {countRows.map((row) => {
                  const counted = countValues[row.id] ?? row.stock
                  const variance = counted - row.stock
                  return (
                    <div
                      key={row.id}
                      className="grid grid-cols-[minmax(0,1fr)_90px_110px_70px] items-center gap-2 border-b border-line px-3 py-2 last:border-b-0"
                    >
                      <span className="truncate font-mono text-[11.5px] text-ink-2">
                        {row.productId}
                      </span>
                      <span className="text-right font-mono text-[11.5px] text-ink-3">
                        {row.stock.toLocaleString()}
                      </span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={counted}
                        onChange={(event) =>
                          setCountValues((values) => ({
                            ...values,
                            [row.id]: Number(event.target.value),
                          }))
                        }
                        aria-label={`Counted quantity for ${row.productId}`}
                        className="h-[28px] rounded-control bg-field px-2 text-right font-mono text-[11.5px] text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none focus:bg-surface focus:shadow-[inset_0_0_0_1px_var(--accent)]"
                      />
                      <span
                        className={cn(
                          "text-right font-mono text-[11.5px]",
                          variance > 0
                            ? "text-grass"
                            : variance < 0
                              ? "text-ember"
                              : "text-ink-4"
                        )}
                      >
                        {variance > 0 ? "+" : ""}
                        {variance.toLocaleString()}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                {
                  label: "SKUs",
                  value: String(
                    rowsAt(
                      countFor.locationId,
                      countFor.bucketId,
                      countFor.stageId
                    ).length
                  ),
                },
                {
                  label: "Stock",
                  value: total(
                    rowsAt(
                      countFor.locationId,
                      countFor.bucketId,
                      countFor.stageId
                    )
                  ).stock.toLocaleString(),
                },
                {
                  label: live ? "Reserved" : "Missing",
                  value: String(
                    total(
                      rowsAt(
                        countFor.locationId,
                        countFor.bucketId,
                        countFor.stageId
                      )
                    ).missing
                  ),
                },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-panel bg-inset px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--line)]"
                >
                  <div className="pb-1 text-[10.5px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
                    {stat.label}
                  </div>
                  <div className="truncate font-mono text-[15px] font-medium text-ink">
                    {stat.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </SheetShell>
    </AppShell>
  )
}
