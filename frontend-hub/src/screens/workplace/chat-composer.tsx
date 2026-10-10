import { ArrowUp, CornerUpLeft, Paperclip, Pencil, X } from "lucide-react"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { Button } from "@/components/ui/button"
import { reportTyping, uploadAttachment } from "@/lib/queries/workplace"
import { cn } from "@/lib/utils"
import { readDraft, writeDraft } from "@/screens/workplace/chat-store"
import { plainText } from "@/screens/workplace/chat-text"
import {
  AttachmentChips,
  Avatar,
  useAutoSize,
  type PendingAttachment,
} from "@/screens/workplace/parts"
import type { ChatMember, ChatMessage } from "@itulah/contract"

/// The box at the foot of a room.
///
/// Everything a chat composer is expected to do, and nothing a form does:
/// Enter sends and Shift+Enter breaks the line; `@` offers the people in the
/// room; ↑ in an empty box edits your last line; Esc lets go of a reply or an
/// edit; a pasted screenshot or a dropped file is attached; and what was being
/// typed is still there after a reload or a walk to another room.

/// Mirrors `MAX_ATTACHMENT_BYTES` in `postgres/files.rs`. Checked here so a
/// photograph that is too big is refused before it spends a minute uploading
/// over a shop's connection.
const MAX_FILE_BYTES = 8 * 1024 * 1024

/// Mirrors the server's limit per message.
const MAX_FILES = 10

/// How often "is typing" is reported while somebody types. Under the server's
/// six-second expiry, so a steady typist never flickers off.
const TYPING_EVERY_MS = 3_000

/// Files uploaded ahead of the send, for one room.
///
/// Upload runs ahead of the send, which is the server's own design: a
/// photograph finishes while the caption is still being typed, and the send
/// then names a `file_id` it already holds.
export function useChatAttachments() {
  const [pending, setPendingState] = useState<readonly PendingAttachment[]>([])
  const [uploading, setUploading] = useState(0)
  const [problem, setProblem] = useState<string | null>(null)
  // The truth, read synchronously: what is held, and how many uploads are
  // still on their way. A send reads the held files the instant it is
  // pressed, and five files dropped at once are counted against the limit
  // before any of them has landed — neither can wait for a render.
  const held = useRef<readonly PendingAttachment[]>([])
  const inFlight = useRef(0)

  const setPending = useCallback((next: readonly PendingAttachment[]) => {
    held.current = next
    setPendingState(next)
  }, [])

  const addFiles = useCallback(
    (files: readonly File[]) => {
      setProblem(null)
      for (const file of files) {
        if (file.size > MAX_FILE_BYTES) {
          setProblem(`${file.name} is larger than 8 MB. Share a smaller copy.`)
          continue
        }
        if (held.current.length + inFlight.current >= MAX_FILES) {
          setProblem(`At most ${MAX_FILES} files on one message.`)
          break
        }
        inFlight.current += 1
        setUploading(inFlight.current)
        uploadAttachment(file)
          .then((stored) =>
            setPending([
              ...held.current,
              {
                file_id: stored.file_id,
                file_name: stored.file_name,
                byte_size: stored.byte_size,
              },
            ])
          )
          .catch((error: unknown) =>
            // The server explains a refused upload in a sentence — too big,
            // wrong kind — and that sentence is what belongs on screen.
            setProblem(
              error instanceof Error && error.message !== ""
                ? error.message
                : `${file.name} could not be uploaded.`
            )
          )
          .finally(() => {
            inFlight.current -= 1
            setUploading(inFlight.current)
          })
      }
    },
    [setPending]
  )

  const remove = useCallback(
    (fileId: string) =>
      setPending(held.current.filter((file) => file.file_id !== fileId)),
    [setPending]
  )

  /// Put files back — the ones a discarded message was carrying — as far as
  /// the limit allows.
  const put = useCallback(
    (files: readonly PendingAttachment[]) => {
      const room = Math.max(
        0,
        MAX_FILES - held.current.length - inFlight.current
      )
      const known = new Set(held.current.map((file) => file.file_id))
      const fresh = files.filter((file) => !known.has(file.file_id))
      const back = fresh.slice(0, room)
      if (back.length > 0) setPending([...held.current, ...back])
      if (back.length < fresh.length) {
        setProblem(`At most ${MAX_FILES} files on one message.`)
      }
    },
    [setPending]
  )

  /// Hand over what is held and start empty. Returns the files so the send
  /// carries exactly what was on screen when it was pressed.
  const take = useCallback((): readonly PendingAttachment[] => {
    const taken = held.current
    setPending([])
    setProblem(null)
    return taken
  }, [setPending])

  return {
    pending,
    uploading,
    problem,
    setProblem,
    addFiles,
    remove,
    take,
    put,
  }
}

