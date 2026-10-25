import { useRef, useState } from "react"

import { cn } from "@/lib/utils"

const LENGTH = 6

/// Six boxes to type a code into — one real input underneath, so paste,
/// autofill from the WhatsApp/SMS keyboard strip, and backspace all behave as
/// they do in any field. The boxes only draw what the input holds.
export function CodeInput({
  value,
  onChange,
  id,
  invalid = false,
  autoFocus = false,
}: {
  value: string
  onChange: (value: string) => void
  id: string
  invalid?: boolean
  autoFocus?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)
  const active = Math.min(value.length, LENGTH - 1)

  return (
    <div className="relative" onClick={() => input.current?.focus()}>
      <input
        ref={input}
        id={id}
        name="code"
        autoFocus={autoFocus}
        value={value}
        onChange={(event) =>
          onChange(event.target.value.replace(/\D/g, "").slice(0, LENGTH))
        }
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={LENGTH}
        aria-invalid={invalid || undefined}
        className="absolute inset-0 z-10 w-full cursor-text opacity-0"
      />
      <div aria-hidden className="flex justify-between gap-2">
        {Array.from({ length: LENGTH }, (_, index) => {
          const digit = value[index]
          const here = focused && index === active && value.length < LENGTH
          return (
            <span
              key={index}
              className={cn(
                "num relative flex h-14 flex-1 items-center justify-center rounded-inner font-mono text-[1.625rem] font-medium text-ink transition-[background-color,box-shadow] duration-[var(--t-hover)] ease-[var(--ease-out)]",
                // One shadow at a time: `shadow-soft` and a ring are both
                // `box-shadow`, and with both on the element the soft one wins
                // the cascade and the ring never draws.
                invalid
                  ? "bg-canvas shadow-[0_0_0_2px_var(--bad)]"
                  : here
                    ? "bg-canvas shadow-[0_0_0_2px_var(--accent)]"
                    : digit !== undefined
                      ? "bg-canvas shadow-soft"
                      : "bg-soft-2",
              )}
            >
              {digit}
              {here && (
                <span className="absolute h-7 w-0.5 rounded-full bg-accent motion-safe:animate-pulse" />
              )}
            </span>
          )
        })}
      </div>
    </div>
  )
}
