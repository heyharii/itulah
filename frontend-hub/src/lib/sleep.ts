import { useSyncExternalStore } from "react"

/// Sleep (owner, 2026-10-18): the hub locked without signing out. The
/// session stays; the screen is covered until the person types their password
/// again. Kept in this browser, so a reload or another tab stays asleep.
const KEY = "hub.asleep"

const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1"
  } catch {
    return false
  }
}

function write(asleep: boolean) {
  try {
    if (asleep) window.localStorage.setItem(KEY, "1")
    else window.localStorage.removeItem(KEY)
  } catch {
    // A private window: asleep only until the page is left.
  }
  memory = asleep
  for (const listener of listeners) listener()
}

/// Read once from storage, then kept here so a browser that refuses storage
/// still sleeps for as long as the page is open.
let memory: boolean | null = null

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) {
      memory = read()
      listener()
    }
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

function snapshot(): boolean {
  if (memory === null) memory = read()
  return memory
}

export function useAsleep(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false)
}

export const sleepNow = () => write(true)
export const wakeUp = () => write(false)

/// Asleep on its own after this long with no key, click or touch in any tab
/// of this browser (owner, 2026-10-18).
export const IDLE_SLEEP_MS = 15 * 60_000
const ACTIVE_KEY = "hub.active-at"

/// Watches for a person at the desk and puts the hub to sleep once nobody has
/// been for `IDLE_SLEEP_MS`. The last activity is shared through storage, so a
/// tab left in the background does not fall asleep while another is in use.
export function watchIdle(): () => void {
  let last = 0
  const note = () => {
    const now = Date.now()
    if (now - last < 15_000) return
    last = now
    try {
      window.localStorage.setItem(ACTIVE_KEY, String(now))
    } catch {
      // No storage: this tab's own clock decides.
    }
  }
  const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const
  for (const name of events)
    window.addEventListener(name, note, { passive: true })
  note()
  const timer = window.setInterval(() => {
    let shared = last
    try {
      shared = Math.max(
        last,
        Number(window.localStorage.getItem(ACTIVE_KEY) ?? 0)
      )
    } catch {
      // As above.
    }
    if (Date.now() - shared >= IDLE_SLEEP_MS && !snapshot()) sleepNow()
  }, 30_000)
  return () => {
    for (const name of events) window.removeEventListener(name, note)
    window.clearInterval(timer)
  }
}
