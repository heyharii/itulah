import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Bell, ChevronRight } from "lucide-react"
import { useState } from "react"

import { AppIcon } from "@/components/shell/app-icon"
import { AppSheet } from "@/components/shell/app-sheet"
import { PageContent } from "@/components/shell/app-shell"
import { appsFor, onlyScreen, type AppTile } from "@/lib/apps"
import { listNotifications, systemKeys } from "@/lib/queries/system"
import { useIdentity } from "@/lib/session"

/// The phone's first tab: today, then every app this account may open.
///
/// A super-app's launcher (Gojek's services grid), for the owner's reason: on
/// a phone the rail and the sidebar are one drawer behind a hamburger, and a
/// department nobody can see is a department nobody finds. Each tile opens its
/// screens in a sheet (`AppSheet`), or goes straight in when there is only one.
///
/// "Today" leads because it is what a phone is opened for between two other
/// things: who is asking, and what is waiting. Clock-in and leave join it when
/// the employee app moves into Profile (stage 3); for now it greets and says
/// what is unread.
export function Apps() {
  const identity = useIdentity()
  const tiles = appsFor(identity.data?.role)
  const [tile, setTile] = useState<AppTile | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  // The bell's own query and key, so the count here and the badge on the
  // Notifications tab are one cache entry, not two requests.
  const feed = useQuery({
    queryKey: [...systemKeys.notifications(), "bell", 8] as const,
    queryFn: ({ signal }) => listNotifications(8, signal),
    staleTime: 30_000,
  })
  const unread = feed.data?.unread ?? 0

  const name = (
    identity.data?.display_name ??
    identity.data?.username ??
    ""
  ).split(" ")[0]
  const now = new Date()
  const hour = now.getHours()
  const greeting =
    hour < 11
      ? "Good morning"
      : hour < 15
        ? "Good afternoon"
        : hour < 19
          ? "Good evening"
          : "Good night"

  return (
    <PageContent>
      {/* The greeting is the page's large title, the way a phone's own apps
          open — no card around it. The date above it is the quiet line. */}
      <header className="mb-5">
        <p className="text-[0.875rem] font-medium text-mute">
          {now.toLocaleDateString("en-GB", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </p>
        <h1 className="mt-1 text-[1.75rem] leading-[1.12] font-semibold tracking-[-0.025em] text-ink">
          {greeting}
          {name !== "" && `, ${name}`}
        </h1>
      </header>

      {unread > 0 && (
        <Link
          to={"/system/notifications" as string}
          className="mb-6 flex min-h-16 items-center gap-3 rounded-2xl border border-hairline bg-canvas px-4 shadow-soft transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.985]"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-bg text-accent">
            <Bell className="size-[1.125rem]" />
          </span>
          <span className="min-w-0 flex-1">
            <b className="block text-[0.9375rem] font-semibold text-ink">
              {unread === 1
                ? "1 unread notification"
                : `${unread} unread notifications`}
            </b>
            <span className="block text-meta text-mute">
              What is waiting on you
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-line-ico" />
        </Link>
      )}

      <h2 className="mb-2.5 px-1 text-[0.9375rem] font-semibold tracking-[-0.01em] text-ink">
        Apps
      </h2>
      {identity.isPending ? null : tiles.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-hairline-strong px-5 py-7 text-center text-[0.875rem] leading-relaxed text-body">
          No office apps for this account. Your messages, notifications and
          profile are in the bar below.
        </p>
      ) : (
        // The grid stands on one white panel, the way a super-app gathers
        // its services — so the tiles read as one set, not fifteen things
        // floating on the page's grey.
        <ul className="grid grid-cols-4 gap-x-1 gap-y-5 rounded-3xl border border-hairline bg-canvas px-2 py-5 shadow-soft sm:grid-cols-6 lg:grid-cols-8">
          {tiles.map((one) => {
            const only = onlyScreen(one)
            const face = (
              <>
                <AppIcon
                  id={one.id}
                  icon={one.icon}
                  className="transition-[scale] duration-(--t-press) ease-(--ease-out) group-active:scale-[0.92]"
                />
                <span className="w-full truncate px-0.5 text-center text-[0.875rem] font-medium text-text">
                  {one.label}
                </span>
              </>
            )
            return (
              <li key={one.id}>
                {only !== undefined ? (
                  <Link
                    to={only}
                    className="group flex flex-col items-center gap-2"
                  >
                    {face}
                  </Link>
                ) : (
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    onClick={() => {
                      setTile(one)
                      setSheetOpen(true)
                    }}
                    className="group flex w-full flex-col items-center gap-2"
                  >
                    {face}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <AppSheet tile={tile} open={sheetOpen} onOpenChange={setSheetOpen} />
    </PageContent>
  )
}
