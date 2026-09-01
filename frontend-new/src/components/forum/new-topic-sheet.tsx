import { useEffect, useState } from "react"
import { useStore } from "@tanstack/react-form"
import { z } from "zod"

import { Icon, paths } from "@/components/dashboard/parts"
import { SheetShell, sheetButton } from "@/components/dashboard/sheet-shell"
import { cue } from "@/components/dashboard/use-interaction-sounds"
import type { Category, ForumTag } from "@/components/forum/data"
import type { NewTopicInput } from "@/components/forum/api"
import { cn } from "@/lib/utils"

import { FieldShell, useAppForm, useSheetForm } from "@/shared/form"

const MIN_BODY = 20
const MAX_TITLE = 120

/** What the records engine accepts for a new topic — the queue and tags it
 *  routes on, not anything the engine mints itself (id, author, timestamps). */
const newTopicInput = z.object({
  title: z.string().superRefine((value, ctx) => {
    const trimmed = value.trim()
    if (!trimmed) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Give the topic a title." })
    } else if (trimmed.length < 12) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A little more detail helps people answer.",
      })
    }
  }),
  category: z.string().min(1, "Pick a category."),
  body: z
    .string()
    .trim()
    .min(MIN_BODY, `Say at least ${MIN_BODY} characters so the question is answerable.`),
  tags: z.array(z.string()),
})

type NewTopicDraft = z.infer<typeof newTopicInput>

const emptyDraft = (): NewTopicDraft => ({ title: "", category: "", tags: [], body: "" })

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <div className="flex items-center gap-1.5 pt-1.5 text-[11.5px] font-medium text-ember">
      <Icon path={paths.alert} size={12} width={2.2} className="shrink-0" />
      {message}
    </div>
  )
}

