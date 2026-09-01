import { cva, type VariantProps } from "class-variance-authority"

/// The pill, as a value rather than a component.
///
/// Its own module because a file that exports both a component and a value
/// loses fast refresh — and because `<AppLink>` needs the classes without the
/// element. An anchor that wants to look like a button must BE an anchor:
/// wrapping a `<button>` in an `<a>` is invalid HTML, announces two controls
/// to a screen reader, and on some browsers the keyboard activates the inner
/// one and goes nowhere.
///
/// `dark` is the one black CTA and there is at most one per screen: the black
/// is deliberately not an accent, so the CTA and the indigo never compete.
export const button = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        dark: "bg-ink text-white hover:bg-black",
        ghost:
          "border border-hairline-2 bg-canvas text-text hover:bg-soft-2 [&_svg]:text-line-ico",
        soft: "bg-soft-2 text-text hover:bg-hairline [&_svg]:text-line-ico",
        quiet: "text-body hover:bg-soft-2 hover:text-ink [&_svg]:text-line-ico",
        danger: "bg-bad-bg text-bad-fg hover:brightness-97",
      },
      size: {
        // 32 declared. The prototypes' one button height; `sm` exists only for
        // controls that sit inside a table row.
        default: "h-8 px-3 text-[0.78125rem] [&_svg]:size-3.5",
        sm: "h-[1.625rem] px-2.5 text-[0.71875rem] [&_svg]:size-3",
        icon: "size-8 [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "ghost", size: "default" },
  }
)

export type ButtonStyle = VariantProps<typeof button>
