import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronLeft, PackageSearch, Plus, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Day } from "@/components/ui/day"
import { Field, Input, Money, Select, Textarea } from "@/components/ui/field"
import { PickMany, PickOne, type Choice } from "@/components/ui/pick"
import { Section, TotalsLadder } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Thumbnail } from "@/components/ui/thumbnail"
import { day, money } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  catalogueVocabulary,
  createCatalogPurchaseOrder,
  paymentTermsBook,
  listPurchaseOrders,
  listSuppliers,
  procurementKeys,
  removeFromBasket,
  purchaseDestinations,
  type CatalogPurchaseOrderReceipt,
} from "@/lib/queries/procurement"
import { ItemFormSheet } from "@/screens/procurement/item-form"
import { CataloguePicker } from "@/screens/procurement/pick-items"
import {
  GRID_CELL,
  GRID_HEAD,
  useIdempotencyKey,
} from "@/screens/procurement/shared"
import type {
  BasketLine,
  PaymentTermBasis,
  PaymentTermsBook,
  SourcedItem,
  SupplierItem,
} from "@itulah/contract"

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
/// The grid header, from the pair both this screen and the order's detail
/// sheet import — see `shared.ts` for why it is not written here.
const HEAD = GRID_HEAD

/// A cell. `p-0` — its control fills it.
///
/// No focus ring. It used to draw a blue box round whichever square was live,
/// because the control inside has `outline-none` and a caret alone does not
/// say which cell of a grid you are in. Removed on the owner's instruction:
/// on a grid this narrow the ring lands on every cell you tab or click
/// through, and a table being filled in flickered blue under the hand.
const CELL = "border-l border-hairline p-0 align-middle first:border-l-0"

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
/// A line of a payment schedule: what it is called, the DAY it falls due, and
/// what share of the order it is — in basis points, so the amounts follow the
/// total as lines and discounts change.
///
/// A date, not an offset. The schedule used to carry `days` and render
/// `today + days`, which made the due date a computed fact nobody could
/// touch — and a supplier who says "advance now, the rest on the 20th" has
/// named a day, not an interval. The offsets survive where they belong, in
/// the templates, and become days the moment one is applied.
interface PaymentTerm {
  label: string
  /// `yyyy-mm-dd`, or `""` for a term nobody has dated yet.
  due: string
  bps: number
  /// How THIS instalment will be paid. `""` until somebody agrees one.
  ///
  /// On the instalment and not on the order, which is where it used to be.
  /// "40% advance by transfer, the balance by giro at thirty days" is an
  /// ordinary arrangement and one field on the header cannot state it — the
  /// header version silently made the whole order one method. ERPNext reaches
  /// the same place: `mode_of_payment` sits on each Payment Schedule row, and
  /// the Purchase Order has no payment-mode field at all.
  method: string
}

/// How the money moves. Indonesian practice, in the order a buyer meets them.
///
/// Still a `const` after 0201 put the TERMS in a table, and deliberately: a
/// method is not master data here. `supplier_payment.method` (0084) pins the
/// same five in a CHECK because the posting rule branches on them — a giro is
/// a dated piece of paper and a transfer clears the same day — so the list is
/// the server's to widen, not a vocabulary somebody can add a row to.
const PAYMENT_METHODS = [
  "Transfer",
  "Giro",
  "Cash",
  "Virtual account",
  "Card",
] as const

/// A `Date` as `yyyy-mm-dd`, read off the LOCAL calendar.
///
/// Not `toISOString()`: this runs at UTC+7, where an instant early in the
/// morning is still yesterday in UTC, and a schedule seeded before 07:00 dated
/// every instalment a day early.
function isoDay(at: Date): string {
  return [
    at.getFullYear(),
    String(at.getMonth() + 1).padStart(2, "0"),
    String(at.getDate()).padStart(2, "0"),
  ].join("-")
}

