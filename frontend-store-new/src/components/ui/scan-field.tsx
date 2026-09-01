import { Search } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"

/// The field a scanner talks to.
///
/// A barcode or RFID wedge is a keyboard: it types the code and presses Enter,
/// wherever the caret happens to be. So this field keeps the caret — it takes
/// focus on arrival and takes it back after every submit — and a screen that
/// has one should have only one.
///
/// It is a `<form>` rather than an `onKeyDown` because Enter submitting a form
/// is what the wedge is emulating, and because it brings the phone keyboard's
/// "go" key for free when somebody types a code by hand.
///
/// It is also **not** `type="search"` and not a native autocomplete: a history
/// dropdown over a till, offering the last customer's barcode, is a mis-scan
/// waiting to happen.
export function ScanField({
  onScan,
  placeholder,
  autoFocus = true,
  action,
  className,
}: {
  /// Called with the raw code. The caller decides what kind of code it was.
  onScan: (raw: string) => void
  placeholder: string
  autoFocus?: boolean
  /// A control on the right of the row — the filter chip DESIGN.md pairs with
  /// a mobile search field.
  action?: React.ReactNode
  className?: string
}) {
  const [value, setValue] = useState("")
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus) input.current?.focus()
  }, [autoFocus])

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <form
        className="flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-full border border-hairline-2 bg-canvas px-4"
        onSubmit={(event) => {
          event.preventDefault()
          const raw = value.trim()
          if (raw === "") return
          setValue("")
          onScan(raw)
          // Straight back to the field. The next tag is already being waved at
          // the reader.
          input.current?.focus()
        }}
      >
        <Search className="size-[1.125rem] shrink-0 text-line-ico" />
        <input
          ref={input}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
          enterKeyHint="go"
          className="min-w-0 flex-1 bg-transparent text-[1rem] text-ink outline-none placeholder:text-mute"
        />
      </form>
      {action}
    </div>
  )
}
