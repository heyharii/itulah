import { Link, type LinkProps } from "@tanstack/react-router"

import { button, type ButtonStyle } from "@/components/ui/button-style"
import { allNavItems } from "@/lib/navigation"
import type { SheetKey } from "@/lib/sheets"
import { cn } from "@/lib/utils"

/// A link to another screen in this app.
///
/// Use this instead of Router's `<Link>` for internal navigation. Router infers
/// its `to` type from a statically-declared route tree; ours is **generated**
/// from `lib/navigation.ts`, so there is no literal union for it to infer and
/// `<Link to="/inventory/pools">` does not typecheck.
///
/// That trade bought the thing the generation exists for — a path is declared
/// once, so a sidebar entry cannot 404 and a screen cannot be routed with
/// nothing linking to it. This component gives the guarantee back from the
/// other side: the destination is checked against the registry, and in
/// development a path nothing declares throws where it is written rather than
/// 404ing when somebody clicks it.
export function AppLink({
  to,
  sheet,
  variant,
  size,
  className,
  children,
  ...props
}: Omit<LinkProps, "to" | "search"> &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "className"> & {
    /// A path declared in `lib/navigation.ts`.
    to: string
    /// Open a sheet on arrival — "show me this order" as one link.
    sheet?: { key: SheetKey; value: string }
    /// Wear the button pill. The anchor takes the classes itself rather than
    /// wrapping a `<button>`: that nesting is invalid HTML, announces two
    /// controls where there is one, and on some browsers the keyboard
    /// activates the inner one and goes nowhere.
    variant?: ButtonStyle["variant"]
    size?: ButtonStyle["size"]
    className?: string
    children?: React.ReactNode
  }) {
  if (import.meta.env.DEV && !allNavItems.some((item) => item.path === to)) {
    throw new Error(
      `<AppLink to="${to}"> — no nav entry declares that path. Add it to the module's nav.ts, or fix the typo.`
    )
  }

  return (
    <Link
      // Router cannot type a generated tree; the registry check above is what
      // makes this safe, and it runs before the cast.
      to={to as LinkProps["to"]}
      search={sheet ? ({ [sheet.key]: sheet.value } as never) : undefined}
      className={cn(variant && button({ variant, size }), className)}
      {...props}
    >
      {children}
    </Link>
  )
}
