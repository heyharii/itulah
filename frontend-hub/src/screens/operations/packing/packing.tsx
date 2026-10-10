import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Printer } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import {
  PackingListPrint,
  useShopName,
} from "@/components/operations/outbound-papers"
import {
  PositionPill,
  QrBlock,
  QtyInput,
  SkuLines,
} from "@/components/operations/outbound-parts"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Problem,
} from "@/components/ui/states"
import { dc } from "@/lib/api"
import { clock, count, quantity } from "@/lib/format"
import { MoveBackDialog } from "@/screens/operations/board/move-back"
import type { MoveBackTarget } from "@/screens/operations/board/owed"
import { PackingCell } from "@/screens/operations/packing/packing-cell"
import { prefetchKoliDetail } from "@/screens/operations/prefetch"
import { usePackingShort } from "@/screens/operations/packing/packing-short"
import { loadPrinter } from "@/lib/operations/printer"
import { keys } from "@/lib/operations/keys"
import {
  koliManifestQuery,
  koliQuery,
  picklistsQuery,
} from "@/lib/operations/queries"
import { useCatalogue } from "@/lib/operations/catalogue"
import { useEdgeActor, useEdgeNodeIdentity } from "@/lib/edge-session"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { idempotencyKey } from "@itulah/contract/client"
import type { Koli, KoliManifest, PicklistSummary } from "@itulah/contract"

