import { Dialog as BaseDialog } from "@base-ui/react/dialog"
import { Drawer } from "@base-ui/react/drawer"
import { X } from "lucide-react"
import { useEffect, useEffectEvent, useState } from "react"

import { Button } from "@/components/ui/button"
import { type ButtonStyle } from "@/components/ui/button-style"
import { Field, Textarea } from "@/components/ui/field"
import { pendingLabel } from "@/components/ui/pending-label"
import { PhoneDrawer } from "@/components/ui/phone-drawer"
import { Problem } from "@/components/ui/states"
import { useLayout } from "@/lib/layout"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"

/// A reason the action needs before it can be taken — "why is this order
/// cancelled", "why is this period reopened".
///
/// Written for the question that is otherwise a Sheet of its own with one
/// textarea in it. Required unless `optional` says so: a reason the server
/// records is almost always one it refuses when blank.
export interface Reason {
  /// "Reason" unless the question needs another word — one label everywhere
  /// (the 6 Oct 2026 audit found "Why", "Reason", "Reason for Closing").
  readonly label?: string
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
/// dim. Its foot is the sheet foot's: `[Cancel, quiet] [the act's verb]`, side
/// by side on every width (44px each on a phone), destructive acts in the
/// danger style, and the verb says what it is doing while the write is on its
/// way ("Voiding sale…").
///
/// The title is a question in sentence case ("Void this sale?"), the confirm is
/// the same verb as the button that asked, the cancel is "Cancel" — unless the
/// answer would be read as the act itself ("Keep editing").
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
  ready = true,
  size = "default",
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  /// `wide`: a 900px card whose body scrolls under a pinned foot — only for
  /// a question whose answer must show, in lines, what it will do (Return &
  /// reallot, owner 18 Oct 2026). Everything else is the 384px card.
  size?: "default" | "wide"
  /// What the action will do, said plainly, in one or two sentences. Not a
  /// warning triangle and not "are you sure" — those say nothing. Left out
  /// when the title already says it all.
  children?: React.ReactNode
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
  /// `false` holds the confirm back until the body has what it needs (a
  /// photo, a choice) — as a missing reason does.
  ready?: boolean
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
      {children !== undefined && children !== null && children !== false && (
        <div className="mt-2 text-[0.9375rem] leading-relaxed text-body">
          {children}
        </div>
      )}
      {reason !== undefined && (
        <Field
          label={reason.label ?? "Reason"}
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
      {/* Side by side on every width, Cancel quiet and the act last — the
          sheet foot's own order. A thumb gets 44px, the desk 36. */}
      <div
        className={cn(
          "mt-5 flex justify-end gap-2 max-md:[&>*]:h-11 max-md:[&>*]:flex-1",
          size === "wide" &&
            "sticky bottom-[-1.25rem] -mx-5 -mb-5 border-t border-hairline bg-canvas px-5 py-3"
        )}
      >
        {/* Beside a red, irreversible act the way out is the blue one, so
            the two never wear the same red (owner, 2026-10-16). */}
        <Parts.Close
          render={
            <Button variant={tone === "danger" ? "primary" : "quiet"}>
              {cancel}
            </Button>
          }
        />
        <Button
          variant={tone === "danger" ? "danger" : "primary"}
          pending={pending}
          disabled={missing || !ready}
          onClick={() => onConfirm(said.trim())}
        >
          {pending ? pendingLabel(confirm) : confirm}
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
        <BaseDialog.Popup
          className={cn(
            "fixed top-1/2 left-1/2 z-50 w-[24rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-hairline-2 bg-canvas p-5 shadow-float transition-[opacity,scale] duration-(--t-panel) ease-(--ease-out) data-[ending-style]:scale-[0.96] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0 motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100",
            size === "wide" &&
              "max-h-[calc(100vh-4rem)] w-[56.25rem] overflow-y-auto"
          )}
        >
          {body}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}

/// A save that landed, said in the bottom-right corner, and then gone.
///
/// It used to be a dialog in the middle of the screen (the owner,
/// 2026-10-04); since 2026-10-17 every save answers the same way a PO does —
/// a toast at the bottom right (`<Toasts>`), so the reader learns one place.
/// The name and the props stay, so no screen had to change: opening it raises
/// the toast and hands `open` straight back.
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
  /// A verb on the toast, when it opens a next step — "View rollout" on a
  /// published price change.
  action?: {
    readonly label: React.ReactNode
    onClick: () => void
  }
  /// A way to take the save back while the toast is still up.
  undo?: {
    readonly label: React.ReactNode
    readonly onClick: () => Promise<unknown> | void
  }
}) {
  const say = useEffectEvent(() => {
    const said =
      children === undefined || children === null || children === false
        ? undefined
        : children
    toast.success(title, {
      description: said,
      action:
        undo !== undefined
          ? { label: undo.label, onClick: () => void undo.onClick() }
          : action !== undefined
            ? { label: action.label, onClick: action.onClick }
            : undefined,
    })
    onOpenChange(false)
  })
  useEffect(() => {
    if (open) say()
  }, [open])
  return null
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
          <p className="mt-0.5 text-[0.9375rem] text-mute">{sub}</p>
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
            "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-3rem)] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card border border-hairline-2 bg-canvas shadow-float transition-[opacity,scale] duration-(--t-panel) ease-(--ease-out) data-[ending-style]:scale-[0.96] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0 motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100"
          )}
        >
          {head}
          <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}

/// A button that asks before it acts — the ONE confirmation for anything that
/// cannot be walked back (void a sale, reverse an entry, block a sign-in, close
/// a period). Six screens had built their own: a different casing, different
/// button words, and some of them no question at all.
///
///  - The question is a sentence-case title ("Void this sale?"), under it one
///    short line saying what happens; the buttons are "Cancel" and the act's
///    verb — the same words as the button that asked (`confirmLabel` defaults
///    to `label`).
///  - `tone="danger"` is for the irreversible, and it dresses the trigger the
///    same way (the `danger` variant) unless a `variant` is given: the button
///    that starts something permanent never looks like one that does not.
///  - It waits on the write (return the mutation's promise): the dialog stays
///    open and pending until it settles, shuts when it succeeds, and says why
///    when it fails, right under the question. A phone gets the question as a
///    drawer from the bottom, the foot's buttons 44px.
///  - `variant` and `size` take every look the Button has, so the same
///    confirmation serves a sheet's foot (`default`), a table row (`sm`) and a
///    record card (`tint` + `card`).
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
  variant,
  size,
  disabled = false,
  pending = false,
  reason,
  onConfirm,
  className,
}: {
  label: React.ReactNode
  /// The question, in sentence case: "Void this sale?".
  title: React.ReactNode
  /// What happens, in a line or two. Left out when the title says it all.
  description?: React.ReactNode
  /// The act's verb — the button's own label unless it needs saying more
  /// fully ("Void sale" under a trigger that says "Void").
  confirmLabel?: React.ReactNode
  /// The way out; "Cancel" unless that would read like the action itself.
  cancelLabel?: React.ReactNode
  /// `danger` for anything that destroys or cannot be walked back.
  tone?: "primary" | "danger"
  /// The trigger's look. Ghost for an ordinary act, `danger` when `tone` is.
  variant?: ButtonStyle["variant"]
  /// `sm` for a verb at the end of a table row, `card` + `tint` on a record
  /// card, the default in a sheet's foot.
  size?: ButtonStyle["size"]
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
        variant={variant ?? (tone === "danger" ? "danger" : "ghost")}
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
        confirm={confirmLabel ?? label}
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
