import { useQueries, useQuery } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { Button } from "@/components/ui/button"
import { dc } from "@/lib/api"
import { useEdgeNodeIdentity } from "@/lib/edge-session"
import { clock, count, dayIndonesian, quantity, sku as skuText } from "@/lib/format"
import { divisionName, useCatalogueIdentity } from "@/lib/operations/catalogue"
import { keys } from "@/lib/operations/keys"
import { tripDocumentNumber } from "@/lib/operations/trip-number"
import { useSiteLabel, useUnitLabel } from "@/lib/queries/organisation"
import { COMPANY } from "@/screens/finance-lab/print"
import { paperShape, type Paper } from "@/screens/procurement/po-print"
import { PrintMenu } from "@/screens/procurement/print-menu"
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

const PRINT_CSS = (size: "A4" | "A5", portrait: boolean) => `
@page { size: ${size} ${portrait ? "portrait" : "landscape"}; margin: 0; }
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
  portrait = true,
  ready,
  onClose,
  children,
}: {
  open: boolean
  title: string
  note: string
  size: "A4" | "A5"
  /// The way up on the sheet; the surat jalan and the picklist are portrait.
  portrait?: boolean
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
      <style>{PRINT_CSS(size, portrait)}</style>
      <div className="outbound-print-bar flex items-center gap-3 border-b border-hairline bg-canvas px-5 py-3">
        <span className="text-[0.9375rem] font-semibold text-ink">{title}</span>
        <span className="text-[0.9375rem] text-mute">{note}</span>
        <div className="flex-1" />
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button
          variant="primary"
          disabled={!ready}
          onClick={() => window.print()}
        >
          Print
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

/// The packing list's sheet, whichever paper it is printed on: the box is the
/// paper's own size, so the page on screen and the page on paper are the same.
/// Written out whole so Tailwind sees every class.
const PACKING_BOX = {
  A5: {
    portrait: "min-h-[210mm] w-[148mm] p-[9mm]",
    landscape: "min-h-[148mm] w-[210mm] p-[9mm]",
  },
  A4: {
    portrait: "min-h-[297mm] w-[210mm] px-[13mm] py-[12mm]",
    landscape: "min-h-[210mm] w-[297mm] px-[13mm] py-[12mm]",
  },
} as const

/// The surat jalan's sheet on whichever paper it is printed on. Written out
/// whole so Tailwind sees every class.
const SURAT_JALAN_BOX = {
  A5: {
    portrait: "min-h-[210mm] w-[148mm] p-[9mm]",
    landscape: "min-h-[148mm] w-[210mm] p-[9mm]",
  },
  A4: {
    portrait: "min-h-[297mm] w-[210mm] px-[13mm] py-[12mm]",
    landscape: "min-h-[210mm] w-[297mm] px-[13mm] py-[12mm]",
  },
} as const

/// A surat jalan goes on A4 standing up unless the sheet (`PrintMenu`, paper
/// key "surat-jalan") says otherwise.
export const DEFAULT_SURAT_JALAN_PAPER: Paper = "A4-portrait"

const suratJalanBox = (paper: Paper) => {
  const shape = paperShape(paper)
  return SURAT_JALAN_BOX[shape.size][shape.portrait ? "portrait" : "landscape"]
}

/// The packing list goes inside the koli on A5, standing up, unless the packer
/// chooses another paper in the print sheet (`PrintMenu`).
export const DEFAULT_PACKING_PAPER: Paper = "A5-portrait"

/// One carton's packing list: A5 unless told otherwise, inside the box. Qty
/// only — what went in is the whole story; what the shop was owed is the
/// allotment's business.
export function PackingListPaper({
  manifest,
  from,
  paper = DEFAULT_PACKING_PAPER,
}: {
  manifest: KoliManifest
  from: string
  /// The paper it is drawn on: `PrintMenu`'s `choice.paper`.
  paper?: Paper
}) {
  const shape = paperShape(paper)
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
    <div
      className={`${PAPER} ${PACKING_BOX[shape.size][shape.portrait ? "portrait" : "landscape"]}`}
    >
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
                <td className="px-1.5 py-1.5 font-mono">{skuText(sku)}</td>
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
  paper = DEFAULT_SURAT_JALAN_PAPER,
}: {
  detail: ShipmentDetail
  from: string
  tripNote: string | null
  paper?: Paper
}) {
  const shop = useShopName()
  const { shipment } = detail
  const pieces = detail.koli.reduce(
    (sum, manifest) => sum + manifest.koli.unit_count,
    0
  )
  const noteText = tripNote?.trim() ?? ""
  return (
    <div className={`${PAPER} ${suratJalanBox(paper)}`}>
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
      {noteText !== "" && (
        <div className="mb-5">
          <div className="text-[#555]">Data perjalanan</div>
          <div className="mt-1 border-b border-dotted border-[#777] pb-1 whitespace-pre-wrap">
            {noteText}
          </div>
        </div>
      )}
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
        periksa jumlah koli dan kondisi segel saat menerima; penerimaan
        dicatat di aplikasi toko.
      </p>
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
  paper = DEFAULT_PACKING_PAPER,
}: {
  koliIds: readonly string[]
  open: boolean
  onClose: () => void
  /// This warehouse's site, for the sender line. Optional.
  siteId?: string | null
  /// The paper to print on — `PrintMenu`'s `choice.paper`. Left out, it is A5
  /// standing up. Sets the `@page` size and the sheet drawn on screen.
  paper?: Paper
}) {
  const from = useFrom()(siteId)
  const shape = paperShape(paper)
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
      size={shape.size}
      portrait={shape.portrait}
      ready={ready}
      title="Packing list"
      note={`${shape.size} ${shape.portrait ? "portrait" : "landscape"} · goes inside the koli${koliIds.length > 1 ? ` · ${koliIds.length} pages` : ""}`}
    >
      {manifests.map((one, index) =>
        one.data ? (
          <PackingListPaper
            key={koliIds[index]}
            manifest={one.data}
            from={from}
            paper={paper}
          />
        ) : (
          <div key={koliIds[index]} className="text-[0.9375rem] text-canvas">
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
  paper = DEFAULT_SURAT_JALAN_PAPER,
}: {
  paper?: Paper
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
      size={paperShape(paper).size}
      portrait={paperShape(paper).portrait}
      ready={ready}
      title="Delivery note"
      note={`${paperShape(paper).size} ${paperShape(paper).portrait ? "portrait" : "landscape"} · one per shop${shipmentIds.length > 1 ? ` · ${shipmentIds.length} pages` : ""}`}
    >
      {details.map((one, index) => {
        if (!one.data)
          return (
            <div
              key={shipmentIds[index]}
              className="text-[0.9375rem] text-canvas"
            >
              Reading the shipment…
            </div>
          )
        return (
          <SuratJalanPaper
            key={shipmentIds[index]}
            detail={one.data}
            from={from}
            paper={paper}
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

/// One trip's surat jalan, printed once (owner, 23 Oct 2026: "both — page
/// per store and one for all"): the first page is the whole truck — every
/// store's surat jalan number, its koli and pieces, the grand total, signed by
/// the sender and the driver; then one page per store, which stays at that
/// store — its own QR (scanned at receiving), its koli with a subtotal, and
/// the sender, driver and receiver sign it.
export function TripSuratJalanPaper({
  number,
  details,
  from,
  tripNote,
  paper = DEFAULT_SURAT_JALAN_PAPER,
}: {
  number: string
  details: readonly ShipmentDetail[]
  from: string
  tripNote: string | null
  paper?: Paper
}) {
  const shop = useShopName()
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
    <>
      <div className={`${PAPER} ${suratJalanBox(paper)} flex flex-col`}>
        <TripLetterhead number={number} />
        <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1">
          <dt className="text-[#555]">Dari</dt>
          <dd className="font-semibold">{from}</dd>
          <dt className="text-[#555]">Kepada</dt>
          <dd>{count(stores.length)} toko</dd>
          <dt className="text-[#555]">Tanggal</dt>
          <dd>{today()}</dd>
        </dl>
        <TripNote text={tripNote} />
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b-[1.5px] border-[#111] text-left">
              <th className="w-11 px-1.5 py-1.5 font-semibold">No</th>
              <th className="px-1.5 py-1.5 font-semibold">Toko</th>
              <th className="px-1.5 py-1.5 font-semibold">No. surat jalan</th>
              <th className="px-1.5 py-1.5 text-right font-semibold">Koli</th>
              <th className="px-1.5 py-1.5 text-right font-semibold">Jumlah</th>
            </tr>
          </thead>
          <tbody>
            {stores.map((detail, index) => (
              <tr
                key={detail.shipment.shipment_id}
                className="border-b border-[#ccc]"
              >
                <td className="px-1.5 py-1.5">{index + 1}</td>
                <td className="px-1.5 py-1.5 font-semibold">
                  {shop(detail.shipment.destination_store_id)}
                </td>
                <td className="px-1.5 py-1.5 font-mono">
                  {detail.shipment.shipment_number}
                </td>
                <td className="px-1.5 py-1.5 text-right">
                  {count(detail.koli.length)}
                </td>
                <td className="px-1.5 py-1.5 text-right">
                  {quantity(piecesOf(detail))}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-[1.5px] border-[#111] font-bold">
              <td className="px-1.5 py-1.5" />
              <td className="px-1.5 py-1.5" colSpan={2}>
                Total {count(stores.length)} toko
              </td>
              <td className="px-1.5 py-1.5 text-right">{count(totalKoli)}</td>
              <td className="px-1.5 py-1.5 text-right">
                {quantity(totalPieces)}
              </td>
            </tr>
          </tfoot>
        </table>
        <p className="mt-4 text-[#444]">
          Surat jalan tiap toko ada di halaman berikutnya; serahkan satu
          halaman ke setiap toko.
        </p>
        <Signatures roles={["Pengirim", "Sopir"]} />
      </div>
      {stores.map((detail, index) => (
        <div
          key={detail.shipment.shipment_id}
          className={`${PAPER} ${suratJalanBox(paper)} flex flex-col`}
        >
          <TripLetterhead number={detail.shipment.shipment_number} />
          <div className="mb-5 flex items-start justify-between gap-6">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1">
              <dt className="text-[#555]">Dari</dt>
              <dd className="font-semibold">{from}</dd>
              <dt className="text-[#555]">Kepada</dt>
              <dd className="text-[16px] font-bold">
                {shop(detail.shipment.destination_store_id)}
              </dd>
              <dt className="text-[#555]">Tanggal</dt>
              <dd>{today()}</dd>
              <dt className="text-[#555]">Trip</dt>
              <dd>
                <span className="font-mono">{number}</span> · toko{" "}
                {index + 1} dari {stores.length}
              </dd>
            </dl>
            <Qr svg={detail.qr_svg} size="size-[29mm]" />
          </div>
          <TripNote text={tripNote} />
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b-[1.5px] border-[#111] text-left">
                <th className="w-11 px-1.5 py-1.5 font-semibold">No</th>
                <th className="px-1.5 py-1.5 font-semibold">
                  No. koli / packing list
                </th>
                <th className="px-1.5 py-1.5 text-right font-semibold">
                  Jumlah
                </th>
              </tr>
            </thead>
            <tbody>
              {detail.koli.map((manifest, row) => (
                <tr
                  key={manifest.koli.koli_id}
                  className="border-b border-[#ccc]"
                >
                  <td className="px-1.5 py-1.5">{row + 1}</td>
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
                <td className="px-1.5 py-1.5">
                  Subtotal {count(detail.koli.length)} koli
                </td>
                <td className="px-1.5 py-1.5 text-right">
                  {quantity(piecesOf(detail))}
                </td>
              </tr>
            </tfoot>
          </table>
          <p className="mt-4 text-[#444]">
            Rincian isi setiap koli ada pada packing list di dalam koli. Mohon
            periksa jumlah koli dan kondisi segel saat menerima; penerimaan
            dicatat di aplikasi toko.
          </p>
          <Signatures roles={["Pengirim", "Sopir", "Penerima"]} />
        </div>
      ))}
    </>
  )
}

/// The head of every page of a trip's surat jalan: the company, and the
/// number the page is filed under.
function TripLetterhead({ number }: { number: string }) {
  return (
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
  )
}

/// The trip's free-text note (plate, driver), when there is one.
function TripNote({ text }: { text: string | null }) {
  const note = text?.trim() ?? ""
  if (note === "") return null
  return (
    <div className="mb-5">
      <div className="text-[#555]">Data perjalanan</div>
      <div className="mt-1 border-b border-dotted border-[#777] pb-1 whitespace-pre-wrap">
        {note}
      </div>
    </div>
  )
}

/// Signature boxes at the foot of the page: name and date under each.
function Signatures({ roles }: { roles: readonly string[] }) {
  return (
    <div
      className="mt-auto grid gap-6 pt-10 break-inside-avoid"
      style={{ gridTemplateColumns: `repeat(${roles.length}, minmax(0, 1fr))` }}
    >
      {roles.map((role) => (
        <div key={role} className="text-center">
          <div className="font-semibold">{role}</div>
          <div className="mt-[22mm] border-b border-[#111]" />
          <div className="mt-1 text-left text-[#555]">Nama</div>
          <div className="mt-3 border-b border-dotted border-[#777]" />
          <div className="mt-1 text-left text-[#555]">Tanggal / jam</div>
        </div>
      ))}
    </div>
  )
}

/// A trip's single surat jalan, by its dispatch id: the trip read back, then
/// every shop's shipment on it, printed as one document.
export function TripSuratJalanPrint({
  dispatchId,
  open,
  onClose,
  siteId,
  paper = DEFAULT_SURAT_JALAN_PAPER,
}: {
  dispatchId: string
  open: boolean
  onClose: () => void
  siteId?: string | null
  /// `PrintMenu`'s `choice.paper`.
  paper?: Paper
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
      size={paperShape(paper).size}
      portrait={paperShape(paper).portrait}
      ready={ready}
      title="Delivery note"
      note={`${paperShape(paper).size} ${paperShape(paper).portrait ? "portrait" : "landscape"} · trip summary + ${shipments.length === 1 ? "1 store page" : `${shipments.length} store pages`}`}
    >
      {ready ? (
        <TripSuratJalanPaper
          number={tripDocumentNumber(trip.data?.dispatch, shipments)}
          details={loaded}
          from={from}
          tripNote={trip.data?.dispatch.trip_note ?? null}
          paper={paper}
        />
      ) : (
        <div className="text-[0.9375rem] text-canvas">
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
                    ? `${named.find((one) => one.code === code)?.name ?? code} · ${skuText(code)} · ${colour}`
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
                    {skuText(line.sku_code)}
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

/// What a surat jalan press prints: a trip as one document, or — for a
/// shipment on no trip yet (a legacy run) — its own page.
export type SuratJalanTarget =
  | { readonly dispatchId: string }
  | { readonly shipmentIds: readonly string[] }

/// Every surat jalan print goes through the same preview sheet as an order
/// (`PrintMenu`, paper key "surat-jalan"), then the paper over the screen.
/// Mounted when something asks for a print: the sheet opens at once, and the
/// paper follows the choice. Closing the sheet without choosing closes it all.
export function SuratJalanPrintFlow({
  target,
  onClose,
  siteId,
  paper: chosenPaper,
}: {
  target: SuratJalanTarget
  onClose: () => void
  siteId?: string | null
  /// Already chosen (Dispatch & print): straight to the paper, no sheet.
  paper?: Paper
}) {
  const [paper, setPaper] = useState<Paper | null>(chosenPaper ?? null)
  const chosen = useRef(false)
  return (
    <>
      <PrintMenu
        hideTrigger
        open={paper === null}
        label="Print surat jalan"
        paperKey="surat-jalan"
        defaultPaper={DEFAULT_SURAT_JALAN_PAPER}
        onChoose={(choice) => {
          chosen.current = true
          setPaper(choice.paper)
        }}
        onOpenChange={(next) => {
          if (!next && !chosen.current) onClose()
        }}
      />
      {paper !== null &&
        ("dispatchId" in target ? (
          <TripSuratJalanPrint
            dispatchId={target.dispatchId}
            open
            onClose={onClose}
            siteId={siteId}
            paper={paper}
          />
        ) : (
          <SuratJalanPrint
            shipmentIds={target.shipmentIds}
            open
            onClose={onClose}
            siteId={siteId}
            paper={paper}
          />
        ))}
    </>
  )
}