/// **Packing: the cartons this floor has made, and the next one.**
///
/// Owner, 29 Sep 2026: **a packer opens a SHOP, not a picklist.** Picking is
/// accept-only and leaves every picklist's quantities exactly as accepted; a
/// shop can have several of them waiting at once, one per allotment. Packing
/// is where they are gathered: open the shop, choose which of its picklists
/// go in this carton, enter how much of each article, and seal. What used to
/// be a box opened against a target, swept under a reader and only then
/// packed by the server is now one request against the picklists ticked:
/// quantities in, `KoliManifest` — the sealed carton and its manifest — out.
///
/// # One queue, one sheet
///
/// **"To pack"** is every shop with a picked picklist still standing in the
/// pick area and in no carton. Its row's **Pack** opens that shop's sheet,
/// every picklist ticked by default; the packer can untick one to leave it
/// for a later carton. **Pack next shop** after sealing moves straight to
/// whichever shop is next, so a bench can pack a whole morning without
/// leaving the sheet.
export function Packing() {
  const packSheet = useSheet("pack")
  const opened = useSheet("koli")
  const shopName = useShopName()
  const node = useEdgeNodeIdentity()
  const client = useQueryClient()

  const [justPacked, setJustPacked] = useState<{
    readonly manifest: KoliManifest
    readonly shopId: string | null
  } | null>(null)
  const [showList, setShowList] = useState(false)
  const [printKoliId, setPrintKoliId] = useState<string | null>(null)
  const [sorting, setSorting] = useState<SortingState>([])
  const [typed, setTyped] = useState("")

  /// Every picklist this DC has raised — the same list Picking reads.
  const picklists = useQuery(picklistsQuery())
  const koli = useQuery(koliQuery())

  /// Picklists still owed a pack, grouped by shop — a shop with several
  /// allotments each contributes its own row here.
  const byShop = useMemo(() => {
    const map = new Map<string, PicklistSummary[]>()
    for (const round of picklists.data ?? []) {
      if (round.waiting <= 0 || round.destination_id === null) continue
      const list = map.get(round.destination_id)
      if (list) list.push(round)
      else map.set(round.destination_id, [round])
    }
    return map
  }, [picklists.data])

  /// The "To pack" rows: busiest shop (most pieces waiting) first.
  const toPack = useMemo(
    () =>
      [...byShop.entries()]
        .map(([shopId, rounds]) => ({
          shopId,
          rounds,
          pieces: rounds.reduce((total, round) => total + round.waiting, 0),
        }))
        .sort(
          (a, b) => b.pieces - a.pieces || a.shopId.localeCompare(b.shopId)
        ),
    [byShop]
  )

  const sealed = useMemo(
    () =>
      (koli.data ?? [])
        .filter((one) => one.sealed_at !== null)
        // Newest first, by seal time: old `KOLI-…` numbers and the yearly
        // `A00001` ones do not sort against each other.
        .sort(
          (a, b) =>
            Date.parse(b.sealed_at ?? "") - Date.parse(a.sealed_at ?? "") ||
            b.koli_number.localeCompare(a.koli_number)
        ),
    [koli.data]
  )
  const sealedToday = useMemo(
    () => sealed.filter((one) => isToday(one.sealed_at)),
    [sealed]
  )

  const printSticker = useMutation({
    mutationFn: (koliId: string) => {
      const printer = loadPrinter()
      return dc.printKoliLabel(koliId, {
        printer_host: printer.host,
        printer_port: printer.port,
        label_width_mm: printer.widthMm,
        label_height_mm: printer.heightMm,
      })
    },
  })

  /// The next shop "Pack next shop" should land on: whichever is not the one
  /// just sealed, or that same one again if it is genuinely the only one
  /// left waiting.
  const nextToPack = (excludingShopId: string | null) => {
    const other = toPack.find((row) => row.shopId !== excludingShopId)
    return other ?? toPack.find((row) => row.shopId === excludingShopId) ?? null
  }

  const cartonColumns = useMemo(() => cartonColumnsFor(setPrintKoliId), [])

  // A phone's search, over the cartons: the dock that carries their sort.
  const needle = typed.trim().toLowerCase()
  const searched = useMemo(
    () =>
      needle === ""
        ? sealed
        : sealed.filter(
            (one) =>
              one.koli_number.toLowerCase().includes(needle) ||
              shopName(one.destination_store_id).toLowerCase().includes(needle)
          ),
    [sealed, needle, shopName]
  )

  const cartons = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: searched,
        columns: cartonColumns,
        getRowId: (row: Koli) => row.koli_id,
        state: { sorting },
        onSortingChange: setSorting,
      }),
      [searched, cartonColumns, sorting]
    )
  )

  const cartonsLoading = koli.isPending
  const cartonsError = koli.isError ? koli : null

  return (
    <PageContent>
      <PageHeader
        crumb="Operations"
        title="Packing"
        sub="Open a shop, gather its picked picklists, enter quantities and seal. The packing list and sticker print on seal."
      />

      <KpiStrip className="grid-cols-2 md:grid-cols-4 xl:grid-cols-4">
        <Kpi label="Shops to pack" value={count(toPack.length)} />
        <Kpi
          label="Pcs to pack"
          value={count(toPack.reduce((total, row) => total + row.pieces, 0))}
        />
        <Kpi label="Sealed today" value={count(sealedToday.length)} />
        <Kpi
          label="Pcs sealed"
          value={count(
            sealedToday.reduce((total, one) => total + one.unit_count, 0)
          )}
        />
      </KpiStrip>

      {/* On a phone the cartons' sort is the dock's, not a bar over them. */}
      <DockTools
        search={{ value: typed, onChange: setTyped, label: "Search cartons" }}
        sort={dockSortOf(cartons)}
      />

      <Card className="mb-5 overflow-clip">
        <CardHeader>
          <CardTitle>To pack</CardTitle>
        </CardHeader>
        {picklists.isPending ? (
          <LoadingState>Reading the picklists…</LoadingState>
        ) : picklists.isError ? (
          <ErrorState
            error={picklists.error}
            onRetry={() => picklists.refetch()}
          />
        ) : toPack.length === 0 ? (
          <EmptyState>
            Nothing is waiting to be packed. Every accepted picklist is already
            in a carton.
          </EmptyState>
        ) : (
          <ul className="flex flex-col border-t border-hairline">
            {toPack.map((row) => (
              <li
                key={row.shopId}
                className="flex min-h-row items-center justify-between gap-3 border-b border-hairline px-3.5 py-2.5 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[0.9375rem] font-medium text-ink">
                    {shopName(row.shopId)}
                  </div>
                  <div className="truncate text-[0.875rem] text-mute">
                    {count(row.rounds.length)}{" "}
                    {row.rounds.length === 1 ? "picklist" : "picklists"} ·{" "}
                    {quantity(row.pieces)} to pack
                  </div>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => packSheet.open(row.shopId)}
                >
                  Pack
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="overflow-clip">
        <CardHeader>
          <CardTitle>Cartons</CardTitle>
        </CardHeader>

        {cartonsLoading ? (
          <LoadingState>Reading the cartons…</LoadingState>
        ) : cartonsError ? (
          <ErrorState
            error={cartonsError.error}
            onRetry={() => cartonsError.refetch()}
          />
        ) : sealed.length === 0 ? (
          <EmptyState>
            No cartons yet. A pack is made from a shop's own picklists.
          </EmptyState>
        ) : (
          <DataTable<Koli>
            refresh={[picklists, koli]}
            table={cartons}
            onRowClick={(row) => opened.open(row.koli_id)}
            onRowIntent={(row) => void prefetchKoliDetail(client, row.koli_id)}
            isSelected={(row) => row.koli_id === opened.value}
            summary={{
              carton: (
                <span>
                  {count(sealed.length)}{" "}
                  <span className="font-normal text-body">
                    {sealed.length === 1 ? "carton" : "cartons"}
                  </span>
                </span>
              ),
              pieces: count(
                sealed.reduce((total, row) => total + row.unit_count, 0)
              ),
            }}
            pageScroll
            cardSort={false}
          />
        )}
      </Card>

      <PackSheet
        shopId={packSheet.value ?? null}
        onClose={() => packSheet.close()}
        onPacked={(manifest) => {
          const shopId = packSheet.value ?? null
          packSheet.close()
          // The packing list is printed on purpose — Print on the carton, or
          // Packing list below — not thrown up after every seal (owner,
          // 10 Oct 2026).
          setJustPacked({ manifest, shopId })
          if (manifest.koli.koli_id)
            void printSticker.mutate(manifest.koli.koli_id)
          // The carton exists — its list, its ready row and its manifest —
          // the rounds it drew from have less waiting, and the pieces moved
          // out of pickable stock.
          void client.invalidateQueries({ queryKey: ["dc", "koli"] })
          void client.invalidateQueries({ queryKey: keys.picklists() })
          void client.invalidateQueries({ queryKey: ["dc", "pick-session"] })
          void client.invalidateQueries({ queryKey: keys.pools() })
        }}
      />

      <Sheet
        open={justPacked !== null}
        onOpenChange={(next) => {
          if (!next) setJustPacked(null)
        }}
        title="Packed"
        // Print lives at the top, in the head's ⋯, on every width (owner,
        // 10 Oct 2026) — the foot is for what comes next.
        more={[
          {
            label: "Print packing list",
            icon: <Printer />,
            onSelect: () => setShowList(true),
          },
        ]}
        footer={
          justPacked && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex-1" />
              {(() => {
                const next = nextToPack(justPacked.shopId)
                return next ? (
                  <Button
                    variant="primary"
                    onClick={() => {
                      setJustPacked(null)
                      packSheet.replace(next.shopId)
                    }}
                  >
                    Pack next shop · {shopName(next.shopId)}
                  </Button>
                ) : (
                  <AppLink
                    to="/operations/despatch"
                    variant="primary"
                    onClick={() => setJustPacked(null)}
                  >
                    Go to Dispatch
                  </AppLink>
                )
              })()}
            </div>
          )
        }
      >
        {justPacked && (
          <div className="flex flex-col gap-4">
            <Facts>
              <Fact term="Shop">
                {shopName(justPacked.manifest.koli.destination_store_id)}
              </Fact>
              <Fact term="Carton">{justPacked.manifest.koli.koli_number}</Fact>
              <Fact term="Pcs">
                {count(justPacked.manifest.koli.unit_count)}
              </Fact>
            </Facts>
          </div>
        )}
      </Sheet>

      <Carton
        id={opened.value ?? null}
        onClose={() => opened.close()}
        onPrintList={setPrintKoliId}
      />

      <PackingListPrint
        koliIds={
          printKoliId !== null
            ? [printKoliId]
            : justPacked && showList
              ? [justPacked.manifest.koli.koli_id]
              : []
        }
        open={printKoliId !== null || (showList && justPacked !== null)}
        onClose={() => {
          setPrintKoliId(null)
          setShowList(false)
        }}
        siteId={node.data?.site_id ?? null}
      />
    </PageContent>
  )
}

/// The pack sheet, the carton sheet and what follows a seal, for a screen that
/// is not Packing — the Outbound board opens them in place.
export function PackSheets() {
  const packSheet = useSheet("pack")
  const opened = useSheet("koli")
  const shopName = useShopName()
  const node = useEdgeNodeIdentity()
  const client = useQueryClient()
  const [justPacked, setJustPacked] = useState<{
    readonly manifest: KoliManifest
    readonly shopId: string | null
  } | null>(null)
  const [showList, setShowList] = useState(false)
  const [printKoliId, setPrintKoliId] = useState<string | null>(null)
  const picklists = useQuery({
    queryKey: keys.picklists(),
    queryFn: ({ signal }) => dc.picklists(signal),
  })
  const printSticker = useMutation({
    mutationFn: (koliId: string) => {
      const printer = loadPrinter()
      return dc.printKoliLabel(koliId, {
        printer_host: printer.host,
        printer_port: printer.port,
        label_width_mm: printer.widthMm,
        label_height_mm: printer.heightMm,
      })
    },
  })
  const nextToPack = (excludingShopId: string | null) => {
    const waiting = new Map<string, number>()
    for (const round of picklists.data ?? []) {
      if (round.waiting <= 0 || round.destination_id === null) continue
      waiting.set(
        round.destination_id,
        (waiting.get(round.destination_id) ?? 0) + round.waiting
      )
    }
    const shops = [...waiting.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([shopId]) => ({ shopId }))
    const other = shops.find((row) => row.shopId !== excludingShopId)
    return other ?? shops.find((row) => row.shopId === excludingShopId) ?? null
  }

  return (
    <>
      <PackSheet
        shopId={packSheet.value ?? null}
        onClose={() => packSheet.close()}
        onPacked={(manifest) => {
          const shopId = packSheet.value ?? null
          packSheet.close()
          // The packing list is printed on purpose — Print on the carton, or
          // Packing list below — not thrown up after every seal (owner,
          // 10 Oct 2026).
          setJustPacked({ manifest, shopId })
          if (manifest.koli.koli_id)
            void printSticker.mutate(manifest.koli.koli_id)
          // The carton exists — its list, its ready row and its manifest —
          // the rounds it drew from have less waiting, and the pieces moved
          // out of pickable stock.
          void client.invalidateQueries({ queryKey: ["dc", "koli"] })
          void client.invalidateQueries({ queryKey: keys.picklists() })
          void client.invalidateQueries({ queryKey: ["dc", "pick-session"] })
          void client.invalidateQueries({ queryKey: keys.pools() })
        }}
      />

      <Sheet
        open={justPacked !== null}
        onOpenChange={(next) => {
          if (!next) setJustPacked(null)
        }}
        title="Packed"
        // Print lives at the top, in the head's ⋯, on every width (owner,
        // 10 Oct 2026) — the foot is for what comes next.
        more={[
          {
            label: "Print packing list",
            icon: <Printer />,
            onSelect: () => setShowList(true),
          },
        ]}
        footer={
          justPacked && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex-1" />
              {(() => {
                const next = nextToPack(justPacked.shopId)
                return next ? (
                  <Button
                    variant="primary"
                    onClick={() => {
                      setJustPacked(null)
                      packSheet.replace(next.shopId)
                    }}
                  >
                    Pack next shop · {shopName(next.shopId)}
                  </Button>
                ) : (
                  <AppLink
                    to="/operations/despatch"
                    variant="primary"
                    onClick={() => setJustPacked(null)}
                  >
                    Go to Dispatch
                  </AppLink>
                )
              })()}
            </div>
          )
        }
      >
        {justPacked && (
          <div className="flex flex-col gap-4">
            <Facts>
              <Fact term="Shop">
                {shopName(justPacked.manifest.koli.destination_store_id)}
              </Fact>
              <Fact term="Carton">{justPacked.manifest.koli.koli_number}</Fact>
              <Fact term="Pcs">
                {count(justPacked.manifest.koli.unit_count)}
              </Fact>
            </Facts>
          </div>
        )}
      </Sheet>

      <Carton
        id={opened.value ?? null}
        onClose={() => opened.close()}
        onPrintList={setPrintKoliId}
      />

      <PackingListPrint
        koliIds={
          printKoliId !== null
            ? [printKoliId]
            : justPacked && showList
              ? [justPacked.manifest.koli.koli_id]
              : []
        }
        open={printKoliId !== null || (showList && justPacked !== null)}
        onClose={() => {
          setPrintKoliId(null)
          setShowList(false)
        }}
        siteId={node.data?.site_id ?? null}
      />
    </>
  )
}

function isToday(iso: string | null): boolean {
  if (iso === null) return false
  const at = new Date(iso)
  const now = new Date()
  return (
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate()
  )
}

/// The shop a row belongs to, read the way every screen in this app names
/// one: the register's own name first — id dropped entirely once it is the
/// same word twice, which is what an unresolved id already falls back to.
function ShopCell({ id }: { id: string }) {
  const shopName = useShopName()
  return <span className="truncate text-ink">{shopName(id)}</span>
}

function cartonColumnsFor(
  onPrintList: (koliId: string) => void
): ColumnDef<TableSetup, Koli>[] {
  return [
    {
      id: "carton",
      accessorKey: "koli_number",
      header: "Carton",
      size: 210,
      meta: { card: "id", mono: true },
      cell: ({ row }) => (
        <span className="font-mono text-[0.875rem] text-ink">
          {row.original.koli_number}
        </span>
      ),
    },
    {
      id: "shop",
      accessorFn: (row: Koli) => row.destination_store_id,
      header: "Shop",
      meta: { card: "title", grow: 140 },
      cell: ({ row }) => <ShopCell id={row.original.destination_store_id} />,
    },
    {
      id: "pieces",
      accessorKey: "unit_count",
      header: "Pcs",
      size: 100,
      meta: { align: "right", card: "metric" },
      cell: ({ row }) => count(row.original.unit_count),
    },
    {
      id: "sealed",
      accessorKey: "sealed_at",
      header: "Sealed",
      size: 150,
      meta: { card: "meta", priority: 2 },
      cell: ({ row }) => (
        <span className="tabular-nums">{clock(row.original.sealed_at)}</span>
      ),
    },
    {
      id: "action",
      header: "",
      size: 140,
      enableSorting: false,
      meta: { align: "right", card: "status" },
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={(event) => {
            event.stopPropagation()
            onPrintList(row.original.koli_id)
          }}
        >
          Packing list
        </Button>
      ),
    },
  ]
}

