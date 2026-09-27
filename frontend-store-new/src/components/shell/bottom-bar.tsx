import { Link, useRouterState } from "@tanstack/react-router"
import { Menu } from "lucide-react"
import { useEffect, useState } from "react"

import { moduleForPath, phoneTabs } from "@/lib/navigation"
import { cn } from "@/lib/utils"

/// The phone's navigation: the hub's bottom bar
/// (`frontend-hub/src/components/shell/bottom-bar.tsx`) — a hairline over a
/// translucent strip, icon over word, the lit tab in ink — holding the four
/// modules a shift reaches for most. The fifth tab opens the rail and the
/// sidebar as a drawer, which is where People, Shop and the node live.
///
/// Hidden while somebody is typing: an on-screen keyboard plus a tab bar on a
/// 375px screen leaves no room for the field being typed in.
export function BottomBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const current = moduleForPath(pathname).id
  const typing = useTyping()
  const onTab = phoneTabs.some((module) => module.id === current)

  return (
    <nav
      aria-label="Main"
      hidden={typing}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-canvas/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-md md:hidden"
    >
      <ul className="grid h-14 grid-cols-5">
        {phoneTabs.map((module) => {
          const on = module.id === current
          const Icon = module.icon
          return (
            <li key={module.id}>
              <Link
                to={module.home as never}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "group flex h-full flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium",
                  on ? "text-ink" : "text-mute",
                )}
              >
                <span className="transition-[scale] duration-(--t-press) ease-(--ease-out) group-active:scale-[0.9]">
                  <Icon
                    className={cn(
                      "size-[1.375rem]",
                      on ? "stroke-[2] text-ink" : "stroke-[1.6]",
                    )}
                  />
                </span>
                {module.label}
              </Link>
            </li>
          )
        })}
        <li>
          <button
            type="button"
            onClick={onOpenMenu}
            aria-current={onTab ? undefined : "page"}
            className={cn(
              "group flex h-full w-full flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium",
              onTab ? "text-mute" : "text-ink",
            )}
          >
            <span className="transition-[scale] duration-(--t-press) ease-(--ease-out) group-active:scale-[0.9]">
              <Menu
                className={cn(
                  "size-[1.375rem]",
                  onTab ? "stroke-[1.6]" : "stroke-[2] text-ink",
                )}
              />
            </span>
            More
          </button>
        </li>
      </ul>
    </nav>
  )
}

function useTyping(): boolean {
  const [typing, setTyping] = useState(false)
  useEffect(() => {
    const editable = (node: EventTarget | null) =>
      node instanceof HTMLElement &&
      // A scan field holds focus for a hardware scanner, not for a thumb —
      // it is focused on arrival, and treating that as typing would take the
      // navigation off every screen with a scanner on it.
      node.dataset.scan === undefined &&
      (node.isContentEditable ||
        node instanceof HTMLTextAreaElement ||
        (node instanceof HTMLInputElement &&
          ![
            "checkbox",
            "radio",
            "button",
            "submit",
            "range",
            "file",
            "color",
          ].includes(node.type)))
    const onIn = (event: FocusEvent) => setTyping(editable(event.target))
    const onOut = () =>
      requestAnimationFrame(() => setTyping(editable(document.activeElement)))
    document.addEventListener("focusin", onIn)
    document.addEventListener("focusout", onOut)
    return () => {
      document.removeEventListener("focusin", onIn)
      document.removeEventListener("focusout", onOut)
    }
  }, [])
  return typing
}
