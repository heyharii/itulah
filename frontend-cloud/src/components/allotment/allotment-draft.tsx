import { AppShell, ScreenHeader } from "@/components/app-shell"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { AllotmentType, CreateAllotmentLine } from "@/lib/allotments"
import {
  ALLOTMENT_TYPES,
  availability,
  createAllotment,
  fixedDestinationFor,
  humanise,
  sourcePoolsFor,
} from "@/lib/allotments"
import { useIdentity } from "@/lib/identity"
import { units } from "@/lib/money"
import { listPools, sitesOf } from "@/lib/pools"
import { cn } from "@/lib/utils"
import { ApiError } from "@itulah/contract/client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Search, X } from "lucide-react"
import { useMemo, useRef, useState } from "react"

/// Promise goods that have not moved yet.
///
/// The three kinds are not a dropdown of flavours: each one has its own legal
/// source pool and its own destination, and the server refuses every other
/// combination outright. So the kind is chosen first and everything below it
/// narrows — a person cannot compose an Allotment that is certain to be
/// refused, and when the screen and the server disagree anyway, the server's
/// own words are what gets shown.
export function AllotmentDraft() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const identity = useIdentity()

  const [type, setType] = useState<AllotmentType>("TO_STORE")
  const [sourcePoolId, setSourcePoolId] = useState("")
  const [destinationId, setDestinationId] = useState("")
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [notes, setNotes] = useState("")
  const [search, setSearch] = useState("")

  // One key per attempt at THIS allotment, held across retries and rotated only
  // once one has actually been raised: the server replays its first answer for
  // a repeated key, so a retry after a timeout cannot promise the goods twice.
  const idempotencyKey = useRef(crypto.randomUUID())

  const pools = useQuery({
    queryKey: ["inventory", "pools"],
    queryFn: ({ signal }) => listPools(signal),
    staleTime: 5 * 60_000,
  })

  const sources = useMemo(
    () => sourcePoolsFor(type, pools.data ?? []),
    [type, pools.data],
  )
  const stores = useMemo(() => sitesOf(pools.data ?? [], "STORE"), [pools.data])
  const fixed = fixedDestinationFor(type)
  const source = sources.find((pool) => pool.id === sourcePoolId)

  const stock = useQuery({
    queryKey: ["inventory", "availability", sourcePoolId],
    queryFn: ({ signal }) => availability(sourcePoolId, signal),
    enabled: sourcePoolId !== "",
  })

  const items = stock.data?.items ?? []
  const needle = search.trim().toLowerCase()
  const shown = items.filter(
    (item) =>
      needle === "" ||
      item.sku_code.toLowerCase().includes(needle) ||
      item.article_code.toLowerCase().includes(needle) ||
      item.article_name.toLowerCase().includes(needle),
  )

  const chosen = items.filter((item) => (quantities[item.sku_id] ?? 0) > 0)
  const pieces = chosen.reduce((sum, item) => sum + (quantities[item.sku_id] ?? 0), 0)
  // Promising more than a pool holds is allowed — the server records it and
  // reports the pool as short — but it is never accidental, so it is said out
  // loud before the allotment is raised rather than found on a list afterwards.
  const overreach = chosen.filter((item) => (quantities[item.sku_id] ?? 0) > item.on_hand_qty)

  const destination = fixed?.destination_id ?? destinationId
  const problems: string[] = []
  if (sourcePoolId === "") problems.push("Choose the pool the goods come out of.")
  if (destination === "") problems.push("Choose where the goods are going.")
  if (chosen.length === 0) problems.push("An allotment needs at least one line.")

  const create = useMutation({
    mutationFn: () => {
      if (source === undefined) {
        throw new Error("no source pool")
      }
      const lines: CreateAllotmentLine[] = chosen.map((item) => ({
        source_site_id: source.site_id,
        source_pool_id: source.id,
        destination_type: fixed?.destination_type ?? "STORE",
        destination_id: destination,
        sku_id: item.sku_id,
        quantity: quantities[item.sku_id] ?? 0,
      }))
      return createAllotment({
        type,
        lines,
        notes: notes.trim() === "" ? null : notes.trim(),
        actor_id: identity.data?.username ?? "",
        idempotency_key: idempotencyKey.current,
      })
    },
    onSuccess: (raised) => {
      idempotencyKey.current = crypto.randomUUID()
      void queryClient.invalidateQueries({ queryKey: ["allotments"] })
      // The pool's availability has just changed by exactly what was promised.
      void queryClient.invalidateQueries({ queryKey: ["inventory"] })
      void navigate({
        to: "/allotments/$allotmentId",
        params: { allotmentId: raised.id },
      })
    },
  })

  const setQuantity = (skuId: string, quantity: number) => {
    const next = { ...quantities }
    if (quantity <= 0) {
      delete next[skuId]
    } else {
      next[skuId] = quantity
    }
    setQuantities(next)
  }

  return (
    <AppShell nav={<Nav />}>
      <ScreenHeader
        title="New allotment"
        subtitle={source === undefined ? undefined : source.label}
      >
        <span className="text-muted-foreground font-mono text-[11px]">
          {units(chosen.length)} line{chosen.length === 1 ? "" : "s"} · {units(pieces)} pieces
        </span>
        <Button variant="ghost" size="sm" onClick={() => void navigate({ to: "/allotments" })}>
          <X className="size-3.5" />
          Discard
        </Button>
      </ScreenHeader>

      {pools.isError && (
        <div className="text-destructive border-b px-3.5 py-2 text-[11.5px]">
          {pools.error instanceof ApiError
            ? pools.error.message
            : "The pools could not be loaded."}
        </div>
      )}
      {create.isError && (
        <div className="text-destructive border-b px-3.5 py-2 text-[11.5px]">
          {create.error instanceof ApiError
            ? create.error.message
            : "The allotment could not be raised."}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="grid gap-3 border-b p-3.5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label className="text-xs">Kind</Label>
            <div className="flex flex-wrap gap-1.5">
              {ALLOTMENT_TYPES.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    // Every choice below depends on the kind, and none of them
                    // survives it changing: a source pool legal for one kind is
                    // refused for another.
                    setType(option)
                    setSourcePoolId("")
                    setDestinationId("")
                    setQuantities({})
                  }}
                  className={cn(
                    "h-8 rounded-full border px-3 text-[11.5px] transition-colors",
                    type === option
                      ? "bg-foreground text-background border-transparent font-medium"
                      : "text-muted-foreground hover:bg-muted/60",
                  )}
                >
                  {humanise(option)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="allotment-source" className="text-xs">
              Out of
            </Label>
            <select
              id="allotment-source"
              value={sourcePoolId}
              onChange={(event) => {
                setSourcePoolId(event.target.value)
                setQuantities({})
              }}
              className="border-input bg-background h-8 rounded-md border px-2 text-xs"
            >
              <option value="">Choose a pool…</option>
              {sources.map((pool) => (
                <option key={pool.id} value={pool.id}>
                  {pool.site_name} · {pool.label}
                </option>
              ))}
            </select>
            {pools.isSuccess && sources.length === 0 && (
              <p className="text-[10.5px] text-amber-600">
                No pool this kind of allotment may draw from exists yet.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="allotment-destination" className="text-xs">
              To
            </Label>
            {fixed === null ? (
              <select
                id="allotment-destination"
                value={destinationId}
                onChange={(event) => setDestinationId(event.target.value)}
                className="border-input bg-background h-8 rounded-md border px-2 text-xs"
              >
                <option value="">Choose a store…</option>
                {stores.map((site) => (
                  <option key={site.site_id} value={site.site_id}>
                    {site.site_name}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <div className="border-input bg-muted/40 text-muted-foreground flex h-8 items-center rounded-md border px-2 font-mono text-xs">
                  {fixed.destination_id}
                </div>
                {/* Not a disabled dropdown pretending to be a choice: this kind
                    of allotment has exactly one legal destination. */}
                <p className="text-muted-foreground text-[10.5px]">
                  The only destination this kind allows.
                </p>
              </>
            )}
          </div>

          <div className="flex flex-col gap-1.5 lg:col-span-2">
            <Label htmlFor="allotment-notes" className="text-xs">
              Notes
            </Label>
            <Textarea
              id="allotment-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={2}
              className="min-h-8 text-xs"
            />
          </div>

          {stock.data !== undefined && (
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] lg:col-span-2">
              {/* The server states this equation in the same response it sends
                  the numbers with; repeating it here is why On Hand is the
                  column that matters. */}
              <span className="italic">{stock.data.inventory_equation}</span>
              <span className="font-mono">Stock {units(stock.data.stock_qty)}</span>
              <span className="font-mono">Allotted {units(stock.data.allotted_qty)}</span>
              <span className="font-mono">On hand {units(stock.data.on_hand_qty)}</span>
            </div>
          )}
        </div>

        {sourcePoolId === "" ? (
          <p className="text-muted-foreground px-3.5 py-6 text-center text-xs">
            Choose a source pool to see what it can promise.
          </p>
        ) : stock.isPending ? (
          <p className="text-muted-foreground px-3.5 py-6 text-center text-xs">
            Reading what is in the pool…
          </p>
        ) : stock.isError ? (
          <p className="text-destructive px-3.5 py-6 text-center text-xs">
            {stock.error instanceof ApiError
              ? stock.error.message
              : "The pool's stock could not be read."}
          </p>
        ) : (
          <>
            <div className="flex h-11 items-center gap-3 border-b px-3.5">
              <span className="text-xs font-semibold">What is in {source?.label}</span>
              <label className="relative ml-auto">
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="SKU, code or name…"
                  aria-label="Search the pool"
                  className="h-7 w-52 pl-7 text-xs"
                />
              </label>
            </div>
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow className="hover:bg-transparent">
                  <TableHead>SKU</TableHead>
                  <TableHead>Article</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="text-right">Allotted</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                  <TableHead className="text-right">Allot</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.slice(0, 300).map((item) => {
                  const quantity = quantities[item.sku_id] ?? 0
                  const over = quantity > item.on_hand_qty
                  return (
                    <TableRow key={item.sku_id} className={cn(quantity > 0 && "bg-muted/30")}>
                      <TableCell className="font-mono text-[11px]">{item.sku_code}</TableCell>
                      <TableCell>
                        <div className="min-w-0">
                          <div className="truncate text-[13px]">{item.article_name}</div>
                          <div className="text-muted-foreground truncate font-mono text-[10.5px]">
                            {item.article_code}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right font-mono text-xs tabular-nums">
                        {units(item.stock_qty)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right font-mono text-xs tabular-nums">
                        {units(item.allotted_qty)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-mono text-xs tabular-nums",
                          item.on_hand_qty <= 0 && "text-amber-600",
                        )}
                      >
                        {units(item.on_hand_qty)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min={0}
                          value={quantity === 0 ? "" : String(quantity)}
                          onChange={(event) =>
                            setQuantity(item.sku_id, Math.floor(Number(event.target.value) || 0))
                          }
                          aria-label={`Quantity to allot of ${item.sku_code}`}
                          className={cn(
                            "ml-auto h-7 w-24 text-right font-mono text-xs",
                            over && "border-amber-500",
                          )}
                        />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            {shown.length > 300 && (
              <p className="text-muted-foreground px-3.5 py-3 text-center text-[11px]">
                {units(shown.length - 300)} more SKUs — narrow the search to reach them.
              </p>
            )}
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3 border-t px-3.5 py-2.5">
        {problems.length > 0 ? (
          <span className="text-muted-foreground truncate text-[11.5px]">{problems[0]}</span>
        ) : (
          overreach.length > 0 && (
            <span className="truncate text-[11.5px] text-amber-600">
              {overreach.length} line{overreach.length === 1 ? "" : "s"} promise more than the
              pool holds. The allotment will stand, and the pool will read short.
            </span>
          )
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            disabled={problems.length > 0 || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? "Allotting…" : "Raise allotment"}
          </Button>
        </div>
      </div>
    </AppShell>
  )
}
