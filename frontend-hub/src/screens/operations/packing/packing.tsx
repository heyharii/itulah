import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Printer } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import {
  PackingListPrint,
  useShopName,
} from "@/components/operations/outbound-papers"
import {
  PositionPill,
  QrBlock,
  SkuLines,
} from "@/components/operations/outbound-parts"
import { Button } from "@/components/ui/button"
import { ConfirmButton } from "@/components/ui/dialog"
import { Card } from "@/components/ui/card"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { ExpandingSearch } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { SubTabs } from "@/components/ui/sub-tabs"
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
import { moveBack } from "@/lib/operations/changes"
import { loadPrinter } from "@/lib/operations/printer"
import { toast } from "@/lib/toast"
import { idempotencyKey } from "@itulah/contract/client"
import { keys } from "@/lib/operations/keys"
import {
  koliManifestQuery,
  koliQuery,
  picklistsQuery,
} from "@/lib/operations/queries"
import { useEdgeNodeIdentity } from "@/lib/edge-session"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import type { Koli, KoliManifest, PicklistSummary } from "@itulah/contract"
import { PackSheet } from "@/screens/operations/packing/pack-sheet"

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

  const [printKoliId, setPrintKoliId] = useState<string | null>(null)
  const [sorting, setSorting] = useState<SortingState>([])
  const [typed, setTyped] = useState("")
  /// The two lists are two tabs: the shops waiting to be packed, and the
  /// cartons already sealed.
  const [tab, setTab] = useState<"pack" | "cartons">("pack")

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
        sub="Open a store, fill its koli by hand and pack each one. The sticker prints on pack."
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

      <SubTabs
        tabs={[
          {
            value: "pack",
            label: (
              <span>
                To pack
                <span className="ml-1.5 text-body tabular-nums">
                  {count(toPack.length)}
                </span>
              </span>
            ),
          },
          {
            value: "cartons",
            label: (
              <span>
                Koli
                <span className="ml-1.5 text-body tabular-nums">
                  {count(sealed.length)}
                </span>
              </span>
            ),
          },
        ]}
        value={tab}
        onChange={(next) => setTab(next as "pack" | "cartons")}
      />

      {tab === "pack" ? (
        <Card className="overflow-clip">
          {picklists.isPending ? (
            <LoadingState>Reading the picklists…</LoadingState>
          ) : picklists.isError ? (
            <ErrorState
              error={picklists.error}
              onRetry={() => picklists.refetch()}
            />
          ) : toPack.length === 0 ? (
            <EmptyState>
              Nothing is waiting to be packed. Every accepted picklist is
              already in a koli.
            </EmptyState>
          ) : (
            <ul className="flex flex-col">
              {toPack.map((row) => (
                <li
                  key={row.shopId}
                  className="flex min-h-row items-center justify-between gap-3 border-b border-hairline px-3.5 py-2.5 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[0.9375rem] font-medium text-ink">
                      {shopName(row.shopId)}
                    </div>
                    <div className="truncate text-[0.9375rem] text-mute">
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
      ) : (
        <>
          {/* The search under the tabs; on a phone it and the cartons' sort
              are the dock's, not a bar over them. */}
          <div className="group/bar mb-3.5 flex min-h-[2.25rem] flex-wrap items-center gap-2 max-md:hidden">
            <ExpandingSearch
              value={typed}
              onChange={setTyped}
              label="Search koli"
            />
          </div>
          <DockTools
            search={{
              value: typed,
              onChange: setTyped,
              label: "Search koli",
            }}
            sort={dockSortOf(cartons)}
          />

          <Card className="overflow-clip">
            {cartonsLoading ? (
              <LoadingState>Reading the koli…</LoadingState>
            ) : cartonsError ? (
              <ErrorState
                error={cartonsError.error}
                onRetry={() => cartonsError.refetch()}
              />
            ) : sealed.length === 0 ? (
              <EmptyState>
                No koli yet. A pack is made from a shop's own picklists.
              </EmptyState>
            ) : (
              <DataTable<Koli>
                refresh={[picklists, koli]}
                table={cartons}
                onRowClick={(row) => opened.open(row.koli_id)}
                onRowIntent={(row) =>
                  void prefetchKoliDetail(client, row.koli_id)
                }
                isSelected={(row) => row.koli_id === opened.value}
                summary={{
                  carton: (
                    <span>
                      {count(sealed.length)}{" "}
                      <span className="font-normal text-body">koli</span>
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
        </>
      )}

      <PackSheet
        shopId={packSheet.value ?? null}
        onClose={() => packSheet.close()}
      />

      <Carton
        id={opened.value ?? null}
        onClose={() => opened.close()}
        onPrintList={setPrintKoliId}
      />

      <PackingListPrint
        koliIds={printKoliId !== null ? [printKoliId] : []}
        open={printKoliId !== null}
        onClose={() => setPrintKoliId(null)}
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
  const node = useEdgeNodeIdentity()
  const [printKoliId, setPrintKoliId] = useState<string | null>(null)
  return (
    <>
      <PackSheet
        shopId={packSheet.value ?? null}
        onClose={() => packSheet.close()}
      />

      <Carton
        id={opened.value ?? null}
        onClose={() => opened.close()}
        onPrintList={setPrintKoliId}
      />

      <PackingListPrint
        koliIds={printKoliId !== null ? [printKoliId] : []}
        open={printKoliId !== null}
        onClose={() => setPrintKoliId(null)}
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
      header: "Koli",
      size: 210,
      meta: { card: "id", mono: true },
      cell: ({ row }) => (
        <span className="font-mono text-[0.9375rem] text-ink">
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
  const client = useQueryClient()
  /// Unpack: the whole koli goes back to picked, the move-back the dialog
  /// makes with every line at its full quantity.
  const unpack = async (one: KoliManifest) => {
    const by = new Map<string, number>()
    for (const line of one.lines)
      by.set(line.sku_code, (by.get(line.sku_code) ?? 0) + line.quantity)
    const result = await moveBack({
      idempotency_key: idempotencyKey(),
      destination_id: one.koli.destination_store_id,
      from: "packed",
      to: "picked",
      koli_id: one.koli.koli_id,
      lines: [...by].map(([sku_code, quantity]) => ({ sku_code, quantity })),
    })
    void client.invalidateQueries({ queryKey: keys.dc.all })
    void client.invalidateQueries({ queryKey: keys.pools() })
    toast.success(`${one.koli.koli_number} unpacked`, {
      description: "Back to picked",
    })
    if (result.kolis.some((k) => k.emptied)) onClose()
  }

  return (
    <Sheet
      open={id !== null}
      onOpenChange={onClose}
      title="Koli"
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
                <>
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
                    Put back
                  </Button>
                  <ConfirmButton
                    label="Unpack"
                    title="Unpack this koli?"
                    description="All of it goes back to picked and the label is void. Pack it again from the Pack sheet."
                    confirmLabel="Unpack"
                    cancelLabel="Keep"
                    variant="danger"
                    tone="danger"
                    onConfirm={() => unpack(data)}
                  />
                </>
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
        <LoadingState>Reading the koli…</LoadingState>
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
        {print.isPending
          ? "Printing…"
          : manifest.koli.sealed_at === null
            ? "Print label"
            : "Reprint label"}
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
        On the koli&apos;s sticker. The shop scans it to receive this koli.
      </QrBlock>

      <SkuLines quantityLabel="Pcs" lines={manifest.lines} />
    </div>
  )
}
