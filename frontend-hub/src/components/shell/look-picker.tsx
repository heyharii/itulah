import { Popover } from "@base-ui/react/popover"
import { Check, Palette } from "lucide-react"
import { useState } from "react"

import { POP_MOTION } from "@/lib/filter-chrome"
import { LOOK_AIDS, readAids, writeAids, type LookAid } from "@/lib/look"
import { cn } from "@/lib/utils"

/// Where the owner tries the aids that give an All white screen full of data
/// its structure back (owner, 2026-10-14: "all white agak membingungkan jg
/// kalau banyak data") — on the real screens, before the ones he keeps become
/// `LOOK_AIDS_DEFAULT`. Each one is a switch, and they combine. The choice is
/// kept in this browser only. Goes once they are decided.
export function LookPicker({ place }: { place: "panel" | "bar" }) {
  const [aids, setAids] = useState(readAids)
  const flip = (aid: LookAid) => {
    const next = aids.includes(aid)
      ? aids.filter((one) => one !== aid)
      : [...aids, aid]
    setAids(next)
    writeAids(next)
  }
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label="Look"
        title="Look"
        className={cn(
          "look-picker inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-inner px-2 text-[0.9375rem] font-medium text-body transition-colors hover:bg-soft-2 hover:text-ink data-[popup-open]:bg-soft-2",
          place === "bar" && "max-md:px-2"
        )}
      >
        <Palette className="size-4 stroke-[1.7]" />
        {/* In the 216px panel the glyph alone, so the department's name
            keeps its room. */}
        <span className={place === "bar" ? "max-md:hidden" : "sr-only"}>
          Look
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className="z-50"
          side="bottom"
          align={place === "panel" ? "start" : "end"}
          sideOffset={8}
          collisionPadding={16}
        >
          <Popover.Popup
            className={cn(
              "flex w-[20rem] max-w-[calc(100vw-2rem)] flex-col rounded-card border border-hairline bg-canvas p-1.5 text-[0.9375rem] shadow-pop outline-none",
              POP_MOTION
            )}
          >
            {LOOK_AIDS.map((aid) => {
              const on = aids.includes(aid.value)
              return (
                <button
                  key={aid.value}
                  type="button"
                  aria-pressed={on}
                  title={aid.note}
                  onClick={() => flip(aid.value)}
                  className="flex min-h-10 items-center gap-3 rounded-inner px-2.5 text-left text-ink transition-colors hover:bg-soft-2 active:scale-[0.98] pointer-coarse:min-h-tap"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "grid size-5 shrink-0 place-items-center rounded-[6px] border transition-colors",
                      on
                        ? "border-accent bg-accent text-white"
                        : "border-hairline-strong bg-canvas text-transparent"
                    )}
                  >
                    <Check className="size-3.5 stroke-[2.5]" />
                  </span>
                  {aid.label}
                </button>
              )
            })}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
