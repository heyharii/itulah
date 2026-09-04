/// The one control this module still owns: an offer, read back as its terms.
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
}) {
  const said = clauses.filter((one): one is string => Boolean(one))
  const unsaid = (hidden ?? []).filter((one): one is string => Boolean(one))

  return (
    <div className="rounded-inner border border-hairline bg-soft px-3.5 py-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-metric font-semibold text-ink">{headline}</span>
        <span className="truncate text-[0.71875rem] text-mute">
          {name.trim() === "" ? "Unnamed" : name.trim()}
        </span>
      </div>

      {prose && prose.trim() !== "" && (
        <p className="mb-2.5 border-l-2 border-hairline-strong pl-2.5 text-[0.71875rem] leading-relaxed whitespace-pre-line text-text">
          {prose.trim()}
        </p>
      )}

      {said.length === 0 ? (
        <p className="text-[0.71875rem] leading-relaxed text-mute">{empty}</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {said.map((one, index) => (
            <li
              key={index}
              className="flex gap-2 text-[0.71875rem] leading-relaxed text-text"
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
        <div className="mt-2.5 border-t border-hairline pt-2.5">
          <p className="text-[0.71875rem] leading-relaxed text-mute">
            {unsaid.length > 0
              ? `A shopper is never told any of this: ${unsaid.join("; ")}.`
              : foot}
          </p>
        </div>
      )}
    </div>
  )
}
