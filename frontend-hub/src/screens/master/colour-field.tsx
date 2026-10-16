import { Popover } from "@base-ui/react/popover"
import { Pipette } from "lucide-react"
import { useState } from "react"

import { Input } from "@/components/ui/field"
import { ColourSwatch } from "@/components/ui/swatch"
import { readColour, type ColourReading } from "@/lib/colour-parse"
import { POP_MOTION } from "@/lib/filter-chrome"
import { cn } from "@/lib/utils"
import { clamp, HEX, hexOf, hsvOf, type Hsv } from "@/screens/master/colour-hex"

/// Agreeing what a colour LOOKS like, as opposed to what it is called.
///
/// The master's `hex_code` used to be a text box that wanted `#1B2A4A`. That
/// is a fine control for somebody holding a brand book and the wrong one for
/// everybody else: the person naming a colour is usually looking at a garment,
/// a swatch card or a supplier's photograph, and the question they can answer
/// is "is it this one" — not "which six digits is it". A field that only takes
/// the digits gets answered by guessing, and a guessed navy is worse than no
/// navy at all, because the swatch then LIES on every screen that draws it.
///
/// So the box still takes hex — pasting one out of a brand book is the fastest
/// path when you have one — and grows a swatch beside it that opens a picker.
/// Two ways in, one value out.
///
/// **A name works too.** "biru tua", "dusty pink", "hijau army" — read by
/// `readColour()` in `lib/colour-parse.ts` when the box is left (or Enter is
/// pressed): the box becomes the hex the name stands for, and `onNamed` hears
/// the name, so a form can offer it as the colour's label. The swatch shows
/// the reading while the name is still being typed, so it is seen before it
/// is taken.
///
/// Nothing here forces a value. A colour with no agreed hex is a normal state
/// this whole screen is built around, so the square opens with its handle
/// HIDDEN rather than parked on a colour nobody chose, and Clear puts it back.

/// Where the picker opens when there is nothing to open on. Never committed
/// without a deliberate drag — see the hidden handle above.
const UNSET: Hsv = { h: 214, s: 0.6, v: 0.36 }

declare global {
  interface Window {
    EyeDropper?: new () => {
      open: (options?: { signal?: AbortSignal }) => Promise<{ sRGBHex: string }>
    }
  }
}

/// The full spectrum, as a strip. Written in `hsl()` rather than hex stops so
/// the file holds no colour literal a theme could be expected to own.
const SPECTRUM =
  "linear-gradient(to right, hsl(0 100% 50%), hsl(60 100% 50%), hsl(120 100% 50%), hsl(180 100% 50%), hsl(240 100% 50%), hsl(300 100% 50%), hsl(360 100% 50%))"

/// White across, black down — the two washes that turn one hue into every tint
/// and shade of it.
const WASH =
  "linear-gradient(to top, rgb(0 0 0), rgba(0 0 0 / 0)), linear-gradient(to right, rgb(255 255 255), rgba(255 255 255 / 0))"

