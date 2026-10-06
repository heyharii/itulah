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
///    backspace-and-retype. After that keys append.
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
  // The held figure is "selected": the first key replaces it.
  const fresh = useRef(true)

  useEffect(() => {
    if (!open) return
    setText(numberText(value, decimal))
    fresh.current = true
    // Opened, not edited: what the field holds is read once, then this sheet
    // is the owner until it closes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const put = (next: string) => {
    setText(next)
    onChange(next)
  }
  const press = (key: string) => {
    const base = fresh.current ? "" : text
    fresh.current = false
    if (maxLength !== undefined && base.length >= maxLength) return
    if (key === ".") {
      if (!decimal || base.includes(".")) return
      put(base === "" ? "0." : `${base}.`)
      return
    }
    // No leading zeros: 0 then 5 is 5, not 05.
    put(base === "0" ? key : `${base}${key}`)
  }
  const erase = () => {
    fresh.current = false
    put(text.slice(0, -1))
  }

  // A whole number reads grouped (125.000) as the money fields write it; one
  // with a fraction reads exactly as the field will hold it.
  const shown =
    text === ""
      ? "0"
      : decimal
        ? text
        : new Intl.NumberFormat("id-ID").format(Number(text))

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
                className="grid size-8 shrink-0 place-items-center rounded-inner text-line-ico transition-colors hover:bg-soft-2 hover:text-ink"
              >
                <X className="size-4" />
              </Drawer.Close>
            </div>

            {/* The figure, in the room a thumb's eyes need: it is what the
              keys below are answering. Empty reads as a faint 0. */}
            <output
              aria-live="polite"
              className={cn(
                "block truncate px-4 pt-1 pb-3 text-[2.5rem] leading-[1.1] font-semibold tracking-[-0.03em] tabular-nums",
                text === "" ? "text-mute/50" : "text-ink"
              )}
            >
              {shown}
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
                className="h-9 w-full"
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