/// Pack one shop's carton: gather the picklists it has waiting — ticked by
/// default, any of them can be left off this carton — and enter how much of
/// each article goes in. Starts empty rather than prefilled, so a carton
/// says what somebody put in it, not what the sheet assumed. Single column
/// throughout: this sheet is used on a phone at the bench.
function PackSheet({
  shopId,
  onClose,
  onPacked,
}: {
  shopId: string | null
  onClose: () => void
  onPacked: (manifest: KoliManifest) => void
}) {
  const actor = useEdgeActor()
  const shopName = useShopName()
  const { identities: catalogue } = useCatalogue()
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())
  const [drawn, setDrawn] = useState<Readonly<Record<string, number>>>({})

  const picklists = useQuery({
    queryKey: keys.picklists(),
    queryFn: ({ signal }) => dc.picklists(signal),
    enabled: shopId !== null,
  })

  const shopRounds = useMemo(
    () =>
      (picklists.data ?? []).filter(
        (round) => round.destination_id === shopId && round.waiting > 0
      ),
    [picklists.data, shopId]
  )

  // Every ticked-or-not picklist's own lines, read together — a shop's carton
  // draws from more than one allotment, and each is fetched once regardless
  // of whether it is ticked, so toggling a tick needs no new request.
  const sessionQueries = useQueries({
    queries: shopRounds.map((round) => ({
      queryKey: keys.pickRound(round.session.session_id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        dc.pickSession(round.session.session_id, signal),
      enabled: shopId !== null,
    })),
  })
  const sessionsLoaded = sessionQueries.every((one) => one.data !== undefined)

  // Every picklist starts ticked when the sheet opens on a (new) shop — reset
  // once the shop's own picklists have arrived, not on every background
  // refetch, which would re-tick a picklist somebody had deliberately left
  // off.
  const openedFor = useRef<string | null>(null)
  useEffect(() => {
    if (shopId === null) {
      openedFor.current = null
      return
    }
    if (openedFor.current === shopId || picklists.data === undefined) return
    openedFor.current = shopId
    setTicked(new Set(shopRounds.map((round) => round.session.session_id)))
    setDrawn({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, picklists.data])

  /// Every ticked picklist's lines, summed by SKU — what this carton can
  /// still draw on. Recomputed plainly on every render rather than memoised:
  /// the lists involved are one carton's worth of SKUs, and a memo keyed on
  /// `sessionQueries` (a fresh array every render) would either recompute
  /// just as often or go stale the moment a ticked session's own data
  /// changes underneath it.
  const toPackBySku = new Map<string, number>()
  shopRounds.forEach((round, index) => {
    if (!ticked.has(round.session.session_id)) return
    const data = sessionQueries[index]?.data
    if (!data) return
    for (const line of data.lines) {
      if (line.waiting <= 0) continue
      toPackBySku.set(
        line.sku_code,
        (toPackBySku.get(line.sku_code) ?? 0) + line.waiting
      )
    }
  })
  const lines = [...toPackBySku.entries()].map(([sku_code, waiting]) => ({
    sku_code,
    waiting,
  }))

  // A tick removed while its SKU had a Pack quantity drawn must not leave a
  // number on screen bigger than what this carton can now actually take —
  // clamped for display here, and clamped again below when the mutation
  // builds its own lines, so a stale value can never reach the server either.
  const clamp = (sku: string, value: number): number =>
    Math.min(value, toPackBySku.get(sku) ?? 0)

  const pieces = Object.entries(drawn).reduce(
    (total, [sku, qty]) => total + clamp(sku, qty),
    0
  )
  const lineCount = Object.entries(drawn).filter(
    ([sku, qty]) => clamp(sku, qty) > 0
  ).length
  const tickedCount = shopRounds.filter((round) =>
    ticked.has(round.session.session_id)
  ).length

  const pack = useMutation({
    mutationFn: () => {
      if (shopId === null) throw new Error("No shop chosen.")
      const pickSessionIds = shopRounds
        .filter((round) => ticked.has(round.session.session_id))
        .map((round) => round.session.session_id)
      return dc.pack({
        destination_store_id: shopId,
        lines: Object.entries(drawn)
          .map(([sku_code, qty]) => ({
            sku_code,
            quantity: clamp(sku_code, qty),
          }))
          .filter((line) => line.quantity > 0),
        actor_id: actor,
        // One carton, one seal. Applied twice the second attempt would pack
        // and seal a second carton from the same picklists.
        idempotency_key: idempotencyKey(),
        seal: true,
        pick_session_ids: pickSessionIds,
      })
    },
    onSuccess: (manifest) => onPacked(manifest),
  })

  // A refusal from the last shop must not still be sitting under this one —
  // the sheet stays mounted between openings.
  useEffect(() => {
    if (shopId !== null) pack.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId])

  return (
    <Sheet
      open={shopId !== null}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      width="workspace"
      title="Pack"
      caption={shopId ? shopName(shopId) : undefined}
      footer={
        shopId === null ? undefined : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto text-[0.875rem] text-mute">
              {lineCount > 0
                ? `${quantity(lineCount, "items")} · ${quantity(pieces)}`
                : "Enter what went in the carton"}
            </span>
            <Button
              variant="primary"
              disabled={lineCount === 0 || tickedCount === 0}
              pending={pack.isPending}
              onClick={() => pack.mutate()}
            >
              Pack and seal
            </Button>
          </div>
        )
      }
    >
      {shopId === null ? null : picklists.isPending ? (
        <LoadingState>Reading the picklists…</LoadingState>
      ) : picklists.isError ? (
        <ErrorState
          error={picklists.error}
          onRetry={() => picklists.refetch()}
        />
      ) : (
        <div className="flex flex-col gap-5">
          {shopRounds.length === 0 ? (
            <EmptyState>
              Nothing is waiting to be packed for this shop.
            </EmptyState>
          ) : (
            <>
              <div>
                <h4 className="mb-1.5 text-[0.9375rem] font-semibold text-ink">
                  Lines
                </h4>
                {!sessionsLoaded ? (
                  <LoadingState>Reading the ticked picklists…</LoadingState>
                ) : lines.length === 0 ? (
                  <EmptyState>Nothing to draw here.</EmptyState>
                ) : (
                  <div className="overflow-hidden rounded-inner border border-hairline">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="border-b border-hairline text-left text-[0.875rem] text-body">
                          <th className="h-9 px-3 font-normal">Article</th>
                          <th className="h-9 w-20 px-3 text-right font-normal">
                            Stock
                          </th>
                          <th className="h-9 w-24 px-3 text-center font-normal">
                            Pack
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((line) => {
                          const identity = catalogue.get(line.sku_code)
                          const name =
                            [
                              identity?.article_name,
                              identity?.colour,
                              identity?.size,
                            ]
                              .filter(Boolean)
                              .join(" · ") || line.sku_code
                          return (
                            <tr
                              key={line.sku_code}
                              className="border-b border-hairline last:border-b-0"
                            >
                              <td className="px-3 py-2">
                                <div className="min-w-0">
                                  <div className="truncate text-[0.875rem] text-ink">
                                    {name}
                                  </div>
                                  <div className="mt-0.5 truncate font-mono text-[0.875rem] text-faint">
                                    {line.sku_code}
                                  </div>
                                </div>
                              </td>
                              <td className="px-3 py-2 text-right text-[0.875rem] text-body tabular-nums">
                                {count(line.waiting)}
                              </td>
                              <td className="px-3 py-2">
                                <QtyInput
                                  value={clamp(
                                    line.sku_code,
                                    drawn[line.sku_code] ?? 0
                                  )}
                                  max={line.waiting}
                                  label={`Pack ${line.sku_code}`}
                                  padTitle={name}
                                  onChange={(qty) =>
                                    setDrawn((current) => {
                                      if (qty <= 0) {
                                        if (
                                          current[line.sku_code] === undefined
                                        )
                                          return current
                                        const rest = { ...current }
                                        delete rest[line.sku_code]
                                        return rest
                                      }
                                      if (current[line.sku_code] === qty)
                                        return current
                                      return {
                                        ...current,
                                        [line.sku_code]: qty,
                                      }
                                    })
                                  }
                                />
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}

          <Problem error={pack.error} />
        </div>
      )}
    </Sheet>
  )
}

/// One carton, read back: where it has got to, and what is in it. Unchanged
/// in spirit from before the RFID rewrite — a sealed carton is still read the
/// same way once it exists, whatever put the goods inside it.
function Carton({
  id,
  onClose,
  onPrintList,
}: {
  id: string | null
  onClose: () => void
  onPrintList: (koliId: string) => void
}) {
  const manifest = useQuery({
    ...koliManifestQuery(id ?? ""),
    enabled: id !== null,
  })
  // Read once into a local — a query's own `.data` does not narrow inside a
  // closure handed to a prop, since nothing stops the query object itself
  // from being read again later. A plain local does.
  const data = manifest.data
  /// Take pieces out of this carton (or all of them): Move back, asked first.
  /// Only a carton that has not left on a trip; the server refuses the rest.
  const [moving, setMoving] = useState<MoveBackTarget | null>(null)

  return (
    <Sheet
      open={id !== null}
      onOpenChange={onClose}
      title="Carton"
      id={data?.koli.koli_number}
      actions={
        data && (
          <>
            <Button
              variant="ghost"
              onClick={() => onPrintList(data.koli.koli_id)}
            >
              Packing list
            </Button>
            <PrintSticker manifest={data} />
          </>
        )
      }
      footer={
        data &&
        (data.koli.position === "PACKED" ||
          data.koli.position === "SHIPMENT") ? (
          <>
            <SheetFooter
              start={
                <Button
                  variant="ghost"
                  onClick={() =>
                    setMoving({
                      from: "packed",
                      destinationId: data.koli.destination_store_id,
                      koliId: data.koli.koli_id,
                    })
                  }
                >
                  Move back
                </Button>
              }
            />
            {/* Inside the sheet's own tree, so it opens over the carton. */}
            <MoveBackDialog
              target={moving}
              onClose={() => setMoving(null)}
              onMoved={(result) => {
                // An emptied carton is gone: its sheet has nothing to show.
                if (result.kolis.some((one) => one.emptied)) onClose()
              }}
            />
          </>
        ) : undefined
      }
    >
      {id === null ? null : manifest.isPending ? (
        <LoadingState>Reading the carton…</LoadingState>
      ) : manifest.isError ? (
        <ErrorState error={manifest.error} onRetry={() => manifest.refetch()} />
      ) : data ? (
        <Manifest manifest={data} />
      ) : null}
    </Sheet>
  )
}

/// The sticker for the outside of the box, sent to the bench's printer. In the
/// sheet's header: it is the one thing done TO a carton, and at the foot of
/// the manifest it was below everything a packer had just read.
function PrintSticker({ manifest }: { manifest: KoliManifest }) {
  const client = useQueryClient()
  const print = useMutation({
    mutationFn: () => {
      const printer = loadPrinter()
      return dc.printKoliLabel(manifest.koli.koli_id, {
        printer_host: printer.host,
        printer_port: printer.port,
        label_width_mm: printer.widthMm,
        label_height_mm: printer.heightMm,
      })
    },
    onSuccess: () =>
      void client.invalidateQueries({
        queryKey: keys.manifest(manifest.koli.koli_id),
      }),
  })

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button
        variant="soft"
        onClick={() => print.mutate()}
        pending={print.isPending}
      >
        <Printer />
        {print.isPending ? "Sending…" : "Print sticker"}
      </Button>
      <Problem error={print.error} />
    </div>
  )
}

/// The carton's facts, the code on its sticker, and what is in it by article.
function Manifest({ manifest }: { manifest: KoliManifest }) {
  const shopName = useShopName()
  const short = usePackingShort().get(manifest.koli.koli_id) ?? 0
  return (
    <div className="flex flex-col gap-4">
      <Facts>
        <Fact term="Shop">{shopName(manifest.koli.destination_store_id)}</Fact>
        <Fact term="Pcs">{count(manifest.koli.unit_count)}</Fact>
        <Fact term="Status">
          <PositionPill position={manifest.koli.position} />
        </Fact>
        <Fact term="Packing">
          <PackingCell short={short} />
        </Fact>
        <Fact term="Sealed">
          {manifest.koli.sealed_at === null
            ? "Not yet"
            : `${clock(manifest.koli.sealed_at)}${
                manifest.koli.sealed_by ? ` · ${manifest.koli.sealed_by}` : ""
              }`}
        </Fact>
      </Facts>

      <QrBlock svg={manifest.qr_svg} payload={manifest.qr_payload}>
        On the carton&apos;s sticker. The shop scans it to receive this carton.
      </QrBlock>

      <SkuLines quantityLabel="Pcs" lines={manifest.lines} />
    </div>
  )
}
