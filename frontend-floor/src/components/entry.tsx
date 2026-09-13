import { useQuery } from "@tanstack/react-query"
import { Delete } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Pill } from "@/components/ui/pill"
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
/// half the screen, including the line being counted.
export function SkuEntry({
  placeholder,
  sku,
  onSku,
  lookup,
  onAdd,
  addLabel,
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
    if (sku === null || quantity <= 0) return
    onAdd(sku, quantity)
    onSku(null)
    setTyped("")
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <ScanField onScan={onScan} placeholder={placeholder} autoFocus={false} />

      {problem !== null && <Banner tone="bad">{problem}</Banner>}

      {sku !== null && (
        <Card className="px-3.5 pt-3.5 pb-4">
          <div className="flex items-start gap-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-ink">
                {name ??
                  (names.isPending
                    ? "…"
                    : "Tidak ada di katalog node ini")}
              </span>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="shrink-0 font-mono text-[0.65625rem] text-mute">
                  {sku}
                </span>
                {known?.note}
              </span>
            </span>
            <span className="text-total leading-none font-semibold text-ink tabular-nums">
              {typed === "" ? "1" : count(quantity)}
            </span>
          </div>

          {known?.problem != null && (
            <Banner tone="bad" className="mt-3">
              {known.problem}
            </Banner>
          )}

          <QuantityPad
            className="mt-3.5"
            onDigit={(digit) =>
              // Four digits is ten thousand pieces of one SKU in one round;
              // past that it is a fat thumb, not a warehouse.
              setTyped((current) =>
                (current + digit).replace(/^0+/, "").slice(0, 4),
              )
            }
            onBackspace={() => setTyped((current) => current.slice(0, -1))}
          />

          <div className="mt-3 flex gap-2.5">
            <Button
              variant="ghost"
              size="lg"
              onClick={() => {
                onSku(null)
                setTyped("")
              }}
            >
              Batal
            </Button>
            <Button
              variant="primary"
              size="lg"
              block
              // `Button` is `shrink-0` everywhere in this kit — a pill that squashes
              // stops being a pill. In a row with a second button that makes
              // `w-full` overflow the screen instead of sharing it, so this one
              // is allowed to give way.
              className="min-w-0 shrink"
              disabled={quantity <= 0 || known?.problem != null}
              onClick={commit}
            >
              {addLabel} {count(quantity)}
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}

/// The number pad, and it is not the till's.
///
/// That one has a `000` key because a cashier types rupiah; here `3` followed by
/// `000` is three thousand garments, which is a mis-key nobody would catch until
/// the racks came up short. Digits, a zero and a delete — nothing else.
function QuantityPad({
  onDigit,
  onBackspace,
  className,
}: {
  onDigit: (digit: string) => void
  onBackspace: () => void
  className?: string
}) {
  return (
    <div className={cn("grid grid-cols-3 gap-2", className)}>
      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((key) => (
        <Key key={key} onPress={() => onDigit(key)}>
          {key}
        </Key>
      ))}
      <span />
      <Key onPress={() => onDigit("0")}>0</Key>
      <Key onPress={onBackspace} aria-label="Hapus angka terakhir">
        <Delete className="size-5 text-line-ico" />
      </Key>
    </div>
  )
}

function Key({
  onPress,
  children,
  ...props
}: {
  onPress: () => void
  children: React.ReactNode
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onPress}
      className="pressable grid h-14 place-items-center rounded-inner bg-soft-2 text-[1.25rem] font-medium text-ink tabular-nums"
      {...props}
    >
      {children}
    </button>
  )
}

/// A pill for a SKU nobody asked for.
///
/// Drawn the same way at both stations and meaning different things, which is
/// why it is named for the fact rather than for the consequence: at picking it
/// is a note, at packing it is the reason the node will refuse the carton.
export function NotWanted({ tone = "warn" }: { tone?: "warn" | "bad" }) {
  return <Pill tone={tone}>tidak diminta toko</Pill>
}
