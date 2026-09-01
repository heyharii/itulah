import { Button } from "@/components/ui/button"
import { formatBytes } from "@/lib/collaboration"
import { fileKind } from "@/lib/files"
import type { Staged } from "@/lib/uploads"
import { cn } from "@/lib/utils"
import { Loader2, Paperclip, X } from "lucide-react"
import { useRef } from "react"

/// What has been picked, and how far it has got.
///
/// There is no progress bar, deliberately. `fetch` reports nothing about how
/// much of a body has gone out, and a bar filling on a timer is a picture of a
/// guess. This says "uploading" until the file is there, and then says how big
/// it turned out to be and what its hash is.
export function StagedFiles({
  staged,
  onRemove,
  className,
}: {
  staged: Staged[]
  onRemove: (key: string) => void
  className?: string
}) {
  if (staged.length === 0) return null
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {staged.map((item) => (
        <span
          key={item.key}
          className="bg-card flex max-w-64 items-center gap-2 rounded-lg border px-2 py-1.5"
        >
          <span
            aria-hidden
            className="bg-muted text-muted-foreground grid size-6 shrink-0 place-items-center rounded font-mono text-[8px] font-medium"
          >
            {item.stored === null && item.error === null ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              fileKind(item.name)
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[11px] font-medium">{item.name}</span>
            <span
              className={cn(
                "text-muted-foreground block truncate font-mono text-[10px]",
                item.error !== null && "text-destructive",
              )}
            >
              {item.error !== null
                ? item.error
                : item.stored === null
                  ? "uploading…"
                  : `${formatBytes(item.stored.byte_size)} · ${item.stored.sha256.slice(0, 8)}`}
            </span>
          </span>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Remove ${item.name}`}
            onClick={() => onRemove(item.key)}
          >
            <X />
          </Button>
        </span>
      ))}
    </div>
  )
}

/// The button, and the hidden input it stands in for.
export function AttachButton({
  onFiles,
  disabled,
  label = "Attach",
}: {
  onFiles: (files: FileList) => void
  disabled?: boolean
  label?: string
}) {
  const picker = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={picker}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files !== null) onFiles(event.target.files)
          event.target.value = ""
        }}
      />
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled}
        onClick={() => picker.current?.click()}
      >
        <Paperclip className="size-3.5" />
        {label}
      </Button>
    </>
  )
}
