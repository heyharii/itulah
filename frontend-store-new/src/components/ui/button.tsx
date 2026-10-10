import { button, type ButtonStyle } from "@/components/ui/button-style"
import { cn } from "@/lib/utils"

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, ButtonStyle {
  /// The write it starts is on its way to the server.
  ///
  /// Not just `disabled`: a disabled button will never work, and a pending one
  /// is working right now. So it is disabled — a second press would send the
  /// write twice — and also `aria-busy`, and faded less than a dead one, so the
  /// two states stop looking identical. No spinner: the label says it, and the
  /// caller still owns the words — "Saving…", "Posting…".
  pending?: boolean
}

/// The button — the hub's, copied. Variants `primary` (the one filled CTA),
/// `ghost` (the default), `soft`, `tint` (a card's foot), `quiet`, `danger`;
/// sizes `default` (36 on a mouse, 44 on a finger), `sm`, `lg` (44, a form's
/// own), `icon`, `card` (32 to see, 44 to land on).
///
/// Anything that goes somewhere is an `<AppLink>`, not this — see
/// `button-style.ts` for why that distinction is not cosmetic.
export function Button({
  className,
  variant,
  size,
  block,
  pending,
  disabled,
  onMouseDown,
  onClick,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={pending === true || disabled}
      aria-busy={pending === true ? true : undefined}
      className={cn(button({ variant, size, block }), className)}
      // On a phone a press on a button while a field has the keyboard used to
      // take the focus first: the keyboard went down, a sheet's footer moved
      // down with it, and the tap landed on nothing — the button had to be
      // pressed twice. The press now leaves the focus where it is, so nothing
      // moves under the finger, and the field is let go of in the click, just
      // before the action runs, so whatever a field commits on blur is
      // committed first.
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
    />
  )
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
