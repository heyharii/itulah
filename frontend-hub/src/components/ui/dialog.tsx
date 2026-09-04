import { Dialog as BaseDialog } from "@base-ui/react/dialog"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

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
  tone = "dark",
  pending = false,
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
  tone?: "dark" | "danger"
  pending?: boolean
  onConfirm: () => void
}) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-[var(--scrim)]" />
        <BaseDialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[24rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-hairline-2 bg-canvas p-5 shadow-float">
          <BaseDialog.Title className="text-card-title font-semibold text-ink">
            {title}
          </BaseDialog.Title>
          <div className="mt-2 text-[0.8125rem] leading-relaxed text-body">
            {children}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <BaseDialog.Close
              render={<Button variant="ghost">{cancel}</Button>}
            />
            <Button
              variant={tone === "danger" ? "danger" : "dark"}
              disabled={pending}
              onClick={onConfirm}
            >
              {confirm}
            </Button>
          </div>
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
  tone = "dark",
  variant = "ghost",
  disabled = false,
  pending = false,
  onConfirm,
  className,
}: {
  label: React.ReactNode
  title: React.ReactNode
  description: React.ReactNode
  confirmLabel: React.ReactNode
  tone?: "dark" | "danger"
  variant?: "dark" | "ghost" | "soft" | "quiet" | "danger"
  disabled?: boolean
  pending?: boolean
  onConfirm: () => void
  className?: string
}) {
  const [asking, setAsking] = useState(false)
  return (
    <>
      <Button
        variant={variant}
        disabled={disabled}
        className={cn(className)}
        onClick={() => setAsking(true)}
      >
        {label}
      </Button>
      <Dialog
        open={asking}
        onOpenChange={setAsking}
        title={title}
        confirm={confirmLabel}
        tone={tone}
        pending={pending}
        onConfirm={() => {
          setAsking(false)
          onConfirm()
        }}
      >
        {description}
      </Dialog>
    </>
  )
}
