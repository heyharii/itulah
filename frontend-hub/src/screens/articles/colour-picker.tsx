import { useQuery } from "@tanstack/react-query"
import { Check, Lock } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/field"
import { Banner } from "@/components/ui/states"
import { count } from "@/lib/format"
import type { ArticleColourwayInput } from "@/lib/queries/articles"
import { colourKeys, listColours } from "@/lib/queries/colours"
import type { ColourTerm } from "@/lib/queries/colours"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"

/// Mapping an article's colours onto its ten digits.
///
/// The colour of a SKU is ONE character of an eleven-digit code — eight of
/// article, one of colour, two of size — so an article has ten colourways and
/// there is no eleventh. That is not a limit somebody chose and can raise; it
/// is the shape of the number, enforced again in the database by
/// `article_colour`'s primary key. This picker draws all ten slots for exactly
/// that reason: a control that hides the ceiling until you hit it teaches
/// people to expect a setting somewhere, and there is no setting.
///
/// The colours themselves are picked from a company master and never typed.
/// Free text is what left "Navy", "navy" and "Biru Navy" in the catalogue as
/// three unrelated things, splitting every report that grouped by colour — a
/// misspelt label does not fail, it just quietly becomes a fourth colour.

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const

/// A colour as a person recognises it: the dot first, the name after.
///
/// Standalone because the picker and the colour master screen both draw it,
/// and a swatch drawn twice is a swatch that ends up two sizes.
///
/// A colour with no `hex` gets an empty ring rather than a grey fill. The
/// master lets a colour be named before anybody has decided which pixel value
/// stands for it, and a grey dot would read as a decision — somebody picking
/// "Charcoal" because the swatch looked about right is worse than somebody
/// reading the name.
export function ColourSwatch({
  hex,
  label,
  code,
  className,
}: {
  /// `#RRGGBB` from the master, or null where it has none yet.
  hex: string | null
  /// What a person reads. Omit to draw the dot alone.
  label?: React.ReactNode
  /// The code under the label — what a filter addresses, and the thing that
  /// does not change when somebody renames the colour.
  code?: string
  className?: string
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <span
        aria-hidden
        title={hex ?? "No swatch has been chosen for this colour yet."}
        className={cn(
          "size-4 shrink-0 rounded-full border border-hairline-strong",
          hex === null && "border-dashed bg-canvas"
        )}
        // From the master, so it cannot be a token: the whole point of the
        // column is that the company decides what "Navy" looks like.
        style={hex === null ? undefined : { backgroundColor: hex }}
      />
      {label !== undefined && (
        <span className="min-w-0">
          <span className="block truncate text-[0.8125rem] text-ink">
            {label}
          </span>
          {code !== undefined && (
            <span className="block truncate font-mono text-[0.65625rem] text-mute">
              {code}
            </span>
          )}
        </span>
      )}
    </span>
  )
}

