import { Link } from "@tanstack/react-router"
import { Bell, LogOut, Search, UserRound } from "lucide-react"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react"

import {
  NotificationsPopover,
  useNotificationFeed,
} from "@/components/shell/notification-bell"
import { initialOf } from "@/lib/format"
import { useIdentity, useSignOut } from "@/lib/session"
import { useSheetsOpen } from "@/lib/sheet-space"
import { chatNav, discussionsNav } from "@/screens/workplace/nav"

/// The account corner, as one orb (owner, 2026-10-16:
/// `account-corner-prototype.html`, E · Floating orb).
///
/// Chat, Discussions, the bell, the profile and Sign out were five controls
/// at the foot of the rail, three more on a tablet's top bar and two of the
/// phone's four tabs. They are one round orb now, on every device (owner's
/// rule: the same on every device), with ONE red badge for everything waiting
/// — chat, discussions and notifications together — and a tap opens a 3×2
/// panel of what used to be those controls, plus Search.
///
/// It is dragged anywhere and STAYS WHERE IT IS DROPPED: no pull to a wall
/// (owner, 2026-10-16). Past an edge it follows less and less, and let go out
/// there it springs back inside. The place is remembered per browser, as
/// fractions of the window so a resized window keeps it in the same corner.
///
/// The position is written straight onto the element's `transform` while it
/// moves — sixty React renders a second to move one circle would be the drag
/// stuttering on a cashier's tablet — and the look of its states (held,
/// resting, pressed) lives in `index.css` under `.account-orb`.
const SIZE = 56
const EDGE = 16
/// A move shorter than this is a finger landing, not a drag: the tap stands.
const SLOP = 6
const REST_AFTER = 2500
const MENU_GAP = 10
const KEY = "hub.account-orb"

type Drag = {
  id: number
  startX: number
  startY: number
  fromX: number
  fromY: number
  moved: boolean
}

