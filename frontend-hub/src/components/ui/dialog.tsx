import { Dialog as BaseDialog } from "@base-ui/react/dialog"
import { Drawer } from "@base-ui/react/drawer"
import { Check, X } from "lucide-react"
import { useEffect, useEffectEvent, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Textarea } from "@/components/ui/field"
import { PhoneDrawer } from "@/components/ui/phone-drawer"
import { Problem } from "@/components/ui/states"
import { useLayout } from "@/lib/layout"
import { cn } from "@/lib/utils"

/// A reason the action needs before it can be taken — "why is this order
/// cancelled", "why is this period reopened".
///
/// Written for the question that is otherwise a Sheet of its own with one
/// textarea in it. Required unless `optional` says so: a reason the server
/// records is almost always one it refuses when blank.
export interface Reason {
  readonly label: string
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

  // A phone asks the question in a sheet from the bottom, not a card in the
  // middle (`PhoneDrawer`); the parts are the same, so one body serves both.
  const phone = useLayout() === "phone"
  const Parts: { Title: React.ElementType; Close: React.ElementType } = phone
    ? Drawer
    : BaseDialog

  const body = (
    <>
      <Parts.Title className="text-card-title font-semibold text-ink">
        {title}
      </Parts.Title>
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
            onChange={(event) => setSaid(event.target.value)}
          />
        </Field>
      )}
      <Problem error={problem ?? null} className="mt-4" />
      <div className="mt-5 flex justify-end gap-2 max-md:flex-col-reverse max-md:[&>*]:w-full">
        <Parts.Close render={<Button variant="ghost">{cancel}</Button>} />
        <Button
          variant={tone === "danger" ? "danger" : "primary"}
          pending={pending}
          disabled={missing}
          onClick={() => onConfirm(said.trim())}
        >
          {confirm}
        </Button>
      </div>
    </>
  )

  if (phone) {
    return (
      <PhoneDrawer open={open} onOpenChange={onOpenChange}>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-5">
          {body}
        </div>
      </PhoneDrawer>
    )
  }

  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop
          // Drawn even when this dialog opens on top of a sheet: Base UI skips
          // a nested dialog's backdrop by default, which left the sheet behind
          // a confirmation sharp and clickable-looking.
          forceRender
          className="fixed inset-0 z-50 bg-[var(--scrim)] backdrop-blur-[2px] transition-opacity duration-(--t-panel) ease-(--ease-out) data-[ending-style]:opacity-0 data-[starting-style]:opacity-0"
        />
        <BaseDialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[24rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-hairline-2 bg-canvas p-5 shadow-float transition-[opacity,scale] duration-(--t-panel) ease-(--ease-out) data-[ending-style]:scale-[0.96] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0 motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100">
          {body}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}

/// How long a receipt stays on the glass before it lets itself go.
const SAVED_MS = 3000

/// Longer when the receipt carries a way to take the save back: a button to
/// press is not read and decided on in three seconds.
const UNDO_MS = 5000

