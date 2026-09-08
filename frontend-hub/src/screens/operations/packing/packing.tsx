import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Printer } from "lucide-react"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DemandSheet } from "@/components/operations/demand-sheet"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Segmented } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState, Problem } from "@/components/ui/states"
import { dc } from "@/lib/api"
import { clock, count, label, positionTone } from "@/lib/format"
import { loadPrinter } from "@/lib/operations/printer"
import { keys } from "@/lib/operations/keys"
import { queryState } from "@/lib/query-state"
import { useEdgeActor } from "@/lib/edge-session"
import { useSheet } from "@/lib/sheets"
import { idempotencyKey } from "@itulah/contract/client"
import type { KoliManifest } from "@itulah/contract"

/// **Packing: the cartons this floor has made, and the next one.**
///
/// Picking fetched a SKU for nobody in particular. Putting pieces in a carton
/// for a shop is what fulfils an allotment line — **this is the moment the
/// outbound flow decides something**, and it is why a pack is per shop and a
/// picklist is not.
///
/// # Why it is one screen and not four
///
/// It was Boxes, Fill a box, Target & sweep, and Rounds. Those four were one
/// act described by the equipment: a carton was opened against a target, a
/// packer scanned pieces into it one tag at a time or walked it under an RFID
/// arch, and a round gathered the cartons if anybody had opened one. A bench
/// with no reader could not use three of the four.
///
/// A pack is now composed the way a picklist is: a shop, a sheet of what it is
/// owed, a number against each line. The node chooses which physical garments
/// answer — oldest first, out of the picking area — exactly as picking chooses
/// what comes off a rack. The RFID path is still there on the wire and is
/// still the right one for a bench that has an arch; nothing on this screen
/// depends on having one.
export function Packing() {
  const composing = useSheet("new-pack")
  const opened = useSheet("koli")
  const slice = useSheet("slice")

  const boxes = useQuery({
    queryKey: keys.koli(),
    queryFn: ({ signal }) => dc.koli({}, signal),
  })

  /// The packer's queue: every shop with something outstanding. The node knows
  /// this — a shop it owes something to has lines in its own allotment work —
  /// and until recently never said, which is why the screens this replaces
  /// asked somebody to type a store id.
  const waiting = useQuery({
    queryKey: keys.destinations(),
    queryFn: ({ signal }) => dc.destinations(signal),
  })

  const all = boxes.data ?? []
  const loose = all.filter(
    (box) => box.sealed_at !== null && box.shipment_id === null
  )
  const open = all.filter((box) => box.sealed_at === null)
  const shown =
    slice.value === "open" ? open : slice.value === "unassigned" ? loose : all
  const shops = waiting.data ?? []

  return (
    <PageContent>
      <PageHeader
        crumb="Packing"
        title="Packing"
        sub="Where a piece stops being the warehouse's and starts being a shop's."
        actions={
          <Button
            variant="primary"
            onClick={() => composing.open(true)}
            disabled={shops.length === 0}
          >
            <Plus />
            New pack
          </Button>
        }
      />

      <KpiStrip className="grid-cols-2 xl:grid-cols-4">
        <Kpi label="Shops waiting" value={count(shops.length)} />
        <Kpi
          label="Can go now"
          value={count(shops.reduce((total, shop) => total + shop.packable, 0))}
          delta="picked, and a shop is waiting for it"
        />
        <Kpi label="Cartons" value={count(all.length)} />
        <Kpi
          label="Sealed and loose"
          value={count(loose.length)}
          delta="waiting for a consignment"
          tone={loose.length > 0 ? "down" : "flat"}
        />
      </KpiStrip>

      {shops.length > 0 && (
        <Card className="mb-[1.125rem] overflow-hidden">
          <CardHeader>
            <CardTitle>Shops waiting</CardTitle>
            <span className="text-[0.75rem] text-mute">
              {count(shops.reduce((total, shop) => total + shop.wanted, 0))}{" "}
              pieces owed
            </span>
          </CardHeader>
          <div className="px-4 pt-1 pb-3.5">
            {/* Wanted and packable are kept apart on purpose. The gap between
                them is the useful reading: it says whether a shop is waiting
                on the racks or waiting on a packer, and those call for very
                different next actions. */}
            <MiniTable head={["Shop", "SKUs", "Owed", "Can go now", ""]}>
              {shops.map((shop) => (
                <MiniRow key={shop.destination_id}>
                  <MiniCell className="font-mono text-[0.71875rem]">
                    {shop.destination_id}
                  </MiniCell>
                  <MiniCell align="right">{count(shop.sku_count)}</MiniCell>
                  <MiniCell align="right">{count(shop.wanted)}</MiniCell>
                  <MiniCell
                    align="right"
                    className={
                      shop.packable === 0 ? "text-faint" : "text-accent"
                    }
                  >
                    {count(shop.packable)}
                  </MiniCell>
                  <MiniCell align="right">
                    <button
                      type="button"
                      disabled={shop.packable === 0}
                      onClick={() => composing.open(true)}
                      className="text-[0.75rem] text-accent underline underline-offset-2 disabled:text-faint disabled:no-underline"
                    >
                      Pack
                    </button>
                  </MiniCell>
                </MiniRow>
              ))}
            </MiniTable>
          </div>
        </Card>
      )}

      {shops.length === 0 && !waiting.isPending && (
        <Banner tone="info" className="mb-[1.125rem]">
          No shop is owed anything this DC has not already packed. A pack is
          raised against an accepted allotment, so the next one starts at the
          centre.
        </Banner>
      )}

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Cartons</CardTitle>
          <Segmented
            value={slice.value ?? "all"}
            onChange={(value) => slice.replace(value)}
            options={[
              { value: "all", label: "All" },
              { value: "unassigned", label: "Loose" },
              { value: "open", label: "Open" },
            ]}
          />
        </CardHeader>

        {queryState(boxes, {
          loading: "Reading the floor…",
          render: () =>
            shown.length === 0 ? (
              <EmptyState>
                {all.length === 0
                  ? "No cartons yet. A pack is composed from what a shop is owed."
                  : "Nothing in this slice. Every carton is somewhere else in the flow."}
              </EmptyState>
            ) : (
              <div className="px-4 pt-1 pb-3.5">
                <MiniTable
                  head={[
                    "Carton",
                    { label: "Shop", align: "left" },
                    "Pieces",
                    { label: "Position", align: "right" },
                  ]}
                >
                  {shown.map((box) => (
                    <MiniRow key={box.koli_id}>
                      <MiniCell>
                        <button
                          type="button"
                          onClick={() => opened.open(box.koli_id)}
                          className="font-mono text-[0.71875rem] text-accent underline underline-offset-2"
                        >
                          {box.koli_number}
                        </button>
                      </MiniCell>
                      <MiniCell className="font-mono text-[0.71875rem]">
                        {box.destination_store_id}
                      </MiniCell>
                      <MiniCell align="right">{count(box.unit_count)}</MiniCell>
                      <MiniCell align="right">
                        <Pill tone={positionTone(box.position)}>
                          {label(box.position)}
                        </Pill>
                      </MiniCell>
                    </MiniRow>
                  ))}
                </MiniTable>
              </div>
            ),
        })}
      </Card>

      <NewPack
        open={composing.value === true}
        onClose={() => composing.close()}
        shops={shops}
      />

      <Carton id={opened.value ?? null} onClose={() => opened.close()} />
    </PageContent>
  )
}