export function AccountOrb({
  onSearch,
  bars = "",
  pinned = false,
}: {
  /// Opens the ⌘K palette — the shell owns it.
  onSearch: () => void
  /// Changes whenever the shell swaps its bars (phone, tablet, desk, a task
  /// page), so the orb looks again for the top and bottom bars it must clear.
  bars?: string
  /// Set in the rail's foot on a desk (owner, 2026-10-16: "dipakemin aja di
  /// bawah sidebar"): it sits there, is not dragged and never steps back;
  /// the panel grows up and to the right of it. Undocked it floats.
  pinned?: boolean
}) {
  const orb = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const at = useRef({ x: 0, y: 0 })
  const drag = useRef<Drag | null>(null)
  const restTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [bellOpen, setBellOpen] = useState(false)
  const [placed, setPlaced] = useState(false)
  /// Which way the panel and the bell's popup grow: toward the middle.
  const [toward, setToward] = useState({ right: true, low: true })
  const busy = useRef(false)
  busy.current = open || bellOpen

  const identity = useIdentity()
  const signOut = useSignOut()
  const name = identity.data?.display_name ?? identity.data?.username ?? ""
  // The counts the rail's icons carried, read from the same hooks and the
  // same cache entries, so the orb and the screens they open never disagree.
  const feed = useNotificationFeed()
  const notifications = feed.data?.unread ?? 0
  const chat = (chatNav.useCount ?? noCount)() ?? 0
  const discussions = (discussionsNav.useCount ?? noCount)() ?? 0
  const waiting = notifications + chat + discussions

  // Under a record sheet it gets out of the way, as the prototype's does: the
  // sheet's own footer holds that screen's actions, and a circle floating
  // over a Save button is in the way of the one thing on screen that matters.
  const sheets = useSheetsOpen()
  const away = sheets > 0
  if (away && open) setOpen(false)
  if (away && bellOpen) setBellOpen(false)

  const move = useCallback((x: number, y: number) => {
    at.current = { x, y }
    if (orb.current) orb.current.style.transform = `translate(${x}px, ${y}px)`
  }, [])

  const wake = useCallback(() => {
    const node = orb.current
    if (!node || pinned) return
    delete node.dataset.resting
    clearTimeout(restTimer.current)
    restTimer.current = setTimeout(() => {
      if (!busy.current && !drag.current && orb.current)
        orb.current.dataset.resting = ""
    }, REST_AFTER)
  }, [])

  const place = useCallback(() => {
    const node = menu.current
    if (!node) return
    const box = orb.current?.getBoundingClientRect()
    const { x, y } = pinned && box ? { x: box.left, y: box.top } : at.current
    const width = node.offsetWidth || 312
    const height = node.offsetHeight || 170
    const right = x + SIZE / 2 > window.innerWidth / 2
    const low = y + SIZE / 2 > window.innerHeight / 2
    const { minY } = bounds()
    const left = Math.min(
      Math.max(8, right ? x - width - MENU_GAP : x + SIZE + MENU_GAP),
      window.innerWidth - width - 8
    )
    const top = Math.min(
      Math.max(minY, low ? y + SIZE - height : y),
      window.innerHeight - height - 8
    )
    node.style.left = `${left}px`
    node.style.top = `${top}px`
    node.style.transformOrigin = `${low ? "bottom" : "top"} ${right ? "right" : "left"}`
    setToward((was) =>
      was.right === right && was.low === low ? was : { right, low }
    )
  }, [pinned])

  // The first place: the remembered one, else bottom-right — above the
  // phone's bottom bar, where its default sits. Set with the transition off,
  // so it does not spring in from the top-left corner on every page load.
  useLayoutEffect(() => {
    const node = orb.current
    if (!node) return
    if (pinned) return setPlaced(true)
    const b = bounds()
    let saved: { x?: number; y?: number } | null = null
    try {
      saved = JSON.parse(window.localStorage.getItem(KEY) ?? "null")
    } catch {
      saved = null
    }
    const x =
      typeof saved?.x === "number" ? saved.x * window.innerWidth : b.maxX
    const y =
      typeof saved?.y === "number"
        ? saved.y * window.innerHeight
        : b.bottomBar
          ? b.maxY
          : window.innerHeight - SIZE - 96
    const keep = node.style.transition
    node.style.transition = "none"
    const [cx, cy] = clamp(x, y)
    move(cx, cy)
    void node.offsetHeight
    node.style.transition = keep
    setPlaced(true)
    wake()
    return () => clearTimeout(restTimer.current)
  }, [move, wake, pinned])

  // A narrower window, a phone turned sideways, the dock's row rising over
  // the bottom bar: back inside, without forgetting the remembered place.
  useEffect(() => {
    const again = () => {
      if (pinned) return place()
      const [x, y] = clamp(at.current.x, at.current.y)
      move(x, y)
      if (busy.current) place()
    }
    window.addEventListener("resize", again)
    if (pinned)
      return () => window.removeEventListener("resize", again)
    const observer = new ResizeObserver(again)
    for (const bar of document.querySelectorAll("[data-shell-bar]"))
      observer.observe(bar)
    return () => {
      window.removeEventListener("resize", again)
      observer.disconnect()
    }
  }, [bars, move, place, pinned])

  // While the panel or the bell is open the orb stays awake; when both shut
  // the 2.5s starts again.
  useEffect(() => {
    if (open || bellOpen) {
      clearTimeout(restTimer.current)
      if (orb.current) delete orb.current.dataset.resting
    } else wake()
  }, [open, bellOpen, wake])

  // Escape and a press anywhere else close the panel.
  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (orb.current?.contains(target) || menu.current?.contains(target))
        return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      setOpen(false)
      orb.current?.focus()
    }
    document.addEventListener("pointerdown", onDown, true)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onDown, true)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const toggle = () => {
    setBellOpen(false)
    if (open) return setOpen(false)
    place()
    setOpen(true)
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (pinned || drag.current) return // one finger at a time
    if (event.button !== 0 && event.pointerType === "mouse") return
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // A pointer the browser has already let go of: the drag simply ends
      // when it leaves the orb.
    }
    drag.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      fromX: at.current.x,
      fromY: at.current.y,
      moved: false,
    }
    wake()
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const one = drag.current
    if (!one || event.pointerId !== one.id) return
    const dx = event.clientX - one.startX
    const dy = event.clientY - one.startY
    if (!one.moved && Math.hypot(dx, dy) < SLOP) return
    if (!one.moved) {
      one.moved = true
      event.currentTarget.dataset.dragging = ""
      setOpen(false)
      setBellOpen(false)
    }
    // Past an edge the orb follows less and less (damping), never a hard
    // stop: the rubber band says "not there" without refusing the finger.
    const wantX = one.fromX + dx
    const wantY = one.fromY + dy
    const [cx, cy] = clamp(wantX, wantY)
    move(band(wantX, cx), band(wantY, cy))
  }

  const onPointerEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const one = drag.current
    if (!one || event.pointerId !== one.id) return
    drag.current = null
    delete event.currentTarget.dataset.dragging
    if (event.type === "pointercancel") {
      if (one.moved) settle()
      wake()
      return
    }
    if (one.moved) {
      settle()
      wake()
      return
    }
    // A tap: the panel, toward the middle of the screen.
    toggle()
  }

  // Stays where it was let go; only a drop past the edge springs back inside.
  const settle = () => {
    const [x, y] = clamp(at.current.x, at.current.y)
    move(x, y)
    try {
      window.localStorage.setItem(
        KEY,
        JSON.stringify({ x: x / window.innerWidth, y: y / window.innerHeight })
      )
    } catch {
      // A private window: the place simply is not remembered.
    }
  }

  const close = () => setOpen(false)
  const label =
    waiting > 0 ? `${name || "Account"}, ${waiting} waiting` : name || "Account"

  return (
    <>
      <button
        ref={orb}
        type="button"
        className="account-orb"
        data-away={!placed || (away && !pinned) ? "" : undefined}
        data-pinned={pinned ? "" : undefined}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        // The pointer handlers decide taps; a click with no pointer behind it
        // (`detail` 0) is Enter or Space on the focused orb.
        onClick={(event) => {
          if (pinned || event.detail === 0) toggle()
        }}
      >
        <span className="account-orb-face pointer-events-none grid place-items-center rounded-full bg-accent-bg text-[1.0625rem] font-semibold text-accent">
          {initialOf(name)}
        </span>
        <OrbBadge value={waiting} className="top-px right-px" />
      </button>

      <div
        ref={menu}
        role="menu"
        aria-label="Account"
        className="account-orb-menu"
        data-open={open ? "" : undefined}
        inert={!open}
      >
        <Link
          to={chatNav.home as string}
          role="menuitem"
          className="account-orb-tile"
          onClick={close}
        >
          <chatNav.icon className="stroke-[1.6]" />
          Chat
          <OrbBadge value={chat} className="top-1.5 left-[calc(50%+4px)]" />
        </Link>
        <Link
          to={discussionsNav.home as string}
          role="menuitem"
          className="account-orb-tile"
          onClick={close}
        >
          <discussionsNav.icon className="stroke-[1.6]" />
          Discussions
          <OrbBadge value={discussions} className="top-1.5 left-[calc(50%+4px)]" />
        </Link>
        <button
          type="button"
          role="menuitem"
          className="account-orb-tile"
          onClick={() => {
            close()
            setBellOpen(true)
          }}
        >
          <Bell className="stroke-[1.6]" />
          Notifications
          <OrbBadge value={notifications} className="top-1.5 left-[calc(50%+4px)]" />
        </button>
        <Link
          to={"/me" as string}
          role="menuitem"
          className="account-orb-tile"
          onClick={close}
        >
          <UserRound className="stroke-[1.6]" />
          Profile
        </Link>
        <button
          type="button"
          role="menuitem"
          className="account-orb-tile"
          onClick={() => {
            close()
            onSearch()
          }}
        >
          <Search className="stroke-[1.6]" />
          Search
        </button>
        <button
          type="button"
          role="menuitem"
          className="account-orb-tile"
          data-danger=""
          disabled={signOut.isPending}
          onClick={() => {
            close()
            signOut.mutate()
          }}
        >
          <LogOut className="stroke-[1.6]" />
          Sign out
        </button>
      </div>

      <NotificationsPopover
        feed={feed}
        open={bellOpen}
        onOpenChange={setBellOpen}
        anchor={orb}
        side={toward.right ? "left" : "right"}
        align={toward.low ? "end" : "start"}
      />
    </>
  )
}

