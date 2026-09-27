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
import { today as todayIso } from "@/lib/calendar"
import { count, day, money } from "@/lib/format"
import { wholeProduct } from "@/lib/decimal"
import { unitFactor, useUnits } from "@/lib/queries/units"
import { PricingFields, VariantGrid } from "@/screens/procurement/line-pricing"
import {
  markupBps,
  variantPieces,
  variantRows,
  variantsForWire,
  type VariantDraft,
} from "@/screens/procurement/line-pricing-model"
import { cn } from "@/lib/utils"
import {
  catalogueVocabulary,
  createCatalogPurchaseOrder,
  createSupplierItemWithPhoto,
  listSuppliers,
  procurementKeys,
  removeFromBasket,
  purchaseDestinations,
  reviseCatalogPurchaseOrder,
  supplierDetail,
  type CatalogPurchaseOrderReceipt,
  type PurchaseOrderDetail,
} from "@/lib/queries/procurement"
import { ItemFormSheet } from "@/screens/procurement/item-form"
import { CataloguePicker } from "@/screens/procurement/pick-items"
import { supplierDisplayName } from "@/screens/procurement/supplier-format"
import { SupplierComposer } from "@/screens/procurement/suppliers"
import {
  GRID_CELL,
  GRID_HEAD,
  useIdempotencyKey,
  type PendingItem,
} from "@/screens/procurement/shared"
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
  /// The unit the quantity is typed in — PCS, LUSIN, KODI — from the units
  /// master. The order is still in pieces: the quantity is converted when it
  /// is sent (see `piecesOf`), and the price is per piece.
  unit: string
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
  /// A new item typed into this order, not yet in the catalogue: the create
  /// request it becomes when the order is raised. Absent on every line that
  /// came from the catalogue, the basket or sourcing. See `PendingItem`.
  readonly pending?: PendingItem
  /// The pending item's photograph, as a local URL for the thumbnail — the
  /// real one does not exist until the item does.
  readonly preview?: string
  /// The item's own pack sizes, which override the global conversions.
  readonly itemUnits: readonly { unit_code: string; factor: string }[]
  /// The colours and sizes the item comes in — what the SKU grid is made of.
  readonly offered: {
    readonly colours: readonly { code: string; label: string }[]
    readonly sizes: readonly string[]
  }
  /// What it will sell for, and the markup over the purchase price.
  basePrice: string
  markup: string
  /// How many of each colour and size; empty for a line ordered as a whole.
  variants: readonly VariantDraft[]
}

/// A line for an item that does not exist yet. Its id is local and never
/// reaches the server: the line is swapped for the created item's before the
/// order is sent.
function fromPending(pending: PendingItem): DraftLine {
  const request = pending.request
  return {
    supplierItemId: `draft:${pending.key}`,
    catalogue: {
      name: request.name,
      price: request.unit_price_minor,
      division: request.division_code,
      tags: request.tags,
    },
    name: request.name,
    division: request.division_code,
    tags: request.tags,
    // What the buyer typed on the item form — the owner asked for the new
    // item's quantity to be entered with it, beside its price.
    quantity: pending.unitQuantity ?? String(pending.quantity ?? 1),
    unit: pending.unitCode ?? BASE_UNIT,
    price: String(request.unit_price_minor),
    image: null,
    itemUnits: request.units ?? [],
    offered: {
      colours: request.colour_codes.map((code) => ({ code, label: code })),
      sizes: request.size_codes,
    },
    basePrice: pending.basePrice ?? "",
    markup: pending.markup ?? "",
    variants: pending.variants ?? [],
    pending,
    preview:
      pending.photo === null ? undefined : URL.createObjectURL(pending.photo),
  }
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
    unit: BASE_UNIT,
    price: String(item.unit_price_minor),
    image: item.image_url,
    itemUnits: item.units ?? [],
    offered: {
      colours: item.colours.map((one) => ({
        code: one.colour_code,
        label: one.label,
      })),
      sizes: item.size_codes,
    },
    basePrice: "",
    markup: "",
    variants: [],
  }
}