export type ChatAttachments = ReturnType<typeof useChatAttachments>

/// Whether the person is typing on a touch screen's keyboard.
function touchKeyboard(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(pointer: coarse)").matches === true
  )
}

interface Suggestion {
  readonly username: string
  readonly display_name: string
}

/// `@` and what follows it, when the caret is at the end of one.
const MENTION_AT_CARET = /(?:^|[^\p{L}\p{N}._-])@([\p{L}\p{N}._-]*)$/u

export function ChatComposer({
  conversationId,
  me,
  members,
  group,
  attachments,
  replyTo,
  onCancelReply,
  editing,
  onCancelEdit,
  onSaveEdit,
  onSend,
  onEditLast,
  restore,
}: {
  conversationId: string
  me: string | undefined
  members: readonly ChatMember[]
  group: boolean
  attachments: ChatAttachments
  replyTo: ChatMessage | null
  onCancelReply: () => void
  editing: ChatMessage | null
  onCancelEdit: () => void
  /// Resolves when the server has the new words; rejects with the reason.
  onSaveEdit: (message: ChatMessage, body: string) => Promise<void>
  onSend: (body: string, files: readonly PendingAttachment[]) => void
  /// ↑ in an empty box.
  onEditLast: () => void
  /// Words to put back in the box — a message that was discarded unsent.
  restore: { text: string; nonce: number } | null
}) {
  const owner = me ?? ""
  const [text, setText] = useState(() => readDraft(owner, conversationId))
  const [caret, setCaret] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [editProblem, setEditProblem] = useState<string | null>(null)
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)
  const [highlight, setHighlight] = useState(0)
  const box = useAutoSize(text, 1)
  const picker = useRef<HTMLInputElement>(null)
  /// The draft, parked while an edit borrows the box.
  const [parked, setParked] = useState<string | null>(null)
  const lastTyping = useRef(0)
  /// Where the caret goes after the next render — set when a completion
  /// rewrites the text under it.
  const nextCaret = useRef<number | null>(null)

  // ─── Draft ────────────────────────────────────────────────────────────────

  // Written on every change — local storage is cheap, and a timer would lose
  // the last keystrokes to a reload or a walk to another room. Never while an
  // edit has the box: the words of an old message are not a draft of a new
  // one.
  useEffect(() => {
    if (editing !== null) return
    writeDraft(owner, conversationId, text)
  }, [owner, conversationId, text, editing])

  // ─── Edit mode ────────────────────────────────────────────────────────────

  const editingSeq = editing?.seq ?? null
  const [editLoaded, setEditLoaded] = useState<number | null>(null)
  // Adjusted during render rather than in an effect: the box shows the old
  // message's words on the same frame the "Editing" bar appears.
  if (editingSeq !== editLoaded) {
    setEditLoaded(editingSeq)
    setEditProblem(null)
    if (editing !== null) {
      // Moving from one edit straight to another keeps the draft parked the
      // first time, not the first message's words.
      if (parked === null) setParked(text)
      setText(editing.body)
    } else if (parked !== null) {
      setText(parked)
      setParked(null)
    }
  }

  // Put back what a discarded message said, once per discard — into the
  // draft, wherever the draft is at the moment.
  const [restored, setRestored] = useState<number | null>(null)
  if (restore !== null && restore.nonce !== restored) {
    setRestored(restore.nonce)
    const join = (current: string) =>
      current.trim() === "" ? restore.text : `${current}\n${restore.text}`
    if (editing !== null) setParked((current) => join(current ?? ""))
    else setText(join)
  }

  // Straight to the box when a reply or an edit starts.
  const replySeq = replyTo?.seq ?? null
  useEffect(() => {
    if (replySeq === null && editingSeq === null) return
    const el = box.current
    if (el === null) return
    el.focus()
    const end = el.value.length
    el.setSelectionRange(end, end)
  }, [replySeq, editingSeq, box])

  useLayoutEffect(() => {
    const el = box.current
    if (el === null || nextCaret.current === null) return
    el.setSelectionRange(nextCaret.current, nextCaret.current)
    nextCaret.current = null
  })

  // ─── Mentions ─────────────────────────────────────────────────────────────

  const candidates = useMemo<Suggestion[]>(() => {
    const people = members
      .filter((member) => member.username !== me)
      .map((member) => ({
        username: member.username,
        display_name: member.display_name,
      }))
    return group
      ? [...people, { username: "all", display_name: "Everyone in the room" }]
      : people
  }, [members, me, group])

  const mention = useMemo(() => {
    if (caret === null) return null
    const found = MENTION_AT_CARET.exec(text.slice(0, caret))
    if (found === null) return null
    const query = found[1]
    return { query, start: caret - query.length - 1 }
  }, [text, caret])

  const suggestions = useMemo(() => {
    if (mention === null || mention.start === dismissedAt) return []
    const needle = mention.query.toLowerCase()
    return candidates
      .filter(
        (one) =>
          one.username.toLowerCase().startsWith(needle) ||
          one.display_name.toLowerCase().includes(needle)
      )
      .slice(0, 6)
  }, [mention, candidates, dismissedAt])

  // Esc closes the list for THIS `@`; once the caret leaves it, the next one
  // offers names again.
  if (mention === null && dismissedAt !== null) setDismissedAt(null)

  const open = suggestions.length > 0
  const active = Math.min(highlight, Math.max(0, suggestions.length - 1))

  const complete = (pick: Suggestion) => {
    if (mention === null || caret === null) return
    const before = text.slice(0, mention.start)
    const after = text.slice(caret)
    const inserted = `@${pick.username} `
    setText(`${before}${inserted}${after.replace(/^ /, "")}`)
    const at = before.length + inserted.length
    nextCaret.current = at
    setCaret(at)
    setHighlight(0)
  }

  // ─── Sending ──────────────────────────────────────────────────────────────

  const body = text.trim()
  const canSend =
    editing !== null
      ? !saving && (body !== "" || editing.attachments.length > 0)
      : attachments.uploading === 0 &&
        (body !== "" || attachments.pending.length > 0)

  const submit = () => {
    if (!canSend) return
    if (editing !== null) {
      if (body === editing.body.trim()) {
        onCancelEdit()
        return
      }
      setSaving(true)
      setEditProblem(null)
      onSaveEdit(editing, body)
        .then(() => onCancelEdit())
        .catch((error: unknown) =>
          setEditProblem(error instanceof Error ? error.message : String(error))
        )
        .finally(() => setSaving(false))
      return
    }
    onSend(body, attachments.take())
    setText("")
    writeDraft(owner, conversationId, "")
    lastTyping.current = 0
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // An input method is still composing a word (Japanese, Chinese, and the
    // accent keys on some keyboards): its Enter chooses the word. Safari
    // reports the committing Enter as not composing, but as key 229.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return

    if (open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        const step = event.key === "ArrowDown" ? 1 : -1
        setHighlight((active + step + suggestions.length) % suggestions.length)
        return
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault()
        complete(suggestions[active])
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        setDismissedAt(mention?.start ?? null)
        return
      }
    }

    // Enter sends, Shift+Enter breaks the line — on a keyboard. A phone's
    // keyboard has no Shift, so there Enter is a line break and the button
    // sends, the way every messenger on a phone behaves.
    if (event.key === "Enter" && !event.shiftKey && !touchKeyboard()) {
      event.preventDefault()
      submit()
      return
    }
    if (event.key === "Escape") {
      if (editing !== null) {
        event.preventDefault()
        onCancelEdit()
      } else if (replyTo !== null) {
        event.preventDefault()
        onCancelReply()
      }
      return
    }
    if (
      event.key === "ArrowUp" &&
      text === "" &&
      editing === null &&
      !event.shiftKey
    ) {
      event.preventDefault()
      onEditLast()
    }
  }

  const onChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value
    setText(value)
    setCaret(event.target.selectionStart)
    setHighlight(0)
    if (editing === null && value.trim() !== "") {
      const now = Date.now()
      if (now - lastTyping.current > TYPING_EVERY_MS) {
        lastTyping.current = now
        // Best effort: "typing…" that fails to appear is not an error anybody
        // needs to be told about.
        reportTyping(conversationId).catch(() => undefined)
      }
    }
  }

  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (editing !== null) return
    const files = Array.from(event.clipboardData.files)
    if (files.length === 0) return
    // A screenshot pasted from the clipboard. Its "text" is the file's name,
    // which is not what anybody meant to type.
    event.preventDefault()
    attachments.addFiles(files)
  }

  const problem = editing !== null ? editProblem : attachments.problem

  return (
    <div className="flex flex-col gap-2">
      {editing !== null ? (
        <ContextBar
          icon={<Pencil className="size-3.5" />}
          title="Editing message"
          line={plainText(editing.body)}
          onClose={onCancelEdit}
          hint="Esc to cancel"
        />
      ) : (
        replyTo !== null && (
          <ContextBar
            icon={<CornerUpLeft className="size-3.5" />}
            title={`Replying to ${replyTo.author === me ? "yourself" : replyTo.author_name}`}
            line={
              plainText(replyTo.body) ||
              (replyTo.attachments.length > 0 ? "📎 Attachment" : "")
            }
            onClose={onCancelReply}
          />
        )
      )}

      {problem !== null && (
        <div className="flex items-start gap-2 rounded-inner bg-bad-bg px-3 py-1.5 text-[0.875rem] text-bad-fg">
          <span className="min-w-0 flex-1">{problem}</span>
          {editing === null && (
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => attachments.setProblem(null)}
              className="shrink-0"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      )}

      {editing === null && (
        <AttachmentChips
          attachments={attachments.pending}
          onRemove={attachments.remove}
        />
      )}

      <div className="relative flex items-end gap-2">
        {open && (
          <ul
            role="listbox"
            aria-label="People in this room"
            className="absolute bottom-full left-10 z-20 mb-2 w-64 max-w-[calc(100%-3rem)] overflow-hidden rounded-card border border-hairline bg-canvas p-1 shadow-pop"
          >
            {suggestions.map((one, index) => (
              <li
                key={one.username}
                role="option"
                aria-selected={index === active}
              >
                <button
                  type="button"
                  // Pressed with the mouse down, so the box keeps its focus and
                  // its caret — a click would blur it first.
                  onMouseDown={(event) => {
                    event.preventDefault()
                    complete(one)
                  }}
                  onMouseEnter={() => setHighlight(index)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[0.875rem]",
                    index === active ? "bg-soft-2 text-ink" : "text-text"
                  )}
                >
                  {one.username === "all" ? (
                    <span className="grid size-[1.375rem] place-items-center rounded-inner bg-soft-2 text-pill">
                      @
                    </span>
                  ) : (
                    <Avatar name={one.display_name} size="sm" />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {one.display_name}
                  </span>
                  <span className="shrink-0 text-pill text-mute">
                    @{one.username}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {editing === null && (
          <>
            <input
              ref={picker}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? [])
                if (files.length > 0) attachments.addFiles(files)
                // Cleared so picking the same file twice still fires a change.
                event.target.value = ""
              }}
            />
            <Button
              variant="quiet"
              size="icon"
              aria-label="Attach files"
              title="Attach files — or paste or drop them here"
              onClick={() => picker.current?.click()}
            >
              <Paperclip />
            </Button>
          </>
        )}

        <textarea
          ref={box}
          rows={1}
          value={text}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onBlur={() => setCaret(null)}
          aria-label={editing !== null ? "Edit message" : "Message"}
          className="max-h-40 w-full resize-none overflow-y-auto rounded-inner border border-hairline-2 bg-canvas px-3.5 py-2 text-[0.875rem] leading-normal text-ink transition-colors outline-none placeholder:text-mute hover:border-hairline-strong focus:border-hairline-strong"
        />

        <Button
          variant="primary"
          size="icon"
          aria-label={editing !== null ? "Save" : "Send"}
          title={editing !== null ? "Save (Enter)" : "Send (Enter)"}
          disabled={!canSend}
          pending={saving}
          onClick={submit}
        >
          <ArrowUp />
        </Button>
      </div>
    </div>
  )
}

function ContextBar({
  icon,
  title,
  line,
  hint,
  onClose,
}: {
  icon: React.ReactNode
  title: string
  line: string
  hint?: string
  onClose: () => void
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-inner border-l-2 border-accent bg-soft px-3 py-1.5">
      <span className="shrink-0 text-accent">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-pill font-medium text-accent">
            {title}
          </span>
          {hint !== undefined && (
            <span className="shrink-0 text-pill text-mute max-md:hidden">
              {hint}
            </span>
          )}
        </div>
        {line !== "" && (
          <div className="truncate text-[0.875rem] text-body">{line}</div>
        )}
      </div>
      <button
        type="button"
        aria-label="Cancel"
        onClick={onClose}
        className="grid size-6 shrink-0 place-items-center rounded-full text-line-ico transition-colors hover:bg-soft-2 hover:text-ink"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
