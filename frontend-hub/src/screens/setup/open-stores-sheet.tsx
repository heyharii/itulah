import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { ArrowRight } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Sheet } from "@/components/ui/sheet"
import { Problem } from "@/components/ui/states"
import { gaKeys } from "@/lib/queries/ga"
import { inventoryKeys } from "@/lib/queries/inventory"
import { organisationKeys } from "@/lib/queries/organisation"
import {
  openStores,
  setupKeys,
  useSetupStatus,
  type CreatedStore,
} from "@/lib/queries/setup"
import {
  holdInstall,
  installStoreServer,
  listStores,
  storesKeys,
  type StoreServerInstall,
} from "@/lib/queries/stores"
import { ManagerLinks } from "@/screens/setup/manager-links"
import { useStorePath } from "@/screens/stores/shared"
import {
  StoreList,
  draftStore,
  storesReady,
  storesToOpen,
  type DraftStore,
} from "@/screens/setup/store-list"

/// Adding stores once the company is running — the wizard's second step,
/// over Locations and the Stores list.
///
/// The same list and the same write as setup, on purpose: a fourteenth store
/// is not a different kind of thing from the first three, and a second form
/// for it would drift from the first within a month. Whatever a new store
/// needs beyond its name and city — a paired node, an address for the lorry,
/// its EDC — shows up as a task on the home screen, and its row here says
/// its node is still waiting.
///
/// Adding one store does not end in a dialog that lets itself go: the sheet
/// stays on the manager's link and the server's install code until somebody
/// presses Go to the store, which lands on its Server tab with the code
/// already issued. Several at once keep the sheet with every link and no code
/// — each server is installed from its own page.
export function OpenStoresSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const navigate = useNavigate()
  const storePath = useStorePath()
  const setup = useSetupStatus(open)
  const [rows, setRows] = useState<DraftStore[]>(() => [draftStore()])
  const [key, setKey] = useState(() => crypto.randomUUID())
  const [created, setCreated] = useState<readonly CreatedStore[] | null>(null)
  /// The one store just added: its page, and the code issued for its server.
  const [landed, setLanded] = useState<Landed | null>(null)
  const toOpen = storesToOpen(rows)
  const ready = storesReady(rows)

  const save = useMutation({
    mutationFn: async () => {
      const answer = await openStores(toOpen, key)
      // One store: issue its install code now, so its page shows it at once.
      // Never a reason to fail the save — the store exists either way.
      const first =
        answer.created.length === 1
          ? await issueFirstCode(client, answer.created[0].unit_code)
          : null
      return { answer, first }
    },
    onSuccess: ({ answer, first }) => {
      // The places list and the setup tasks both change: new rows in one,
      // new stores waiting for a node and an address in the other.
      void client.invalidateQueries({ queryKey: gaKeys.all })
      void client.invalidateQueries({ queryKey: setupKeys.status() })
      // So `ManagerLinks` below can point each new store at its own page —
      // `CreatedStore` only carries the client's code, not the internal id
      // `/stores/$unit` takes.
      void client.invalidateQueries({ queryKey: storesKeys.list() })
      // The new store is a destination in Allotment, a column on the Ops
      // boards and a card in Inventory at once; those screens read the units
      // register and the fleet's pools, which would otherwise keep showing the
      // store by its bare name (or not at all) for minutes.
      void client.invalidateQueries({ queryKey: organisationKeys.all })
      void client.invalidateQueries({ queryKey: inventoryKeys.fleet() })
      // Added, not open — opening is a separate decision, made from the
      // store's own page once its checklist is green (`overview-tab.tsx`).
      setCreated(answer.created)
      setLanded(first)
    },
  })

  function reset() {
    setRows([draftStore()])
    setKey(crypto.randomUUID())
    setCreated(null)
    setLanded(null)
    save.reset()
  }

  const only = created?.length === 1 ? created[0] : null

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset()
          onClose()
        }
      }}
      title={
        created
          ? only
            ? `${only.name} added`
            : "Send these links"
          : "Add store"
      }
      caption={
        created
          ? undefined
          : "A name and a manager for each. Paste a list to add several at once."
      }
      footer={
        created ? (
          <div className="flex items-center gap-2">
            <Button
              variant="quiet"
              onClick={() => {
                reset()
                onClose()
              }}
            >
              Done
            </Button>
            <span className="flex-1" />
            {only && landed?.unitId && (
              <Button
                variant="primary"
                onClick={() => {
                  // A fresh search carries the Server tab and, by leaving
                  // `new-stores` out, closes this sheet with the screen.
                  void navigate({
                    to: storePath(landed.unitId ?? ""),
                    search: { "store-tab": "server" } as never,
                  })
                }}
              >
                Go to {only.name}
                <ArrowRight />
              </Button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button data-cancel
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
                ? "Adding…"
                : toOpen.length > 1
                  ? `Add ${toOpen.length} stores`
                  : "Add store"}
            </Button>
          </div>
        )
      }
    >
      {created ? (
        <div className="flex flex-col gap-4">
          {!only && (
            <p className="text-[0.9375rem] text-body">
              {created.length} stores added · {created[0].unit_code}–
              {created[created.length - 1].unit_code}
            </p>
          )}
          <ManagerLinks stores={created} />
          {landed?.install && (
            <div>
              <span className="mb-1.5 block text-[0.9375rem] font-medium text-ink">
                Install its server
              </span>
              <div className="flex items-center gap-3 rounded-inner border border-hairline-2 px-3.5 py-3">
                <span className="min-w-0 flex-1 font-mono text-[1.125rem] font-semibold tracking-[0.04em] text-ink select-all">
                  {landed.install.code}
                </span>
                <span className="text-[0.9375rem] text-mute">
                  Install code · 1 hour
                </span>
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          <StoreList
            existing={setup.data?.stores ?? null}
            showExisting={false}
            rows={rows}
            onChange={setRows}
          />
          <Problem error={save.error} className="mt-4" />
        </>
      )}
    </Sheet>
  )
}

/// What the sheet knows about the one store it just added.
interface Landed {
  /// The internal id `/stores/$unit` takes; `null` when the list could not be
  /// read back to find it.
  readonly unitId: string | null
  /// The install code issued for its server; `null` when that failed — its
  /// page then offers "Install server" instead.
  readonly install: StoreServerInstall | null
}

/// Find the store that was just added in the list (`CreatedStore` carries only
/// the client's code), issue its server's install code, and hold the code in
/// memory for the Server tab to show. Each step may fail without taking the
/// save with it.
async function issueFirstCode(
  client: QueryClient,
  code: string
): Promise<Landed> {
  try {
    const list = await client.fetchQuery({
      queryKey: storesKeys.list(),
      queryFn: ({ signal }) => listStores(signal),
      staleTime: 0,
    })
    const unitId = list.items.find((row) => row.code === code)?.unit_id ?? null
    if (unitId === null) return { unitId: null, install: null }
    try {
      const install = await installStoreServer(unitId)
      holdInstall(unitId, install)
      return { unitId, install }
    } catch {
      return { unitId, install: null }
    }
  } catch {
    return { unitId: null, install: null }
  }
}
