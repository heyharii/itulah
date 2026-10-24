import { Dialog as BaseDialog } from "@base-ui/react/dialog"
import { Drawer } from "@base-ui/react/drawer"
import { X } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input, Textarea } from "@/components/ui/field"
import { pendingLabel } from "@/components/ui/pending-label"
import { PhoneDrawer } from "@/components/ui/phone-drawer"
import { Banner } from "@/components/ui/states"
import { useLayout } from "@/lib/layout"
import { cn } from "@/lib/utils"
import { saying } from "@/screens/system/units"

/// One line of what the act will do: its name over, its value beside.
export interface StopFact {
  readonly term: string
  readonly value: React.ReactNode
  /// Drawn red: the fact that stands in the act's way.
  readonly bad?: boolean
}

/// The question head office is asked before it stops a till, a person or a
/// store, or removes one (owner, 24 Oct 2026: `ho-stop-access-prototype.html`).
///
/// It is the hub's `Dialog` in everything but its foot: the same card, veil,
/// motion and drawer on a phone, and the same one-write rule (the act waits on
/// the write, and a refusal is said in the dialog). It differs where the
/// prototype does — the way out is the × in the head and there is no Cancel,
/// so the act is the only button and it is solid red; and what the act does is
/// said as facts, label and value, instead of a sentence.
///
/// `reason` asks why, in a box that holds the act back until it is filled.
/// `code` asks the store's own code typed back, which holds it back until it
/// matches (case and spaces aside); `blocked` holds it back for a fact the
/// caller has already drawn in red.
export function StopDialog({
  open,
  onOpenChange,
  title,
  sub,
  facts,
  reason = false,
  code,
  action,
  blocked = false,
  pending = false,
  error,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /// The question: "Stop Till 3?".
  title: React.ReactNode
  /// "Can’t be undone", for what cannot be.
  sub?: React.ReactNode
  facts: readonly StopFact[]
  /// Ask why; handed to `onConfirm`.
  reason?: boolean
  /// Ask this code typed back before the act is let through.
  code?: string
  /// The act's verb, the same one the button that asked says.
  action: string
  blocked?: boolean
  pending?: boolean
  /// The write that failed, said here while the dialog is still open.
  error?: unknown
  onConfirm: (reason: string) => void
}) {
  const [said, setSaid] = useState("")
  const [typed, setTyped] = useState("")
  // A fresh box every time it opens, as `Dialog` does — adjusting state while
  // rendering, so no effect runs a second render to clear the old words.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setSaid("")
      setTyped("")
    }
  }

  const ready =
    !blocked &&
    (!reason || said.trim() !== "") &&
    (code === undefined || typed.trim().toUpperCase() === code.toUpperCase())

  const phone = useLayout() === "phone"
  const Parts: { Title: React.ElementType; Close: React.ElementType } = phone
    ? Drawer
    : BaseDialog

  const body = (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (ready && !pending) onConfirm(said.trim())
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Parts.Title className="text-card-title font-semibold text-ink">
            {title}
          </Parts.Title>
          {sub !== undefined && (
            <p className="mt-0.5 text-[0.9375rem] text-mute">{sub}</p>
          )}
        </div>
        <Parts.Close
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Close"
              className="-mt-1 shrink-0"
            >
              <X />
            </Button>
          }
        />
      </div>

      <dl className="mt-4 divide-y divide-hairline rounded-card border border-hairline">
        {facts.map((fact) => (
          <div
            key={fact.term}
            className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-4 px-4 py-2.5 text-[0.9375rem]"
          >
            <dt className="text-mute">{fact.term}</dt>
            <dd
              className={cn(
                "[overflow-wrap:anywhere]",
                fact.bad === true ? "text-bad-fg" : "text-ink"
              )}
            >
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>

      {reason && (
        <Field label="Reason" required className="mt-5">
          <Textarea
            value={said}
            rows={2}
            autoFocus
            onChange={(event) => setSaid(event.target.value)}
          />
        </Field>
      )}
      {code !== undefined && (
        <Field label={`Type ${code} to remove`} className="mt-5">
          <Input
            value={typed}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setTyped(event.target.value)}
          />
        </Field>
      )}

      {error !== undefined && error !== null && (
        <Banner tone="bad" className="mt-4">
          {saying(error)}
        </Banner>
      )}

      {/* The act alone, at the right; a thumb gets 44px and the whole width. */}
      <div className="mt-6 flex justify-end max-md:[&>*]:h-11 max-md:[&>*]:flex-1">
        <Button
          type="submit"
          variant="destructive"
          pending={pending}
          disabled={!ready}
          className="min-w-40"
        >
          {pending ? pendingLabel(action) : action}
        </Button>
      </div>
    </form>
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
          // Drawn even over a sheet, as the hub's `Dialog` does.
          forceRender
          className="fixed inset-0 z-50 bg-[var(--scrim)] backdrop-blur-[2px] transition-opacity duration-(--t-panel) ease-(--ease-out) data-[ending-style]:opacity-0 data-[starting-style]:opacity-0"
        />
        <BaseDialog.Popup className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[31.25rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-hairline-2 bg-canvas px-7 py-6 shadow-float transition-[opacity,scale] duration-(--t-panel) ease-(--ease-out) data-[ending-style]:scale-[0.96] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0 motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100">
          {body}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}
