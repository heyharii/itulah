import { cn } from "@/lib/utils"

/// The mobile app-bar: three zones, borderless.
///
/// `[chip] · centered 17/600 title · [chip]` — the chips are ~44px white
/// squircles with a hairline and a soft shadow. Left is ☰ at the top level and
/// ← when pushed; right is the account or the node at the top level and the
/// screen's own action on a detail.
///
/// Borderless is the part that is easy to get wrong: there is no rule under
/// this bar. It is separated from the content by whitespace, the way everything
/// in this system is, and a `border-b` here would be the single most visible
/// way the screen stopped being Cloud Hub.
export function AppBar({
  left,
  title,
  right,
  className,
}: {
  left?: React.ReactNode
  title: React.ReactNode
  right?: React.ReactNode
  className?: string
}) {
  return (
    <header
      className={cn(
        // Pinned. DESIGN.md: the app-bar stays, and the KPI grids and segmented
        // controls scroll away under it.
        "pt-safe sticky top-0 z-30 shrink-0 bg-canvas",
        className,
      )}
    >
      <div className="flex h-[3.75rem] items-center gap-2.5 px-3.5">
        <div className="flex w-11 shrink-0 justify-start">{left}</div>
        <h1 className="min-w-0 flex-1 truncate text-center text-title font-semibold text-ink">
          {title}
        </h1>
        <div className="flex w-11 shrink-0 justify-end">{right}</div>
      </div>
    </header>
  )
}