/// A line of an order being edited, as the order holds it.
///
/// Its baseline is the ORDER's wording, not the catalogue's: an edit sends
/// every value explicitly (see the save below), so the baseline only decides
/// what reads as changed on this screen.
function fromOrderLine(line: PurchaseOrderDetail["lines"][number]): DraftLine {
  return {
    supplierItemId: line.supplier_item_id ?? line.po_line_id,
    catalogue: {
      name: line.article_name,
      price: line.unit_price_minor,
      division: line.division_code,
      tags: line.tags,
    },
    name: line.article_name,
    division: line.division_code,
    tags: line.tags,
    quantity: line.order_unit_quantity ?? String(line.ordered_quantity),
    unit: line.order_unit_code ?? BASE_UNIT,
    price: String(line.unit_price_minor),
    image: line.image_url,
    // The factor the order was placed at, kept as this line's own: an edit
    // must not quietly re-price a carton because the master moved.
    itemUnits:
      line.order_unit_code && line.unit_factor
        ? [{ unit_code: line.order_unit_code, factor: line.unit_factor }]
        : [],
    offered: {
      colours: [
        ...new Set(
          (line.variants ?? [])
            .map((one) => one.colour_code)
            .filter((code): code is string => code !== null)
        ),
      ].map((code) => ({ code, label: code })),
      sizes: [
        ...new Set(
          (line.variants ?? [])
            .map((one) => one.size_code)
            .filter((code): code is string => code !== null)
        ),
      ],
    },
    basePrice:
      line.base_price_minor === null || line.base_price_minor === undefined
        ? ""
        : String(line.base_price_minor),
    markup:
      line.markup_bps === null || line.markup_bps === undefined
        ? ""
        : String(line.markup_bps / 100),
    variants: (line.variants ?? []).map((one) => ({
      colour: one.colour_code,
      size: one.size_code,
      quantity: String(one.quantity),
      price:
        one.base_price_minor === null ? "" : String(one.base_price_minor),
    })),
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

/// A box somebody types a number into, inside a grid cell.
///
/// Drawn as a box — border, white, a caret on hover — and not as the bare
/// cell `BOX` makes. The owner's note (2026-09-26): the quantity did not look
/// like something that could be typed into, and on a purchase order it is
/// the one figure that always is.
const TYPED =
  "h-9 rounded-inner border border-hairline-2 bg-canvas px-2.5 text-right text-[0.875rem] tabular-nums hover:border-hairline-strong focus:border-accent"

/// The unit a line starts in, and the one an order is kept in.
const BASE_UNIT = "PCS"

/// How many pieces a line comes to — the quantity typed, in the unit chosen.
type PiecesOf = (line: DraftLine) => number

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
  notes,
  piecesOf,
}: {
  piecesOf: PiecesOf
  supplier: string
  arrival: string
  lines: readonly DraftLine[]
  /// The vocabulary the line pickers were filled from.
  ///
  /// Passed in rather than read again here, because a review printing
  /// `ANAK_LAKI · KAUS_KAKI` under a garment the form two clicks ago called
  /// `Anak Laki-laki · Kaus Kaki` is not the same document being checked — and the one
  /// screen whose whole job is "read this before you commit it" is the last
  /// place to show somebody the storage codes.
  divisions: readonly Choice[]
  tags: readonly Choice[]
  gross: number
  discountMinor: number
  notes: string
}) {
  const pieces = lines.reduce((sum, line) => sum + piecesOf(line), 0)
  return (
    <div className="flex flex-col gap-5">
      <Facts>
        <Fact term="Supplier">{supplier === "" ? "—" : supplier}</Fact>
        <Fact term="Delivery date">
          {arrival === "" ? "—" : day(arrival)}
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
                const quantity = piecesOf(line)
                const typed = whole(line.quantity, 0)
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
                          url={line.image ?? line.preview ?? null}
                          className="size-9 shrink-0 rounded-inner"
                        />
                        <div className="min-w-0">
                          <div className="truncate text-ink">
                            {line.name.trim() === ""
                              ? line.catalogue.name
                              : line.name}
                          </div>
                          <div className="truncate text-[0.875rem] text-body">
                            {filed}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className={cn(READ, "text-right tabular-nums")}>
                      {line.unit === BASE_UNIT ? (
                        quantity
                      ) : (
                        <span className="flex flex-col items-end leading-tight">
                          {`${typed} ${line.unit}`}
                          <span className="text-mute">{`${quantity} pcs`}</span>
                        </span>
                      )}
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
            { label: "Total qty", value: `${count(pieces)} pcs` },
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
  const [pricing, setPricing] = useState({
    purchase: line.price,
    markup: line.markup,
    base: line.basePrice,
  })
  /// The SKU grid, when the item comes in colours or sizes: every SKU they
  /// make, keeping what was already typed.
  const [variants, setVariants] = useState<readonly VariantDraft[]>(() =>
    variantRows(
      line.offered.colours.map((one) => one.code),
      line.offered.sizes,
      line.variants
    )
  )
  const colourLabel = (code: string) =>
    line.offered.colours.find((one) => one.code === code)?.label ?? code

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
            onClick={() =>
              onSave({
                name,
                division,
                tags: chosen,
                price: pricing.purchase,
                markup: pricing.markup,
                basePrice: pricing.base,
                // Only the SKUs with a quantity; none at all orders the line
                // as a whole again.
                variants: variants.filter(
                  (one) => Number.parseInt(one.quantity, 10) > 0
                ),
              })
            }
          >
            Save the item
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 md:grid-cols-[9rem_1fr]">
          <Thumbnail
            url={line.image ?? line.preview ?? null}
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

        <Section title="Price">
          <PricingFields pricing={pricing} onChange={setPricing} />
        </Section>

        {/* Per SKU, when the item comes in colours or sizes: how many of
            each, and a SKU's own price where it is not the base price. */}
        {variants.length > 0 && (
          <Section title="Per SKU">
            <VariantGrid
              variants={variants}
              onChange={setVariants}
              colourLabel={colourLabel}
              basePrice={pricing.base}
            />
          </Section>
        )}
      </div>
    </Sheet>
  )
}

