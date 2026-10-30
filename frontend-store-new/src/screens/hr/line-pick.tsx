import { Radio } from "@base-ui/react/radio"
import { RadioGroup } from "@base-ui/react/radio-group"

import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { HEAD_OFFICE } from "@/lib/line"
import type { LineRead } from "@/lib/queries/line"
import { cn } from "@/lib/utils"
import { describeCentre, isRefusal } from "@/screens/hr/centre"
import { Avatar } from "@/screens/hr/line-chart"

/// The sentence for a line of report that could not be read. A refusal (403 or
/// 404: the centre this shop reaches does not serve placements to a shop yet)
/// is an answer and says so quietly; anything else is the line to head office.
function lineProblem(error: unknown): string {
  return isRefusal(error)
    ? "The line of report isn't available from head office yet."
    : describeCentre(error)
}

/// The chart's stand-in while the line is not there: nothing drawn, one quiet
/// sentence, and a way to ask again only when asking again could help.
export function LineProblem({
  error,
  onRetry,
}: {
  error: unknown
  onRetry: () => void
}) {
  const refused = isRefusal(error)
  return (
    <div className="mx-auto flex max-w-[28em] flex-col items-center gap-4 px-4 py-12 text-center">
      <p className={cn("text-meta", refused ? "text-body" : "text-bad")}>
        {lineProblem(error)}
      </p>
      {!refused && (
        <Button variant="ghost" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

/// A row of the *Reports To* list: an avatar, a name and a position.
function Option({
  value,
  name,
  role,
  on,
}: {
  value: string
  name: string
  role: string
  on: boolean
}) {
  return (
    <Radio.Root
      value={value}
      className={cn(
        "flex w-full cursor-pointer items-center gap-3 rounded-xl border bg-canvas px-3 py-2.5 text-left",
        "transition-[border-color,box-shadow,scale] duration-(--t-hover) ease-(--ease-out) active:scale-[0.99]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        on
          ? "border-accent shadow-[inset_0_0_0_1px_var(--accent)]"
          : "border-hairline hover:border-hairline-strong",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid size-[1.125rem] shrink-0 place-items-center rounded-full border-[1.5px]",
          on ? "border-accent" : "border-hairline-strong",
        )}
      >
        {on && <span className="size-2.5 rounded-full bg-accent" />}
      </span>
      <Avatar name={name} />
      <span className="flex min-w-0 flex-col leading-[1.3]">
        <span className="truncate text-cell font-semibold text-ink">
          {name}
        </span>
        <span className="truncate text-meta text-body">{role}</span>
      </span>
    </Radio.Root>
  )
}

/// The sheet's *Reports To* section: who this person reports to, and — for
/// somebody whose boss is on this shop's books — the way to ask for another.
///
/// What it shows, in the order the questions are asked:
///
///  1. the line is still being read, or could not be — one quiet sentence;
///  2. a change is already with head office — *Waiting for HO* and who it asks
///     for, and no second ask until head office has decided the first;
///  3. the boss is outside the shop — a fixed *Head Office* row. A shop cannot
///     move somebody under, or out from under, a boss it cannot see;
///  4. otherwise a radio list of everyone on the shop except the person and the
///     people under them (so nobody can end up their own boss), and, once a
///     different boss is ticked, the one sentence head office needs: why.
export function ReportsTo({
  read,
  id,
  chosen,
  onChoose,
  reason,
  onReason,
}: {
  read: LineRead
  id: string
  /// The boss ticked in the list (the current one until somebody else is).
  chosen: string | null
  onChoose: (boss: string) => void
  reason: string
  onReason: (text: string) => void
}) {
  if (read.state === "pending") {
    return <p className="text-meta text-body">Reading the line of report…</p>
  }
  if (read.state === "failed") {
    return <p className="text-meta text-body">{lineProblem(read.error)}</p>
  }

  const line = read.line
  const waiting = line.waiting(id)
  if (waiting !== undefined) {
    return (
      <div className="flex flex-col items-start gap-2">
        <Pill tone="warn">Waiting for HO</Pill>
        <p className="text-meta text-body">Asked for {waiting.toName}.</p>
      </div>
    )
  }

  const current = line.boss(id)
  if (current === null) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-hairline bg-canvas px-3 py-2.5">
        <Avatar name={HEAD_OFFICE} text="HO" />
        <span className="flex min-w-0 flex-col leading-[1.3]">
          <span className="truncate text-cell font-semibold text-ink">
            {HEAD_OFFICE}
          </span>
          <span className="truncate text-meta text-body">
            Set by head office
          </span>
        </span>
      </div>
    )
  }

  // Everyone but the person and the people under them; the present boss first,
  // so the list opens on the answer it already holds.
  const under = line.under(id)
  const options = line.members
    .filter((one) => !under.has(one.id))
    .sort(
      (left, right) =>
        Number(right.id === current) - Number(left.id === current),
    )
  return (
    <div className="flex flex-col gap-4">
      <RadioGroup
        aria-label="Reports To"
        value={chosen ?? current}
        onValueChange={(next) => onChoose(next as string)}
        className="flex flex-col gap-1.5"
      >
        {options.map((one) => (
          <Option
            key={one.id}
            value={one.id}
            name={one.name}
            role={one.role}
            on={(chosen ?? current) === one.id}
          />
        ))}
      </RadioGroup>
      {chosen !== null && chosen !== current && (
        <Field label="Why" required>
          <Input
            value={reason}
            placeholder="Runs the women's floor now"
            onChange={(event) => onReason(event.target.value)}
          />
        </Field>
      )}
    </div>
  )
}
