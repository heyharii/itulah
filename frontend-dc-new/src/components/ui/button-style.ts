import { cva, type VariantProps } from "class-variance-authority"

/// The button's classes, in their own module.
///
/// Two components wear them: `<Button>`, and `<AppLink>` when it is a link
/// that *looks* like a button. That second case is the reason this is not
/// simply a const inside `button.tsx` — a link styled as a button has to be an
/// `<a>` carrying these classes, never an `<a>` wrapping a `<button>`. Nesting
/// interactive content inside interactive content is invalid HTML, it gives a
/// screen reader two controls where there is one, and depending on the browser
/// the keyboard activates the inner one and goes nowhere.
///
/// (It also cannot live in `button.tsx` for a duller reason: a file that
/// exports both components and plain values loses fast refresh.)
///
/// Pills for everything interactive. There is no radius between a pill and a
/// card in this language, so a button never gets `rounded-lg`.
///
/// `dark` is the one black CTA and there is at most one per screen: the black
/// is deliberately not an accent, so the CTA and the indigo never compete for
/// the same meaning.
export const buttonStyle = cva(
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
        /// **The floor size, and the default here.** 44 real pixels, because
        /// this app is used standing up with a handheld and often in gloves.
        ///
        /// The hub's `default` is the prototypes' 32-declared office pill and
        /// it is still available below — but it is the exception on this
        /// surface, not the rule, so it is not what a control gets by
        /// forgetting to say. Inheriting the office size blindly is exactly
        /// how a warehouse app ends up unusable on the only device it runs on.
        tap: "h-tap px-5 text-[0.84375rem] [&_svg]:size-4",
        /// 32 declared. For controls beside a page title on a desktop, where a
        /// mouse is doing the pointing.
        default: "h-8 px-3 text-[0.78125rem] [&_svg]:size-3.5",
        /// Inside a dense row a mouse can reach and a thumb should not have to.
        sm: "h-[1.625rem] px-2.5 text-[0.71875rem] [&_svg]:size-3",
        icon: "size-8 [&_svg]:size-4",
        iconTap: "size-tap [&_svg]:size-[1.125rem]",
      },
    },
    defaultVariants: { variant: "ghost", size: "tap" },
  }
)

export type ButtonStyle = VariantProps<typeof buttonStyle>
