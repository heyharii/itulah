import { micah } from "@dicebear/collection"
import { createAvatar } from "@dicebear/core"
import { useVirtualizer } from "@tanstack/react-virtual"
import { ArrowUp, Download, Paperclip, X } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { avatarTone, bytes, fileKind, initials } from "@/screens/workplace/lib"

/// The pieces the four workplace screens share.
///
/// They live here rather than in `components/ui` because they are this
/// module's grammar and nothing else in the app is a conversation: an avatar
/// tile, a virtualised list of things people said, a composer, a timeline node.
/// If a second module ever grows a message list, this is the file to lift from
/// — until then, inlining keeps the shared layer honest about what is actually
/// shared.

// ─── Identity ────────────────────────────────────────────────────────────────

/// The five categorical fills, in the order `avatarTone` indexes them, at the
/// weight a GROUND takes rather than a mark: the face is what carries now, and
/// a face on a saturated square is a face nobody can see. Written out rather
/// than composed, because Tailwind only ships a class it can see.
const AVATAR_FILL = [
  "bg-a-blue/15",
  "bg-a-green/15",
  "bg-a-orange/15",
  "bg-a-violet/15",
  "bg-a-pink/15",
] as const

/// One face per person, drawn from their name and kept.
///
/// DiceBear's `micah` — the owner picked the style. It runs HERE, out of the
/// npm package, rather than against `api.dicebear.com`: a username is who
/// somebody is, this app is read on a shop floor behind whatever the internet
/// is doing that afternoon, and a portrait that arrives over the public web is
/// both a staff list posted to a third party and an avatar that is a grey box
/// the day the line drops.
///
/// Cached because the drawing is deterministic and the same eight people
/// appear on every row of a board: `createAvatar` is a few hundred
/// microseconds and a render of the chat list would otherwise pay it forty
/// times for the same face.
const FACES = new Map<string, string>()

function faceOf(name: string): string {
  const known = FACES.get(name)
  if (known !== undefined) return known
  const drawn = createAvatar(micah, { seed: name }).toDataUri()
  FACES.set(name, drawn)
  return drawn
}

/// A person, as their face on a squircle tinted in their own colour.
///
/// The colour is derived from the name, so one person is the same colour on
/// every screen without a stored preference — and it comes from the
/// categorical token family, which DESIGN.md reserves for exactly this:
/// data-viz, identity tiles and system tags, never chrome. The initials are
/// still there, as the `alt` the portrait falls back to.
export function Avatar({
  name,
  size = "default",
  className,
}: {
  name: string
  size?: "default" | "sm" | "lg"
  className?: string
}) {
  return (
    <img
      src={faceOf(name)}
      alt={initials(name)}
      title={name}
      draggable={false}
      className={cn(
        "shrink-0 rounded-inner object-contain select-none",
        size === "sm" && "size-[1.375rem]",
        size === "default" && "size-7",
        size === "lg" && "size-9",
        AVATAR_FILL[avatarTone(name)],
        className
      )}
    />
  )
}

/// Everyone who has spoken, as a row of overlapping tiles.
///
/// Capped at four with a `+n` because this is a decoration on a list row and
/// not the list itself — the rule against capping applies to the rows somebody
/// came to read, not to a summary of who is in them.
export function Voices({ names }: { names: readonly string[] }) {
  const shown = names.slice(0, 4)
  const rest = names.length - shown.length
  return (
    <div className="flex items-center">
      {shown.map((name) => (
        <Avatar
          key={name}
          name={name}
          size="sm"
          className="-ml-1 ring-1 ring-canvas first:ml-0"
        />
      ))}
      {rest > 0 && (
        <span className="ml-1.5 text-pill text-mute tabular-nums">+{rest}</span>
      )}
    </div>
  )
}

// ─── The virtualised list ────────────────────────────────────────────────────

