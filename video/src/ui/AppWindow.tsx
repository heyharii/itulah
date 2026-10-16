/* The hub's shell at 1440 × 900, as measured on :5480 (8 Oct 2026):
   a 68px charcoal rail, a 232px white department column, and the page on
   soft-3 from x 300, content from x 332, 1064 wide. Sheets and dialogs float
   over all three. */
import type { ReactNode } from "react"
import {
  Bell,
  BookOpen,
  Boxes,
  Info,
  Landmark,
  LogOut,
  Megaphone,
  MessagesSquare,
  PanelLeft,
  Shirt,
  ShoppingCart,
  Store,
  Truck,
  Users,
} from "lucide-react"
import { BrandMark, cn } from "./kit"

export const WINDOW = { w: 1440, h: 900 }

export type Dept = "procurement" | "ops" | "merch" | "outbound" | "inventory"

const NAV: Record<Dept, { title: string; items: string[] }> = {
  procurement: {
    title: "Procurement",
    items: ["Purchase Orders", "Suppliers", "Sourcing", "Return PO"],
  },
  ops: {
    title: "Ops",
    items: [
      "Workload",
      "Receiving",
      "Allotment",
      "Return from Store",
      "Return PO",
      "Activity Log",
    ],
  },
  merch: {
    title: "Merchandise",
    items: [
      "Articles",
      "New Articles",
      "Divisions",
      "Tags",
      "Sizes",
      "Colors",
      "Name Suggestions",
      "Allotments",
      "Return to HO",
    ],
  },
  inventory: {
    title: "Inventory",
    items: ["Stock", "Stock checks", "Counts", "Movements"],
  },
  /* Ops as the outbound design has it: the board is "Outbound"
     (outbound-board-prototype.html, 9 Oct 2026). */
  outbound: {
    title: "Ops",
    items: [
      "Workload",
      "Receiving",
      "Outbound",
      "Return from Store",
      "Return PO",
      "Activity Log",
    ],
  },
}

/** Which rail icon a department lights. */
const RAIL_OF: Record<Dept, string> = {
  inventory: "inventory",
  procurement: "procurement",
  ops: "ops",
  outbound: "ops",
  merch: "merch",
}

const RAIL = [
  { dept: "procurement", icon: ShoppingCart },
  { dept: "merch", icon: Shirt },
  { dept: "ops", icon: Truck },
  { dept: "inventory", icon: Boxes },
  { dept: "marketing", icon: Megaphone },
  { dept: "selling", icon: Store },
  { dept: "finance", icon: Landmark },
  { dept: "people", icon: Users },
  { dept: "chat", icon: MessagesSquare },
  { dept: "library", icon: BookOpen },
] as const

export function AppWindow({
  dept,
  active,
  badges = {},
  children,
  overlay,
  clock = "Thu 08 Oct 2026 · 09:12",
  tip,
  swap = 1,
  pageIn = 1,
  column = true,
}: {
  dept: Dept
  active: string
  badges?: Record<string, number>
  children: ReactNode
  /** Sheets, dialogs, toasts: drawn over the whole window. */
  overlay?: ReactNode
  clock?: string
  /** The rail's dark tooltip beside an icon: which one, how far in. */
  tip?: { label: string; index: number; k: number }
  /** 0..1, the department column's list arriving (the hub's nav-swap: it
      rises 4px as it fades in). */
  swap?: number
  /** 0..1, the page arriving after a department change. */
  pageIn?: number
  /** False folds the department column away (the hub's ⌘B), for a page
      that wants the width — the outbound board's five lanes. */
  column?: boolean
}) {
  const nav = NAV[dept]
  return (
    <div
      className="relative overflow-hidden rounded-shell border border-hairline-2 bg-soft-3 text-ink"
      style={{
        width: WINDOW.w,
        height: WINDOW.h,
        boxShadow:
          "0 18px 50px rgb(24 39 60 / 10%), 0 60px 140px rgb(24 39 60 / 14%)",
      }}
    >
      {/* Rail */}
      <div className="absolute inset-y-0 left-0 flex w-[68px] flex-col items-center bg-rail pt-3.5 pb-4">
        <BrandMark size={34} />
        {tip && tip.k > 0 && (
          <span
            className="absolute z-10 rounded-inner bg-tooltip px-2.5 py-1.5 text-[0.875rem] whitespace-nowrap text-white"
            style={{
              left: 62,
              top: 68 + tip.index * 46 + 20,
              translate: `${(1 - tip.k) * -4}px -50%`,
              opacity: tip.k,
            }}
          >
            {tip.label}
          </span>
        )}
        <div className="mt-5 flex flex-col items-center gap-1.5">
          {RAIL.map(({ dept: d, icon: Icon }) => (
            <span
              key={d}
              className={cn(
                "grid size-10 place-items-center rounded-inner",
                d === RAIL_OF[dept] ? "bg-rail-3 text-rail-ink" : "text-rail-mute"
              )}
            >
              <Icon className="size-[18px]" strokeWidth={1.75} />
            </span>
          ))}
        </div>
        <div className="mt-auto flex flex-col items-center gap-3 text-rail-mute">
          <Bell className="size-[18px]" strokeWidth={1.75} />
          <span className="grid size-8 place-items-center rounded-full bg-rail-3 text-[0.875rem] font-semibold text-rail-ink">
            R
          </span>
          <LogOut className="size-[18px]" strokeWidth={1.75} />
        </div>
      </div>

      {/* Department column */}
      {column && (
      <div className="absolute inset-y-0 left-[68px] flex w-[232px] flex-col border-r border-hairline bg-canvas">
        <div className="flex h-[52px] items-center justify-between border-b border-hairline px-4">
          <span className="text-[0.9375rem] font-semibold text-ink" style={{ opacity: swap }}>
            {nav.title}
          </span>
          <PanelLeft className="size-4 text-line-ico" />
        </div>
        <div
          className="flex flex-col gap-0.5 px-2.5 pt-3"
          style={{ opacity: swap, translate: `0px ${(1 - swap) * 4}px` }}
        >
          {nav.items.map((item) => (
            <div
              key={item}
              className={cn(
                "flex h-9 items-center justify-between rounded-inner px-2.5 text-nav font-medium",
                item === active ? "bg-accent-bg text-accent" : "text-text"
              )}
            >
              <span>{item}</span>
              {badges[item] !== undefined && (
                <span className="text-[0.875rem] font-medium text-bad-fg tabular-nums">
                  {badges[item]}
                </span>
              )}
            </div>
          ))}
        </div>
        <div className="mt-auto flex h-[52px] items-center gap-2 border-t border-hairline px-4 text-[0.875rem] text-ink">
          <Info className="size-4 text-line-ico" />
          {clock}
        </div>
      </div>
      )}

      {/* Page */}
      <div
        className="absolute inset-y-0 right-0 px-8 pt-6"
        style={{
          left: column ? 300 : 68,
          opacity: pageIn,
          translate: `0px ${(1 - pageIn) * 4}px`,
        }}
      >
        {children}
      </div>

      {overlay}
    </div>
  )
}

/** The page's title line: the hub sets it at 15px semibold over the content. */
export function PageTitle({ children }: { children: ReactNode }) {
  return <div className="mb-3 text-[0.9375rem] leading-5 font-semibold text-ink">{children}</div>
}
