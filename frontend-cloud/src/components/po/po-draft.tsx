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
import { Thumb } from "@/components/sourcing/columns"
import { toSourcingRow, type SourcingRow } from "@/components/sourcing/rows"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { money, units } from "@/lib/money"
import { useBasket, useBasketActions, useDestinations } from "@/lib/basket"
import { createCatalogPurchaseOrder } from "@/lib/purchase-orders"
import { searchSourcedItems } from "@/lib/sourcing"
import { cn } from "@/lib/utils"
import { ApiError } from "@itulah/contract/client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useParams } from "@tanstack/react-router"
import { Minus, Plus, Search, X } from "lucide-react"
import { useMemo, useRef, useState } from "react"

/// A purchase order in the making.
///
/// Two things this screen does NOT do, both on purpose:
///
/// - It does not send prices. `POST /api/v1/purchase-orders/catalog` snapshots
///   each line's price from the supplier item it names, so a buyer cannot order
///   at a number the catalogue does not hold. What is shown here is the
///   catalogue's price, which is what the server will use — not an input.
/// - It does not let the supplier change. One order goes to one supplier
///   (`CatalogPurchaseOrderRequest.supplier_id`), so switching supplier means a
///   different order, and the screen makes you go back and start it.
export function PoDraft() {
  const { supplierId } = useParams({ from: "/orders/new/$supplierId" })
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const basket = useBasket()

  /// This supplier's basket lines, as `supplier_item_id -> quantity`.
  ///
  /// Read from the basket rather than handed in by whoever opened the draft, so
  /// that following this link tomorrow shows the basket as it is tomorrow. The
  /// quantities come from the basket rather than being reset to one: deciding
  /// how many is part of picking, and asking again at the last step is how the
  /// two numbers end up disagreeing.
  const seedQuantities = useMemo(
    () =>
      Object.fromEntries(
        (basket.data ?? [])
          .filter((line) => line.item.supplier_id === supplierId)
          .map((line) => [line.item.supplier_item_id, line.quantity]),
      ),
    [basket.data, supplierId],
  )
  const catalogue = useQuery({
    queryKey: ["sourcing", "supplier", supplierId],
    queryFn: ({ signal }) => searchSourcedItems({ supplierIds: [supplierId], limit: 200 }, signal),
  })
  const destinations = useDestinations()
  const { remove: removeFromBasket } = useBasketActions()

  const rows = useMemo<SourcingRow[]>(
    () => (catalogue.data?.items ?? []).map(toSourcingRow),
    [catalogue.data],
  )
  const byId = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows])

  const [step, setStep] = useState<"lines" | "review">("lines")
  // Seeded once the basket has actually loaded, and keyed on that: a draft
  // opened from a cold cache would otherwise start empty and stay empty.
  const [quantities, setQuantities] = useState<Record<string, number> | null>(null)
  const [order, setOrder] = useState<string[] | null>(null)
  const lineQuantities = quantities ?? seedQuantities
  const lineOrder = order ?? Object.keys(seedQuantities)
  const [poNumber, setPoNumber] = useState(suggestPoNumber)
  const [destination, setDestination] = useState("")
  const [promisedDate, setPromisedDate] = useState("")
  const [notes, setNotes] = useState("")
  const [search, setSearch] = useState("")

  // One key per attempt at THIS order, held across retries: the server stores
  // it with a digest of the request and replays its first answer, so a retry
  // after a timeout cannot raise a second order. It is only rotated once an
  // order has actually been created.
  const idempotencyKey = useRef(crypto.randomUUID())

  const lines = lineOrder
    .map((id) => ({ row: byId.get(id), quantity: lineQuantities[id] ?? 0 }))
    .filter((line): line is { row: SourcingRow; quantity: number } => line.row !== undefined)

  const currencies = new Set(lines.map((line) => line.row.currency))
  const currency = currencies.size === 1 ? [...currencies][0] : null
  const totalMinor = lines.reduce((sum, line) => sum + line.row.price * line.quantity, 0)
  const totalUnits = lines.reduce((sum, line) => sum + line.quantity, 0)
  const supplierName = rows[0]?.supplier ?? supplierId

  const problems: string[] = []
  if (lines.length === 0) problems.push("An order needs at least one line.")
  if (lines.some((line) => line.quantity < 1))
    problems.push("Every line needs a quantity of at least one.")
  if (poNumber.trim() === "") problems.push("The order needs a PO number.")
  if (destination === "") problems.push("Choose where the delivery goes.")
  if (currency === null && lines.length > 0)
    problems.push(
      "These items are quoted in more than one currency. An order carries one currency, so they cannot go on the same one.",
    )

  const create = useMutation({
    mutationFn: () =>
      createCatalogPurchaseOrder(
        {
          po_number: poNumber.trim(),
          supplier_id: supplierId,
          destination_site_id: destination,
          notes: notes.trim() === "" ? null : notes.trim(),
          discount_minor: null,
          // The new optional fields — an agreed price, a corrected name — are
          // not offered by this screen yet, so they go null and the catalogue's
          // own values stand.
          lines: lines.map((line) => ({
            supplier_item_id: line.row.id,
            quantity: line.quantity,
            promised_date: promisedDate === "" ? null : promisedDate,
            unit_price_minor: null,
            article_name: null,
            image_url: null,
          })),
        },
        idempotencyKey.current,
      ),
    onSuccess: (receipt) => {
      idempotencyKey.current = crypto.randomUUID()
      void queryClient.invalidateQueries({ queryKey: ["purchase-orders"] })
      // What became an order is no longer picked out. Only the lines that
      // actually went on it are removed — a buyer who ordered six of the eight
      // things in their basket keeps the other two.
      for (const line of lines) {
        removeFromBasket.mutate(line.row.id)
      }
      void navigate({
        to: "/orders/$purchaseOrderId",
        params: { purchaseOrderId: receipt.purchase_order_id },
      })
    },
  })

  const addable = rows.filter(
    (row) =>
      !(row.id in lineQuantities) &&
      (search.trim() === "" ||
        row.name.toLowerCase().includes(search.trim().toLowerCase()) ||
        row.code.toLowerCase().includes(search.trim().toLowerCase())),
  )

  const setQuantity = (id: string, quantity: number) =>
    setQuantities({ ...lineQuantities, [id]: Math.max(1, quantity) })

  const addLine = (id: string) => {
    setQuantities({ ...lineQuantities, [id]: 1 })
    setOrder(lineOrder.includes(id) ? lineOrder : [...lineOrder, id])
  }

  const removeLine = (id: string) => {
    const next = { ...lineQuantities }
    delete next[id]
    setQuantities(next)
    setOrder(lineOrder.filter((value) => value !== id))
  }

  return (
    <AppShell nav={<Nav />}>
      <ScreenHeader
        title={step === "lines" ? "Draft purchase order" : "Review before raising"}
        subtitle={supplierName}
      >
        <div className="mr-2 flex items-center gap-1.5">
          {(["lines", "review"] as const).map((name, index) => (
            <span
              key={name}
              className={cn(
                "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium",
                step === name
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <span className="font-mono">{index + 1}</span>
              {name === "lines" ? "Lines" : "Review"}
            </span>
          ))}
        </div>
        <span className="text-muted-foreground font-mono text-[11px]">
          {units(lines.length)} line{lines.length === 1 ? "" : "s"} · {units(totalUnits)} units
        </span>
        <span className="font-mono text-xs font-medium tabular-nums">
          {currency === null ? "—" : money(totalMinor, currency)}
        </span>
        {/* Back where this draft was started from. A draft opened by naming a
            supplier on the orders screen has no basket behind it, and sending
            that buyer to an empty basket reads as though something was lost. */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            void navigate({
              to: Object.keys(seedQuantities).length > 0 ? "/basket" : "/orders",
            })
          }
        >
          <X className="size-3.5" />
          Discard
        </Button>
      </ScreenHeader>

      {catalogue.isError && (
        <div className="text-destructive border-b px-3.5 py-2 text-[11.5px]">
          {catalogue.error instanceof ApiError
            ? catalogue.error.message
            : "The supplier's catalogue could not be loaded."}
        </div>
      )}
      {create.isError && (
        <div className="text-destructive border-b px-3.5 py-2 text-[11.5px]">
          {create.error instanceof ApiError
            ? create.error.message
            : "The order could not be raised."}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="grid gap-3 border-b p-3.5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="po-number" className="text-xs">
              PO number
            </Label>
            <Input
              id="po-number"
              value={poNumber}
              onChange={(event) => setPoNumber(event.target.value)}
              className="h-8 font-mono text-xs"
            />
            {/* Not allocated by the server: the number is whatever is typed
                here, and two people typing the same one is a conflict the
                server will report rather than prevent. */}
            <p className="text-muted-foreground text-[10.5px]">Chosen here, not issued centrally.</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="po-destination" className="text-xs">
              Deliver to
            </Label>
            <select
              id="po-destination"
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              className="border-input bg-background h-8 rounded-md border px-2 text-xs"
            >
              <option value="">Choose a site…</option>
              {(destinations.data ?? []).map((site) => (
                <option key={site.site_id} value={site.site_id}>
                  {site.label} · {site.node_role}
                </option>
              ))}
            </select>
            {destinations.isError ? (
              // A refusal and an empty register are different problems with
              // different fixes, and telling a buyer "nothing is registered"
              // when the truth is "you may not see it" sends them to register
              // sites that already exist.
              <p className="text-destructive text-[10.5px]">
                {destinations.error instanceof ApiError
                  ? destinations.error.message
                  : "The delivery sites could not be loaded."}
              </p>
            ) : (
              destinations.data?.length === 0 && (
                <p className="text-[10.5px] text-amber-600">
                  No site is registered to receive deliveries yet.
                </p>
              )
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="po-promised" className="text-xs">
              Promised date
            </Label>
            <Input
              id="po-promised"
              type="date"
              value={promisedDate}
              onChange={(event) => setPromisedDate(event.target.value)}
              className="h-8 text-xs"
            />
            <p className="text-muted-foreground text-[10.5px]">Applied to every line.</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="po-notes" className="text-xs">
              Notes
            </Label>
            <Textarea
              id="po-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={2}
              className="min-h-8 text-xs"
            />
          </div>
        </div>

        {lines.length === 0 ? (
          <ScreenState>
            Nothing on this order yet. Add a line from the supplier's catalogue below.
          </ScreenState>
        ) : (
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="hover:bg-transparent">
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Unit</TableHead>
                <TableHead className="w-36 text-right">Quantity</TableHead>
                <TableHead className="text-right">Line total</TableHead>
                {step === "lines" && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => (
                <TableRow key={line.row.id}>
                  <TableCell>
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Thumb row={line.row} />
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium">{line.row.name}</div>
                        <div className="text-muted-foreground truncate font-mono text-[10.5px]">
                          {line.row.code}
                          {line.row.division !== "" && ` · ${line.row.division}`}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {money(line.row.price, line.row.currency)}
                  </TableCell>
                  <TableCell className="text-right">
                    {step === "lines" ? (
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="icon-xs"
                          variant="outline"
                          aria-label={`One fewer ${line.row.name}`}
                          onClick={() => setQuantity(line.row.id, line.quantity - 1)}
                        >
                          <Minus className="size-3" />
                        </Button>
                        <Input
                          value={line.quantity}
                          inputMode="numeric"
                          aria-label={`Quantity of ${line.row.name}`}
                          onChange={(event) => {
                            const parsed = Number.parseInt(event.target.value, 10)
                            setQuantity(line.row.id, Number.isFinite(parsed) ? parsed : 1)
                          }}
                          className="h-7 w-16 text-center font-mono text-xs"
                        />
                        <Button
                          size="icon-xs"
                          variant="outline"
                          aria-label={`One more ${line.row.name}`}
                          onClick={() => setQuantity(line.row.id, line.quantity + 1)}
                        >
                          <Plus className="size-3" />
                        </Button>
                      </div>
                    ) : (
                      <span className="font-mono text-xs tabular-nums">
                        {units(line.quantity)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs font-medium tabular-nums">
                    {money(line.row.price * line.quantity, line.row.currency)}
                  </TableCell>
                  {step === "lines" && (
                    <TableCell>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Remove ${line.row.name}`}
                        onClick={() => removeLine(line.row.id)}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {step === "lines" && (
          <section className="border-t">
            <div className="flex h-11 items-center gap-3 px-3.5">
              <span className="text-xs font-semibold">Add from {supplierName}</span>
              <label className="relative ml-auto">
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Item or code…"
                  aria-label="Search this supplier's catalogue"
                  className="h-7 w-52 pl-7 text-xs"
                />
              </label>
            </div>
            {catalogue.isPending ? (
              <p className="text-muted-foreground px-3.5 pb-4 text-xs">Loading the catalogue…</p>
            ) : addable.length === 0 ? (
              <p className="text-muted-foreground px-3.5 pb-4 text-xs">
                Everything this supplier offers is already on the order.
              </p>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(178px,1fr))] gap-2.5 px-3.5 pb-4">
                {addable.slice(0, 24).map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => addLine(row.id)}
                    className="hover:border-foreground/30 flex items-center gap-2 rounded-lg border p-2 text-left transition-colors"
                  >
                    <Thumb row={row} className="size-9" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{row.name}</span>
                      <span className="text-muted-foreground block truncate font-mono text-[10.5px]">
                        {money(row.price, row.currency)}
                      </span>
                    </span>
                    <Plus className="text-muted-foreground size-3.5 shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3 border-t px-3.5 py-2.5">
        {problems.length > 0 && (
          <span className="text-muted-foreground truncate text-[11.5px]">{problems[0]}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {step === "review" && (
            <Button variant="outline" size="sm" onClick={() => setStep("lines")}>
              Back to lines
            </Button>
          )}
          {step === "lines" ? (
            <Button size="sm" disabled={problems.length > 0} onClick={() => setStep("review")}>
              Review
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={problems.length > 0 || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? "Raising…" : "Raise order"}
            </Button>
          )}
        </div>
      </div>
    </AppShell>
  )
}

/// A first guess at the number, not an allocation.
///
/// Dated and random rather than sequential: this browser cannot know what the
/// last number was, and a counter that only one client can see would hand two
/// buyers the same number. The buyer is expected to overwrite it with whatever
/// their own numbering says.
function suggestPoNumber(): string {
  const now = new Date()
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("")
  const tail = crypto.randomUUID().slice(0, 4).toUpperCase()
  return `PO-${stamp}-${tail}`
}
