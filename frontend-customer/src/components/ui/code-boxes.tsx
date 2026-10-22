import { useRef, useState } from "react"
import { motion, useReducedMotion } from "motion/react"

import { EASE_OUT } from "@/lib/motion"
import { cn } from "@/lib/utils"

const LENGTH = 6

/// Six digits, one to a box — read aloud at a counter, so each digit gets
/// its own cell and a wrong one is easy to point at.
///
/// On arrival the digits come in left to right, 40ms apart, rising out of a
/// light blur: a code that has just been minted, rather than one that was
/// always there. It happens once per code, which is why it may.
export function CodeDisplay({
  code,
  dead = false,
}: {
  code: string
  dead?: boolean
}) {
  const reduce = useReducedMotion()
  return (
    <div className="flex justify-center gap-2" aria-label={`Kode ${code.split("").join(" ")}`} role="img">
      {code.split("").map((digit, index) => (
        <motion.span
          key={`${code}-${index}`}
          aria-hidden
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10, filter: "blur(6px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.32, delay: reduce ? 0 : index * 0.04, ease: EASE_OUT }}
          className={cn(
            "num flex h-[4.25rem] w-[3.25rem] items-center justify-center rounded-inner bg-canvas font-mono text-code font-medium shadow-soft",
            dead ? "text-faint line-through" : "text-matte-foot",
          )}
        >
          {digit}
        </motion.span>
      ))}
    </div>
  )
}

/// Six boxes to type a code into — one real input underneath, so paste,
/// autofill from the SMS/keyboard strip, and backspace all behave as they do
/// in any field. The boxes only draw what the input holds.
export function CodeInput({
  value,
  onChange,
  id,
  invalid = false,
}: {
  value: string
  onChange: (value: string) => void
  id: string
  invalid?: boolean
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
                digit !== undefined || here ? "bg-canvas shadow-soft" : "bg-soft-2",
                here && "shadow-[0_0_0_2px_var(--accent)]",
                invalid && "shadow-[0_0_0_2px_var(--bad)]",
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
