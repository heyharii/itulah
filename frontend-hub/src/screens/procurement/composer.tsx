import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { PackageSearch, Plus, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Day } from "@/components/ui/day"
import { Field, Input, Money, Textarea } from "@/components/ui/field"
import { PickMany, PickOne, type Choice } from "@/components/ui/pick"
import { TotalsLadder } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Thumbnail } from "@/components/ui/thumbnail"
import { money } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  catalogueVocabulary,
  createCatalogPurchaseOrder,
  listPurchaseOrders,
  listSuppliers,
  procurementKeys,
  purchaseDestinations,
  type CatalogPurchaseOrderReceipt,
} from "@/lib/queries/procurement"
import { ItemFormSheet } from "@/screens/procurement/item-form"
import { CataloguePicker } from "@/screens/procurement/pick-items"
import { useIdempotencyKey } from "@/screens/procurement/shared"
import type { BasketLine, SourcedItem, SupplierItem } from "@itulah/contract"

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
///
/// **And two ways to add one.** Browse puts the supplier's shelf on the glass
/// as a grid of photographs; New item writes a row that is not on that shelf
/// yet. Both are needed and neither substitutes for the other — a buyer
/// ordering a repeat knows what it looks like, and a buyer ordering something
/// the supplier has just quoted has nothing to look at. What used to stand
/// here was a single 22rem typeahead, which served the first case badly and
/// the second not at all.
///
/// The new item is created in the supplier's catalogue on its way onto the
/// order, and that is not a detour: a PO line points at a supplier item — the
/// server snapshots the price and the classification from it — so an item that
/// is on an order is, by construction, an item the supplier sells. What it
/// spares is the trip to Catalogue and back with a half-written order open.

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
  /// The photograph, copied off the supplier item and sent with the line.
  ///
  /// Not editable here and not absent: `image_url` was hardcoded `null` on
  /// every line this screen ever raised, so orders reached the DC as a list of
  /// words and a warehouse checking a carton against one had nothing to look
  /// at. It travels for the same reason the name and the classification do —
  /// what is ordered is what is received, and the receiving screen reads the
  /// line, not the catalogue.
  readonly image: string | null
}

/// One line, from each of the three places one can come from. Three functions
/// rather than three shapes: a basket line, a sourcing row and a freshly
/// created item all carry the same supplier item, wrapped differently.
function fromBasket(line: BasketLine): DraftLine {
  return fromItem(line.item, String(line.quantity))
}

function fromSourced(row: SourcedItem): DraftLine {
  return fromItem(row.item, "1")
}

function fromItem(item: SupplierItem, quantity: string): DraftLine {
  return {
    supplierItemId: item.supplier_item_id,
    catalogue: {
      name: item.name,
      price: item.unit_price_minor,
      division: item.division_code,
      tags: item.tags,
    },
    name: item.name,
    division: item.division_code,
    tags: item.tags,
    quantity,
    price: String(item.unit_price_minor),
    image: item.image_url,
  }
}

/// The lines are a GRID, and this is its chrome.
///
/// Monday.com's shape rather than a list of form controls: one ruled
/// rectangle, a heading strip, and every cell an editable square. What stood
/// here was a `<MiniTable>` with six pills dropped into it — a white bordered
/// picker beside a grey filled box beside a narrower grey filled box, each
/// floating in its own padding, none of them lining up with the heading above
/// it. Six roundeds in a row read as six controls; a ruled cell reads as a
/// spreadsheet, which is what this is.
///
/// The controls keep their behaviour and give up their chrome: no pill, no
/// fill, no border of their own. The CELL carries the divider, the hover and
/// the focus ring, so the thing you are editing is the square you clicked in
/// — and a row of them cannot disagree about its height.

/// A column heading. `first:border-l-0` because the container draws the
/// outer edge; the collapse takes care of the rest.
const HEAD =
  "border-b border-l border-hairline bg-soft-2 px-3 py-2 text-left font-mono text-eyebrow tracking-[0.04em] text-body uppercase first:border-l-0"

/// A cell. `p-0` — its control fills it — and the focus ring is drawn HERE,
/// inset, because the control inside has `outline-none` and a caret alone does
/// not say which square of a grid is live.
const CELL =
  "border-l border-hairline p-0 align-middle first:border-l-0 focus-within:relative focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-accent"

/// What a control wears inside a cell: nothing. Height comes from `min-h-9` so
/// `<PickMany>` can still grow a second row of chips, and every fill, border
/// and radius the control would otherwise paint is taken off — including the
/// focus colours, which the cell is already drawing.
const BOX =
  "min-h-9 w-full rounded-none border-transparent bg-transparent px-3 hover:border-transparent hover:bg-transparent has-[input:focus-visible]:border-transparent has-[input:focus-visible]:bg-transparent"

