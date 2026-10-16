import { cva, type VariantProps } from "class-variance-authority"

export const button = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-inner font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-cta text-cta-fg hover:bg-cta-hover [&_svg]:text-cta-fg",
        ghost:
          "border border-hairline-2 bg-canvas text-text shadow-soft hover:bg-soft-2 hover:text-ink [&_svg]:text-line-ico",
        soft: "bg-soft-2 text-text hover:bg-hairline [&_svg]:text-line-ico",
        quiet: "text-body hover:bg-soft-2 hover:text-ink [&_svg]:text-line-ico",
        danger: "bg-bad-bg text-bad-fg hover:brightness-97",
      },
      size: {
        default: "h-control px-2.5 text-control [&_svg]:size-4",
        sm: "h-[1.75rem] px-2 text-meta [&_svg]:size-3.5",
        icon: "size-control [&_svg]:size-4",
        // The thumb floor: this app is used one-handed on a phone.
        tap: "h-tap px-4 text-[0.9375rem] [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "ghost", size: "default" },
  }
)

export type ButtonStyle = VariantProps<typeof button>
