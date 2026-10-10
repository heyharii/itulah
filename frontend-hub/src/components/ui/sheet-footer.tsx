import { Printer } from "lucide-react"
import { isValidElement } from "react"

import { Button } from "@/components/ui/button"
import { pendingLabel } from "@/components/ui/pending-label"
import { Problem } from "@/components/ui/states"
import { cn } from "@/lib/utils"

/// The foot of a record sheet — the one home for what the sheet does.
///
/// ```
///  ..................  [Print] [Delete…]  [Cancel]  [secondary]  [Primary]
///  every button stands at the right (owner, 10 Oct 2026: no sheet has a
///  button at the far left); the primary is last, danger first, Cancel quiet
/// ```
///
/// Pass it as the Sheet's `footer`. The sheet draws the band (the rule, the
/// padding, the 36px desk / 44px phone buttons, the safe area); this draws what
/// stands in it, the same on every width. It is the `FormSheet` in the People
/// settings (the best foot the 6 Oct 2026 audit found) made a component.
///
///  - **One primary**, on the right, last. Its verb is the act's own ("Save
///    changes", "Create supplier", "Approve"); never a bare "Submit". While the
///    write is on the way it says the same verb as a present participle
///    ("Saving changes…") — derived, or `pendingLabel` when the verb is not
///    one `pending-label.ts` knows.
///  - **Danger first**, away from the primary — a `ConfirmButton` for
///    anything that cannot be walked back; for a decision pair, Reject here and
///    Approve as the primary.
///  - **Cancel is quiet** and leaves; a reader who cannot act gets `Close` and
///    no primary.
///  - **Read mode**: `onPrint` draws the Print icon first and the
///    primary is "Edit". Editing in place swaps the same foot to Cancel and
///    "Save changes".
///  - **`note`** is the one line that says why the primary is disabled (or what
///    the act will do). `error` is the write that failed, above the foot.
export function SheetFooter({
  danger,
  start,
  onPrint,
  onCancel,
  cancelLabel = "Cancel",
  secondary,
  primary,
  note,
  noteTone,
  error,
  className,
}: {
  /// The destructive act, on the left: a `ConfirmButton`, or Reject.
  danger?: React.ReactNode
  /// Anything else that stands at the left, before `danger`.
  start?: React.ReactNode
  /// Read mode: the Print icon on the left.
  onPrint?: () => void
  /// Leaves without writing. Left out, there is no Cancel.
  onCancel?: () => void
  /// `Close` for a reader who cannot act.
  cancelLabel?: React.ReactNode
  /// Another verb on the right, between Cancel and the primary.
  secondary?: React.ReactNode
  /// The one primary — described, or a ready-made button.
  primary?: FooterAction | React.ReactElement
  /// Why the primary is disabled, in one line.
  note?: React.ReactNode
  noteTone?: "mute" | "warn" | "bad"
  /// The write that failed: the server's sentence, in a banner above the foot.
  error?: unknown
  className?: string
}) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <Problem error={error ?? null} />
      {note && <FootNote tone={noteTone}>{note}</FootNote>}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {onPrint !== undefined && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Print"
              title="Print"
              className="max-md:w-11"
              onClick={onPrint}
            >
              <Printer />
            </Button>
          )}
          {start}
          {danger}
          {onCancel !== undefined && (
            <Button variant="quiet" onClick={onCancel}>
              {cancelLabel}
            </Button>
          )}
          {secondary}
          {primary !== undefined &&
            (isValidElement(primary) ? (
              primary
            ) : (
              <Button
                variant={primary.tone === "danger" ? "danger" : "primary"}
                pending={primary.pending}
                said={primary.said}
                disabled={primary.disabled}
                onClick={primary.onClick}
              >
                {primary.pending === true
                  ? (primary.pendingLabel ?? pendingLabel(primary.label))
                  : primary.label}
              </Button>
            ))}
        </div>
      </div>
    </div>
  )
}

export interface FooterAction {
  readonly label: React.ReactNode
  readonly onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
  /// The "done" words the button holds in place after the write (`useSaid`).
  readonly said?: string | null
  readonly pending?: boolean
  /// Said while `pending`, when the label's verb is not one the kit can turn
  /// into a participle on its own.
  readonly pendingLabel?: React.ReactNode
  readonly disabled?: boolean
  /// `danger` for an act that cannot be walked back and is the foot's one verb.
  readonly tone?: "primary" | "danger"
}

/// The one line in a foot: why the primary is off, or what it is about to do.
///
/// 14px, wraps (a refusal cut off is not read), quiet by colour — `bad` only
/// once somebody pressed the primary and it was refused. `aria-live` so a
/// reader who is told something late hears it.
export function FootNote({
  tone = "mute",
  children,
  className,
}: {
  tone?: "mute" | "warn" | "bad"
  children: React.ReactNode
  className?: string
}) {
  return (
    <p
      role={tone === "bad" ? "alert" : "status"}
      aria-live={tone === "bad" ? "assertive" : "polite"}
      className={cn(
        "text-[0.875rem] leading-5",
        tone === "bad"
          ? "text-bad"
          : tone === "warn"
            ? "text-warn-fg"
            : "text-mute",
        className
      )}
    >
      {children}
    </p>
  )
}
