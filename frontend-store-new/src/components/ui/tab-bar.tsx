import { AppLink } from "@/components/ui/app-link"
import type { TabItem } from "@/lib/navigation"
import { cn } from "@/lib/utils"

/// The floating squircle tab bar.
///
/// Measured from `_archive-distribution-frames.html`, which is the recreation
/// DESIGN.md's responsive model was derived from:
///
/// ```
/// .tabbar { position:fixed; left:0; right:0; bottom:18px;
///           justify-content:center; gap:14px }
/// .tab    { width:54px; height:54px; border-radius:18px;
///           color:#9c9da3; background:rgba(246,246,248,.9) }
/// .tab.on { background:var(--accent); color:#fff;
///           box-shadow:0 8px 20px rgba(60,82,240,.35) }
/// ```
///
/// The thing to get right, and the thing everyone gets wrong from memory:
/// **there is no containing bar.** These are separate squircles floating over
/// the content with 14px of nothing between them. A pill, a card or a
/// background behind the row would be a different design system.
///
/// The active one is a solid `{accent}` squircle with a white glyph — the
/// desktop treatment (pale pill + accent icon) travelling to a phone, exactly
/// as DESIGN.md says it should. There is no label under any of them: four
/// destinations named by icon is what the reference draws, and a word under
/// each would make the row a bar again.
export function TabBar({
  items,
  activePath,
}: {
  items: readonly TabItem[]
  activePath: string | null
}) {
  return (
    <>
      {/* The list fades out beneath the bar rather than being cut off by it —
          DESIGN.md calls the last card clipping under the bar a scroll cue, and
          the gradient is what makes it read as one instead of as a bug. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 bottom-0 z-30 h-[6.875rem] bg-gradient-to-t from-canvas from-30% to-transparent"
      />
      <nav
        aria-label="Sections"
        className="bottom-safe fixed inset-x-0 z-40 flex justify-center gap-[0.875rem]"
      >
        {items.map((item) => {
          const on = item.path === activePath
          const Icon = item.icon
          return (
            <AppLink
              key={item.path}
              to={item.path}
              aria-label={item.label}
              aria-current={on ? "page" : undefined}
              className={cn(
                "grid size-[3.375rem] place-items-center rounded-[1.125rem] transition-colors",
                on
                  ? // The one glow in the system, and it is the accent's own colour
                    // rather than a literal: `shadow-accent/35` fills the
                    // arbitrary shadow's colour slot from the token, so a
                    // change to `--accent` reaches it.
                    "bg-accent text-on-dark shadow-[0_8px_20px] shadow-accent/35"
                  : "bg-soft-3/90 text-line-ico backdrop-blur-[6px]",
              )}
            >
              <Icon className="size-[1.3125rem]" strokeWidth={1.6} />
            </AppLink>
          )
        })}
      </nav>
    </>
  )
}