/// Compose a carton: one shop, and how much of what it is owed goes in.
///
/// The shop is chosen inside the sheet rather than before it, because every
/// number below depends on it — what a carton may hold is entirely a question
/// about which shop it is going to.
function NewPack({
  open,
  onClose,
  shops,
}: {
  open: boolean
  onClose: () => void
  shops: readonly {
    destination_id: string
    wanted: number
    packable: number
  }[]
}) {
  const actor = useEdgeActor()
  const client = useQueryClient()
  const [shop, setShop] = useState<string | null>(null)
  const [packed, setPacked] = useState<KoliManifest | null>(null)

  const destination = shop ?? shops[0]?.destination_id ?? null

  const owed = useQuery({
    queryKey: keys.outstanding(destination ?? ""),
    queryFn: ({ signal }) => dc.outstandingFor(destination!, signal),
    enabled: open && destination !== null,
  })

  const pack = useMutation({
    mutationFn: (lines: readonly { sku_code: string; quantity: number }[]) =>
      dc.pack({
        destination_store_id: destination!,
        lines: [...lines],
        actor_id: actor,
        // A pack applied twice is a second carton holding pieces that are
        // already in the first one, and the movements to match.
        idempotency_key: idempotencyKey(),
        // Sealed as it is made. A carton composed from a sheet in one act has
        // nothing left to decide, and an unsealed box is a packing list
        // nobody may print.
        seal: true,
      }),
    onSuccess: (manifest) => {
      setPacked(manifest)
      // A carton changes the floor, what this shop still has coming, the
      // consignment queue behind it, and the outbound pools under all of them.
      void client.invalidateQueries({ queryKey: keys.dc.all })
      void client.invalidateQueries({ queryKey: keys.pools() })
    },
  })

  const close = () => {
    setPacked(null)
    setShop(null)
    pack.reset()
    onClose()
  }

  return (
    <>
      <DemandSheet
        open={open && packed === null}
        onOpenChange={(next) => {
          if (!next) close()
        }}
        title="New pack"
        id={destination ?? undefined}
        sub="What this shop still has coming, and what is actually off the racks for it. A carton can only hold the smaller of the two."
        demand={(owed.data ?? []).map((line) => ({
          sku_code: line.sku_code,
          needed: line.wanted,
          available: line.available,
        }))}
        neededLabel="Owed"
        availableLabel="Picked"
        submitLabel="Create pack"
        submitting={pack.isPending}
        error={pack.error}
        header={
          <div className="mt-3 flex flex-wrap gap-1.5">
            {shops.map((one) => (
              <button
                key={one.destination_id}
                type="button"
                onClick={() => setShop(one.destination_id)}
                className={`min-h-[2.25rem] rounded-full px-3 font-mono text-[0.71875rem] transition-colors ${
                  one.destination_id === destination
                    ? "bg-accent-bg text-accent"
                    : "bg-soft-2 text-body hover:bg-soft-3 hover:text-ink"
                }`}
              >
                {one.destination_id} · {count(one.packable)}
              </button>
            ))}
          </div>
        }
        onSubmit={(lines) => pack.mutate(lines)}
      />

      <Sheet
        open={packed !== null}
        onOpenChange={close}
        title="Carton packed"
        id={packed?.koli.koli_number}
      >
        {packed !== null && <Manifest manifest={packed} />}
      </Sheet>
    </>
  )
}

