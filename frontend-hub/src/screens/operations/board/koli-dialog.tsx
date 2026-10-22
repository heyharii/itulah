import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import {
  DEFAULT_PACKING_PAPER,
  PackingListPrint,
} from "@/components/operations/outbound-papers"
import { Button } from "@/components/ui/button"
import { Sheet } from "@/components/ui/sheet"
import { ZoomPhoto } from "@/components/ui/photo-viewer"
import { Thumbnail } from "@/components/ui/thumbnail"
import { useColourwayFill } from "@/lib/colourway-fill"
import { count, time, sku as skuNumber } from "@/lib/format"
import { useCatalogueIdentity } from "@/lib/operations/catalogue"
import { koliManifestQuery } from "@/lib/operations/queries"
import { koliEpcs, rfidKeys } from "@/lib/operations/rfid"
import type { Paper } from "@/screens/procurement/po-print"
import { PrintMenu } from "@/screens/procurement/print-menu"
import { bare } from "@/screens/operations/board/words"

/// The koli a dialog is about: what a Packed card line or a trip's chip knows.
export interface KoliRef {
  readonly id: string
  /// "Koli 2": its number within its store.
  readonly label: string
  /// The printed code, KOLI-0012.
  readonly code: string
  /// The store's name.
  readonly store: string
  readonly sealedAt: string | null
  readonly pieces: number
}

