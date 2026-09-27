import { Delete } from "lucide-react"
import { useEffect, useLayoutEffect, useRef } from "react"

import { count } from "@/lib/format"
import { cn } from "@/lib/utils"

/// A count, entered on the glass rather than on the phone's keyboard.
///
/// The number is drawn, not typed into a box: there is no `<input>` here, so
/// the phone never raises its own keyboard over the sheet. That is the whole
/// point. The system keypad covers half the screen, has to be summoned again
/// for every line, and is a different shape on every make of phone; this one is
/// the same size in the same place under the thumb every time, and the next
/// line is one press away.
///
/// The keyboard still comes up where words are wanted — a note, a name, a code
/// typed by hand — and never while this pad is on the glass.
///
/// On a short phone (an SE, a handheld with a 640px glass) the keys and the
/// figure step down a size, so a count page fits between the sheet's title and
/// its footer without scrolling the pad away from the thumb.
///
/// A desk's own keyboard types into it too, but only on a fine pointer. A
/// handheld's scanner IS a keyboard: it types a barcode and presses Enter, and
/// on a touch device with this pad open that would put thirteen digits into a
/// count and then commit it.
export function CountPad({
  value,
  onChange,
  onEnter,
  placeholder = "0",
  unit,
  label,
  maxDigits = 5,
  className,
}: {
  /// The digits so far. `""` is "nothing entered", which is not zero: a blank
  /// line was not counted, a zero was counted and found empty.
  value: string
  onChange: (next: string) => void
  /// Enter on a desk's keyboard — "next line", "add to the trolley".
  onEnter?: () => void
  /// What an empty display shows, faint. A pad whose empty answer means 1 says
  /// so here.
  placeholder?: string
  /// Beside the figure, e.g. "potong".
  unit?: string
  /// What is being counted, for a screen reader.
  label: string
  maxDigits?: number
  className?: string
}) {
  // The listener is added once; it reads the current props through here.
  const latest = useRef({ value, onChange, onEnter })
  useLayoutEffect(() => {
    latest.current = { value, onChange, onEnter }
  })

  const keys = useRef({ last: 0, before: "" })

  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, [contenteditable='true']")
      ) {
        return
      }
      const { value, onChange, onEnter } = latest.current
      // A scanner types a whole barcode and Enter in a few milliseconds; a
      // person does not manage two keys inside 30ms. The first key of a burst
      // has already landed by the time the second shows it was a scan, so the
      // burst puts the figure back to what it was before it began and
      // swallows the rest, Enter included — a barcode is never a count.
      const now = event.timeStamp
      const burst = now - keys.current.last < 30
      keys.current.last = now
      if (!burst) keys.current.before = value
      if (burst && /^[0-9]$|^Enter$/.test(event.key)) {
        onChange(keys.current.before)
        event.preventDefault()
        return
      }
      if (/^[0-9]$/.test(event.key)) {
        onChange(append(value, event.key, maxDigits))
      } else if (event.key === "Backspace") {
        onChange(value.slice(0, -1))
      } else if (event.key === "Enter" && onEnter !== undefined) {
        onEnter()
      } else {
        return
      }
      event.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [maxDigits])

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <output
        aria-label={label}
        aria-live="polite"
        className="flex h-20 items-center justify-center gap-2 rounded-card bg-soft [@media(max-height:700px)]:h-16"
      >
        <span
          className={cn(
            "text-[2.75rem] leading-none font-semibold tracking-[-0.03em] tabular-nums",
            value === "" ? "text-faint" : "text-ink",
          )}
        >
          {value === "" ? placeholder : count(Number(value))}
        </span>
        {unit !== undefined && (
          <span className="mt-3 text-control text-mute">{unit}</span>
        )}
      </output>

      <div className="grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
          <Key
            key={digit}
            onPress={() => onChange(append(value, digit, maxDigits))}
          >
            {digit}
          </Key>
        ))}
        <Key
          onPress={() => onChange("")}
          aria-label="Kosongkan"
          className="text-[1rem] text-body"
        >
          C
        </Key>
        <Key onPress={() => onChange(append(value, "0", maxDigits))}>0</Key>
        <Key
          onPress={() => onChange(value.slice(0, -1))}
          aria-label="Hapus angka terakhir"
        >
          <Delete className="size-5 text-line-ico" />
        </Key>
      </div>
    </div>
  )
}

/// One more digit, unless the count is already as long as it may get. A
/// leading zero is replaced rather than kept: "07" is a typo for 7.
function append(value: string, digit: string, max: number): string {
  const next = (value === "0" ? "" : value) + digit
  return next.length > max ? value : next
}

function Key({
  onPress,
  children,
  className,
  ...props
}: {
  onPress: () => void
  children: React.ReactNode
  className?: string
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className">) {
  return (
    <button
      type="button"
      onClick={onPress}
      // `Numpad`'s key: white with a hairline, so twelve of them read as twelve
      // things to hit rather than one grey slab scored with lines. The press is
      // a real dip — `pressable`'s 0.994 is a card's, and on a 56px key it is
      // invisible — and it is instant feedback, not an animation to wait for,
      // so it stays on for a thumb tapping out 240 as fast as it can.
      className={cn(
        "grid h-14 place-items-center rounded-inner border border-hairline-2 bg-canvas text-[1.25rem] font-medium text-ink tabular-nums shadow-soft [@media(max-height:700px)]:h-12",
        "transition-[scale,background-color] duration-(--t-press) ease-(--ease-out) select-none active:scale-[0.96] active:bg-soft-2",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