/// A scroller that renders only what is on screen.
///
/// Threads and messages are the two lists in this app that have no natural
/// ceiling, and `<DataTable>` — which virtualises itself — is the wrong shape
/// for both. Never `slice()` to cap one instead: that hides what somebody came
/// to read and calls it fast. Heights are measured rather than assumed, because
/// a message is as tall as what was said.
export function VirtualList<T>({
  items,
  estimate,
  getKey,
  children,
  className,
  stickToEnd = false,
}: {
  items: readonly T[]
  /// A first guess only; every rendered row reports its real height back.
  estimate: number
  getKey: (item: T, index: number) => string
  children: (item: T, index: number) => React.ReactNode
  className?: string
  /// Open at the newest, the way a conversation is read.
  stickToEnd?: boolean
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimate,
    overscan: 8,
  })

  const last = items.length - 1
  // Which index we have already jumped to. Without it the effect would fight
  // the scrollbar on every re-render and somebody scrolling back through a
  // conversation would be yanked to the bottom mid-read.
  const pinned = useRef(-1)
  useEffect(() => {
    if (!stickToEnd || last < 0 || pinned.current === last) return
    pinned.current = last
    virtualizer.scrollToIndex(last, { align: "end" })
  }, [stickToEnd, last, virtualizer])

  return (
    <div ref={scrollRef} className={cn("min-h-0 overflow-y-auto", className)}>
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((item) => (
          <div
            key={getKey(items[item.index], item.index)}
            data-index={item.index}
            ref={virtualizer.measureElement}
            className="absolute top-0 left-0 w-full"
            style={{ transform: `translateY(${item.start}px)` }}
          >
            {children(items[item.index], item.index)}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── The composer ────────────────────────────────────────────────────────────

/// A box as tall as what has been written in it, and no taller.
///
/// A `<textarea rows=1>` is one line forever: a third sentence scrolls under
/// the second and somebody writing a paragraph composes it through a slot.
/// Worse here than in most places, because the line it hid was the one being
/// typed — `rows` and a `min-height` disagreed by the height of a descender,
/// so the bottom of the current line was clipped as it was written.
///
/// Measured rather than declared: `height: auto` lets the box collapse to its
/// content, `scrollHeight` is then what the content actually needs, and the
/// CSS `max-height` caps the growth — past that the textarea scrolls itself,
/// which is the right behaviour for somebody pasting four paragraphs into a
/// chat. `rows` survives as the FLOOR, so the thread composer still opens
/// three lines tall.
///
/// A layout effect, not an effect: this runs between React's write and the
/// browser's paint, so nobody sees the box at the wrong height first.
function useAutoSize(value: string, rows: number) {
  const box = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = box.current
    if (el === null) return
    const style = getComputedStyle(el)
    const line = parseFloat(style.lineHeight) || 20
    const inside =
      parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
    const edges =
      parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
    el.style.height = "auto"
    // `scrollHeight` carries the padding but not the border, and the box is
    // `border-box`: without the edges back the box loses a hairline top and
    // bottom every time it is measured.
    el.style.height = `${Math.max(el.scrollHeight, line * rows + inside) + edges}px`
  }, [value, rows])

  return box
}

/// What has been uploaded and is waiting to be attached to the next send.
export interface PendingAttachment {
  readonly file_id: string
  readonly file_name: string
  readonly byte_size: number
}

/// The paperclip. A hidden native picker behind a quiet icon button, because a
/// styled `<input type=file>` loses the platform's own file dialog.
export function AttachButton({
  onAttach,
  disabled = false,
}: {
  onAttach: (file: File) => void
  disabled?: boolean
}) {
  const picker = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={picker}
        type="file"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onAttach(file)
          // Cleared so picking the same file twice still fires a change.
          event.target.value = ""
        }}
      />
      <Button
        variant="quiet"
        size="icon"
        aria-label="Attach a file"
        disabled={disabled}
        onClick={() => picker.current?.click()}
      >
        <Paperclip />
      </Button>
    </>
  )
}

/// What is uploaded and waiting, as removable chips.
export function AttachmentChips({
  attachments,
  onRemove,
}: {
  attachments: readonly PendingAttachment[]
  onRemove?: (fileId: string) => void
}) {
  if (attachments.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {attachments.map((file) => (
        <span
          key={file.file_id}
          className="inline-flex items-center gap-1.5 rounded-full bg-soft-2 py-1 pr-1 pl-2.5 text-pill text-body"
        >
          <span className="max-w-40 truncate">{file.file_name}</span>
          <span className="text-mute tabular-nums">
            {bytes(file.byte_size)}
          </span>
          {onRemove && (
            <button
              type="button"
              aria-label={`Remove ${file.file_name}`}
              onClick={() => onRemove(file.file_id)}
              className="grid size-4 place-items-center rounded-full text-line-ico transition-colors hover:bg-hairline hover:text-ink"
            >
              <X className="size-3" />
            </button>
          )}
        </span>
      ))}
    </div>
  )
}

