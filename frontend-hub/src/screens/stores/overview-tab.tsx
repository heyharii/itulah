import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Check } from "lucide-react"

import { Card } from "@/components/ui/card"
import { ConfirmButton } from "@/components/ui/dialog"
import { Fact, Facts } from "@/components/ui/sheet"
import { Banner } from "@/components/ui/states"
import { day } from "@/lib/format"
import {
  openStore,
  storesKeys,
  type StoreCheck,
  type StoreDetail as StoreDetailAnswer,
} from "@/lib/queries/stores"
import { cn } from "@/lib/utils"
import { ExceptionsCard } from "@/screens/stores/exceptions-shared"
import { FleetStoreStrip } from "@/screens/system/fleet-shared"
import { Section } from "@/screens/stores/shared"

/// Name, address, PIC, the checklist, and the one button this whole module
/// exists for — the mock's Overview tab.
export function OverviewTab({ detail }: { detail: StoreDetailAnswer }) {
  const client = useQueryClient()
  const { store, address, checks, can_open, can_manage } = detail

  const open = useMutation({
    mutationFn: (note: string) =>
      openStore(store.unit_id, { note: note.trim() === "" ? undefined : note }),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: storesKeys.detail(store.unit_id),
      })
      void client.invalidateQueries({ queryKey: storesKeys.list() })
    },
  })

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      {/* The same row the fleet page draws for this store
          (`screens/system/fleet-health.tsx`), one line — its server, its
          sync and its devices are the Server, Devices and Sync tabs; the
          full detail is System › Store servers. */}
      <FleetStoreStrip unitId={store.unit_id} />

      <ExceptionsCard unitId={store.unit_id} />

      <Card className="p-4">
        <Facts>
          <Fact term="Code">{store.code}</Fact>
          <Fact term="City">{store.city ?? "—"}</Fact>
          <Fact term="Timezone">{store.timezone ?? "—"}</Fact>
          <Fact term="PIC">{store.pic?.name ?? "Not appointed yet"}</Fact>
          <Fact term="Address">{address ?? "Not entered yet"}</Fact>
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
        <Card className="p-4">
          <Section title="Ready to open">
            <div className="flex flex-col gap-3">
              {checks.map((check) => (
                <CheckRow key={check.key} check={check} />
              ))}
            </div>
          </Section>
          {/* Opening is an Admin's alone (`can_manage` — `screens/system/servers.tsx`
              doc, `lib/queries/stores.ts`); a store's own manager reads this
              checklist but the button is not theirs to press, and the server
              would refuse it either way. */}
          {can_manage && (
            <div className="mt-4">
              <ConfirmButton
                label={<>Open store 🎉</>}
                variant="primary"
                disabled={!can_open}
                title={`Open ${store.name}?`}
                description="This turns the store on for trading — tills can start ringing up sales the moment it is open. There is no undo; closing a store again is a separate decision."
                confirmLabel="Open store"
                reason={{
                  label: "Note (optional)",
                  optional: true,
                  placeholder: "Anything worth recording",
                }}
                onConfirm={(note) => open.mutateAsync(note)}
              />
              {!can_open && (
                <p className="mt-2 text-meta text-mute">
                  Available once every check marked required above is green.
                </p>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

function CheckRow({ check }: { check: StoreCheck }) {
  return (
    <div className="flex items-start gap-2.5">
      <span
        className={cn(
          "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-[1.5px]",
          check.ok ? "border-ok bg-ok text-cta-fg" : "border-hairline-strong"
        )}
      >
        {check.ok && <Check className="size-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1">
        <b
          className={cn(
            "block text-[0.9375rem]",
            check.ok ? "font-medium text-mute" : "font-semibold text-ink"
          )}
        >
          {check.title}
          {!check.ok && !check.required && (
            <span className="ml-1.5 text-meta font-normal text-mute">
              optional
            </span>
          )}
        </b>
        {check.detail && (
          <span className="block text-meta text-body">{check.detail}</span>
        )}
      </span>
    </div>
  )
}
