import { buttonStyle, type ButtonStyle } from "@/components/ui/button-style"
import { cn } from "@/lib/utils"

/// A button. The classes live in `button-style.ts` because `<AppLink>` wears
/// them too — see the note there on why a link that looks like a button must
/// be an `<a>` carrying these classes rather than an `<a>` around a `<button>`.
export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, ButtonStyle {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(buttonStyle({ variant, size }), className)}
      {...props}
    />
  )
}
