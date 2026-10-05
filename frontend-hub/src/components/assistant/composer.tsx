import { ArrowUp, Square } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { useAssistant } from "@/components/assistant/state"
import { cn } from "@/lib/utils"

/// The box a question is typed into, and the only one in the app.
///
/// It is used in two places that look different and behave identically: at the
/// foot of the panel, and in the middle of the home screen where it is the
/// first thing on the page. Both send into the same session, which is why a
/// question typed on the brief continues in the panel rather than starting
/// again there.
///
/// Enter sends and ⇧Enter breaks the line. That is the convention every chat
/// on this machine uses; the alternative — a Send button and a plain textarea
/// — makes the common act two gestures.
export function Composer({
  autoFocus = false,
  reveal = false,
  className,
}: {
  autoFocus?: boolean
  /// Raise the panel on sending.
  ///
  /// True in exactly one place: the home screen's brief, where the box is on
  /// the page and the answer has nowhere to appear until the panel is up. The
  /// panel's own composer is already in the panel, and the assistant's page is
  /// the conversation — opening a second copy of it over itself was the first
  /// thing anybody noticed about that screen.
  ///
  /// It is a property of the call site and not of `send`, because which
  /// surface a question came from is not something the session should know.
  reveal?: boolean
  className?: string
}) {
  const { send, busy, stop, setOpen } = useAssistant()
  const [draft, setDraft] = useState("")
  const box = useRef<HTMLTextAreaElement>(null)

  // Grow with the question, up to six lines. Measured rather than counted:
  // a pasted paragraph wraps, and counting newlines would leave it clipped.
  //
  // An empty box is left to `rows={1}` instead of being measured. Measuring it
  // was wrong exactly once — on mount, before the stylesheet had arrived, when
  // an unstyled textarea reports a scroll height of its own and the box opened
  // six lines tall and stayed there. Nothing has to be measured to know how
  // tall one empty row is.
  useEffect(() => {
    const element = box.current
    if (!element) return
    if (draft === "") {
      element.style.height = ""
      return
    }
    element.style.height = "auto"
    element.style.height = `${Math.min(element.scrollHeight, 132)}px`
  }, [draft])

  const submit = () => {
    if (!draft.trim() || busy) return
    send(draft)
    if (reveal) setOpen(true)
    setDraft("")
  }

  return (
    <div
      className={cn(
        "flex items-end gap-2 rounded-shell border border-hairline-2 bg-canvas px-3 py-2.5 shadow-soft transition-colors focus-within:border-accent",
        className
      )}
    >
      <textarea
        ref={box}
        value={draft}
        autoFocus={autoFocus}
        rows={1}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault()
            submit()
          }
        }}
        className="min-w-0 flex-1 resize-none bg-transparent text-meta leading-relaxed text-ink outline-none placeholder:text-mute"
      />
      {busy ? (
        <button
          type="button"
          onClick={stop}
          aria-label="Stop"
          className="grid size-7 shrink-0 place-items-center rounded-full bg-soft-2 text-body transition-colors hover:bg-hairline"
        >
          <Square className="size-3 fill-current" />
        </button>
      ) : (
        <button
          type="button"
          onClick={submit}
          disabled={!draft.trim()}
          aria-label="Ask"
          className="grid size-7 shrink-0 place-items-center rounded-full bg-dark text-on-dark transition-opacity disabled:opacity-25"
        >
          <ArrowUp className="size-3.5" />
        </button>
      )}
    </div>
  )
}