/// When a term falls due, counted from a given day.
///
/// The three bases are the server's (`PaymentTermBasis`, migration 0201) and
/// ERPNext's before that. There are three because "net 30 from the end of the
/// month" is ordinary in Indonesian trade and is not a number of days from
/// anything else.
///
/// Counted from TODAY here, because the order is being raised and no bill
/// exists. The dates it produces are the agreement; the bill recomputes them
/// against its own date when it arrives, which is the whole reason the basis
/// travels beside the date rather than being thrown away once a day is
/// picked.
function dueOn(basis: PaymentTermBasis, offset: number, from: Date): string {
  const at = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const n = Number(offset) || 0
  switch (basis) {
    case "DAYS_AFTER_BILL":
      at.setDate(at.getDate() + n)
      return isoDay(at)
    case "DAYS_AFTER_BILL_MONTH_END":
      // Day 0 of the NEXT month is the last day of this one — the idiom that
      // avoids a table of month lengths and gets February right in a leap
      // year for free.
      at.setMonth(at.getMonth() + 1, 0)
      at.setDate(at.getDate() + n)
      return isoDay(at)
    case "MONTHS_AFTER_BILL_MONTH_END":
      at.setMonth(at.getMonth() + 1 + n, 0)
      return isoDay(at)
  }
}

/// A template's terms, dated against today.
function scheduleOf(
  book: PaymentTermsBook | undefined,
  code: string
): PaymentTerm[] {
  const today = new Date()
  return (book?.templates.find((one) => one.code === code)?.lines ?? []).map(
    (line) => ({
      label: line.term_label,
      due: dueOn(line.basis, line.offset_value, today),
      bps: line.portion_bps,
      method: "",
    })
  )
}

function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join()
}

/// A discount is whole rupiah off the order, or nothing at all. A negative or
/// unreadable one is not a surcharge — it is a typo, and it comes to zero.
function discountOf(text: string): number {
  const off = Number.parseInt(text, 10)
  return Number.isFinite(off) && off > 0 ? off : 0
}

/// What a vocabulary calls a code, or nothing when it does not know it.
///
/// A code with no entry is shown as itself rather than dropped: a tag the
/// vocabulary has not caught up with is still something this line is filed
/// under, and a review that quietly omitted it would be hiding the difference
/// it exists to show.
function labelled(
  choices: readonly Choice[],
  value: string | null
): string | null {
  if (value === null) return null
  return choices.find((one) => one.value === value)?.label ?? value
}

/// A read-only cell in the review. `CELL` is `p-0` because an editable grid's
/// padding belongs to the input filling the square; this one has to draw it.
const READ = GRID_CELL

