/// Whether this till has a fingerprint scanner, and a door that listens to it.
///
/// The scanner's presence is the shell's answer (`fingerprint_state`), never
/// assumed: a door that drew "tempelkan jari" over a till with no scanner
/// would be a door nobody can open. Asked when a screen that needs it opens,
/// off the window's thread in the shell, and again every few seconds while
/// there is none: a scanner plugged in, or its driver installed, after the door
/// opened used to stay unseen until the app was restarted, and every press was
/// refused without a word reaching the node (Central Gudang on riza, 30 Oct
/// 2026).

import { useEffect, useRef, useState } from "react"

import { cancelFinger, device } from "@/edge"
import { isWeb } from "@/edition"

/// True: a scanner the shell has open. False: none (or the web till). Null:
/// still asking.
export function useScanner(): boolean | null {
  const [bound, setBound] = useState<boolean | null>(isWeb ? false : null)
  useEffect(() => {
    if (isWeb) return
    let alive = true
    let again: number | undefined
    const ask = () => {
      void device("fingerprint_state").then((state) => {
        if (!alive) return
        setBound(state.bound)
        if (!state.bound) again = window.setTimeout(ask, ASK_AGAIN_MS)
      })
    }
    ask()
    return () => {
      alive = false
      window.clearTimeout(again)
    }
  }, [])
  return bound
}

/// How soon a till with no scanner asks the shell again.
const ASK_AGAIN_MS = 3_000

/// Listen to the scanner while `active`: `attempt(watch)` waits for one
/// finger under the name `watch` and answers whether to keep listening. The
/// wait is called off by that name the moment `active` goes false or the
/// screen goes away, so a door that changed never answers a finger.
export function useFingerWatch(
  active: boolean,
  attempt: (watch: string) => Promise<boolean>,
  /// A change of screen that must start a fresh wait even while listening
  /// throughout (the cashier's door and the head's).
  key = "",
): void {
  const latest = useRef(attempt)
  latest.current = attempt
  useEffect(() => {
    if (!active) return
    let alive = true
    const watch = `watch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    void (async () => {
      while (alive) {
        const again = await latest.current(watch)
        if (!again) break
        // A beat between waits, so a refusal is read before the next one.
        await new Promise((done) => window.setTimeout(done, 250))
      }
    })()
    return () => {
      alive = false
      void cancelFinger(watch)
    }
  }, [active, key])
}