/// A save that landed, said in the middle of the screen, and then gone.
///
/// The receipt for the writes that mint an identity — an order's PO number, a
/// supplier's code (the owner, 2026-10-04: "dibikin dialog tengah saja,
/// dialog kecil"). A corner toast used to say the number once and take it
/// back after five seconds; the number is the one fact somebody walks across
/// the office with, so it is set large, in the middle, where the eyes are.
///
/// It asks nothing and has no button: it closes itself after three seconds
/// (the owner, 2026-10-04 — "ga harus ada okenya"), and a bar under the number
/// empties so the wait can be seen. Resting the pointer on it holds the count
/// for somebody copying the number down, and Escape still works — an overlay
/// you cannot leave from the keyboard is a trap.
export function SavedDialog({
  open,
  onOpenChange,
  title,
  children,
  action,
  undo,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /// The receipt itself — "PO-021026-001 created", "0002 saved".
  title: React.ReactNode
  /// One line under it, where the caller has something to add — the total,
  /// what to do next.
  children?: React.ReactNode
  /// A verb under the receipt, when it opens a next step — "View rollout" on a
  /// published price change. The dialog waits while the pointer is on it, and
  /// the verb does not have to close anything, because a navigation takes the
  /// dialog with its screen.
  action?: {
    readonly label: React.ReactNode
    onClick: () => void
  }
  /// A way to take the save back while the dialog is still up — red, and its
  /// fill empties with the time left, like a ride that can still be called
  /// off. The dialog waits while the pointer is on it, and closes once the
  /// call has been made.
  undo?: {
    readonly label: React.ReactNode
    readonly onClick: () => Promise<unknown> | void
  }
}) {
  const duration = undo === undefined ? SAVED_MS : UNDO_MS
  const [undoing, setUndoing] = useState(false)
  const phone = useLayout() === "phone"
  const Title: React.ElementType = phone ? Drawer.Title : BaseDialog.Title
  const [held, setHeld] = useState(false)
  const letGo = useEffectEvent(() => onOpenChange(false))
  const left = useRef<number | null>(null)
  useEffect(() => {
    if (!open) {
      left.current = null
      setUndoing(false)
      return
    }
    if (held) return
    // Set when it opens, not when it closes: whether the receipt carries an
    // undo is only known once there is a receipt.
    const remaining = left.current ?? duration
    const started = performance.now()
    const timer = window.setTimeout(letGo, remaining)
    return () => {
      window.clearTimeout(timer)
      left.current = Math.max(0, remaining - (performance.now() - started))
    }
  }, [open, held, duration])

  const body = (
    <div
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      className="flex flex-col items-center gap-4 px-2 pt-2 pb-1 text-center"
    >
      <span className="grid size-14 place-items-center rounded-full bg-ok-bg text-ok-fg">
        <Check className="size-7" strokeWidth={2.25} aria-hidden />
      </span>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Title className="text-[1.5rem] leading-tight font-semibold tracking-tight text-ink tabular-nums">
          {title}
        </Title>
        {children !== undefined && children !== null && children !== false && (
          <div className="text-[1rem] leading-relaxed text-body tabular-nums">
            {children}
          </div>
        )}
      </div>
      {action !== undefined && (
        <Button variant="ghost" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
      {undo !== undefined ? (
        <Button
          variant="danger"
          size="lg"
          disabled={undoing}
          onClick={() => {
            setUndoing(true)
            void Promise.resolve(undo.onClick())
              .then(() => onOpenChange(false))
              .catch(() => setUndoing(false))
          }}
          className="relative mt-1 w-full max-w-64 overflow-hidden"
        >
          <span
            aria-hidden
            className="countdown-bar absolute inset-0 bg-bad-fg/15 motion-reduce:hidden"
            style={{
              animationDuration: `${duration}ms`,
              animationPlayState: held || undoing ? "paused" : "running",
            }}
          />
          <span className="relative">
            {undoing ? "Cancelling…" : undo.label}
          </span>
        </Button>
      ) : (
        // The wait, drawn. Gone under reduced motion, where the dialog still
        // closes by itself.
        <span
          aria-hidden
          className="mt-1 h-1 w-28 overflow-hidden rounded-full bg-soft-2 motion-reduce:hidden"
        >
          <span
            className="countdown-bar block h-full rounded-full bg-ok-fg/50"
            style={{
              animationDuration: `${SAVED_MS}ms`,
              animationPlayState: held ? "paused" : "running",
            }}
          />
        </span>
      )}
    </div>
  )

  if (phone) {
    return (
      <PhoneDrawer open={open} onOpenChange={onOpenChange}>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-5 pb-7">
          {body}
        </div>
      </PhoneDrawer>
    )
  }

  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop
          // Drawn even when this dialog opens on top of a sheet: Base UI skips
          // a nested dialog's backdrop by default, which left the sheet behind
          // a confirmation sharp and clickable-looking.
          forceRender
          className="fixed inset-0 z-50 bg-[var(--scrim)] backdrop-blur-[2px] transition-opacity duration-(--t-panel) ease-(--ease-out) data-[ending-style]:opacity-0 data-[starting-style]:opacity-0"
        />
        <BaseDialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[26rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-hairline-2 bg-canvas p-7 shadow-float transition-[opacity,scale] duration-(--t-panel) ease-(--ease-out) data-[ending-style]:scale-[0.96] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0 motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100">
          {body}
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
  actions,
  wide = false,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  /// One line under the title, saying what the surface is for.
  sub?: React.ReactNode
  /// In the header, before the close button — a Back, a verb.
  actions?: React.ReactNode
  /// A board rather than a list: about 72rem instead of 52rem.
  wide?: boolean
  children: React.ReactNode
}) {
  const phone = useLayout() === "phone"
  const Parts: { Title: React.ElementType; Close: React.ElementType } = phone
    ? Drawer
    : BaseDialog

  const head = (
    <div className="flex items-start gap-3 border-b border-hairline px-5 py-4">
      <div className="min-w-0 flex-1">
        <Parts.Title className="text-card-title font-semibold text-ink">
          {title}
        </Parts.Title>
        {sub !== undefined && (
          <p className="mt-0.5 text-[0.875rem] text-mute">{sub}</p>
        )}
      </div>
      {actions}
      <Parts.Close
        render={
          <Button variant="ghost" size="icon" aria-label="Close">
            <X />
          </Button>
        }
      />
    </div>
  )

  if (phone) {
    return (
      <PhoneDrawer open={open} onOpenChange={onOpenChange} tall>
        {head}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </PhoneDrawer>
    )
  }

  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop
          // Drawn even when this dialog opens on top of a sheet: Base UI skips
          // a nested dialog's backdrop by default, which left the sheet behind
          // a confirmation sharp and clickable-looking.
          forceRender
          className="fixed inset-0 z-50 bg-[var(--scrim)] backdrop-blur-[2px] transition-opacity duration-(--t-panel) ease-(--ease-out) data-[ending-style]:opacity-0 data-[starting-style]:opacity-0"
        />
        <BaseDialog.Popup
          className={cn(
            wide ? "w-[72rem]" : "w-[52rem]",
            "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-3rem)] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card border border-hairline-2 bg-canvas shadow-float transition-[opacity,scale] duration-(--t-panel) ease-(--ease-out) data-[ending-style]:scale-[0.96] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0 motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100"
          )}
        >
          {head}
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
  cancelLabel,
  tone = "primary",
  variant = "ghost",
  size,
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
  /// The way out; "Cancel" unless that would read like the action itself.
  cancelLabel?: React.ReactNode
  tone?: "primary" | "danger"
  variant?: "primary" | "ghost" | "soft" | "quiet" | "danger"
  /// `sm` for a verb at the end of a table row, beside its neighbours'.
  size?: "default" | "sm"
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
        size={size}
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
        cancel={cancelLabel}
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
