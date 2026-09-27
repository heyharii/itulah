import { Link, useRouterState } from "@tanstack/react-router"
import { PanelLeft } from "lucide-react"
import { useLayoutEffect, useRef, useState } from "react"

import {
  moduleForPath,
  modules,
  newsModule,
  nodeModule,
  type AppModule,
} from "@/lib/navigation"
import { cn } from "@/lib/utils"

/// The dark column at the window's edge: *which part of the shop*.
///
/// The hub's rail (`frontend-hub/src/components/shell/rail.tsx`), drawn the
/// same way — a tile per module with its word under it, one lit tile, and a
/// mark that glides between tiles rather than jumping — over the till's own
/// six modules. The node's screens sit at the foot as a bare icon, the place
/// the hub keeps System: opened when something is wrong, not every hour.
export function Rail({
  sidebarOpen,
  onToggleSidebar,
}: {
  sidebarOpen?: boolean
  onToggleSidebar?: () => void
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const current = moduleForPath(pathname).id

  // The tile lights the moment it is pressed rather than when the route
  // resolves, so a slow screen does not leave the old tile lit under the
  // finger. Keyed to the path it was pressed on, so arriving anywhere else —
  // back button, a link inside a screen — hands the light back to the route.
  const [pressed, setPressed] = useState<{ id: string; on: string } | null>(
    null,
  )
  const lit = pressed?.on === pathname ? pressed.id : current

  const list = useRef<HTMLDivElement>(null)
  const [mark, setMark] = useState<{
    top: number
    height: number
    glide: boolean
  } | null>(null)

  useLayoutEffect(() => {
    const tile = list.current?.querySelector<HTMLElement>("[data-lit]")
    setMark((prev) =>
      tile
        ? {
            top: tile.offsetTop,
            height: tile.offsetHeight,
            glide: prev !== null,
          }
        : null,
    )
  }, [lit])

  return (
    <nav
      aria-label="Modules"
      className="flex h-full w-[5rem] shrink-0 flex-col items-stretch bg-rail text-rail-text"
    >
      <div
        ref={list}
        className="relative flex min-h-0 flex-1 [scrollbar-width:none] flex-col gap-0.5 overflow-y-auto px-1.5 pt-2 pb-2 [&::-webkit-scrollbar]:hidden"
      >
        {mark && (
          <span
            aria-hidden
            data-motion="travel"
            className={cn(
              "pointer-events-none absolute inset-x-1.5 top-0 rounded-inner bg-rail-3",
              mark.glide &&
                "transition-[transform,height] duration-(--t-panel) ease-(--ease-out)",
            )}
            style={{
              transform: `translateY(${mark.top}px)`,
              height: mark.height,
            }}
          />
        )}
        {modules.map((module) => {
          const Icon = module.icon
          const on = lit === module.id
          return (
            <Link
              key={module.id}
              to={module.home as never}
              aria-current={current === module.id ? "page" : undefined}
              data-lit={on ? "" : undefined}
              onClick={() => setPressed({ id: module.id, on: pathname })}
              title={module.label}
              className={cn(
                "relative flex shrink-0 flex-col items-center gap-[0.3125rem] rounded-inner px-0.5 pt-[0.5625rem] pb-[0.4375rem] transition-colors",
                on
                  ? "text-rail-ink"
                  : "text-rail-text hover:bg-rail-2 hover:text-rail-ink",
              )}
            >
              <Icon
                className={cn(
                  "size-[1.125rem] shrink-0 stroke-[1.7]",
                  on ? "text-rail-ink" : "text-rail-mute",
                )}
              />
              <span className="w-full overflow-hidden text-center text-[0.65625rem] leading-none font-medium tracking-[-0.01em] whitespace-nowrap">
                {module.label}
              </span>
            </Link>
          )
        })}
      </div>

      <div className="flex shrink-0 flex-col items-center gap-1 border-t border-rail-hair px-1.5 pt-2 pb-3">
        <AsideTile module={newsModule} active={current === newsModule.id} />
        <AsideTile module={nodeModule} active={current === nodeModule.id} />
        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            aria-pressed={sidebarOpen}
            title={`${sidebarOpen ? "Hide" : "Show"} sidebar  ⌘B`}
            className="grid size-8 place-items-center rounded-inner text-rail-mute transition-colors hover:bg-rail-2 hover:text-rail-ink"
          >
            <PanelLeft className="size-[1.0625rem] stroke-[1.55]" />
          </button>
        )}
      </div>
    </nav>
  )
}

function AsideTile({ module, active }: { module: AppModule; active: boolean }) {
  const Icon = module.icon
  return (
    <Link
      to={module.home as never}
      title={module.label}
      aria-label={module.label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-inner transition-colors",
        active
          ? "bg-rail-3 text-rail-ink"
          : "text-rail-mute hover:bg-rail-2 hover:text-rail-ink",
        "pointer-coarse:size-tap",
      )}
    >
      <Icon className="size-4 stroke-[1.55]" />
    </Link>
  )
}