export function NewTopicSheet({
  open,
  categories,
  tags,
  onClose,
  onCreate,
}: {
  open: boolean
  categories: Category[]
  tags: ForumTag[]
  onClose: () => void
  /** Opens the topic on the records engine; rejects if the write fails. */
  onCreate: (input: NewTopicInput) => Promise<void>
}) {
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const { busy, error, run } = useSheetForm(onClose)

  const form = useAppForm({
    defaultValues: emptyDraft(),
    validators: { onChange: newTopicInput },
    onSubmitInvalid: () => cue("error"),
    onSubmit: async ({ value }) => {
      // The category IS the record's queue, so the engine routes the topic to
      // the team it was addressed to rather than to a label this form invents.
      await run(() =>
        onCreate({
          title: value.title.trim(),
          body: value.body.trim(),
          queue: value.category,
          tags: value.tags,
        })
      )
    },
  })

  const title = useStore(form.store, (state) => state.values.title)
  const isDirty = useStore(form.store, (state) => state.isDirty)

  /* No row is ever fetched here — every opening starts from a blank draft —
   * so an effect-time reset (matching the original hand-rolled state) never
   * has an async gap to flash a stale value across. Resetting via TanStack's
   * own `reset`, rather than a keyed remount, is what keeps `SheetShell`
   * mounted continuously so its open/close slide keeps animating. */
  useEffect(() => {
    if (!open) return
    form.reset(emptyDraft())
    setConfirmDiscard(false)
    cue("bloom")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // `fields.tsx`'s bound inputs do not forward a ref, so `SheetShell`'s
  // `initialFocus` has nothing to point at. This focuses the title field
  // directly once the slide has started, after `SheetShell`'s own fallback
  // (first button) has already run.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => document.getElementById("title")?.focus(), 70)
    return () => clearTimeout(t)
  }, [open])

  const close = (force = false) => {
    if (!force && isDirty) {
      if (!confirmDiscard) cue("error")
      setConfirmDiscard(true)
      return
    }
    setConfirmDiscard(false)
    onClose()
  }

  // Cmd/Ctrl+Enter posts from anywhere in the form.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault()
        void form.handleSubmit()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  })

  return (
    <SheetShell
      open={open}
      eyebrow="New topic"
      title="Start a discussion"
      onRequestClose={() => close()}
      overlay={
        confirmDiscard ? (
          <div className="absolute right-3.5 bottom-[62px] left-3.5 z-5 flex animate-rise items-center gap-2 rounded-panel bg-surface py-2.5 pr-2.5 pl-[13px] text-xs font-medium shadow-[0_0_0_1px_var(--line-strong),var(--shadow-overlay)]">
            Discard this draft?
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => setConfirmDiscard(false)}
              className="inline-flex h-[26px] items-center rounded-control bg-surface px-2 text-xs font-medium text-ink shadow-btn transition-colors hover:bg-hover"
            >
              Keep writing
            </button>
            <button
              type="button"
              onClick={() => close(true)}
              className="inline-flex h-[26px] items-center rounded-control bg-ember px-2 text-xs font-medium text-white transition-[filter] hover:brightness-105"
            >
              Discard
            </button>
          </div>
        ) : undefined
      }
      footer={
        <>
          <span className="pl-0.5 font-mono text-[11px] text-ink-4">⌘⏎ to post</span>
          <span className="flex-1" />
          <button type="button" onClick={() => close()} className={sheetButton.secondary}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void form.handleSubmit()}
            disabled={busy}
            className={sheetButton.primary}
          >
            <Icon path={paths.check} size={14} width={2.2} />
            {busy ? "Posting…" : "Post topic"}
          </button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
        className="px-[18px] pt-4 pb-[18px]"
      >
        {error && (
          <div className="mb-4">
            <FieldError message={`Could not open the topic: ${error}`} />
          </div>
        )}

        <div className="mb-4">
          <form.AppField name="title">
            {(field) => <field.TextField label="Title" required placeholder="Summarise the problem in one line" />}
          </form.AppField>
          <form.Subscribe selector={(state) => state.fieldMeta.title?.errors.length ?? 0}>
            {(errorCount) =>
              errorCount === 0 && (
                <div className="-mt-2 pt-1.5 pb-[13px] text-right font-mono text-[11px] text-ink-4">
                  {title.length} / {MAX_TITLE}
                </div>
              )
            }
          </form.Subscribe>
        </div>

        <div className="mb-4">
          <form.AppField name="category">
            {(field) => {
              const errors = field.state.meta.isTouched
                ? field.state.meta.errors
                    .map((error) =>
                      typeof error === "string"
                        ? error
                        : error && typeof error === "object" && "message" in error
                          ? String((error as { message: unknown }).message)
                          : null
                    )
                    .filter((message): message is string => Boolean(message))
                : []
              return (
                <FieldShell label="Category" required errors={errors}>
                  <div role="group" aria-label="Category" className="grid grid-cols-2 gap-1.5">
                    {categories.length === 0 && (
                      <div className="col-span-2 text-[11.5px] text-ink-4">
                        No queues have been loaded yet.
                      </div>
                    )}
                    {categories.map((c) => {
                      const on = field.state.value === c.id
                      return (
                        <button
                          key={c.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() => {
                            field.handleChange(c.id)
                            field.handleBlur()
                          }}
                          className={cn(
                            "flex h-[34px] items-center gap-2 rounded-control border bg-surface px-2.5 text-left text-xs font-medium transition-[border-color,background-color,box-shadow] duration-[130ms]",
                            on
                              ? "border-accent bg-accent-tint font-semibold text-ink shadow-[0_0_0_1px_var(--accent)]"
                              : "border-line-strong text-ink-2 hover:border-ink-4"
                          )}
                        >
                          <span style={{ background: c.hue }} className="size-3 shrink-0 rounded-[3px]" />
                          <span className="truncate">{c.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </FieldShell>
              )
            }}
          </form.AppField>
        </div>

        <div className="mb-4">
          <form.AppField name="tags">
            {(field) => (
              <FieldShell label="Tags" hint="optional">
                <div role="group" aria-label="Tags" className="flex flex-wrap gap-1.5">
                  {tags.length === 0 && (
                    <div className="text-[11.5px] text-ink-4">No tags in use yet.</div>
                  )}
                  {tags.map((t) => {
                    const on = field.state.value.includes(t.id)
                    return (
                      <button
                        key={t.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          field.handleChange(
                            on ? field.state.value.filter((id) => id !== t.id) : [...field.state.value, t.id]
                          )
                        }
                        className={cn(
                          "inline-flex h-[27px] items-center gap-1.5 rounded-lg border py-0 pr-[9px] pl-2 text-xs font-medium transition-colors duration-[130ms]",
                          on
                            ? "border-accent/40 bg-accent-tint text-accent-ink"
                            : "border-line-strong bg-surface text-ink-3 hover:border-ink-4 hover:text-ink-2"
                        )}
                      >
                        <Icon path={paths.tag} size={12} width={1.9} className="shrink-0" />
                        {t.label}
                      </button>
                    )
                  })}
                </div>
              </FieldShell>
            )}
          </form.AppField>
        </div>

        <div>
          <form.AppField name="body">
            {(field) => (
              <field.TextAreaField
                label="Body"
                required
                hint="Blank lines become paragraphs."
                placeholder={"What did you try, and what happened?\n\nLeave a blank line to start a new paragraph."}
              />
            )}
          </form.AppField>
        </div>
      </form>
    </SheetShell>
  )
}
