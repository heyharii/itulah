import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/field"
import { PeopleSheet, SheetFoot } from "@/components/ui/people-sheet"
import { Banner } from "@/components/ui/states"
import {
  APPROVED_REASON,
  useRefreshRequests,
  useRequestDecision,
  type RequestItem,
} from "@/lib/queries/requests"
import { cn } from "@/lib/utils"
import { describeCentre } from "@/screens/hr/centre"
import {
  requestFacts,
  type Outcome,
  type RequestFacts,
  type RequestKind,
} from "@/screens/hr/requests-words"
import type { EmployeeList } from "@itulah/contract"

/// One request, as the prototype draws it: a full-width card that says what it
/// is and whose, how much and when, why, and when it was asked — and, at its
/// foot, either the two answers or the stamp of the one that was given.
///
///   ┌────────────────────────────────────────────────────┐
///   │ [Annual leave]                              3 days │
///   │ Rina Wulandari           Thu 15 Oct – Sat 17 Oct 2026 │
///   │ “Family event in Palembang”                        │
///   │ Asked 10 Oct, 19:20                                │
///   ├────────────────────────────────────────────────────┤
///   │                              [ Decline ] [ Approve ] │
///   └────────────────────────────────────────────────────┘
///
/// Nothing else goes on it (owner, 11 Oct): not the shift pattern, not the
/// leave balance. The one-line answer to "should I say yes" is the person, the
/// days and the reason.
///
/// # How it leaves
///
/// An answered card does not blink out of the list: it folds to nothing over
/// 200ms, ease-out, the cards under it rising to meet it, and only then is the
/// list re-read. A card that vanished between two frames reads as one that was
/// never there; one that folds reads as one that was dealt with.

/// A kind's tint, so the colour says what kind before the word does. Leave is
/// the app's blue, sick leave its red; the swap's violet has no token of its
/// own and is the prototype's pair.
const KIND_CHIP: Record<RequestKind, string> = {
  leave: "bg-accent-bg text-accent",
  sick: "bg-bad-bg text-bad-fg",
  swap: "bg-[#efe9fb] text-[#6a3fc0]",
}

/// How long a decided card takes to fold away — `duration-200` on `Fold`, which
/// Tailwind needs to read as a literal.
const FOLD_MS = 200

function RequestCard({
  facts,
  foot,
  error,
}: {
  facts: RequestFacts
  foot: React.ReactNode
  /// A refused answer, said where it was given.
  error?: React.ReactNode
}) {
  return (
    <article className="flex min-w-0 flex-col rounded-card border border-hairline bg-canvas shadow-soft">
      <div className="flex items-start justify-between gap-4 px-4 pt-3.5">
        <div className="flex min-w-0 flex-col items-start gap-1.5">
          <span
            className={cn(
              "rounded-[0.375rem] px-2 py-0.5 text-[0.875rem] font-semibold",
              KIND_CHIP[facts.kind],
            )}
          >
            {facts.type}
          </span>
          <span className="text-card-title font-semibold break-words text-ink">
            {facts.who}
          </span>
        </div>
        <div className="flex max-w-[60%] min-w-0 shrink-0 flex-col items-end text-right tabular-nums">
          <span className="text-[1.25rem] leading-[1.3] font-semibold tracking-tight break-words text-ink">
            {facts.total}
          </span>
          <span className="flex flex-wrap justify-end gap-x-1.5 text-[0.9375rem] text-body">
            {facts.when.map((part) => (
              <span key={part} className="whitespace-nowrap">
                {part}
              </span>
            ))}
          </span>
        </div>
      </div>

      <p className="px-4 pt-2.5 text-[0.9375rem] break-words text-body">
        “{facts.why}”
        {facts.evidence !== null && (
          <>
            {" · "}
            <Evidence {...facts.evidence} />
          </>
        )}
      </p>
      {facts.asked !== null && (
        <p className="px-4 pt-0.5 text-[0.9375rem] text-mute">{facts.asked}</p>
      )}

      <div className="mt-3.5 flex min-h-[3.5625rem] items-center justify-between gap-3 border-t border-hairline px-4 py-3">
        {foot}
      </div>
      {error}
    </article>
  )
}

/// The proof that comes with a sick day. The centre keeps it as a line of text
/// the filer wrote — a reference or a link, not a file it can open — so a link
/// is a link and anything else is read as written.
function Evidence({ label, value }: { label: string; value: string }) {
  if (/^https?:\/\//i.test(value)) {
    return (
      <a
        href={value}
        target="_blank"
        rel="noreferrer"
        className="text-accent underline-offset-2 hover:underline"
      >
        {label}
      </a>
    )
  }
  return (
    <>
      {label}: {value}
    </>
  )
}

/// A rubber stamp's double ring, tilted so it reads as marked on rather than
/// printed in, with the decider's first name under the word.
function Stamp({ outcome }: { outcome: Outcome }) {
  return (
    <span
      className={cn(
        "pointer-events-none inline-block shrink-0 -rotate-6 rounded-[0.375rem] border-[3px] border-double border-current px-2.5 py-0.5 text-center text-[0.875rem] leading-5 font-bold tracking-[0.06em] whitespace-nowrap uppercase opacity-85 mix-blend-multiply select-none",
        outcome.word === "approved"
          ? "text-ok-fg"
          : outcome.word === "declined"
            ? "text-bad-fg"
            : "text-mute",
      )}
    >
      {outcome.word}
      {outcome.by !== null && (
        <span className="block tabular-nums">{outcome.by}</span>
      )}
    </span>
  )
}

