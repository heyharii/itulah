import { useQueries, useQuery } from "@tanstack/react-query"
import { Printer, X } from "lucide-react"
import { useEffect } from "react"
import { createPortal } from "react-dom"

import { Button } from "@/components/ui/button"
import { dc } from "@/lib/api"
import { useEdgeNodeIdentity } from "@/lib/edge-session"
import { clock, count, dayIndonesian, quantity } from "@/lib/format"
import { divisionName, useCatalogueIdentity } from "@/lib/operations/catalogue"
import { keys } from "@/lib/operations/keys"
import { tripDocumentNumber } from "@/lib/operations/trip-number"
import { useSiteLabel, useUnitLabel } from "@/lib/queries/organisation"
import { COMPANY } from "@/screens/finance-lab/print"
import type { KoliManifest, ShipmentDetail } from "@itulah/contract"

/// **The two papers outbound hands over: the packing list and the surat jalan.**
///
/// A packing list is one carton: what is in it, by article, and it goes inside
/// the box. A surat jalan is one trip: every shop's cartons on that truck,
/// grouped by shop, and it travels with the driver (owner, 2 Oct 2026: one
/// trip, one surat jalan). Its number is the trip's `dispatch_number`; the
/// per-shop shipments underneath stay, because each shop receives its own.
///
/// The paper is Indonesian — it is handed to people who read it that way — and
/// says nothing about how the carton was checked. The screen around it is not
/// printed.
///
/// # Why the print is the browser's
///
/// Same reasoning as the giro print: `@page` with the paper's size and a
/// stylesheet that hides the app, so the page on screen and the page on paper
/// are the same DOM. The overlay is portalled to `body` so hiding "everything
/// else" is one rule rather than a hunt through the shell.

/// A shop as people read it, looked up in the one register every screen
/// shares. A destination id may name a site or a unit; whichever the register
/// knows wins, and an id nobody registered reads as itself.
// eslint-disable-next-line react-refresh/only-export-components -- a hook every outbound screen imports from here
export function useShopName(): (id: string) => string {
  const site = useSiteLabel()
  const unit = useUnitLabel()
  return (id) => {
    const bySite = site(id)
    if (bySite !== id && bySite !== "…") return bySite
    const byUnit = unit(id)
    return byUnit === "…" ? id : byUnit
  }
}

const today = () => dayIndonesian(new Date())

const PRINT_CSS = (size: "A4" | "A5") => `
@page { size: ${size}; margin: 0; }
@media print {
  body > *:not(.outbound-print) { display: none !important; }
  .outbound-print { position: static !important; background: none !important; overflow: visible !important; }
  .outbound-print-bar { display: none !important; }
  .outbound-print-pages { padding: 0 !important; gap: 0 !important; overflow: visible !important; }
  .outbound-paper { box-shadow: none !important; margin: 0 !important; break-after: page; }
  .outbound-paper:last-child { break-after: auto; }
}
`

