import { useNavigate, type LinkProps } from "@tanstack/react-router"
import { useEffect } from "react"

import { onArrival } from "@/lib/notification-stream"
import { toast } from "@/lib/toast"

/// A store's server connecting, then being ready, said where the Admin is
/// looking.
///
/// Both are raised by the cloud while somebody stands at a shop's PC typing the
/// install code (`node_enrolment.rs`), and the person who issued the code is
/// usually on another screen waiting for exactly this. The bell already holds
/// them; this is the moment, once, with a way straight to the store's Server
/// tab. Nothing is drawn here — it only listens.
export function StoreServerNews() {
  const navigate = useNavigate()
  useEffect(
    () =>
      onArrival((arrival) => {
        const unit = arrival.subject_id
        if (
          !arrival.kind.startsWith("store.server.") ||
          arrival.subject_kind !== "unit" ||
          !unit
        ) {
          return
        }
        toast(arrival.title, {
          id: arrival.notification_id,
          description: arrival.body,
          duration: 9000,
          action: {
            label: "Open",
            onClick: () =>
              void navigate({
                to: `/stores/${encodeURIComponent(unit)}` as LinkProps["to"],
                search: { "store-tab": "server" } as never,
              }),
          },
        })
      }),
    [navigate]
  )
  return null
}
