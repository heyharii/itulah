import { useEffect, useRef, useState } from "react"

import { NumberPad } from "@/components/ui/number-pad"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { count, label, positionTone } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { useCatalogueIdentity } from "@/lib/operations/catalogue"
import { cn } from "@/lib/utils"

/// The lines of an outbound document — a picklist, a carton — named.
///
/// The node answers in SKU codes, and a SKU code is not a garment anybody
/// recognises: "00000003203" is read off a rack ticket, "Kaos Basic · Hitam ·
/// M" is what is actually in the carton. So the article leads and the code
/// follows it on a quiet line. The catalogue is read once here rather than per
/// row; a SKU the centre has not described yet still shows, as its code.
export function SkuLines({
  lines,
  quantityLabel,
}: {
  lines: readonly { readonly sku_code: string; readonly quantity: number }[]
  /// What the number is at this station — "Picked", "Pieces".
  quantityLabel: string
}) {
  const catalogue = useCatalogueIdentity()
  // A carton's manifest has a line per allotment line, so one SKU can arrive
  // twice when two allotments asked for it. Added up here: the document is
  // read by garment, and two rows for the same garment read as a mistake.
  const bySku = new Map<string, number>()
  for (const line of lines)
    bySku.set(line.sku_code, (bySku.get(line.sku_code) ?? 0) + line.quantity)
  const rows = [...bySku].map(([sku_code, quantity]) => ({
    sku_code,
    quantity,
  }))
  return (
    <MiniTable head={["Article", quantityLabel]}>
      {rows.map((line) => {
        const identity = catalogue.get(line.sku_code)
        const variant = [identity?.colour, identity?.size]
          .filter((part) => part !== null && part !== undefined && part !== "")
          .join(" · ")
        return (
          <MiniRow key={line.sku_code}>
            <MiniCell>
              <div className="text-ink">
                {identity?.article_name ?? line.sku_code}
              </div>
              <div className="text-mute">
                {variant !== "" && <>{variant} · </>}
                <span className="font-mono">{line.sku_code}</span>
              </div>
            </MiniCell>
            <MiniCell align="right">{count(line.quantity)}</MiniCell>
          </MiniRow>
        )
      })}
    </MiniTable>
  )
}

/// The code a shop scans, with what it opens.
///
/// One shape for the carton and the surat jalan, so the two documents that
/// travel together read alike: the square on the left, the payload it carries
/// in mono, and one line on what scanning it does.
export function QrBlock({
  svg,
  payload,
  children,
}: {
  svg: string
  payload: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-4 rounded-inner border border-hairline p-3.5">
      <div
        className="shrink-0 [&_svg]:size-24"
        role="img"
        aria-label={`QR for ${payload}`}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div className="min-w-0">
        <p className="font-mono text-id break-all text-ink">{payload}</p>
        <p className="mt-1 text-[0.875rem] text-mute">{children}</p>
      </div>
    </div>
  )
}

/// The words for where a carton or a surat jalan has got to.
///
/// The wire says `SHIPMENT` for "on a surat jalan, still on the dock", and
/// read back as "Shipment" it named the document rather than the place. The
/// rest read fine as they are.
const POSITION_WORDS: Readonly<Record<string, string>> = {
  SHIPMENT: "On the dock",
  IN_TRANSIT: "In transit",
}

export function PositionPill({ position }: { position: string }) {
  return (
    <Pill tone={positionTone(position)}>
      {POSITION_WORDS[position] ?? label(position)}
    </Pill>
  )
}

/// A quantity box for one line of an outbound document — a picklist's Pick
/// column, a picklist's Pack column. It refuses more than `max` rather than
/// accepting and rejecting it later, and flashes warm for a moment when a
/// keystroke was held back, so a packer or picker sees why the number on
/// screen is not the one they typed.
export function QtyInput({
  value,
  max,
  label: fieldLabel,
  padTitle,
  onChange,
}: {
  value: number
  max: number
  label: string
  /// What the number pad says it is for, on a phone: the article. Without it,
  /// the box's own label.
  padTitle?: string
  onChange: (quantity: number) => void
}) {
  const [capped, setCapped] = useState(false)
  const flash = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(flash.current), [])
  // On a phone a quantity is picked, not typed: the box opens the number pad
  // and the system keyboard never rises over the row being counted (owner,
  // 2026-10-06). Decided by the width of the page alone, so it is the same in
  // a phone-sized window as on a phone.
  const phone = useLayout() === "phone"
  const [pad, setPad] = useState(false)

  return (
    <>
      <input
        type="text"
        inputMode={phone ? "none" : "numeric"}
        readOnly={phone}
        aria-haspopup={phone ? "dialog" : undefined}
        onClick={phone ? () => setPad(true) : undefined}
        aria-label={fieldLabel}
        value={value === 0 ? "" : String(value)}
        title={max === 0 ? "Nothing of this SKU can be taken now" : undefined}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, "")
          const typed = digits === "" ? 0 : Number(digits)
          const kept = Math.min(typed, max)
          if (kept !== typed) {
            setCapped(true)
            clearTimeout(flash.current)
            flash.current = setTimeout(() => setCapped(false), 900)
          }
          onChange(kept)
        }}
        onFocus={(event) => event.target.select()}
        className={cn(
          "h-8 w-full rounded-inner border border-hairline-2 bg-canvas text-center text-[0.875rem] tabular-nums shadow-soft transition-colors outline-none",
          "hover:border-hairline-strong focus:border-accent",
          phone && "h-10 cursor-pointer text-[0.9375rem]",
          phone && pad && "border-accent",
          capped
            ? "bg-warn-bg font-medium text-warn-fg"
            : value > 0
              ? "bg-accent-bg font-medium text-accent"
              : "text-ink"
        )}
      />
      {phone && (
        <NumberPad
          open={pad}
          onOpenChange={setPad}
          title={padTitle ?? fieldLabel}
          value={value === 0 ? "" : String(value)}
          decimal={false}
          maxLength={String(max).length}
          onChange={(text) =>
            onChange(Math.min(max, text === "" ? 0 : Number(text)))
          }
        />
      )}
    </>
  )
}
