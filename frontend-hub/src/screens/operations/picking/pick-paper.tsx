import { useQuery } from "@tanstack/react-query"
import { createPortal } from "react-dom"
import { useEffect } from "react"

import { useShopName } from "@/components/operations/outbound-papers"
import { Thumbnail } from "@/components/ui/thumbnail"
import { useColourwayFill } from "@/lib/colourway-fill"
import { dayTime, sku as skuNumber } from "@/lib/format"
import { divisionName, useCatalogueIdentity } from "@/lib/operations/catalogue"
import { poolsQuery } from "@/lib/operations/queries"
import type { ArticlePick } from "@/lib/operations/article-picks"
import { paperShape, type Paper } from "@/screens/procurement/po-print"

/// **The A5 pick paper: one page per article × store × allotment.**
///
/// Owner, 18 Oct 2026 (pack-sheet-options, Full flow): the Gudang prints what
/// it walks with. One paper is one pick card, the same unit as the Pick
/// sheet, so a paper is never shared between two stores. Picked and Short are
/// left blank: they are written by hand and typed in afterwards.
///
/// Printed the way the other outbound papers are: `@page` with the paper's
/// size, and a stylesheet that hides everything but these pages, so the page
/// on screen and the page on paper are the same DOM.
const PRINT_CSS = (size: "A4" | "A5", portrait: boolean) => `
@page { size: ${size} ${portrait ? "portrait" : "landscape"}; margin: 0; }
@media screen { .pickpaper-print { display: none !important; } }
@media print {
  body > *:not(.pickpaper-print) { display: none !important; }
  .pickpaper-print { position: static !important; background: none !important; overflow: visible !important; }
  .pickpaper-bar { display: none !important; }
  .pickpaper-pages { padding: 0 !important; gap: 0 !important; overflow: visible !important; }
  .pickpaper-page { box-shadow: none !important; margin: 0 !important; break-after: page; }
  .pickpaper-page:last-child { break-after: auto; }
}
`

/// The paper's own box, so the page on screen and the page on paper are the
/// same. Written out whole so Tailwind sees every class.
const PICK_BOX = {
  A5: {
    portrait: "min-h-[210mm] w-[148mm] p-[9mm]",
    landscape: "min-h-[148mm] w-[210mm] p-[9mm]",
  },
  A4: {
    portrait: "min-h-[297mm] w-[210mm] px-[13mm] py-[12mm]",
    landscape: "min-h-[210mm] w-[297mm] px-[13mm] py-[12mm]",
  },
} as const

/// The paper a picklist goes on until the picker chooses another in the print
/// sheet (`PrintMenu`): A5 standing up.
export const DEFAULT_PICK_PAPER: Paper = "A5-portrait"

/// Opened by `PrintMenu`'s onChoose with `choice.paper`. There is no PDF writer
/// for this paper yet, so `choice.pdf` lands here too, as the packing list's
/// does: the overlay's Print can save as PDF from the browser's dialog.
export function PrintPickPapers({
  picks,
  paper = DEFAULT_PICK_PAPER,
  onClose,
}: {
  picks: readonly ArticlePick[]
  paper?: Paper
  onClose: () => void
}) {
  const shape = paperShape(paper)
  const pools = useQuery(poolsQuery())
  const pool = (pools.data?.items ?? []).find(
    (one) => !one.is_rollup && one.group === "WAREHOUSE"
  )
  const stamp = dayTime(new Date().toISOString())

  // No second preview (owner, 20 Oct 2026): the paper was chosen in the
  // print sheet, so the browser's own print dialog opens straight away, as an
  // order's does. The pages are drawn off screen for it, and once the
  // warehouse is named and every picture has loaded, printed.
  const ready = !pools.isPending
  useEffect(() => {
    if (!ready || picks.length === 0) return
    let gone = false
    const done = () => {
      window.removeEventListener("afterprint", done)
      if (!gone) onClose()
    }
    void (async () => {
      const images = Array.from(
        document.querySelectorAll<HTMLImageElement>(".pickpaper-print img")
      )
      await Promise.all(
        images.map((image) =>
          image.complete
            ? null
            : new Promise((resolve) => {
                image.addEventListener("load", resolve, { once: true })
                image.addEventListener("error", resolve, { once: true })
              })
        )
      )
      await new Promise((resolve) => requestAnimationFrame(resolve))
      if (gone) return
      window.addEventListener("afterprint", done)
      window.print()
    })()
    return () => {
      gone = true
      window.removeEventListener("afterprint", done)
    }
  }, [ready, picks.length, onClose])

  if (picks.length === 0) return null
  return createPortal(
    <div
      aria-hidden
      className="pickpaper-print"
    >
      <style>{PRINT_CSS(shape.size, shape.portrait)}</style>
      <div className="pickpaper-pages flex flex-1 flex-col items-center gap-6 overflow-auto px-4 pt-7 pb-16">
        {picks.map((pick, index) => (
          <PickPaper
            key={`${pick.allotment_id}~${pick.destination_id}~${pick.article_code}`}
            pick={pick}
            index={index}
            of={picks.length}
            pool={pool?.label ?? null}
            stamp={stamp}
            paper={paper}
          />
        ))}
      </div>
    </div>,
    document.body
  )
}

