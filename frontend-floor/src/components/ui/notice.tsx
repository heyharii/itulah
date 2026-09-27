import { CircleAlert, CircleCheck } from "lucide-react"

import { useNotice } from "@/lib/notice"
import { cn } from "@/lib/utils"

/// Where `notice()` (lib/notice.ts) is drawn: a card rising a few pixels above
/// the tab bar, and fading back out. Mounted once, in the shell.
///
/// Keyed by the notice's id, so a second notice replaces the first by rising
/// again rather than by its words changing in place.
export function NoticeHost() {
  const { notice, shown } = useNotice()

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-[calc(4.25rem+env(safe-area-inset-bottom,0px))] z-[60] flex justify-center"
    >
      {notice !== null && (
        <div
          key={notice.id}
          className={cn(
            "flex w-full max-w-[26rem] items-center gap-2.5 rounded-card border border-hairline bg-canvas px-3.5 py-3 text-control text-text shadow-float",
            "transition-[opacity,translate] duration-400 ease-(--ease-out) starting:translate-y-3 starting:opacity-0",
            !shown && "translate-y-2 opacity-0 duration-200",
          )}
        >
          {notice.tone === "ok" ? (
            <CircleCheck className="size-5 shrink-0 text-ok" />
          ) : (
            <CircleAlert className="size-5 shrink-0 text-warn" />
          )}
          <span className="min-w-0">{notice.text}</span>
        </div>
      )}
    </div>
  )
}