/// The red count: one figure, 99+ at most, nothing at zero. Its digits are the
/// one text under 15px the hub allows (owner: tiny badge digits).
function OrbBadge({ value, className }: { value: number; className: string }) {
  if (value <= 0) return null
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute grid h-[18px] min-w-[18px] place-items-center rounded-full bg-bad-fg px-[5px] text-[12px] leading-none font-bold text-white tabular-nums ring-2 ring-canvas ${className}`}
    >
      {value > 99 ? "99+" : value}
    </span>
  )
}

/// The box the orb may rest in: 16px from every edge, below any top bar and
/// above the phone's bottom bar (and the dock's row over it).
function bounds() {
  const top = visibleRect('[data-shell-bar="top"]')
  const bottom = visibleRect('[data-shell-bar="bottom"]')
  const minY = (top?.bottom ?? 0) + EDGE
  const floor = bottom?.top ?? window.innerHeight
  return {
    minX: EDGE,
    maxX: window.innerWidth - SIZE - EDGE,
    minY,
    maxY: Math.max(minY, floor - SIZE - EDGE),
    bottomBar: bottom !== null,
  }
}

function clamp(x: number, y: number): [number, number] {
  const b = bounds()
  return [
    Math.min(Math.max(b.minX, x), b.maxX),
    Math.min(Math.max(b.minY, y), b.maxY),
  ]
}

/// Damped travel past the bound: the square root of the overshoot, times 3.
function band(value: number, bound: number): number {
  return bound + Math.sign(value - bound) * Math.sqrt(Math.abs(value - bound)) * 3
}

function visibleRect(selector: string): DOMRect | null {
  const node = document.querySelector<HTMLElement>(selector)
  if (!node) return null
  const rect = node.getBoundingClientRect()
  return rect.height > 0 && rect.width > 0 ? rect : null
}

function noCount(): null {
  return null
}
