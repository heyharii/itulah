import { Dialog } from "@base-ui/react/dialog"
import { X } from "lucide-react"

import { Activity } from "@/components/ui/activity"
import { cn } from "@/lib/utils"

/// The detail rail — a floating panel, never a flush column.
///
/// It sits inset 16px from the top, right and bottom of the shell with
/// `{r.shell}` corners and the float shadow, so it reads as a sheet lifted
/// above the list, the way cards float on the well. A `border-left` on a
/// square-cornered full-height column is the deprecated shape.
///
/// It sits on the WHITE veil: the list behind washes toward near-white and
/// never darkens.
export function Sheet({
  open,
  onOpenChange,
  title,
  id,
  actions,
  subject,
  footer,
  children,
  className,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  /// The record's own identifier, set in mono above the title.
  id?: React.ReactNode
  /// At most two, plus an overflow — pinned in the header, not at the foot.
  actions?: React.ReactNode
  /// The record this sheet is showing, so its history can be read here.
  ///
  /// Declared on the shell rather than pasted into thirty sheets: every record
  /// has a history and every sheet should be able to show it, and the version
  /// where each screen remembers to add it is the version where a third of
  /// them do not.
  subject?: { kind: string; id: string }
  /// The composer, when the record takes one.
  footer?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-[var(--scrim)]" />
        <Dialog.Popup
          className={cn(
            "fixed top-4 right-4 bottom-4 z-40 flex w-[27.5rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-shell border border-hairline bg-canvas shadow-float",
            className
          )}
        >
          <div className="flex shrink-0 items-start gap-2.5 border-b border-hairline px-5 py-[0.875rem]">
            <div className="min-w-0 flex-1">
              {id && (
                <div className="mb-0.5 font-mono text-id text-body">{id}</div>
              )}
              <Dialog.Title className="truncate text-card-title font-semibold text-ink">
                {title}
              </Dialog.Title>
            </div>
            {actions}
            <Dialog.Close className="grid size-7 shrink-0 place-items-center rounded-inner text-line-ico transition-colors hover:bg-soft-2 hover:text-ink">
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-[1.125rem]">
            {children}
            {subject && <Activity subject={subject} />}
          </div>
          {footer && (
            <div className="shrink-0 border-t border-hairline px-5 py-3">
              {footer}
            </div>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/// The two-column fact grid a record detail leads with: mono micro-cap term,
/// tabular value.
export function Facts({
  className,
  ...props
}: React.HTMLAttributes<HTMLDListElement>) {
  return (
    <dl
      className={cn("grid grid-cols-2 gap-x-4 gap-y-3", className)}
      {...props}
    />
  )
}

export function Fact({
  term,
  children,
}: {
  term: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[0.625rem] tracking-[0.04em] text-faint uppercase">
        {term}
      </dt>
      <dd className="mt-1 truncate text-[0.8125rem] text-ink tabular-nums">
        {children}
      </dd>
    </div>
  )
}
