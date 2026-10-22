import { useQueries, useQuery } from "@tanstack/react-query"
import { ChevronRight, Package } from "lucide-react"
import { useMemo, useState } from "react"

import { TripSuratJalanPrint } from "@/components/operations/outbound-papers"
import { Button } from "@/components/ui/button"
import { DocStamp } from "@/components/ui/doc-stamp"
import { Sheet } from "@/components/ui/sheet"
import { Thumbnail } from "@/components/ui/thumbnail"
import { WASH, type WashTone } from "@/components/ui/wash"
import { dc } from "@/lib/api"
import { useColourwayFill } from "@/lib/colourway-fill"
import { count, time, sku as skuNumber } from "@/lib/format"
import { rfidChecks, rfidKeys } from "@/lib/operations/rfid"
import { useCatalogueIdentity } from "@/lib/operations/catalogue"
import { keys } from "@/lib/operations/keys"
import { cn } from "@/lib/utils"
import { PrintMenu } from "@/screens/procurement/print-menu"
import type { Paper } from "@/screens/procurement/po-print"
import {
  KoliDialog,
  type KoliRef,
} from "@/screens/operations/board/koli-dialog"
import { Railed } from "@/screens/operations/board/tables"
import { shortOf, stopState, type Trip } from "@/screens/operations/board/trips"
import { bare, many } from "@/screens/operations/board/words"
import type { ShipmentDetail } from "@itulah/contract"
import { useOpenReviews } from "@/screens/allotment/review-data"

type Stop = Trip["stops"][number]

