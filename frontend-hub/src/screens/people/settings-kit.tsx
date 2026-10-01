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
          {pending ? (pendingLabel ?? "Saving…") : (saveLabel ?? "Save")}
        </Button>
      )}
    </div>
  )
}

/// A list on a page: a card whose body is a table. With a `title` it is one of
/// several lists on the same page; without, the page itself is the heading.
export function ListCard({
  title,
  aside,
  children,
  className,
}: {
  title?: React.ReactNode
  aside?: React.ReactNode
  children: React.ReactNode
  className?: string
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
