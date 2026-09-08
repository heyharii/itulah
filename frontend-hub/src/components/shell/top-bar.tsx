import { Menu, Search, Sparkles } from "lucide-react"

import { useNodeIdentity } from "@/lib/session"

/// The bar that exists only at the widths where the sidebar cannot.
///
/// `inventory-prototype.html` authors `<header class="topbar" hidden>` and then
/// switches it off, and this app has had no horizontal chrome since. The
/// argument for that is written in `app-shell.tsx`: the left-hand column took
/// over everything a topbar carried. Which is a claim about the sidebar being
/// ON SCREEN — and under 64rem it is not. It is a drawer, and a drawer nobody
/// can see cannot carry its own handle, the app's only search, or its only way
/// to the assistant.
///
/// So the bar comes back at exactly the width the sidebar leaves, and goes away
/// again at the width it returns. It is not a second navigation: everything on
/// it is a control the sidebar owns, drawn where a thumb can reach it.
///
/// ⌘K and ⌘J are also why the two right-hand buttons are here rather than left
/// as shortcuts. A tablet has no ⌘, and a shortcut nobody can press is a
/// feature that does not exist on that device.
export function TopBar({
  onOpenNav,
  onOpenPalette,
  onOpenAssistant,
}: {
  onOpenNav: () => void
  onOpenPalette: () => void
  onOpenAssistant: () => void
}) {
  const where = useNodeIdentity()

  return (
    <header className="flex h-tap shrink-0 items-center gap-1 border-b border-hairline bg-canvas px-1.5">
      <button
        type="button"
        onClick={onOpenNav}
        aria-label="Open navigation"
        className={TAP}
      >
        <Menu className="size-[1.125rem] stroke-[1.7]" />
      </button>
      {/* The node, the same fact the sidebar's own head carries. Not the screen
          name: the page under this bar already opens with its crumb and title,
          and a bar that repeats them spends the one row a phone has on saying
          something twice. */}
      <b className="min-w-0 flex-1 truncate text-[0.90625rem] font-semibold tracking-[-0.015em]">
        {where.data?.node_id ?? "cloud"}
      </b>
      <button
        type="button"
        onClick={onOpenPalette}
        aria-label="Quick actions"
        className={TAP}
      >
        <Search className="size-[1.0625rem] stroke-[1.55]" />
      </button>
      <button
        type="button"
        onClick={onOpenAssistant}
        aria-label="Ask"
        className={TAP}
      >
        <Sparkles className="size-[1.0625rem] stroke-[1.55]" />
      </button>
    </header>
  )
}

/// 44px square, which is the touch floor `--spacing-tap` is named for. This bar
/// only ever exists on a device being held, so the floor is not conditional
/// here the way it is on a row that a mouse might also read.
const TAP =
  "grid size-tap shrink-0 place-items-center rounded-lg text-line-ico transition-colors hover:bg-soft-2 hover:text-text"