/// **One surat jalan, read back** (owner, 18 Oct 2026, pack-sheet-options:
/// "received harusnya per dispatch dan bisa di klik, hasilnya seperti MD
/// review allotment"). Read only for Ops: MD decides what a short means.
///
/// The crumb "Allotment", the title "Trip number", then one line
/// (left, stores, koli, pieces) and a box per store on the trip: its name and
/// status, one line "N koli · N pcs · N articles", the koli as chips that open
/// what is inside, and the articles with one number, pieces, folded to SKUs
/// (owner, 20 Oct 2026: sent and received together for one store is noise).
/// The foot
/// has Print surat jalan at the left and a solid Close.
///
/// What the stores' receipts carry is a TOTAL per delivery, so a difference is
/// told in the status pill; it is marked on an article row only when the
/// delivery has a single article. Pieces counted at the store that were not on
/// the delivery are one row, without the SKU.
export function TripSheet({
  trip,
  onClose,
  shop,
}: {
  trip: Trip | null
  onClose: () => void
  shop: (id: string) => string
}) {
  const [koli, setKoli] = useState<KoliRef | null>(null)
  const [printing, setPrinting] = useState<Paper | null>(null)
  // The last trip stays drawn while the sheet slides away.
  const [last, setLast] = useState<Trip | null>(null)
  if (trip !== null && last !== trip) setLast(trip)
  const shown = trip ?? last
  // The store the sheet shows (owner, 21 Oct 2026: a rail of the trip's
  // stores, as on the board, straight to that store's list). The first
  // store until one is chosen.
  const [chosen, setChosen] = useState<string | null>(null)
  const stops = shown?.stops ?? []
  const at = Math.max(
    0,
    stops.findIndex((stop) => stop.shipment.shipment_id === chosen)
  )

  const details = useQueries({
    queries: (shown?.stops ?? []).map((stop) => ({
      queryKey: keys.shipment(stop.shipment.shipment_id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        dc.shipment(stop.shipment.shipment_id, signal),
      enabled: trip !== null,
    })),
  })

  const pieces =
    shown?.stops.reduce((total, stop) => total + stop.shipment.unit_count, 0) ??
    0
  const koliCount =
    shown?.stops.reduce((total, stop) => total + stop.shipment.koli_count, 0) ??
    0

  return (
    <>
      <Sheet
        open={trip !== null}
        onOpenChange={(next) => !next && onClose()}
        context={shown === null ? false : "Allotment"}
        title={shown === null ? "Surat jalan" : `Trip ${shown.number}`}
        size="wide"
        footer={
          // Print at the left, Close at the right: two boxes, so the White
          // look's "every verb at the right" (white.css `.sheet-foot`) does
          // not gather them.
          <div className="flex items-center justify-between gap-3">
            <div>
              <PrintMenu
                label="Print surat jalan"
                paperKey="surat-jalan"
                defaultPaper="A4-portrait"
                onChoose={(choice) => setPrinting(choice.paper)}
              />
            </div>
            <div>
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        }
      >
        {shown !== null && (
          <div className="flex flex-col">
            <p className="mb-1.5 text-body tabular-nums">
              Left {time(shown.left)} · {many(shown.stops.length, "store")} ·{" "}
              {many(koliCount, "koli", "koli")} · {count(pieces)}{" "}
              {pieces === 1 ? "pc" : "pcs"}
            </p>
            {stops.length > 1 ? (
              <div className="mt-3">
                <Railed
                  stores={stops.map((stop) => stop.shipment.shipment_id)}
                  value={stops[at].shipment.shipment_id}
                  onChange={setChosen}
                  pieces={(id) =>
                    stops.find((stop) => stop.shipment.shipment_id === id)
                      ?.shipment.unit_count ?? 0
                  }
                  name={(id) => {
                    const stop = stops.find(
                      (one) => one.shipment.shipment_id === id
                    )
                    return stop === undefined
                      ? ""
                      : shop(stop.shipment.destination_store_id) ||
                          stop.shipment.destination_code
                  }}
                >
                  <StoreSection
                    key={stops[at].shipment.shipment_id}
                    stop={stops[at]}
                    detail={details[at]?.data}
                    loading={details[at]?.isPending ?? false}
                    shop={shop}
                    onKoli={setKoli}
                    flat
                  />
                </Railed>
              </div>
            ) : (
              stops.map((stop, index) => (
                <StoreSection
                  key={stop.shipment.shipment_id}
                  stop={stop}
                  detail={details[index]?.data}
                  loading={details[index]?.isPending ?? false}
                  shop={shop}
                  onKoli={setKoli}
                />
              ))
            )}
          </div>
        )}
      </Sheet>
      <KoliDialog koli={koli} onClose={() => setKoli(null)} />
      {printing !== null && shown !== null && (
        <TripSuratJalanPrint
          dispatchId={shown.trip.dispatch_id}
          open
          paper={printing}
          onClose={() => setPrinting(null)}
        />
      )}
    </>
  )
}

/// The status beside a store's name: a filled pill on the state's wash.
function StatusPill({
  tone,
  children,
}: {
  tone: WashTone
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        "ml-auto rounded-[999px] px-2.5 py-[3px] whitespace-nowrap",
        WASH[tone]
      )}
    >
      {children}
    </span>
  )
}

/// Two columns: the article, then pieces.
const ROW = "grid grid-cols-[minmax(0,1fr)_6rem] items-center"

