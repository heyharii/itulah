import { fileKind } from "@/lib/files"
import { formatBytes } from "@/lib/collaboration"
import { cn } from "@/lib/utils"
import type { StoredFile } from "@itulah/contract"
import { FileWarning } from "lucide-react"

/// One attached file.
///
/// `available` is drawn, not hidden. The row survives its bucket losing the
/// object, and a file that cannot be fetched is shown as exactly that rather
/// than as a link that answers 404 — which is the version somebody wastes ten
/// minutes on before deciding the whole screen is broken.
///
/// The hash is beside the name because two people uploading the same invoice
/// produce two rows and one hash, and this is where a person notices.
export function Attachment({
  file,
  href,
  className,
}: {
  file: StoredFile
  href: string
  className?: string
}) {
  const shell = cn(
    "flex max-w-80 items-center gap-2.5 rounded-lg border bg-muted/40 px-2.5 py-2 text-left",
    className,
  )
  const inside = (
    <>
      <span
        aria-hidden
        className={cn(
          "bg-card text-muted-foreground grid size-8 shrink-0 place-items-center rounded-md font-mono text-[9px] font-medium",
          !file.available && "text-destructive",
        )}
      >
        {file.available ? fileKind(file.file_name) : <FileWarning className="size-3.5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{file.file_name}</span>
        <span className="text-muted-foreground block truncate font-mono text-[10px]">
          {formatBytes(file.byte_size)}
          {file.available
            ? ` · ${file.sha256.slice(0, 8)}`
            : " · attached, but not retrievable"}
        </span>
      </span>
    </>
  )

  if (!file.available) {
    return (
      <span className={cn(shell, "opacity-70")} title="The bytes could not be reached.">
        {inside}
      </span>
    )
  }
  return (
    <a href={href} className={cn(shell, "hover:bg-muted transition-colors")}>
      {inside}
    </a>
  )
}
