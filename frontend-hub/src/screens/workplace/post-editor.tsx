import {
  Bold,
  Code,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
} from "lucide-react"
import { useLayoutEffect, useMemo, useRef, useState } from "react"

import { cn } from "@/lib/utils"
import { Markdown } from "@/screens/workplace/markdown"
import {
  AttachButton,
  AttachmentChips,
  Avatar,
  type PendingAttachment,
} from "@/screens/workplace/parts"

/// Somebody who can be named with `@`.
export interface Mentionable {
  readonly username: string
  readonly name: string
}

/// Where the caret is inside an `@name` being typed, if it is.
interface MentionToken {
  /// Index of the `@`.
  readonly start: number
  readonly query: string
}

function tokenAt(value: string, caret: number): MentionToken | null {
  const before = value.slice(0, caret)
  const match = /(^|[^A-Za-z0-9._@-])@([A-Za-z0-9._-]{0,32})$/.exec(before)
  if (match === null) return null
  return { start: caret - match[2].length - 1, query: match[2].toLowerCase() }
}

const TOOL =
  "grid size-7 place-items-center rounded-inner text-body transition-colors hover:bg-soft-2 hover:text-ink disabled:opacity-40 [&_svg]:size-3.5"

/// Writing a post: the forum composer.
///
/// A textarea and not a rich-text editor, because what is stored is what was
/// typed — Markdown, the way Discourse stores it — and a WYSIWYG surface over
/// plain text is two representations that drift. The toolbar only types the
/// marks for somebody who does not know them, and Preview shows what they
/// will look like.
///
/// # The keys
///
/// Enter is a new line. A post is paragraphs, not a chat line, and a forum
/// that sends on Enter sends half-written arguments. ⌘/Ctrl+Enter posts —
/// Discourse's and GitHub's key, so hands that know one know this.
///
/// # The draft is the caller's
///
/// `value` lives with whoever renders this, and is cleared by them only when
/// the server has the post. The old composer emptied itself on send, so a
/// reply that failed to post was a reply that had to be typed again.
export function PostEditor({
  value,
  onChange,
  placeholder,
  label,
  rows = 4,
  people = [],
  me,
  attachments,
  onAttach,
  onRemoveAttachment,
  uploading = false,
  onSubmit,
  autoFocus = false,
  disabled = false,
  footer,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /// What the box is, for a screen reader — the placeholder disappears as
  /// soon as somebody types.
  label?: string
  rows?: number
  /// Who can be named. Empty means `@` is typed as a character and nothing
  /// is offered.
  people?: readonly Mentionable[]
  me?: string
  attachments?: readonly PendingAttachment[]
  onAttach?: (file: File) => void
  onRemoveAttachment?: (fileId: string) => void
  uploading?: boolean
  /// ⌘/Ctrl+Enter. The caller decides whether the post is ready.
  onSubmit?: () => void
  autoFocus?: boolean
  disabled?: boolean
  /// The actions under the box — Post, Cancel — owned by the caller.
  footer?: React.ReactNode
}) {
  const box = useRef<HTMLTextAreaElement>(null)
  const [mode, setMode] = useState<"write" | "preview">("write")
  const [token, setToken] = useState<MentionToken | null>(null)
  const [highlight, setHighlight] = useState(0)
  const [dragging, setDragging] = useState(false)
  /// Where the selection should land after the next change is drawn. A
  /// controlled textarea puts the caret at the end on every re-render unless
  /// told otherwise, which made every toolbar button a jump to the bottom.
  const selectAfter = useRef<[number, number] | null>(null)

  // Grow with what is written, from `rows` up to the CSS cap.
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
    el.style.height = `${Math.max(el.scrollHeight, line * rows + inside) + edges}px`

    const selection = selectAfter.current
    if (selection !== null) {
      selectAfter.current = null
      el.focus()
      el.setSelectionRange(selection[0], selection[1])
    }
  }, [value, rows, mode])

  const candidates = useMemo(() => {
    if (token === null || people.length === 0) return []
    const needle = token.query
    return people
      .filter((person) => person.username !== me)
      .filter(
        (person) =>
          needle === "" ||
          person.username.toLowerCase().includes(needle) ||
          person.name.toLowerCase().includes(needle)
      )
      .sort((a, b) => {
        // Names that START with what was typed first — "bu" should offer
        // budi before a person whose surname happens to contain it.
        const aStarts = a.username.toLowerCase().startsWith(needle) ? 0 : 1
        const bStarts = b.username.toLowerCase().startsWith(needle) ? 0 : 1
        return aStarts - bStarts || a.username.localeCompare(b.username)
      })
      .slice(0, 6)
  }, [token, people, me])

  const readToken = () => {
    const el = box.current
    if (el === null || el.selectionStart !== el.selectionEnd) {
      setToken(null)
      return
    }
    const next = tokenAt(el.value, el.selectionStart)
    setToken((previous) =>
      previous?.start === next?.start && previous?.query === next?.query
        ? previous
        : next
    )
    setHighlight(0)
  }

  const replaceRange = (
    start: number,
    end: number,
    text: string,
    caret?: number
  ) => {
    const next = value.slice(0, start) + text + value.slice(end)
    const at = caret ?? start + text.length
    selectAfter.current = [at, at]
    onChange(next)
  }

  const pick = (person: Mentionable) => {
    const el = box.current
    if (token === null || el === null) return
    replaceRange(token.start, el.selectionStart, `@${person.username} `)
    setToken(null)
  }

  /// Put `before`/`after` around the selection, or around a placeholder
  /// word that comes out selected so typing replaces it.
  const wrap = (before: string, after: string, filler: string) => {
    const el = box.current
    if (el === null) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const chosen = value.slice(start, end) || filler
    const next =
      value.slice(0, start) + before + chosen + after + value.slice(end)
    selectAfter.current = [
      start + before.length,
      start + before.length + chosen.length,
    ]
    onChange(next)
  }

  /// Prefix every line the selection touches — lists and quotes.
  const prefixLines = (prefix: (index: number) => string) => {
    const el = box.current
    if (el === null) return
    const start = value.lastIndexOf("\n", el.selectionStart - 1) + 1
    const endBreak = value.indexOf("\n", el.selectionEnd)
    const end = endBreak === -1 ? value.length : endBreak
    const lines = value.slice(start, end).split("\n")
    const changed = lines.map((line, index) => prefix(index) + line).join("\n")
    selectAfter.current = [start, start + changed.length]
    onChange(value.slice(0, start) + changed + value.slice(end))
  }

  const link = () => {
    const el = box.current
    if (el === null) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const label = value.slice(start, end) || "link text"
    const inserted = `[${label}](https://)`
    // The caret lands inside the parentheses, where the address goes.
    const caret = start + label.length + 3 + "https://".length
    replaceRange(start, end, inserted, caret)
  }

  const attachAll = (files: FileList | readonly File[] | null) => {
    if (files === null || onAttach === undefined) return
    for (const file of Array.from(files)) onAttach(file)
  }

  const tools: readonly {
    label: string
    icon: React.ComponentType
    run: () => void
  }[] = [
    { label: "Bold", icon: Bold, run: () => wrap("**", "**", "bold") },
    { label: "Italic", icon: Italic, run: () => wrap("*", "*", "italic") },
    {
      label: "Strikethrough",
      icon: Strikethrough,
      run: () => wrap("~~", "~~", "struck"),
    },
    { label: "Code", icon: Code, run: () => wrap("`", "`", "code") },
    { label: "Link", icon: Link2, run: link },
    { label: "Quote", icon: Quote, run: () => prefixLines(() => "> ") },
    { label: "Bulleted list", icon: List, run: () => prefixLines(() => "- ") },
    {
      label: "Numbered list",
      icon: ListOrdered,
      run: () => prefixLines((index) => `${index + 1}. `),
    },
  ]

  const open = mode === "write" && candidates.length > 0

  return (
    <div className="flex flex-col gap-2">
      <div
        className={cn(
          "rounded-inner border bg-canvas transition-colors",
          dragging ? "border-accent bg-accent-bg/40" : "border-hairline-2",
          !disabled && "focus-within:border-hairline-strong"
        )}
        onDragOver={(event) => {
          if (onAttach === undefined || disabled) return
          if (!event.dataTransfer.types.includes("Files")) return
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          if (onAttach === undefined || disabled) return
          if (event.dataTransfer.files.length === 0) return
          event.preventDefault()
          setDragging(false)
          attachAll(event.dataTransfer.files)
        }}
      >
        <div className="flex items-center gap-0.5 border-b border-hairline px-1.5 py-1">
          <div className="flex rounded-inner bg-soft-2 p-0.5 text-meta font-medium">
            {(["write", "preview"] as const).map((each) => (
              <button
                key={each}
                type="button"
                onClick={() => {
                  setMode(each)
                  setToken(null)
                }}
                className={cn(
                  "h-6 rounded-[0.3125rem] px-2 transition-colors",
                  mode === each
                    ? "bg-canvas text-ink shadow-soft"
                    : "text-body hover:text-ink"
                )}
              >
                {each === "write" ? "Write" : "Preview"}
              </button>
            ))}
          </div>
          <span className="mx-1 h-4 w-px bg-hairline" />
          <div className="flex min-w-0 [scrollbar-width:none] items-center gap-0.5 overflow-x-auto">
            {tools.map((tool) => (
              <button
                key={tool.label}
                type="button"
                title={tool.label}
                aria-label={tool.label}
                disabled={mode !== "write" || disabled}
                // Keep the textarea's selection: a mousedown on a button moves
                // focus, and the selection it was about to wrap goes with it.
                onMouseDown={(event) => event.preventDefault()}
                onClick={tool.run}
                className={TOOL}
              >
                <tool.icon />
              </button>
            ))}
          </div>
          {onAttach && (
            <div className="ml-auto">
              <AttachButton onAttach={onAttach} disabled={disabled} multiple />
            </div>
          )}
        </div>

        <div className="relative">
          {mode === "write" ? (
            <textarea
              ref={box}
              aria-label={label ?? placeholder ?? "Post"}
              rows={rows}
              value={value}
              disabled={disabled}
              autoFocus={autoFocus}
              placeholder={uploading ? "Uploading…" : placeholder}
              onChange={(event) => {
                onChange(event.target.value)
                // Read after React has the new value; the caret is already
                // where the browser put it.
                requestAnimationFrame(readToken)
              }}
              onClick={readToken}
              onKeyUp={(event) => {
                if (
                  event.key === "ArrowLeft" ||
                  event.key === "ArrowRight" ||
                  event.key === "Home" ||
                  event.key === "End"
                ) {
                  readToken()
                }
              }}
              onBlur={() => setToken(null)}
              onPaste={(event) => {
                if (onAttach === undefined) return
                const files = Array.from(event.clipboardData.files)
                if (files.length === 0) return
                // A screenshot pasted into a reply is an attachment, not a
                // wall of nothing where the image should have been.
                event.preventDefault()
                attachAll(files)
              }}
              onKeyDown={(event) => {
                if (open) {
                  if (event.key === "ArrowDown") {
                    event.preventDefault()
                    setHighlight((index) => (index + 1) % candidates.length)
                    return
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault()
                    setHighlight(
                      (index) =>
                        (index - 1 + candidates.length) % candidates.length
                    )
                    return
                  }
                  if (
                    (event.key === "Enter" &&
                      !event.metaKey &&
                      !event.ctrlKey) ||
                    event.key === "Tab"
                  ) {
                    event.preventDefault()
                    pick(candidates[Math.min(highlight, candidates.length - 1)])
                    return
                  }
                  if (event.key === "Escape") {
                    event.preventDefault()
                    event.stopPropagation()
                    setToken(null)
                    return
                  }
                }
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  onSubmit?.()
                  return
                }
                const mod = event.metaKey || event.ctrlKey
                if (mod && !event.shiftKey && !event.altKey) {
                  const key = event.key.toLowerCase()
                  if (key === "b") {
                    event.preventDefault()
                    wrap("**", "**", "bold")
                  } else if (key === "i") {
                    event.preventDefault()
                    wrap("*", "*", "italic")
                  } else if (key === "k") {
                    event.preventDefault()
                    link()
                  }
                }
              }}
              className="block max-h-[28rem] w-full resize-none overflow-y-auto rounded-b-inner bg-transparent px-3.5 py-2.5 text-[0.875rem] leading-relaxed text-ink outline-none placeholder:text-mute disabled:cursor-not-allowed"
            />
          ) : (
            <div
              className="min-h-24 px-3.5 py-2.5"
              style={{ minHeight: `${rows * 1.625 + 1.25}rem` }}
            >
              {value.trim() === "" ? (
                <p className="text-[0.875rem] text-mute">Nothing to preview.</p>
              ) : (
                <Markdown text={value} me={me} />
              )}
            </div>
          )}

          {open && (
            <ul
              role="listbox"
              aria-label="People"
              className="absolute top-full left-2 z-30 mt-1 w-64 rounded-card border border-hairline bg-canvas p-1 shadow-pop"
            >
              {candidates.map((person, index) => (
                <li
                  key={person.username}
                  role="option"
                  aria-selected={index === highlight}
                  // mousedown, not click: a click lands after the textarea's
                  // blur has already closed this list.
                  onMouseDown={(event) => {
                    event.preventDefault()
                    pick(person)
                  }}
                  onMouseEnter={() => setHighlight(index)}
                  className={cn(
                    "flex h-9 cursor-default items-center gap-2 rounded-inner px-2 text-[0.875rem]",
                    index === highlight ? "bg-soft-2 text-ink" : "text-text"
                  )}
                >
                  <Avatar name={person.username} size="sm" />
                  <span className="min-w-0 truncate font-medium">
                    {person.name}
                  </span>
                  <span className="ml-auto shrink-0 text-meta text-mute">
                    @{person.username}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {attachments !== undefined && attachments.length > 0 && (
        <AttachmentChips
          attachments={attachments}
          onRemove={onRemoveAttachment}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="hidden text-pill text-mute sm:inline">
          **bold**, *italic*, `code`, &gt; quote, - list, @name
          {onSubmit !== undefined && " · ⌘/Ctrl+Enter to post"}
          {onAttach !== undefined && " · drop or paste files"}
        </span>
        {footer !== undefined && (
          <div className="ml-auto flex items-center gap-2">{footer}</div>
        )}
      </div>
    </div>
  )
}
