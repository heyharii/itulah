import { button, type ButtonStyle } from "@/components/ui/button-style"
import { cn } from "@/lib/utils"

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, ButtonStyle {
  /// The write it starts is on its way to the server.
  ///
  /// Not just `disabled`, which is what a hundred call sites passed: a
  /// disabled button will never work, and a pending one is working right now.
  /// So it is disabled — a second press would send the write twice — and
  /// also `aria-busy`, and faded less than a dead one, so the two states stop
  /// looking identical. No spinner (PATTERN.md): the label says it, and the
  /// caller still owns the words — "Saving…", "Posting…".
  pending?: boolean
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
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={pending === true || disabled}
      aria-busy={pending === true ? true : undefined}
      className={cn(button({ variant, size }), className)}
      {...props}
    />
  )
}
