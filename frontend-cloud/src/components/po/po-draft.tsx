import { AppShell, ScreenBody, ScreenHeader, ScreenState } from "@/components/app-shell"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/custom/table"
import { Nav } from "@/components/nav"
import { Tag, Thumb } from "@/components/sourcing/columns"
import { useVocabulary } from "@/lib/vocabulary"
import { UNCLASSIFIED, toSourcingRow, type SourcingRow } from "@/components/sourcing/rows"
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
import { useForm, useStore } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useParams } from "@tanstack/react-router"
import { Check, Minus, Pencil, Plus, Search, X } from "lucide-react"
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
/// The draft itself, without a screen around it.
///
/// Split out so the same draft is a route and a sheet. Raising an order is
/// something a buyer does while still looking at the range — sending them to
/// another route to do it throws away the scroll position and the filters that
/// got them there — so the sheet is the ordinary way in, and the route remains
/// for a link somebody bookmarked or shared.
export function PoDraftPanel({
  supplierId,
  onLeave,
}: {
  supplierId: string
  /// Where "Discard" goes. A sheet closes; a route navigates.
  onLeave: () => void
}) {
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
  const { remove: removeFromBasket } = useBasketActions()

  /// Where the lorry is going.
  ///
  /// Asked rather than assumed. The server does fall back to a configured
  /// default site when the order names none, but that default is one string in
  /// one node's environment: the moment a second warehouse is registered — or
  /// the first one is registered under a name the default does not spell — an
  /// order raised here is refused with "no registered DC owns site 'dc'", which
  /// is a sentence about deployment configuration shown to a buyer who was
  /// buying tights. The list is the same one the server validates against, so
  /// what is offered here is exactly what it will accept.
  const destinations = useDestinations()

  const rows = useMemo<SourcingRow[]>(
    () => (catalogue.data?.items ?? []).map(toSourcingRow),
    [catalogue.data],
  )
  const byId = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows])

  /// Which of the two steps is showing, and which line is open for editing.
  /// Neither is sent anywhere: they are where the buyer is standing, not what
  /// they have decided. One line edits at a time — a table where every row is a
  /// form is a table nobody can read.
  const [step, setStep] = useState<"lines" | "review">("lines")
  const [editing, setEditing] = useState<string | null>(null)
  /// Searching the supplier's catalogue for something to add. It narrows what
  /// is offered below and goes nowhere near the order.
  const [search, setSearch] = useState("")
  const vocabulary = useVocabulary()

  /// Suggested once, and never again.
  ///
  /// The form takes its defaults on every render and adopts them while nothing
  /// has been typed yet, so a number minted per render would rewrite itself
  /// under the buyer's eyes between one keystroke elsewhere and the next.
  const suggested = useMemo(() => suggestPoNumber(), [])

  /// The order being written, all of it in one place.
  ///
  /// Everything here is typed and then sent. The four record fields hold only
  /// what a buyer actually moved: an absent key means the catalogue's own
  /// figure, wording, division or tags stand, so an untouched line sends
  /// nothing and the server takes its own values rather than ones the browser
  /// echoed back at it.
  const form = useForm({
    defaultValues: {
      poNumber: suggested,
      /// Empty until the buyer picks, and read as "the first warehouse on the
      /// list" until then — see `destination` below.
      destination: "",
      promisedDate: "",
      notes: "",
      /// One discount on the order, in whole rupiah. Not per line: it is
      /// negotiated once and a supplier invoices it once.
      discount: "",
      /// Null until the buyer touches a quantity, and read through the basket
      /// until then: a draft opened from a cold cache would otherwise start
      /// empty and stay empty.
      quantities: null as Record<string, number> | null,
      order: null as string[] | null,
      agreedPrices: {} as Record<string, number>,
      agreedNames: {} as Record<string, string>,
      agreedDivisions: {} as Record<string, string>,
      agreedTags: {} as Record<string, string[]>,
    },
    onSubmit: () => {
      create.mutate()
    },
  })
  const values = useStore(form.store, (state) => state.values)
  const {
    poNumber,
    promisedDate,
    notes,
    discount,
    agreedPrices,
    agreedNames,
    agreedDivisions,
    agreedTags,
  } = values
  const lineQuantities = values.quantities ?? seedQuantities
  const lineOrder = values.order ?? Object.keys(seedQuantities)

  /// The site this order is bound for.
  ///
  /// Falls back to the first entry rather than to nothing: `purchase_destinations`
  /// sorts warehouses before shops, so a company with one DC never has to make
  /// this choice, and a company with several finds it already made in the
  /// likeliest way. The chosen value is re-checked against the list on every
  /// render, so a site that disappears while the sheet is open cannot be sent.
  const destinationOptions = destinations.data ?? []
  const destination =
    destinationOptions.find((option) => option.site_id === values.destination)?.site_id ??
    destinationOptions[0]?.site_id ??
    ""

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
  const priceOf = (row: SourcingRow) => agreedPrices[row.id] ?? row.price
  const nameOf = (row: SourcingRow) => agreedNames[row.id] ?? row.name
  const divisionOf = (row: SourcingRow) => agreedDivisions[row.id] ?? row.division
  const tagsOf = (row: SourcingRow) => agreedTags[row.id] ?? row.tags
  const grossMinor = lines.reduce((sum, line) => sum + priceOf(line.row) * line.quantity, 0)
  const discountMinor = discount.trim() === "" ? 0 : Math.max(0, Number(discount) || 0)
  const totalMinor = grossMinor - discountMinor
  const totalUnits = lines.reduce((sum, line) => sum + line.quantity, 0)
  const supplierName = rows[0]?.supplier ?? supplierId

  const problems: string[] = []
  if (lines.length === 0) problems.push("An order needs at least one line.")
  if (lines.some((line) => line.quantity < 1))
    problems.push("Every line needs a quantity of at least one.")
  if (poNumber.trim() === "") problems.push("The order needs a PO number.")
  if (destinations.isSuccess && destinationOptions.length === 0)
    problems.push(
      "No warehouse or shop is registered to take a delivery, so this order has nowhere to go. Register the receiving node before ordering to it.",
    )
  if (discountMinor > grossMinor)
    problems.push(
      "The discount is more than the order is worth. A reduction larger than the order is a credit, which this is not.",
    )
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
          // Named rather than left to the server's default: the fallback is a
          // configured string, and an order that relies on it is refused the
          // moment the site is registered under any other name.
          destination_site_id: destination === "" ? null : destination,
          notes: notes.trim() === "" ? null : notes.trim(),
          discount_minor: discountMinor === 0 ? null : discountMinor,
          // The new optional fields — an agreed price, a corrected name — are
          // not offered by this screen yet, so they go null and the catalogue's
          // own values stand.
          lines: lines.map((line) => ({
            supplier_item_id: line.row.id,
            quantity: line.quantity,
            promised_date: promisedDate === "" ? null : promisedDate,
            // Only when the buyer actually moved it. Sending the catalogue's
            // own price back would record every line as a negotiated one and
            // make the snapshot beside it meaningless.
            unit_price_minor: agreedPrices[line.row.id] ?? null,
            article_name: agreedNames[line.row.id] ?? null,
            image_url: null,
            division_code: agreedDivisions[line.row.id] ?? null,
            tags: agreedTags[line.row.id] ?? null,
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
    form.setFieldValue("quantities", { ...lineQuantities, [id]: Math.max(1, quantity) })

  const addLine = (id: string) => {
    form.setFieldValue("quantities", { ...lineQuantities, [id]: 1 })
    form.setFieldValue("order", lineOrder.includes(id) ? lineOrder : [...lineOrder, id])
  }

  const removeLine = (id: string) => {
    const next = { ...lineQuantities }
    delete next[id]
    form.setFieldValue("quantities", next)
    form.setFieldValue(
      "order",
      lineOrder.filter((value) => value !== id),
    )
  }

  return (
    <>
      <ScreenHeader
        eyebrow="Purchase orders"
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
        {/* Gross struck through beside the net, so a discount is visible in
            the header rather than only in the arithmetic. A total that quietly
            shrank is a total nobody trusts. */}
        <span className="flex items-baseline gap-1.5 font-mono text-xs tabular-nums">
          {discountMinor > 0 && currency !== null && (
            <span className="text-muted-foreground text-[10.5px] line-through">
              {money(grossMinor, currency)}
            </span>
          )}
          <span className="font-medium">
            {currency === null ? "—" : money(totalMinor, currency)}
          </span>
        </span>
        {/* Back where this draft was started from. A draft opened by naming a
            supplier on the orders screen has no basket behind it, and sending
            that buyer to an empty basket reads as though something was lost. */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onLeave}
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

      <ScreenBody>
        <div className="grid gap-3 border-b border-[var(--os-hairline,#eeeef1)] p-3.5 sm:grid-cols-2 lg:grid-cols-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="po-number" className="text-xs">
              PO number
            </Label>
            <form.Field name="poNumber">
              {(field) => (
                <Input
                  id="po-number"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  className="h-8 font-mono text-xs"
                />
              )}
            </form.Field>
            {/* Not allocated by the server: the number is whatever is typed
                here, and two people typing the same one is a conflict the
                server will report rather than prevent. */}
            <p className="text-muted-foreground text-[10.5px]">Chosen here, not issued centrally.</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="po-destination" className="text-xs">
              Deliver to
            </Label>
            <form.Field name="destination">
              {(field) => (
                <select
                  id="po-destination"
                  value={destination}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  disabled={destinationOptions.length === 0}
                  className="border-input bg-background h-8 rounded-md border px-2 text-xs disabled:opacity-60"
                >
                  {destinationOptions.length === 0 && (
                    <option value="">
                      {destinations.isPending ? "Reading the fleet…" : "Nowhere registered"}
                    </option>
                  )}
                  {destinationOptions.map((option) => (
                    <option key={option.site_id} value={option.site_id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )}
            </form.Field>
            {/* The site, not the label, is what the order carries — a node
                registered as `dc-01` can be standing in a warehouse everybody
                calls Jakarta, and the order has to name the first. */}
            <p className="text-muted-foreground font-mono text-[10.5px]">
              {destination === "" ? "—" : destination}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="po-promised" className="text-xs">
              Promised date
            </Label>
            <form.Field name="promisedDate">
              {(field) => (
                <Input
                  id="po-promised"
                  type="date"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  className="h-8 text-xs"
                />
              )}
            </form.Field>
            <p className="text-muted-foreground text-[10.5px]">Applied to every line.</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="po-discount" className="text-xs">
              Discount
            </Label>
            <form.Field name="discount">
              {(field) => (
                <Input
                  id="po-discount"
                  value={field.state.value}
                  inputMode="numeric"
                  placeholder="0"
                  onBlur={field.handleBlur}
                  onChange={(event) =>
                    field.handleChange(event.target.value.replace(/[^0-9]/g, ""))
                  }
                  className="h-8 font-mono text-xs"
                />
              )}
            </form.Field>
            {/* On the order, not the lines. Splitting it across them would
                invent per-line figures nobody agreed to and would not add back
                up, so the invoice would fail to reconcile on rounding we
                created ourselves. */}
            <p className="text-muted-foreground text-[10.5px]">
              Taken off the whole order, the way it is agreed and invoiced.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="po-notes" className="text-xs">
              Notes
            </Label>
            <form.Field name="notes">
              {(field) => (
                <Textarea
                  id="po-notes"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  rows={2}
                  className="min-h-8 text-xs"
                />
              )}
            </form.Field>
          </div>
        </div>

        {lines.length === 0 ? (
          <ScreenState>
            Nothing on this order yet. Add a line from the supplier's catalogue below.
          </ScreenState>
        ) : (
          // Fixed layout. Without it every column renegotiates its width the
          // moment one cell's content grows, so typing a fourth digit into a
          // quantity shifted the table and the header above it sideways
          // mid-keystroke.
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Unit</TableHead>
                <TableHead className="w-40 text-right">Quantity</TableHead>
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
                      <div className="min-w-0 flex-1">
                        {editing === line.row.id ? (
                          <div className="flex flex-col gap-1">
                            <Input
                              value={nameOf(line.row)}
                              aria-label={`Description for ${line.row.name}`}
                              autoFocus
                              onChange={(event) => {
                                const value = event.target.value
                                form.setFieldValue("agreedNames", (current) => {
                                  const next = { ...current }
                                  // Back to the catalogue's own wording rather
                                  // than a copy of it, so an untouched line
                                  // stays untouched on the wire.
                                  if (value.trim() === "" || value === line.row.name) {
                                    delete next[line.row.id]
                                  } else {
                                    next[line.row.id] = value
                                  }
                                  return next
                                })
                              }}
                              className="h-7 text-[13px]"
                            />
                            <select
                              value={divisionOf(line.row)}
                              aria-label={`Division for ${line.row.name}`}
                              onChange={(event) => {
                                const value = event.target.value
                                form.setFieldValue("agreedDivisions", (current) => {
                                  const next = { ...current }
                                  if (value === line.row.division) delete next[line.row.id]
                                  else next[line.row.id] = value
                                  return next
                                })
                              }}
                              className="border-input bg-background h-7 rounded-md border px-2 text-[11.5px]"
                            >
                              {/* The row's own value when the active list
                                  does not hold it — unclassified, or a
                                  retired division. Without it a native select
                                  shows the FIRST division (Wanita) for a row
                                  that has none, and picking Wanita then fires
                                  no change: a default nobody chose, and a
                                  choice nobody can make. */}
                              {!vocabulary.divisionOrder.includes(line.row.division) && (
                                <option value={line.row.division}>
                                  {line.row.division === UNCLASSIFIED
                                    ? "Choose a division…"
                                    : `${vocabulary.division(line.row.division)} · Retired`}
                                </option>
                              )}
                              {vocabulary.divisionOrder.map((code) => (
                                <option key={code} value={code}>
                                  {vocabulary.division(code)}
                                </option>
                              ))}
                            </select>
                            {/* Every tag in the vocabulary, the line's own
                                lit. Chips rather than a multi-select: a buyer
                                is recognising words here, not recalling them. */}
                            <div className="flex flex-wrap gap-1">
                              {vocabulary.tagCodes.map((code) => {
                                const on = tagsOf(line.row).includes(code)
                                return (
                                  <button
                                    key={code}
                                    type="button"
                                    aria-pressed={on}
                                    onClick={() =>
                                      form.setFieldValue("agreedTags", (current) => {
                                        const held = current[line.row.id] ?? line.row.tags
                                        const next = on
                                          ? held.filter((value) => value !== code)
                                          : [...held, code]
                                        return { ...current, [line.row.id]: next }
                                      })
                                    }
                                    className={cn(
                                      "inline-flex h-5 items-center rounded-md px-1.5 text-[10.5px] font-medium transition-colors",
                                      on
                                        ? "bg-foreground text-background"
                                        : "bg-muted text-muted-foreground hover:text-foreground",
                                    )}
                                  >
                                    {vocabulary.tag(code)}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="truncate text-[13px] font-medium">
                              {nameOf(line.row)}
                            </div>
                            <div className="flex flex-wrap items-center gap-1 pt-0.5">
                              {divisionOf(line.row) !== UNCLASSIFIED && (
                                <span className="bg-foreground/85 text-background inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-[11px] font-medium">
                                  {vocabulary.division(divisionOf(line.row))}
                                </span>
                              )}
                              {tagsOf(line.row).slice(0, 3).map((tag) => (
                                <Tag key={tag}>{vocabulary.tag(tag)}</Tag>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                      {step === "lines" && (
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={
                            editing === line.row.id
                              ? `Done editing ${line.row.name}`
                              : `Edit ${line.row.name}`
                          }
                          onClick={() =>
                            setEditing(editing === line.row.id ? null : line.row.id)
                          }
                        >
                          {editing === line.row.id ? (
                            <Check className="size-3.5" />
                          ) : (
                            <Pencil className="size-3.5" />
                          )}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {step === "lines" ? (
                      <div className="flex flex-col items-end gap-0.5">
                        <Input
                          value={String(priceOf(line.row))}
                          inputMode="numeric"
                          aria-label={`Agreed unit price for ${line.row.name}`}
                          onChange={(event) => {
                            const parsed = Number.parseInt(
                              event.target.value.replace(/[^0-9]/g, ""),
                              10,
                            )
                            form.setFieldValue("agreedPrices", (current) => {
                              const next = { ...current }
                              // Back to the catalogue's own figure rather than
                              // a copy of it, so an untouched line stays
                              // untouched on the wire.
                              if (!Number.isFinite(parsed) || parsed === line.row.price) {
                                delete next[line.row.id]
                              } else {
                                next[line.row.id] = Math.max(0, parsed)
                              }
                              return next
                            })
                          }}
                          className="h-7 w-24 text-right font-mono text-xs"
                        />
                        {/* Said out loud, because a price that quietly differs
                            from the catalogue is how a buyer discovers on the
                            invoice that they typed a digit wrong. */}
                        {agreedPrices[line.row.id] !== undefined && (
                          <span className="text-muted-foreground text-[10px] whitespace-nowrap">
                            catalogue {money(line.row.price, line.row.currency)}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col items-end">
                        <span className="font-mono text-xs tabular-nums">
                          {money(priceOf(line.row), line.row.currency)}
                        </span>
                        {agreedPrices[line.row.id] !== undefined && (
                          <span className="text-muted-foreground text-[10px] whitespace-nowrap line-through">
                            {money(line.row.price, line.row.currency)}
                          </span>
                        )}
                      </div>
                    )}
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
                          // Fixed width and tabular figures: the column used
                          // to grow as digits were typed, which shoved the
                          // table and everything above it sideways while
                          // somebody was still typing.
                          className="h-7 w-20 shrink-0 text-center font-mono text-xs tabular-nums"
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
                    {money(priceOf(line.row) * line.quantity, line.row.currency)}
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
              {/* Shown, not chosen. One order goes to exactly one supplier,
                  so this is a fact about the draft rather than a decision left
                  open — but leaving it out entirely makes a buyer wonder whose
                  catalogue they are looking at. */}
              <Label htmlFor="po-supplier" className="text-xs">
                Supplier
              </Label>
              <Input
                id="po-supplier"
                value={supplierName}
                disabled
                readOnly
                className="h-7 w-64 text-xs"
              />
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
      </ScreenBody>

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
              onClick={() => void form.handleSubmit()}
            >
              {create.isPending ? "Raising…" : "Raise order"}
            </Button>
          )}
        </div>
      </div>
    </>
  )
}

/// The draft as its own screen, for a bookmarked or shared link.
export function PoDraft() {
  const { supplierId } = useParams({ from: "/orders/new/$supplierId" })
  const navigate = useNavigate()
  return (
    <AppShell data-cloudhub nav={<Nav />}>
      <PoDraftPanel supplierId={supplierId} onLeave={() => void navigate({ to: "/orders" })} />
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