/// The order as it is about to be created, with nothing left to press by
/// accident.
///
/// A purchase order is a promise to pay. What this sheet did before this step
/// existed was turn twenty edited cells into that promise on one click, from a
/// form long enough that the lines were off the top of the glass by the time
/// the button came into reach. The step costs one press and buys the single
/// reading where the whole document is visible at once — which is the only
/// place a quantity typed into the wrong row is ever going to be caught.
///
/// Read-only on purpose. A review you can edit is just the form again, and
/// somebody who wants to change something goes back to it — the footer says
/// so, and says it beside the button that commits.
function OrderReview({
  supplier,
  arrival,
  lines,
  divisions,
  tags,
  gross,
  discountMinor,
  schedule,
  conditions,
  notes,
}: {
  supplier: string
  arrival: string
  lines: readonly DraftLine[]
  /// The vocabulary the line pickers were filled from.
  ///
  /// Passed in rather than read again here, because a review printing
  /// `KIDS · KAUS_KAKI` under a garment the form two clicks ago called
  /// `Kids · Kaus Kaki` is not the same document being checked — and the one
  /// screen whose whole job is "read this before you commit it" is the last
  /// place to show somebody the storage codes.
  divisions: readonly Choice[]
  tags: readonly Choice[]
  gross: number
  discountMinor: number
  schedule: readonly PaymentTerm[]
  conditions: string
  notes: string
}) {
  return (
    <div className="flex flex-col gap-5">
      <Facts>
        <Fact term="Supplier">{supplier === "" ? "—" : supplier}</Fact>
        <Fact term="Expected arrival">
          {arrival === "" ? "Not promised" : day(arrival)}
        </Fact>
      </Facts>

      <Section title={`Lines (${lines.length})`} rule={false}>
        <div className="overflow-hidden rounded-inner border border-hairline">
          <table className="w-full border-collapse text-[0.875rem]">
            <thead>
              <tr>
                <th className={HEAD}>Item</th>
                <th className={cn(HEAD, "w-[5.5rem] text-right")}>Qty</th>
                <th className={cn(HEAD, "w-[9rem] text-right")}>Price</th>
                <th className={cn(HEAD, "w-[9.5rem] text-right")}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const quantity = whole(line.quantity, 0)
                const price = whole(line.price, line.catalogue.price)
                const filed = [
                  labelled(divisions, line.division) ?? "Unclassified",
                  ...line.tags.map((one) => labelled(tags, one) ?? one),
                ].join(" · ")
                return (
                  <tr key={line.supplierItemId}>
                    <td className={READ}>
                      <div className="flex items-center gap-2.5">
                        <Thumbnail
                          url={line.image}
                          className="size-9 shrink-0 rounded-inner"
                        />
                        <div className="min-w-0">
                          <div className="truncate text-ink">
                            {line.name.trim() === ""
                              ? line.catalogue.name
                              : line.name}
                          </div>
                          <div className="truncate text-[0.75rem] text-body">
                            {filed}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className={cn(READ, "text-right tabular-nums")}>
                      {quantity}
                    </td>
                    <td className={cn(READ, "text-right tabular-nums")}>
                      {money(price)}
                    </td>
                    <td className={cn(READ, "text-right tabular-nums")}>
                      {money(quantity * price)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <TotalsLadder
          className="ml-auto w-full max-w-[26rem] border-t-0 pt-0"
          rows={[
            { label: "Lines", value: money(gross) },
            {
              label: "Discount",
              value: discountMinor === 0 ? "—" : `− ${money(discountMinor)}`,
            },
          ]}
          total={{
            label: "The supplier will invoice",
            value: money(gross - discountMinor),
          }}
        />
      </Section>

      <Section title="Payment terms">
        {schedule.length === 0 ? (
          <p className="text-meta text-mute">
            No schedule agreed — the whole amount falls due on the supplier's
            own terms.
          </p>
        ) : (
          <div className="overflow-hidden rounded-inner border border-hairline">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[38rem] table-fixed border-collapse text-[0.8125rem]">
                <colgroup>
                  <col className="w-[3rem]" />
                  <col />
                  <col className="w-[9rem]" />
                  <col className="w-[9rem]" />
                  <col className="w-[7rem]" />
                  <col className="w-[10rem]" />
                </colgroup>
                <thead>
                  <tr>
                    <th className={cn(HEAD, "text-right")}>No</th>
                    <th className={HEAD}>Payment term</th>
                    <th className={HEAD}>Due date</th>
                    <th className={HEAD}>Method</th>
                    <th className={cn(HEAD, "text-right")}>Portion</th>
                    <th className={cn(HEAD, "text-right")}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.map((term, index) => (
                    <tr key={index}>
                      <td
                        className={cn(
                          READ,
                          "text-right text-mute tabular-nums"
                        )}
                      >
                        {index + 1}
                      </td>
                      <td className={cn(READ, "text-ink")}>{term.label}</td>
                      <td className={cn(READ, "tabular-nums")}>
                        {term.due === "" ? "—" : day(term.due)}
                      </td>
                      <td className={READ}>
                        {term.method === "" ? "—" : term.method}
                      </td>
                      <td className={cn(READ, "text-right tabular-nums")}>
                        {Math.round(term.bps / 100)}%
                      </td>
                      <td
                        className={cn(
                          READ,
                          "text-right font-medium text-ink tabular-nums"
                        )}
                      >
                        {money(
                          Math.round(
                            ((gross - discountMinor) * term.bps) / 10000
                          )
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {conditions.trim() !== "" && (
          <div>
            <div className="text-[0.75rem] leading-[1.125rem] text-body">
              Terms and conditions
            </div>
            <p className="mt-[0.3125rem] text-[0.875rem] leading-[1.375rem] whitespace-pre-wrap text-ink">
              {conditions.trim()}
            </p>
          </div>
        )}
      </Section>

      {notes.trim() !== "" && (
        <Section title="Notes">
          <p className="text-[0.875rem] leading-[1.375rem] whitespace-pre-wrap text-ink">
            {notes.trim()}
          </p>
        </Section>
      )}
    </div>
  )
}

/// One line's wording, on its own sheet.
///
/// What is edited here is THE LINE, not the supplier's item. The catalogue is
/// scraped, often wrong about the name and frequently unclassified, and
/// raising the order is the moment somebody has the quote and the goods in
/// mind at once — so a buyer corrects what THIS order says and the supplier's
/// own record is left alone. That is why `CatalogPurchaseLineRequest` carries
/// these three fields at all; see the note at the top of this file.
///
/// Keyed on the line by its caller, so opening a second one starts from that
/// line's values rather than the last one's.
function LineEditor({
  line,
  divisions,
  tags,
  onSave,
  onClose,
}: {
  /// The line being edited, or nothing when the sheet is shut.
  line: DraftLine | null
  divisions: readonly Choice[]
  tags: readonly Choice[]
  onSave: (change: Partial<DraftLine>) => void
  onClose: () => void
}) {
  if (line === null) return null
  return (
    <LineEditorForm
      key={line.supplierItemId}
      line={line}
      divisions={divisions}
      tags={tags}
      onSave={onSave}
      onClose={onClose}
    />
  )
}

function LineEditorForm({
  line,
  divisions,
  tags,
  onSave,
  onClose,
}: {
  line: DraftLine
  divisions: readonly Choice[]
  tags: readonly Choice[]
  onSave: (change: Partial<DraftLine>) => void
  onClose: () => void
}) {
  const [name, setName] = useState(line.name)
  const [division, setDivision] = useState(line.division)
  const [chosen, setChosen] = useState<readonly string[]>(line.tags)

  return (
    <Sheet
      open
      onOpenChange={(next) => !next && onClose()}
      title="Edit item"
      // The supplier's own name for it, which is what this line started as and
      // what a buyer is correcting away from.
      id={line.catalogue.name}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => onSave({ name, division, tags: chosen })}
          >
            Save the item
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 md:grid-cols-[9rem_1fr]">
          <Thumbnail
            url={line.image}
            fallback="No picture"
            className="aspect-square w-full rounded-card border border-hairline"
          />
          <div className="flex flex-col gap-4">
            <Field label="Name">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                aria-label="Name on this order"
              />
            </Field>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Division">
                <PickOne
                  label="Division"
                  choices={divisions}
                  value={division}
                  onChange={setDivision}
                />
              </Field>

              <Field label="Tags">
                <PickMany
                  label="Tags"
                  choices={tags}
                  values={chosen}
                  onChange={setChosen}
                />
              </Field>
            </div>
          </div>
        </div>
      </div>
    </Sheet>
  )
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
  /// The same discount said as a share of the lines. Held beside the rupiah
  /// rather than derived from it on every render, so a half-typed "1" in the
  /// percent box does not rewrite itself as "1.0" under the cursor.
  const [discountPct, setDiscountPct] = useState("")
  const [termsTemplate, setTermsTemplate] = useState("")
  const [schedule, setSchedule] = useState<PaymentTerm[]>([])
  const [conditions, setConditions] = useState("")
  /// Whether the conditions box is on the glass.
  ///
  /// Folded away until asked for: most orders are a price and a date and
  /// nothing else, and a three-row textarea standing open under every one of
  /// them made the ordinary case look unfinished.
  const [writingConditions, setWritingConditions] = useState(false)
  /// Which half of this sheet is showing — the form, or the order it makes.
  const [step, setStep] = useState<"edit" | "review">("edit")
  /// The two ways to put a line on this order, each its own sheet over this
  /// one. Transient by nature — nobody links to a half-open picker — which is
  /// why they are `useState` and not URL state.
  /// The line whose wording is being edited, by supplier item id.
  ///
  /// A sheet rather than the cell it came from: what a line is CALLED, what
  /// part of the range it is and what it is filed under are three answers, and
  /// three live controls stacked inside one table square is a form pretending
  /// to be a row.
  const [editingLine, setEditingLine] = useState<string | null>(null)
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
  /// What the company has agreed it can agree. Held for five minutes: these
  /// are a few dozen rows that change about once a quarter, and refetching
  /// them every time this sheet opens would be a request to answer a question
  /// nobody asked again.
  const terms = useQuery({
    queryKey: procurementKeys.paymentTerms(),
    queryFn: ({ signal }) => paymentTermsBook(signal),
    staleTime: 5 * 60_000,
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
  const scheduleBps = schedule.reduce((sum, term) => sum + term.bps, 0)

  const reset = () => {
    setArrival("")
    setNotes("")
    setDiscount("")
    setDiscountPct("")
    setTermsTemplate("")
    setSchedule([])
    setConditions("")
    setWritingConditions(false)
    setStep("edit")
    setLines([])
  }

  /// Shutting the sheet, from the × or from Cancel.
  ///
  /// The step goes back with it. Somebody who reached the review, thought
  /// better of the whole order and closed it would otherwise reopen New PO on
  /// the confirmation page of a document with nothing on it.
  const close = () => {
    setStep("edit")
    onClose()
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
    onSuccess: async (receipt) => {
      // Take the ordered lines OUT of the basket.
      //
      // This used to invalidate the basket and trust the server to have
      // emptied it — the comment here said "anything that came from the basket
      // is no longer in it". It never was: `create_catalog_purchase_order`
      // does not touch the basket, so the refetch faithfully returned the same
      // six pieces, and the next person to open it raised the same order
      // again without knowing.
      //
      // Removed one line at a time because that is the only route there is,
      // and only the lines this order actually consumed: a basket can hold
      // two suppliers, and raising one supplier's order must not empty the
      // other's. `clearBasket` is the Empty button's, not this.
      //
      // Failures are swallowed on purpose. The order exists — that is the
      // write that mattered — and a basket line that outlives it is a
      // nuisance somebody can delete, not a reason to show a red banner over
      // a purchase order that went through.
      if (group !== undefined) {
        await Promise.allSettled(
          group.lines.map((line) =>
            removeFromBasket(line.item.supplier_item_id)
          )
        )
      }
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
        onOpenChange={(next) => !next && close()}
        title={step === "edit" ? "New PO" : "Review this order"}
        // The number, not the supplier: the head says which document this is
        // about to be, and the supplier is the first question the form asks.
        id={poNumber}
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
          step === "edit" ? (
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={!ready}
                onClick={() => setStep("review")}
              >
                Review order
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-2">
              {/* Back, not Cancel. The draft is still there and the review is
                  a reading of it, so the way out of this step is into the
                  form — closing the whole sheet from here would throw away an
                  order somebody has just finished checking. */}
              <Button variant="ghost" onClick={() => setStep("edit")}>
                <ChevronLeft />
                Back to editing
              </Button>
              <Button
                variant="primary"
                disabled={raise.isPending}
                onClick={() => raise.mutate()}
              >
                {raise.isPending ? "Creating…" : "Create order"}
              </Button>
            </div>
          )
        }
      >
        <div className="flex flex-col gap-5">
          {raise.isError && (
            <Banner tone="bad">{(raise.error as Error).message}</Banner>
          )}

          {step === "review" ? (
            <OrderReview
              supplier={supplierName}
              arrival={arrival}
              lines={lines}
              divisions={divisionChoices}
              tags={tagChoices}
              gross={gross}
              discountMinor={discountMinor}
              schedule={schedule}
              conditions={conditions}
              notes={notes}
            />
          ) : (
            <>
              {/* Two questions about the order itself, side by side: a form column
            down the middle of a 78rem sheet leaves the right half empty and
            pushes the table — the thing this screen is for — below the fold. */}
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Supplier">
                  <PickOne
                    label="Supplier"
                    choices={
                      basket === undefined
                        ? supplierChoices
                        : basketChoices(basket)
                    }
                    value={supplierId}
                    onChange={setSupplierId}
                    placeholder="Choose a supplier"
                  />
                </Field>

                {/* When it is due. An order with no promised date is one nobody
                can chase, and Outstanding — the screen whose whole job is
                "what has not arrived" — has nothing to measure late against. */}
                <Field label="Expected arrival">
                  {/* `<Day>`, not `<input type="date">`. The native box was
                  tried here on 2026-09-13 and reversed the same day, by the
                  owner who asked for it, on the two counts its own note had
                  already predicted: a click in the middle of the box lands on
                  a segment of the text and opens nothing — only the icon at
                  the right edge opens the calendar — and what it opens is the
                  operating system's own panel, in the operating system's
                  drawing, which nothing in this kit can reach. Hitting both
                  faults inside a day is the argument `ui/day.tsx` makes at the
                  top of its own file. */}
                  <Day
                    value={arrival}
                    onChange={setArrival}
                    placeholder="Choose a date"
                    label="Expected arrival"
                  />
                </Field>
              </div>

              {/* Adding goods without leaving the order. The basket is one way to
              collect them and it is not the only one — a repeat order or a
              supplier on the phone is a list somebody already has in their
              head, and making them walk a catalogue to type it is the long way
              round. Both are dead until there is a supplier, because "what do
              they sell" has no answer before that — shown greyed rather than
              absent, so the two ways in are visible from the moment the sheet
              opens. */}
              <Section
                title="Lines"
                actions={
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
                }
              >
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
                            <col className="w-[5.5rem]" />
                            <col className="w-[9rem]" />
                            <col className="w-[9.5rem]" />
                            <col className="w-[3rem]" />
                          </colgroup>
                          <thead>
                            <tr>
                              <th className={HEAD}>Item</th>
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
                                  {/* What the thing IS, read rather than
                                  typed into. The cell used to hold three live
                                  controls — a name box, a division picker and
                                  a tag picker — stacked in a column 30rem
                                  wide, which put five × buttons and two
                                  chevrons in the one square somebody is trying
                                  to READ. Editing moved to a sheet; this is
                                  now a row you look at and press.

                                  The picture is 36px. At 24 it was a smudge,
                                  and a photograph nobody can make out is not
                                  doing the job a photograph is for. */}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setEditingLine(line.supplierItemId)
                                    }
                                    aria-label={`Edit ${line.catalogue.name} on this order`}
                                    className="flex w-full items-start gap-2.5 py-2 pr-2 pl-2.5 text-left transition-colors hover:bg-soft-2"
                                  >
                                    <Thumbnail
                                      url={line.image}
                                      fallback="—"
                                      className="size-9 shrink-0 rounded-inner"
                                    />
                                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                      <span className="truncate text-[0.875rem] text-ink">
                                        {line.name.trim() === ""
                                          ? line.catalogue.name
                                          : line.name}
                                      </span>
                                      <span className="truncate text-[0.75rem] text-body">
                                        {[
                                          labelled(
                                            divisionChoices,
                                            line.division
                                          ) ?? "Unclassified",
                                          ...line.tags.map(
                                            (one) =>
                                              labelled(tagChoices, one) ?? one
                                          ),
                                        ].join(" · ")}
                                      </span>
                                    </span>
                                  </button>
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
                                    className={cn(
                                      BOX,
                                      "h-full rounded-none border-0 text-right tabular-nums"
                                    )}
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
                                    className={cn(
                                      BOX,
                                      "h-full rounded-none border-0 text-right"
                                    )}
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
                  </>
                )}
              </Section>

              {/* Two ways of saying one number, because that is how it is agreed:
              a supplier says "five percent" and the invoice says
              "Rp 4.450.000". Typing either fills the other, and only the
              rupiah figure is sent — the percentage is a way of arriving at
              it, not a second fact to store and later disagree with.

              Percent is of the LINE TOTAL. There is no tax on this document,
              so ERPNext's "apply on: grand total / net total" has one answer
              here and asking it would be a control with one choice.

              Its own section, and no longer wedged under the lines table
              behind a `lines.length > 0`. The discount is a term of the
              order, not a footnote to the goods — and the form it was hiding
              in changed shape depending on whether anything had been added
              yet, so a buyer who opened a blank order saw a document with a
              different set of questions in it. */}
              <Section title="Discount">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Discount amount">
                    <Money
                      label="Discount agreed off the whole order"
                      value={discount}
                      onChange={(next) => {
                        setDiscount(next)
                        const minor = discountOf(next)
                        setDiscountPct(
                          minor > 0 && gross > 0
                            ? ((minor / gross) * 100)
                                .toFixed(1)
                                .replace(/\.0$/, "")
                            : ""
                        )
                      }}
                      prefix="Rp"
                      placeholder="0"
                    />
                  </Field>

                  <Field label="Discount percentage">
                    <span className="relative flex w-full min-w-0 items-center">
                      <Input
                        aria-label="Discount percentage"
                        inputMode="decimal"
                        value={discountPct}
                        placeholder="0"
                        className="pr-8"
                        onChange={(event) => {
                          const next = event.target.value
                          setDiscountPct(next)
                          const share = Number(next.replace(",", "."))
                          setDiscount(
                            Number.isFinite(share) && share > 0 && gross > 0
                              ? String(Math.round((gross * share) / 100))
                              : ""
                          )
                        }}
                      />
                      <span className="pointer-events-none absolute right-3.5 text-[0.84375rem] text-mute">
                        %
                      </span>
                    </span>
                  </Field>
                </div>

                {/* No totals ladder here — it lives on the review.
                    Three figures that read "Rp 0 / — / Rp 0" for as long as
                    the order is being filled in are not a summary, they are a
                    placeholder standing where an answer will be, and the
                    Amount column above already says what each line comes to.
                    The moment the sum is worth reading is the moment before
                    it is committed, which is the step the review exists for. */}
              </Section>

              {/* Payment terms. The schedule is what this order PROMISES, and it
              is what tells Finance when the bill falls due.

              Drawn, and not yet sent: `CatalogPurchaseOrderRequest` carries a
              number, a supplier, a destination, notes, a discount and the
              lines, and nothing else. Everything in this section is held for
              the review and then dropped on Create. It is asked here because
              it is what a buyer agrees on the phone; making it reach Finance
              is a migration, not a form. The review says so in as many words,
              which is the difference between a control that is early and one
              that lies. */}
              <Section title="Payment terms">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Template">
                    {/* `<Select>`, not the typeahead. Four named templates is a
                    list you read, and a box with a caret blinking in it
                    invites typing that matches nothing — `ui/pick.tsx` says
                    exactly this at the top of its own file. The supplier box
                    above stays a typeahead because that list is hundreds
                    long, and the two now wear one chrome. */}
                    <Select
                      aria-label="Payment terms template"
                      value={termsTemplate}
                      onChange={(code) => {
                        setTermsTemplate(code)
                        setSchedule(scheduleOf(terms.data, code))
                      }}
                    >
                      <option value="">No template — schedule it here</option>
                      {/* Retired templates are not offered. The master screen
                          can see them — a retirement nobody can find is a
                          retirement nobody can undo — but an order being
                          raised today should not be able to agree an
                          arrangement the company has withdrawn. */}
                      {(terms.data?.templates ?? [])
                        .filter((one) => one.active)
                        .map((one) => (
                          <option key={one.code} value={one.code}>
                            {one.label}
                          </option>
                        ))}
                    </Select>
                  </Field>
                </div>

                {/* The schedule as a GRID, the way the lines above are one:
                    a ruled box with a headed row, not five borderless columns
                    floating on the section's own background. Each row is one
                    promise to pay, and a promise with a figure in it deserves
                    the same frame as the goods it pays for. */}
                {schedule.length > 0 && (
                  <div className="overflow-hidden rounded-inner border border-hairline">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[42rem] table-fixed border-collapse">
                        <colgroup>
                          <col className="w-[3rem]" />
                          <col />
                          <col className="w-[9rem]" />
                          <col className="w-[9rem]" />
                          <col className="w-[7rem]" />
                          <col className="w-[10rem]" />
                          <col className="w-[3rem]" />
                        </colgroup>
                        <thead>
                          <tr>
                            <th className={cn(HEAD, "text-right")}>No</th>
                            <th className={HEAD}>Payment term</th>
                            <th className={HEAD}>Due date</th>
                            <th className={HEAD}>Method</th>
                            <th className={cn(HEAD, "text-right")}>Portion</th>
                            <th className={cn(HEAD, "text-right")}>Amount</th>
                            <th className={HEAD}>
                              <span className="sr-only">Remove</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {schedule.map((term, index) => (
                            <tr
                              key={index}
                              className="border-t border-hairline transition-colors hover:bg-soft"
                            >
                              <td
                                className={cn(
                                  CELL,
                                  "px-3 text-right text-[0.8125rem] text-mute tabular-nums"
                                )}
                              >
                                {index + 1}
                              </td>
                              <td className={CELL}>
                                <Input
                                  value={term.label}
                                  aria-label={`Payment term ${index + 1}`}
                                  className={cn(BOX, "h-9")}
                                  onChange={(event) =>
                                    setSchedule((was) =>
                                      was.map((one, at) =>
                                        at === index
                                          ? {
                                              ...one,
                                              label: event.target.value,
                                            }
                                          : one
                                      )
                                    )
                                  }
                                />
                              </td>
                              <td className={CELL}>
                                {/* Pickable, not printed. A due date computed
                                    from a template is a starting guess — the
                                    supplier who said "the rest on the 20th"
                                    named a day, and the row that shows it was
                                    the one thing in this grid nobody could
                                    correct. `clearable={false}`: an instalment
                                    with no due date is not a schedule. */}
                                <Day
                                  value={term.due}
                                  label={`Due date ${index + 1}`}
                                  clearable={false}
                                  placeholder="Pick a day"
                                  onChange={(due) =>
                                    setSchedule((was) =>
                                      was.map((one, at) =>
                                        at === index ? { ...one, due } : one
                                      )
                                    )
                                  }
                                  className={cn(
                                    BOX,
                                    "h-9 min-h-9 text-[0.8125rem] data-[popup-open]:border-transparent"
                                  )}
                                />
                              </td>
                              {/* How this instalment is paid, per row. A
                                  giro is a dated piece of paper and a
                                  transfer clears the same day, and an order
                                  may well use one for the advance and the
                                  other for the balance. Blank is legal: not
                                  everything is agreed at the moment the order
                                  is raised. */}
                              <td className={CELL}>
                                <Select
                                  aria-label={`Method ${index + 1}`}
                                  value={term.method}
                                  onChange={(next) =>
                                    setSchedule((was) =>
                                      was.map((one, at) =>
                                        at === index
                                          ? { ...one, method: next }
                                          : one
                                      )
                                    )
                                  }
                                  className={cn(
                                    BOX,
                                    "h-9 text-[0.8125rem] hover:bg-transparent"
                                  )}
                                >
                                  <option value="">—</option>
                                  {PAYMENT_METHODS.map((one) => (
                                    <option key={one} value={one}>
                                      {one}
                                    </option>
                                  ))}
                                </Select>
                              </td>
                              <td className={CELL}>
                                <Input
                                  type="number"
                                  min={0}
                                  max={100}
                                  value={Math.round(term.bps / 100)}
                                  aria-label={`Portion ${index + 1}`}
                                  className={cn(BOX, "h-9 text-right")}
                                  onChange={(event) =>
                                    setSchedule((was) =>
                                      was.map((one, at) =>
                                        at === index
                                          ? {
                                              ...one,
                                              bps: Math.round(
                                                Number(
                                                  event.target.value || 0
                                                ) * 100
                                              ),
                                            }
                                          : one
                                      )
                                    )
                                  }
                                />
                              </td>
                              <td
                                className={cn(
                                  CELL,
                                  "px-3 text-right text-[0.8125rem] font-medium text-ink tabular-nums"
                                )}
                              >
                                {money(
                                  Math.round(
                                    ((gross - discountMinor) * term.bps) / 10000
                                  )
                                )}
                              </td>
                              <td className={cn(CELL, "text-center")}>
                                <Button
                                  variant="quiet"
                                  size="sm"
                                  aria-label={`Remove payment term ${index + 1}`}
                                  onClick={() =>
                                    setSchedule((was) =>
                                      was.filter((_, at) => at !== index)
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
                )}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setSchedule((was) => [
                        ...was,
                        {
                          label: "On delivery",
                          due: dueOn("DAYS_AFTER_BILL", 30, new Date()),
                          method: "",
                          bps: Math.max(
                            0,
                            10000 - was.reduce((sum, one) => sum + one.bps, 0)
                          ),
                        },
                      ])
                    }
                  >
                    Add a term
                  </Button>
                  {schedule.length > 0 && (
                    <span
                      className={cn(
                        "text-[0.75rem]",
                        scheduleBps === 10000 ? "text-mute" : "text-warn-fg"
                      )}
                    >
                      {scheduleBps === 10000
                        ? "Adds up to 100%"
                        : `${(scheduleBps / 100).toFixed(0)}% of 100% scheduled`}
                    </span>
                  )}
                </div>

                {/* The conditions box, folded away until it is wanted. It opens
                for good once there is something in it: a section that can
                hide text somebody has typed is a section that loses it. */}
                {writingConditions || conditions !== "" ? (
                  <Field label="Terms and conditions">
                    <Textarea
                      rows={3}
                      value={conditions}
                      onChange={(event) => setConditions(event.target.value)}
                      placeholder="What was agreed beyond price and date."
                    />
                  </Field>
                ) : (
                  <div>
                    <Button
                      variant="quiet"
                      onClick={() => setWritingConditions(true)}
                    >
                      <Plus />
                      Terms and conditions
                    </Button>
                  </div>
                )}
              </Section>

              {/* Last, under everything. A note is what somebody writes once the
              order is written — "call the warehouse before the truck leaves" —
              and asking for it above the goods put a free-text box between the
              supplier and the thing being bought. */}
              <Section title="Notes">
                <Textarea
                  rows={2}
                  aria-label="Notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Anything the warehouse should know."
                />
              </Section>
            </>
          )}
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
          <LineEditor
            line={
              lines.find((one) => one.supplierItemId === editingLine) ?? null
            }
            divisions={divisionChoices}
            tags={tagChoices}
            onSave={(change) => {
              if (editingLine !== null) patch(editingLine, change)
              setEditingLine(null)
            }}
            onClose={() => setEditingLine(null)}
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
