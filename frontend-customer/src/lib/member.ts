import { createContext, useContext } from "react"

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
export const STORAGE_KEY = "itulah.member_id"

export type MemberState = {
  memberId: string | null
  remember: (memberId: string) => void
  forget: () => void
}

export const MemberContext = createContext<MemberState | undefined>(undefined)

/// The card in storage, or nothing.
///
/// Exported because the provider needs it twice — once to start from, and
/// again whenever another tab writes it.
export function readMemberId(): string | null {
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

export function useMember(): MemberState {
  const context = useContext(MemberContext)
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
