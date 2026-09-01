import {
  AttachButton,
  StagedFiles,
  useStagedUploads,
} from "@/components/collaboration/staged"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { StoredFile } from "@itulah/contract"
import { Send } from "lucide-react"
import { useState } from "react"

/// Writing a message, and attaching things to it.
///
/// A message may be words, or a file, or both — the schema allows an empty body
/// on purpose, because a message that is only a photograph has nothing to say
/// in words. So Send is live as soon as either exists, and dead when neither
/// does.
export function Composer({
  disabled,
  onSend,
}: {
  disabled?: boolean
  onSend: (input: { body: string; attachments: StoredFile[] }) => void
}) {
  const [body, setBody] = useState("")
  const [over, setOver] = useState(false)
  const uploads = useStagedUploads()

  const canSend = disabled !== true && (body.trim() !== "" || uploads.ready.length > 0)

  const send = () => {
    if (!canSend) return
    onSend({ body: body.trim(), attachments: uploads.ready })
    setBody("")
    uploads.takeReady()
  }

  return (
    <div className="shrink-0 border-t p-2.5">
      <div
        onDragEnter={(event) => {
          event.preventDefault()
          setOver(true)
        }}
        onDragOver={(event) => {
          event.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault()
          setOver(false)
          if (event.dataTransfer.files.length > 0) uploads.stage(event.dataTransfer.files)
        }}
        className={cn(
          "bg-muted/40 rounded-xl border p-2 transition-colors",
          over && "border-primary bg-primary/5",
        )}
      >
        <StagedFiles staged={uploads.staged} onRemove={uploads.remove} className="mb-2" />

        <Textarea
          value={body}
          disabled={disabled}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter breaks the line. A conversation is typed
            // in short turns; reaching for a button on every one of them makes
            // it a form.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
          placeholder="Write a message"
          className="max-h-32 min-h-9 border-0 bg-transparent px-1 py-1 text-[13px] focus-visible:ring-0"
        />

        <div className="mt-1.5 flex items-center gap-1.5">
          <AttachButton onFiles={uploads.stage} disabled={disabled} />
          <span className="text-muted-foreground ml-auto text-[10px]">
            {uploads.waiting
              ? "waiting for an upload"
              : uploads.ready.length > 0
                ? `${uploads.ready.length} attached`
                : ""}
          </span>
          <Button size="sm" disabled={!canSend} onClick={send}>
            <Send className="size-3.5" />
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}
