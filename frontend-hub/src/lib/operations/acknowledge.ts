import { useMutation, useQueryClient } from "@tanstack/react-query"

import { acknowledgeChanges, type DcChange } from "@/lib/operations/changes"
import { keys } from "@/lib/operations/keys"
import { toast } from "@/lib/toast"

/// "Got it": the warehouse has seen what MD changed (owner, 10 Oct 2026).
/// Awareness only, nothing moves; afterwards the change is gone from
/// `GET /api/v1/dc/changes`, so the tags, the standalone Cancelled card and
/// the picker's banner all drop with it. The board's lanes are refetched too:
/// a fully cancelled picklist leaves the To pick list once it is acknowledged.
export function useAcknowledgeChanges() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (items: readonly DcChange[]) => acknowledgeChanges(items),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.changes() })
      void client.invalidateQueries({ queryKey: keys.picklistsToPick() })
      void client.invalidateQueries({ queryKey: keys.picklists() })
      void client.invalidateQueries({ queryKey: keys.owed() })
    },
    onError: () => toast.error("Could not acknowledge. Try again."),
  })
}
