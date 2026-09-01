import { MoonIcon, SunIcon } from "lucide-react"

import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { useSession } from "@/lib/session"
import { syncHealth } from "@itulah/contract/client"
import { sync } from "@/lib/api"
import { useQuery } from "@tanstack/react-query"
import { cn } from "@/lib/utils"

const OUTBOX_TONE = {
  current: "bg-emerald-500",
  behind: "bg-amber-500",
  blocked: "bg-destructive",
  off: "bg-muted-foreground",
} as const

const OUTBOX_WORD = {
  current: "sent",
  behind: "waiting",
  blocked: "stuck",
  off: "not sending",
} as const

/// Who is here, where here is, and whether what is written here is getting
/// out.
///
/// The outbox light belongs in the header rather than on a page of its own.
/// An Edge is built to keep working when the line is down, so a site can trade
/// all day with nothing leaving the building and no symptom anybody would
/// notice — the one place that cannot be missed is beside the clock.
export function TopBar() {
  const { identity, node, signOut } = useSession()
  const { theme, setTheme } = useTheme()

  const status = useQuery({
    queryKey: ["sync", "status"],
    queryFn: ({ signal }) => sync.status(signal),
    refetchInterval: 15_000,
  })

  const health = status.data === undefined ? null : syncHealth(status.data)

  return (
    <header className="bg-background/92 sticky top-0 z-30 flex items-center gap-3 border-b px-4 py-2.5 backdrop-blur sm:px-6">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{identity.display_name}</p>
        <p className="text-muted-foreground truncate text-[11px]">
          {identity.username} · {identity.role}
          {node === null ? "" : ` · ${node.node_id}`}
        </p>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {health !== null && (
          <span className="text-muted-foreground hidden items-center gap-1.5 text-[11px] sm:flex">
            <span className={cn("size-2 rounded-full", OUTBOX_TONE[health])} />
            {status.data !== undefined && status.data.pending_facts > 0
              ? `${status.data.pending_facts} ${OUTBOX_WORD[health]}`
              : OUTBOX_WORD[health]}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label="Switch theme"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? (
            <SunIcon className="size-4" />
          ) : (
            <MoonIcon className="size-4" />
          )}
        </Button>
        <Button variant="outline" size="sm" onClick={signOut}>
          Sign out
        </Button>
      </div>
    </header>
  )
}
