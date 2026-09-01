import { useCallback, useEffect, useMemo, useState } from "react"

import {
  MemberContext,
  readMemberId,
  STORAGE_KEY,
  type MemberState,
} from "@/lib/member"

/// Remembering the card between visits.
///
/// A component of its own rather than sitting beside `useMember` in `lib`:
/// a module that exports both a component and its hooks cannot be hot-reloaded,
/// and the whole point of holding the card here is that editing a screen does
/// not make somebody type it again. The context and the hooks stay in
/// `lib/member.ts`, which is what every screen reads.
export function MemberProvider({ children }: { children: React.ReactNode }) {
  const [memberId, setMemberId] = useState<string | null>(readMemberId)

  const remember = useCallback((next: string) => {
    const trimmed = next.trim()
    if (trimmed === "") {
      return
    }
    try {
      localStorage.setItem(STORAGE_KEY, trimmed)
    } catch {
      // Same as reading: this session still works, the next one asks again.
    }
    setMemberId(trimmed)
  }, [])

  const forget = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Nothing to clean up if it was never written.
    }
    setMemberId(null)
  }, [])

  // A phone at a counter is sometimes two tabs. Following the storage event
  // means switching cards in one does not leave the other showing the previous
  // member's points.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea !== localStorage || event.key !== STORAGE_KEY) {
        return
      }
      setMemberId(readMemberId())
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  const value = useMemo<MemberState>(
    () => ({ memberId, remember, forget }),
    [memberId, remember, forget],
  )

  return (
    <MemberContext.Provider value={value}>{children}</MemberContext.Provider>
  )
}
