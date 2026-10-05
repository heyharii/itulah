import { Switch } from "@/components/ui/form"
import { Button } from "@/components/ui/button"
import { Fact, Facts } from "@/components/ui/sheet"

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

/// Active or inactive, the way the supplier's sheet says it: the state in
/// words, what it means, and the switch at the right. Saved with the form.
export function ActiveRow({
  on,
  noun,
  onToggle,
}: {
  on: boolean
  noun: string
  onToggle: () => void
}) {
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
      <Switch on={on} label="Active" onToggle={onToggle} />
    </div>
  )
}
