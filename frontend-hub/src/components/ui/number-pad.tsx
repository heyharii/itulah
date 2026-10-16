import { Drawer } from "@base-ui/react/drawer"
import { Delete, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { numberText } from "@/lib/number-input"
import { cn } from "@/lib/utils"

/// The sheet a number is picked on, on a phone.
///
/// A quantity on a phone is not typed: the keyboard comes up over half the
/// screen, covers the very row being counted, and brings letters, a comma and
/// an emoji key to a box that takes digits (owner, 2026-10-06: "jangan keluarin
/// keyboard tapi pilih dari angka aja"). A field that takes a number opens this
/// instead — big keys under the thumb, the figure large above them — and the
/// system keyboard never rises (`Input` sets `inputMode="none"`).
///
/// ## How it behaves
///
///  - The figure the field held is shown first, and the first key REPLACES it,
///    the way a picker does: correcting 12 to 18 is two taps, not a
///    backspace-and-retype. After that keys go in at the caret.
///  - The caret moves like a phone keyboard's (owner, 2026-10-16): tap the
///    figure to put it between two digits, or hold and slide. A key goes in
///    there and delete takes the digit to its left; the thousands points are
///    drawn, never typed, so the caret only stands between digits.
///  - Every key writes through at once, so the field behind the sheet is
///    already right when the sheet goes away — Done only puts it away, and a
///    pull down or × leaves what was entered.
///  - Whole numbers have no point key; a field that takes fractions gets one.
///  - `maxLength` is honoured, so a count can not be made longer than the
///    field's own limit.
export function NumberPad({
  open,
  onOpenChange,
  title,
  value,
  decimal,
  maxLength,
  onChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /// What is being counted — the article, the unit, the line: it is what the
  /// thumb is answering, and the sheet covers the row that said it.
  title: string
  /// What the field holds now, as the field wrote it.
  value: string
  /// Fractions are legal here.
  decimal: boolean
  maxLength?: number
  onChange: (next: string) => void
}) {
  const [text, setText] = useState("")
  // The held figure is "selected": the first key replaces it. Kept in state
  // as well, so the figure can look selected until then.
  const fresh = useRef(true)
  const [selected, setSelected] = useState(true)
  /// Where the caret stands in `text`: how many of its characters are to the
  /// left of it.
  const [at, setAt] = useState(0)
  /// Each typed character as drawn, for finding where a tap lands.
  const chars = useRef<(HTMLSpanElement | null)[]>([])

  useEffect(() => {
    if (!open) return
    const held = numberText(value, decimal)
    setText(held)
    setAt(held.length)
    fresh.current = true
    setSelected(true)
    // Opened, not edited: what the field holds is read once, then this sheet
    // is the owner until it closes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const put = (next: string, caret: number) => {
    // No leading zeros: 0 then 5 is 5, not 05 — the caret moves with them.
    let cleaned = next
    let moved = caret
    while (
      cleaned.length > 1 &&
      cleaned[0] === "0" &&
      cleaned[1] !== "." &&
      moved > 0
    ) {
      cleaned = cleaned.slice(1)
      moved -= 1
    }
    setText(cleaned)
    setAt(Math.min(moved, cleaned.length))
    onChange(cleaned)
  }
  const press = (key: string) => {
    const replacing = fresh.current
    const base = replacing ? "" : text
    const where = replacing ? 0 : at
    fresh.current = false
    setSelected(false)
    if (maxLength !== undefined && base.length >= maxLength) return
    if (key === ".") {
      if (!decimal || base.includes(".")) return
      const piece = where === 0 ? "0." : "."
      put(base.slice(0, where) + piece + base.slice(where), where + piece.length)
      return
    }
    put(base.slice(0, where) + key + base.slice(where), where + 1)
  }
  const erase = () => {
    if (fresh.current) {
      fresh.current = false
      setSelected(false)
      put("", 0)
      return
    }
    if (at === 0) return
    put(text.slice(0, at - 1) + text.slice(at), at - 1)
  }
  /// The caret to the gap nearest the finger: before the first digit whose
  /// middle is to the right of it, else at the end.
  const placeAt = (x: number) => {
    if (fresh.current) {
      fresh.current = false
      setSelected(false)
    }
    for (let index = 0; index < text.length; index += 1) {
      const box = chars.current[index]?.getBoundingClientRect()
      if (box !== undefined && x < box.left + box.width / 2) {
        setAt(index)
        return
      }
    }
    setAt(text.length)
  }

  // A whole number reads grouped (125.000) as the money fields write it; one
  // with a fraction reads exactly as the field will hold it.
  // Each typed character with the thousands point drawn before it where one
  // belongs; the points are drawing, not text, so the caret skips them.
  const grouped = !decimal
  const drawn = [...text].map((ch, index) => ({
    ch,
    point: grouped && index > 0 && (text.length - index) % 3 === 0,
  }))

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Backdrop
          forceRender
          className="fixed inset-0 z-50 bg-[var(--scrim)] opacity-[calc(1-var(--drawer-swipe-progress,0))] transition-opacity duration-(--t-drawer) ease-(--ease-out) data-[ending-style]:opacity-0 data-[ending-style]:duration-(--t-exit) data-[starting-style]:opacity-0 data-[swiping]:transition-none"
        />
        <Drawer.Viewport className="fixed inset-0 z-50 flex items-end">
          <Drawer.Popup
            className={cn(
              "flex w-full flex-col overflow-hidden rounded-t-sheet border-t border-hairline bg-canvas pb-[env(safe-area-inset-bottom)] shadow-float outline-none",
              "[transform:translateY(var(--drawer-swipe-movement-y,0px))] transition-[translate,transform] duration-(--t-drawer) ease-(--ease-drawer) data-[ending-style]:duration-(--t-exit)",
              "data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full data-[swiping]:transition-none",
              "motion-reduce:data-[ending-style]:translate-none motion-reduce:data-[starting-style]:translate-none"
            )}
          >
            <div aria-hidden className="flex shrink-0 justify-center pt-2">
              <span className="h-1 w-9 rounded-full bg-hairline-strong" />
            </div>
            <div className="flex items-start gap-3 px-4 pt-3">
              <Drawer.Title className="min-w-0 flex-1 text-[0.9375rem] leading-5 font-medium text-body">
                {title}
              </Drawer.Title>
              <Drawer.Close
                aria-label="Close"
                // 44, a thumb's least (D1); pulled up and right so the
                // visible × stays where the 32px one stood.
                className="-mt-2 -mr-2 grid size-11 shrink-0 place-items-center rounded-inner text-line-ico transition-colors hover:bg-soft-2 hover:text-ink"
              >
                <X className="size-4" />
              </Drawer.Close>
            </div>

            {/* The figure, in the room a thumb's eyes need: it is what the
              keys below are answering. Empty reads as a faint 0. */}
            {/* The whole row takes the finger: a tap right of the figure puts
                the caret at the end, left of it at the start (owner,
                2026-10-16). */}
            <output
              aria-live="polite"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId)
                placeAt(event.clientX)
              }}
              onPointerMove={(event) => {
                if (event.buttons > 0) placeAt(event.clientX)
              }}
              className={cn(
                "touch-none select-none",
                "block truncate px-4 pt-1 pb-3 text-[2.5rem] leading-[1.1] font-semibold tracking-[-0.03em] tabular-nums",
                text === "" ? "text-mute/50" : "text-ink"
              )}
            >
              {/* Selected while the first key would replace it; then a
                caret that a tap, or a hold and slide, puts between digits —
                a phone keyboard's (owner, 2026-10-16). */}
              <span
                className={cn(
                  "inline-flex items-baseline rounded-[0.25rem]",
                  selected && text !== "" && "bg-accent-bg"
                )}
              >
                {text === "" && <span>0</span>}
                {drawn.map((one, index) => (
                  <span key={index} className="inline-flex items-baseline">
                    {!selected && at === index && <Caret />}
                    {one.point && <span>.</span>}
                    <span
                      ref={(node) => {
                        chars.current[index] = node
                      }}
                    >
                      {one.ch}
                    </span>
                  </span>
                ))}
                {!selected && at === text.length && <Caret />}
              </span>
            </output>

            <div className="grid grid-cols-3 gap-2 px-4 pb-3">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((key) => (
                <Key key={key} onPress={() => press(key)}>
                  {key}
                </Key>
              ))}
              {decimal ? (
                <Key onPress={() => press(".")} label="Decimal point">
                  .
                </Key>
              ) : (
                <span aria-hidden />
              )}
              <Key onPress={() => press("0")}>0</Key>
              <Key onPress={erase} label="Delete" quiet>
                <Delete className="size-6" />
              </Key>
            </div>

            <div className="flex justify-end border-t border-hairline px-4 py-3">
              <Button
                variant="primary"
                className="h-11 w-full"
                onClick={() => onOpenChange(false)}
              >
                Done
              </Button>
            </div>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

/// The blinking caret between two digits.
function Caret() {
  return (
    <span
      aria-hidden
      className="mx-px inline-block h-[0.85em] w-[3px] translate-y-[0.08em] animate-pulse bg-accent motion-reduce:animate-none"
    />
  )
}

/// One key: 56px tall, the whole third of the row wide, pressed with the same
/// small give every button here has.
function Key({
  children,
  onPress,
  label,
  quiet = false,
}: {
  children: React.ReactNode
  onPress: () => void
  label?: string
  quiet?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onPress}
      className={cn(
        "grid h-14 place-items-center rounded-2xl text-[1.5rem] font-medium text-ink tabular-nums transition-[scale,background-color] duration-(--t-press) ease-(--ease-out) active:scale-[0.96]",
        quiet ? "text-body active:bg-soft-2" : "bg-soft-2 active:bg-hairline"
      )}
    >
      {children}
    </button>
  )
}
