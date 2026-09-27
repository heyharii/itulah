import { button, type ButtonStyle } from "@/components/ui/button-style"
import { cn } from "@/lib/utils"

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, ButtonStyle {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(button({ variant, size }), className)}
      {...props}
    />
  )
}
