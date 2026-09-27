import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { CountPad } from "@/components/ui/count-pad"
import { Pill } from "@/components/ui/pill"
import { BottomSheet } from "@/components/ui/picker-sheet"
import { ScanField } from "@/components/ui/scan-field"
import { Banner } from "@/components/ui/states"
import { readScan } from "@/lib/epc"
import { count } from "@/lib/format"
import { reads } from "@/lib/queries"
import { cn } from "@/lib/utils"

/// What a station makes of a SKU somebody has just named, and of the number
/// they have typed against it.
///
/// The **name** is not in here: that is a fact about the catalogue rather than
/// about the station, and this component asks the node for it itself. What a
/// station knows is what the number means here and whether it will work.
export interface Known {
  /// The pill under the code: "diminta 12", "berdiri di area kemas 3".
  readonly note?: React.ReactNode
  /// Why what is typed will not work — the packer asking for more than is
  /// standing in the picking area, a shop with no allotment for this SKU at all.
  /// Setting it also disables the button: the node would refuse this, and at
  /// packing that refusal would surface an hour later out of the outbox.
  readonly problem?: string | null
}

/// **Name a SKU, then type how many.**
///
/// This is the shape of the work, and it took a correction to get right. The
/// first version of this app handed the picker a list and let them tick it off,
/// which is not what the node does and not what the floor does:
/// `edge/sqlite.rs::pick_stock` says it outright — *"No allotment is consulted
/// here. Picking fetches a SKU and a number."* Somebody walks to a rack, takes
/// what is there, and says what they took. The list of what shops are owed is
/// **reference**, not a work order, and a SKU nobody asked for is still a SKU
/// that can be picked.
///
/// So the entry is two steps and no list: a code (scanned off a hang tag, read
/// off a carton, or typed), and a number on a keypad big enough to hit with a
/// thumb. The phone keyboard is deliberately not used for the number — it covers
/// half the screen, including the line being counted — and the pad comes up in
/// a sheet (`CountPad` in a `BottomSheet`), the same one on every station.
export function SkuEntry({
  placeholder,
  sku,
  onSku,
  lookup,
  onAdd,
  addLabel,
  autoFocus = false,
  className,
}: {
  placeholder: string
  /// The SKU being entered, held by the screen rather than in here: the list of
  /// what shops are owed sits below this card, and tapping a line there has to
  /// be able to put that SKU in the box.
  sku: string | null
  onSku: (sku: string | null) => void
  /// What this station makes of the code and the number. A station that has
  /// never heard of the SKU still gets asked — picking allows any SKU the racks
  /// hold, and the racks are not something this app has a list of.
  lookup: (sku: string, quantity: number) => Known
  onAdd: (sku: string, quantity: number) => void
  addLabel: string
  /// Put the caret in the scan box on arrival, for a handheld whose scanner
  /// types wherever the caret is. Safe on a phone too: the box raises no
  /// keyboard until it is tapped (see `ScanField`).
  autoFocus?: boolean
  className?: string
}) {
  const [typed, setTyped] = useState("")
  const [problem, setProblem] = useState<string | null>(null)

  // Asked for one SKU at a time, and only while the card is open. The station's
  // own lists carry their names already; this is for the code that was just
  // scanned off a garment nobody was expecting.
  const names = useQuery(reads.names(sku === null ? [] : [sku]))

  // An empty keypad means one. A picker holding a single garment should not have
  // to press 1 before pressing Add, and a number that was typed is never
  // overridden by this.
  const quantity = typed === "" ? 1 : Number(typed)
  const known = sku === null ? null : lookup(sku, quantity)
  const name = sku === null ? null : (names.data?.get(sku)?.name ?? null)

  const onScan = (raw: string) => {
    const read = readScan(raw)
    if (read.kind === "unknown") {
      setProblem(
        `Kode "${read.raw}" tidak dikenali sebagai tag maupun barcode barang.`,
      )
      return
    }
    setProblem(null)
    onSku(read.sku_code)
    setTyped("")
  }

  const commit = () => {
    // The same test as the button's `disabled`: Enter on a desk's keyboard
    // reaches here too, and must not add what the button would refuse.
    if (sku === null || quantity <= 0 || known?.problem != null) return
    onAdd(sku, quantity)
    onSku(null)
    setTyped("")
  }

  const close = () => {
    onSku(null)
    setTyped("")
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <ScanField
        onScan={onScan}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />

      {problem !== null && <Banner tone="bad">{problem}</Banner>}

      {/* The number is asked for in a sheet over the station, not in a card
          pushed into the middle of it: the list below stays where it was, the
          pad lands under the thumb at the same height every time, and a swipe
          down is "never mind". */}
      <BottomSheet
        open={sku !== null}
        onOpenChange={(open) => {
          if (!open) close()
        }}
        title={
          name ??
          (sku === null
            ? ""
            : names.isPending
              ? "…"
              : "Tidak ada di katalog node ini")
        }
      >
        <div className="flex flex-col gap-3 px-4 pb-4">
          <span className="-mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="shrink-0 font-mono text-[0.6875rem] text-mute">
              {sku}
            </span>
            {known?.note}
          </span>

          {known?.problem != null && (
            <Banner tone="bad">{known.problem}</Banner>
          )}

          <CountPad
            label={`Jumlah untuk ${sku ?? ""}`}
            value={typed}
            onChange={setTyped}
            onEnter={commit}
            // Empty means one — see `quantity` above — so the empty pad says 1.
            placeholder="1"
            unit="potong"
            maxDigits={4}
          />

          <Button
            variant="primary"
            size="lg"
            block
            disabled={quantity <= 0 || known?.problem != null}
            onClick={commit}
          >
            {addLabel} {count(quantity)}
          </Button>
        </div>
      </BottomSheet>
    </div>
  )
}

export function NotWanted({ tone = "warn" }: { tone?: "warn" | "bad" }) {
  return <Pill tone={tone}>tidak diminta toko</Pill>
}
