import { Link } from "@tanstack/react-router"

import { Icon, paths } from "@/components/dashboard/parts"
import {
  NAV,
  VIEWS,
  orderLeafId,
  type NavIcon,
  type SectionId,
  type Supplier,
  type ViewId,
} from "@/components/dashboard/data"
import { PO_LIFECYCLE } from "@/components/po/api"
import type { PoStatus } from "@/components/commerce/store"
import { AppHeading } from "@/components/app-switcher"
import { cn } from "@/lib/utils"

const NAV_ICON: Record<NavIcon, React.ReactNode> = {
  table: paths.table,
  bag: paths.bag,
  chart: paths.chart,
}

/** The status a nav leaf stands for, or nothing if it is not an order leaf. */
const leafStatus = (id: string) => PO_LIFECYCLE.find((s) => orderLeafId(s) === id)

const countForView = (viewId: ViewId, rows: Supplier[]) => {
  const view = VIEWS.find((v) => v.id === viewId)
  return rows.filter((r) => !view?.tag || r.tags.includes(view.tag)).length
}

interface NavSidebarProps {
  rows: Supplier[]
  section: SectionId
  view: ViewId
  expanded: SectionId[]
  /** The order status the list is narrowed to, if any. */
  orderStatus: PoStatus | undefined
  /** How many live orders sit in each status, keyed by nav-leaf id. */
  orderCounts: Record<string, number>
  soundOn: boolean
  /** Leaves that belong to another app — the caller navigates there. */
  onLeaf: (id: string, label: string) => void
  onToggleSound: () => void
  onCollapse: () => void
}

/**
 * Where a section header goes when you click it: a section you are already
 * in folds and unfolds, any other one becomes the current section with only
 * its own leaves showing.
 */
function sectionTarget(
  id: SectionId,
  hasChildren: boolean,
  section: SectionId,
  expanded: SectionId[]
): { section: SectionId; expanded: SectionId[] } {
  if (hasChildren && section === id) {
    return {
      section,
      expanded: expanded.includes(id)
        ? expanded.filter((entry) => entry !== id)
        : [...expanded, id],
    }
  }
  return { section: id, expanded: hasChildren ? [id] : [] }
}