/// **What is in this koli**, a dialog over the board (owner, 18 Oct 2026,
/// pack-sheet-options): "Koli 2 · 12", "C001 · Packed 10:45 · 30 pcs", a row
/// per SKU (its picture, which opens large; "article · colour · size", its
/// code, the quantity), then Print packing list and a solid Close. Never inside an empty sheet: it stands on
/// whatever is behind it, the board or a trip.
export function KoliDialog({
  koli,
  onClose,
}: {
  koli: KoliRef | null
  onClose: () => void
}) {
  // Kept while it closes, so the sheet does not empty as it slides out.
  const [shown, setShown] = useState<KoliRef | null>(null)
  if (koli !== null && shown?.id !== koli.id) setShown(koli)
  const [printing, setPrinting] = useState<string | null>(null)
  /// The paper the packing list goes on: A5 portrait until the packer picks
  /// another in the print sheet.
  const [paper, setPaper] = useState<Paper>(DEFAULT_PACKING_PAPER)
  const one = koli ?? shown

  // A sheet like the trip's (owner, 20 Oct 2026: "biar setara designnya"):
  // the koli in the title, its contents, Print at the left of the foot and
  // Close at the right.
  return (
    <>
      <Sheet
        open={koli !== null}
        onOpenChange={(next) => !next && onClose()}
        context={one === null ? false : `Koli · ${one.store}`}
        title={
          one === null ? "Koli" : `${one.label} · ${bare(one.code)}`
        }
        size="wide"
        footer={
          <div className="flex items-center justify-between gap-3">
            <div>
              <PrintMenu
                label="Print packing list"
                defaultPaper={DEFAULT_PACKING_PAPER}
                paperKey="packing"
                onChoose={(choice) => {
                  if (one === null) return
                  setPaper(choice.paper)
                  setPrinting(one.id)
                }}
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
        {one !== null && <KoliBody one={one} />}
      </Sheet>
      {printing !== null && (
        <PackingListPrint
          koliIds={[printing]}
          paper={paper}
          open
          onClose={() => setPrinting(null)}
        />
      )}
    </>
  )
}

function KoliBody({ one }: { one: KoliRef }) {
  const catalogue = useCatalogueIdentity()
  const fill = useColourwayFill()
  const manifest = useQuery(koliManifestQuery(one.id))
  const lines = manifest.data?.lines ?? []
  /// Every tag in the koli, and what the last RFID check read (owner, 21 Oct
  /// 2026: "list EPC nya, dalam bentuk table").
  const tags = useQuery({
    queryKey: rfidKeys.epcs(one.id),
    queryFn: ({ signal }) => koliEpcs(one.id, signal),
  })
  return (
    <>
      <p className="mb-1.5 text-body tabular-nums">
        {one.sealedAt !== null && <>Packed {time(one.sealedAt)} · </>}
        {count(one.pieces)} {one.pieces === 1 ? "pc" : "pcs"}
      </p>
      <div>
        {manifest.isPending ? (
          <p className="py-4 text-body">Reading the koli…</p>
        ) : manifest.isError ? (
          <p className="py-4 text-bad-fg">
            Could not read what is in this koli.
          </p>
        ) : (
          <ul className="flex flex-col">
            {lines.map((line, index) => {
              const identity = catalogue.get(line.sku_code)
              const name = [
                identity?.article_name,
                identity?.colour,
                identity?.size,
              ]
                .filter(Boolean)
                .join(" · ")
              const colours = fill(identity?.colour ?? null)
              return (
                <li
                  key={`${line.sku_code}~${line.allotment_line_id}~${index}`}
                  className="border-row-line flex min-h-[3.75rem] items-center gap-3 border-t first:border-t-0"
                >
                  <ZoomPhoto
                    url={identity?.image_url ?? null}
                    name={name || line.sku_code}
                    className="rounded-[9px]"
                    placeholder={
                      <Thumbnail
                        url={null}
                        name={identity?.article_name ?? ""}
                        division={identity?.division_code}
                        colours={colours}
                        className="size-72 rounded-card"
                      />
                    }
                  >
                    <Thumbnail
                      url={identity?.image_url ?? null}
                      name={identity?.article_name ?? ""}
                      division={identity?.division_code}
                      colours={colours}
                      className="size-11 rounded-[9px]"
                    />
                  </ZoomPhoto>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-ink">
                      {name || skuNumber(line.sku_code)}
                    </span>
                    <span className="block text-body tabular-nums">
                      {skuNumber(line.sku_code)}
                    </span>
                  </span>
                  <span className="min-w-10 shrink-0 text-right text-[1.0625rem] font-semibold text-ink tabular-nums">
                    {count(line.quantity)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {(tags.data?.epcs.length ?? 0) > 0 && (
        <div className="mt-6">
          <div className="mb-2 flex items-baseline gap-2">
            <span className="font-semibold text-ink">EPC</span>
            <span className="text-mute tabular-nums">
              {count(tags.data!.epcs.length)}
            </span>
            {tags.data?.check && (
              <span
                className={
                  tags.data.check.verified_at !== null
                    ? "ml-auto font-semibold text-ok-fg"
                    : "ml-auto font-semibold text-warn-fg"
                }
              >
                {tags.data.check.verified_at !== null
                  ? `✓ RFID verified ${time(tags.data.check.verified_at)}`
                  : `${count(tags.data.check.missing)} not read`}
              </span>
            )}
          </div>
          <div className="overflow-hidden rounded-card border border-hairline">
            <table className="w-full border-collapse text-body">
              <thead>
                <tr className="bg-soft text-left text-mute">
                  <th className="h-10 w-14 px-3 font-medium">No.</th>
                  <th className="h-10 px-3 font-medium">EPC</th>
                  <th className="h-10 px-3 font-medium">SKU</th>
                  <th className="h-10 px-3 font-medium">RFID</th>
                </tr>
              </thead>
              <tbody>
                {tags.data!.epcs.map((tag, index) => (
                  <tr key={tag.epc} className="border-t border-hairline">
                    <td className="px-3 py-2 text-mute tabular-nums">
                      {index + 1}
                    </td>
                    <td className="px-3 py-2 font-mono break-all text-ink">
                      {tag.epc}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                      {skuNumber(tag.sku_code)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {tag.read === null ? (
                        <span className="text-mute">—</span>
                      ) : tag.read ? (
                        <span className="text-ok-fg">Read</span>
                      ) : (
                        <span className="text-bad-fg">Not read</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}
