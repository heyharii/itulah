import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/// Cloud Hub buttons: pill, 32×12, 12.5/500. One black CTA; ghost is white +
/// hairline; soft is `{soft-2}`. Spec 500, not the prototypes' 550.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-full border border-transparent font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-[var(--os-accent,#3c52f0)]/30 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--os-ink,#1d1d1f)] text-white hover:bg-black [&_svg]:text-white",
        outline:
          "border-[var(--os-hairline-2,#e6e6ea)] bg-[var(--os-canvas,#fff)] text-[var(--os-text,#46464d)] hover:bg-[var(--os-soft-2,#f3f3f5)] [&_svg]:text-[var(--os-line-ico,#abacb2)]",
        secondary:
          "bg-[var(--os-soft-2,#f3f3f5)] text-[var(--os-text,#46464d)] hover:bg-[#ececee] [&_svg]:text-[var(--os-line-ico,#abacb2)]",
        ghost:
          "border-[var(--os-hairline-2,#e6e6ea)] bg-[var(--os-canvas,#fff)] text-[var(--os-text,#46464d)] hover:bg-[var(--os-soft-2,#f3f3f5)] [&_svg]:text-[var(--os-line-ico,#abacb2)]",
        destructive:
          "bg-[var(--os-bad-bg,#fbeaea)] text-[var(--os-bad,#d05151)] hover:bg-[var(--os-bad,#d05151)] hover:text-white",
        link: "text-[var(--os-ink,#1d1d1f)] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 gap-1.5 px-3 text-[0.78125rem]",
        xs: "h-6 gap-1 px-2.5 text-[0.6875rem] [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3 text-[0.78125rem]",
        lg: "h-9 gap-1.5 px-4 text-[0.8125rem]",
        icon: "size-8 px-0",
        "icon-xs": "size-6 px-0 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 px-0",
        "icon-lg": "size-9 px-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
