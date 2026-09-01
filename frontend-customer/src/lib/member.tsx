/* eslint-disable react-refresh/only-export-components */
import * as React from "react"

/// Which member's screen this is.
///
/// An id in browser storage, and nothing more. It is NOT a credential and must
/// never be treated as one: the system has no customer identity yet — no
/// account, no password, no one-time code — so the honest description of this
/// value is "the card number the person typed in", the same trust as a card
/// they could hand to anyone.
///
/// Everything this app can do with it is a read, and every read is also behind
/// the node's own session. When customer sign-in exists, the member comes from
/// that session and this file becomes a remembered convenience or disappears
/// entirely; nothing else in the app has to change, because every screen asks
/// `useMember()` rather than reading storage itself.
const STORAGE_KEY = "itulah.member_id"

type MemberState = {
  memberId: string | null
  remember: (memberId: string) => void
  forget: () => void
}

const MemberContext = React.createContext<MemberState | undefined>(undefined)

function read(): string | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)?.trim()
    return stored === undefined || stored === "" ? null : stored
  } catch {
    // Private browsing, or storage disabled. Not being able to remember the
    // card is a smaller problem than a blank screen, so the app carries on and
    // asks for it again.
    return null
  }
}

export function MemberProvider({ children }: { children: React.ReactNode }) {
  const [memberId, setMemberId] = React.useState<string | null>(read)

  const remember = React.useCallback((next: string) => {
    const trimmed = next.trim()
    if (trimmed === "") {
      return
    }
    try {
      localStorage.setItem(STORAGE_KEY, trimmed)
    } catch {
      // Same as above: this session still works, the next one asks again.
    }
    setMemberId(trimmed)
  }, [])

  const forget = React.useCallback(() => {
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
  React.useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea !== localStorage || event.key !== STORAGE_KEY) {
        return
      }
      setMemberId(read())
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  const value = React.useMemo(
    () => ({ memberId, remember, forget }),
    [memberId, remember, forget],
  )

  return (
    <MemberContext.Provider value={value}>{children}</MemberContext.Provider>
  )
}

export function useMember(): MemberState {
  const context = React.useContext(MemberContext)
  if (context === undefined) {
    throw new Error("useMember must be used within a MemberProvider")
  }
  return context
}

/// The member id, where the screen cannot render without one.
///
/// Screens below the gate are only mounted when a card is known, so they read
/// this instead of narrowing `string | null` at every call site.
export function useMemberId(): string {
  const { memberId } = useMember()
  if (memberId === null) {
    throw new Error("this screen renders only behind the member gate")
  }
  return memberId
}