/// One carton, read back: where it has got to, and what is in it.
function Carton({ id, onClose }: { id: string | null; onClose: () => void }) {
  const manifest = useQuery({
    queryKey: keys.manifest(id ?? ""),
    queryFn: ({ signal }) => dc.koliManifest(id!, signal),
    enabled: id !== null,
  })

  return (
    <Sheet
      open={id !== null}
      onOpenChange={onClose}
      title="Carton"
      id={manifest.data?.koli.koli_number}
    >
      {queryState(manifest, {
        loading: "Reading the carton…",
        render: (found) => <Manifest manifest={found} />,
      })}
    </Sheet>
  )
}

/// The packing list, and the sticker for the outside of the box.
function Manifest({ manifest }: { manifest: KoliManifest }) {
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
    <>
      <Facts>
        <Fact term="Shop">{manifest.koli.destination_store_id}</Fact>
        <Fact term="Pieces">{count(manifest.koli.unit_count)}</Fact>
        <Fact term="Position">
          <Pill tone={positionTone(manifest.koli.position)}>
            {label(manifest.koli.position)}
          </Pill>
        </Fact>
        {manifest.koli.sealed_at !== null && (
          <Fact term="Sealed">{clock(manifest.koli.sealed_at)}</Fact>
        )}
      </Facts>

      <div className="mt-3 flex items-center gap-2">
        <Button
          variant="soft"
          onClick={() => print.mutate()}
          disabled={print.isPending}
        >
          <Printer />
          {print.isPending ? "Sending…" : "Print the sticker"}
        </Button>
        <span
          className="grid size-[3.25rem] shrink-0 place-items-center [&_svg]:size-full"
          aria-hidden
          dangerouslySetInnerHTML={{ __html: manifest.qr_svg }}
        />
      </div>
      <Problem error={print.error} className="mt-2.5" />

      <div className="mt-3">
        <MiniTable head={["SKU", "Pieces"]}>
          {manifest.lines.map((line) => (
            <MiniRow key={line.sku_code}>
              <MiniCell className="font-mono text-[0.71875rem]">
                {line.sku_code}
              </MiniCell>
              <MiniCell align="right">{count(line.quantity)}</MiniCell>
            </MiniRow>
          ))}
        </MiniTable>
      </div>
    </>
  )
}
