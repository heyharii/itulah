import { useId, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/// The one control this whole app is actually operated with.
///
/// A barcode gun is a keyboard that types very fast and then presses Enter, so
/// a scan field is a form with one text input and nothing between the trigger
/// and the submit. Three things make it work on a floor rather than at a desk,
/// and each of them is a bug that was found by using it:
///
///  - **It clears itself and keeps focus.** A picker scans forty tags without
///    looking at the screen. A field that kept the last value appends the next
///    scan to it and produces one impossible EPC; a field that lost focus
///    swallows the scan after it silently.
///  - **It is a `<form>`.** A `keydown` handler on the input is the obvious
///    alternative and it is the wrong one: it does not survive an IME
///    composition, and it competes with whatever the surrounding dialog does
///    with keys.
///  - **It is 44px and mono.** Read at arm's length, pressed with a glove, and
///    the value is a code — so it is set in the face that makes `O` and `0`
///    different characters.
///
/// `autoCapitalize`/`autoCorrect`/`spellCheck` are off because a handheld
/// keyboard "helpfully" capitalising a SKU is a scan that does not match.
export function ScanField({
  action = "Add",
  disabled = false,
  pending = false,
  hint,
  problem,
  placeholder,
  autoFocus = true,
  onSubmit,
  className,
}: {
  /// The label on the button beside it. There is always a button: a bay
  /// without a working gun is typed into, and that has to be possible.
  action?: string
  disabled?: boolean
  /// The last scan is being checked. The field stays live — the next tag is
  /// already on its way from the gun, and a field that refused it would lose
  /// it — only the button waits.
  pending?: boolean
  hint?: React.ReactNode
  /// Why the last scan was refused — an unknown tag, a piece already packed.
  /// Said here, under the field, in `{bad}`, and the box turns red with it:
  /// somebody scanning forty tags looks up at the colour, not the words.
  problem?: React.ReactNode
  /// What the empty field asks for, and its name for a screen reader.
  placeholder?: string
  autoFocus?: boolean
  /// Called with the trimmed value. The field is cleared for you.
  onSubmit: (value: string) => void
  className?: string
}) {
  const [value, setValue] = useState("")
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  const refused =
    problem !== undefined &&
    problem !== null &&
    problem !== false &&
    problem !== ""
  const under = refused ? `${id}-problem` : hint ? `${id}-hint` : undefined

  return (
    <form
      className={cn("flex flex-col gap-1.5 px-4 py-3", className)}
      onSubmit={(event) => {
        event.preventDefault()
        const scanned = value.trim()
        if (scanned === "" || disabled) return
        onSubmit(scanned)
        setValue("")
        // Back to the gun. Deliberately after the handler, so a submit that
        // opened a dialog still gets to take focus off this field.
        input.current?.focus()
      }}
    >
      <div className="flex gap-2">
        <input
          ref={input}
          autoFocus={autoFocus}
          value={value}
          disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          aria-label={placeholder}
          aria-invalid={refused ? true : undefined}
          aria-describedby={under}
          className={cn(
            "h-tap min-w-0 flex-1 rounded-full border border-transparent bg-soft-2 px-4",
            "font-mono text-[0.9375rem] tracking-[0.02em] text-ink transition-colors outline-none",
            "placeholder:font-sans placeholder:tracking-normal placeholder:text-mute",
            "hover:border-hairline-2 hover:bg-soft-3 disabled:opacity-50",
            "aria-[invalid=true]:border-bad aria-[invalid=true]:bg-bad-bg aria-[invalid=true]:hover:border-bad"
          )}
        />
        {/* Busy, never disabled: a form whose submit button is disabled
            ignores Enter, and Enter is how the gun submits. */}
        <Button
          type="submit"
          variant="soft"
          disabled={disabled}
          aria-busy={pending ? true : undefined}
          className="aria-busy:opacity-75"
        >
          {action}
        </Button>
      </div>
      {refused ? (
        <p id={under} role="alert" className="text-[0.9375rem] text-bad">
          {problem}
        </p>
      ) : hint ? (
        <p id={under} className="text-[0.9375rem] text-mute">
          {hint}
        </p>
      ) : null}
    </form>
  )
}
