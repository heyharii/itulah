import { Dialog as BaseDialog } from "@base-ui/react/dialog"
import { X } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Textarea } from "@/components/ui/field"
import { Problem } from "@/components/ui/states"
import { cn } from "@/lib/utils"

/// A reason the action needs before it can be taken — "why is this order
/// cancelled", "why is this period reopened".
///
/// Written for the question that is otherwise a Sheet of its own with one
/// textarea in it. Required unless `optional` says so: a reason the server
/// records is almost always one it refuses when blank.
export interface Reason {
  readonly label: string
  readonly placeholder?: string
  /// Under the box — where the reason ends up, who reads it.
  readonly hint?: React.ReactNode
  readonly optional?: boolean
}

/// A dialog asks **one question**.
///
/// DESIGN.md specifies it and the hub never needed it: an office screen can
/// put a destructive action behind an undo. A warehouse cannot. Sealing a
/// carton makes its contents final, submitting a count makes a difference a
/// fact, and a truck departing is the one stage change that moves goods in the
/// world. None of the three has an undo anywhere in the server, so each one
/// gets a sentence saying what it will do before it does it.
///
/// It floats on the **white veil** like every other overlay — never a dark
/// dim. Actions sit in the header-right, primary first; there is no footer row
/// of buttons.
export function Dialog({
  open,
  onOpenChange,
  title,
  children,
  confirm,
  cancel = "Cancel",
  tone = "primary",
  pending = false,
  reason,
  problem,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  /// What the action will do, said plainly, in one or two sentences. Not a
  /// warning triangle and not "are you sure" — those say nothing.
  children: React.ReactNode
  confirm: React.ReactNode
  cancel?: React.ReactNode
  /// `danger` for anything that destroys or cannot be walked back.
  tone?: "primary" | "danger"
  pending?: boolean
  /// Ask for a reason under the sentence; it is handed to `onConfirm`.
  reason?: Reason
  /// The write this dialog started, failed — said here, where it was asked
  /// for, while the dialog is still open. Nothing when it is `null`.
  problem?: unknown
  onConfirm: (reason: string) => void
}) {
  const [said, setSaid] = useState("")
  // A fresh box every time it opens — "adjusting state during render", so no
  // effect runs a second render to clear it after the first drew the old one.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setSaid("")
  }
  const missing =
    reason !== undefined && reason.optional !== true && said.trim() === ""

  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-[var(--scrim)] transition-opacity duration-(--t-panel) ease-(--ease-out) data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <BaseDialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[24rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-hairline-2 bg-canvas p-5 shadow-float transition-[opacity,scale] duration-(--t-panel) ease-(--ease-out) data-[ending-style]:scale-[0.96] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0 motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100">
          <BaseDialog.Title className="text-card-title font-semibold text-ink">
            {title}
          </BaseDialog.Title>
          <div className="mt-2 text-[0.875rem] leading-relaxed text-body">
            {children}
          </div>
          {reason !== undefined && (
            <Field
              label={reason.label}
              required={reason.optional !== true}
              hint={reason.hint}
              className="mt-4"
            >
              <Textarea
                value={said}
                rows={3}
                autoFocus
                placeholder={reason.placeholder}
                onChange={(event) => setSaid(event.target.value)}
              />
            </Field>
          )}
          <Problem error={problem ?? null} className="mt-4" />
          <div className="mt-5 flex justify-end gap-2">
            <BaseDialog.Close
              render={<Button variant="ghost">{cancel}</Button>}
            />
            <Button
              variant={tone === "danger" ? "danger" : "primary"}
              pending={pending}
              disabled={missing}
              onClick={() => onConfirm(said.trim())}
            >
              {confirm}
            </Button>
          </div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}

/// A dialog that holds a **working surface** rather than a question.
///
/// The one above asks something and takes two buttons. This one is a place to
/// stand for a minute: the print queue, where somebody chooses a job, looks at
/// the label, sends it and watches it come out. That used to be a screen, and
/// a screen was wrong for it — walking to a second page meant re-choosing the
/// article you were already looking at on the first.
///
/// Wider than a question and scrollable inside itself, so the page behind does
/// not scroll and the panel never grows past the window. Same white veil, same
/// card language, and Escape leaves — an overlay you cannot leave from the
/// keyboard is a trap.
export function Panel({
  open,
  onOpenChange,
  title,
  sub,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  /// One line under the title, saying what the surface is for.
  sub?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-[var(--scrim)] transition-opacity duration-(--t-panel) ease-(--ease-out) data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <BaseDialog.Popup className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-3rem)] w-[52rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card border border-hairline-2 bg-canvas shadow-float transition-[opacity,scale] duration-(--t-panel) ease-(--ease-out) data-[ending-style]:scale-[0.96] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0 motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100">
          <div className="flex items-start gap-3 border-b border-hairline px-5 py-4">
            <div className="min-w-0 flex-1">
              <BaseDialog.Title className="text-card-title font-semibold text-ink">
                {title}
              </BaseDialog.Title>
              {sub !== undefined && (
                <p className="mt-0.5 text-[0.875rem] text-mute">{sub}</p>
              )}
            </div>
            <BaseDialog.Close
              render={
                <Button variant="ghost" size="icon" aria-label="Close">
                  <X />
                </Button>
              }
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}

/// A button that asks before it acts.
///
/// The open/closed state of a confirmation is genuinely transient — nobody
/// links to it, nobody reloads into it, and a half-pressed Seal that survived
/// a refresh would be worse than one that did not. So this is the one place in
/// the app where `useState` holds an overlay, and it is stated here rather
/// than argued about at each call site.
export function ConfirmButton({
  label,
  title,
  description,
  confirmLabel,
  tone = "primary",
  variant = "ghost",
  disabled = false,
  pending = false,
  reason,
  onConfirm,
  className,
}: {
  label: React.ReactNode
  title: React.ReactNode
  description: React.ReactNode
  confirmLabel: React.ReactNode
  tone?: "primary" | "danger"
  variant?: "primary" | "ghost" | "soft" | "quiet" | "danger"
  disabled?: boolean
  pending?: boolean
  reason?: Reason
  /// Return the write's promise — `mutation.mutateAsync(…)` — and the dialog
  /// waits on it: it stays open and pending until it settles, shuts when it
  /// succeeds, and says why when it fails, right under the question. Return
  /// nothing — `mutation.mutate(…)` — and it shuts at once, as it always did,
  /// with the failure left to the screen.
  onConfirm: (reason: string) => void | Promise<unknown>
  className?: string
}) {
  const [asking, setAsking] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [failure, setFailure] = useState<unknown>(null)
  return (
    <>
      {/* The dialog shuts the moment it is confirmed, so the write it
          started is waited on HERE — on the button that asked for it, which
          otherwise sat there looking pressable while the seal went out. */}
      <Button
        variant={variant}
        disabled={disabled}
        pending={pending || waiting}
        className={cn(className)}
        onClick={() => setAsking(true)}
      >
        {label}
      </Button>
      <Dialog
        open={asking}
        onOpenChange={(next) => {
          setAsking(next)
          setFailure(null)
        }}
        title={title}
        confirm={confirmLabel}
        tone={tone}
        pending={pending || waiting}
        reason={reason}
        problem={failure}
        onConfirm={(said) => {
          const result = onConfirm(said)
          if (!(result instanceof Promise)) {
            setAsking(false)
            return
          }
          setWaiting(true)
          setFailure(null)
          void result
            .then(
              () => setAsking(false),
              (error: unknown) => setFailure(error)
            )
            .finally(() => setWaiting(false))
        }}
      >
        {description}
      </Dialog>
    </>
  )
}
