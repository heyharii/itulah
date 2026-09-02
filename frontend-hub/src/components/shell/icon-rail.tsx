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
/// Each tile is painted the way macOS paints an app icon: one hue lit from
/// above — a light tint at the top falling to a saturated bottom — with a
/// specular highlight across the top half, a hairline edge, and a small drop
/// shadow to lift it off the rail. Everything here is that one idea; there is
/// no second colour and no second light source.
///
/// It replaces a three-blob pastel mesh. At 30px the blobs averaged into one
/// washed colour, so the tiles read as a row of faded stickers next to the Dock
/// they sit beside all day.
function RailTile({ module, active }: { module: AppModule; active: boolean }) {
  const Icon = module.icon
  const tile = (
    <>
      {/* White glyph, and a shadow light enough to be a seam rather than a
          second stroke: the tint under it is saturated now, so the glyph no
          longer needs help separating from it. */}
      <Icon className="relative z-10 size-[0.9375rem] stroke-[1.75] text-white [filter:drop-shadow(0_1px_1px_rgba(20,20,35,.24))]" />
      {/* The specular highlight — the gloss along the top of every Dock icon.
          Stopped at 52% because it is light falling on a curved face, not a
          second gradient: carried further down it flattens the ramp it sits on
          and the tile goes chalky. */}
      <span className="pointer-events-none absolute inset-0 rounded-[inherit] bg-linear-to-b from-white/28 to-transparent to-52%" />
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
    // Three shadows, in the order they are painted: the lit top edge, then a
    // hairline that keeps a pale tile off a white rail, then the drop shadow
    // that lifts it. The white line is listed first so it wins the top edge —
    // later shadows paint under earlier ones.
    "shadow-[inset_0_1px_0_rgba(255,255,255,.34),inset_0_0_0_1px_rgba(0,0,0,.09),0_1px_2px_rgba(20,20,25,.16)]",
    module.soon
      ? "cursor-default opacity-45 grayscale-[.7]"
      : "hover:-translate-y-px"
  )

  // The ramp is data — ten colours in ten nav files — so it is a style object
  // rather than ten hand-written gradient classes. `backgroundColor` under it
  // is what shows if the gradient ever fails to parse: the tile goes solid, not
  // transparent.
  const style = {
    backgroundColor: module.tint.bottom,
    backgroundImage: `linear-gradient(180deg, ${module.tint.top} 0%, ${module.tint.bottom} 100%)`,
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
