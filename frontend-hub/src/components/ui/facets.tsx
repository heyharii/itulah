import { Check, Plus, Search } from "lucide-react"
import { useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Sheet } from "@/components/ui/sheet"
import { count } from "@/lib/format"
import { cn } from "@/lib/utils"

/// The filter column, for every screen that browses a catalogue.
///
/// Sourcing and Articles ask the same question of two different datasets — what
/// is in here, and how much of it — so they draw the same column. It lived
/// twice, once file-local in Sourcing and once in `screens/master/shared`,
/// and the two had already drifted: one had a box to sift a long list, the
/// other did not. One copy is why "make Articles behave like Sourcing" is now a
/// thing that cannot be half-done.
///
/// A facet is a SET. Ticking kids and footwear asks for both, not for the
/// intersection, which is empty.

/// One value of a facet, with how many rows carry it. Matches the server's
/// `FacetCount` without importing it: this component draws counted words, and
/// two screens' contracts should not have to be the same type for that.
export interface FacetValue {
  readonly value: string
  readonly count: number
}

/// Past this many values the group grows a box to sift itself. Below it the
/// whole list is on screen already, where a search field would only ask
/// somebody to type what they can see.
const SIEVE_AT = 4

/// Past this many the group offers the "+" that opens the full list in a sheet.
/// It is the point where the inline area starts clipping — roughly six rows fit
/// in `max-h-[13.5rem]` — so the control appears exactly when there is
/// something it can reveal.
const OVERFLOWS_AT = 6

/// Does this value answer to what was typed in its group's own box?
///
/// The label and the code both count. Somebody types "kaus" because that is
/// what the screen says; whoever files the catalogue types `KAUS_KAKI` because
/// that is what the spreadsheet says, and refusing the second makes the box
/// look broken to the person most likely to use it.
export function facetMatches(
  label: string,
  code: string,
  needle: string
): boolean {
  const wanted = needle.trim().toLowerCase()
  if (wanted === "") return true
  return (
    label.toLowerCase().includes(wanted) || code.toLowerCase().includes(wanted)
  )
}

