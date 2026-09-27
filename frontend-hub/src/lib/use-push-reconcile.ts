import { useEffect } from "react"

import { reconcilePush } from "@/lib/push"
import { useIdentity } from "@/lib/session"

let reconciledFor: string | null = null

/// Once per open of the app, per person: re-register a subscription the
/// server may have lost, or drop one that belongs to somebody else
/// (`reconcilePush` says why each). Mounted beside the notification stream,
/// by the bell and the bottom bar, so it runs wherever the app is signed in.
export function usePushReconcile() {
  const username = useIdentity().data?.username ?? ""
  useEffect(() => {
    if (username === "" || reconciledFor === username) return
    reconciledFor = username
    void reconcilePush(username).catch(() => undefined)
  }, [username])
}
