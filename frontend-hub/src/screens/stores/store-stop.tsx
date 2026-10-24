import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { organisationKeys } from "@/lib/queries/organisation"
import {
  removeStore,
  resumeStore,
  stopStore,
  storePos,
  storesKeys,
  type StoreDetail,
  type StorePos,
  type StoreSummary,
} from "@/lib/queries/stores"
import { toast } from "@/lib/toast"
import { StopDialog } from "@/screens/stores/stop-dialog"
import { saying } from "@/screens/system/units"

/// A store's head-office buttons and the two questions behind them: Stop store
/// while it is open, and Remove store and Resume store once it is stopped. A
/// removed store has none, and neither does one that is still getting ready.
///
/// The questions say what the act will touch, so they read the same tills tab
/// the page's Tills tab draws (`storesKeys.pos`) — one read, shared — for how
/// many tills stop and who has a drawer open. While it is still on its way
/// the facts show a dash, and Remove store stays off: an open drawer it has
/// not heard about is exactly what it must not remove over.
export function StoreStopActions({
  store,
  canManage,
}: {
  store: StoreSummary
  canManage: boolean
}) {
  const client = useQueryClient()
  const unit = store.unit_id
  const stoppable = store.status === "OPEN"
  const removable = store.status === "STOPPED"

  const pos = useQuery({
    queryKey: storesKeys.pos(unit),
    queryFn: ({ signal }) => storePos(unit, signal),
    enabled: canManage && (stoppable || removable),
  })

  const [asking, setAsking] = useState<"stop" | "remove" | null>(null)

  // The answer is the store as it now stands, put straight into the page's own
  // cache; the list, the Tills tab and the units wait for their next read.
  const landed = (detail: StoreDetail) => {
    client.setQueryData(storesKeys.detail(unit), detail)
    void client.invalidateQueries({ queryKey: storesKeys.list() })
    void client.invalidateQueries({ queryKey: storesKeys.pos(unit) })
  }

  const stop = useMutation({
    mutationFn: (reason: string) => stopStore(unit, { reason }),
    onSuccess: (detail) => {
      landed(detail)
      setAsking(null)
    },
  })
  const remove = useMutation({
    mutationFn: (code: string) => removeStore(unit, { code }),
    onSuccess: (detail) => {
      landed(detail)
      void client.invalidateQueries({ queryKey: organisationKeys.all })
      setAsking(null)
    },
  })
  const resume = useMutation({
    mutationFn: () => resumeStore(unit),
    onSuccess: landed,
    onError: (error) => toast.error(saying(error)),
  })

  if (!canManage || (!stoppable && !removable)) return null

  const facts = factsOf(pos.data)

  return (
    <>
      {stoppable && (
        <Button
          variant="destructive"
          onClick={() => {
            stop.reset()
            setAsking("stop")
          }}
        >
          Stop store
        </Button>
      )}
      {removable && (
        <>
          <Button
            variant="destructive"
            onClick={() => {
              remove.reset()
              setAsking("remove")
            }}
          >
            Remove store
          </Button>
          <Button
            variant="primary"
            pending={resume.isPending}
            onClick={() => resume.mutate()}
          >
            {resume.isPending ? "Resuming…" : "Resume store"}
          </Button>
        </>
      )}

      <StopDialog
        open={asking === "stop"}
        onOpenChange={(next) => {
          if (!next) setAsking(null)
        }}
        title={`Stop ${store.name}?`}
        facts={[
          {
            term: "Tills",
            value:
              facts === null
                ? "—"
                : `${facts.tills} ${facts.tills === 1 ? "stops" : "stop"} selling`,
          },
          {
            term: "Open shifts",
            value:
              facts === null
                ? "—"
                : facts.shifts.length === 0
                  ? "None"
                  : `${facts.shifts.map((shift) => shift.name).join(", ")} · closing only`,
          },
          { term: "Store server", value: "Keeps syncing" },
          { term: "Store app", value: "Receiving and returns go on" },
        ]}
        reason
        action="Stop store"
        pending={stop.isPending}
        error={stop.error}
        onConfirm={(reason) => stop.mutate(reason)}
      />

      <StopDialog
        open={asking === "remove"}
        onOpenChange={(next) => {
          if (!next) setAsking(null)
        }}
        title={`Remove ${store.name}?`}
        sub="Can’t be undone"
        facts={[
          {
            term: "Open shifts",
            value:
              facts === null
                ? "—"
                : facts.shifts.length === 0
                  ? "None"
                  : `${facts.shifts.length} · close them at the till first`,
            bad: facts !== null && facts.shifts.length > 0,
          },
          { term: "Sales", value: "Kept" },
          { term: "Stock", value: "Kept" },
          { term: "Journals", value: "Kept" },
          { term: "Store server", value: "Keeps sending what it holds" },
          {
            term: "Tills",
            value: facts === null ? "—" : `${facts.tills} removed`,
          },
        ]}
        code={store.code}
        action={`Remove ${store.name}`}
        blocked={facts === null || facts.shifts.length > 0}
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => remove.mutate(store.code)}
      />
    </>
  )
}

/// What stopping or removing the store will touch, read off its Tills tab: the
/// tills still standing, and a name and a time for every drawer open at one.
/// `null` until that read has arrived.
function factsOf(pos: StorePos | undefined) {
  if (pos === undefined) return null
  const standing = pos.tills.filter((till) => till.status !== "REVOKED")
  return {
    tills: standing.length,
    shifts: standing.flatMap((till) =>
      till.open_shift === null ? [] : [till.open_shift]
    ),
  }
}
