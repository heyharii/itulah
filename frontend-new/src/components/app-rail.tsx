import { Link } from "@tanstack/react-router"
import { motion, useReducedMotion } from "motion/react"

import { APPS, type AppId } from "@/components/apps"
import { APP_ICON } from "@/components/app-icons"
import { SPRING_LAYOUT } from "@/lib/ease"

/* The rail reads top to bottom the way the business does: what we buy, what
 * we hold, what it costs, who sells it, who buys it, and finally the
 * plumbing. Buying sits next to Sourcing because a style staged in one
 * becomes an order in the other. */
const GROUPS: AppId[][] = [
  ["articles", "sourcing", "buying"],
  ["inventory"],
  ["finance", "accounting", "commercial"],
  ["hr-ho", "hr-store"],
  ["customers"],
  ["forum", "chat", "files"],
  ["system"],
]

function RailButton({ id }: { id: AppId }) {
  const app = APPS.find((a) => a.id === id)
  const reduce = useReducedMotion()
  if (!app) return null

  return (
    <div className="relative flex justify-center">
      <Link
        to={`/${id}`}
        data-sound="tick"
        aria-label={app.label}
        title={app.label}
        activeOptions={{ exact: false, includeSearch: false }}
        className="relative grid size-[34px] shrink-0 place-items-center rounded-[11px] opacity-55 transition-[transform,opacity] duration-[160ms] ease-spring hover:scale-[1.06] hover:opacity-90 active:scale-95 aria-[current=page]:opacity-100"
      >
        {({ isActive }) => (
          <>
            <img src={APP_ICON[id]} alt="" draggable={false} className="size-[30px] select-none" />
            {/* the active app keeps a rail on the edge, same idiom as the nav
             * lists; a shared layoutId lets it travel between apps instead of
             * teleporting, matching the switch-apps tick sound. */}
            {isActive && (
              <motion.span
                layoutId="app-rail-active"
                transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
                className="pointer-events-none absolute top-1.5 bottom-1.5 -left-2 w-[2.5px] rounded-r-full bg-ink"
              />
            )}
          </>
        )}
      </Link>
    </div>
  )
}

/** The narrow, always-on column at the far left: one mark per app. */
export function AppRail() {
  return (
    <nav
      aria-label="Applications"
      className="flex h-full w-[52px] shrink-0 flex-col items-center gap-1 overflow-y-auto overflow-x-hidden bg-page py-2 shadow-[inset_-1px_0_0_var(--line)]"
    >
      {GROUPS.map((group, i) => (
        <div key={group[0]} className="flex w-full flex-col items-center gap-1">
          {i > 0 && <span className="my-1 h-px w-5 shrink-0 rounded-full bg-line-strong" />}
          {group.map((id) => (
            <RailButton key={id} id={id} />
          ))}
        </div>
      ))}
    </nav>
  )
}
