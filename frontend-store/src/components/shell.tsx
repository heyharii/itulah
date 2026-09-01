import { Link } from "@tanstack/react-router"

import { Button } from "@/components/ui/button"
import { useSession } from "@/lib/session"

/// Three places, not a menu. A shop has a till, a price to look up, and a
/// manager's view of what it took; a device that offered more choices than that
/// is one somebody gets lost in mid-transaction.
///
/// The till is first and always will be: it is what the device is for, so it
/// is what `/` answers.
const AREAS = [
  { to: "/", label: "till" },
  { to: "/prices", label: "prices" },
  { to: "/sales", label: "sales" },
] as const

/// Everything that stays on screen while the areas change.
export function TillShell({ children }: { children: React.ReactNode }) {
  const { identity, node, signOut } = useSession()

  return (
    // `h-svh`, not `min-h-svh`: the catalogue scrolls inside itself, and a
    // page that grew instead would put a second scrollbar around the lot.
    <main className="flex h-svh flex-col">
      <header className="flex items-center gap-4 border-b px-6 py-4">
        <div className="min-w-0">
          <p className="truncate font-medium">{identity.display_name}</p>
          <p className="text-muted-foreground text-xs">
            {identity.username} · {identity.role}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {node !== null && (
            <span className="text-muted-foreground hidden text-xs sm:inline">
              {node.node_id} · {node.node_role}
            </span>
          )}
          <Button variant="outline" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </header>
      <nav className="flex gap-1 border-b px-4 py-2" aria-label="Areas">
        {AREAS.map((area) => (
          <Link
            key={area.to}
            to={area.to}
            // Only the till is matched exactly. Every other path starts with
            // `/`, so an inexact match would leave the till lit from wherever
            // somebody actually is.
            activeOptions={{ exact: area.to === "/" }}
            className="cursor-pointer rounded-4xl px-4 py-2 text-sm font-medium capitalize transition-colors"
            activeProps={{
              className: "bg-primary text-primary-foreground",
              "aria-current": "page",
            }}
            inactiveProps={{ className: "text-muted-foreground hover:bg-muted" }}
          >
            {area.label}
          </Link>
        ))}
      </nav>
      {children}
    </main>
  )
}