export function ColourField({
  value,
  onChange,
  onBlur,
  onNamed,
  disabled = false,
}: {
  /// The draft as typed, which is often not yet a hex — half a paste, or
  /// empty. Held raw so the form's own validator stays the one authority on
  /// what a hex is.
  value: string
  onChange: (next: string) => void
  onBlur?: () => void
  /// A name was typed and turned into the hex now in the box.
  onNamed?: (reading: ColourReading) => void
  disabled?: boolean
}) {
  /// Where the handles were last put by hand.
  ///
  /// Not the source of truth — the box is — but the box cannot always say
  /// where a handle was. Every grey is hue 0, so a colour dragged down to
  /// nothing would swing round to red on the way back up, and a half-typed hex
  /// would throw the handles across the square on every keystroke.
  const [steer, setSteer] = useState<Hsv | null>(() => hsvOf(value.trim()))

  const settled = HEX.test(value.trim()) ? value.trim().toUpperCase() : null

  /// So the handles follow what was steered for exactly as long as it still
  /// spells what the box holds, and follow the box the moment it does not.
  const hsv =
    steer !== null && (settled === null || hexOf(steer) === settled)
      ? steer
      : ((settled === null ? null : hsvOf(settled)) ?? UNSET)

  /// What the box says if it holds a colour NAME rather than a hex: shown on
  /// the swatch as it is typed, and taken when the box is left.
  const named =
    settled === null && value.trim() !== "" ? readColour(value) : null

  function settle() {
    if (named === null || !HEX.test(named.hex)) return
    setSteer(hsvOf(named.hex))
    onChange(named.hex)
    onNamed?.(named)
  }

  function enter(event: React.KeyboardEvent) {
    if (event.key !== "Enter" || named === null) return
    // The name becomes the hex first; a second Enter submits the form.
    event.preventDefault()
    settle()
  }

  function say(next: Hsv) {
    setSteer(next)
    onChange(hexOf(next))
  }

  const square = drag((event) => {
    const box = event.currentTarget.getBoundingClientRect()
    say({
      ...hsv,
      s: clamp((event.clientX - box.left) / box.width),
      v: 1 - clamp((event.clientY - box.top) / box.height),
    })
  })

  const strip = drag((event) => {
    const box = event.currentTarget.getBoundingClientRect()
    say({
      ...hsv,
      h: clamp((event.clientX - box.left) / box.width) * 360,
    })
  })

  /// Arrow keys, because a two-dimensional drag is unreachable without them
  /// and the hex box alone would mean spelling a colour you can see.
  function nudge(event: React.KeyboardEvent, axis: "sv" | "h") {
    const step = event.shiftKey ? 5 : 1
    const across =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0
    const down =
      event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0
    if (across === 0 && down === 0) return
    event.preventDefault()
    say(
      axis === "h"
        ? { ...hsv, h: (hsv.h + across * step * 2 + 360) % 360 }
        : {
            ...hsv,
            s: clamp(hsv.s + (across * step) / 100),
            v: clamp(hsv.v - (down * step) / 100),
          }
    )
  }

  async function pickOffScreen() {
    const Dropper = window.EyeDropper
    if (Dropper === undefined) return
    try {
      const picked = (await new Dropper().open()).sRGBHex.toUpperCase()
      if (!HEX.test(picked)) return
      setSteer(hsvOf(picked))
      onChange(picked)
    } catch {
      // Dismissed with Escape. Not an error, and not worth a banner.
    }
  }

  return (
    <Popover.Root>
      {/* The box, and beside it a button that says what it does (owner,
          2026-10-14: "kenapa color picker ga ada"): the 16px swatch inside
          the box was the picker's only door, and nobody read it as one. The
          swatch stays in the box, as what the box holds. */}
      <span className="flex w-full items-center gap-2">
        <span className="relative flex min-w-0 flex-1 items-center">
          <span className="pointer-events-none absolute left-0 z-10 grid size-9 place-items-center">
            <ColourSwatch
              hex={settled ?? named?.hex ?? null}
              className="size-4"
            />
          </span>
          <Input
            value={value}
            disabled={disabled}
            onBlur={() => {
              settle()
              onBlur?.()
            }}
            onKeyDown={enter}
            onChange={(event) => onChange(event.target.value)}
            spellCheck={false}
            autoComplete="off"
            className="pl-9 font-mono uppercase placeholder:font-sans placeholder:normal-case"
          />
        </span>
        <Popover.Trigger
          disabled={disabled}
          className="btn-ghost inline-flex h-10 shrink-0 items-center gap-1.5 rounded-inner border border-hairline-2 bg-canvas px-3 text-[0.9375rem] font-medium text-text hover:bg-soft-2 disabled:opacity-50"
        >
          Pick color
        </Popover.Trigger>
      </span>

      <Popover.Portal>
        {/* z on the Positioner, not only the popup: its transform makes it
            its own layer, and at z auto it drew the picker under the sheet
            (z 50) it opens from — the picker "was not there". */}
        <Popover.Positioner
          side="bottom"
          align="start"
          sideOffset={8}
          className="z-[60]"
        >
          <Popover.Popup
            className={cn(
              "z-50 w-[15.5rem] rounded-inner border border-hairline bg-canvas p-2.5 shadow-pop outline-none",
              POP_MOTION
            )}
          >
            <div
              {...square}
              tabIndex={disabled ? -1 : 0}
              role="group"
              aria-label="Shade and strength"
              onKeyDown={(event) => nudge(event, "sv")}
              style={{
                backgroundColor: `hsl(${hsv.h} 100% 50%)`,
                backgroundImage: WASH,
              }}
              className="relative h-32 w-full touch-none rounded-inner border border-hairline-strong"
            >
              {settled !== null && (
                <Handle left={hsv.s} top={1 - hsv.v} hex={settled} />
              )}
            </div>

            <div
              {...strip}
              tabIndex={disabled ? -1 : 0}
              role="slider"
              aria-label="Hue"
              aria-valuemin={0}
              aria-valuemax={360}
              aria-valuenow={Math.round(hsv.h)}
              onKeyDown={(event) => nudge(event, "h")}
              style={{ backgroundImage: SPECTRUM }}
              className="relative mt-2.5 h-3.5 w-full touch-none rounded-full border border-hairline-strong"
            >
              <Handle
                left={hsv.h / 360}
                top={0.5}
                hex={hexOf({ ...hsv, s: 1, v: 1 })}
              />
            </div>

            <div className="mt-2.5 flex items-center gap-1.5">
              <Input
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onBlur={settle}
                onKeyDown={enter}
                spellCheck={false}
                autoComplete="off"
                className="h-8 flex-1 font-mono text-[0.9375rem] uppercase placeholder:font-sans placeholder:normal-case"
              />
              {/* Only where the browser has one. Picking the colour off a
                  supplier's photograph in the next tab is the shortest path
                  there is to an honest swatch. */}
              {typeof window !== "undefined" &&
                window.EyeDropper !== undefined && (
                  <button
                    type="button"
                    onClick={() => void pickOffScreen()}
                    title="Take the color from anywhere on screen."
                    className="grid size-8 shrink-0 place-items-center rounded-full text-line-ico transition-colors hover:bg-soft-2 hover:text-ink"
                  >
                    <Pipette className="size-3.5" />
                  </button>
                )}
            </div>

            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={value.trim() === ""}
                onClick={() => onChange("")}
                className={cn(
                  "rounded-full px-2 py-0.5 text-[0.9375rem] text-mute transition-colors",
                  "hover:bg-soft-2 hover:text-ink disabled:pointer-events-none disabled:opacity-40"
                )}
              >
                Clear
              </button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

/// Drag-anywhere pointer handling, worn by the square and the strip alike.
///
/// Pointer capture rather than window listeners: a drag that leaves the
/// element keeps steering it, and a finger that leaves the popup does not end
/// up scrolling the sheet behind. `touch-none` on the element is the other
/// half of that — without it, a drag on a tablet scrolls the page instead of
/// choosing a colour.
function drag(at: (event: React.PointerEvent<HTMLElement>) => void) {
  const down = { now: false }
  return {
    onPointerDown(event: React.PointerEvent<HTMLElement>) {
      // Stops the drag selecting the text around it, which also stops the
      // element taking focus — so focus is given by hand.
      event.preventDefault()
      event.currentTarget.focus()
      event.currentTarget.setPointerCapture(event.pointerId)
      down.now = true
      at(event)
    },
    onPointerMove(event: React.PointerEvent<HTMLElement>) {
      if (down.now) at(event)
    },
    onPointerUp(event: React.PointerEvent<HTMLElement>) {
      down.now = false
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId)
    },
    onPointerCancel() {
      down.now = false
    },
  }
}

/// The handle, filled with what it is pointing at.
///
/// Filled rather than hollow because half this vocabulary is white, cream and
/// off-white: a hollow ring in the top-left corner of the square is invisible
/// exactly where the delicate choices are made. The double ring — white
/// inside, hairline outside — is what keeps it visible over both ends of the
/// wash.
function Handle({
  left,
  top,
  hex,
}: {
  left: number
  top: number
  hex: string
}) {
  return (
    <span
      aria-hidden
      style={{
        left: `${left * 100}%`,
        top: `${top * 100}%`,
        backgroundColor: hex,
      }}
      className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-pop ring-2 ring-white outline outline-hairline-strong"
    />
  )
}
