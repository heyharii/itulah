import { Combobox } from "@base-ui/react/combobox"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Search, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input, Textarea } from "@/components/ui/field"
import { PickMany, PickOne, type Choice } from "@/components/ui/pick"
import { MiniTable, TotalsLadder } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { ITEM, POPUP } from "@/lib/filter-chrome"
import { money } from "@/lib/format"
import {
  catalogueVocabulary,
  createCatalogPurchaseOrder,
  listSuppliers,
  procurementKeys,
  purchaseDestinations,
  searchSupplierItems,
  type CatalogPurchaseOrderReceipt,
} from "@/lib/queries/procurement"
import { cn } from "@/lib/utils"
import { useIdempotencyKey } from "@/screens/procurement/shared"
import type { BasketLine, SourcedItem } from "@itulah/contract"

/// Raising a purchase order, from a basket or from nothing.
///
/// **A PO line is a snapshot, not a pointer.** What the supplier's catalogue
/// calls something is what THEY call it; what goes on our order is what we are
/// buying, and the two are allowed to differ. That catalogue is scraped, often
/// unclassified and frequently wrong about the name — and raising the order is
/// the only moment anybody has the quote and the goods in mind at once. So the
/// name, the tags, the division and the price are editable per line here, and
/// each travels to goods receipt and becomes the article's own.
///
/// None of it edits the supplier item. One order's wording is not a catalogue
/// edit, which is exactly why `CatalogPurchaseLineRequest` carries these fields
/// rather than asking this screen to PATCH the item first.
///
/// **Two ways in, one screen.** A buyer who walked the catalogue arrives from
/// the basket with the goods already chosen. A buyer who already knows what
/// they want — a repeat order, a phone call from a supplier — should not have
/// to go shopping to place it, so Purchase orders opens the same composer with
/// no lines and a box to add them. They are one component because they are one
/// document: two would drift the week somebody adds a field to a PO line.

/// One supplier's worth of basket, as `basket.tsx` groups it.
export interface Group {
  readonly supplierId: string
  readonly supplierName: string
  readonly lines: readonly BasketLine[]
  readonly pieces: number
  readonly value: number
}

/// One line as it will be ordered, beside what the catalogue says it is.
///
/// Both, because "absent means the catalogue's" is how the wire says "no
/// change" — so the composer has to be able to tell a value somebody typed
/// from the identical value it was seeded with, and only send the difference.
///
/// The two numbers are held as strings. A half-typed number is a state a
/// person passes through, and parsing on every keystroke turns an emptied box
/// into an order for zero and a `1` on the way to `150` into an order for one.
interface DraftLine {
  readonly supplierItemId: string
  readonly catalogue: {
    readonly name: string
    readonly price: number
    readonly division: string | null
    readonly tags: readonly string[]
  }
  name: string
  division: string | null
  tags: readonly string[]
  quantity: string
  price: string
}

function fromBasket(line: BasketLine): DraftLine {
  return {
    supplierItemId: line.item.supplier_item_id,
    catalogue: {
      name: line.item.name,
      price: line.item.unit_price_minor,
      division: line.item.division_code,
      tags: line.item.tags,
    },
    name: line.item.name,
    division: line.item.division_code,
    tags: line.item.tags,
    quantity: String(line.quantity),
    price: String(line.item.unit_price_minor),
  }
}

