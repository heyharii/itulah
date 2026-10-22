import { useQuery } from "@tanstack/react-query"
import { Link, useHydrated } from "@tanstack/react-router"
import { Bell, ChevronRight, Search } from "lucide-react"

import { AppIcon } from "@/components/shell/app-icon"
import { PageContent } from "@/components/shell/app-shell"
import { hasMattePicture, MatteTile } from "@/components/ui/matte-picture"
import { useOpenPalette } from "@/components/shell/palette-opener"
import { appsFor, landingOf, type AppTile } from "@/lib/apps"
import { weekday } from "@/lib/format"
import { listNotifications, systemKeys } from "@/lib/queries/system"
import { useIdentity } from "@/lib/session"
import { cn } from "@/lib/utils"

const noCount = () => null

/// A tile's count, once the page is hydrated: the server renders before the
/// counts arrive and the browser may already hold them, and a figure (or a
/// label naming it) only one side drew is a hydration mismatch.
function useHydratedCount(tile: AppTile) {
  const count = (tile.useCount ?? noCount)()
  return useHydrated() ? count : null
}

/// What is waiting in a department, at the end of its row: the same total the
/// desk rail's mark carries. Nothing is drawn for none, and "99+" for a pile —
/// the figure is a nudge, the department has the numbers.
function Waiting({ tile }: { tile: AppTile }) {
  // A hook that is the same one on every render of this row (a tile's count
  // never changes), so calling it here is safe.
  const waiting = useHydratedCount(tile)
  if (typeof waiting !== "number" || waiting <= 0) return null
  return (
    <span
      className={cn(
        "min-w-7 shrink-0 rounded-full px-2 text-center text-[0.9375rem] leading-6 font-semibold tabular-nums",
        tile.badge === "bad"
          ? "bg-bad-bg text-bad-fg"
          : "bg-warn-bg text-warn-fg"
      )}
    >
      {waiting > 99 ? "99+" : waiting}
    </span>
  )
}

/// One department on the Soft grid: its matte picture stepping out of its
/// pastel square, what is waiting as the red tag on it, its name under.
/// A tile the matte set has no picture for keeps its coloured glyph.
function GridTile({ tile }: { tile: AppTile }) {
  // The same per-tile hook `Waiting` calls: a tile's count never changes.
  const waiting = useHydratedCount(tile)
  const to = landingOf(tile)
  return (
    <li>
      <Link
        to={(to ?? "/apps") as string}
        aria-label={
          typeof waiting === "number" && waiting > 0
            ? `${tile.label}, ${waiting} waiting`
            : tile.label
        }
        className="group flex flex-col items-center gap-1.5 rounded-2xl pt-2.5 pb-1.5 transition-colors duration-(--t-press) active:bg-soft"
      >
        {hasMattePicture(tile.id) ? (
          <MatteTile
            id={tile.id}
            count={waiting}
            className="transition-[scale] duration-(--t-press) ease-(--ease-out) group-active:scale-[0.92]"
          />
        ) : (
          <AppIcon id={tile.id} icon={tile.icon} size="lg" className="my-0.5" />
        )}
        <span className="w-full text-center text-[0.9375rem] leading-5 tracking-[-0.015em] whitespace-nowrap text-[#484848]">
          {tile.label}
        </span>
      </Link>
    </li>
  )
}

