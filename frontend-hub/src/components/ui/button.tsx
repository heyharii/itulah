import { Check } from "lucide-react"

import { button, type ButtonStyle } from "@/components/ui/button-style"
import { cn } from "@/lib/utils"

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, ButtonStyle {
  /// The word an icon-only button shows in the All white look, where every button
  /// says what it does (owner, 2026-10-12: "jangan ada icon button … make
  /// button semua text seperti print"). Left out, it is read off `aria-label`
  /// (`wordOf`).
  word?: string
  /// The write it starts is on its way to the server.
  ///
  /// Not just `disabled`, which is what a hundred call sites passed: a
  /// disabled button will never work, and a pending one is working right now.
  /// So it is disabled — a second press would send the write twice — and
  /// also `aria-busy`, and faded less than a dead one, so the two states stop
  /// looking identical. No spinner (PATTERN.md): the label says it, and the
  /// caller still owns the words — "Saving…", "Posting…".
  pending?: boolean
  /// The write landed: the button says so in its own place, green, with a
  /// tick ("Sent to count"), for the moment before its sheet closes
  /// (`useSaid` in `lib/pull-in.ts`).
  said?: string | null
}

/// Pills for everything interactive. There is no radius between a pill and a
/// card in this language, so a button never gets `rounded-lg`.
///
/// Anything that goes somewhere is an `<AppLink>`, not this — see
/// `button-style.ts` for why that distinction is not cosmetic.
export function Button({
  className,
  variant,
  size,
  pending,
  said,
  word,
  disabled,
  onMouseDown,
  onClick,
  children,
  ...props
}: ButtonProps) {
  const done = said !== undefined && said !== null
  // Cancel is filled red wherever it is written (UI-PATTERNS.md §4,
  // hub-ui-patterns, 14 Oct) — one rule here rather than seventy screens each
  // remembering it. Only the plain word, and only from a supporting style: a
  // Cancel somebody made primary on purpose keeps it.
  const tone =
    cancels(children) &&
    (variant === undefined ||
      variant === null ||
      variant === "ghost" ||
      variant === "quiet" ||
      variant === "soft")
      ? "destructive"
      : variant
  /// An icon and nothing else: in the All white look it is drawn as its word.
  const shownWord = iconOnly(children)
    ? (word ?? wordOf(props["aria-label"] ?? props.title))
    : null
  return (
    <button
      type="button"
      // A supporting verb (Edit, Print …): never promoted to the sheet's main
      // action in its foot (white.css `.foot-lifted`).
      data-support={supports(children)}
      disabled={pending === true || disabled || done}
      aria-busy={pending === true ? true : undefined}
      className={cn(
        button({ variant: tone, size }),
        shownWord !== null && "btn-iconly",
        // A verb that takes something away reads red wherever it stands
        // (Delete, Remove …), so the colour says it before the word does.
        takesAway(children, props["aria-label"]) && "btn-takes-away",
        done &&
          "border-transparent bg-ok-bg text-ok-fg shadow-none disabled:opacity-100 [&_svg]:text-ok-fg",
        className
      )}
      // On a phone a press on a button while a field has the keyboard used to
      // take the focus first: the keyboard went down, a sheet's footer moved
      // down with it, and the tap landed on nothing — the button had to be
      // pressed twice (owner, 2026-10-06: Done, Save, a choice in a sheet).
      // The press now leaves the focus where it is, so nothing moves under the
      // finger, and the field is let go of in the click, just before the action
      // runs, so whatever a field commits on blur is committed first.
      onMouseDown={(event) => {
        onMouseDown?.(event)
        if (!event.defaultPrevented && typingOnATouchScreen())
          event.preventDefault()
      }}
      onClick={(event) => {
        if (typingOnATouchScreen())
          (document.activeElement as HTMLElement).blur()
        onClick?.(event)
      }}
      {...props}
    >
      {done ? (
        <>
          <Check />
          {said}
        </>
      ) : (
        <>
          {children}
          {shownWord !== null && (
            <span aria-hidden className="btn-word hidden">
              {shownWord}
            </span>
          )}
        </>
      )}
    </button>
  )
}

/// Whether the button's word is a supporting verb — one that reads, copies or
/// opens the form rather than doing the record's work (hub-ui-patterns: Print
/// and Edit are ghosts in a record's foot).
function supports(children: React.ReactNode): string | undefined {
  const list = Array.isArray(children) ? children : [children]
  const word = list.find((one) => typeof one === "string")
  if (typeof word !== "string") return undefined
  const verb = /^(Edit|Print|Download|Duplicate)\b/.exec(word.trim())
  return verb === null ? undefined : verb[1].toLowerCase()
}

/// Whether the button's word is Cancel — leaving a form or a question without
/// doing it.
function cancels(children: React.ReactNode): boolean {
  return typeof children === "string" && children.trim() === "Cancel"
}

/// Whether the button's verb removes something: its word, or for an icon its
/// label.
function takesAway(children: React.ReactNode, label: string | undefined) {
  const text = typeof children === "string" ? children : (label ?? "")
  return /^(Delete|Remove|Take .* (off|out)|Discard|Deactivate)\b/.test(text)
}

/// Whether a button's content is one icon and no words.
function iconOnly(children: React.ReactNode): boolean {
  const list = Array.isArray(children) ? children.filter(Boolean) : [children]
  return (
    list.length === 1 &&
    typeof list[0] === "object" &&
    list[0] !== null &&
    "type" in (list[0] as object) &&
    typeof (list[0] as { type: unknown }).type !== "string"
  )
}

/// The short word for an icon-only button, from what it tells a screen
/// reader: "Edit Kemeja" says Edit, "Take Kemeja off this order" says Remove,
/// "Change the price of X" says Change price. Steppers and arrows (One more,
/// Next month, Move up) keep their glyph: a "+" says it better than a word.
function wordOf(label: string | undefined): string | null {
  if (!label) return null
  if (/^(One (more|less)|Next|Previous|Move (up|down)|Wrong|Right)\b/.test(label))
    return null
  if (/^Take\b/.test(label)) return "Remove"
  if (/^Change the price\b/.test(label)) return "Change price"
  const lead = /^(Edit|Remove|Open|Retry|Set up|Set PIC|Change PIC|Delete|Clear)\b/.exec(
    label
  )
  if (lead) return lead[1]
  return label.split(/,| of | in | for /)[0]
}

/// A touch screen with the keyboard up: a text field has the focus.
function typingOnATouchScreen(): boolean {
  if (typeof window === "undefined") return false
  if (!window.matchMedia("(pointer: coarse)").matches) return false
  const field = document.activeElement
  return (
    field instanceof HTMLTextAreaElement ||
    (field instanceof HTMLInputElement &&
      ![
        "checkbox",
        "radio",
        "button",
        "submit",
        "range",
        "file",
        "color",
      ].includes(field.type))
  )
}