export function ColourPicker({
  value,
  onChange,
  minted,
  disabled = false,
}: {
  value: readonly ArticleColourwayInput[]
  onChange: (next: ArticleColourwayInput[]) => void
  /// How many SKUs already carry each digit. A digit in here is settled: the
  /// caller reads it off the article's own SKUs, not off a permission.
  minted: ReadonlyMap<string, number>
  disabled?: boolean
}) {
  const master = useQuery({
    queryKey: colourKeys.list(),
    queryFn: ({ signal }) => listColours(signal),
    // The company's colour list changes when somebody adds a colour, which is
    // roughly never while a form is open.
    staleTime: 30 * 60 * 1000,
  })

  /// Which slot is being chosen for, and what has been typed into its filter.
  /// One at a time: two open lists would let somebody assign the same colour
  /// twice before either had settled.
  const [openDigit, setOpenDigit] = useState<string | null>(null)
  const [needle, setNeedle] = useState("")

  const assigned = useMemo(() => {
    const byDigit = new Map<string, string>()
    for (const way of value) byDigit.set(way.colour_digit, way.colour_code)
    return byDigit
  }, [value])

  /// The reverse index, which is what makes "not this colour twice" cheap to
  /// show rather than only cheap to reject.
  const takenBy = useMemo(() => {
    const byCode = new Map<string, string>()
    for (const way of value) byCode.set(way.colour_code, way.colour_digit)
    return byCode
  }, [value])

  const named = useMemo(() => {
    const byCode = new Map<string, ColourTerm>()
    for (const term of master.data?.colours ?? []) byCode.set(term.code, term)
    return byCode
  }, [master.data])

  /// Filtered here rather than at the server. A company has a hundred colours,
  /// so the whole list is already in hand — and a round trip per keystroke to
  /// re-answer a question the browser can answer is how a picker comes to feel
  /// slower than a text box, which is how people go back to typing.
  const matches = useMemo(() => {
    const all = master.data?.colours ?? []
    const wanted = needle.trim().toLowerCase()
    if (wanted === "") return all
    return all.filter(
      (term) =>
        term.label.toLowerCase().includes(wanted) ||
        term.code.toLowerCase().includes(wanted)
    )
  }, [master.data, needle])

  const locked = DIGITS.filter((digit) => (minted.get(digit) ?? 0) > 0)
  const full = value.length >= DIGITS.length

  function assign(digit: string, code: string) {
    onChange(
      [
        // Both the digit being written AND any digit already holding this
        // colour are dropped. The list below already refuses a colour that is
        // spoken for, but a mapping with one colour on two digits is a save
        // the server rejects wholesale, and the person would be reading a
        // refusal about a rule this form never showed them.
        ...value.filter(
          (way) => way.colour_digit !== digit && way.colour_code !== code
        ),
        { colour_digit: digit, colour_code: code },
      ].sort((a, b) => a.colour_digit.localeCompare(b.colour_digit))
    )
    setOpenDigit(null)
    setNeedle("")
  }

  return queryState(master, {
    loading: "Reading the colour master…",
    render: () => (
      <div className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[0.78125rem] font-medium text-text">
            Colourways
          </span>
          <span className="text-[0.71875rem] text-mute tabular-nums">
            {value.length} of {DIGITS.length} digits used
          </span>
        </div>

        <div className="flex flex-col rounded-inner border border-hairline">
          {DIGITS.map((digit) => {
            const code = assigned.get(digit)
            const term = code === undefined ? undefined : named.get(code)
            const skus = minted.get(digit) ?? 0
            const fixed = skus > 0
            const open = openDigit === digit

            return (
              <div
                key={digit}
                className="border-b border-hairline last:border-b-0"
              >
                <div className="flex items-center gap-2.5 px-2.5 py-2">
                  <span className="w-4 shrink-0 text-center font-mono text-id text-body">
                    {digit}
                  </span>

                  {code === undefined ? (
                    <span className="min-w-0 flex-1 text-[0.8125rem] text-mute">
                      Not used
                    </span>
                  ) : (
                    <ColourSwatch
                      className="flex-1"
                      hex={term?.hex_code ?? null}
                      label={term?.label ?? code}
                      code={code}
                    />
                  )}

                  {fixed ? (
                    <span
                      className="flex shrink-0 items-center gap-1.5 text-[0.71875rem] text-mute"
                      title="Goods carrying this digit are already tagged and on a shelf. Repointing it would rename them without touching them."
                    >
                      <Lock className="size-3.5 text-line-ico" />
                      {count(skus)} minted
                    </span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-1">
                      {code !== undefined && !open && (
                        <Button
                          size="sm"
                          variant="quiet"
                          disabled={disabled}
                          onClick={() =>
                            onChange(
                              value.filter((way) => way.colour_digit !== digit)
                            )
                          }
                        >
                          Clear
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant={open ? "soft" : "ghost"}
                        // A slot may only be chosen for when it is already in
                        // use or there is room: the eleventh colourway is
                        // refused here, not at the server.
                        disabled={disabled || (code === undefined && full)}
                        onClick={() => {
                          setNeedle("")
                          setOpenDigit(open ? null : digit)
                        }}
                      >
                        {open
                          ? "Cancel"
                          : code === undefined
                            ? "Assign"
                            : "Change"}
                      </Button>
                    </span>
                  )}
                </div>

                {open && (
                  <div className="border-t border-hairline bg-soft px-2.5 py-2.5">
                    <Input
                      autoFocus
                      value={needle}
                      onChange={(event) => setNeedle(event.target.value)}
                      placeholder="Filter the colour master"
                      className="h-8"
                    />
                    <div className="mt-2 max-h-56 overflow-y-auto">
                      {matches.length === 0 ? (
                        <p className="px-1 py-3 text-[0.71875rem] text-mute">
                          Nothing in the master reads like that. Colours are
                          picked and never typed, so a new one is added on the
                          Colours screen first — that is what keeps the whole
                          company spelling it the same way.
                        </p>
                      ) : (
                        matches.map((colour) => {
                          const holder = takenBy.get(colour.code)
                          const mine = holder === digit
                          const elsewhere = holder !== undefined && !mine
                          return (
                            <button
                              key={colour.code}
                              type="button"
                              disabled={disabled || elsewhere}
                              title={
                                elsewhere
                                  ? `Digit ${holder} already means this colour. One colour cannot sit on two digits of one article — the digit is what the SKU carries, so it would make one colour two different goods.`
                                  : undefined
                              }
                              onClick={() => assign(digit, colour.code)}
                              className={cn(
                                "flex w-full items-center gap-2.5 rounded-inner px-2 py-1.5 text-left transition-colors",
                                elsewhere
                                  ? "opacity-50"
                                  : "hover:bg-soft-2 disabled:opacity-50"
                              )}
                            >
                              <ColourSwatch
                                className="flex-1"
                                hex={colour.hex_code}
                                label={colour.label}
                                code={colour.code}
                              />
                              {mine ? (
                                <Check className="size-3.5 shrink-0 text-accent" />
                              ) : elsewhere ? (
                                <span className="shrink-0 text-[0.65625rem] text-mute">
                                  digit {holder}
                                </span>
                              ) : (
                                colour.in_use > 0 && (
                                  <span className="shrink-0 text-[0.65625rem] text-mute tabular-nums">
                                    {count(colour.in_use)} articles
                                  </span>
                                )
                              )}
                            </button>
                          )
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {full && (
          <Banner tone="info">
            All ten digits are spoken for, and ten is the ceiling rather than a
            setting: a SKU is eight digits of article, one of colour and two of
            size, so an eleventh colourway has no character to live in. Clear a
            colour this article no longer comes in — one with no SKUs minted
            against it — before adding another.
          </Banner>
        )}

        {locked.length > 0 && (
          <p className="text-[0.71875rem] leading-relaxed text-mute">
            {locked.length === 1
              ? `Digit ${locked[0]} is locked.`
              : `Digits ${locked.slice(0, -1).join(", ")} and ${locked[locked.length - 1]} are locked.`}{" "}
            SKUs have already been minted against them, printed onto labels and
            tagged onto goods sitting in a shop. Repointing one would rename
            what is on the shelf without anybody touching the shelf, so the
            colour it means is settled for good — the server refuses it too.
          </p>
        )}
      </div>
    ),
  })
}
