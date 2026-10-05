import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { Dialog } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/form"
import { Button } from "@/components/ui/button"
import { Fact, Facts } from "@/components/ui/sheet"
import type { TermUsage } from "@/lib/queries/vocabulary"

/// What the master-data sheets share — colours, divisions, sizes, tags.
///
/// Each of them is a short form in a rail: Label, Code, then whatever else the
/// list needs, and one Submit row. They were written twice and had drifted (a
/// greyed Code box on one, a Fact on the other; a full-width Submit on one, a
/// right-aligned Add on the other; one form opening red). The pieces that must
/// stay identical live here so they cannot drift again; what differs per list —
/// its validation, its extra fields — stays in the list's own file.

/// A code that is already minted: read, not edited, because the goods point at
/// it. Said as a fact rather than a greyed-out box that looks like a field that
/// is broken.
export function CodeFact({ code }: { code: string }) {
  return (
    <Facts>
      <Fact term="Code">
        <span className="font-mono">{code}</span>
      </Fact>
    </Facts>
  )
}

/// The one Submit row: right-aligned, "Add X" while minting, "Save" once the
/// row exists.
export function SubmitRow({
  pending,
  creating,
  noun,
}: {
  pending: boolean
  /// True while minting a new row.
  creating: boolean
  /// The singular, any case: "tag", "colour".
  noun: string
}) {
  return (
    <div className="flex items-center justify-end gap-2 pt-1">
      <Button type="submit" variant="primary" pending={pending}>
        {pending
          ? "Saving…"
          : creating
            ? `Add ${noun.charAt(0).toUpperCase()}${noun.slice(1)}`
            : "Save"}
      </Button>
    </div>
  )
}

/// Where to read what uses a term: the query key and the read.
export interface UsageSource {
  readonly queryKey: readonly unknown[]
  readonly queryFn: (context: { signal: AbortSignal }) => Promise<TermUsage>
}

/// Asked before anything is made inactive: how many of what use it now, and
/// where the effect lands (owner, 2026-10-05). Nothing is deleted; the point is
/// that a press on a power icon is not a one-click act.
export function DeactivateDialog({
  open,
  onOpenChange,
  noun,
  label,
  usage,
  pending,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  noun: string
  label: string
  usage: UsageSource
  pending?: boolean
  onConfirm: () => void
}) {
  const read = useQuery({
    queryKey: usage.queryKey,
    queryFn: usage.queryFn,
    enabled: open,
    staleTime: 0,
  })
  const used = (read.data?.references ?? []).filter((one) => one.count > 0)
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Make ${label} Inactive?`}
      confirm="Make Inactive"
      cancel="Cancel"
      tone="danger"
      pending={pending}
      onConfirm={onConfirm}
    >
      <div className="flex flex-col gap-3">
        {read.isPending ? (
          <p>Counting what uses this {noun}…</p>
        ) : read.isError ? (
          <p>Could not count what uses this {noun}.</p>
        ) : used.length === 0 ? (
          <p>Nothing uses this {noun} today.</p>
        ) : (
          <div>
            <p className="mb-1.5">In use by:</p>
            <dl className="flex flex-col gap-1">
              {used.map((one) => (
                <div
                  key={one.key}
                  className="flex items-baseline justify-between gap-4"
                >
                  <dt className="text-body">{one.label}</dt>
                  <dd className="font-medium text-ink tabular-nums">
                    {one.count}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        <p>
          It stops being offered when an article, an order or a promotion is set
          up. Everything that already uses it keeps it, and it can be made
          active again at any time.
        </p>
      </div>
    </Dialog>
  )
}

/// Active or inactive, the way the supplier's sheet says it: the state in
/// words, what it means, and the switch at the right. Saved with the form;
/// turning it off asks first.
export function ActiveRow({
  on,
  noun,
  label,
  usage,
  onToggle,
}: {
  on: boolean
  noun: string
  label: string
  usage: UsageSource
  onToggle: () => void
}) {
  const [asking, setAsking] = useState(false)
  return (
    <div className="flex items-center justify-between gap-3 rounded-inner border border-hairline px-3.5 py-3">
      <span className="flex flex-col">
        <span className="text-[0.875rem] font-medium text-ink">
          {on ? "Active" : "Inactive"}
        </span>
        <span className="text-[0.875rem] text-body">
          {on
            ? `This ${noun} can be chosen for new work.`
            : `This ${noun} is hidden from new work.`}
        </span>
      </span>
      <Switch
        on={on}
        label="Active"
        onToggle={() => (on ? setAsking(true) : onToggle())}
      />
      <DeactivateDialog
        open={asking}
        onOpenChange={setAsking}
        noun={noun}
        label={label}
        usage={usage}
        onConfirm={() => {
          setAsking(false)
          onToggle()
        }}
      />
    </div>
  )
}