export function NavSidebar({
  rows,
  section,
  view,
  expanded,
  orderStatus,
  orderCounts,
  soundOn,
  onLeaf,
  onToggleSound,
  onCollapse,
}: NavSidebarProps) {
  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-page">
      <div className="flex h-[52px] shrink-0 items-center gap-1.5 pr-2 pl-2.5">
        <AppHeading app="buying" />
        <IconButton label="Collapse sidebar" onClick={onCollapse}>
          <Icon path={paths.panel} size={17} />
        </IconButton>
      </div>

      <nav className="flex-1 overflow-auto px-2 pt-0.5 pb-2">
        {NAV.map((item) => {
          const isCurrent = section === item.id
          const isOpen = expanded.includes(item.id)
          const isSuppliers = item.id === "suppliers"
          const isOrders = item.id === "orders"
          const target = sectionTarget(
            item.id,
            Boolean(item.children),
            section,
            expanded
          )

          return (
            <div key={item.id} className="mb-px">
              <Link
                from="/buying"
                to="/buying"
                replace
                data-sound="page"
                aria-expanded={item.children ? isOpen : undefined}
                search={(prev) => ({ ...prev, ...target })}
                className={cn(
                  "group/nav relative flex h-8 w-full items-center gap-[9px] rounded-control py-0 pr-2 pl-[9px] text-left text-[13px] font-medium transition-colors duration-[110ms]",
                  "text-ink-2 hover:bg-hover hover:text-ink",
                  isCurrent && "font-semibold text-ink",
                  // the active section gets a rail, not a filled block — the
                  // filled block is reserved for the leaf you are looking at
                  isCurrent &&
                    "before:absolute before:top-2 before:bottom-2 before:-left-2 before:w-[2.5px] before:rounded-r-full before:bg-ink before:content-['']"
                )}
              >
                <Icon
                  path={NAV_ICON[item.icon]}
                  className={cn(
                    "shrink-0 text-ink-4 transition-colors group-hover/nav:text-ink-2",
                    isCurrent && "text-ink-2"
                  )}
                />
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                  {item.label}
                </span>
                {item.count !== undefined && (
                  <span
                    className={cn(
                      "font-mono text-[10.5px] text-ink-4",
                      !item.children && "ml-auto"
                    )}
                  >
                    {item.count}
                  </span>
                )}
                {item.children && (
                  <Icon
                    path={paths.chevronRight}
                    size={13}
                    width={2.2}
                    className={cn(
                      "ml-auto shrink-0 text-ink-4 transition-transform duration-200",
                      isOpen && "rotate-90"
                    )}
                  />
                )}
              </Link>

              {item.children && (
                <div
                  className={cn(
                    "grid transition-[grid-template-rows] duration-[220ms] ease-out-strong",
                    isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                  )}
                >
                  <div className="overflow-hidden">
                    {/* the guide line ties the leaves to their parent */}
                    <ul className="relative my-0.5 ml-[18px] list-none pl-2.5 before:absolute before:top-[3px] before:bottom-[3px] before:left-0 before:w-px before:bg-line-strong before:content-['']">
                      {item.children.map((child) => {
                        const status = isOrders ? leafStatus(child.id) : undefined
                        const count = isSuppliers
                          ? countForView(child.id as ViewId, rows)
                          : isOrders
                            ? orderCounts[child.id]
                            : child.count
                        const active =
                          (isSuppliers && section === "suppliers" && view === child.id) ||
                          (isOrders && section === "orders" && orderStatus === status)

                        const leafClass = cn(
                          "flex h-[29px] w-full items-center gap-2 rounded-[7px] px-2 text-left text-xs font-medium transition-colors duration-[110ms]",
                          "text-ink-3 hover:bg-hover hover:text-ink-2",
                          active && "bg-hover font-semibold text-ink"
                        )
                        const leafBody = (
                          <>
                            <span
                              style={{ background: child.hue }}
                              className="size-1.5 shrink-0 rounded-full"
                            />
                            <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                              {child.label}
                            </span>
                            {count !== undefined && (
                              <span className="ml-auto font-mono text-[10.5px] text-ink-4">
                                {count}
                              </span>
                            )}
                          </>
                        )

                        return (
                          <li key={child.id}>
                            {/* a saved view is a real place, so it is a real link */}
                            {isSuppliers ? (
                              <Link
                                from="/buying"
                                to="/buying"
                                replace
                                search={(prev) => ({
                                  ...prev,
                                  view: child.id as ViewId,
                                  section: "suppliers" as const,
                                  expanded: expanded.includes("suppliers")
                                    ? expanded
                                    : [...expanded, "suppliers" as const],
                                })}
                                className={leafClass}
                              >
                                {leafBody}
                              </Link>
                            ) : isOrders ? (
                              /* Narrowing the order list is a filter, so it
                               * replaces — and re-clicking the leaf you are on
                               * widens it back to every order. */
                              <Link
                                from="/buying"
                                to="/buying"
                                replace
                                search={(prev) => ({
                                  ...prev,
                                  section: "orders" as const,
                                  expanded: expanded.includes("orders")
                                    ? expanded
                                    : [...expanded, "orders" as const],
                                  orderStatus: active ? undefined : status,
                                  order: undefined,
                                  draftFor: undefined,
                                })}
                                className={leafClass}
                              >
                                {leafBody}
                              </Link>
                            ) : (
                              <button
                                type="button"
                                onClick={() => onLeaf(child.id, child.label)}
                                className={leafClass}
                              >
                                {leafBody}
                              </button>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </nav>

      <div className="shrink-0 p-2">
        <button
          type="button"
          role="switch"
          aria-checked={soundOn}
          data-sound-silent
          onClick={onToggleSound}
          className="flex h-[34px] w-full items-center gap-[9px] rounded-control px-2 text-xs font-medium text-ink-2 transition-colors duration-[120ms] hover:bg-hover hover:text-ink"
        >
          <Icon path={paths.sound} className="shrink-0 text-ink-4" />
          Interaction sounds
          <Switch on={soundOn} />
        </button>
      </div>
    </aside>
  )
}

export function Switch({ on, className }: { on: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "relative ml-auto h-[17px] w-7 shrink-0 rounded-full transition-colors duration-[160ms]",
        on ? "bg-accent" : "bg-line-strong",
        className
      )}
    >
      <i
        className={cn(
          "absolute top-0.5 left-0.5 block size-[13px] rounded-full bg-white shadow-[0_1px_2px_rgb(18_18_18/.25)] transition-transform duration-[190ms] ease-spring",
          on && "translate-x-[11px]"
        )}
      />
    </span>
  )
}

export function IconButton({
  label,
  onClick,
  children,
  className,
}: {
  label: string
  onClick?: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "grid size-[30px] shrink-0 place-items-center rounded-control text-ink-3 transition-colors duration-[120ms] hover:bg-hover hover:text-ink",
        className
      )}
    >
      {children}
    </button>
  )
}
