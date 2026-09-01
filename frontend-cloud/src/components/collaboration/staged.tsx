import { Button } from "@/components/ui/button"
import { formatBytes } from "@/lib/collaboration"
import { fileKind, uploadFile } from "@/lib/files"
import { cn } from "@/lib/utils"
import { ApiError } from "@itulah/contract/client"
import type { StoredFile } from "@itulah/contract"
import { Loader2, Paperclip, X } from "lucide-react"
import { useMemo, useRef, useState } from "react"

/// A file picked but not yet attached to anything.
export interface Staged {
  readonly key: string
  readonly name: string
  readonly size: number
  /// The row the server wrote, once the bytes have landed. A message attaches
  /// a `file_id`, so an upload still in flight has nothing to attach yet.
  readonly stored: StoredFile | null
  readonly error: string | null
}

/// Picking files, uploading them, and knowing which are ready to be named.
///
/// Upload is its own step because the server made it one: `POST /api/v1/files`
/// answers with a `file_id` and the message merely names it. A photograph
/// therefore finishes uploading while the sentence is still being typed, a
/// slow attachment never blocks a send, and a send that fails does not lose
/// the upload.
///
/// Shared by the conversation composer and the discussion reply box. They look
/// different — one sends on Enter, the other on a button — but this part is the
/// same, and two copies of it would drift the first time one grew a fix.
export function useStagedUploads() {
  const [staged, setStaged] = useState<Staged[]>([])

  const stage = (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const key = `${file.name}-${file.size}-${Math.random().toString(16).slice(2, 8)}`
      setStaged((current) => [
        ...current,
        { key, name: file.name, size: file.size, stored: null, error: null },
      ])
      void uploadFile(file)
        .then((stored) => {
          setStaged((current) =>
            current.map((item) => (item.key === key ? { ...item, stored } : item)),
          )
        })
        .catch((error: unknown) => {
          setStaged((current) =>
            current.map((item) =>
              item.key === key
                ? {
                    ...item,
                    error: error instanceof ApiError ? error.message : "the upload failed",
                  }
                : item,
            ),
          )
        })
    }
  }

  const ready = useMemo(
    () =>
      staged
        .map((item) => item.stored)
        .filter((stored): stored is StoredFile => stored !== null),
    [staged],
  )

  return {
    staged,
    ready,
    /// True while bytes are still going out, so a screen can say so rather
    /// than looking idle.
    waiting: staged.some((item) => item.stored === null && item.error === null),
    stage,
    remove: (key: string) =>
      setStaged((current) => current.filter((item) => item.key !== key)),
    /// Drop what was just attached, and keep what is still uploading: those
    /// bytes belong to the next message, and discarding them would throw away
    /// a wait somebody has already sat through.
    takeReady: () => setStaged((current) => current.filter((item) => item.stored === null)),
  }
}

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
                  ? // No percentage. `fetch` reports nothing about how much of
                    // a body has gone out, and a bar filling on a timer is a
                    // picture of a guess.
                    "uploading…"
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