export function OrderComposer({
  open,
  basket,
  editing,
  onClose,
  onRaised,
}: {
  open: boolean
  /// An issued order being rewritten. Present, and the composer opens seeded
  /// from it, the supplier fixed, and Save sends a revision instead of raising
  /// a new order.
  editing?: PurchaseOrderDetail
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
  /// Registering a supplier without abandoning the order.
  ///
  /// A buyer with a quote in their hand and a supplier not yet in the book had
  /// two screens to visit and one half-typed order to lose on the way. The +
  /// beside the picker is the same sheet Suppliers raises, over this one, and
  /// what it creates is selected here the moment it exists — so the detour
  /// ends where it started, with the answer already filled in.
  const [addingSupplier, setAddingSupplier] = useState(false)

  // No number here. The server gives the order its number in the same
  // transaction that writes it (`next_po_number`, migration 0385): this
  // screen used to read the book and show the next one, and two buyers with
  // New PO open at once were shown the same number and one was refused. The
  // number arrives on the receipt and is said in the toast.

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
  /// Active suppliers only: a non-active supplier cannot have an order raised
  /// against it (the owner, 2026-09-26), and the server refuses one anyway.
  const supplierChoices = useMemo<Choice[]>(
    () =>
      (suppliers.data ?? [])
        .filter((one) => one.status === "ACTIVE")
        .map((one) => ({
          value: one.supplier_id,
          label: supplierDisplayName(one),
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

  /// The order being edited, poured into the form once per order. Keyed on
  /// the id rather than the object, so the detail refetching behind the sheet
  /// does not throw away what somebody has typed.
  const editingId = editing?.purchase_order_id
  useEffect(() => {
    if (!open || editing === undefined) return
    setSupplierId(editing.supplier_ref_id)
    setLines(editing.lines.map(fromOrderLine))
    setArrival(editing.expected_arrival ?? "")
    setNotes(editing.notes ?? "")
    setDiscount(
      editing.discount_minor === 0 ? "" : String(editing.discount_minor)
    )
    setDiscountPct("")
    setStep("edit")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingId])

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

  const drop = (id: string) =>
    setLines((was) => was.filter((one) => one.supplierItemId !== id))
  const patch = (id: string, change: Partial<DraftLine>) =>
    setLines((was) =>
      was.map((one) =>
        one.supplierItemId === id ? { ...one, ...change } : one
      )
    )

  /// The units master, for ordering by the dozen or the kodi.
  const units = useUnits()
  const unitChoices = units.units.filter((one) => one.active)
  /// Pieces a line comes to: its SKU rows added up, or the quantity typed
  /// in its unit times that unit's factor for this item — exactly, so 9.5
  /// KODI is 190 and never 189.99. Zero when it is not a whole number.
  const piecesOf: PiecesOf = (line) => {
    if (line.variants.length > 0) return variantPieces(line.variants)
    const factor = unitFactor(
      line.unit,
      line.itemUnits,
      units.conversions,
      units.baseUnit
    )
    return factor === null ? 0 : (wholeProduct(line.quantity, factor) ?? 0)
  }
  /// The units one line may be ordered in.
  const unitsFor = (line: DraftLine) =>
    unitChoices.filter(
      (one) =>
        unitFactor(one.code, line.itemUnits, units.conversions, units.baseUnit) !==
        null
    )
  /// What a line tells the server about its unit, price and SKUs.
  const lineExtras = (line: DraftLine) => {
    const byVariant = line.variants.length > 0
    const inUnit = !byVariant && line.unit !== units.baseUnit
    const base = Number.parseInt(line.basePrice, 10)
    return {
      unit_code: inUnit ? line.unit : null,
      unit_quantity: inUnit ? line.quantity.trim().replace(",", ".") : null,
      base_price_minor: Number.isFinite(base) ? base : null,
      markup_bps: markupBps(line.markup),
      variants: byVariant ? variantsForWire(line.variants) : undefined,
    }
  }

  const gross = lines.reduce(
    (sum, line) =>
      sum + piecesOf(line) * whole(line.price, line.catalogue.price),
    0
  )
  const discountMinor = discountOf(discount)
  const pieces = lines.reduce((sum, line) => sum + piecesOf(line), 0)

  const reset = () => {
    setArrival("")
    setNotes("")
    setDiscount("")
    setDiscountPct("")
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
    if (editing !== undefined) {
      // An edit abandoned is not a draft to come back to: the next Edit
      // should read the order as it stands, not this half-rewrite of it.
      setSupplierId(null)
      reset()
    }
    onClose()
  }

  const raise = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: async () => {
      // The items typed into this order are created first, then the order
      // that lists them. Each one's key was fixed when it was drafted, so a
      // second press after a refused order finds the items it already made
      // instead of making them twice — and the lines are swapped for the real
      // items as soon as they exist, so that second press does not even ask.
      const drafted = lines.filter((line) => line.pending !== undefined)
      let sent = lines
      if (drafted.length > 0) {
        const supplierCode = drafted.some((line) => line.pending!.photo)
          ? (
              await client.fetchQuery({
                queryKey: procurementKeys.supplier(supplierId!),
                queryFn: ({ signal }) => supplierDetail(supplierId!, signal),
              })
            ).supplier_code
          : undefined
        const made = new Map<string, DraftLine>()
        for (const line of drafted) {
          const { item } = await createSupplierItemWithPhoto(
            supplierId!,
            line.pending!.request,
            line.pending!.photo,
            supplierCode,
            line.pending!.key
          )
          // What was typed on the line stays; only the identity and the
          // baseline it is compared against become the real item's.
          made.set(line.supplierItemId, {
            ...fromItem(item, line.quantity),
            name: line.name,
            division: line.division,
            tags: line.tags,
            price: line.price,
            unit: line.unit,
            basePrice: line.basePrice,
            markup: line.markup,
            variants: line.variants,
          })
        }
        sent = lines.map((line) => made.get(line.supplierItemId) ?? line)
        setLines(sent)
        void client.invalidateQueries({
          queryKey: procurementKeys.supplierItems(),
        })
        void client.invalidateQueries({
          queryKey: procurementKeys.supplierCatalogue(supplierId!),
        })
      }
      if (editing !== undefined) {
        // Every value is sent, not only the differences. An edit's baseline is
        // the order, not the catalogue, and "absent" on the wire means "the
        // catalogue's" — so leaving an unchanged price out would quietly put
        // the catalogue's price back on a line somebody negotiated.
        return reviseCatalogPurchaseOrder(
          editing.purchase_order_id,
          {
            notes: notes.trim() === "" ? null : notes.trim(),
            discount_minor: discountMinor === 0 ? null : discountMinor,
            lines: sent.map((line) => {
              const name = line.name.trim()
              return {
                ...lineExtras(line),
                supplier_item_id: line.supplierItemId,
                quantity: Math.max(1, piecesOf(line)),
                promised_date: arrival === "" ? null : arrival,
                unit_price_minor: whole(line.price, line.catalogue.price),
                article_name: name === "" ? line.catalogue.name : name,
                image_url: line.image,
                division_code: line.division,
                tags: [...line.tags],
              }
            }),
          },
          idempotency.key
        )
      }
      return createCatalogPurchaseOrder(
        {
          po_number: null,
          supplier_id: supplierId!,
          destination_site_id: landing,
          notes: notes.trim() === "" ? null : notes.trim(),
          discount_minor: discountMinor === 0 ? null : discountMinor,
          lines: sent.map((line) => {
            const name = line.name.trim()
            const price = whole(line.price, line.catalogue.price)
            return {
              ...lineExtras(line),
              supplier_item_id: line.supplierItemId,
              quantity: Math.max(1, piecesOf(line)),
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
      )
    },
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
      if (editing !== undefined) {
        void client.invalidateQueries({
          queryKey: procurementKeys.order(editing.purchase_order_id),
        })
        setSupplierId(null)
      }
      idempotency.rotate()
      reset()
      onRaised(receipt)
    },
    // Reread the book on a refusal: whatever was refused, the list behind
    // this sheet may be what changed.
    onError: () => {
      void client.invalidateQueries({ queryKey: procurementKeys.orders() })
    },
  })

  /// A supplier, a delivery date — required since 2026-09-26 — and at least
  /// one line for a positive quantity.
  const ready =
    supplierId !== null &&
    arrival !== "" &&
    lines.length > 0 &&
    lines.every((line) => piecesOf(line) > 0)

  /// Everything a sheet opened over this one needs, and the one thing that
  /// stops it opening: an order with no supplier has no catalogue to browse
  /// and no catalogue to add to.
  const supplierChosen = supplierId !== null

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => !next && close()}
        title={
          editing !== undefined
            ? step === "edit"
              ? `Edit ${editing.po_number}`
              : "Review the changes"
            : step === "edit"
              ? "New PO"
              : "Review this order"
        }
        // Said on the review, which is where somebody checks what they are
        // about to issue: there is no number yet, and a guessed one shown
        // here would be a promise the server may not keep.
        caption={
          editing !== undefined
            ? "The warehouse is sent the order as it now reads."
            : step === "review"
              ? "The PO number is given when the order is issued."
              : undefined
        }
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
                {editing !== undefined
                  ? raise.isPending
                    ? "Saving…"
                    : "Save changes"
                  : raise.isPending
                    ? "Creating…"
                    : "Create order"}
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
              notes={notes}
              piecesOf={piecesOf}
            />
          ) : (
            <>
              {/* Two questions about the order itself, side by side: a form column
            down the middle of a 78rem sheet leaves the right half empty and
            pushes the table — the thing this screen is for — below the fold. */}
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Supplier">
                  {/* Registering one is a row at the foot of the list, not a
                      button beside the box: the moment somebody discovers
                      their supplier is not in the book happens while they are
                      reading the list, so that is where the way out stands.

                      Only on the blank order. Raising from a basket, the
                      choice is between the baskets that exist — a supplier
                      with nothing collected under it is not one of them, so
                      registering one here would offer an answer this picker
                      cannot take. */}
                  {/* Fixed on an edit: goods from somebody else are a
                      different order, not this one changed. */}
                  {editing !== undefined ? (
                    <Input
                      value={editing.supplier_name ?? ""}
                      readOnly
                      aria-label="Supplier"
                    />
                  ) : (
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
                      action={
                        basket === undefined
                          ? {
                              label: "Create a new supplier",
                              onSelect: () => setAddingSupplier(true),
                            }
                          : undefined
                      }
                    />
                  )}
                </Field>

                {/* When it is due. An order with no promised date is one nobody
                can chase, and Outstanding — the screen whose whole job is
                "what has not arrived" — has nothing to measure late against. */}
                <Field
                  label={
                    <>
                      Delivery date<span className="ml-0.5 text-bad">*</span>
                    </>
                  }
                >
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
                  {/* One press, and the month is on the glass. A typing box
                      was tried here and taken out again: a date somebody
                      reads off a quotation is FOUND on a calendar faster than
                      it is spelled, and a box that accepts phrases has to
                      explain which phrases. */}
                  <Day
                    value={arrival}
                    onChange={setArrival}
                    placeholder="Choose a date"
                    label="Delivery date"
                    // Nothing arrives yesterday.
                    notBefore={todayIso()}
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
                    {/* The phone: one card per line, read down rather than
                    across. The grid below is five columns with a floor under
                    each, and on a 375px screen it was a table scrolled
                    sideways inside a sheet — at a supplier's counter, with a
                    thumb, typing the quantity they just said out loud. The
                    card keeps the grid's order: what it is, then how many at
                    what price, then what that line comes to. */}
                    <ul className="flex flex-col gap-2.5 md:hidden">
                      {lines.map((line) => {
                        const name =
                          line.name.trim() === ""
                            ? line.catalogue.name
                            : line.name
                        return (
                          <li
                            key={line.supplierItemId}
                            // A line just added rises 4px into place as it
                            // fades in, so the eye finds the new card in the
                            // stack. `@starting-style` plays it once, on
                            // mount — the cards already there do not move.
                            className="overflow-hidden rounded-inner border border-hairline transition-[opacity,translate] duration-200 ease-(--ease-out) starting:translate-y-1 starting:opacity-0 motion-reduce:starting:translate-none"
                          >
                            <div className="flex items-start gap-1">
                              <button
                                type="button"
                                onClick={() =>
                                  setEditingLine(line.supplierItemId)
                                }
                                aria-label={`Edit ${line.catalogue.name} on this order`}
                                className="flex min-w-0 flex-1 items-start gap-2.5 p-2.5 text-left transition-colors hover:bg-soft-2"
                              >
                                <Thumbnail
                                  url={line.image ?? line.preview ?? null}
                                  fallback="—"
                                  className="size-11 shrink-0 rounded-inner"
                                />
                                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                  <span className="line-clamp-2 text-[0.875rem] text-ink">
                                    {name}
                                  </span>
                                  <span className="truncate text-[0.875rem] text-body">
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
                              <Button
                                variant="quiet"
                                aria-label={`Take ${line.catalogue.name} off this order`}
                                onClick={() => drop(line.supplierItemId)}
                                className="mt-1.5 mr-1.5 size-tap shrink-0"
                              >
                                <Trash2 />
                              </Button>
                            </div>
                            <div className="grid grid-cols-[5rem_6.5rem_1fr] gap-2.5 border-t border-hairline p-2.5">
                              <Field label="Qty">
                                <Input
                                  inputMode="decimal"
                                  value={
                                    line.variants.length > 0
                                      ? String(piecesOf(line))
                                      : line.quantity
                                  }
                                  readOnly={line.variants.length > 0}
                                  onChange={(event) =>
                                    patch(line.supplierItemId, {
                                      quantity: event.target.value,
                                    })
                                  }
                                  className="text-right tabular-nums"
                                  aria-label={`Quantity of ${line.catalogue.name}`}
                                />
                              </Field>
                              <Field label="Unit">
                                <Select
                                  aria-label={`Unit of ${line.catalogue.name}`}
                                  value={line.unit}
                                  disabled={line.variants.length > 0}
                                  onChange={(unit) =>
                                    patch(line.supplierItemId, { unit })
                                  }
                                >
                                  {unitsFor(line).map((one) => (
                                    <option key={one.code} value={one.code}>
                                      {one.label}
                                    </option>
                                  ))}
                                </Select>
                              </Field>
                              <Field label="Price / pc">
                                <Money
                                  label={`Unit price of ${line.catalogue.name}`}
                                  value={line.price}
                                  onChange={(price) =>
                                    patch(line.supplierItemId, { price })
                                  }
                                  prefix="Rp"
                                  className="text-right"
                                />
                              </Field>
                            </div>
                            <div className="flex items-center justify-between border-t border-hairline bg-soft px-2.5 py-2 text-[0.875rem]">
                              <span className="text-body">Amount</span>
                              <span className="font-medium text-ink tabular-nums">
                                {money(
                                  piecesOf(line) *
                                    whole(line.price, line.catalogue.price)
                                )}
                              </span>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                    {/* The supplier's own item code is not a column. Eleven digits
                  nobody recognises, repeated down the left of the one table
                  where every other cell is something to read or change. */}
                    {/* Division before Tags: what the thing IS comes before what
                    it is filed under, and the two were the other way round.
                    Division is also narrower now — a picker holding one short
                    word was taking 12rem from the column people actually
                    read. */}
                    <div className="overflow-hidden rounded-inner border border-hairline max-md:hidden">
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
                            <col className="w-[6rem]" />
                            <col className="w-[7.5rem]" />
                            <col className="w-[9rem]" />
                            <col className="w-[9.5rem]" />
                            <col className="w-[3rem]" />
                          </colgroup>
                          <thead>
                            <tr>
                              <th className={HEAD}>Item</th>
                              <th className={cn(HEAD, "text-right")}>Qty</th>
                              <th className={HEAD}>Unit</th>
                              <th className={cn(HEAD, "text-right")}>
                                Price / pc
                              </th>
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
                                className="border-t border-hairline transition-[background-color,opacity] duration-200 ease-(--ease-out) hover:bg-soft starting:opacity-0"
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
                                      url={line.image ?? line.preview ?? null}
                                      fallback="—"
                                      className="size-9 shrink-0 rounded-inner"
                                    />
                                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                      <span className="truncate text-[0.875rem] text-ink">
                                        {line.name.trim() === ""
                                          ? line.catalogue.name
                                          : line.name}
                                      </span>
                                      <span className="truncate text-[0.875rem] text-body">
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
                                      {line.variants.length > 0 && (
                                        <span className="truncate text-[0.875rem] text-accent">
                                          {`${line.variants.filter((one) => Number.parseInt(one.quantity, 10) > 0).length} SKUs · edit to change`}
                                        </span>
                                      )}
                                    </span>
                                  </button>
                                </td>
                                <td className={cn(CELL, "px-1.5")}>
                                  {/* A line broken down by SKU is counted by
                                      its grid; the total stands here, and the
                                      line's editor changes it. */}
                                  <Input
                                    inputMode="decimal"
                                    value={
                                      line.variants.length > 0
                                        ? String(piecesOf(line))
                                        : line.quantity
                                    }
                                    readOnly={line.variants.length > 0}
                                    onChange={(event) =>
                                      patch(line.supplierItemId, {
                                        quantity: event.target.value,
                                      })
                                    }
                                    className={cn(
                                      TYPED,
                                      line.variants.length > 0 &&
                                        "bg-soft text-body",
                                      line.variants.length === 0 &&
                                        piecesOf(line) === 0 &&
                                        line.quantity.trim() !== "" &&
                                        "border-bad"
                                    )}
                                    aria-label={`Quantity of ${line.catalogue.name}`}
                                  />
                                </td>
                                {/* The unit the quantity is typed in. A dozen
                                    is sent as twelve pieces; the grid says so
                                    under the amount. */}
                                <td className={cn(CELL, "px-1.5")}>
                                  <Select
                                    aria-label={`Unit of ${line.catalogue.name}`}
                                    value={line.unit}
                                    disabled={line.variants.length > 0}
                                    onChange={(unit) =>
                                      patch(line.supplierItemId, { unit })
                                    }
                                    className="h-9"
                                  >
                                    {unitsFor(line).map((one) => (
                                      <option key={one.code} value={one.code}>
                                        {one.label}
                                      </option>
                                    ))}
                                  </Select>
                                </td>
                                <td className={cn(CELL, "px-1.5")}>
                                  <Money
                                    label={`Unit price of ${line.catalogue.name}`}
                                    value={line.price}
                                    onChange={(price) =>
                                      patch(line.supplierItemId, { price })
                                    }
                                    className={TYPED}
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
                                    "px-3 text-right text-[0.875rem] font-medium text-ink tabular-nums"
                                  )}
                                >
                                  <span className="flex flex-col items-end leading-tight">
                                    {money(
                                      piecesOf(line) *
                                        whole(line.price, line.catalogue.price)
                                    )}
                                    {line.unit !== units.baseUnit && (
                                      <span className="font-normal text-mute">
                                        {`${count(piecesOf(line))} pcs`}
                                      </span>
                                    )}
                                  </span>
                                </td>
                                <td className={cn(CELL, "text-center")}>
                                  <Button
                                    variant="quiet"
                                    size="sm"
                                    aria-label={`Take ${line.catalogue.name} off this order`}
                                    onClick={() => drop(line.supplierItemId)}
                                  >
                                    <Trash2 />
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          {/* The two totals the owner asked to see while the
                              order is being written, under the columns they
                              add up. */}
                          <tfoot>
                            <tr className="border-t border-hairline bg-soft">
                              <td className="px-3 py-2.5 text-[0.875rem] font-medium text-body">
                                Total
                              </td>
                              <td className="px-3 py-2.5 text-right text-[0.875rem] font-medium text-ink tabular-nums">
                                {count(pieces)}
                              </td>
                              <td className="px-3 py-2.5 text-[0.875rem] text-body">
                                pcs
                              </td>
                              <td />
                              <td className="px-3 py-2.5 text-right text-[0.875rem] font-medium text-ink tabular-nums">
                                {money(gross)}
                              </td>
                              <td />
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                    {/* The phone's cards carry no footer row, so the same two
                        figures stand under them. */}
                    <div className="flex items-center justify-between rounded-inner border border-hairline bg-soft px-3 py-2.5 text-[0.875rem] md:hidden">
                      <span className="text-body">
                        Total qty{" "}
                        <span className="font-medium text-ink tabular-nums">
                          {count(pieces)}
                        </span>
                      </span>
                      <span className="font-medium text-ink tabular-nums">
                        {money(gross)}
                      </span>
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
                      <span className="pointer-events-none absolute right-3.5 text-[0.875rem] text-mute">
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

              {/* No payment terms and no terms & conditions here. Payment is
                  Finance's to arrange on the order (the owner, 2026-09-26),
                  and the templates it chooses from are master data. */}

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
            // Drafted, not saved: the item is created with the order, so an
            // order abandoned here leaves nothing in the catalogue.
            onDraft={(pending) => {
              setLines((was) => [...was, fromPending(pending)])
              setCreating(false)
            }}
          />
        </>
      )}

      {/* Outside the `supplierId !== null` gate, for the obvious reason: this
          is the sheet somebody opens BECAUSE there is no supplier to choose
          yet. */}
      <SupplierComposer
        quick
        open={addingSupplier}
        onClose={() => setAddingSupplier(false)}
        // Selected the moment it exists. The list behind the picker is
        // invalidated by the sheet itself, so by the time this runs the new
        // supplier is either already in `supplierChoices` or one refetch away
        // — and `<PickOne>` holds an id, not a label, so the choice survives
        // the gap either way.
        onCreated={(supplier) => {
          setSupplierId(supplier.supplier_id)
          setAddingSupplier(false)
        }}
      />
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