/// The phone's first tab: today, then every app this account may open.
///
/// A super-app's launcher (Gojek's services grid), for the owner's reason: on
/// a phone the rail and the sidebar are one drawer behind a hamburger, and a
/// department nobody can see is a department nobody finds. Each row goes
/// straight into its department, on the screen the desk rail opens on; the
/// department's other screens are the bar at the bottom.
///
/// "Today" leads because it is what a phone is opened for between two other
/// things: who is asking, and what is waiting. Clock-in and leave join it when
/// the employee app moves into Profile (stage 3); for now it greets and says
/// what is unread.
export function Apps() {
  const identity = useIdentity()
  const openPalette = useOpenPalette()
  const tiles = appsFor(identity.data?.role)

  // The bell's own query and key, so the count here and the badge on the
  // Notifications tab are one cache entry, not two requests.
  const feed = useQuery({
    queryKey: [...systemKeys.notifications(), "bell", 8] as const,
    queryFn: ({ signal }) => listNotifications(8, signal),
    staleTime: 30_000,
  })
  // Read once hydrated, like the counts: the server has no unread figure yet
  const hydrated = useHydrated()
  const unread = hydrated ? (feed.data?.unread ?? 0) : 0

  const name = (
    identity.data?.display_name ??
    identity.data?.username ??
    ""
  ).split(" ")[0]
  // The weekday and the time of day are the browser's own: the server's
  // clock (and zone) is not the person's, so the page names neither until it
  // is hydrated, and says "Hello" in the meantime rather than a wrong hour.
  const now = hydrated ? new Date() : null
  const hour = now?.getHours() ?? 0
  const greeting =
    now === null
      ? "Hello"
      : hour < 11
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
        <p className="text-[0.9375rem] font-medium text-mute">
          {now === null ? "\u00a0" : weekday(now)}
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

      <h2 className="look-now-only mb-2.5 px-1 text-[0.9375rem] font-semibold tracking-[-0.01em] text-ink">
        Apps
      </h2>
      {identity.isPending ? null : tiles.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-hairline-strong px-5 py-7 text-center text-[0.9375rem] leading-relaxed text-body">
          No office apps for this account. Your messages, notifications and
          profile are in the bar below.
        </p>
      ) : (
        // One white panel of rows, the way a phone's own Settings lists its
        // sections (owner, 2026-10-06: "homenya row saja"). Four icons across
        // a 375px phone left each name 83px, and "Procurement" and
        // "Merchandise" touched; a row gives any name the width of the line
        // and has room, at its right, for what is waiting in the department.
        <>
          {/* Soft (lib/look.ts): the departments as Gojek's grid of matte
            pictures, three across on a phone and four from 440px: at 414 four
            across put "Procurement" and "Merchandise" end to end. */}
          <ul className="look-soft-only grid grid-cols-3 gap-y-2 rounded-3xl bg-canvas px-1 py-3 shadow-soft min-[440px]:grid-cols-4 md:grid-cols-6 md:py-5">
            {tiles.map((one) => (
              <GridTile key={one.id} tile={one} />
            ))}
          </ul>
          <ul className="look-now-only overflow-hidden rounded-3xl border border-hairline bg-canvas shadow-soft [&>li+li]:border-t [&>li+li]:border-hairline">
            {tiles.map((one) => {
              const to = landingOf(one)
              return (
                <li key={one.id}>
                  <Link
                    to={(to ?? "/apps") as string}
                    className="group flex h-14 w-full items-center gap-3 px-3.5 text-left transition-colors duration-(--t-press) active:bg-soft"
                  >
                    <AppIcon
                      id={one.id}
                      icon={one.icon}
                      size="md"
                      className="transition-[scale] duration-(--t-press) ease-(--ease-out) group-active:scale-[0.92]"
                    />
                    <span className="min-w-0 flex-1 truncate text-[1rem] font-medium text-ink">
                      {one.label}
                    </span>
                    <Waiting tile={one} />
                    <ChevronRight className="size-4 shrink-0 text-line-ico" />
                  </Link>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {/* A phone has no ⌘K, and the screens kept out of the menus (Stores,
          Members, the Ops stations, most of Finance's setup) are reached by
          typing where to go. The row is the palette's door, at the foot of
          the page with every other action. */}
      {openPalette !== null && (
        <button
          type="button"
          onClick={openPalette}
          className="group mt-3 flex h-14 w-full items-center gap-3 rounded-3xl border border-hairline bg-canvas px-3.5 text-left shadow-soft transition-colors duration-(--t-press) active:bg-soft"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-[0.6875rem] bg-soft-2 text-body transition-[scale] duration-(--t-press) ease-(--ease-out) group-active:scale-[0.92]">
            <Search className="size-[1.125rem] stroke-[1.7]" />
          </span>
          <span className="min-w-0 flex-1 truncate text-[1rem] font-medium text-ink">
            Search or jump to…
          </span>
          <ChevronRight className="size-4 shrink-0 text-line-ico" />
        </button>
      )}
    </PageContent>
  )
}
