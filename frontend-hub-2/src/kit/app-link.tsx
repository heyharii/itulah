import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"

/// A link to a screen in this app.
///
/// ## Why this exists rather than using `<Link>` directly
///
/// TanStack Router types `to` as a union of the literal paths in its route
/// tree — real safety, and worth having. This app does not get it, because its
/// route tree is BUILT from the navigation registry in a loop (see
/// `src/router.tsx`), so the tree's type is `Route[]` and the union collapses
/// to `"." | ".." | "/"`.
///
/// The guarantee that replaces it is a runtime one, and it is not weaker in
/// the way that matters: `router.tsx` throws at startup if two screens claim
/// one path, and every route in the app comes from the same registry these
/// links point at. A path that is not a screen is a path that is not in the
/// registry — and the registry is the only place a path is ever written.
///
/// So the cast lives HERE, once, with that reasoning beside it, rather than in
/// every screen that links to another. One `as never` a reader can find and
/// weigh beats twenty they stop noticing.
export function AppLink({
  to,
  search,
  className,
  children,
}: {
  /// An absolute path declared in `src/modules/*/nav.tsx`.
  to: string
  search?: Record<string, string>
  className?: string
  children: ReactNode
}) {
  return (
    <Link to={to as never} search={search as never} className={className}>
      {children}
    </Link>
  )
}
