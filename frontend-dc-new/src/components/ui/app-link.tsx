import { Link, type LinkProps } from "@tanstack/react-router"

import { buttonStyle, type ButtonStyle } from "@/components/ui/button-style"
import { allNavItems } from "@/lib/navigation"
import type { SheetKey } from "@/lib/sheets"
import { cn } from "@/lib/utils"

/// A link to another screen in this app.
///
/// Use this instead of Router's `<Link>` for internal navigation. Router infers
/// its `to` type from a statically-declared route tree; ours is **generated**
/// from the station registry, so there is no literal union for it to infer and
/// `<Link to="/packing/fill">` does not typecheck.
///
/// That trade bought the thing the generation exists for — a path is declared
/// once, so a sidebar entry cannot 404 and a screen cannot be routed with
/// nothing linking to it. This component gives the guarantee back from the
/// other side: the destination is checked against the registry, and in
/// development a path nothing declares throws where it is written rather than
/// 404ing when somebody clicks it.
///
/// It also takes a sheet, so "show me this carton" is one link:
///
/// ```tsx
/// <AppLink to="/packing" sheet={{ key: "koli", value: id }}>
///   {koliNumber}
/// </AppLink>
/// ```
///
/// **Pass `variant` rather than wrapping a `<Button>`.** A link that looks
/// like a button is still a link: `<a><button/></a>` is invalid HTML, gives a
/// screen reader two controls where there is one, and on some browsers the
/// keyboard activates the inner button and navigates nowhere. With `variant`
/// the anchor itself wears the pill.
export function AppLink({
  to,
  sheet,
  variant,
  size,
  className,
  children,
  ...props
}: Omit<LinkProps, "to" | "search"> &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "className"> &
  ButtonStyle & {
    /// A path declared in a station's `nav.ts`.
    to: string
    /// Open a sheet on arrival — "show me this carton" as one link.
    sheet?: { key: SheetKey; value: string }
    className?: string
    children?: React.ReactNode
  }) {
  if (import.meta.env.DEV && !allNavItems.some((item) => item.path === to)) {
    throw new Error(
      `<AppLink to="${to}"> — no nav entry declares that path. Add it to the station's nav.ts, or fix the typo.`
    )
  }

  return (
    <Link
      // Router cannot type a generated tree; the registry check above is what
      // makes this safe, and it runs before the cast.
      to={to as LinkProps["to"]}
      search={sheet ? ({ [sheet.key]: sheet.value } as never) : undefined}
      className={cn(
        variant !== undefined && buttonStyle({ variant, size }),
        className
      )}
      {...props}
    >
      {children}
    </Link>
  )
}
