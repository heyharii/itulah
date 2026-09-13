import { Link } from "@tanstack/react-router"
import { Search, Sparkles } from "lucide-react"

import { visibleSections, type Module, type NavItem } from "@/lib/nav"
import { useAudience } from "@/lib/reach"

/// The sidebar — one module's screens, and only ever one module's.
///
/// Which module that is, is read off the URL. There is no open/closed state in
/// this file, and that is what makes a link pasted into a chat open the
/// sidebar exactly as the person who sent it had it. State would have to be
/// restored, synchronised with navigation, and would still be wrong in the
/// second tab.
///
/// The rows carry their icons. That is only safe because they are top-level:
/// a column of glyphs indented under another glyph is what made the older
/// two-panel shells hard to read, and nothing here is indented under anything.
export function Sidebar({
  module,
  onOpenPalette,
  onNavigate,
}: {
  module: Module | undefined
  onOpenPalette: () => void
  /// Called when a row is followed. Only the drawer passes it: a drawer that
  /// stays open over the screen it just navigated to is a drawer somebody has
  /// to dismiss before they can read what they asked for.
  onNavigate?: () => void
}) {
  // Asked for once here rather than by each module: the sidebar is the one
  // place rows are offered, and the query is shared and kept for five minutes,
  // so this costs a cache read per render and no request.
  const audience = useAudience()

  return (
    <aside className="w-side border-line bg-side flex h-full shrink-0 flex-col border-r px-[11px] py-[13px]">
      {/* Neither of these is a place, so they sit above the screens rather than
          among them: one opens a search, the other opens a conversation, and
          both leave you where you already are. */}
      <div className="mb-2 flex flex-col gap-px">
        <Action
          icon={Search}
          label="Search anything"
          hint="⌘K"
          onClick={onOpenPalette}
        />
        <Action icon={Sparkles} label="Ask" hint="⌘J" />
      </div>

      <nav
        aria-label="Screens"
        className="flex min-h-0 [scrollbar-width:none] flex-col gap-px overflow-y-auto [&::-webkit-scrollbar]:hidden"
      >
        {module &&
          visibleSections(module, audience).map((section, index) => (
            <div key={section.label ?? index} className="flex flex-col gap-px">
              {section.label && (
                <span className="text-meta text-ink-4 px-[9px] pt-4 pb-[5px]">
                  {section.label}
                </span>
              )}
              {section.items.map((item) => (
                <ScreenRow
                  key={item.path}
                  item={item}
                  onNavigate={onNavigate}
                  // Only the module's landing screen needs an exact match: its
                  // path is a prefix of every other path in the module, so a
                  // loose match would light it on all of them.
                  exact={item.path === module.base}
                />
              ))}
            </div>
          ))}
      </nav>
    </aside>
  )
}

/// One screen, as a row.
///
/// The active row is a FILL, and it is the only fill in the column: the rail
/// tile says which module, this says which screen, and neither has to compete
/// with a second highlighted thing above it.
function ScreenRow({
  item,
  exact,
  onNavigate,
}: {
  item: NavItem
  exact: boolean
  onNavigate?: () => void
}) {
  const Icon = item.icon
  return (
    <Link
      to={item.path}
      activeOptions={{ exact }}
      onClick={onNavigate}
      className="group rounded-ctl text-cell text-ink-2 hover:bg-hover hover:text-ink data-[status=active]:bg-hover data-[status=active]:text-ink pointer-coarse:min-h-tap flex items-center gap-[11px] px-[9px] py-[7px] font-medium transition-colors data-[status=active]:font-semibold"
    >
      <Icon className="text-ink-4 group-data-[status=active]:text-ink size-[17px] shrink-0 stroke-[1.55]" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
    </Link>
  )
}

/// A row that does something rather than going somewhere.
///
/// A button and not a `<Link>`, and that is the whole distinction: nothing here
/// changes the URL, so nothing here can ever be the active row.
function Action({
  icon: Icon,
  label,
  hint,
  onClick,
}: {
  icon: typeof Search
  label: string
  hint: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-ctl text-cell text-ink-4 hover:bg-hover hover:text-ink-2 pointer-coarse:min-h-tap flex items-center gap-[11px] px-[9px] py-[7px] transition-colors"
    >
      <Icon className="size-[17px] shrink-0 stroke-[1.55]" />
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      <kbd className="text-meta text-ink-4 shrink-0 font-normal">{hint}</kbd>
    </button>
  )
}