/// A facet group: a heading, the values, and two ways to find one.
///
/// It takes the values rather than children so that the inline list and the
/// sheet behind the "+" are drawn from one array. Passing children — which is
/// how this started — meant the sheet would have had to be built a second time
/// by every caller, and the two lists would disagree the first time one of them
/// learned to sort.
export function FacetGroup({
  label,
  values,
  selected,
  onToggle,
  labelOf,
  shape = "row",
  leadingOf,
  onClear,
}: {
  label: string
  values: readonly FacetValue[] | undefined
  selected: readonly string[]
  onToggle: (value: string) => void
  /// `KAUS_KAKI` → "Kaus Kaki". Falls back to the code upstream, never to a
  /// blank: an unknown code is a vocabulary that has not caught up, and hiding
  /// it would make the row look unclassified when it is not.
  labelOf: (value: string) => string
  /// Wrapped chips for short words — tags, colours — instead of a checkbox per
  /// line. Twenty tags cost four rows this way instead of twenty.
  shape?: "row" | "chip"
  /// What rides in front of a value. Where a colour puts its swatch.
  leadingOf?: (value: string) => React.ReactNode
  /// Drop every choice in THIS group. Offered in the sheet, where somebody has
  /// just been ticking things and the page's own Clear is off screen.
  onClear?: () => void
}) {
  const [needle, setNeedle] = useState("")
  const [open, setOpen] = useState(false)

  /// The last list the server actually sent, held across refetches.
  ///
  /// Ticking a value changes the query key, so the page's data goes undefined
  /// until the next answer lands — and a column that empties every time
  /// somebody ticks something cannot be used to tick a second thing. Holding
  /// the previous list is honest here in a way it would not be for the rows:
  /// the server counts facets over the SEARCH, never over the selection, so the
  /// list being redrawn is the same list.
  ///
  /// `undefined` and `[]` are kept apart on purpose. Undefined is "no answer
  /// yet" and shows what we had; an empty array is the server saying there is
  /// nothing, and must show nothing.
  const remembered = useRef<readonly FacetValue[]>([])
  if (values !== undefined) remembered.current = values
  const all = values ?? remembered.current
  /// A ticked value survives the box whatever is typed. Sifting is a way of
  /// finding a filter, not of dropping one, and a filter still narrowing the
  /// list while invisible is the worst thing this column can do.
  const shown = useMemo(
    () =>
      all.filter(
        (facet) =>
          selected.includes(facet.value) ||
          facetMatches(labelOf(facet.value), facet.value, needle)
      ),
    [all, selected, labelOf, needle]
  )

  const sifts = all.length > SIEVE_AT
  const overflows = all.length > OVERFLOWS_AT

  return (
    <div className="border-t border-hairline py-4 first-of-type:border-t-0">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <span className="text-eyebrow font-semibold text-mute uppercase">
          {label}
        </span>
        <div className="flex items-center gap-1">
          {all.length > 0 && (
            <span className="text-[0.9375rem] text-faint tabular-nums">
              {count(needle === "" ? all.length : shown.length)}
            </span>
          )}
          {/* The whole vocabulary, in a surface wide enough to read it. The
              column is 212px and capped at six rows; a tag list nineteen long
              or a colour master a hundred long cannot be browsed in it, and
              scrolling a 212px box is not browsing. */}
          {overflows && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label={`All ${label.toLowerCase()} values`}
              className="grid size-[1.125rem] place-items-center rounded-[5px] text-mute transition-colors hover:bg-soft-2 hover:text-ink"
            >
              <Plus className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {sifts && (
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-line-ico" />
          <input
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
            aria-label={`Find a ${label.toLowerCase()}`}
            className="h-7 w-full rounded-full border border-transparent bg-soft-2 pr-2 pl-7 text-[0.9375rem] text-ink transition-colors outline-none placeholder:text-mute hover:border-hairline-2 focus:border-hairline-strong focus:bg-canvas"
          />
        </div>
      )}

      {all.length > 0 && shown.length === 0 ? (
        <p className="py-1 text-[0.9375rem] text-mute">Nothing by that name.</p>
      ) : (
        <div className="max-h-[13.5rem] overflow-y-auto pr-1">
          {shape === "chip" ? (
            <div className="flex flex-wrap gap-1.5">
              {shown.map((facet) => (
                <FacetChip
                  key={facet.value}
                  label={labelOf(facet.value)}
                  count={facet.count}
                  on={selected.includes(facet.value)}
                  onToggle={() => onToggle(facet.value)}
                  leading={leadingOf?.(facet.value)}
                />
              ))}
            </div>
          ) : (
            shown.map((facet) => (
              <FacetItem
                key={facet.value}
                label={labelOf(facet.value)}
                count={facet.count}
                on={selected.includes(facet.value)}
                onToggle={() => onToggle(facet.value)}
                leading={leadingOf?.(facet.value)}
              />
            ))
          )}
        </div>
      )}

      <FacetSheet
        open={open}
        onClose={() => setOpen(false)}
        label={label}
        values={all}
        selected={selected}
        onToggle={onToggle}
        labelOf={labelOf}
        leadingOf={leadingOf}
        onClear={onClear}
      />
    </div>
  )
}

/// The whole facet, in the detail rail.
///
/// Rows rather than chips whatever the group draws inline: there is room here
/// for a count column that lines up, and a ticked box is easier to scan down a
/// long list than a filled pill. Nothing is capped — this is the surface the
/// cap exists to have somewhere to point at.
function FacetSheet({
  open,
  onClose,
  label,
  values,
  selected,
  onToggle,
  labelOf,
  leadingOf,
  onClear,
}: {
  open: boolean
  onClose: () => void
  label: string
  values: readonly FacetValue[]
  selected: readonly string[]
  onToggle: (value: string) => void
  labelOf: (value: string) => string
  leadingOf?: (value: string) => React.ReactNode
  onClear?: () => void
}) {
  const [needle, setNeedle] = useState("")
  const shown = useMemo(
    () =>
      values.filter((facet) =>
        facetMatches(labelOf(facet.value), facet.value, needle)
      ),
    [values, labelOf, needle]
  )
  // Counted from the selection, not from the list: the two are ticked together,
  // and a refetch must not make a chosen filter read as unchosen.
  const picked = selected.length

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={label}
      id={`${count(values.length)} values`}
      footer={
        <div className="flex items-center gap-2">
          {onClear && (
            <Button
              onClick={onClear}
              disabled={picked === 0}
              className="flex-1"
            >
              Clear {label.toLowerCase()}
            </Button>
          )}
          <Button variant="primary" onClick={onClose} className="flex-1">
            Done
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-line-ico" />
          <input
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
            aria-label={`Search ${label.toLowerCase()}`}
            autoFocus
            className="h-9 w-full rounded-full border border-transparent bg-soft-2 pr-3 pl-9 text-[0.9375rem] text-ink transition-colors outline-none placeholder:text-mute hover:border-hairline-2 focus:border-hairline-strong focus:bg-canvas"
          />
        </div>

        {/* What is already ticked, said in words. A sheet opened over a filtered
            list should not make somebody count the boxes. */}
        <div className="text-[0.9375rem] text-mute">
          {picked === 0
            ? "Nothing chosen — everything is shown."
            : `${count(picked)} chosen.`}
        </div>

        {shown.length === 0 ? (
          <p className="py-2 text-[0.9375rem] text-mute">
            Nothing by that name.
          </p>
        ) : (
          <div className="flex flex-col">
            {shown.map((facet) => (
              <FacetItem
                key={facet.value}
                label={labelOf(facet.value)}
                count={facet.count}
                on={selected.includes(facet.value)}
                onToggle={() => onToggle(facet.value)}
                leading={leadingOf?.(facet.value)}
                size="comfortable"
              />
            ))}
          </div>
        )}
      </div>
    </Sheet>
  )
}

/// A checkbox with its count, which is the whole affordance: the number is how
/// somebody decides whether a filter is worth pressing before they press it.
export function FacetItem({
  label,
  count: howMany,
  on,
  onToggle,
  leading,
  size = "tight",
}: {
  label: string
  count: number
  on: boolean
  onToggle: () => void
  leading?: React.ReactNode
  /// `comfortable` in the sheet, where there is room and the list is long.
  size?: "tight" | "comfortable"
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      className={cn(
        "flex w-full items-center gap-2.5 text-left text-[0.9375rem] text-text transition-colors hover:text-ink",
        size === "tight"
          ? "py-[0.3125rem]"
          : "rounded-inner px-1 py-2 hover:bg-soft-2"
      )}
    >
      <span
        className={cn(
          "grid size-4 shrink-0 place-items-center rounded-[5px] border-[1.5px] transition-colors",
          on ? "border-ink bg-ink" : "border-hairline-strong"
        )}
      >
        {on && <Check className="size-2.5 text-white" />}
      </span>
      {leading}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-[0.9375rem] text-mute tabular-nums">
        {count(howMany)}
      </span>
    </button>
  )
}

/// The same choice, wrapped instead of stacked — for vocabularies whose values
/// are short words rather than sentences.
export function FacetChip({
  label,
  count: howMany,
  on,
  onToggle,
  leading,
}: {
  label: string
  count: number
  on: boolean
  onToggle: () => void
  leading?: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.9375rem] transition-colors",
        on
          ? "border-ink bg-ink text-white"
          : "border-hairline-2 text-text hover:bg-soft-2"
      )}
    >
      {leading}
      <span className="truncate">{label}</span>
      <span className={on ? "text-white/70" : "text-mute"}>
        {count(howMany)}
      </span>
    </button>
  )
}
