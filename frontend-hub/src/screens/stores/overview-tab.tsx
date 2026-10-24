import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, type LinkProps } from "@tanstack/react-router"
import { ArrowUpRight, Check, ChevronRight } from "lucide-react"

import { AppLink } from "@/components/ui/app-link"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { ConfirmButton } from "@/components/ui/dialog"
import { Fact, Facts } from "@/components/ui/sheet"
import { Banner } from "@/components/ui/states"
import { day } from "@/lib/format"
import { encodeFilters } from "@/lib/filters"
import {
  openStore,
  serverExtras,
  storeDetail,
  storesKeys,
  type StoreCheck,
  type StoreDetail as StoreDetailAnswer,
  type StoreSummary,
} from "@/lib/queries/stores"
import { inventoryKeys } from "@/lib/queries/inventory"
import { organisationKeys } from "@/lib/queries/organisation"
import { cn } from "@/lib/utils"
import { ExceptionsCard } from "@/screens/stores/exceptions-shared"
import { serverStateLabel } from "@/screens/stores/shared"
import { OneDeviceValue, TillSeatsValue } from "@/screens/stores/till-seats"
import { FleetStoreStrip } from "@/screens/system/fleet-shared"

/// Where a store page's tabs can be switched to from inside a tab.
export type StoreTab = "overview" | "people" | "tills" | "server" | "status"

/// Who answers for each line of the checklist, and where it is dealt with.
/// `server` and `tills` are tabs of this page; `people`, `payments` and `stock`
/// are other departments' screens. A line with no `go` is done at the store
/// itself.
const CHECKS: Readonly<
  Record<
    string,
    { owner: string; go?: "server" | "tills" | "people" | "payments" | "stock" }
  >
> = {
  server: { owner: "Admin", go: "server" },
  // A new POS asks to join at the store and head office approves it on the
  // POS tab (owner, 2026-10-24).
  tills: { owner: "Admin", go: "tills" },
  team: { owner: "HR", go: "people" },
  payments: { owner: "Finance", go: "payments" },
  first_stock: { owner: "MD", go: "stock" },
}

/// Name, address, PIC, the checklist, and the one button this whole module
/// exists for — the mock's Overview tab.
export function OverviewTab({
  detail,
  onOpenTab,
}: {
  detail: StoreDetailAnswer
  onOpenTab: (tab: StoreTab) => void
}) {
  const client = useQueryClient()
  const unit = detail.store.unit_id

  // The page already holds this detail; a second observer on the same key is
  // here only to keep it fresh while the store is still getting ready — the
  // shop joins tills, HR invites the manager, Finance picks payment methods,
  // and each of them ticks a line on this list.
  const live = useQuery({
    queryKey: storesKeys.detail(unit),
    queryFn: ({ signal }) => storeDetail(unit, signal),
    refetchInterval: (query) =>
      query.state.data?.store.status === "GETTING_READY" ? 5_000 : false,
  })
  const { store, address, checks, can_open, can_manage } = live.data ?? detail

  const open = useMutation({
    mutationFn: (note: string) =>
      openStore(store.unit_id, { note: note.trim() === "" ? undefined : note }),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: storesKeys.detail(store.unit_id),
      })
      void client.invalidateQueries({ queryKey: storesKeys.list() })
      void client.invalidateQueries({ queryKey: organisationKeys.all })
      void client.invalidateQueries({ queryKey: inventoryKeys.fleet() })
    },
  })

  const done = checks.filter((check) => check.ok).length
  const toGo = checks.filter((check) => !check.ok && check.required).length

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {/* Once trading, the same row the fleet page draws for this store; the
          Status tab has the whole page. While the store is getting ready the
          checklist is the subject. */}
      {store.status === "OPEN" && <FleetStoreStrip unitId={store.unit_id} />}

      <ExceptionsCard unitId={store.unit_id} />

      <Card className="p-4">
        <Facts className="md:grid-cols-3">
          <Fact term="Code">{store.code}</Fact>
          <Fact term="City">{store.city ?? "—"}</Fact>
          <Fact term="Timezone">{store.timezone ?? "—"}</Fact>
          <Fact term="PIC">{store.pic?.name ?? "Not appointed yet"}</Fact>
          <Fact term="Address">{address ?? "Not entered yet"}</Fact>
          <Fact term="POS seats">
            <TillSeatsValue
              unit={store.unit_id}
              seats={store.tills.seats}
              canManage={can_manage}
            />
          </Fact>
          <Fact term="One device per person">
            <OneDeviceValue
              unit={store.unit_id}
              on={store.tills.one_device}
              canManage={can_manage}
            />
          </Fact>
          {store.status === "OPEN" && (
            <Fact term="Open since">{day(store.opened_at)}</Fact>
          )}
        </Facts>
      </Card>

      {store.status === "OPEN" ? (
        <Banner tone="ok">
          {store.name} is open and trading
          {store.opened_at ? ` since ${day(store.opened_at)}` : ""}. 🎉
        </Banner>
      ) : (
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-hairline">
            <CardTitle>Ready to open</CardTitle>
            <span className="text-[0.9375rem] text-mute tabular-nums">
              {done} of {checks.length}
            </span>
          </CardHeader>
          <ul className="divide-y divide-hairline">
            {checks.map((check) => (
              <li key={check.key}>
                <CheckRow
                  check={check}
                  store={store}
                  onOpenTab={onOpenTab}
                />
              </li>
            ))}
          </ul>
          {/* Opening is an Admin's alone (`can_manage` — `screens/system/servers.tsx`
              doc, `lib/queries/stores.ts`); a store's own manager reads this
              checklist but the button is not theirs to press, and the server
              would refuse it either way. */}
          <div className="flex items-center gap-3 border-t border-hairline bg-soft px-4 py-3.5">
            <span className="flex-1 text-[0.9375rem] text-body">
              {can_open ? "Everything is ready." : `${toGo} to go`}
            </span>
            {can_manage && (
              <ConfirmButton
                label="Open store"
                variant="primary"
                disabled={!can_open}
                title={`Open ${store.name}?`}
                description="POS can sell from the moment it is open."
                confirmLabel="Open store"
                reason={{
                  label: "Note (optional)",
                  optional: true,
                }}
                onConfirm={(note) => open.mutateAsync(note)}
              />
            )}
          </div>
        </Card>
      )}
    </div>
  )
}

