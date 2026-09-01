import { Link, useRouterState } from "@tanstack/react-router"
import { HelpCircle, PanelLeft, Search } from "lucide-react"

import { Mark } from "@/components/shell/mark"
import { stationForPath, stations, type Station } from "@/lib/navigation"
import { useWaiting } from "@/lib/queries/waiting"
import { cn } from "@/lib/utils"

/// The 58px rail — and here it is not an app switcher but **the flow**.
///
/// `inventory-prototype.html` ships its `<header class="topbar">` with a
/// literal `hidden` attribute: the rail plus the sidebar took over everything
/// the header used to carry. That is the shell this app implements, so there
/// is no global header to find — search lives in the palette (⌘K), the account
/// at the foot of the sidebar.
///
/// What differs from the hub is the reading: the tiles run top to bottom in
/// the order goods move through this building — intake, tagging, counting,
/// picking, packing, despatch — and then the node itself. Somebody new can
/// read the rail and have described the warehouse.
///
/// Each tile carries what is waiting there. On a floor the question is never
/// "is there anything" but "how many are waiting for me", so the count is the
/// badge and a station with nothing to do reads as finished rather than merely
/// quiet.
function RailTile({
  station,
  active,
  waiting,
}: {
  station: Station
  active: boolean
  waiting: number
}) {
  const Icon = station.icon

  // The mesh is data, so it arrives as custom properties rather than seven
  // hand-written gradient classes. Three soft radial blobs over a muted base:
  // a hard two-stop ramp is exactly what the reference avoids, and it is the
  // difference between "designed" and "a coloured square".
  const style = {
    backgroundColor: station.mesh.base,
    backgroundImage: [
      `radial-gradient(72% 72% at 22% 18%, ${station.mesh.c1}, transparent 62%)`,
      `radial-gradient(72% 72% at 82% 24%, ${station.mesh.c2}, transparent 62%)`,
      `radial-gradient(84% 84% at 70% 88%, ${station.mesh.c3}, transparent 68%)`,
    ].join(","),
  }

  return (
    <Link
      to={station.home}
      aria-label={station.label}
      aria-current={active ? "page" : undefined}
      // The tap area is 44px; the painted tile inside it stays the
      // prototype's 30. A rail that grew its tiles to the touch floor would
      // be a different rail — the floor is about what a thumb can hit, not
      // about how big the artwork is.
      className="group relative grid size-tap shrink-0 place-items-center"
    >
      <span
        className={cn(
          "relative grid size-[1.875rem] place-items-center rounded-inner transition-transform duration-150",
          "shadow-[inset_0_0_0_1px_rgba(0,0,0,.07),0_1px_2px_rgba(20,20,25,.10)]",
          "group-hover:-translate-y-px"
        )}
        style={style}
      >
        <Icon className="relative z-10 size-[0.9375rem] stroke-[1.75] text-white [filter:drop-shadow(0_1px_1.5px_rgba(45,45,65,.32))]" />
        {/* The top sheen. Without it the mesh reads flat against a white rail. */}
        <span className="pointer-events-none absolute inset-0 rounded-[inherit] bg-linear-to-b from-white/20 to-transparent to-55%" />
      </span>

      {/* The active mark is a dark bar in the rail's gutter, not a ring on the
          tile: the tiles are already coloured, and a ring on one of seven
          pastel squares is invisible. */}
      {active && (
        <span className="absolute top-1/2 left-[0.1875rem] h-[0.875rem] w-[0.15625rem] -translate-y-1/2 rounded-[2px] bg-ink" />
      )}

      {waiting > 0 && (
        <span className="pointer-events-none absolute top-[0.3125rem] right-[0.25rem] grid h-[0.9375rem] min-w-[0.9375rem] place-items-center rounded-full border border-canvas bg-ink px-[0.1875rem] text-[0.5625rem] font-semibold text-white tabular-nums">
          {waiting > 99 ? "99+" : waiting}
        </span>
      )}

      <span className="pointer-events-none absolute top-1/2 left-12 z-50 -translate-y-1/2 scale-95 rounded-inner bg-tooltip px-2.5 py-1.5 text-[0.78125rem] font-medium tracking-normal whitespace-nowrap text-white opacity-0 transition duration-100 group-hover:scale-100 group-hover:opacity-100">
        {station.label}
      </span>
    </Link>
  )
}

function UtilButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick?: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="group relative grid size-tap shrink-0 place-items-center rounded-inner text-line-ico transition-colors hover:bg-soft-2 hover:text-text"
    >
      {children}
      <span className="pointer-events-none absolute top-1/2 left-12 z-50 -translate-y-1/2 scale-95 rounded-inner bg-tooltip px-2.5 py-1.5 text-[0.78125rem] font-medium whitespace-nowrap text-white opacity-0 transition duration-100 group-hover:scale-100 group-hover:opacity-100">
        {label}
      </span>
    </button>
  )
}

export function IconRail({
  onToggleSidebar,
  onOpenPalette,
}: {
  onToggleSidebar: () => void
  onOpenPalette: () => void
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const active = stationForPath(pathname)
  const waiting = useWaiting()

  return (
    <nav
      aria-label="Stations"
      className="flex w-[3.625rem] shrink-0 flex-col items-center gap-0.5 border-r border-hairline bg-canvas px-0 pt-[0.8125rem] pb-[0.875rem]"
    >
      <div className="mb-1.5 grid size-7 place-items-center text-ink">
        <Mark className="h-[1.6875rem] w-6" />
      </div>
      <div className="flex min-h-0 [scrollbar-width:none] flex-col items-center overflow-y-auto [&::-webkit-scrollbar]:hidden">
        {stations.map((station) => (
          <RailTile
            key={station.id}
            station={station}
            active={station.id === active.id}
            waiting={station.waiting?.(waiting) ?? 0}
          />
        ))}
      </div>
      <div className="mt-auto" />
      <div className="h-px w-[1.375rem] shrink-0 bg-hairline-2" />
      <UtilButton label="Toggle sidebar" onClick={onToggleSidebar}>
        <PanelLeft className="size-[1.0625rem] stroke-[1.7]" />
      </UtilButton>
      <UtilButton label="Search  ⌘K" onClick={onOpenPalette}>
        <Search className="size-[1.0625rem] stroke-[1.7]" />
      </UtilButton>
      <UtilButton label="Help">
        <HelpCircle className="size-[1.0625rem] stroke-[1.7]" />
      </UtilButton>
    </nav>
  )
}
