import { AppShell, ScreenHeader, ScreenState } from "@/components/app-shell"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/custom/table"
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
import { money, units } from "@/lib/money"
import { cn } from "@/lib/utils"
import { ApiError } from "@itulah/contract/client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { AlertTriangle, Radio, Tag } from "lucide-react"
import { useRef, useState } from "react"

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

  const shops = fleet.data?.items ?? []
  const newest = fleet.data?.newest_published_version ?? null
  // Two different kinds of trouble, and worth counting apart: a shop that is
  // behind has an old price; a shop that has never activated has no price book
  // at all and is selling on whatever it last knew.
  const behind = shops.filter((shop) => (shop.behind_by ?? 0) > 0).length
  const never = shops.filter((shop) => !shop.has_ever_activated).length

  return (
    <AppShell nav={<Nav />}>
      <ScreenHeader
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
        <div className="flex items-start gap-2 border-b bg-amber-50 px-3.5 py-2 text-[11.5px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
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

      <div className="min-h-0 flex-1 overflow-auto">
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
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow className="hover:bg-transparent">
                  <TableHead>Shop</TableHead>
                  <TableHead>Charging from</TableHead>
                  <TableHead className="text-right">Behind</TableHead>
                  <TableHead className="text-right">Prices received</TableHead>
                  <TableHead>Since</TableHead>
                  <TableHead>Centre heard</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shops.map((shop) => (
                  <ShopRow key={shop.origin_id} shop={shop} />
                ))}
              </TableBody>
            </Table>
            <UsagePanel rows={usage.data ?? []} loading={usage.isPending} />
          </>
        )}
      </div>
    </AppShell>
  )
}

function ShopRow({ shop }: { shop: ShopActivation }) {
  const behind = shop.behind_by ?? 0
  return (
    <TableRow
      className={cn(
        !shop.has_ever_activated && "bg-destructive/5",
        shop.has_ever_activated && behind > 0 && "bg-amber-50/40 dark:bg-amber-950/10",
      )}
    >
      <TableCell>
        <div className="flex flex-col">
          <span className="text-xs">{shop.label ?? shop.origin_id}</span>
          <span className="text-muted-foreground font-mono text-[10.5px]">
            {shop.site_id ?? shop.origin_id}
          </span>
        </div>
      </TableCell>
      <TableCell>
        {shop.version === null ? (
          <span className="text-destructive text-xs">nothing, ever</span>
        ) : (
          <div className="flex flex-col">
            <span className="font-mono text-xs">v{shop.version}</span>
            {shop.book_name !== null && (
              <span className="text-muted-foreground max-w-48 truncate text-[10.5px]">
                {shop.book_name}
              </span>
            )}
          </div>
        )}
      </TableCell>
      <TableCell className="text-right">
        {shop.behind_by === null ? (
          <span className="text-muted-foreground text-[11px]">—</span>
        ) : behind === 0 ? (
          <span className="text-[11px] text-emerald-600">up to date</span>
        ) : (
          <span className="font-mono text-xs tabular-nums text-amber-700 dark:text-amber-500">
            {units(behind)} book{behind === 1 ? "" : "s"}
          </span>
        )}
      </TableCell>
      <TableCell className="text-right font-mono text-xs tabular-nums">
        {shop.price_rule_count === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          units(shop.price_rule_count)
        )}
      </TableCell>
      <TableCell className="text-muted-foreground font-mono text-[10.5px] whitespace-nowrap">
        {shop.activated_at === null
          ? "—"
          : new Date(shop.activated_at).toLocaleString("id-ID")}
      </TableCell>
      <TableCell className="text-muted-foreground font-mono text-[10.5px] whitespace-nowrap">
        {shop.reported_at === null
          ? "—"
          : new Date(shop.reported_at).toLocaleString("id-ID")}
      </TableCell>
    </TableRow>
  )
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
        <p className="px-3.5 pb-2 text-[11.5px] text-emerald-700 dark:text-emerald-400">
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
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow className="hover:bg-transparent">
              <TableHead>Promotion</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead className="text-right">Used</TableHead>
              <TableHead className="text-right">Given away</TableHead>
              <TableHead className="text-right">Shoppers</TableHead>
              <TableHead>Last used</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <UsageRow key={`${row.kind}:${row.key}`} row={row} />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

function UsageRow({ row }: { row: PromotionUsage }) {
  // An unlimited budget is not a full bar and not an empty one — there is no
  // bar. Drawing one would invent a ceiling nobody set.
  const capped = row.budget_minor !== null && row.budget_minor > 0
  const share = capped ? Math.min(1, row.spent_minor / (row.budget_minor ?? 1)) : null
  const spentOut = capped && row.spent_minor >= (row.budget_minor ?? 0)
  const usedUp = row.max_uses !== null && row.uses >= row.max_uses
  return (
    <TableRow className={cn((spentOut || usedUp) && "bg-amber-50/40 dark:bg-amber-950/10")}>
      <TableCell>
        <div className="flex flex-col">
          <span className="text-xs">{row.name ?? row.key}</span>
          <span className="text-muted-foreground font-mono text-[10.5px]">{row.key}</span>
        </div>
      </TableCell>
      <TableCell>
        <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10.5px]">
          {row.kind === "RULE" ? "Rule" : row.kind === "CAMPAIGN" ? "Campaign" : "Coupon"}
        </span>
      </TableCell>
      <TableCell className="text-right font-mono text-xs tabular-nums">
        {units(row.uses)}
        {row.max_uses !== null && (
          <span className={cn("text-muted-foreground", usedUp && "text-amber-700")}>
            {" / "}
            {units(row.max_uses)}
          </span>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex flex-col items-end gap-1">
          <span
            className={cn(
              "font-mono text-xs tabular-nums",
              spentOut && "font-medium text-amber-700 dark:text-amber-500",
            )}
          >
            {money(row.spent_minor)}
            {capped && (
              <span className="text-muted-foreground">
                {" / "}
                {money(row.budget_minor ?? 0)}
              </span>
            )}
          </span>
          {share !== null && (
            <div className="bg-muted h-1 w-20 overflow-hidden rounded-full">
              <div
                className={cn("h-full", spentOut ? "bg-amber-600" : "bg-emerald-500")}
                style={{ width: `${share * 100}%` }}
              />
            </div>
          )}
        </div>
      </TableCell>
      <TableCell className="text-right font-mono text-xs tabular-nums">
        {units(row.customer_count)}
      </TableCell>
      <TableCell className="text-muted-foreground font-mono text-[10.5px] whitespace-nowrap">
        {new Date(row.last_used_at).toLocaleString("id-ID")}
      </TableCell>
    </TableRow>
  )
}
