import { Sheet } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

/// The sheet a People row opens into — now the kit's `Sheet`
/// (`components/ui/sheet.tsx`), the hub's record anatomy, behind the props the
/// People screens were written with.
///
///   id      mono, above the title: the business number a person says aloud
///           (`HO-0006`, a leave request's number). Left out when there is none.
///   title   the record's own name — a person's FULL name, never their login.
///   status  the ONE badge in the head (a `Pill`), the record's state.
///   crumb   what KIND of record this is ("Leave", "Shift swap"), then `sub`
///           (the place, the date) — both end up in the caption under the title,
///           joined with a dot.
///   foot    the record's actions, pinned: on every width. A decision is
///           `[Reject] [Approve]` (`useDecision` in `screens/hr/parts.tsx`), a
///           form is `[Cancel] [Save]`; wrap them in `<SheetFoot>`.
///   tabs    optional sections (they wrap on a phone, never scroll sideways).
///
/// The audit's anatomy (REPORT §2), in one place: head never holds actions,
/// the foot is their only home, facts read as label over value.
export function PeopleSheet({
  open,
  onOpenChange,
  id,
  crumb,
  title,
  sub,
  status,
  foot,
  tabs,
  width,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  id?: React.ReactNode
  crumb?: React.ReactNode
  title: React.ReactNode
  sub?: React.ReactNode
  /// The one status badge: a `Pill`.
  status?: React.ReactNode
  foot?: React.ReactNode
  tabs?: React.ComponentProps<typeof Sheet>["tabs"]
  /// `wide` for a form somebody writes a sentence into.
  width?: "rail" | "wide"
  children?: React.ReactNode
}) {
  const hasCrumb = crumb !== undefined && crumb !== null && crumb !== ""
  const hasSub = sub !== undefined && sub !== null && sub !== ""
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      id={id}
      title={title}
      badge={status}
      caption={
        hasCrumb || hasSub ? (
          <>
            {crumb}
            {hasCrumb && hasSub ? " · " : ""}
            {sub}
          </>
        ) : undefined
      }
      footer={foot}
      tabs={tabs}
      width={width}
    >
      {children}
    </Sheet>
  )
}

/// The sheet's foot row: buttons side by side, right-aligned — the hub's
/// `flex justify-end gap-2`. A decision is `[Reject][Approve]`, a form
/// `[Cancel][Save]`: the destructive one on the left, the one filled button on
/// the right.
export function SheetFoot({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn("flex flex-wrap items-center justify-end gap-2", className)}
    >
      {children}
    </div>
  )
}

/// A titled block inside a sheet — the audit's SubHead: 15px medium, the
/// count (or any aside) beside it; blocks are spaced by the sheet's own gap.
export function SheetSection({
  title,
  aside,
  children,
  className,
}: {
  title: React.ReactNode
  aside?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("mb-6 last:mb-0", className)}>
      <h3 className="mb-3 flex items-baseline gap-2 text-[0.9375rem] font-medium text-ink">
        {title}
        {aside !== undefined && (
          <span className="text-[0.875rem] font-normal text-mute tabular-nums">
            {aside}
          </span>
        )}
      </h3>
      {children}
    </section>
  )
}