/// The overlay the papers are read and printed from.
function PaperOverlay({
  open,
  title,
  note,
  size,
  ready,
  onClose,
  children,
}: {
  open: boolean
  title: string
  note: string
  size: "A4" | "A5"
  ready: boolean
  onClose: () => void
  children: React.ReactNode
}) {
  useEffect(() => {
    if (!open) return
    // Captured and stopped: the paper sits over a sheet, and Escape closing the
    // paper must not also close the sheet the packer is still working in.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.stopPropagation()
      event.preventDefault()
      onClose()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div className="outbound-print fixed inset-0 z-[80] flex flex-col bg-ink/55">
      <style>{PRINT_CSS(size)}</style>
      <div className="outbound-print-bar flex items-center gap-3 border-b border-hairline bg-canvas px-5 py-3">
        <span className="text-[0.9375rem] font-semibold text-ink">{title}</span>
        <span className="text-[0.875rem] text-mute">{note}</span>
        <div className="flex-1" />
        <Button
          variant="primary"
          disabled={!ready}
          onClick={() => window.print()}
        >
          <Printer />
          Print
        </Button>
        <Button variant="ghost" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="outbound-print-pages flex flex-1 flex-col items-center gap-6 overflow-auto px-4 pt-7 pb-16">
        {children}
      </div>
    </div>,
    document.body
  )
}

const PAPER =
  "outbound-paper bg-white text-[14px] leading-[19px] text-[#111] shadow-[0_8px_30px_rgb(0_0_0/0.25)]"

function Qr({ svg, size }: { svg: string; size: string }) {
  return (
    <div
      className={`shrink-0 [&_svg]:h-full [&_svg]:w-full ${size}`}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

/// One carton's packing list: A5, inside the box. Qty only — what went in is
/// the whole story; what the shop was owed is the allotment's business.
export function PackingListPaper({
  manifest,
  from,
}: {
  manifest: KoliManifest
  from: string
}) {
  const identity = useCatalogueIdentity()
  const shop = useShopName()
  const { koli } = manifest
  const total = manifest.lines.reduce((sum, line) => sum + line.quantity, 0)
  // One row per SKU. The manifest can split a SKU across allotment lines;
  // the shop counts garments, not allotment lines.
  const rows = [
    ...manifest.lines
      .reduce((bySku, line) => {
        bySku.set(
          line.sku_code,
          (bySku.get(line.sku_code) ?? 0) + line.quantity
        )
        return bySku
      }, new Map<string, number>())
      .entries(),
  ]
  return (
    <div className={`${PAPER} min-h-[210mm] w-[148mm] p-[9mm]`}>
      <div className="mb-3.5 flex items-start justify-between gap-4 border-b-2 border-[#111] pb-3.5">
        <div>
          <div className="text-[24px] leading-[28px] font-bold tracking-[0.02em]">
            PACKING LIST
          </div>
          <div className="mt-1">{from}</div>
        </div>
        <Qr svg={manifest.qr_svg} size="size-[24mm]" />
      </div>
      <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1">
        <dt className="text-[#555]">No. koli</dt>
        <dd className="font-mono font-semibold">{koli.koli_number}</dd>
        <dt className="text-[#555]">Toko</dt>
        <dd className="font-semibold">{shop(koli.destination_store_id)}</dd>
        <dt className="text-[#555]">Tanggal</dt>
        <dd>
          {today()}
          {koli.sealed_at !== null && `, ${clock(koli.sealed_at)}`}
        </dd>
        {koli.sealed_by && (
          <>
            <dt className="text-[#555]">Dikemas</dt>
            <dd>{koli.sealed_by}</dd>
          </>
        )}
      </dl>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b-[1.5px] border-[#111] text-left">
            <th className="px-1.5 py-1.5 font-semibold">No</th>
            <th className="px-1.5 py-1.5 font-semibold">Artikel</th>
            <th className="px-1.5 py-1.5 font-semibold">Warna / Ukuran</th>
            <th className="px-1.5 py-1.5 font-semibold">SKU</th>
            <th className="px-1.5 py-1.5 text-right font-semibold">Quantity</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([sku, quantity], index) => {
            const one = identity.get(sku)
            return (
              <tr key={sku} className="border-b border-[#ccc]">
                <td className="px-1.5 py-1.5">{index + 1}</td>
                <td className="px-1.5 py-1.5">{one?.article_name ?? "—"}</td>
                <td className="px-1.5 py-1.5">
                  {[one?.colour, one?.size].filter(Boolean).join(" / ") || "—"}
                </td>
                <td className="px-1.5 py-1.5 font-mono">{sku}</td>
                <td className="px-1.5 py-1.5 text-right">{count(quantity)}</td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-[1.5px] border-[#111] font-bold">
            <td className="px-1.5 py-1.5" colSpan={4}>
              Total
            </td>
            <td className="px-1.5 py-1.5 text-right">{quantity(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

/// One shop's surat jalan: A4, one trip note. Carton level — what is in each
/// carton is on its packing list. The trip note is filled in once it is
/// known, and left as a line to write on before that (owner, 29 Sep 2026:
/// one free-text note replaces the plate and driver fields).
export function SuratJalanPaper({
  detail,
  from,
  tripNote,
}: {
  detail: ShipmentDetail
  from: string
  tripNote: string | null
}) {
  const shop = useShopName()
  const { shipment } = detail
  const pieces = detail.koli.reduce(
    (sum, manifest) => sum + manifest.koli.unit_count,
    0
  )
  const noteText = tripNote?.trim() ?? ""
  return (
    <div className={`${PAPER} min-h-[297mm] w-[210mm] px-[13mm] py-[12mm]`}>
      <div className="mb-3.5 flex items-start justify-between gap-4 border-b-2 border-[#111] pb-3.5">
        <div className="text-[16px] font-bold">{from}</div>
        <div className="text-right">
          <div className="text-[24px] leading-[28px] font-bold tracking-[0.02em]">
            SURAT JALAN
          </div>
          <div className="mt-1 font-mono font-semibold">
            {shipment.shipment_number}
          </div>
        </div>
      </div>
      <div className="mb-5 flex items-start justify-between gap-6">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1">
          <dt className="text-[#555]">Kepada</dt>
          <dd className="font-semibold">
            {shop(shipment.destination_store_id)}
          </dd>
          <dt className="text-[#555]">Tanggal</dt>
          <dd>{today()}</dd>
        </dl>
        <Qr svg={detail.qr_svg} size="size-[29mm]" />
      </div>
      <div className="mb-5">
        <div className="text-[#555]">Data perjalanan</div>
        {noteText === "" ? (
          <div className="mt-1 min-h-[19px] w-full border-b border-dotted border-[#777]">
            &nbsp;
          </div>
        ) : (
          <div className="mt-1 border-b border-dotted border-[#777] pb-1 whitespace-pre-wrap">
            {noteText}
          </div>
        )}
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b-[1.5px] border-[#111] text-left">
            <th className="w-11 px-1.5 py-1.5 font-semibold">No</th>
            <th className="px-1.5 py-1.5 font-semibold">
              No. koli / packing list
            </th>
            <th className="px-1.5 py-1.5 text-right font-semibold">Jumlah</th>
          </tr>
        </thead>
        <tbody>
          {detail.koli.map((manifest, index) => (
            <tr key={manifest.koli.koli_id} className="border-b border-[#ccc]">
              <td className="px-1.5 py-1.5">{index + 1}</td>
              <td className="px-1.5 py-1.5 font-mono">
                {manifest.koli.koli_number}
              </td>
              <td className="px-1.5 py-1.5 text-right">
                {quantity(manifest.koli.unit_count)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-[1.5px] border-[#111] font-bold">
            <td className="px-1.5 py-1.5" />
            <td className="px-1.5 py-1.5">{count(detail.koli.length)} koli</td>
            <td className="px-1.5 py-1.5 text-right">{quantity(pieces)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="mt-4 text-[#444]">
        Rincian isi setiap koli ada pada packing list di dalam koli. Mohon
        periksa jumlah koli dan kondisi segel saat menerima.
      </p>
      <div className="mt-24 grid grid-cols-3 gap-5 text-center">
        {["Dibuat oleh", "Pengemudi", "Diterima oleh"].map((who) => (
          <div key={who} className="border-t border-[#111] pt-1.5">
            {who}
          </div>
        ))}
      </div>
    </div>
  )
}

/// The sender printed at the top of both papers: this warehouse, as the
/// register names it. A caller may name the site; otherwise it is the node's
/// own, which is the warehouse the papers are printed in. Falls back to a
/// plain "Gudang" rather than an id.
function useFrom(): (siteId: string | null | undefined) => string {
  const site = useSiteLabel()
  const node = useEdgeNodeIdentity().data?.site_id ?? null
  return (siteId) => {
    const id = siteId ?? node
    return id ? site(id) : "Gudang"
  }
}

/// Packing lists for one or more cartons, fetched and shown ready to print.
export function PackingListPrint({
  koliIds,
  open,
  onClose,
  siteId,
}: {
  koliIds: readonly string[]
  open: boolean
  onClose: () => void
  /// This warehouse's site, for the sender line. Optional.
  siteId?: string | null
}) {
  const from = useFrom()(siteId)
  const manifests = useQueries({
    queries: koliIds.map((id) => ({
      queryKey: keys.manifest(id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        dc.koliManifest(id, signal),
      enabled: open,
    })),
  })
  const ready = manifests.every((one) => one.data !== undefined)
  return (
    <PaperOverlay
      open={open}
      onClose={onClose}
      size="A5"
      ready={ready}
      title="Packing list"
      note={`A5 · goes inside the koli${koliIds.length > 1 ? ` · ${koliIds.length} pages` : ""}`}
    >
      {manifests.map((one, index) =>
        one.data ? (
          <PackingListPaper
            key={koliIds[index]}
            manifest={one.data}
            from={from}
          />
        ) : (
          <div key={koliIds[index]} className="text-[0.875rem] text-canvas">
            Reading the koli…
          </div>
        )
      )}
    </PaperOverlay>
  )
}

/// Surat jalan for one or more shipments. The trip note comes from the
/// caller when it has just decided it (Dispatch, right after making the
/// trip), or is read from the shipment's own dispatch when it has one;
/// otherwise the paper leaves a line to write on.
export function SuratJalanPrint({
  shipmentIds,
  open,
  onClose,
  tripNote,
  siteId,
}: {
  shipmentIds: readonly string[]
  open: boolean
  onClose: () => void
  /// `undefined` (the ordinary case, reopening a past trip): read from the
  /// shipment's own dispatch. `null` or a string: what Dispatch just decided,
  /// used as-is without a second fetch.
  tripNote?: string | null
  siteId?: string | null
}) {
  const from = useFrom()(siteId)
  const details = useQueries({
    queries: shipmentIds.map((id) => ({
      queryKey: keys.shipment(id),
      queryFn: ({ signal }: { signal: AbortSignal }) => dc.shipment(id, signal),
      enabled: open,
    })),
  })
  const dispatchIds = [
    ...new Set(
      details
        .map((one) => one.data?.shipment.dispatch_id ?? null)
        .filter((id): id is string => id !== null)
    ),
  ]
  const dispatches = useQueries({
    queries: dispatchIds.map((id) => ({
      queryKey: keys.dispatch(id),
      queryFn: ({ signal }: { signal: AbortSignal }) => dc.dispatch(id, signal),
      enabled: open && tripNote === undefined,
    })),
  })
  const tripNoteOf = (dispatchId: string | null): string | null =>
    dispatches.find((one) => one.data?.dispatch.dispatch_id === dispatchId)
      ?.data?.dispatch.trip_note ?? null
  const ready = details.every((one) => one.data !== undefined)
  return (
    <PaperOverlay
      open={open}
      onClose={onClose}
      size="A4"
      ready={ready}
      title="Delivery note"
      note={`A4 · one per shop${shipmentIds.length > 1 ? ` · ${shipmentIds.length} pages` : ""}`}
    >
      {details.map((one, index) => {
        if (!one.data)
          return (
            <div
              key={shipmentIds[index]}
              className="text-[0.875rem] text-canvas"
            >
              Reading the shipment…
            </div>
          )
        return (
          <SuratJalanPaper
            key={shipmentIds[index]}
            detail={one.data}
            from={from}
            tripNote={
              tripNote !== undefined
                ? tripNote
                : tripNoteOf(one.data.shipment.dispatch_id)
            }
          />
        )
      })}
    </PaperOverlay>
  )
}

/// One trip's surat jalan: A4, one document for the whole truck. Letterhead,
/// the trip's number and note, then each shop's cartons with a subtotal, and
/// the grand total. Each shop keeps its own QR, which opens its own cartons
/// at receiving.
export function TripSuratJalanPaper({
  number,
  details,
  from,
  tripNote,
}: {
  number: string
  details: readonly ShipmentDetail[]
  from: string
  tripNote: string | null
}) {
  const shop = useShopName()
  const noteText = tripNote?.trim() ?? ""
  const stores = [...details].sort((left, right) =>
    shop(left.shipment.destination_store_id).localeCompare(
      shop(right.shipment.destination_store_id)
    )
  )
  const piecesOf = (detail: ShipmentDetail) =>
    detail.koli.reduce((sum, manifest) => sum + manifest.koli.unit_count, 0)
  const totalKoli = stores.reduce((sum, one) => sum + one.koli.length, 0)
  const totalPieces = stores.reduce((sum, one) => sum + piecesOf(one), 0)
  return (
    <div className={`${PAPER} min-h-[297mm] w-[210mm] px-[13mm] py-[12mm]`}>
      <div className="mb-3.5 flex items-start justify-between gap-4 border-b-2 border-[#111] pb-3.5">
        <div>
          <div className="text-[16px] font-bold tracking-[0.04em] uppercase">
            {COMPANY.name}
          </div>
          <div>{COMPANY.address}</div>
          {COMPANY.phone !== "" && <div>{COMPANY.phone}</div>}
        </div>
        <div className="text-right">
          <div className="text-[24px] leading-[28px] font-bold tracking-[0.02em]">
            SURAT JALAN
          </div>
          <div className="mt-1 font-mono font-semibold">{number}</div>
        </div>
      </div>
      <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1">
        <dt className="text-[#555]">Dari</dt>
        <dd className="font-semibold">{from}</dd>
        <dt className="text-[#555]">Kepada</dt>
        <dd>{count(stores.length)} toko</dd>
        <dt className="text-[#555]">Tanggal</dt>
        <dd>{today()}</dd>
      </dl>
      <div className="mb-5">
        <div className="text-[#555]">Data perjalanan</div>
        {noteText === "" ? (
          <div className="mt-1 min-h-[19px] w-full border-b border-dotted border-[#777]">
            &nbsp;
          </div>
        ) : (
          <div className="mt-1 border-b border-dotted border-[#777] pb-1 whitespace-pre-wrap">
            {noteText}
          </div>
        )}
      </div>
      {stores.map((detail) => (
        <TripStoreSection
          key={detail.shipment.shipment_id}
          detail={detail}
          name={shop(detail.shipment.destination_store_id)}
          pieces={piecesOf(detail)}
        />
      ))}
      <div className="flex justify-between border-y-2 border-[#111] px-1.5 py-2 font-bold">
        <span>
          Total {count(stores.length)} toko · {count(totalKoli)} koli
        </span>
        <span>{quantity(totalPieces)}</span>
      </div>
      <p className="mt-4 text-[#444]">
        Rincian isi setiap koli ada pada packing list di dalam koli. Mohon
        periksa jumlah koli dan kondisi segel saat menerima.
      </p>
      <div className="mt-24 grid grid-cols-3 gap-5 text-center">
        {["Dibuat oleh", "Pengemudi", "Diterima oleh"].map((who) => (
          <div key={who} className="border-t border-[#111] pt-1.5">
            {who}
          </div>
        ))}
      </div>
    </div>
  )
}

/// One shop's block on a trip's surat jalan: its name and QR, its cartons,
/// its subtotal.
function TripStoreSection({
  detail,
  name,
  pieces,
}: {
  detail: ShipmentDetail
  name: string
  pieces: number
}) {
  return (
    <section className="mb-5 break-inside-avoid">
      <div className="flex items-end justify-between gap-4 pb-1.5">
        <div>
          <div className="text-[16px] font-bold">{name}</div>
          <div className="font-mono text-[#555]">
            {detail.shipment.shipment_number}
          </div>
        </div>
        <Qr svg={detail.qr_svg} size="size-[18mm]" />
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b-[1.5px] border-[#111] text-left">
            <th className="w-11 px-1.5 py-1.5 font-semibold">No</th>
            <th className="px-1.5 py-1.5 font-semibold">
              No. koli / packing list
            </th>
            <th className="px-1.5 py-1.5 text-right font-semibold">Jumlah</th>
          </tr>
        </thead>
        <tbody>
          {detail.koli.map((manifest, index) => (
            <tr key={manifest.koli.koli_id} className="border-b border-[#ccc]">
              <td className="px-1.5 py-1.5">{index + 1}</td>
              <td className="px-1.5 py-1.5 font-mono">
                {manifest.koli.koli_number}
              </td>
              <td className="px-1.5 py-1.5 text-right">
                {quantity(manifest.koli.unit_count)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td className="px-1.5 py-1.5" />
            <td className="px-1.5 py-1.5">
              Subtotal {count(detail.koli.length)} koli
            </td>
            <td className="px-1.5 py-1.5 text-right">{quantity(pieces)}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  )
}

/// A trip's single surat jalan, by its dispatch id: the trip read back, then
/// every shop's shipment on it, printed as one document.
export function TripSuratJalanPrint({
  dispatchId,
  open,
  onClose,
  siteId,
}: {
  dispatchId: string
  open: boolean
  onClose: () => void
  siteId?: string | null
}) {
  const from = useFrom()(siteId)
  const trip = useQuery({
    queryKey: keys.dispatch(dispatchId),
    queryFn: ({ signal }) => dc.dispatch(dispatchId, signal),
    enabled: open,
  })
  const shipments = trip.data?.shipments ?? []
  const details = useQueries({
    queries: shipments.map((one) => ({
      queryKey: keys.shipment(one.shipment_id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        dc.shipment(one.shipment_id, signal),
      enabled: open,
    })),
  })
  const loaded = details
    .map((one) => one.data)
    .filter((one): one is ShipmentDetail => one !== undefined)
  const ready = trip.data !== undefined && loaded.length === shipments.length
  return (
    <PaperOverlay
      open={open}
      onClose={onClose}
      size="A4"
      ready={ready}
      title="Delivery note"
      note={`A4 · one per trip${shipments.length > 1 ? ` · ${shipments.length} stores` : ""}`}
    >
      {ready ? (
        <TripSuratJalanPaper
          number={tripDocumentNumber(trip.data?.dispatch, shipments)}
          details={loaded}
          from={from}
          tripNote={trip.data?.dispatch.trip_note ?? null}
        />
      ) : (
        <div className="text-[0.875rem] text-canvas">
          {trip.isError ? "Could not read the trip." : "Reading the trip…"}
        </div>
      )}
    </PaperOverlay>
  )
}

/// One picklist on paper: A5, in Indonesian, taken to the racks. Grouped the
/// way the sheet is — article, then colourway, then sizes — with Diambil left
/// blank for the pen. No pictures: the placeholders stay on screen.
export function PicklistPaper({
  allotmentNumber,
  destinationId,
  lines,
  supplier,
  from,
}: {
  allotmentNumber: string
  destinationId: string
  lines: readonly { readonly sku_code: string; readonly outstanding: number }[]
  supplier: string | null
  from: string
}) {
  const identity = useCatalogueIdentity()
  const shop = useShopName()
  const total = lines.reduce((sum, line) => sum + line.outstanding, 0)
  const articles = new Map<string, Map<string, typeof lines>>()
  for (const line of lines) {
    if (line.outstanding <= 0) continue
    const one = identity.get(line.sku_code)
    const article = one?.article_code ?? line.sku_code
    const colour = one?.colour ?? "—"
    const byColour = articles.get(article) ?? new Map<string, typeof lines>()
    byColour.set(colour, [...(byColour.get(colour) ?? []), line])
    articles.set(article, byColour)
  }
  const named = [...articles.keys()].map((code) => {
    const first = [...articles.get(code)!.values()][0]![0]!
    const one = identity.get(first.sku_code)
    return {
      code,
      name: one?.article_name ?? code,
      division: one?.division_code ?? null,
    }
  })
  let no = 0
  return (
    <div className={`${PAPER} min-h-[210mm] w-[148mm] p-[9mm]`}>
      <div className="mb-3 flex items-start justify-between gap-4 border-b-2 border-[#111] pb-3">
        <div>
          <div className="text-[24px] leading-[28px] font-bold tracking-[0.02em]">
            PICKLIST
          </div>
          <div className="mt-1">{from}</div>
        </div>
        <div className="font-mono text-[14px]">{allotmentNumber}</div>
      </div>
      <dl className="mb-3.5 grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-[3px]">
        <dt className="text-[#555]">Toko</dt>
        <dd className="font-semibold">{shop(destinationId)}</dd>
        <dt className="text-[#555]">Artikel</dt>
        <dd>
          {named.map((one) => (
            <div key={one.code}>
              {one.name} ·{" "}
              <span className="font-mono text-[14px]">{one.code}</span>
              {one.division && <> · {divisionName(one.division)}</>}
            </div>
          ))}
        </dd>
        {supplier && (
          <>
            <dt className="text-[#555]">Supplier</dt>
            <dd>{supplier}</dd>
          </>
        )}
        <dt className="text-[#555]">Dicetak</dt>
        <dd>
          {today()}, {clock(new Date().toISOString())}
        </dd>
      </dl>
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left">
            <th className="border-b-[1.5px] border-[#111] p-1.5 font-semibold">
              No
            </th>
            <th className="border-b-[1.5px] border-[#111] p-1.5 font-semibold">
              Ukuran
            </th>
            <th className="border-b-[1.5px] border-[#111] p-1.5 font-semibold">
              SKU
            </th>
            <th className="border-b-[1.5px] border-[#111] p-1.5 text-right font-semibold">
              Diminta
            </th>
            <th className="border-b-[1.5px] border-[#111] p-1.5 text-right font-semibold">
              Diambil
            </th>
          </tr>
        </thead>
        <tbody>
          {[...articles].flatMap(([code, byColour]) =>
            [...byColour].flatMap(([colour, list]) => [
              <tr key={`${code}-${colour}`}>
                <td
                  colSpan={5}
                  className="border-b border-[#ccc] p-1.5 pt-3 font-semibold"
                >
                  {articles.size > 1
                    ? `${named.find((one) => one.code === code)?.name ?? code} · ${colour}`
                    : colour}
                </td>
              </tr>,
              ...list.map((line) => (
                <tr key={line.sku_code}>
                  <td className="border-b border-[#ccc] p-1.5">{++no}</td>
                  <td className="border-b border-[#ccc] p-1.5">
                    {identity.get(line.sku_code)?.size ?? "—"}
                  </td>
                  <td className="border-b border-[#ccc] p-1.5 font-mono text-[14px]">
                    {line.sku_code}
                  </td>
                  <td className="border-b border-[#ccc] p-1.5 text-right">
                    {count(line.outstanding)}
                  </td>
                  <td className="w-[22mm] border border-[#111]" />
                </tr>
              )),
            ])
          )}
        </tbody>
        <tfoot>
          <tr className="font-bold">
            <td colSpan={3} className="border-t-[1.5px] border-[#111] p-1.5">
              Total
            </td>
            <td className="border-t-[1.5px] border-[#111] p-1.5 text-right">
              {count(total)}
            </td>
            <td className="border-[1.5px] border-[#111]" />
          </tr>
        </tfoot>
      </table>
      <div className="mt-3.5 min-h-[16mm] border border-[#ccc] p-1.5 text-[#555]">
        Catatan
      </div>
      <div className="mt-[14mm] grid grid-cols-2 gap-[14mm] text-[#555]">
        <div>
          <div className="mb-1 h-[12mm] border-b border-[#111]" />
          Diambil oleh · jam
        </div>
        <div>
          <div className="mb-1 h-[12mm] border-b border-[#111]" />
          Diterima packer · jam
        </div>
      </div>
    </div>
  )
}

/// The picklist paper, ready to print over the Pick sheet.
export function PicklistPrint({
  open,
  onClose,
  allotmentNumber,
  destinationId,
  lines,
  supplier,
}: {
  open: boolean
  onClose: () => void
  allotmentNumber: string
  destinationId: string
  lines: readonly { readonly sku_code: string; readonly outstanding: number }[]
  supplier: string | null
}) {
  const from = useFrom()(null)
  const shop = useShopName()
  return (
    <PaperOverlay
      open={open}
      onClose={onClose}
      size="A5"
      ready
      title="Picklist"
      note={`A5 · ${shop(destinationId)} · ${allotmentNumber}`}
    >
      <PicklistPaper
        allotmentNumber={allotmentNumber}
        destinationId={destinationId}
        lines={lines}
        supplier={supplier}
        from={from}
      />
    </PaperOverlay>
  )
}
