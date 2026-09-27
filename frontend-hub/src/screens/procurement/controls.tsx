import { AppLink } from "@/components/ui/app-link"
import type { SheetKey } from "@/lib/sheets"
import { cn } from "@/lib/utils"

/// The two controls `src/components/ui/` does not carry yet.
///
/// Inlined here rather than added to the shared primitives because a module
/// owns its own folder and nothing else; both are candidates for promotion the
/// moment a second module wants one. Every value is a token — these are the
/// existing `<Input>` and `<Button>` shapes wearing a different element.

/// A link that reads as a button — the ghost pill, but it navigates.
///
/// `<Button>` renders a `<button>`, and a destination inside an `onClick` is a
/// link a person cannot middle-click, copy or open in a new tab. Anything that
/// goes somewhere is an anchor.
export function LinkButton({
  to,
  sheet,
  className,
  children,
}: {
  to: string
  sheet?: { key: SheetKey; value: string }
  className?: string
  children: React.ReactNode
}) {
  return (
    <AppLink
      to={to}
      sheet={sheet}
      className={cn(
        "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full border border-hairline-2 bg-canvas px-3 text-[0.875rem] font-medium whitespace-nowrap text-text transition-colors hover:bg-soft-2",
        className
      )}
    >
      {children}
    </AppLink>
  )
}