/// Folds its card away when `gone`: the row's height goes to zero while it
/// fades, so the cards beneath rise rather than jump. The gap between cards is
/// the wrapper's own bottom padding for exactly that reason — a flex gap would
/// outlive the card by ten pixels and then snap.
///
/// `grid-template-rows` rather than `height`: the card's height is whatever its
/// text made it, and `0fr` needs no number. Reduced motion keeps nothing but
/// the end state.
function Fold({
  gone,
  children,
}: {
  gone: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-200 ease-(--ease-out) motion-reduce:transition-none",
        gone ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr]",
      )}
    >
      {/* The side padding is room for the card's shadow, which `overflow-hidden`
          would otherwise cut. */}
      <div className="-mx-1 min-h-0 overflow-hidden px-1">
        <div className="pb-2.5">{children}</div>
      </div>
    </div>
  )
}

/// A request waiting on an answer: Decline and Approve at its foot.
///
/// **Approve is one tap.** It records the word "Approved" as its reason
/// because the centre will not take a decision without one; a store head with
/// nothing to add should not be asked for it. **Decline asks why**, in a small
/// sheet: a "no" with no reason is the one a person comes back to ask about,
/// and the reason is what the card shows afterwards.
export function WaitingCard({
  item,
  team,
}: {
  item: RequestItem
  team: EmployeeList | undefined
}) {
  const facts = requestFacts(item, team)
  const decision = useRequestDecision(item)
  const refresh = useRefreshRequests()
  const [declining, setDeclining] = useState(false)
  const [gone, setGone] = useState(false)

  const answered = decision.variables
  const approving = decision.isPending && answered?.approve === true

  const decide = (approve: boolean, reason: string) =>
    decision.mutate(
      { approve, reason },
      {
        onSuccess: () => {
          setDeclining(false)
          setGone(true)
          // After the fold, not before: the list under it is about to change.
          window.setTimeout(refresh, FOLD_MS + 20)
        },
      },
    )

  return (
    <>
      <Fold gone={gone}>
        <RequestCard
          facts={facts}
          foot={
            <div className="ml-auto flex gap-2">
              <Button
                variant="ghost"
                size="card"
                aria-label={`Decline ${facts.type} for ${facts.who}`}
                disabled={decision.isPending || gone}
                onClick={() => {
                  decision.reset()
                  setDeclining(true)
                }}
              >
                Decline
              </Button>
              <Button
                variant="primary"
                size="card"
                aria-label={`Approve ${facts.type} for ${facts.who}`}
                pending={approving}
                disabled={gone}
                onClick={() => decide(true, APPROVED_REASON)}
              >
                Approve
              </Button>
            </div>
          }
          error={
            decision.isError && answered?.approve === true ? (
              <p className="rounded-b-card border-t border-bad/10 bg-bad-bg/50 px-4 py-2.5 text-[0.9375rem] text-bad-fg">
                {describeCentre(decision.error)}
              </p>
            ) : undefined
          }
        />
      </Fold>
      {declining && (
        <DeclineSheet
          facts={facts}
          pending={decision.isPending}
          error={
            decision.isError && answered?.approve === false
              ? decision.error
              : null
          }
          onSubmit={(reason) => decide(false, reason)}
          onClose={() => setDeclining(false)}
        />
      )}
    </>
  )
}

/// A request that has been answered: the reason it was given, if there was
/// one, and the stamp.
export function DoneCard({
  item,
  team,
}: {
  item: RequestItem
  team: EmployeeList | undefined
}) {
  const facts = requestFacts(item, team)
  const outcome = facts.outcome
  return (
    <div className="pb-2.5">
      <RequestCard
        facts={facts}
        foot={
          outcome === null ? undefined : (
            <>
              <span className="min-w-0 text-[0.875rem] break-words text-mute">
                {outcome.note !== null && `“${outcome.note}”`}
              </span>
              <Stamp outcome={outcome} />
            </>
          )
        }
      />
    </div>
  )
}

/// Saying no, and why. The reason is what the card keeps under its stamp, and
/// what the person asked sees if they ask.
function DeclineSheet({
  facts,
  pending,
  error,
  onSubmit,
  onClose,
}: {
  facts: RequestFacts
  pending: boolean
  error: unknown
  onSubmit: (reason: string) => void
  onClose: () => void
}) {
  const [reason, setReason] = useState("")
  const blank = reason.trim() === ""

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      crumb={facts.type}
      title={facts.who}
      sub={`${facts.total} · ${facts.when.join(" ")}`}
      foot={
        <SheetFoot>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={blank}
            pending={pending}
            onClick={() => onSubmit(reason.trim())}
          >
            {pending ? "Declining…" : "Decline"}
          </Button>
        </SheetFoot>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Why" required>
          <Input
            value={reason}
            autoFocus
            placeholder="Busy weekend, try next week"
            onChange={(event) => setReason(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !blank && !pending) {
                onSubmit(reason.trim())
              }
            }}
          />
        </Field>
        {error !== null && error !== undefined && (
          <Banner tone="bad">{describeCentre(error)}</Banner>
        )}
      </div>
    </PeopleSheet>
  )
}
