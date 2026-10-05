import { ChevronRight } from "lucide-react"
import { useState } from "react"

import { cn } from "@/lib/utils"

/// The controls this module still owns: an offer read back as its terms, and
/// the fold its composers keep their optional settings behind.
///
/// Everything else that started here has been promoted — `<Day>` to
/// `components/ui/day`, `<Money>` into `field`, and `<Section>`, `<Choices>`,
/// `<Toggle>`, `<Dial>`, `<Stepper>` and `<FindMany>` to `form` and `find` —
/// because a second module wanted each of them. This one has not been, and
/// should not be until something outside Commercial has terms to state: it is
/// shaped by what a shopper meets an offer as, and a generic "record, read
/// back" would be that shape with the reason removed.

// ── what it will read like ──────────────────────────────────────────────────

/// The offer as somebody will have to read it, while it is still being written.
///
/// **Not a calculator.** The console this replaces previewed a rule by working
/// it out against a sample product with a quantity stepper, which answers a
/// question nobody was asking: the author knows what 20% of 199.000 is. What
/// they cannot hold in their head is the *combination* — eight controls spread
/// down a form, three of which are conditions that must all be true before any
/// of it happens, and one of which is a code without which none of it does. A
/// promotion that never fires is nearly always a combination nobody read back.
///
/// So this is the shape a shopper meets an offer in: a headline, and the terms
/// under it, numbered. It is written from the same values the command carries
/// and nothing else, so it cannot promise something the button will not
/// publish.
///
/// **The last block is the honest half.** A budget, a basket cap and a priority
/// are real and they are invisible: nobody at the counter is told the offer
/// stopped because a number in the centre ran out. Putting them in the same
/// list as the terms is what made the old preview read as a promise. They are
/// set apart, under the sentence that says a shopper never sees them.
export function Terms({
  headline,
  name,
  prose,
  clauses,
  hidden,
  foot,
  empty,
  variant = "box",
  rows,
}: {
  /// The offer in three or four words — "20% off", "Rp 50.000 each".
  headline: React.ReactNode
  /// What the shop calls it.
  name: string
  /// The small print, as the shop prints it — free text somebody wrote, not a
  /// sentence assembled from fields. Set above the numbered list, because that
  /// is where a shopper meets it.
  prose?: string
  /// One sentence each, in the order somebody meets them. Falsy entries are
  /// dropped, so a caller can write the list as conditions.
  clauses: readonly (string | false | null | undefined)[]
  /// True, and never said out loud to a shopper.
  ///
  /// For a promotion, which has a shopper-facing half and an internal one. A
  /// campaign has no shopper-facing half at all — see `foot`.
  hidden?: readonly (string | false | null | undefined)[]
  /// A closing sentence, where the split above does not apply.
  foot?: React.ReactNode
  /// What to say before there is anything to read.
  empty: string
  /// `box` is the numbered list in a grey box; `rows` is plain label/value
  /// rows, one group per array in `rows`, with a hairline between groups.
  variant?: "box" | "rows"
  rows?: readonly (readonly {
    label: string
    value: React.ReactNode
  }[])[]
}) {
  if (variant === "rows") {
    const groups = (rows ?? []).filter((group) => group.length > 0)
    return groups.length === 0 ? (
      <p className="text-[0.9375rem] text-mute">{empty}</p>
    ) : (
      <div className="flex flex-col gap-4">
        {groups.map((group, at) => (
          <dl
            key={at}
            className={cn(
              "flex flex-col gap-4",
              at > 0 && "border-t border-hairline pt-4"
            )}
          >
            {group.map((row) => (
              <div
                key={row.label}
                className="flex items-baseline justify-between gap-6"
              >
                <dt className="shrink-0 text-[0.875rem] text-mute">
                  {row.label}
                </dt>
                <dd className="min-w-0 text-right text-[0.9375rem] text-ink">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        ))}
      </div>
    )
  }

  const said = clauses.filter((one): one is string => Boolean(one))
  const unsaid = (hidden ?? []).filter((one): one is string => Boolean(one))

  return (
    <div className="rounded-inner border border-hairline bg-soft p-5">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <span className="text-metric font-semibold text-ink">{headline}</span>
        <span className="truncate text-[0.875rem] text-mute">
          {name.trim() === "" ? "Unnamed" : name.trim()}
        </span>
      </div>

      {prose && prose.trim() !== "" && (
        <p className="mb-4 border-l-2 border-hairline-strong pl-2.5 text-[0.875rem] leading-relaxed whitespace-pre-line text-text">
          {prose.trim()}
        </p>
      )}

      {said.length === 0 ? (
        <p className="text-[0.875rem] leading-relaxed text-mute">{empty}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {said.map((one, index) => (
            <li
              key={index}
              className="flex gap-2 text-[0.875rem] leading-relaxed text-text"
            >
              <span className="shrink-0 text-mute tabular-nums">
                {index + 1}.
              </span>
              <span className="min-w-0">{one}</span>
            </li>
          ))}
        </ol>
      )}

      {(unsaid.length > 0 || foot) && (
        <div className="mt-4 border-t border-hairline pt-4">
          <p className="text-[0.875rem] leading-relaxed text-mute">
            {unsaid.length > 0
              ? `A shopper is never told any of this: ${unsaid.join("; ")}.`
              : foot}
          </p>
        </div>
      )}
    </div>
  )
}

// ── the optional half of a form ─────────────────────────────────────────────

/// Settings most offers leave alone, folded away until somebody asks for them.
///
/// A composer that shows every question at once makes the four that decide the
/// offer look no more important than the eight that fine-tune it, and a first
/// read of it is a wall. Closed by default; the count on the bar says how many
/// of the folded settings have been moved off their defaults, so a closed fold
/// never hides that something inside it is set.
export function More({
  label = "More options",
  count = 0,
  children,
}: {
  label?: string
  /// How many settings inside differ from their defaults.
  count?: number
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <section className="rounded-inner border border-hairline-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="flex w-full items-center gap-2 rounded-inner px-4 py-3.5 text-left transition-colors hover:bg-soft"
      >
        <ChevronRight
          className={cn(
            "size-4 shrink-0 text-line-ico transition-transform",
            open && "rotate-90"
          )}
        />
        <span className="flex-1 text-[0.875rem] font-medium text-ink">
          {label}
        </span>
        {count > 0 && (
          <span className="rounded-full bg-accent-bg px-2 py-0.5 text-[0.875rem] font-medium text-accent tabular-nums">
            {count} set
          </span>
        )}
      </button>
      {open && (
        <div className="flex flex-col gap-5 border-t border-hairline px-4 pt-5 pb-5">
          {children}
        </div>
      )}
    </section>
  )
}

/// A labelled question whose answer is not a single input — a row of tiles,
/// a set of chips.
///
/// Not a `<Field>`: a `<label>` wrapped round a radio group hands every click
/// on the words to the first option in it.
export function Question({
  label,
  children,
  className,
}: {
  label: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <span className="text-[0.875rem] font-medium text-text">{label}</span>
      {children}
    </div>
  )
}
