import { button, type ButtonStyle } from "@/components/ui/button-style"
import { cn } from "@/lib/utils"

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, ButtonStyle {}

/// Pills for everything interactive. There is no radius between a pill and a
/// card in this language, so a button never gets `rounded-lg`.
///
/// Anything that goes somewhere is an `<AppLink>`, not this — see
/// `button-style.ts` for why that distinction is not cosmetic.
export function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(button({ variant, size }), className)}
      {...props}
    />
  )
}
