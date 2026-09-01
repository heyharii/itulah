import { Link, useRouterState } from "@tanstack/react-router"
import { HelpCircle, PanelLeft, Search, Settings } from "lucide-react"

import { modules, moduleForPath, type AppModule } from "@/lib/navigation"
import { cn } from "@/lib/utils"
import { Mark } from "@/components/shell/mark"

/// The 58px rail — the app switcher, and the reason this shell has no top bar.
///
/// `inventory-prototype.html` ships its `<header class="topbar">` with a
/// literal `hidden` attribute: the rail plus the sidebar took over everything
/// the header used to carry. That is the shell this app implements, so there is
/// no global header component to find — search lives in the palette (⌘K), the
/// account lives at the foot of the sidebar.
///
/// Each tile is a pastel mesh: three soft radial blobs over a muted base. A
/// hard two-stop gradient is exactly what the reference avoids, and it is the
/// difference between "designed" and "a coloured square".
function RailTile({ module, active }: { module: AppModule; active: boolean }) {
  const Icon = module.icon
  const tile = (
    <>
      <Icon className="relative z-10 size-[0.9375rem] stroke-[1.75] text-white [filter:drop-shadow(0_1px_1.5px_rgba(45,45,65,.32))]" />
      {/* The top sheen. Without it the mesh reads flat against a white rail. */}
      <span className="pointer-events-none absolute inset-0 rounded-[inherit] bg-linear-to-b from-white/20 to-transparent to-55%" />
      {active && (
        /* The active mark is a dark bar in the rail's gutter, not a ring on
           the tile: the tiles are already coloured, and a ring on one of ten
           pastel squares is invisible. */
        <span className="absolute top-1/2 -left-[0.5625rem] h-[0.875rem] w-[0.15625rem] -translate-y-1/2 rounded-[2px] bg-ink" />
      )}
      <span className="pointer-events-none absolute top-1/2 left-12 z-50 -translate-y-1/2 scale-95 rounded-inner bg-tooltip px-2.5 py-1.5 text-[0.78125rem] font-medium tracking-normal whitespace-nowrap text-white opacity-0 transition duration-100 group-hover:scale-100 group-hover:opacity-100">
        {module.label}
      </span>
    </>
  )

  const shell = cn(
    "group relative grid size-[1.875rem] shrink-0 place-items-center rounded-inner transition-transform duration-150",
    "shadow-[inset_0_0_0_1px_rgba(0,0,0,.07),0_1px_2px_rgba(20,20,25,.10)]",
    module.soon
      ? "cursor-default opacity-45 grayscale-[.7]"
      : "hover:-translate-y-px"
  )

  // The mesh is data, so it arrives as custom properties rather than ten
  // hand-written gradient classes.
  const style = {
    backgroundColor: module.mesh.base,
    backgroundImage: [
      `radial-gradient(72% 72% at 22% 18%, ${module.mesh.c1}, transparent 62%)`,
      `radial-gradient(72% 72% at 82% 24%, ${module.mesh.c2}, transparent 62%)`,
      `radial-gradient(84% 84% at 70% 88%, ${module.mesh.c3}, transparent 68%)`,
    ].join(","),
  }

  if (module.soon) {
    return (
      <span className={shell} style={style} aria-disabled>
        {tile}
      </span>
    )
  }

  return (
    <Link
      to={module.home}
      className={shell}
      style={style}
      aria-label={module.label}
      aria-current={active ? "page" : undefined}
    >
      {tile}
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
      className="group relative grid size-8 shrink-0 place-items-center rounded-inner text-line-ico transition-colors hover:bg-soft-2 hover:text-text"
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
  const active = moduleForPath(pathname)

  return (
    <nav
      aria-label="Modules"
      className="flex w-[3.625rem] shrink-0 flex-col items-center gap-3 border-r border-hairline bg-canvas px-0 pt-[0.8125rem] pb-[0.875rem]"
    >
      <div className="mb-0.5 grid size-7 place-items-center text-ink">
        <Mark className="h-[1.6875rem] w-6" />
      </div>
      <div className="flex min-h-0 [scrollbar-width:none] flex-col items-center gap-[0.6875rem] overflow-y-auto py-0.5 [&::-webkit-scrollbar]:hidden">
        {modules.map((module) => (
          <RailTile
            key={module.id}
            module={module}
            active={module.id === active.id}
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
      <UtilButton label="Settings">
        <Settings className="size-[1.0625rem] stroke-[1.7]" />
      </UtilButton>
    </nav>
  )
}