/// Whole rupiah or pieces, falling back to what the catalogue said when what
/// is typed is not a number. A blank box is somebody mid-edit, not an order
/// for nothing.
function whole(text: string, fallback: number): number {
  const parsed = Number.parseInt(text, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

/// Two tag selections that say the same thing. Order is not part of the
/// meaning, so a list rebuilt in a different order must not be sent as a
/// change — it would replace the catalogue's tags with an identical set and
/// record an edit nobody made.
function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join()
}

/// A discount is whole rupiah off the order, or nothing at all. A negative or
/// unreadable one is not a surcharge — it is a typo, and it comes to zero.
function discountOf(text: string): number {
  const off = Number.parseInt(text, 10)
  return Number.isFinite(off) && off > 0 ? off : 0
}

export function OrderComposer({
  open,
  basket,
  onClose,
  onRaised,
}: {
  open: boolean
  /// The baskets this order may be raised from, when it is being raised from
  /// one. Absent is the blank order: the supplier is chosen and the lines are
  /// added by hand.
  basket?: readonly Group[]
  onClose: () => void
  onRaised: (receipt: CatalogPurchaseOrderReceipt) => void
}) {
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()

  const [supplierId, setSupplierId] = useState<string | null>(null)
  const [lines, setLines] = useState<readonly DraftLine[]>([])
  const [poNumber, setPoNumber] = useState("")
  const [notes, setNotes] = useState("")
  const [discount, setDiscount] = useState("")

  /// Every supplier, for the blank order's picker. Not fetched while raising
  /// from a basket, where the choice is between the baskets that exist.
  const suppliers = useQuery({
    queryKey: procurementKeys.suppliers(),
    queryFn: ({ signal }) => listSuppliers(undefined, signal),
    staleTime: 5 * 60 * 1000,
    enabled: open && basket === undefined,
  })

  /// Where the goods land, no longer asked about.
  ///
  /// The control offered one real option and a default that did not work: the
  /// server requires a destination and reads an absent one as blank, so "The
  /// node's default" was a validation error wearing the word "default". While
  /// the company runs one DC there is nothing to choose, so the first
  /// registered destination is used and the question is not put.
  const destinations = useQuery({
    queryKey: procurementKeys.destinations(),
    queryFn: ({ signal }) => purchaseDestinations(signal),
    enabled: open,
  })
  const landing = destinations.data?.[0]?.site_id ?? null

  /// The words a line may be described with — the same vocabulary our own
  /// articles are filed under, because a PO line becomes one.
  const vocabulary = useQuery({
    queryKey: procurementKeys.vocabulary(),
    queryFn: ({ signal }) => catalogueVocabulary(signal),
    staleTime: 30 * 60 * 1000,
    enabled: open,
  })
  const divisionChoices = useMemo<Choice[]>(
    () =>
      (vocabulary.data?.divisions ?? []).map((term) => ({
        value: term.code,
        label: term.label,
      })),
    [vocabulary.data]
  )
  const tagChoices = useMemo<Choice[]>(
    () =>
      (vocabulary.data?.tags ?? []).map((term) => ({
        value: term.code,
        label: term.label,
      })),
    [vocabulary.data]
  )
  const supplierChoices = useMemo<Choice[]>(
    () =>
      (suppliers.data ?? []).map((one) => ({
        value: one.supplier_id,
        label: one.name,
      })),
    [suppliers.data]
  )

  const group = basket?.find((one) => one.supplierId === supplierId)
  const supplierName =
    group?.supplierName ??
    supplierChoices.find((one) => one.value === supplierId)?.label ??
    ""

  /// The supplier this order is for, decided once the sheet is open.
  ///
  /// A basket with one supplier in it is not a choice, and neither is the
  /// first of several — somebody has to start somewhere. Only set while it is
  /// still unset, so reopening the sheet does not undo a deliberate switch.
  useEffect(() => {
    if (!open || supplierId !== null) return
    if (basket !== undefined && basket.length > 0)
      setSupplierId(basket[0].supplierId)
  }, [open, basket, supplierId])

  /// The basket's lines, whenever the basket being ordered from changes.
  ///
  /// Keyed on the supplier rather than on the array, because the basket query
  /// refetches and hands back a new array of the same lines — reseeding on
  /// that would throw away every edit each time the window regained focus.
  useEffect(() => {
    if (basket === undefined || supplierId === null) return
    const chosen = basket.find((one) => one.supplierId === supplierId)
    setLines(chosen === undefined ? [] : chosen.lines.map(fromBasket))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId, basket === undefined])

  const patch = (id: string, change: Partial<DraftLine>) =>
    setLines((was) =>
      was.map((one) =>
        one.supplierItemId === id ? { ...one, ...change } : one
      )
    )

  const gross = lines.reduce(
    (sum, line) =>
      sum + whole(line.quantity, 0) * whole(line.price, line.catalogue.price),
    0
  )
  const discountMinor = discountOf(discount)

  const reset = () => {
    setPoNumber("")
    setNotes("")
    setDiscount("")
    setLines([])
  }

  const raise = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: () =>
      createCatalogPurchaseOrder(
        {
          po_number: poNumber.trim(),
          supplier_id: supplierId!,
          destination_site_id: landing,
          notes: notes.trim() === "" ? null : notes.trim(),
          discount_minor: discountMinor === 0 ? null : discountMinor,
          lines: lines.map((line) => {
            const name = line.name.trim()
            const price = whole(line.price, line.catalogue.price)
            return {
              supplier_item_id: line.supplierItemId,
              quantity: whole(line.quantity, 1),
              promised_date: null,
              // Absent means "the catalogue's", so only a real difference is
              // sent. Echoing the catalogue's own figure back would record an
              // agreed price on every line of every order and make the column
              // that exists to flag negotiated prices meaningless.
              unit_price_minor: price === line.catalogue.price ? null : price,
              article_name:
                name === "" || name === line.catalogue.name ? null : name,
              image_url: null,
              division_code:
                line.division === line.catalogue.division
                  ? null
                  : line.division,
              tags: sameTags(line.tags, line.catalogue.tags)
                ? null
                : [...line.tags],
            }
          }),
        },
        idempotency.key
      ),
    onSuccess: (receipt) => {
      // The order exists, so the order book changed; anything that came from
      // the basket is no longer in it. Both, named — not a blanket prefix.
      void client.invalidateQueries({ queryKey: procurementKeys.orders() })
      void client.invalidateQueries({ queryKey: procurementKeys.basket() })
      idempotency.rotate()
      reset()
      onRaised(receipt)
    },
  })

  const ready =
    supplierId !== null &&
    lines.length > 0 &&
    poNumber.trim() !== "" &&
    lines.every((line) => whole(line.quantity, 0) > 0)

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Raise an order"
      id={supplierName === "" ? undefined : supplierName}
      // Wide, because the lines ARE the order. Five editable columns — what it
      // is called, what it is, what part of the range it belongs to, how many
      // and at what price — do not fit in a rail, and this is the screen where
      // a buyer corrects a scraped catalogue one row at a time.
      //
      // `wide` rather than the default rail for the reason the Sheet doc
      // gives: this is a TASK, so it goes over the page instead of standing
      // beside the shelf and claiming a column of it on a monitor.
      width="wide"
      // `md:` is not decoration. The rail sets its own width at `md` and up
      // (`md:w-[27.5rem]`), and twMerge only lets a class override another
      // class at the SAME breakpoint — a bare `w-[78rem]` loses to it
      // everywhere except a phone, which is the one place it must not apply.
      // The sheet spent this whole screen's life 27.5rem wide because of it.
      className="md:w-[78rem]"
      footer={
        <Button
          variant="dark"
          className="w-full"
          disabled={!ready || raise.isPending}
          onClick={() => raise.mutate()}
        >
          {raise.isPending ? "Raising…" : "Raise the order"}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {raise.isError && (
          <Banner tone="bad">{(raise.error as Error).message}</Banner>
        )}

        {/* Two questions about the order itself, side by side: a form column
            down the middle of a 78rem sheet leaves the right half empty and
            pushes the table — the thing this screen is for — below the fold. */}
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Supplier"
            hint="One order, one supplier. A PO with two suppliers on it is not a document anybody can send."
          >
            <PickOne
              label="Supplier"
              choices={
                basket === undefined ? supplierChoices : basketChoices(basket)
              }
              value={supplierId}
              onChange={setSupplierId}
              placeholder="Choose a supplier"
            />
          </Field>

          <Field label="PO number" hint="What the supplier will quote back.">
            <Input
              value={poNumber}
              onChange={(event) => setPoNumber(event.target.value)}
              placeholder="PO-2026-0001"
            />
          </Field>
        </div>

        <Field label="Notes">
          <Textarea
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Anything the warehouse should know."
          />
        </Field>

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h4 className="text-card-title font-semibold text-ink">Lines</h4>
            {/* Adding goods without leaving the order. The basket is one way to
                collect them and it is not the only one — a repeat order or a
                supplier on the phone is a list somebody already has in their
                head, and making them walk a catalogue to type it is the long
                way round. Disabled until there is a supplier, because "what do
                they sell" has no answer before that. */}
            {supplierId !== null && (
              <AddLine
                supplierId={supplierId}
                already={lines.map((one) => one.supplierItemId)}
                onAdd={(line) => setLines((was) => [...was, line])}
              />
            )}
          </div>

          {lines.length === 0 ? (
            <EmptyState>
              {supplierId === null
                ? "Choose a supplier, then add what is being ordered."
                : "Nothing on this order yet. Add what is being bought."}
            </EmptyState>
          ) : (
            <>
              {/* The supplier's own item code is not a column. Eleven digits
                  nobody recognises, repeated down the left of the one table
                  where every other cell is something to read or change. */}
              <MiniTable
                head={[
                  "Item",
                  { label: "Tags", align: "left" },
                  { label: "Division", align: "left" },
                  "Qty",
                  "Price",
                  "",
                ]}
              >
                {lines.map((line) => (
                  <tr
                    key={line.supplierItemId}
                    className="border-t border-hairline align-top"
                  >
                    <td className="w-[20rem] py-2 pr-2">
                      <Input
                        value={line.name}
                        onChange={(event) =>
                          patch(line.supplierItemId, {
                            name: event.target.value,
                          })
                        }
                        className="h-8 w-full"
                        aria-label={`Name on this order for ${line.catalogue.name}`}
                      />
                    </td>
                    <td className="w-[19rem] py-2 pr-2">
                      <PickMany
                        label={`Tags for ${line.catalogue.name}`}
                        choices={tagChoices}
                        values={line.tags}
                        onChange={(tags) =>
                          patch(line.supplierItemId, { tags })
                        }
                      />
                    </td>
                    <td className="w-[12rem] py-2 pr-2">
                      <PickOne
                        label={`Division for ${line.catalogue.name}`}
                        choices={divisionChoices}
                        value={line.division}
                        onChange={(division) =>
                          patch(line.supplierItemId, { division })
                        }
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <Input
                        type="number"
                        min={1}
                        value={line.quantity}
                        onChange={(event) =>
                          patch(line.supplierItemId, {
                            quantity: event.target.value,
                          })
                        }
                        className="h-8 w-20 text-right"
                        aria-label={`Pieces of ${line.catalogue.name}`}
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <Input
                        type="number"
                        min={0}
                        value={line.price}
                        onChange={(event) =>
                          patch(line.supplierItemId, {
                            price: event.target.value,
                          })
                        }
                        className="h-8 w-28 text-right"
                        aria-label={`Unit price of ${line.catalogue.name}`}
                      />
                    </td>
                    <td className="py-2 text-right">
                      <Button
                        variant="quiet"
                        size="sm"
                        aria-label={`Take ${line.catalogue.name} off this order`}
                        onClick={() =>
                          setLines((was) =>
                            was.filter(
                              (one) =>
                                one.supplierItemId !== line.supplierItemId
                            )
                          )
                        }
                      >
                        <Trash2 />
                      </Button>
                    </td>
                  </tr>
                ))}
              </MiniTable>

              {/* The discount lives with the money it changes. It used to sit
                  above the lines, among the questions about the order — where
                  it read as a property of the paperwork rather than as the step
                  between what the goods come to and what the supplier will
                  invoice. It is the middle rung of the ladder now, which is
                  also where an invoice states it. */}
              <TotalsLadder
                className="mt-3"
                rows={[
                  { label: "Lines", value: money(gross) },
                  {
                    label: "Discount",
                    value: (
                      <Input
                        type="number"
                        min={0}
                        value={discount}
                        onChange={(event) => setDiscount(event.target.value)}
                        placeholder="0"
                        className="h-7 w-32 text-right"
                        aria-label="Discount agreed off the whole order"
                      />
                    ),
                  },
                ]}
                total={{
                  label: "The supplier will invoice",
                  value: money(gross - discountMinor),
                }}
              />
            </>
          )}
        </div>
      </div>
    </Sheet>
  )
}

