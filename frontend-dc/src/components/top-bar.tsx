import { MoonIcon, SunIcon } from "lucide-react"

import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { setBenchActor, useBenchActor } from "@/lib/bench"
import { useSession } from "@/lib/session"
import { Input } from "@/components/ui/input"
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
  const bench = useBenchActor()
  // Only where the node has no principal of its own. On an authenticated node
  // this field would be a lie: the server overwrites `actor_id` from the
  // session and would ignore anything typed here.
  const unauthenticated = node?.auth === "DISABLED"

  const status = useQuery({
    queryKey: ["sync", "status"],
    queryFn: ({ signal }) => sync.status(signal),
    refetchInterval: 15_000,
  })

  const health = status.data === undefined ? null : syncHealth(status.data)

  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-background/92 px-4 py-2.5 backdrop-blur sm:px-6">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {unauthenticated ? (bench ?? identity.display_name) : identity.display_name}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {unauthenticated ? "no sign-in" : `${identity.username} · ${identity.role}`}
          {node === null ? "" : ` · ${node.node_id}`}
        </p>
      </div>

      {/* Who is at the bench, on a node nobody signs in to.
          Receiving needs two names — the person who counted cannot be the
          person who accepts — and a node running without authentication has
          only one to give. Typing the name here is what makes the second pair
          of hands a different pair. */}
      {unauthenticated && (
        <label className="hidden min-w-0 items-center gap-2 sm:flex">
          <span className="shrink-0 text-[11px] text-muted-foreground">
            At this bench
          </span>
          <Input
            value={bench ?? ""}
            placeholder={identity.username}
            aria-label="Who is working at this bench"
            onChange={(event) => setBenchActor(event.target.value)}
            className="h-7 w-40 text-xs"
          />
        </label>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {health !== null && (
          <span className="hidden items-center gap-1.5 text-[11px] text-muted-foreground sm:flex">
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
