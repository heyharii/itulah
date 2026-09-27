import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Sheet } from "@/components/ui/sheet"
import { Problem } from "@/components/ui/states"
import { toast } from "@/lib/toast"
import { gaKeys } from "@/lib/queries/ga"
import { openStores, setupKeys, useSetupStatus } from "@/lib/queries/setup"
import {
  StoreList,
  draftStore,
  storesToOpen,
  type DraftStore,
} from "@/screens/setup/store-list"

/// Opening stores once the company is running — the wizard's second step,
/// over Locations.
///
/// The same list and the same write as setup, on purpose: a fourteenth store
/// is not a different kind of thing from the first three, and a second form
/// for it would drift from the first within a month. Whatever a new store
/// needs beyond its name and city — a paired node, an address for the lorry,
/// its EDC — shows up as a task on the home screen, and its row here says
/// its node is still waiting.
export function OpenStoresSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const setup = useSetupStatus(open)
  const [rows, setRows] = useState<DraftStore[]>(() => [draftStore()])
  const [key, setKey] = useState(() => crypto.randomUUID())
  const toOpen = storesToOpen(rows)

  const save = useMutation({
    mutationFn: () => openStores(toOpen, key),
    onSuccess: (answer) => {
      // The places list and the setup tasks both change: new rows in one,
      // new stores waiting for a node and an address in the other.
      void client.invalidateQueries({ queryKey: gaKeys.all })
      void client.invalidateQueries({ queryKey: setupKeys.status() })
      const codes = answer.created.map((store) => store.unit_code)
      toast.success(
        codes.length === 1
          ? `Store ${codes[0]} opened`
          : `${codes.length} stores opened · ${codes[0]}–${codes[codes.length - 1]}`,
        {
          description:
            "Pair each store's server with its code in System › Nodes.",
        }
      )
      setRows([draftStore()])
      setKey(crypto.randomUUID())
      onClose()
    },
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Open store"
      caption="A name and a city. Paste a list to open several at once."
      footer={
        <div className="flex items-center gap-2">
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <span className="flex-1" />
          <Button
            variant="primary"
            disabled={toOpen.length === 0}
            pending={save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending
              ? "Opening stores…"
              : toOpen.length > 1
                ? `Open ${toOpen.length} stores`
                : "Open store"}
          </Button>
        </div>
      }
    >
      <StoreList
        existing={setup.data?.stores ?? null}
        showExisting={false}
        rows={rows}
        onChange={setRows}
      />
      <p className="mt-4 text-meta text-body">
        Each store gets its own cash and reports, floor, back-room and reject
        stock, a return pool at the central warehouse, and a code to pair its
        server. The chart of accounts does not change — stores use the
        company&apos;s accounts.
      </p>
      <Problem error={save.error} className="mt-4" />
    </Sheet>
  )
}
