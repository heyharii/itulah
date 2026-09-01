import { AppShell, ScreenBody, ScreenHeader, ScreenState } from "@/components/app-shell"
import { exhausted, fleetColumns, usageColumns } from "@/components/commercial/columns"
import { CommercialTable, useCommercialTable } from "@/components/commercial/data-table"
import { Nav } from "@/components/nav"
import { Button } from "@/components/ui/button"
import type { PromotionUsage, ShopActivation } from "@/lib/commercial"
import {
  commercialFleet,
  commercialUsage,
  fleetKey,
  publishUsageToFleet,
  usageKey,
} from "@/lib/commercial"
import { useIdentity } from "@/lib/identity"
import { units } from "@/lib/money"
import { cn } from "@/lib/utils"
import { ApiError } from "@itulah/contract/client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { AlertTriangle, Radio, Tag } from "lucide-react"
import { useMemo, useRef, useState } from "react"

/// Which shop is charging which price book, and what the promotions have cost.
///
/// The centre could publish prices and had no way to ask who was using them. A
/// shop whose sync had stalled looked exactly like one that was up to date, and
/// the difference between those two is whether somebody needs to drive out
/// there. The table behind this screen has recorded the answer since the
/// beginning; nothing read it until now.
///
/// Nobody ticks this list. A shop reports when it puts a book into service, in
/// the same transaction that puts it into service, so the two cannot disagree.
export function FleetView() {
  const fleet = useQuery({
    queryKey: fleetKey(),
    queryFn: ({ signal }) => commercialFleet(signal),
    // These arrive from shops on their own rhythm; a screen left open should
    // see one catch up without a reload.
    refetchInterval: 60_000,
  })
  const usage = useQuery({
    queryKey: usageKey(),
    queryFn: ({ signal }) => commercialUsage(signal),
    refetchInterval: 60_000,
  })

  const shops = useMemo(() => [...(fleet.data?.items ?? [])], [fleet.data])
  /// Furthest behind first, which is the whole question this screen answers.
  /// Shops that have never taken up a book sort above the rest — see the note
  /// on the column, which sorts them with `nullsLast`.
  const table = useCommercialTable({
    data: shops,
    columns: fleetColumns,
    getRowId: originId,
    sorting: [{ id: "behind_by", desc: true }],
  })
  const newest = fleet.data?.newest_published_version ?? null
  // Two different kinds of trouble, and worth counting apart: a shop that is
  // behind has an old price; a shop that has never activated has no price book
  // at all and is selling on whatever it last knew.
  const behind = shops.filter((shop) => (shop.behind_by ?? 0) > 0).length
  const never = shops.filter((shop) => !shop.has_ever_activated).length

  return (
    <AppShell data-cloudhub nav={<Nav />}>
      <ScreenHeader
        eyebrow="Commercial"
        title="Fleet"
        subtitle={
          fleet.isPending
            ? "loading…"
            : `${units(shops.length)} shop${shops.length === 1 ? "" : "s"}` +
              (newest === null ? "" : ` · newest book v${newest}`)
        }
      >
        <Button size="sm" variant="outline" nativeButton={false} render={<Link to="/commercial" />}>
          <Tag className="size-3.5" />
          Prices
        </Button>
      </ScreenHeader>

      {(behind > 0 || never > 0) && (
        <div className="flex items-start gap-2 border-b bg-[var(--os-warn-bg,#f8f1de)] px-3.5 py-2 text-[11.5px] text-[var(--os-warn,#b7791f)]">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {never > 0 && (
              <>
                {units(never)} shop{never === 1 ? " has" : "s have"} never put a price book
                into service — {never === 1 ? "it is" : "they are"} selling on whatever
                {never === 1 ? " it " : " they "}last knew.
              </>
            )}
            {never > 0 && behind > 0 && " "}
            {behind > 0 && (
              <>
                {units(behind)} {behind === 1 ? "is" : "are"} behind the newest published
                book.
              </>
            )}
          </span>
        </div>
      )}

      <ScreenBody>
        {fleet.isPending ? (
          <ScreenState>Asking the shops…</ScreenState>
        ) : fleet.isError ? (
          <ScreenState
            tone="problem"
            action={
              <Button size="sm" variant="outline" onClick={() => void fleet.refetch()}>
                Try again
              </Button>
            }
          >
            {fleet.error instanceof ApiError
              ? fleet.error.message
              : "The fleet could not be loaded."}
          </ScreenState>
        ) : shops.length === 0 ? (
          <ScreenState>
            No shop is registered. A price book published now would be queued for nobody.
          </ScreenState>
        ) : (
          <>
            <CommercialTable
              table={table}
              rowClassName={(row) =>
                cn(
                  // Two different kinds of trouble, and they do not read the
                  // same: never activated is a shop with no price book at all.
                  !row.original.has_ever_activated && "bg-destructive/5",
                  row.original.has_ever_activated &&
                    (row.original.behind_by ?? 0) > 0 &&
                    "bg-[var(--os-warn-bg,#f8f1de)]/40",
                )
              }
            />
            <UsagePanel rows={usage.data ?? []} loading={usage.isPending} />
          </>
        )}
      </ScreenBody>
    </AppShell>
  )
}