/// The next number in the series, from the orders already raised.
///
/// `PO-20260904-2217` is the shape the book is written in: the day it was
/// raised, then a counter that does not restart. So the counter is the largest
/// tail anybody has used plus one — read from the order list rather than
/// invented, because a number that collides is refused by a UNIQUE constraint
/// and the buyer is the one who has to guess again.
///
/// It is a suggestion, not an allocation. Nothing reserves it, two people
/// composing at once are offered the same one, and the second to press Create
/// PO is told the number is taken. That is the honest failure for a book with
/// no server-side counter behind it — and the reason a refused order refetches
/// the book: the next press is offered a number that is free, without asking
/// a buyer to invent one.
function nextPoNumber(existing: readonly { po_number: string }[]): string {
  const highest = existing.reduce((top, order) => {
    const tail = /-(\d+)$/.exec(order.po_number)
    if (tail === null) return top
    const seen = Number.parseInt(tail[1], 10)
    return Number.isFinite(seen) && seen > top ? seen : top
  }, 0)
  const today = new Date()
  const stamp = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("")
  return `PO-${stamp}-${String(highest + 1).padStart(4, "0")}`
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
  const [arrival, setArrival] = useState("")
  const [notes, setNotes] = useState("")
  const [discount, setDiscount] = useState("")
  /// The two ways to put a line on this order, each its own sheet over this
  /// one. Transient by nature — nobody links to a half-open picker — which is
  /// why they are `useState` and not URL state.
  const [browsing, setBrowsing] = useState(false)
  const [creating, setCreating] = useState(false)

  /// The order book, for the next number in it. The whole list, because that
  /// is the only route there is — it is a few hundred rows and it is already
  /// what Purchase orders behind this sheet is reading, so this is a cache hit
  /// nine times out of ten.
  const orders = useQuery({
    queryKey: procurementKeys.orders(),
    queryFn: ({ signal }) => listPurchaseOrders(undefined, signal),
    enabled: open,
  })
  /// The number this order will carry. Read, never typed — see the field.
  const poNumber = useMemo(() => nextPoNumber(orders.data ?? []), [orders.data])

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
    setArrival("")
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
              // One date, stamped on every line. The wire carries it per line
              // because a supplier may promise half an order for March and the
              // rest for April, and the DC's outstanding list reads it line by
              // line — but nobody has yet asked for two dates on one PO, and a
              // date box on every row would be twelve controls answering one
              // question. Split it here the day somebody needs to.
              promised_date: arrival === "" ? null : arrival,
              // Absent means "the catalogue's", so only a real difference is
              // sent. Echoing the catalogue's own figure back would record an
              // agreed price on every line of every order and make the column
              // that exists to flag negotiated prices meaningless.
              unit_price_minor: price === line.catalogue.price ? null : price,
              article_name:
                name === "" || name === line.catalogue.name ? null : name,
              image_url: line.image,
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
    // A refused order is usually a refused NUMBER — somebody else raised one
    // while this sheet was open. The book is reread so the next press is
    // offered a free number, which is the only way out now that nobody types
    // one by hand.
    onError: () => {
      void client.invalidateQueries({ queryKey: procurementKeys.orders() })
    },
  })

  const ready =
    supplierId !== null &&
    lines.length > 0 &&
    poNumber.trim() !== "" &&
    lines.every((line) => whole(line.quantity, 0) > 0)

  /// Everything a sheet opened over this one needs, and the one thing that
  /// stops it opening: an order with no supplier has no catalogue to browse
  /// and no catalogue to add to.
  const supplierChosen = supplierId !== null

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => !next && onClose()}
        title="Create a purchase order"
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
        // Two buttons at their own size, at the trailing edge — not one black
        // bar across 78rem. A full-width CTA is a phone pattern; on a sheet this
        // wide it reads as a banner rather than a control, and it left the only
        // way out of a half-written order the × in the corner. Cancel says the
        // draft can be abandoned, and says it in the place a person looks for it.
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!ready || raise.isPending}
              onClick={() => raise.mutate()}
            >
              {raise.isPending ? "Creating…" : "Create PO"}
            </Button>
          </div>
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

            {/* Shown, not asked.
              
                A box somebody can type into says the number is theirs to
                choose, and it is not: it is counted on from the last order
                raised, and two orders carrying one number is precisely the
                mistake this screen must not let anybody make by hand.

                `readOnly` rather than `disabled`, because the number is the
                one thing on this form that gets copied into a chat or an
                email, and a disabled box cannot be selected. */}
            <Field
              label="PO number"
              hint="Issued here, counted on from the last order raised."
            >
              <Input
                readOnly
                value={poNumber}
                className="font-mono text-body hover:border-transparent hover:bg-soft-2"
              />
            </Field>
          </div>

          {/* When it is due. The one fact about a purchase order that the
            warehouse acts on and this screen never asked for: an order with no
            promised date is one nobody can chase, and Outstanding — the screen
            whose whole job is "what has not arrived" — had nothing to measure
            late against. */}
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="Expected arrival"
              hint="What the supplier promised. Leave it empty when they have not said."
            >
              {/* `<Day>` and not `<input type="date">`, for the reason the
                control's own note gives — and for one this screen learned the
                hard way: a native date box only opens its calendar when the
                little icon at its right edge is hit. A click anywhere else in
                the field lands on a segment of the text and does nothing
                visible, so the control read as dead to everybody who did not
                aim at the icon. */}
              <Day
                value={arrival}
                onChange={setArrival}
                placeholder="Not promised"
              />
            </Field>

            {/* Agreed with the supplier, so it is asked here with the other
              things that were agreed — not left as a box hanging off the
              ladder at the bottom, where it was the one editable control in a
              column of computed figures and read as a total somebody could
              type over. The ladder still states it; it just no longer asks. */}
            <Field
              label="Discount"
              hint="Whole rupiah off the whole order, as agreed. The supplier's invoice states it once at the bottom, and so does ours."
            >
              <Money
                label="Discount agreed off the whole order"
                value={discount}
                onChange={setDiscount}
                prefix="Rp"
                placeholder="0"
              />
            </Field>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h4 className="text-card-title font-semibold text-ink">Lines</h4>
              {/* Adding goods without leaving the order. The basket is one way to
                collect them and it is not the only one — a repeat order or a
                supplier on the phone is a list somebody already has in their
                head, and making them walk a catalogue to type it is the long
                way round. Both are dead until there is a supplier, because
                "what do they sell" has no answer before that — shown greyed
                rather than absent, so the two ways in are visible from the
                moment the sheet opens. */}
              <div className="flex items-center gap-2">
                <Button
                  disabled={!supplierChosen}
                  onClick={() => setBrowsing(true)}
                >
                  <PackageSearch />
                  Browse catalogue
                </Button>
                <Button
                  disabled={!supplierChosen}
                  onClick={() => setCreating(true)}
                >
                  <Plus />
                  New item
                </Button>
              </div>
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
                {/* Division before Tags: what the thing IS comes before what
                    it is filed under, and the two were the other way round.
                    Division is also narrower now — a picker holding one short
                    word was taking 12rem from the column people actually
                    read. */}
                <div className="overflow-hidden rounded-inner border border-hairline">
                  {/* The grid scrolls sideways inside its own box rather than
                      squeezing. Six of these columns hold a control with a
                      floor under its width, and below about 62rem the seventh
                      — the item's own name, the one column somebody READS —
                      was the only one that could give, so it collapsed to a
                      couple of characters on a laptop with the sheet narrower
                      than its `md:` width. */}
                  <div className="overflow-x-auto">
                    {/* `table-fixed`, so a long item name widens nothing: the
                        columns are decided by what they hold — a picker, four
                        digits of quantity, a rupiah figure — and a grid whose
                        columns move as you type is a grid nobody can aim at. */}
                    <table className="w-full min-w-[62rem] table-fixed border-collapse">
                      <colgroup>
                        <col />
                        <col className="w-[10.5rem]" />
                        <col className="w-[14rem]" />
                        <col className="w-[5.5rem]" />
                        <col className="w-[9rem]" />
                        <col className="w-[9.5rem]" />
                        <col className="w-[3rem]" />
                      </colgroup>
                      <thead>
                        <tr>
                          <th className={HEAD}>Item</th>
                          <th className={HEAD}>Division</th>
                          <th className={HEAD}>Tags</th>
                          <th className={cn(HEAD, "text-right")}>Qty</th>
                          <th className={cn(HEAD, "text-right")}>Price</th>
                          <th className={cn(HEAD, "text-right")}>Amount</th>
                          <th className={HEAD}>
                            <span className="sr-only">Remove</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((line) => (
                          <tr
                            key={line.supplierItemId}
                            className="border-t border-hairline transition-colors hover:bg-soft"
                          >
                            <td className={CELL}>
                              {/* The photograph beside the name it belongs to,
                              rather than in a column of its own: what a buyer
                              checks is "is this the right thing", and that is
                              one glance at a picture and a word, not two. */}
                              <div className="flex items-center gap-2 pl-2.5">
                                <Thumbnail
                                  url={line.image}
                                  fallback="—"
                                  className="size-6 shrink-0 rounded-[0.3125rem]"
                                />
                                <Input
                                  value={line.name}
                                  onChange={(event) =>
                                    patch(line.supplierItemId, {
                                      name: event.target.value,
                                    })
                                  }
                                  className={cn(BOX, "pl-1.5")}
                                  aria-label={`Name on this order for ${line.catalogue.name}`}
                                />
                              </div>
                            </td>
                            <td className={CELL}>
                              <PickOne
                                label={`Division for ${line.catalogue.name}`}
                                choices={divisionChoices}
                                value={line.division}
                                onChange={(division) =>
                                  patch(line.supplierItemId, { division })
                                }
                                className={BOX}
                              />
                            </td>
                            <td className={CELL}>
                              <PickMany
                                label={`Tags for ${line.catalogue.name}`}
                                choices={tagChoices}
                                values={line.tags}
                                onChange={(tags) =>
                                  patch(line.supplierItemId, { tags })
                                }
                                className={BOX}
                              />
                            </td>
                            <td className={CELL}>
                              <Input
                                type="number"
                                min={1}
                                value={line.quantity}
                                onChange={(event) =>
                                  patch(line.supplierItemId, {
                                    quantity: event.target.value,
                                  })
                                }
                                className={cn(BOX, "text-right tabular-nums")}
                                aria-label={`Pieces of ${line.catalogue.name}`}
                              />
                            </td>
                            <td className={CELL}>
                              <Money
                                label={`Unit price of ${line.catalogue.name}`}
                                value={line.price}
                                onChange={(price) =>
                                  patch(line.supplierItemId, { price })
                                }
                                className={cn(BOX, "text-right")}
                              />
                            </td>
                            {/* Qty times price, per line. The ladder underneath
                              has always said what the whole order comes to;
                              this says what each line contributes, which is
                              the figure a buyer checks a quote against row by
                              row. Read-only — it is the product of two boxes
                              that are not, so it takes no cell chrome and no
                              focus: the one column in this grid you cannot put
                              a caret in. */}
                            <td
                              className={cn(
                                CELL,
                                "px-3 text-right text-[0.8125rem] font-medium text-ink tabular-nums"
                              )}
                            >
                              {money(
                                whole(line.quantity, 0) *
                                  whole(line.price, line.catalogue.price)
                              )}
                            </td>
                            <td className={cn(CELL, "text-center")}>
                              <Button
                                variant="quiet"
                                size="sm"
                                aria-label={`Take ${line.catalogue.name} off this order`}
                                onClick={() =>
                                  setLines((was) =>
                                    was.filter(
                                      (one) =>
                                        one.supplierItemId !==
                                        line.supplierItemId
                                    )
                                  )
                                }
                              >
                                <Trash2 />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Three figures in a column at the right, not three rows
                  spread across 78rem. `justify-between` over a sheet this wide
                  put the words at one edge and the money at the other with a
                  hand's width of nothing between them, and the discount box —
                  the one control in the ladder — sat on a third edge of its
                  own. The block is capped and pushed right, so the labels sit
                  beside their figures and every figure shares one right edge
                  with the Amount column above. */}
                <TotalsLadder
                  className="mt-3 ml-auto w-full max-w-[26rem]"
                  rows={[
                    { label: "Lines", value: money(gross) },
                    {
                      label: "Discount",
                      value:
                        discountMinor === 0 ? "—" : `− ${money(discountMinor)}`,
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

          {/* Last, under the lines. A note is what somebody writes once the
            order is written — "call the warehouse before the truck leaves" —
            and asking for it above the goods put a free-text box between the
            supplier and the thing being bought. */}
          <Field label="Notes">
            <Textarea
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Anything the warehouse should know."
            />
          </Field>
        </div>
      </Sheet>

      {/* Both open OVER the order, and neither replaces it: the half-written
          document is still there underneath, which is what makes adding a
          fourth line a two-click trip instead of a re-entry. */}
      {supplierId !== null && (
        <>
          <CataloguePicker
            open={browsing}
            supplierId={supplierId}
            supplierName={supplierName}
            already={lines.map((one) => one.supplierItemId)}
            onClose={() => setBrowsing(false)}
            onPick={(rows) =>
              setLines((was) => [...was, ...rows.map(fromSourced)])
            }
          />
          <ItemFormSheet
            open={creating}
            supplierId={supplierId}
            onClose={() => setCreating(false)}
            // Straight onto the order, and the sheet shuts. The catalogue's own
            // copy of this form stays open for the next one — somebody typing a
            // supplier's price list in is adding twenty — but here the item was
            // wanted for THIS order, and leaving an empty form up after it lands
            // reads as if nothing happened.
            onSaved={(item) => {
              setLines((was) => [...was, fromItem(item, "1")])
              setCreating(false)
            }}
          />
        </>
      )}
    </>
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
