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
import { useForm, useStore } from "@tanstack/react-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"

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
  const uploads = useStagedUploads()

  /// The whole of what is asked for, in one place. The defaults are the record
  /// this was opened from, so `reset` is the form's own — a dialog reopened from
  /// a purchase order comes back pointing at that purchase order rather than at
  /// whatever was typed last time.
  const form = useForm({
    defaultValues: {
      kind: subjectKind ?? "purchase_order",
      record: subjectId ?? "",
      note: "",
      title: "",
      body: "",
      tags: "",
    },
    onSubmit: ({ value }) => {
      start.mutate(value)
    },
  })
  const values = useStore(form.store, (state) => state.values)

  const start = useMutation({
    mutationFn: (value: typeof form.state.values) =>
      openThread({
        subject_kind: value.kind,
        subject_id: value.record.trim(),
        subject_note: value.note.trim() === "" ? null : value.note.trim(),
        title: value.title.trim(),
        body: value.body.trim(),
        tags: value.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter((tag) => tag !== ""),
        attachments: uploads.ready.map((file) => file.file_id),
      }),
    onSuccess: (thread) => {
      void queryClient.invalidateQueries({ queryKey: ["discussions"] })
      onOpenChange(false)
      form.reset()
      void navigate({
        to: "/discussions/$threadId",
        params: { threadId: thread.thread_id },
      })
    },
  })

  const ready =
    values.record.trim() !== "" && values.title.trim() !== "" && values.body.trim() !== ""

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) form.reset()
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
                value={values.kind}
                onValueChange={(next) => form.setFieldValue("kind", next as string)}
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
              <form.Field name="record">
                {(field) => (
                  <Input
                    id="thread-record"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="PO-2607-0108"
                    className="font-mono text-sm"
                  />
                )}
              </form.Field>
            </div>
          </div>
          <p className="text-muted-foreground -mt-1 text-[11px]">
            The identifier as a person reads it. It is stored as text, not as a
            key, so the thread survives its record being archived.
          </p>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="thread-note">Note on the record (optional)</Label>
            <form.Field name="note">
              {(field) => (
                <Input
                  id="thread-note"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="Bandung Knit Works"
                />
              )}
            </form.Field>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="thread-title">Title</Label>
            <form.Field name="title">
              {(field) => (
                <Input
                  id="thread-title"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="Reject 13.8% on this PO — return, or take it off the price?"
                />
              )}
            </form.Field>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="thread-body">Opening post</Label>
            <form.Field name="body">
              {(field) => (
                <Textarea
                  id="thread-body"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="What happened, and what has to be decided."
                  className="min-h-28"
                />
              )}
            </form.Field>
            <p className="text-muted-foreground text-[11px]">
              A thread with no opening argument is a title.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="thread-tags">Tags (optional)</Label>
            <form.Field name="tags">
              {(field) => (
                <Input
                  id="thread-tags"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="reject, supplier-quality"
                />
              )}
            </form.Field>
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
          <Button
            disabled={!ready || start.isPending}
            onClick={() => void form.handleSubmit()}
          >
            {start.isPending ? "Opening…" : "Open discussion"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
