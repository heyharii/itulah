import { Dialog } from "@base-ui/react/dialog"
import { X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/// The sheet a People row opens into, and the one a "record" button opens.
///
/// The prototype puts every detail and every form in a sheet
/// (`prototypes/hr-v3/hr.html`, `sheet()`): a crumb, a title, a line under it,
/// the sections, and the decision pinned at the foot where it stays visible
/// however long the body is. This is that sheet, on Base UI's dialog so that
/// focus is trapped, Escape leaves, and the page behind does not scroll.
///
/// On a desk it stands at the right edge, full height, the width of a record.
/// On a phone it rises from the bottom and stops short of the top, so the
/// screen it came from is still visibly there behind it.
///
/// The veil is WHITE, as every overlay in this language is — a dark dim is the
/// single most recognisable way a screen stops being the hub.
export function PeopleSheet({
  open,
  onOpenChange,
  crumb,
  title,
  sub,
  status,
  foot,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /// What kind of record this is — "Leave", "Claim · CL-0042".
  crumb?: React.ReactNode
  title: React.ReactNode
  sub?: React.ReactNode
  /// Pills under the title.
  status?: React.ReactNode
  /// The decision, pinned under the body. Buttons, usually two.
  foot?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-[var(--scrim)] transition-opacity duration-(--t-panel) ease-(--ease-out) data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup
          className={cn(
            "fixed z-50 flex flex-col border-hairline-2 bg-canvas shadow-float outline-none",
            "transition-[opacity,translate] duration-(--t-sheet) ease-(--ease-out) data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
            // Phone: from the bottom.
            "inset-x-0 bottom-0 max-h-[calc(100dvh-3rem)] rounded-t-sheet border-t data-[ending-style]:translate-y-6 data-[starting-style]:translate-y-6",
            // Desk: from the right, full height.
            "md:inset-x-auto md:top-0 md:right-0 md:bottom-0 md:max-h-none md:w-[32rem] md:max-w-[calc(100vw-2rem)] md:rounded-none md:border-t-0 md:border-l md:data-[ending-style]:translate-x-6 md:data-[ending-style]:translate-y-0 md:data-[starting-style]:translate-x-6 md:data-[starting-style]:translate-y-0",
            "motion-reduce:transition-opacity",
          )}
        >
          <div className="flex items-start gap-3 border-b border-hairline px-5 pt-4 pb-3.5">
            <div className="min-w-0 flex-1">
              {crumb !== undefined && (
                <div className="mb-1 text-[0.75rem] font-medium text-mute">
                  {crumb}
                </div>
              )}
              <Dialog.Title className="text-title font-semibold text-ink">
                {title}
              </Dialog.Title>
              {sub !== undefined && (
                <p className="mt-0.5 text-meta text-body">{sub}</p>
              )}
              {status !== undefined && (
                <div className="mt-2 flex flex-wrap gap-1.5">{status}</div>
              )}
            </div>
            <Dialog.Close
              render={
                <Button variant="quiet" size="icon" aria-label="Close">
                  <X />
                </Button>
              }
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {children}
          </div>
          {foot !== undefined && (
            <div className="pb-safe border-t border-hairline px-5 pt-3">
              <div className="pb-3">{foot}</div>
            </div>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/// A titled block inside a sheet — the prototype's `.sec` with its `h3`.
/// Micro-caps here are right: they label a block, not a column, and there is
/// no data at the same size to confuse them with.
export function SheetSection({
  title,
  children,
  className,
}: {
  title: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("mb-5 last:mb-0", className)}>
      <h3 className="mb-2 text-eyebrow font-semibold tracking-[0.04em] text-mute uppercase">
        {title}
      </h3>
      {children}
    </section>
  )
}
