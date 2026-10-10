import { useQuery } from "@tanstack/react-query"
import { ArrowLeftRight, History, PackagePlus } from "lucide-react"
import { useEffect, useState } from "react"

import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { CardList } from "@/components/ui/card-list"
import { Fab } from "@/components/ui/fab"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { LeadCard } from "@/components/ui/lead-card"
import { Screen } from "@/components/ui/screen"
import { Segmented } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { count } from "@/lib/format"
import { useGo } from "@/lib/go"
import { fetchPools, poolsKey, type PoolRow } from "@/lib/queries"
import { queryState } from "@/lib/query-state"
import { MoveSheet } from "@/screens/stock/move-sheet"
import { useMover, type Mover } from "@/screens/stock/mover"
import { useOpenRecord } from "@/screens/stock/open-record"
import { PoolGlyph } from "@/screens/stock/parts"
import { PoolSheet, poolName } from "@/screens/stock/pool-sheet"
import { placeCodeOf } from "@/screens/stock/shared"

/// Stock — what is in this store, and moving a piece between the places it
/// can be.
///
/// The hub's patterns on the shop's data: the title is the top bar's, under it
/// the store's three figures (on hand, allotted, missing), and under those a
/// card per pool — a store owns three, so the list is short. Everything that
/// narrows it is the dock's on a phone (Everything / Missing as the status
/// chip) and a `Segmented` on a desk. A card opens its pool as a sheet over the
/// list (`?pool=`), and carries the one thing to do from it: move a piece.
///
/// The one write is a move, and it lives in a sheet (`move-sheet.tsx`). A scan
/// on this page opens it with the piece already loaded; "Move stock" (the
/// dock's round button on a phone, the header's on a desk) opens it waiting for
/// one. Receiving and selling are not moves and are not here — each writes its
/// own cause through its own endpoint.
///
/// The node reports a missing figure per pool, not per piece, so Missing lists
/// the pools that have some.
type View = "all" | "missing"

export function Stock() {
  const go = useGo()
  const mover = useMover()
  const record = useOpenRecord("pool")
  const [view, setView] = useState<View>("all")
  const pools = useQuery({
    queryKey: poolsKey(),
    queryFn: ({ signal }) => fetchPools(signal),
  })
  useScanToMove(mover)

  const rows = (pools.data?.items ?? [])
    .filter((pool) => !pool.is_rollup)
    .sort((left, right) => left.display_order - right.display_order)
  const sum = (pick: (pool: PoolRow) => number) =>
    rows.reduce((running, pool) => running + pick(pool), 0)
  const missing = sum((pool) => pool.missing)
  const short = rows.filter((pool) => pool.missing > 0)
  const shown = view === "missing" ? short : rows

  return (
    <Screen
      counter
      actions={
        <>
          <Button onClick={() => go("/stock/movements")}>
            <History />
            Stock ledger
          </Button>
          <Button variant="primary" onClick={() => mover.start()}>
            <ArrowLeftRight />
            Move stock
          </Button>
        </>
      }
    >
      <DockTools
        status={{
          value: view,
          options: [
            { value: "all", label: "Everything", count: rows.length },
            { value: "missing", label: "Missing", count: short.length },
          ],
          onChange: (next) => setView(next as View),
        }}
      />
      <Fab
        label="Move stock"
        icon={ArrowLeftRight}
        onClick={() => mover.start()}
      />

      {queryState(pools, {
        loading: "Reading this shop's stock…",
        render: () =>
          rows.length === 0 ? (
            <EmptyState
              action={
                <Button onClick={() => go("/receive")}>
                  <PackagePlus />
                  Receive stock
                </Button>
              }
            >
              No stock yet.
            </EmptyState>
          ) : (
            <>
              <KpiStrip>
                <Kpi
                  label="On hand"
                  value={count(sum((pool) => pool.on_hand))}
                />
                <Kpi
                  label="Allotted"
                  value={count(sum((pool) => pool.allotted ?? 0))}
                />
                <Kpi
                  label="Missing"
                  value={
                    <span className={missing > 0 ? "text-bad-fg" : undefined}>
                      {count(missing)}
                    </span>
                  }
                />
              </KpiStrip>

              {/* The desk's switch; on a phone it is the dock's status chip. */}
              <div className="mb-3.5 flex items-center max-md:hidden">
                <Segmented<View>
                  value={view}
                  onChange={setView}
                  options={[
                    {
                      value: "all",
                      label: `Everything · ${count(rows.length)}`,
                    },
                    {
                      value: "missing",
                      label: `Missing · ${count(short.length)}`,
                    },
                  ]}
                />
              </div>

              {shown.length === 0 ? (
                <EmptyState>Nothing missing.</EmptyState>
              ) : (
                <CardList grid className="@4xl:grid-cols-3">
                  {shown.map((pool) => (
                    <PoolCard
                      key={pool.id}
                      pool={pool}
                      selected={record.value === pool.id}
                      onOpen={() => record.open(pool.id)}
                      onMove={() => {
                        const code = placeCodeOf(pool.id)
                        if (code !== null) mover.start(code)
                      }}
                    />
                  ))}
                </CardList>
              )}
            </>
          ),
      })}

      <PoolSheet
        pool={rows.find((pool) => pool.id === record.value)}
        asOf={pools.data?.as_of}
        onClose={record.close}
        mover={mover}
      />
      <MoveSheet mover={mover} />
    </Screen>
  )
}

/// One pool as the uniform card: its name, the pieces on hand as the one
/// figure, and in the foot what is allotted and missing beside a word button
/// that moves a piece out of it. A pool with something missing takes the red
/// foot, so it shows from across the page without a word on it.
function PoolCard({
  pool,
  selected,
  onOpen,
  onMove,
}: {
  pool: PoolRow
  selected: boolean
  onOpen: () => void
  onMove: () => void
}) {
  const code = placeCodeOf(pool.id)
  return (
    <LeadCard
      onOpen={onOpen}
      selected={selected}
      tone={pool.missing > 0 ? "alert" : undefined}
      media={<PoolGlyph code={code} />}
      title={poolName(pool)}
      lead={{
        figure: count(pool.on_hand),
        caption: pool.on_hand === 1 ? "pc on hand" : "pcs on hand",
        muted: pool.on_hand === 0,
      }}
      foot={{
        info: (
          <>
            {count(pool.allotted ?? 0)} allotted ·{" "}
            <span className={pool.missing > 0 ? "text-bad-fg" : undefined}>
              {count(pool.missing)} missing
            </span>
          </>
        ),
        action: code === null ? undefined : { label: "Move", onClick: onMove },
      }}
    />
  )
}

/// A scan on this page opens the move sheet with the piece loaded. There is no
/// field to type into: the reader types the code and presses Enter wherever
/// the caret is, so keys that arrive in a burst and end in Enter are a scan.
function useScanToMove(mover: Mover) {
  const { scan, open } = mover
  useEffect(() => {
    let buffer = ""
    let last = 0
    const onKey = (event: KeyboardEvent) => {
      if (open || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return
      }
      const now = Date.now()
      if (now - last > 100) buffer = ""
      last = now
      if (event.key === "Enter") {
        const raw = buffer.trim()
        buffer = ""
        if (raw.length >= 6) scan(raw)
      } else if (event.key.length === 1) {
        buffer += event.key
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [scan, open])
}
