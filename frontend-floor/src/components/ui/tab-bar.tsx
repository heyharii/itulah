import { useEffect, useState } from "react"

import { AppLink } from "@/components/ui/app-link"
import type { NavItem } from "@/lib/navigation"
import { cn } from "@/lib/utils"

/// The tab bar: the hub's phone bar, so the two apps a warehouse phone carries
/// answer "where am I" the same way.
///
/// It was five floating squircles with no labels, drawn from the
/// distribution-frame recreation. The words came back on the owner's review
/// (2026-09-26): Terima, Ambil, Kemas and Kirim are a truck, a checklist, a
/// box and a paper plane, and somebody on their second day reads the word
/// before they learn the glyph. The hub's Profile/Apps bar already had them,
/// and a phone holding both apps should not teach two navigations.
///
/// A material rather than a slab — translucent white over a strong blur — so
/// the list scrolling beneath stays faintly present, which is the scroll cue the
/// old gradient fade used to give. The lit tab takes the accent.
export function TabBar({
  items,
  activePath,
  className,
}: {
  items: readonly NavItem[]
  activePath: string | null
  /// Where the bar does not belong. The desk carries its own destinations, so
  /// the counter hides this rather than stacking two navigations.
  className?: string
}) {
  const typing = useTyping()

  return (
    <nav
      aria-label="Sections"
      // Out of the way while the keyboard is up: five tabs riding on top of it
      // take a fifth of what is left of the glass, right over the field.
      hidden={typing}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-black/[0.06] bg-canvas/80 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-xl backdrop-saturate-150",
        className,
      )}
    >
      <ul
        className="grid h-14"
        style={{
          gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
        }}
      >
        {items.map((item) => {
          const on = item.path === activePath
          const Icon = item.icon
          return (
            <li key={item.path}>
              <AppLink
                to={item.path}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "group flex h-full flex-col items-center justify-center gap-[0.1875rem] text-[0.6875rem] font-medium tracking-[0.005em] select-none",
                  on ? "text-accent" : "text-mute",
                )}
              >
                <span className="transition-[scale] duration-(--t-press) ease-(--ease-out) group-active:scale-[0.9]">
                  <Icon className="size-6" strokeWidth={on ? 2.1 : 1.7} />
                </span>
                {item.label}
              </AppLink>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/// Whether a text field has focus — the on-screen keyboard's stand-in, since a
/// browser will not say whether one is up. A field with `inputmode="none"` does
/// not count: that is the scan field waiting for a scanner, which raises no
/// keyboard. Neither does a checkbox.
function useTyping(): boolean {
  const [typing, setTyping] = useState(false)
  useEffect(() => {
    const editable = (node: EventTarget | null) =>
      node instanceof HTMLElement &&
      (node.isContentEditable ||
        node instanceof HTMLTextAreaElement ||
        (node instanceof HTMLInputElement &&
          node.inputMode !== "none" &&
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
      // The next field may take focus in the same tick; read where focus
      // landed rather than assuming it left.
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
