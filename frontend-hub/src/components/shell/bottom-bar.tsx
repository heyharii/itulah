import { useQuery } from "@tanstack/react-query"
import { Link, useRouterState } from "@tanstack/react-router"
import { Bell, LayoutGrid, MessageSquare, UserRound } from "lucide-react"
import { useEffect, useState } from "react"

import {
  fallbackInterval,
  useNotificationStream,
} from "@/lib/notification-stream"
import { listNotifications, systemKeys } from "@/lib/queries/system"
import { usePushReconcile } from "@/lib/use-push-reconcile"
import { cn } from "@/lib/utils"
import { useChatUnread } from "@/screens/workplace/chat-unread"

/// The phone's navigation: four tabs at the thumb's edge.
///
/// Under 48rem the rail and the sidebar were one drawer behind a hamburger in
/// the top-left corner — the one place on a phone a thumb does not reach —
/// and the chat, discussions and bell were three icons squeezed into the top
/// bar beside it. The owner's shape (2026-09-25), a super-app's: Apps (the
/// launcher, `/apps`), Messages (chat and discussions), Notifications, and
/// Profile. From 48rem up nothing here is drawn; the rail is the navigation.
///
/// No motion on a tab change. Tabs are pressed dozens of times a session, and
/// motion there reads as lag by the tenth (Emil Kowalski's frequency rule):
/// the lit tab changes colour, and the press itself gives (`active:scale`).
const TABS = [
  {
    to: "/apps",
    label: "Apps",
    icon: LayoutGrid,
    // Everything that is not another tab is inside an app.
    owns: (path: string) =>
      !MESSAGES.some((one) => within(path, one)) &&
      !within(path, "/system/notifications") &&
      !PROFILE.some((one) => within(path, one)),
  },
  {
    to: "/chat",
    label: "Messages",
    icon: MessageSquare,
    owns: (path: string) => MESSAGES.some((one) => within(path, one)),
  },
  {
    to: "/system/notifications",
    label: "Notifications",
    icon: Bell,
    owns: (path: string) => within(path, "/system/notifications"),
  },
  {
    to: "/me",
    label: "Profile",
    icon: UserRound,
    owns: (path: string) => PROFILE.some((one) => within(path, one)),
  },
] as const

const MESSAGES = ["/chat", "/discussions"]
const PROFILE = ["/me", "/system/account"]

function within(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`)
}

export function BottomBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const typing = useTyping()

  // The bell's own query and key: one cache entry behind the badge here, the
  // launcher's "unread" line and the Notifications screen. Kept live by the
  // notification stream, as the bell is on a desk (`notification-bell.tsx`).
  const stream = useNotificationStream()
  usePushReconcile()
  const feed = useQuery({
    queryKey: [...systemKeys.notifications(), "bell", 8] as const,
    queryFn: ({ signal }) => listNotifications(8, signal),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: fallbackInterval(stream.state),
  })
  const unread = feed.data?.unread ?? 0
  // Messages waiting in Chat, on the Messages tab — the same count the Chat
  // icon carries on a desk.
  const chatUnread = useChatUnread()

  return (
    <nav
      aria-label="Main"
      // Out of the way while the keyboard is up: four tabs riding on top of
      // a keyboard take a fifth of what is left of the glass, over the field
      // being typed into.
      hidden={typing}
      // A material, not a slab: translucent white over a strong blur, so the
      // list scrolling under it stays faintly present, and a hairline of
      // light at its top edge rather than a grey rule.
      className="fixed inset-x-0 bottom-0 z-30 border-t border-black/[0.06] bg-canvas/80 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-xl backdrop-saturate-150 md:hidden"
    >
      <ul className="grid h-14 grid-cols-4">
        {TABS.map((tab) => {
          const on = tab.owns(pathname)
          const Icon = tab.icon
          return (
            <li key={tab.to}>
              <Link
                to={tab.to as string}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "group flex h-full flex-col items-center justify-center gap-[0.1875rem] text-[0.875rem] font-medium tracking-[0.005em]",
                  // The lit tab takes the accent — the one colour this
                  // system reserves for "this one" — the way a phone's own
                  // tab bar tints where you are.
                  on ? "text-accent" : "text-mute"
                )}
              >
                <span className="relative transition-[scale] duration-(--t-press) ease-(--ease-out) group-active:scale-[0.9]">
                  <Icon
                    className={cn(
                      "size-6",
                      on ? "stroke-[2.1]" : "stroke-[1.7]"
                    )}
                  />
                  {tab.to === "/system/notifications" && unread > 0 && (
                    <span className="absolute -top-1 -right-2 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[0.875rem] font-semibold text-white tabular-nums ring-2 ring-canvas">
                      {unread > 99 ? "99+" : unread}
                    </span>
                  )}
                  {tab.to === "/chat" &&
                    chatUnread !== null &&
                    chatUnread > 0 && (
                      <span className="absolute -top-1 -right-2 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[0.875rem] font-semibold text-white tabular-nums ring-2 ring-canvas">
                        {chatUnread > 99 ? "99+" : chatUnread}
                      </span>
                    )}
                </span>
                {tab.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/// Whether a text field on the page has the keyboard. Focus rather than the
/// viewport's height: iOS does not resize the layout for its keyboard, and
/// the visual viewport shrinks for the URL bar as well as the keyboard, so a
/// height rule guesses where focus knows.
function useTyping(): boolean {
  const [typing, setTyping] = useState(false)
  useEffect(() => {
    const editable = (node: EventTarget | null) =>
      node instanceof HTMLElement &&
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