function PickPaper({
  pick,
  index,
  of,
  pool,
  stamp,
  paper,
}: {
  pick: ArticlePick
  index: number
  of: number
  pool: string | null
  stamp: string
  paper: Paper
}) {
  const shape = paperShape(paper)
  const shop = useShopName()
  const catalogue = useCatalogueIdentity()
  const fill = useColourwayFill()
  const rows = pick.lines.filter((line) => line.outstanding > 0)
  const total = rows.reduce((sum, line) => sum + line.outstanding, 0)
  const first = catalogue.get(rows[0]?.sku_code ?? "")
  const cell = "border-b border-[#bbb] px-1.5 py-2"
  return (
    <div className={`pickpaper-page flex flex-col bg-white text-[14px] leading-[19px] text-[#111] shadow-[0_8px_30px_rgb(0_0_0/0.25)] ${PICK_BOX[shape.size][shape.portrait ? "portrait" : "landscape"]}`}>
      <div className="flex items-baseline justify-between gap-4 border-b-2 border-[#111] pb-2">
        <b className="text-[20px] leading-[24px] tracking-[0.02em]">Picklist</b>
        <span className="font-mono tabular-nums">
          {pick.allotment_number}
          {of > 1 && ` · ${index + 1}/${of}`}
        </span>
      </div>
      <div className="mt-3 text-[26px] leading-[30px] font-bold">
        {shop(pick.destination_id)}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Thumbnail
          url={first?.image_url ?? null}
          name={pick.article_name ?? ""}
          division={first?.division_code}
          colours={fill(first?.colour ?? null)}
          className="size-14 shrink-0 rounded-inner"
        />
        <div className="min-w-0">
          <div className="font-semibold">
            {pick.article_name ?? pick.article_code}
          </div>
          <div className="text-[#555]">
            <span className="font-mono">{pick.article_code}</span>
            {first?.division_code && <> · {divisionName(first.division_code)}</>}
          </div>
        </div>
      </div>
      <table className="mt-4 w-full border-collapse tabular-nums">
        <thead>
          <tr className="text-left">
            <th className="border-b-[1.5px] border-[#111] px-1.5 py-1.5 font-semibold">
              Colour · Size
            </th>
            <th className="w-[16mm] border-b-[1.5px] border-[#111] px-1.5 py-1.5 text-right font-semibold">
              Qty
            </th>
            <th className="w-[20mm] border-b-[1.5px] border-[#111] px-1.5 py-1.5 font-semibold">
              Picked
            </th>
            <th className="w-[20mm] border-b-[1.5px] border-[#111] px-1.5 py-1.5 font-semibold">
              Short
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((line) => {
            const one = catalogue.get(line.sku_code)
            return (
              <tr key={line.sku_code}>
                <td className={cell}>
                  {[one?.colour, one?.size].filter(Boolean).join(" · ") ||
                    skuNumber(line.sku_code)}
                  <div className="font-mono text-[11px] text-[#555]">
                    {skuNumber(line.sku_code)}
                  </div>
                </td>
                <td className={`${cell} text-right font-semibold`}>
                  {line.outstanding}
                </td>
                <td className={cell} />
                <td className={cell} />
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <td className="px-1.5 py-2 font-semibold">Total</td>
            <td className="px-1.5 py-2 text-right font-semibold">{total}</td>
            <td />
            <td />
          </tr>
        </tfoot>
      </table>
      <div className="flex-1" />
      <div className="mt-6 flex items-end justify-between gap-4 text-[12px] text-[#555]">
        <span>
          From {pool ?? "Gudang"} · {stamp}
        </span>
        <span>Picked by ______________</span>
      </div>
    </div>
  )
}
