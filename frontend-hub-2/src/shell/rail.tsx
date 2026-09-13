import { Link } from "@tanstack/react-router"
import { PanelLeft } from "lucide-react"

import { moduleFor, type Module } from "@/lib/nav"
import { cn } from "@/lib/cn"

/// The module strip — 56px of icons, and the left-most column of the shell.
///
/// Two columns of navigation rather than one, and the reason is arithmetic
/// rather than taste. A single column has to hold every module AND the screens
/// of whichever one is open, so the screens somebody is actually working in sit
/// below a list of departments they are not in. At fourteen modules that is
/// eleven rows of other people's work above six rows of your own, and the
/// column grows a scrollbar — for navigation, which is the shape of a menu that
/// has stopped fitting its own idea.
///
/// Split, the cost is fixed and in a fixed place: the departments are always
/// exactly here, always the same marks, and never move; the panel beside it
/// holds one module and always fits. What people learn is not "left means
/// department" but "the strip never changes and the panel always does" — a fact
/// about the screen rather than a mapping to memorise.
///
/// **The tiles are not coloured.** A hue per module turns the one piece of
/// chrome that is always visible into the most saturated thing on the glass.
/// Active is a fill — the same statement every other selected thing makes.
export function Rail({
  modules,
  pathname,
  sidebarOpen,
  onToggleSidebar,
}: {
  modules: readonly Module[]
  pathname: string
  /// Only the foot button reads this, and only to say which way it will go.
  sidebarOpen?: boolean
  /// Absent in the drawer, where there is nothing to collapse the panel into.
  onToggleSidebar?: () => void
}) {
  const active = moduleFor(modules, pathname)

  return (
    <nav
      aria-label="Modules"
      className="w-rail border-line bg-rail flex shrink-0 [scrollbar-width:none] flex-col items-center gap-[3px] overflow-y-auto border-r py-[11px] [&::-webkit-scrollbar]:hidden"
    >
      {/* The one mark. Not a link: the first module below already lands on the
          home screen, and two things on this strip going to the same place is
          one of them being a decoration that happens to be clickable. */}
      <span
        aria-hidden
        className="text-label text-canvas mb-[9px] grid size-[30px] shrink-0 place-items-center rounded-[9px] bg-black font-semibold"
      >
        CD
      </span>

      {modules.map((module) => (
        <Tile
          key={module.id}
          module={module}
          active={module.id === active?.id}
        />
      ))}

      {/* The panel switch lives HERE, not in the panel.
          Collapsing hides the sidebar outright, and a control that disappears
          with the thing it controls is a one-way door: the keyboard shortcut
          would be the only way back and nothing on screen would say so. On the
          rail it is always in the same place and does both directions. */}
      {onToggleSidebar && (
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-expanded={sidebarOpen}
          aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          title={sidebarOpen ? "Hide sidebar  ⌘B" : "Show sidebar  ⌘B"}
          className="rounded-ctl text-ink-4 hover:bg-hover hover:text-ink-2 pointer-coarse:size-tap mt-auto grid size-8 shrink-0 place-items-center transition-colors"
        >
          <PanelLeft className="size-4 stroke-[1.7]" />
        </button>
      )}
    </nav>
  )
}

/// One module, as its icon.
///
/// `title` carries the name rather than a drawn tooltip: this is a scroll
/// container, and a tooltip painted inside one is clipped by it.
function Tile({ module, active }: { module: Module; active: boolean }) {
  const Icon = module.icon
  return (
    <Link
      to={module.base}
      title={module.label}
      aria-label={module.label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-ctl grid size-8 shrink-0 place-items-center transition-colors",
        active
          ? "bg-canvas text-ink shadow-btn"
          : "text-ink-4 hover:bg-hover hover:text-ink-2",
        // The touch floor is chosen by POINTER, never by width: an iPad in
        // landscape is wider than most laptops and is still pressed with a
        // thumb.
        "pointer-coarse:size-tap",
      )}
    >
      <Icon className="size-[17px] stroke-[1.55]" />
    </Link>
  )
}
