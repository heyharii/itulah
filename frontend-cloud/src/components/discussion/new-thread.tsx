import { AttachButton, StagedFiles } from "@/components/collaboration/staged"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { openThread, SUBJECT_KINDS, SUBJECT_LABEL } from "@/lib/discussion"
import { useStagedUploads } from "@/lib/uploads"
import { ApiError } from "@itulah/contract/client"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"

/// Opening a discussion.
///
/// The subject is not optional and there is no "general" to fall back on. That
/// is the constraint the database enforces and the reason this screen is not a
/// forum: a thread that is not about a record is a conversation, and there is
/// a screen for those. So the first thing asked for is which record.
export function NewThread({
  open,
  onOpenChange,
  subjectKind,
  subjectId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /// Pre-filled when a thread is opened from the record itself, which is the
  /// way most of them should start.
  subjectKind?: string
  subjectId?: string
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [kind, setKind] = useState<string>(subjectKind ?? "purchase_order")
  const [record, setRecord] = useState(subjectId ?? "")
  const [note, setNote] = useState("")
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [tags, setTags] = useState("")
  const uploads = useStagedUploads()

  const reset = () => {
    setKind(subjectKind ?? "purchase_order")
    setRecord(subjectId ?? "")
    setNote("")
    setTitle("")
    setBody("")
    setTags("")
  }

  const start = useMutation({
    mutationFn: () =>
      openThread({
        subject_kind: kind,
        subject_id: record.trim(),
        subject_note: note.trim() === "" ? null : note.trim(),
        title: title.trim(),
        body: body.trim(),
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter((tag) => tag !== ""),
        attachments: uploads.ready.map((file) => file.file_id),
      }),
    onSuccess: (thread) => {
      void queryClient.invalidateQueries({ queryKey: ["discussions"] })
      onOpenChange(false)
      reset()
      void navigate({
        to: "/discussions/$threadId",
        params: { threadId: thread.thread_id },
      })
    },
  })

  const ready = record.trim() !== "" && title.trim() !== "" && body.trim() !== ""

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New discussion</DialogTitle>
          <DialogDescription>
            Everybody signed in can read this. An argument about a purchase
            order is a business record, and the person who needs it next week
            was not in the room when it happened.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="flex flex-col gap-1.5">
              <Label>About</Label>
              <Select
                items={SUBJECT_LABEL}
                value={kind}
                onValueChange={(next) => setKind(next as string)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUBJECT_KINDS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {SUBJECT_LABEL[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="thread-record">Which one</Label>
              <Input
                id="thread-record"
                value={record}
                onChange={(event) => setRecord(event.target.value)}
                placeholder="PO-2607-0108"
                className="font-mono text-sm"
              />
            </div>
          </div>
          <p className="text-muted-foreground -mt-1 text-[11px]">
            The identifier as a person reads it. It is stored as text, not as a
            key, so the thread survives its record being archived.
          </p>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="thread-note">Note on the record (optional)</Label>
            <Input
              id="thread-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Bandung Knit Works"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="thread-title">Title</Label>
            <Input
              id="thread-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Reject 13.8% on this PO — return, or take it off the price?"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="thread-body">Opening post</Label>
            <Textarea
              id="thread-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="What happened, and what has to be decided."
              className="min-h-28"
            />
            <p className="text-muted-foreground text-[11px]">
              A thread with no opening argument is a title.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="thread-tags">Tags (optional)</Label>
            <Input
              id="thread-tags"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="reject, supplier-quality"
            />
          </div>

          <StagedFiles staged={uploads.staged} onRemove={uploads.remove} />
          <div className="flex items-center gap-1.5">
            <AttachButton onFiles={uploads.stage} label="Attach files" />
          </div>

          {start.isError && (
            <p role="alert" className="text-destructive text-xs">
              {start.error instanceof ApiError
                ? start.error.message
                : "The discussion could not be opened."}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!ready || start.isPending} onClick={() => start.mutate()}>
            {start.isPending ? "Opening…" : "Open discussion"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