function originId(shop: ShopActivation): string {
  return shop.origin_id
}

/// A rule, a campaign and a coupon can share a key without meaning the same
/// thing, so the kind is part of the identity.
function usageId(row: PromotionUsage): string {
  return `${row.kind}:${row.key}`
}

/// What promotions have actually given away.
///
/// Under the fleet rather than beside it, because it answers the second half of
/// the same question: the table above says which offers a shop is holding, this
/// one says what they have cost. Both are observations arriving from the fleet,
/// not decisions made here.
function UsagePanel({
  rows,
  loading,
}: {
  rows: readonly PromotionUsage[]
  loading: boolean
}) {
  const queryClient = useQueryClient()
  const identity = useIdentity()
  const key = useRef(crypto.randomUUID())
  const [sent, setSent] = useState<number | null>(null)

  // Biggest spend first. A promotion that has given away the most is the one
  // somebody is here about; the alphabetical order the server returns is the
  // order the rules happened to be written in.
  const usage = useCommercialTable({
    data: useMemo(() => [...rows], [rows]),
    columns: usageColumns,
    getRowId: usageId,
    sorting: [{ id: "spent_minor", desc: true }],
  })

  const send = useMutation({
    mutationFn: () => publishUsageToFleet(identity.data?.username ?? "", key.current),
    onSuccess: (result) => {
      key.current = crypto.randomUUID()
      setSent(result.sent_to.length)
      void queryClient.invalidateQueries({ queryKey: usageKey() })
    },
  })

  return (
    <div className="border-t">
      <div className="flex items-center justify-between gap-3 px-3.5 py-2">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold">What promotions have cost</h2>
          <p className="text-muted-foreground text-[11px]">
            Counted from sales the centre has accepted. A shop enforces a budget from the
            last count it received, so what a till knows is always a little behind — the
            figure that must not be exceeded is this one.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={send.isPending}
          onClick={() => send.mutate()}
        >
          <Radio className="size-3.5" />
          {send.isPending ? "Sending…" : "Send counts to shops"}
        </Button>
      </div>

      {send.isError && (
        <p className="text-destructive px-3.5 pb-2 text-[11.5px]">
          {send.error instanceof ApiError
            ? send.error.message
            : "The counts could not be sent."}
        </p>
      )}
      {sent !== null && !send.isError && (
        <p className="px-3.5 pb-2 text-[11.5px] text-[var(--os-ok,#047857)]">
          Queued for {units(sent)} shop{sent === 1 ? "" : "s"}. Each applies it when it next
          syncs.
        </p>
      )}

      {loading ? (
        <p className="text-muted-foreground px-3.5 pb-3 text-[11.5px]">Counting…</p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground px-3.5 pb-3 text-[11.5px]">
          No promotion has been used yet. This fills in from sales as they arrive.
        </p>
      ) : (
        <CommercialTable
          table={usage}
          rowClassName={(row) =>
            exhausted(row.original) ? "bg-[var(--os-warn-bg,#f8f1de)]/40" : undefined
          }
        />
      )}
    </div>
  )
}