const ROW =
  "grid w-full grid-cols-[1.375rem_minmax(0,1fr)_auto_1rem] items-center gap-3 px-4 py-3 text-left"
const ROW_LINK = `${ROW} transition-colors hover:bg-soft`

/// What a line says under its title. The tills and the server are read off the
/// store itself, so they speak the same words as the list and the Server tab.
function detailOf(check: StoreCheck, store: StoreSummary): string {
  if (check.key === "tills" && store.tills.seats > 0)
    return `${store.tills.active} of ${store.tills.seats} seats joined at the store`
  if (check.key === "server") {
    const machine = serverExtras(store.server).machine
    return `${serverStateLabel(store.server.state)}${
      machine ? ` · ${machine.hostname}` : ""
    }`
  }
  return check.detail
}

function CheckRow({
  check,
  store,
  onOpenTab,
}: {
  check: StoreCheck
  store: StoreSummary
  onOpenTab: (tab: StoreTab) => void
}) {
  const rule = CHECKS[check.key]
  const detail = detailOf(check, store)

  const body = (
    <>
      <span
        className={cn(
          "grid size-5 shrink-0 place-items-center rounded-full border-[1.5px] transition-colors",
          check.ok
            ? "border-ok bg-ok text-cta-fg"
            : "border-hairline-strong"
        )}
      >
        {check.ok && <Check className="size-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <b className="block font-medium text-ink">
          {check.title}
          {!check.ok && !check.required && (
            <span className="ml-1.5 text-[0.9375rem] font-normal text-mute">
              optional
            </span>
          )}
        </b>
        {detail && (
          <span className="block text-[0.9375rem] text-body">{detail}</span>
        )}
      </span>
      {rule ? (
        <span className="rounded-[0.375rem] bg-soft-2 px-2 py-0.5 text-[0.9375rem] text-body">
          {rule.owner}
        </span>
      ) : (
        <span />
      )}
      {rule?.go === "server" || rule?.go === "tills" ? (
        <ChevronRight className="size-4 text-line-ico" />
      ) : rule?.go ? (
        <ArrowUpRight className="size-4 text-line-ico" />
      ) : (
        <span />
      )}
    </>
  )

  switch (rule?.go) {
    case "server":
      return (
        <button
          type="button"
          className={ROW_LINK}
          onClick={() => onOpenTab("server")}
        >
          {body}
        </button>
      )
    case "tills":
      return (
        <button
          type="button"
          className={ROW_LINK}
          onClick={() => onOpenTab("tills")}
        >
          {body}
        </button>
      )
    case "people":
      // The Employee List, narrowed to this store: the same `unit` clause the
      // list's own "Posted to" chip writes.
      return (
        <Link
          to={"/people" as LinkProps["to"]}
          search={
            {
              f: encodeFilters([
                {
                  column: "unit",
                  operator: "isAnyOf",
                  values: [store.unit_id],
                },
              ]),
            } as never
          }
          className={ROW_LINK}
        >
          {body}
        </Link>
      )
    case "payments":
      return (
        <AppLink to="/finance/setup/shop-payment-methods" className={ROW_LINK}>
          {body}
        </AppLink>
      )
    case "stock":
      return (
        <AppLink to="/allotment/new" className={ROW_LINK}>
          {body}
        </AppLink>
      )
    default:
      return <div className={ROW}>{body}</div>
  }
}
