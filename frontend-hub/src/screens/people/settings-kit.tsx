import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

/// The foot of a settings Sheet: Cancel, and the one thing the sheet does.
/// A destructive action, when the record has one, sits at the left.
export function SheetFooter({
  onCancel,
  onSave,
  saveLabel,
  pendingLabel,
  pending,
  disabled,
  danger,
}: {
  onCancel: () => void
  onSave?: () => void
  saveLabel?: string
  pendingLabel?: string
  pending?: boolean
  disabled?: boolean
  danger?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2">
      {danger}
      <span className="flex-1" />
      <Button variant="quiet" onClick={onCancel}>
        {onSave ? "Cancel" : "Close"}
      </Button>
      {onSave && (
        <Button
          variant="primary"
          pending={pending}
          disabled={disabled}
          onClick={onSave}
        >
          {pending ? (pendingLabel ?? "Submitting…") : (saveLabel ?? "Submit")}
        </Button>
      )}
    </div>
  )
}

/// A list's own extra action on a phone, as the text button on the foot of its
/// card — the place a card keeps its Edit or Open — and nowhere on a desk,
/// where the page header carries it. The page's one create action is the
/// round + (`Fab`); the others stand here, under the list they act on.
export function CardFoot({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  /// More buttons of the same kind, standing before this one.
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2 border-t border-hairline px-4 py-3 md:hidden">
      {children}
      <Button variant="tint" size="card" disabled={disabled} onClick={onClick}>
        {label}
      </Button>
    </div>
  )
}

/// A settings page's one change to what is already there ("Edit") on a phone:
/// a full-width button at the foot of the page, where the thumb is, instead
/// of at the top. Not drawn from 48rem up, where the header carries it.
export function PageFoot({
  label,
  onClick,
  disabled,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <div className="mt-4 md:hidden">
      <Button
        variant="primary"
        className="w-full"
        disabled={disabled}
        onClick={onClick}
      >
        {label}
      </Button>
    </div>
  )
}

/// A list on a page: a card whose body is a table. With a `title` it is one of
/// several lists on the same page; without, the page itself is the heading.
/// `foot` is the list's own phone-only action (`CardFoot`).
export function ListCard({
  title,
  aside,
  children,
  className,
  foot,
}: {
  title?: React.ReactNode
  aside?: React.ReactNode
  children: React.ReactNode
  className?: string
  foot?: React.ReactNode
}) {
  return (
    <Card className={cn("mb-4 overflow-hidden", className)}>
      {title !== undefined && (
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {aside}
        </CardHeader>
      )}
      <div
        className={cn(
          "overflow-x-auto px-4 pb-3",
          title === undefined && "pt-3"
        )}
      >
        {children}
      </div>
      {foot}
    </Card>
  )
}

/// The cell that opens a row's sheet. A `<tr>` cannot be a button, so the name
/// in the first cell is.
export function RowOpen({
  onClick,
  children,
}: {
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left font-medium text-ink hover:underline"
    >
      {children}
    </button>
  )
}
