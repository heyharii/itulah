import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { SavedDialog } from "@/components/ui/dialog"
import { Sheet } from "@/components/ui/sheet"
import { Problem } from "@/components/ui/states"
import { gaKeys } from "@/lib/queries/ga"
import {
  openStores,
  setupKeys,
  useSetupStatus,
  type CreatedStore,
} from "@/lib/queries/setup"
import { storesKeys } from "@/lib/queries/stores"
import { ManagerLinks } from "@/screens/setup/manager-links"
import {
  StoreList,
  draftStore,
  storesReady,
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
  const [created, setCreated] = useState<readonly CreatedStore[] | null>(null)
  const toOpen = storesToOpen(rows)
  const ready = storesReady(rows)

  const save = useMutation({
    mutationFn: () => openStores(toOpen, key),
    onSuccess: (answer) => {
      // The places list and the setup tasks both change: new rows in one,
      // new stores waiting for a node and an address in the other.
      void client.invalidateQueries({ queryKey: gaKeys.all })
      void client.invalidateQueries({ queryKey: setupKeys.status() })
      // So `ManagerLinks` below can point each new store at its own page —
      // `CreatedStore` only carries the client's code, not the internal id
      // `/stores/$unit` takes.
      void client.invalidateQueries({ queryKey: storesKeys.list() })
      const codes = answer.created.map((store) => store.unit_code)
      // Created, not open — opening is a separate decision, made from the
      // store's own page once its checklist is green (`overview-tab.tsx`).
      // The codes stay in the receipt dialog until they are read (the owner,
      // 2026-10-04); the links screen waits underneath.
      setSaved({
        codes,
        note:
          codes.length === 1
            ? `Install its server from ${codes[0]}’s own page.`
            : "Install each server from its own store page.",
      })
      setCreated(answer.created)
    },
  })
  /// The stores the save minted, held in the receipt dialog until they are
  /// read.
  const [saved, setSaved] = useState<{
    readonly codes: readonly string[]
    readonly note: string
  } | null>(null)

  function reset() {
    setRows([draftStore()])
    setKey(crypto.randomUUID())
    setCreated(null)
    save.reset()
  }

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            reset()
            onClose()
          }
        }}
        title={created ? "Send these links" : "Open store"}
        caption={
          created
            ? undefined
            : "A name, a city and a manager for each. Paste a list to open several at once."
        }
        footer={
          created ? (
            <div className="flex justify-end">
              <Button
                onClick={() => {
                  reset()
                  onClose()
                }}
              >
                Done
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                variant="quiet"
                onClick={() => {
                  reset()
                  onClose()
                }}
              >
                Cancel
              </Button>
              <span className="flex-1" />
              <Button
                variant="primary"
                disabled={!ready}
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
          )
        }
      >
        {created ? (
          <ManagerLinks stores={created} />
        ) : (
          <>
            <StoreList
              existing={setup.data?.stores ?? null}
              showExisting={false}
              rows={rows}
              onChange={setRows}
            />
            <p className="mt-4 text-meta text-body">
              Each store gets its own cash and reports, floor, back-room and
              reject stock, a return pool at the warehouse, a code to pair its
              server, and a manager invited by link — the same link every other
              invitation sends.
            </p>
            <Problem error={save.error} className="mt-4" />
          </>
        )}
      </Sheet>
      <SavedDialog
        open={saved !== null}
        onOpenChange={(next) => {
          if (!next) setSaved(null)
        }}
        title={
          saved !== null &&
          (saved.codes.length === 1 ? (
            <>Store {saved.codes[0]} created</>
          ) : (
            <>
              {saved.codes.length} stores created · {saved.codes[0]}–
              {saved.codes[saved.codes.length - 1]}
            </>
          ))
        }
      >
        {saved?.note}
      </SavedDialog>
    </>
  )
}
