import { Link, type LinkProps } from "@tanstack/react-router"

import { allNavItems } from "@/lib/navigation"
import { cn } from "@/lib/utils"

/// A link to another screen in this app.
///
/// Use this instead of Router's `<Link>`. Router infers its `to` type from a
/// statically-declared route tree; ours is **generated** from
/// `lib/navigation.ts`, so there is no literal union for it to infer and
/// `<Link to="/sell/tender">` does not typecheck.
///
/// That trade bought the thing the generation exists for — a path is declared
/// once, so a tab cannot 404 and a screen cannot be routed with nothing leading
/// to it. This component gives the guarantee back from the other side: the
/// destination is checked against the registry, and in development a path
/// nothing declares throws where it is written rather than 404ing when somebody
/// taps it.
export function AppLink({
  to,
  search,
  className,
  children,
  ...props
}: Omit<LinkProps, "to" | "search"> &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "className"> & {
    /// A path declared in `lib/navigation.ts`.
    to: string
    search?: Record<string, string | undefined>
    className?: string
    children?: React.ReactNode
  }) {
  if (import.meta.env.DEV && !allNavItems.some((item) => item.path === to)) {
    throw new Error(
      `<AppLink to="${to}"> — no nav entry declares that path. Add it to lib/navigation.ts, or fix the typo.`,
    )
  }

  return (
    <Link
      // Router cannot type a generated tree; the registry check above is what
      // makes this safe, and it runs before the cast.
      to={to as LinkProps["to"]}
      search={search as never}
      className={cn(className)}
      {...props}
    >
      {children}
    </Link>
  )
}