/// The baskets, as something to choose between.
///
/// A count on the label rather than a second column: "three lines" is the only
/// thing that distinguishes two baskets from each other before you open one.
function basketChoices(groups: readonly Group[]): Choice[] {
  return groups.map((one) => ({
    value: one.supplierId,
    label: `${one.supplierName} — ${one.lines.length} lines`,
  }))
}

/// Search one supplier's catalogue and put a row on the order.
///
/// Its own combobox rather than `PickOne`, because the options are not a
/// vocabulary held in memory: a supplier's catalogue runs to thousands of
/// items, so this asks the server what matches what is being typed. The rows
/// already on the order are struck out of the list — adding the same item
/// twice is a validation error the server raises, and offering somebody a
/// choice that can only fail is worse than not offering it.
/// A stable empty selection. A fresh `[]` on every render is a new identity,
/// which Base UI reads as the value having changed — see the same constant in
/// `filter-omnibox`.
const NOTHING_HELD: SourcedItem[] = []

function AddLine({
  supplierId,
  already,
  onAdd,
}: {
  supplierId: string
  already: readonly string[]
  onAdd: (line: DraftLine) => void
}) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)

  const found = useQuery({
    queryKey: procurementKeys.sourcing({
      supplierIds: [supplierId],
      q: query.trim() === "" ? undefined : query.trim(),
      status: "ACTIVE",
      limit: 20,
    }),
    queryFn: ({ signal }) =>
      searchSupplierItems(
        {
          supplierIds: [supplierId],
          q: query.trim() === "" ? undefined : query.trim(),
          status: "ACTIVE",
          limit: 20,
        },
        signal
      ),
    enabled: open,
    // A catalogue does not change while somebody types into a search box.
    staleTime: 60 * 1000,
  })

  const rows = useMemo(
    () =>
      (found.data?.items ?? []).filter(
        (row) => !already.includes(row.item.supplier_item_id)
      ),
    [found.data, already]
  )

  return (
    <Combobox.Root
      items={rows}
      filter={null}
      // Multi-select, though one row is acted on and the selection is thrown
      // away immediately. Single-select writes the picked label into the input
      // and closes the panel — both wrong here, where adding one line is
      // usually the start of adding three.
      multiple
      value={NOTHING_HELD}
      onValueChange={(picked) => {
        const row = (picked as SourcedItem[])[picked.length - 1]
        if (!row) return
        onAdd({
          supplierItemId: row.item.supplier_item_id,
          catalogue: {
            name: row.item.name,
            price: row.item.unit_price_minor,
            division: row.item.division_code,
            tags: row.item.tags,
          },
          name: row.item.name,
          division: row.item.division_code,
          tags: row.item.tags,
          quantity: "1",
          price: String(row.item.unit_price_minor),
        })
        setQuery("")
      }}
      inputValue={query}
      onInputValueChange={setQuery}
      open={open}
      onOpenChange={(next, details) => {
        if (!next && details.reason === "item-press") return
        setOpen(next)
      }}
      itemToStringLabel={(row) => (row ? (row as SourcedItem).item.name : "")}
      modal={false}
    >
      <Combobox.InputGroup className="flex h-8 w-[22rem] items-center gap-1.5 rounded-full border border-hairline-2 bg-canvas px-2.5 text-[0.78125rem] transition-colors hover:bg-soft-2">
        <Search className="size-3.5 shrink-0 text-line-ico" />
        <Combobox.Input
          aria-label="Add an item to this order"
          placeholder="Add an item from this supplier"
          className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-mute"
        />
        <Combobox.Trigger aria-label="Open" className="shrink-0 text-line-ico">
          <Plus className="size-3.5" />
        </Combobox.Trigger>
      </Combobox.InputGroup>

      <Combobox.Portal>
        <Combobox.Positioner
          side="bottom"
          align="end"
          sideOffset={6}
          className="z-50 w-[var(--anchor-width)] min-w-[22rem]"
        >
          <Combobox.Popup className={cn(POPUP, "w-full")}>
            <Combobox.List>
              <Combobox.Empty className="px-2.5 py-3 text-center text-meta text-mute">
                {found.isPending
                  ? "Looking…"
                  : "Nothing left in this catalogue matches."}
              </Combobox.Empty>
              {rows.map((row) => (
                <Combobox.Item
                  key={row.item.supplier_item_id}
                  value={row}
                  className={cn(ITEM, "justify-between gap-3")}
                >
                  <span className="min-w-0 truncate">{row.item.name}</span>
                  <span className="shrink-0 text-mute tabular-nums">
                    {money(row.item.unit_price_minor)}
                  </span>
                </Combobox.Item>
              ))}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}
