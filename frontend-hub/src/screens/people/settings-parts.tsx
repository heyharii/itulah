import { Button } from "@/components/ui/button"
import { Sheet } from "@/components/ui/sheet"
import { Banner } from "@/components/ui/states"
import { useCanWrite } from "@/lib/session"

/// The sheet every settings page edits in: the form in the body, and in the
/// foot Cancel, Save, and — for a row that already exists — the one
/// destructive act (Retire, Remove) on the left, away from Save.
///
/// A role that may not write sees the facts and a Close.
export function FormSheet({
  open,
  onClose,
  title,
  id,
  error,
  saveLabel = "Save",
  saving,
  canSave,
  onSave,
  danger,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  id?: string
  error?: Error | null
  saveLabel?: string
  saving?: boolean
  canSave?: boolean
  /// Left out for a sheet that only reads and offers its one destructive act.
  onSave?: () => void
  danger?: {
    label: string
    pending: boolean
    disabled?: boolean
    onClick: () => void
  } | null
  children: React.ReactNode
}) {
  const canWrite = useCanWrite()
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      id={id}
      title={title}
      footer={
        <div className="flex items-center gap-2">
          {canWrite && danger && (
            <Button
              variant="danger"
              pending={danger.pending}
              disabled={danger.disabled}
              onClick={danger.onClick}
            >
              {danger.label}
            </Button>
          )}
          <span className="flex-1" />
          <Button variant="quiet" onClick={onClose}>
            {canWrite ? "Cancel" : "Close"}
          </Button>
          {canWrite && onSave && (
            <Button
              variant="primary"
              pending={saving}
              disabled={canSave === false}
              onClick={onSave}
            >
              {saveLabel}
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-3.5">
        {children}
        {error && <Banner tone="bad">{error.message}</Banner>}
      </div>
    </Sheet>
  )
}

/// The first cell of a settings row: a name that opens the row's sheet, with
/// its code under it.
export function NameCell({
  name,
  code,
  onOpen,
}: {
  name: string
  code: string
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      className="text-left hover:underline"
      onClick={onOpen}
    >
      <span className="block text-[0.875rem] text-ink">{name}</span>
      <span className="font-mono text-[0.875rem] text-mute">{code}</span>
    </button>
  )
}