function StoreSection({
  stop,
  detail,
  loading,
  shop,
  onKoli,
  flat = false,
}: {
  stop: Stop
  detail: ShipmentDetail | undefined
  loading: boolean
  shop: (id: string) => string
  onKoli: (koli: KoliRef) => void
  flat?: boolean
}) {
  const catalogue = useCatalogueIdentity()
  const openReview = useOpenReviews()
  const state = stopState(
    stop,
    openReview(stop.shipment.dispatch_id ?? "", stop.shipment.destination_store_id)
  )
  const name =
    shop(stop.shipment.destination_store_id) || stop.shipment.destination_code
  const got = stop.received
  const short = shortOf(stop)
  const extra = got?.extra_qty ?? 0

  // Each koli, and what is in it by article then SKU (owner, 21 Oct 2026:
  // "store saja dan koli saja, koli ini accordion yg bisa dibuka articlenya").
  const boxes = useMemo(
    () =>
      (detail?.koli ?? []).map((box) => {
        const bySku = new Map<string, number>()
        for (const line of box.lines)
          bySku.set(
            line.sku_code,
            (bySku.get(line.sku_code) ?? 0) + line.quantity
          )
        const byArticle = new Map<
          string,
          {
            code: string
            name: string
            photo: string
            skus: { sku: string; variant: string; sent: number }[]
          }
        >()
        for (const [sku, quantity] of bySku) {
          const one = catalogue.get(sku)
          const code = one?.article_code ?? sku
          const row = byArticle.get(code) ?? {
            code,
            name: one?.article_name ?? sku,
            photo: sku,
            skus: [],
          }
          row.skus.push({
            sku,
            variant: [one?.colour, one?.size].filter(Boolean).join(" · "),
            sent: quantity,
          })
          byArticle.set(code, row)
        }
        return { box, articles: [...byArticle.values()] }
      }),
    [detail, catalogue]
  )

  /// Each koli's RFID check, for its cap (owner, 21 Oct 2026).
  const checks = useQuery({
    queryKey: rfidKeys.checks(),
    queryFn: ({ signal }) => rfidChecks(signal),
  })
  const verifiedAt = (koliId: string) =>
    checks.data?.find((one) => one.koli_id === koliId)?.verified_at ?? null

  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())
  const toggle = (id: string) =>
    setOpened((was) => {
      const next = new Set(was)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <section
      // Beside the rail the store is the whole page, no box around it
      // (owner, 21 Oct 2026); stacked, each store is a box of its own.
      className={
        flat ? "pt-1.5" : "mt-3 rounded-xl border border-hairline px-3.5 py-3"
      }
      aria-label={name}
    >
      <div className="mb-2.5 flex items-center gap-2.5">
        <h3 className="text-[1.0625rem] font-semibold text-ink">{name}</h3>
        {/* The store's own surat jalan: the number on its paper and on its
        Receive screen, not the trip's. */}
        <span className="font-mono text-[0.9375rem] text-mute">
          {stop.shipment.shipment_number}
        </span>
        {got !== undefined && short > 0 && (
          <span className="text-bad-fg tabular-nums">−{count(short)}</span>
        )}
        {state.label === "Received" ? (
          // Received in the primary colour (owner, 20 Oct 2026).
          <span className="ml-auto rounded-[999px] bg-cta px-2.5 py-[3px] whitespace-nowrap text-cta-fg">
            {state.label}
          </span>
        ) : (
          <StatusPill tone={state.tone}>{state.label}</StatusPill>
        )}
      </div>

      <div role="table" aria-label={`Sent to ${name}`}>
        {loading && boxes.length === 0 && (
          <div className="py-2 text-body">Reading the koli…</div>
        )}
        {boxes.map(({ box, articles }, index) => {
          const id = box.koli.koli_id
          const open = opened.has(id)
          return (
            <div key={id} className="border-row-line border-t">
              <div className={cn(ROW, "min-h-14")}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => toggle(id)}
                  className="flex min-h-14 w-full min-w-0 items-center gap-2.5 text-left"
                >
                  <ChevronRight
                    aria-hidden
                    className={cn(
                      "size-4 shrink-0 text-body transition-[rotate] duration-150 ease-(--ease-out) motion-reduce:transition-none",
                      open && "rotate-90"
                    )}
                  />
                  <Package className="size-[1.125rem] shrink-0 text-body" aria-hidden />
                  <span className="font-semibold text-ink">Koli {index + 1}</span>
                  <span className="truncate text-body tabular-nums">
                    {bare(box.koli.koli_number)}
                  </span>
                  <span className="shrink-0 text-body">
                    {articles.length === 1
                      ? "1 article"
                      : `${count(articles.length)} articles`}
                  </span>
                  {verifiedAt(id) !== null && (
                    <DocStamp
                      word="RFID verified"
                      tone="ok"
                      at={verifiedAt(id)}
                      className="static ml-2 text-[1rem] leading-5"
                    />
                  )}
                </button>
                <span className="text-right text-[1.0625rem] font-semibold text-ink tabular-nums">
                  {count(box.koli.unit_count)}
                </span>
              </div>
              {open && (
                <div className="pb-2 pl-6">
                  {articles.map((one) => (
                    <ArticleRows
                      key={one.code}
                      name={one.name}
                      photo={one.photo}
                      skus={one.skus}
                      total={one.skus.reduce((sum, sku) => sum + sku.sent, 0)}
                      diff=""
                      open
                      onToggle={() =>
                        onKoli({
                          id,
                          label: `Koli ${index + 1}`,
                          code: box.koli.koli_number,
                          store: name,
                          sealedAt: box.koli.sealed_at,
                          pieces: box.koli.unit_count,
                        })
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
        {extra > 0 && (
          <div role="row" className={cn(ROW, "border-row-line border-t py-2")}>
            <span role="cell" className="min-w-0 pl-4">
              <span className="block font-medium text-warn-fg">
                Counted at the store
              </span>
              <span
                className={cn(
                  "mt-0.5 inline-block rounded-[999px] px-2 py-px",
                  WASH.warn
                )}
              >
                Not on this delivery
              </span>
            </span>
            <span role="cell" className="text-right text-bad-fg tabular-nums">
              +{count(extra)}
            </span>
          </div>
        )}
        {!loading && boxes.length === 0 && (
          <div role="row" className="border-row-line border-t py-2 text-body">
            Nothing to show
          </div>
        )}
      </div>
    </section>
  )
}

/// An article's row with its pieces, and under it, once pressed, its SKUs.
function ArticleRows({
  name,
  photo,
  skus,
  total,
  diff,
  open,
  onToggle,
}: {
  name: string
  /// A SKU of the article, for its picture.
  photo: string
  skus: readonly { sku: string; variant: string; sent: number }[]
  total: number
  /// A small red "−1" after the number; empty when it matches.
  diff: string
  open: boolean
  onToggle: () => void
}) {
  return (
    <>
      <div role="row" className={cn(ROW, "border-row-line border-t")}>
        <span role="cell" className="min-w-0">
          <button
            type="button"
            aria-expanded={open}
            onClick={onToggle}
            className="flex min-h-14 w-full items-center gap-2.5 text-left"
          >
            <ChevronRight
              aria-hidden
              className={cn(
                "size-4 shrink-0 text-body transition-[rotate] duration-150 ease-(--ease-out) motion-reduce:transition-none",
                open && "rotate-90"
              )}
            />
            <ArticlePhoto sku={photo} name={name} />
            <span className="min-w-0 truncate font-semibold text-ink">
              {name}
            </span>
            <span className="ml-2 shrink-0 text-body">
              {many(skus.length, "SKU")}
            </span>
          </button>
        </span>
        <span
          role="cell"
          className="text-right text-[1.0625rem] font-semibold text-ink tabular-nums"
        >
          {count(total)}
          {diff !== "" && (
            <span className="ml-1.5 text-bad-fg">{diff}</span>
          )}
        </span>
      </div>
      {open &&
        skus.map((one) => (
          <div
            key={one.sku}
            role="row"
            className={cn(ROW, "border-row-line border-t py-2")}
          >
            <span role="cell" className="min-w-0 pl-[4.25rem]">
              <span className="block font-medium text-ink">
                {one.variant || skuNumber(one.sku)}
              </span>
              <span className="block text-body tabular-nums">
                {skuNumber(one.sku)}
              </span>
            </span>
            <span role="cell" className="text-right tabular-nums">
              {count(one.sent)}
            </span>
          </div>
        ))}
    </>
  )
}

/// The article's picture on its row, from one of its SKUs.
function ArticlePhoto({ sku, name }: { sku: string; name: string }) {
  const identity = useCatalogueIdentity().get(sku)
  const fill = useColourwayFill()
  return (
    <Thumbnail
      url={identity?.image_url ?? null}
      name={identity?.article_name ?? name}
      division={identity?.division_code}
      colours={fill(identity?.colour ?? null)}
      className="size-10 shrink-0 rounded-[9px]"
    />
  )
}
