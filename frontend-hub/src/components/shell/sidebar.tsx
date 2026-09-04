import { Link, useRouterState } from "@tanstack/react-router"
import {
  ChevronRight,
  HelpCircle,
  LogOut,
  PanelLeft,
  Search,
  Sparkles,
} from "lucide-react"

import { Mark } from "@/components/shell/mark"
import { count } from "@/lib/format"
import {
  modules,
  moduleForPath,
  visibleItems,
  type AppModule,
  type NavItem,
} from "@/lib/navigation"
import { useIdentity, useNodeIdentity, useSignOut } from "@/lib/session"
import { cn } from "@/lib/utils"

/// The sidebar — the whole of this app's navigation, in one column.
///
/// It used to be two: a 58px rail of coloured tiles for the eleven modules, and
/// a 248px panel for whatever was inside the one you had picked. Eleven modules is
/// not enough to earn a switcher of their own, and the arrangement asked people
/// to learn that the left-hand strip meant "which part of the business" while
/// the strip beside it meant "which screen". One column says both at once.
///
/// **The active module is the expanded one, and nothing else expands.** There
/// is no open/closed state anywhere in this file: which module is open is read
/// off the URL. That is what keeps the panel short — eleven rows plus one
/// module's worth of sub-items — and it means a link pasted into chat opens the sidebar
/// exactly as the person who sent it had it. State would have to be restored,
/// synchronised with navigation, and would still be wrong in the second tab.
///
/// The three modules that reached their screens by an in-page tab strip do not
/// any more: those strips were what a module without a sidebar row had to grow,
/// and they are sub-items now like everyone else's.
export function Sidebar({
  open,
  onToggle,
  onOpenPalette,
  onOpenAssistant,
}: {
  open: boolean
  onToggle: () => void
  onOpenPalette: () => void
  onOpenAssistant: () => void
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const active = moduleForPath(pathname)
  const identity = useIdentity()
  const where = useNodeIdentity()
  const signOut = useSignOut()

  return (
    <aside
      data-open={open}
      className={cn(
        "flex shrink-0 flex-col border-r border-hairline bg-soft py-[0.8125rem]",
        "min-h-0 transition-[width] duration-200",
        // Collapsed is a column of icons, not an empty margin. A sidebar that
        // slides away entirely leaves ⌘B as the only way back to navigation,
        // and nothing on screen says so.
        open ? "w-[15.5rem] px-[0.6875rem]" : "w-[3.625rem] px-[0.6875rem]"
      )}
    >
      <div
        className={cn(
          "mb-2.5 flex items-center gap-1.5",
          !open && "flex-col gap-1.5"
        )}
      >
        <span className="grid size-[1.6875rem] shrink-0 place-items-center text-ink">
          <Mark className="h-[1.4375rem] w-[1.25rem]" />
        </span>
        {open && (
          <b className="min-w-0 flex-1 truncate text-[0.90625rem] font-semibold tracking-[-0.015em]">
            {where.data?.node_id ?? "cloud"}
          </b>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-label="Toggle sidebar"
          title={open ? "Collapse  ⌘B" : "Expand  ⌘B"}
          className="grid size-[1.625rem] shrink-0 place-items-center rounded-lg text-line-ico transition-colors hover:bg-soft-2 hover:text-text"
        >
          <PanelLeft className="size-4 stroke-[1.7]" />
        </button>
      </div>

      {/* Neither of these is a place, so they sit above the modules rather
          than among them: one opens a search, the other opens a conversation,
          and both leave you on the screen you were already on. */}
      <div className="mb-2 flex flex-col gap-px">
        <Action
          icon={Search}
          label="Quick actions"
          hint="K"
          shortcut="⌘K"
          onClick={onOpenPalette}
          open={open}
        />
        <Action
          icon={Sparkles}
          label="Ask"
          hint="J"
          shortcut="⌘J"
          onClick={onOpenAssistant}
          open={open}
        />
      </div>

      <nav
        aria-label="Navigation"
        className="flex min-h-0 flex-col gap-px overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {modules.map((module) => (
          <ModuleGroup
            key={module.id}
            module={module}
            active={module.id === active.id}
            open={open}
          />
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-px pt-2.5">
        <button
          type="button"
          title={open ? undefined : "Help & resources"}
          className={cn(
            "flex items-center gap-2.5 rounded-lg py-1.5 text-meta font-normal text-body transition-colors hover:bg-soft-2 hover:text-ink",
            open ? "px-[0.5625rem]" : "justify-center px-0"
          )}
        >
          <HelpCircle className="size-[0.9375rem] shrink-0 text-line-ico" />
          {open && "Help & resources"}
        </button>
        <div
          className={cn(
            "mt-1.5 flex items-center gap-2.5 rounded-inner",
            open && "border border-hairline p-[0.4375rem_0.5rem]",
            !open && "justify-center"
          )}
        >
          <span className="size-[1.625rem] shrink-0 rounded-full bg-linear-to-br from-avatar-from to-avatar-to" />
          {open && (
            <>
              <span className="min-w-0 flex-1 text-[0.78125rem] leading-tight font-medium">
                <span className="block truncate">
                  {identity.data?.display_name ??
                    identity.data?.username ??
                    "—"}
                </span>
                <small className="block truncate text-[0.6875rem] font-normal text-mute">
                  {where.data?.node_id ?? "cloud"}
                </small>
              </span>
              <button
                type="button"
                aria-label="Sign out"
                onClick={() => signOut.mutate()}
                disabled={signOut.isPending}
                className="grid size-[1.625rem] shrink-0 place-items-center rounded-lg text-line-ico transition-colors hover:bg-soft-2 hover:text-text disabled:opacity-50"
              >
                <LogOut className="size-4 stroke-[1.7]" />
              </button>
            </>
          )}
        </div>
      </div>
    </aside>
  )
}

/// A row that does something rather than going somewhere.
///
/// A button and not a `<Link>`, and that is the whole distinction being drawn:
/// nothing here changes the URL, so nothing here can ever be the active row.
function Action({
  icon: Icon,
  label,
  hint,
  shortcut,
  onClick,
  open,
}: {
  icon: typeof Search
  label: string
  /// The key, drawn at the right-hand end while there is room for it.
  hint: string
  /// The whole chord, for the hover label a collapsed row needs.
  shortcut: string
  onClick: () => void
  open: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={open ? undefined : `${label}  ${shortcut}`}
      className={cn(
        "flex items-center gap-2.5 rounded-lg py-[0.4375rem] text-nav font-medium text-text transition-colors hover:bg-soft-2",
        open ? "px-[0.5625rem]" : "justify-center px-0"
      )}
    >
      <Icon className="size-[1.0625rem] shrink-0 stroke-[1.55] text-line-ico" />
      {open && (
        <>
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          <kbd className="shrink-0 text-[0.6875rem] font-medium text-mute">
            {hint}
          </kbd>
        </>
      )}
    </button>
  )
}

/// One module: its own row, and — when it is the module you are in — the
/// screens under it.
///
/// The row navigates rather than merely opening: `home` is a real screen, so a
/// click that only unfolded a list would be a click that went nowhere. Landing
/// on the module makes it the active one, which is what expands it, so the
/// disclosure and the navigation are the same gesture and cannot disagree.
function ModuleGroup({
  module,
  active,
  open,
}: {
  module: AppModule
  active: boolean
  open: boolean
}) {
  const Icon = module.icon
  /// More than one, not more than none: a module whose only visible screen is
  /// its own `home` would unfold into a single sub-item saying what the row
  /// above it already says. It gets no chevron and does not expand — which is
  /// also what keeps this honest as screens are added and `hidden` is moved
  /// about, rather than a fact somebody has to remember to re-check.
  const unfolds = visibleItems(module).length > 1
  const expanded = open && active && unfolds
  const useCount = module.useCount ?? noCount
  // Called unconditionally, drawn conditionally: while the module is expanded
  // its sub-items carry their own counts and the total would say it again.
  const total = useCount()

  const row = (
    <Link
      to={module.home}
      aria-current={active ? "page" : undefined}
      // Collapsed, the label is not drawn, so the row needs to be able to say
      // what it is. `title` rather than the styled tooltip the rail used to
      // carry: that one lived inside this scroll container and was clipped by
      // it, and a tooltip cannot escape the box it is painted in.
      title={open ? undefined : module.label}
      className={cn(
        "group flex items-center gap-2.5 rounded-lg py-[0.4375rem] text-nav transition-colors hover:bg-soft-2",
        open ? "px-[0.5625rem]" : "justify-center px-0",
        // The active module is stated by weight and ink, not by a fill: the
        // fill belongs to the one sub-item you are actually on, and two pills
        // in a column argue about which is current.
        active ? "font-semibold text-ink" : "font-medium text-text",
        !open && active && "bg-soft-2"
      )}
    >
      <span className="relative grid shrink-0 place-items-center">
        <Icon
          className={cn(
            "size-[1.0625rem] stroke-[1.55]",
            active ? "text-ink" : "text-line-ico"
          )}
        />
        {/* Collapsed, there is no room for the number — but the number's whole
            job is to be noticed by somebody who has not opened the module, and
            that is exactly who is looking at a 58px column. So the count
            becomes a dot: same claim, no width. */}
        {!open && typeof total === "number" && total > 0 && (
          <span
            aria-hidden
            className={cn(
              "absolute -top-px -right-px size-[0.375rem] rounded-full ring-2 ring-soft",
              module.badge === "bad" ? "bg-bad-fg" : "bg-warn-fg"
            )}
          />
        )}
      </span>
      {open && (
        <>
          <span className="min-w-0 flex-1 truncate">{module.label}</span>
          {!expanded && <Badge value={total} tint={module.badge} />}
          {unfolds && module.soon !== true && (
            <ChevronRight
              className={cn(
                "size-3.5 shrink-0 stroke-[1.7] text-line-ico transition-transform duration-150",
                expanded && "rotate-90"
              )}
            />
          )}
        </>
      )}
    </Link>
  )

  return (
    <div className="flex flex-col gap-px">
      {row}
      {expanded && (
        <div className="mb-1 flex flex-col gap-px">
          {module.sections.map((section, index) => {
            const items = section.items.filter((item) => !item.hidden)
            if (items.length === 0) return null
            return (
              <div key={section.label ?? index} className="flex flex-col gap-px">
                {/* Drawn only inside the expanded module, which is the only
                    place a second level of labelling is affordable. Finance
                    and Inventory are ten and eleven screens; the groups are
                    the difference between a list and a table of contents. */}
                {section.label && (
                  <div className="pt-1.5 pb-[0.1875rem] pl-[2.3125rem] text-[0.6875rem] font-semibold tracking-[0.05em] text-mute uppercase">
                    {section.label}
                  </div>
                )}
                {items.map((item) => (
                  <SubRow
                    key={item.path}
                    item={item}
                    exact={item.path === module.home}
                  />
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/// One screen under its module.
///
/// Its own component so that a sub-item which wants a live count gets one hook
/// call, at the top of a component, unconditionally — the only way a hook may
/// be called at all. `item.useCount?.()` inside the `.map()` above would be a
/// hook in a loop body, and would break the first time a section changed
/// length.
///
/// No icon. The indent and the module row above already say where this is, and
/// a second column of glyphs under a glyph is the thing that made the two-panel
/// shell hard to read. The icons stay declared: ⌘K draws them, where a result
/// has no parent row to inherit meaning from.
function SubRow({ item, exact }: { item: NavItem; exact: boolean }) {
  const useCount = item.useCount ?? noCount
  const badge = useCount()

  return (
    <Link
      to={item.path}
      activeOptions={{ exact }}
      className="group flex items-center gap-2.5 rounded-lg py-[0.375rem] pr-[0.5625rem] pl-[2.3125rem] text-nav font-medium text-body transition-colors hover:bg-soft-2 hover:text-ink data-[status=active]:bg-soft-2 data-[status=active]:text-ink data-[status=active]:font-medium"
    >
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      <Badge value={badge} tint={item.badge} />
    </Link>
  )
}

/// Nothing at zero, and nothing while the count is still `null`. A badge that
/// appears empty, or blinks on at every page load, teaches people to stop
/// reading it.
function Badge({
  value,
  tint,
}: {
  value: number | null | undefined
  tint?: "bad" | "warn"
}) {
  if (typeof value !== "number" || value <= 0) return null
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-[0.375rem] py-px text-[0.65625rem] font-semibold tabular-nums",
        tint === "bad" ? "bg-bad-bg text-bad-fg" : "bg-warn-bg text-warn-fg"
      )}
    >
      {count(value)}
    </span>
  )
}

/// The hook a row without a count calls. Asks nothing, subscribes to nothing.
function noCount(): null {
  return null
}