/// The detail composer: hairline rounded input, circular dark send button,
/// pinned at the foot of whatever it belongs to.
///
/// The send button is this surface's one black CTA — a sheet and a screen are
/// each a surface, so a list with a dark "Open a thread" and a sheet with a
/// dark send is one apiece, not two.
///
/// Uploads run ahead of the send on purpose: a photograph finishes while the
/// message is still being typed, and the send then names a `file_id` it already
/// holds. A slow attachment never blocks a send, and a send that fails does not
/// lose the upload.
export function Composer({
  placeholder,
  onSend,
  onAttach,
  attachments,
  onRemoveAttachment,
  busy = false,
  uploading = false,
  disabled = false,
  disabledReason,
  rows = 1,
}: {
  placeholder: string
  onSend: (body: string) => void
  onAttach?: (file: File) => void
  attachments?: readonly PendingAttachment[]
  onRemoveAttachment?: (fileId: string) => void
  busy?: boolean
  uploading?: boolean
  disabled?: boolean
  disabledReason?: string
  rows?: number
}) {
  const [draft, setDraft] = useState("")
  const box = useAutoSize(draft, rows)

  const pending = attachments ?? []
  const canSend =
    !disabled && !busy && (draft.trim() !== "" || pending.length > 0)

  const send = () => {
    if (!canSend) return
    onSend(draft.trim())
    setDraft("")
  }

  if (disabled && disabledReason !== undefined) {
    return <p className="text-meta text-mute">{disabledReason}</p>
  }

  return (
    <div className="flex flex-col gap-2">
      <AttachmentChips attachments={pending} onRemove={onRemoveAttachment} />

      <div className="flex items-end gap-2">
        {onAttach && <AttachButton onAttach={onAttach} disabled={uploading} />}

        <textarea
          ref={box}
          rows={rows}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter breaks the line. The convention every
            // other message box in the world already taught everybody.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
          placeholder={uploading ? "Uploading…" : placeholder}
          className="max-h-40 w-full resize-none overflow-y-auto rounded-inner border border-hairline-2 bg-canvas px-3.5 py-2 text-[0.875rem] leading-normal text-ink transition-colors outline-none placeholder:text-mute hover:border-hairline-strong"
        />

        <Button
          variant="primary"
          size="icon"
          aria-label="Send"
          disabled={!canSend}
          onClick={send}
        >
          <ArrowUp />
        </Button>
      </div>
    </div>
  )
}

// ─── Attachments ─────────────────────────────────────────────────────────────

/// A file on a post or a message.
///
/// `available` is rendered rather than hidden: a row saying the file is there
/// beside a link that 404s is worse than saying plainly that the bytes are
/// gone. So an unavailable file is not a link at all.
export function AttachmentLink({
  name,
  size,
  href,
  available,
}: {
  name: string
  size: number
  href: string
  available: boolean
}) {
  const inner = (
    <>
      <span className="grid size-7 shrink-0 place-items-center rounded-inner bg-soft-2 font-mono text-[0.875rem] text-body">
        {fileKind(name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-meta text-ink">{name}</span>
        <span className="block text-pill text-mute tabular-nums">
          {available ? bytes(size) : "the bytes are gone"}
        </span>
      </span>
      {available && <Download className="size-3.5 shrink-0 text-line-ico" />}
    </>
  )

  if (!available) {
    return (
      <div className="flex items-center gap-2.5 rounded-inner border border-hairline px-2.5 py-1.5 opacity-70">
        {inner}
      </div>
    )
  }
  return (
    <a
      href={href}
      className="flex items-center gap-2.5 rounded-inner border border-hairline px-2.5 py-1.5 transition-colors hover:bg-soft"
    >
      {inner}
    </a>
  )
}

// ─── Choosing one of many ────────────────────────────────────────────────────

/// The small square that stands in for a file preview.
export function FileTile({ name }: { name: string }) {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-inner bg-soft-2 font-mono text-[0.875rem] text-body">
      {fileKind(name)}
    </span>
  )
}
