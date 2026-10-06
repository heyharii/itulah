import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronLeft, Pencil, Plus, Trash2 } from "lucide-react"
import { useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Day } from "@/components/ui/day"
import { Dialog, SavedDialog } from "@/components/ui/dialog"
import { Field, Input, Money, Select, Textarea } from "@/components/ui/field"
import { PickOne, type Choice } from "@/components/ui/pick"
import { Section } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { ItemsTable } from "@/screens/procurement/items-table"
import { today as todayIso } from "@/lib/calendar"
import { count, day, money } from "@/lib/format"
import { titled } from "@/screens/procurement/po-print"
import { wholeProduct } from "@/lib/decimal"
import {
  itemUnitFactor,
  useUnits,
  type ItemUnitFactor,
} from "@/lib/queries/units"
import {
  cleanPercent,
  discountFromPercent,
  lineTotal,
  markupBps,
  percentFromDiscount,
  percentText,
  percentToBps,
  variantPieces,
  variantsForWire,
  type VariantDraft,
} from "@/screens/procurement/line-pricing-model"
import { toast } from "@/lib/toast"
import { useSupplierName } from "@/screens/procurement/supplier-name"
import {
  catalogueVocabulary,
  createCatalogPurchaseOrder,
  createSupplierItemWithPhoto,
  listSuppliers,
  paymentTermsBook,
  cancelPurchaseOrder,
  procurementKeys,
  removeFromBasket,
  purchaseDestinations,
  reviseCatalogPurchaseOrder,
  supplierDetail,
  type CatalogPurchaseOrderReceipt,
  type PurchaseOrderDetail,
} from "@/lib/queries/procurement"
import {
  ItemFormSheet,
  type LineResult,
  type LineSeed,
} from "@/screens/procurement/item-form"
import { supplierDisplayName } from "@/screens/procurement/supplier-format"
import { SupplierComposer } from "@/screens/procurement/suppliers"
import {
  DEFAULT_TERMS,
  pcs,
  useActor,
  useIdempotencyKey,
  type PendingItem,
} from "@/screens/procurement/shared"
import type { BasketLine, SupplierItem } from "@itulah/contract"
import {
  enqueueOrder,
  removeOrder,
  type OutboxJob,
} from "@/lib/offline/po-outbox"
import { useOnline } from "@/lib/offline/reference"

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
  /// What the item is, in words: the supplier item's, or what was typed on a
  /// new one. A PO line does not carry it, so only a new item's is changed.
  readonly description: string
  division: string | null
  tags: readonly string[]
  quantity: string
  /// The unit the quantity is typed in — PCS, LUSIN, KODI — from the units
  /// master. The order is still in the article's STOCK unit: the quantity is
  /// converted when it is sent (see `piecesOf`), and the price is per stock
  /// unit.
  unit: string
  /// What the linked article counts its stock in (ERPNext `stock_uom`). The
  /// base unit for a line with no article yet — a brand-new item typed onto
  /// this order — since there is nothing else to convert against (0653).
  readonly stockUnitCode: string
  /// The article's own units — a CARTON of THIS item may be 24 while the
  /// global master says something else — read once off the supplier item and
  /// carried on the line so `unitsFor`/`factorFor` never have to ask again.
  readonly articleUnits: readonly ItemUnitFactor[]
  /// True when the line's goods are an article: then only its stock unit and
  /// its own units may be used, as in 7Soft (0657) — the server refuses any
  /// other, so this screen never offers one.
  readonly ownUnitsOnly: boolean
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
  /// The factor an EXISTING order line was placed at, frozen — so re-opening
  /// an order to edit it does not quietly re-price a carton because the
  /// units master moved since it was raised. Only meaningful while `unit`
  /// still names this same unit; choosing a different one falls back to
  /// whatever the master says today. Absent for a line that has not been
  /// raised yet, which has nothing to freeze.
  readonly pinnedUnit?: { readonly code: string; readonly factor: string }
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
  /// How the quantity was said when the same item was added more than once in
  /// different units — "10 kodi + 2 pcs". The line itself then holds the
  /// pieces they come to (the server takes one line per item).
  said?: string
  /// Why an existing order line can no longer be edited — goods received,
  /// or the line closed — or absent when it can. The server also refuses a
  /// line billed or re-priced since; its message lands in the banner.
  readonly locked?: string
}

/// Why an order line is no longer the buyer's to change, read off what the
/// order detail carries — the server's own rule, as far as the detail says it.
function lockOf(
  line: PurchaseOrderDetail["lines"][number]
): string | undefined {
  if (line.line_status !== "OPEN" || line.cancelled_quantity > 0)
    return "This line is closed, so it can no longer be edited."
  if (line.received_quantity > 0 || (line.receipts?.length ?? 0) > 0)
    return "Goods were received against this line, so it can no longer be edited."
  return undefined
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
    description: request.description ?? "",
    division: request.division_code,
    tags: request.tags,
    // What the buyer typed on the item form — the owner asked for the new
    // item's quantity to be entered with it, beside its price.
    quantity:
      pending.unitQuantity ??
      (pending.quantity === undefined ? "" : String(pending.quantity)),
    unit: pending.unitCode ?? BASE_UNIT,
    // A pending item has no article yet, so nothing but the global master to
    // convert against (0653 §3) — the same as the base unit having no units
    // of its own.
    stockUnitCode: BASE_UNIT,
    articleUnits: [],
    ownUnitsOnly: false,
    // Per the unit it was typed in, when that is not pieces; the request
    // beside it carries the per-piece figure that comes to.
    price: pending.unitPrice ?? String(request.unit_price_minor),
    image: null,
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
    description: item.description ?? "",
    division: item.division_code,
    tags: item.tags,
    quantity,
    // A new line starts in what this item is bought in by default (ERPNext
    // `purchase_uom`), else its stock unit, else the base — never a unit
    // nobody asked for.
    unit: item.purchase_unit_code ?? item.stock_unit_code ?? BASE_UNIT,
    stockUnitCode: item.stock_unit_code ?? BASE_UNIT,
    articleUnits: item.article_units,
    ownUnitsOnly: item.stock_unit_code !== null,
    price: String(item.unit_price_minor),
    image: item.image_url,
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
    description: "",
    division: line.division_code,
    tags: line.tags,
    quantity: line.order_unit_quantity ?? String(line.ordered_quantity),
    unit: line.order_unit_code ?? BASE_UNIT,
    // An order line does not carry the article's stock unit or its own units
    // — only what it was raised in, frozen below as `pinnedUnit`. The base
    // unit is the same fallback a line with no article uses; picking a
    // different unit here falls through to the global master.
    stockUnitCode: BASE_UNIT,
    articleUnits: [],
    ownUnitsOnly: false,
    // Per unit when the order was priced that way (0656) — straight off
    // `order_unit_price_minor`, exactly as agreed, rather than the
    // per-piece figure the server derived from it. A line raised before
    // 0656 (or still in its stock unit) has none, and the box holds
    // `unit_price_minor` — per piece — as it always did, converted to the
    // unit it was raised in only for display, at the factor it was raised
    // at, so re-opening the order to edit it does not requote the box in a
    // unit the buyer never priced it in.
    price:
      line.order_unit_price_minor !== null &&
      line.order_unit_price_minor !== undefined
        ? String(line.order_unit_price_minor)
        : (() => {
            const factor =
              line.order_unit_code && line.unit_factor
                ? factorNumber(line.unit_factor)
                : null
            return factor === null
              ? String(line.unit_price_minor)
              : String(Math.round(line.unit_price_minor * factor))
          })(),
    image: line.image_url,
    // The factor the order was placed at, kept as this line's own: an edit
    // must not quietly re-price a carton because the master moved.
    pinnedUnit:
      line.order_unit_code && line.unit_factor
        ? { code: line.order_unit_code, factor: line.unit_factor }
        : undefined,
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
      price: one.base_price_minor === null ? "" : String(one.base_price_minor),
    })),
    locked: lockOf(line),
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

/// A decimal factor string, read as a number — or null when it does not
/// resolve to a usable multiplier. Shared by every place that turns a
/// per-piece price into a per-order-unit one, or back.
function factorNumber(factor: string | null): number | null {
  if (factor === null) return null
  const parsed = Number(factor.trim().replace(",", "."))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/// A line's price, resolved to what its box currently means (0656).
///
/// A stock-unit line's box is per piece, exactly as before. A line ordered
/// in LUSIN or KODI prices the UNIT — "Rp 250.000 per LUSIN", not a piece
/// price nobody quoted — so the box there holds that figure instead, and
/// `perPiece` is derived by dividing out the factor, the same way the
/// server derives it, for the markup math and the catalogue comparison
/// that still work in pieces. `basis` is what the catalogue's own
/// per-piece price comes to at this factor — the box's starting point, and
/// how a fresh line is told from a negotiated one on create.
///
/// Variant lines and lines still in their stock unit have no order-unit
/// price at all: `orderUnit`/`basis` are null and `perPiece` is the box
/// itself, unchanged from before 0656.
function unitPricing(
  line: DraftLine,
  factor: string | null
): { orderUnit: number | null; perPiece: number; basis: number | null } {
  const f = line.variants.length > 0 ? null : factorNumber(factor)
  if (line.unit === line.stockUnitCode || f === null) {
    return {
      orderUnit: null,
      perPiece: whole(line.price, line.catalogue.price),
      basis: null,
    }
  }
  const basis = Math.round(line.catalogue.price * f)
  const orderUnit = whole(line.price, basis)
  return { orderUnit, perPiece: Math.round(orderUnit / f), basis }
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
  // A code the vocabulary has not named yet ("LADIES") reads in Title Case,
  // as the sheet does, never as the raw code.
  return (
    choices.find((one) => one.value === value)?.label ??
    titled(value.toLowerCase())
  )
}

/// Two sets of SKU rows as one: the same colour and size add up.
function joinVariants(
  first: readonly VariantDraft[],
  more: readonly VariantDraft[]
): VariantDraft[] {
  let joined: VariantDraft[] = [...first]
  for (const add of more) {
    const at = joined.findIndex(
      (one) => one.colour === add.colour && one.size === add.size
    )
    joined =
      at < 0
        ? [...joined, add]
        : joined.map((one, index) =>
            index === at
              ? {
                  ...one,
                  quantity: String(
                    (Number.parseInt(one.quantity, 10) || 0) +
                      (Number.parseInt(add.quantity, 10) || 0)
                  ),
                }
              : one
          )
  }
  return joined
}

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
  paymentTerms,
  paymentMethod,
  lines,
  divisions,
  tags,
  gross,
  discountMinor,
  notes,
  conditions,
  piecesOf,
  pricingOf,
  amountOf,
}: {
  piecesOf: PiecesOf
  /// A line's price, resolved to what its box means — per order unit, with
  /// the per-piece figure beside it, or per piece alone. See `unitPricing`.
  pricingOf: (line: DraftLine) => {
    orderUnit: number | null
    perPiece: number
    basis: number | null
  }
  /// What one line comes to — see `lineAmount`, which sums `gross` too, so
  /// the review's own total and each row's own total never disagree.
  amountOf: (line: DraftLine) => number
  supplier: string
  arrival: string
  /// The chosen payment terms template's name; null when none is chosen.
  paymentTerms: string | null
  /// How the order is paid, as a person reads it.
  paymentMethod: string
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
  conditions: string
}) {
  const pieces = lines.reduce((sum, line) => sum + piecesOf(line), 0)
  return (
    <div className="flex flex-col gap-5">
      <Facts>
        <Fact term="Supplier">{supplier === "" ? "—" : supplier}</Fact>
        <Fact term="Delivery Date">{arrival === "" ? "—" : day(arrival)}</Fact>
        {paymentTerms !== null && (
          <Fact term="Payment Terms">{paymentTerms}</Fact>
        )}
        <Fact term="Payment Method">{paymentMethod}</Fact>
      </Facts>

      <Section title={`Items (${lines.length})`} rule={false}>
        <ItemsTable
          rows={lines.map((line) => {
            const { orderUnit, perPiece } = pricingOf(line)
            const name =
              line.name.trim() === "" ? line.catalogue.name : line.name
            return {
              key: line.supplierItemId,
              image: line.image ?? line.preview ?? null,
              name,
              division: line.division,
              colour: line.variants[0]?.colour ?? line.offered.colours[0]?.code,
              filed: [
                labelled(divisions, line.division) ?? "Unclassified",
                ...line.tags.map((one) => labelled(tags, one) ?? one),
              ].join(" · "),
              said:
                line.said ??
                (line.unit !== line.stockUnitCode
                  ? `${whole(line.quantity, 0)} ${line.unit.toLowerCase()}`
                  : null),
              pieces: piecesOf(line),
              price:
                orderUnit === null
                  ? `${money(perPiece)} / pc`
                  : `${money(orderUnit)} / ${line.unit.toLowerCase()}`,
              amount: amountOf(line),
            }
          })}
          totals={{
            pieces,
            gross,
            discount:
              discountMinor === 0
                ? undefined
                : {
                    minor: discountMinor,
                    label: `Discount · ${percentText(percentFromDiscount(discountMinor, gross))} %`,
                    perPiece:
                      pieces > 0 ? Math.round(discountMinor / pieces) : null,
                  },
            grand: gross - discountMinor,
          }}
        />
      </Section>

      {notes.trim() !== "" && (
        <Section title="Notes" rule={false}>
          <p className="text-[0.875rem] leading-[1.375rem] whitespace-pre-wrap text-ink">
            {notes.trim()}
          </p>
        </Section>
      )}

      {conditions.trim() !== "" && (
        <Section title="Terms and Conditions" rule={false}>
          <p className="text-[0.875rem] leading-[1.375rem] whitespace-pre-wrap text-ink">
            {conditions.trim()}
          </p>
        </Section>
      )}
    </div>
  )
}

/// Bring the first problem on a form into view, and put the caret in it.
///
/// A frame late on purpose: a field marks itself invalid through its own
/// context, a render after the problem it was handed.
function showFirstProblem(root: HTMLElement | null) {
  requestAnimationFrame(() => {
    const first = root?.querySelector<HTMLElement>(
      '[id$="-problem"], [data-problem]'
    )
    if (!first) return
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    first.scrollIntoView({
      block: "center",
      behavior: still ? "auto" : "smooth",
    })
    first
      .closest("label")
      ?.querySelector<HTMLElement>("input, textarea, select, button")
      ?.focus({ preventScroll: true })
  })
}

/// What a line still needs before it can be on an order, in the words the
/// Add item sheet says them — empty when it is complete.
///
/// Every one is required (the owner, 2026-09-28): the name, the unit price,
/// the unit and the quantity, the division and at least one tag. A line is
/// only ever added whole, and cannot be changed once it is on the order.
function lineGaps(line: DraftLine, pieces: number, perPiece: number) {
  return {
    name: line.name.trim() === "" ? "Give it a name." : null,
    division: line.division === null ? "Choose a division." : null,
    tags: line.tags.length === 0 ? "Choose at least one tag." : null,
    price: perPiece > 0 ? null : "Fill in the purchase price.",
    quantity: pieces > 0 ? null : "Fill in how many.",
  }
}

type Gaps = ReturnType<typeof lineGaps>

/// Each gap as a word in "Missing division, tags".
const GAP_WORDS: Record<keyof Gaps, string> = {
  name: "name",
  division: "division",
  tags: "tags",
  price: "purchase price",
  quantity: "quantity",
}

/// A line as the order's grid and cards read it.
interface LineView {
  readonly name: string
  /// Division and tags, as one line of words.
  readonly filed: string
  readonly skus: number
  readonly quantity: string
  readonly price: string
  readonly amount: string
  /// What was typed when it was not pieces — "20 lusin" — under the pieces.
  readonly entered: string | null
  /// What the quantity box counts: "kodi", or "pcs".
  readonly unitWord: string
  /// What the price box is per: "kodi", or "pc".
  readonly priceUnit: string
  readonly missing: readonly string[]
  /// Open the Add item sheet on this line, to finish it.
  readonly complete: () => void
}

function gapCount(gaps: Gaps): number {
  return Object.values(gaps).filter((one) => one !== null).length
}

/// The ceilings an order is held to (owner, 2026-10-05); the server holds the
/// same ones (`PO_MAX_LINE_QUANTITY`, `PO_MAX_UNIT_PRICE`, `PO_MAX_ORDER_TOTAL`)
/// and refuses past them whatever this form says.
const MAX_LINE_QUANTITY = 999_999
const MAX_UNIT_PRICE = 99_999_999
const MAX_ORDER_TOTAL = 99_999_999_999

/// What Create PO answers when it kept the order on the device instead of
/// sending it, there being no connection.
const HELD = { held: true } as const

/// The red Cancel PO on the receipt dialog is built and kept, and hidden for now
/// (the owner, 2026-10-05: "hide dulu"). Turn this on to bring it back.
const SHOW_CANCEL_AFTER_CREATE = false

/// What a sent order's form held, for putting it back.
interface Draft {
  readonly lines: readonly DraftLine[]
  readonly arrival: string
  readonly terms: string
  readonly termsChosenFor: string | null
  readonly method: string
  readonly notes: string
  readonly conditions: string
  readonly discount: string
  readonly discountPct: string
  readonly discountBy: "amount" | "percent"
}

export function OrderComposer({
  open,
  basket,
  editing,
  resume,
  onClose,
  onRaised,
  onReopen,
}: {
  open: boolean
  /// An order made with no connection, taken back from the device to be
  /// corrected or sent: the form opens as the buyer left it. Sending it, or
  /// keeping it again, replaces the held one.
  resume?: OutboxJob
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
  /// Opens the sheet again, for the one place this component asks to be: a
  /// new order called back from its receipt comes back as the form it was.
  onReopen?: () => void
}) {
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()
  /// Whether there is a line to head office. Without one, Submit keeps the
  /// order on this device instead of sending it (`hold` below).
  const online = useOnline()
  const actor = useActor()

  const [supplierId, setSupplierId] = useState<string | null>(null)
  /// The order whose figures were last poured into the form, and the
  /// supplier whose basket last was — both set during render, see below.
  const [pouredFor, setPouredFor] = useState<string | undefined>(undefined)
  const [resumedFor, setResumedFor] = useState<string | undefined>(undefined)
  const [basketFor, setBasketFor] = useState<string | null>(null)
  const [lines, setLines] = useState<readonly DraftLine[]>([])
  const [arrival, setArrival] = useState("")
  /// Optional payment terms: a template code, "" for none. Pre-filled from the
  /// supplier's standing terms until the buyer has chosen for this supplier.
  const [terms, setTerms] = useState("")
  const [termsChosenFor, setTermsChosenFor] = useState<string | null>(null)
  /// How the order is paid. Open — "—" — until the buyer says, the way the
  /// supplier form's Legal Form opens (owner, 2026-10-04): a method chosen
  /// for them is a method nobody confirmed.
  const [method, setMethod] = useState("")
  const [notes, setNotes] = useState("")
  /// Terms and conditions, printed on the order. Starts as the default text
  /// and is the buyer's to change for this order.
  const [conditions, setConditions] = useState(DEFAULT_TERMS)
  const [discount, setDiscount] = useState("")
  /// The same discount said as a share of the lines. Held beside the rupiah
  /// rather than derived from it on every render, so a half-typed "1" in the
  /// percent box does not rewrite itself as "1.0" under the cursor.
  const [discountPct, setDiscountPct] = useState("")
  /// Which of the two was typed last: that one is the fact, the other is read
  /// off it — so a percentage keeps meaning the same share when lines change.
  const [discountBy, setDiscountBy] = useState<"amount" | "percent">("amount")
  /// Which half of this sheet is showing — the form, or the order it makes.
  const [step, setStep] = useState<"edit" | "review">("edit")
  /// The two ways to put a line on this order, each its own sheet over this
  /// one. Transient by nature — nobody links to a half-open picker — which is
  /// why they are `useState` and not URL state.
  /// Lines waiting on the Add item sheet: items picked from the catalogue —
  /// several at once come through one after another, `of` counting them —
  /// or one line already on the order that is not whole yet (a basket line
  /// with no division, say), which `replaces` puts back where it was.
  const [toAdd, setToAdd] = useState<{
    readonly lines: readonly DraftLine[]
    readonly of: number
    readonly replaces: string | null
  } | null>(null)
  /// Review was pressed on an order that is not ready: say every gap.
  const [tried, setTried] = useState(false)
  const form = useRef<HTMLDivElement>(null)
  const [creating, setCreating] = useState(false)
  /// Registering a supplier without abandoning the order.
  ///
  /// A buyer with a quote in their hand and a supplier not yet in the book had
  /// two screens to visit and one half-typed order to lose on the way. The +
  /// beside the picker is the same sheet Suppliers raises, over this one, and
  /// what it creates is selected here the moment it exists — so the detour
  /// ends where it started, with the answer already filled in.
  const [addingSupplier, setAddingSupplier] = useState(false)
  /// Closing was asked of an order that holds something typed.
  const [discarding, setDiscarding] = useState(false)
  /// The items whose photograph did not reach the store while this order was
  /// being saved; said once, after the save.
  const photoTroubles = useRef<string[]>([])
  const nameOfSupplier = useSupplierName()
  /// The order the save minted, held in the receipt dialog until it is read.
  /// The sheet itself closes without waiting for the button — the number
  /// outlives it because the dialog portals over the list (or over the order,
  /// when this was an edit).
  const [raised, setRaised] = useState<{
    readonly receipt: CatalogPurchaseOrderReceipt
    /// The form as it was sent, kept for a new order only: the receipt's
    /// Cancel PO puts it back (2026-10-04). Gone with the dialog.
    readonly draft?: Draft
    /// Said at save time, not read from `editing` at render time: by the
    /// time the dialog is up, an edit has already navigated back to the
    /// order and `editing` is gone.
    readonly verb: "created" | "updated"
    /// Items saved without the photograph that was picked for them.
    readonly photoLost: readonly string[]
  } | null>(null)

  // No number here. The server gives the order its number in the same
  // transaction that writes it (`next_po_number`, migration 0385): this
  // screen used to read the book and show the next one, and two buyers with
  // New PO open at once were shown the same number and one was refused. The
  // number arrives on the receipt and is said in the dialog.

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
  /// And only the merchandise ones, the suppliers that have a catalogue — the
  /// utilities and services in the book are paid, not ordered from.
  const supplierChoices = useMemo<Choice[]>(
    () =>
      (suppliers.data ?? [])
        .filter(
          (one) => one.status === "ACTIVE" && one.category === "MERCHANDISE"
        )
        .map((one) => ({
          value: one.supplier_id,
          label: supplierDisplayName(one),
        })),
    [suppliers.data]
  )

  /// Templates are master data; only active ones are offered, plus the one
  /// already on an order being edited even if it has since been retired.
  const termsBook = useQuery({
    queryKey: procurementKeys.paymentTerms(),
    queryFn: ({ signal }) => paymentTermsBook(signal),
    staleTime: 5 * 60 * 1000,
    enabled: open,
  })
  const termChoices = (termsBook.data?.templates ?? []).filter(
    (one) => one.active || one.code === terms
  )
  const termsName =
    terms === ""
      ? null
      : (termChoices.find((one) => one.code === terms)?.label ??
        editing?.payment_terms_name ??
        terms)

  /// The chosen supplier's standing terms, to pre-select. Read from the
  /// supplier's own record so it works for a basket too, where the supplier
  /// list is not fetched.
  const supplierRecord = useQuery({
    queryKey: procurementKeys.supplier(supplierId ?? ""),
    queryFn: ({ signal }) => supplierDetail(supplierId!, signal),
    staleTime: 5 * 60 * 1000,
    enabled: open && supplierId !== null && editing === undefined,
  })
  // Offline the record cannot be read, but the book on the device has the
  // same standing terms.
  const supplierTerms =
    (
      supplierRecord.data ??
      suppliers.data?.find((one) => one.supplier_id === supplierId)
    )?.default_payment_terms_code ?? ""
  // Pre-selected while the buyer has not chosen for this supplier. Set during
  // render, which React settles before painting, rather than in an effect.
  if (
    open &&
    editing === undefined &&
    supplierId !== null &&
    termsChosenFor !== supplierId &&
    terms !== supplierTerms
  )
    setTerms(supplierTerms)

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
  if (open && supplierId === null && basket !== undefined && basket.length > 0)
    setSupplierId(basket[0].supplierId)

  /// The order being edited, poured into the form once per order. Keyed on
  /// the id rather than the object, so the detail refetching behind the sheet
  /// does not throw away what somebody has typed.
  const editingId = open ? editing?.purchase_order_id : undefined
  if (editingId !== pouredFor) {
    setPouredFor(editingId)
    if (editing !== undefined && editingId !== undefined) {
      setSupplierId(editing.supplier_ref_id)
      setLines(editing.lines.map(fromOrderLine))
      setArrival(editing.expected_arrival ?? "")
      setTerms(editing.payment_terms_code ?? "")
      setMethod(editing.payment_method ?? "")
      setNotes(editing.notes ?? "")
      setConditions(editing.terms_and_conditions?.trim() || DEFAULT_TERMS)
      setDiscount(
        editing.discount_minor === 0 ? "" : String(editing.discount_minor)
      )
      setDiscountPct("")
      setDiscountBy("amount")
      setStep("edit")
    }
  }

  /// The basket's lines, whenever the basket being ordered from changes.
  ///
  /// Keyed on the supplier rather than on the array, because the basket query
  /// refetches and hands back a new array of the same lines — reseeding on
  /// that would throw away every edit each time the window regained focus.
  const drop = (id: string) =>
    setLines((was) => was.filter((one) => one.supplierItemId !== id))

  /// The units master, for ordering by the dozen or the kodi. A line may also
  /// carry its OWN units (`articleUnits`, from the linked article — 0653),
  /// which `factorFor`/`unitsFor` below check before falling back to this.
  const units = useUnits()
  const unitChoices = units.units.filter((one) => one.active)
  /// The factor a line's chosen unit converts at, in STOCK units: its
  /// `pinnedUnit`, when the unit chosen is still the one an existing order
  /// line was raised in, else the ERPNext-style lookup — the article's own
  /// unit row first, else the global chain to its stock unit (0653 §3).
  const factorFor = (line: DraftLine) =>
    line.pinnedUnit && line.pinnedUnit.code === line.unit
      ? line.pinnedUnit.factor
      : itemUnitFactor(
          line.unit,
          line.articleUnits,
          units.conversions,
          line.stockUnitCode,
          line.ownUnitsOnly
        )
  /// Pieces a line comes to: its SKU rows added up, or the quantity typed
  /// in its unit times that unit's factor — exactly, so 9.5 KODI is 190 and
  /// never 189.99. Zero when it is not a whole number.
  const piecesOf: PiecesOf = (line) => {
    if (line.variants.length > 0) return variantPieces(line.variants)
    const factor = factorFor(line)
    return factor === null ? 0 : (wholeProduct(line.quantity, factor) ?? 0)
  }
  /// The units one line may be ordered in: its stock unit, its own units, and
  /// every active global unit that chains to that stock unit — computed the
  /// same way the server resolves a catalogue line, so this screen never
  /// offers a unit the server would then refuse.
  const unitsFor = (line: DraftLine) =>
    unitChoices.filter(
      (one) =>
        itemUnitFactor(
          one.code,
          line.articleUnits,
          units.conversions,
          line.stockUnitCode,
          line.ownUnitsOnly
        ) !== null
    )
  /// A line's quantity as it was said: "10 kodi", "2 pcs", or both.
  const wordsOf = (line: DraftLine) => {
    if (line.said !== undefined) return line.said
    if (line.variants.length > 0 || line.unit === line.stockUnitCode)
      return pcs(piecesOf(line))
    const unit = (
      units.units.find((one) => one.code === line.unit)?.label ?? line.unit
    ).toLowerCase()
    return `${line.quantity} ${unit}`
  }
  /// Putting a line on the order. The server takes one line per item, so an
  /// item that is already on it takes the new amount in: 10 kodi and 2 pcs
  /// become one line of 202 pcs that still says "10 kodi + 2 pcs".
  const put = (was: readonly DraftLine[], added: DraftLine): DraftLine[] => {
    const at = was.findIndex(
      (one) => one.supplierItemId === added.supplierItemId
    )
    if (at < 0) return [...was, added]
    const first = was[at]
    if (first.variants.length > 0 || added.variants.length > 0) {
      if (first.variants.length === 0 || added.variants.length === 0) {
        toast.error("Add it by colour and size, as the first one was.")
        return [...was]
      }
      return was.map((one, index) =>
        index === at
          ? { ...one, variants: joinVariants(one.variants, added.variants) }
          : one
      )
    }
    const total = piecesOf(first) + piecesOf(added)
    const { orderUnit, perPiece } = unitPricing(first, factorFor(first))
    const perUnit = Number(factorFor(first))
    // Whole units of the first line's own unit keep its agreed price as it
    // is; only a remainder falls back to pieces at the per-piece price.
    const wholeUnits =
      orderUnit !== null &&
      Number.isInteger(perUnit) &&
      perUnit > 0 &&
      total % perUnit === 0
    const joined: DraftLine = wholeUnits
      ? {
          ...first,
          quantity: String(total / perUnit),
          said: `${wordsOf(first)} + ${wordsOf(added)}`,
        }
      : {
          ...first,
          quantity: String(total),
          unit: first.stockUnitCode,
          price: String(perPiece),
          pinnedUnit: undefined,
          said: `${wordsOf(first)} + ${wordsOf(added)}`,
        }
    return was.map((one, index) => (index === at ? joined : one))
  }
  /// What a line tells the server about its unit, price and SKUs.
  const lineExtras = (line: DraftLine) => {
    const byVariant = line.variants.length > 0
    const inUnit = !byVariant && line.unit !== line.stockUnitCode
    const base = Number.parseInt(line.basePrice, 10)
    return {
      unit_code: inUnit ? line.unit : null,
      unit_quantity: inUnit ? line.quantity.trim().replace(",", ".") : null,
      base_price_minor: Number.isFinite(base) ? base : null,
      markup_bps: markupBps(line.markup),
      variants: byVariant ? variantsForWire(line.variants) : undefined,
    }
  }

  /// A freshly built line, priced for the unit it starts in.
  ///
  /// `fromItem`/`fromPending` know only the catalogue's per-piece figure —
  /// they have no factor to convert with, being plain functions with no
  /// units master to ask. A line that starts in something other than its
  /// stock unit (an item's own `purchase_unit_code`, or a unit typed on a
  /// brand-new item) is re-priced here the moment there is a factor to do
  /// it with, so the box a buyer sees opens already saying "per LUSIN"
  /// rather than quoting the piece price as if it were the carton's.
  const seeded = (line: DraftLine): DraftLine => {
    if (line.unit === line.stockUnitCode) return line
    const f = factorNumber(factorFor(line))
    if (f === null) return line
    return { ...line, price: String(Math.round(line.catalogue.price * f)) }
  }

  // The basket's lines, once per supplier chosen. Keyed on the supplier rather
  // than on the array: the basket query refetches and hands back a new array
  // of the same lines, and reseeding on that would throw away every edit.
  const basketKey =
    basket !== undefined && supplierId !== null ? supplierId : null
  if (basketKey !== basketFor) {
    setBasketFor(basketKey)
    if (basketKey !== null) {
      const chosen = basket?.find((one) => one.supplierId === basketKey)
      setLines(
        chosen === undefined ? [] : chosen.lines.map(fromBasket).map(seeded)
      )
    }
  }

  /// The factor one unit converts at for a line, as the Add item sheet asks
  /// it: the line's pinned factor when that is the unit it was raised in,
  /// else the article's own unit row, else the global chain (0653 §3).
  const factorOf = (line: DraftLine, unit: string) =>
    line.pinnedUnit && line.pinnedUnit.code === unit
      ? line.pinnedUnit.factor
      : itemUnitFactor(
          unit,
          line.articleUnits,
          units.conversions,
          line.stockUnitCode,
          line.ownUnitsOnly
        )

  /// What a line still needs, with its own figures.
  const gapsOf = (line: DraftLine) =>
    lineGaps(line, piecesOf(line), unitPricing(line, factorFor(line)).perPiece)

  /// A line as the grid reads it — every figure already set, nothing to type.
  const lineView = (line: DraftLine): LineView => {
    const { orderUnit, perPiece } = unitPricing(line, factorFor(line))
    const unit = (
      units.units.find((one) => one.code === line.unit)?.label ?? line.unit
    ).toLowerCase()
    const inUnit =
      line.variants.length === 0 && line.unit !== line.stockUnitCode
    return {
      name: line.name.trim() === "" ? line.catalogue.name : line.name,
      filed: [
        labelled(divisionChoices, line.division) ?? "No division",
        ...line.tags.map((one) => labelled(tagChoices, one) ?? one),
      ].join(" · "),
      skus: line.variants.length,
      // The quantity of a PO is always pieces. A line typed in dozens or kodi
      // keeps what was typed as a quiet second line.
      quantity: pcs(piecesOf(line)),
      price:
        orderUnit === null
          ? `${money(perPiece)} / pc`
          : `${money(orderUnit)} / ${unit}`,
      amount: money(lineAmount(line)),
      entered: line.said ?? (inUnit ? `${line.quantity} ${unit}` : null),
      unitWord: inUnit ? unit : line.stockUnitCode.toLowerCase(),
      priceUnit: orderUnit === null ? "pc" : unit,
      missing: (Object.entries(gapsOf(line)) as [keyof Gaps, string | null][])
        .filter(([, gap]) => gap !== null)
        .map(([key]) => GAP_WORDS[key]),
      complete: () =>
        setToAdd({ lines: [line], of: 1, replaces: line.supplierItemId }),
    }
  }

  /// What one line comes to: pieces times the price of the unit it was
  /// agreed in, divided by the pieces in that unit, rounded once to the
  /// rupiah — never by way of a rounded per-piece price. See `lineTotal`.
  const lineAmount = (line: DraftLine): number => {
    const { orderUnit, perPiece } = unitPricing(line, factorFor(line))
    return orderUnit === null
      ? lineTotal(piecesOf(line), perPiece)
      : lineTotal(piecesOf(line), orderUnit, factorFor(line))
  }

  /// The pencil: the line's own sheet, pre-filled. A line goods or a close
  /// already stand against is the server's to keep, and says why.
  const editButton = (
    _line: DraftLine,
    shown: LineView,
    className?: string
  ) => (
    <Button
      variant="quiet"
      aria-label={`Edit ${shown.name}`}
      title={`Edit ${shown.name}`}
      onClick={shown.complete}
      className={className}
    >
      <Pencil />
    </Button>
  )

  /// An order with goods against it: lines, prices and discount are shut.
  const frozen =
    editing !== undefined &&
    editing.lines.some((line) => line.received_quantity > 0)
  const gross = lines.reduce((sum, line) => sum + lineAmount(line), 0)
  /// One discount for the whole order. A percentage is of the lines' total,
  /// to two decimals, and comes to whole rupiah once, here; it never takes
  /// more than the order is worth.
  const discountMinor = Math.min(
    gross,
    discountBy === "percent"
      ? discountFromPercent(gross, percentToBps(discountPct) ?? 0)
      : discountOf(discount)
  )
  const pieces = lines.reduce((sum, line) => sum + piecesOf(line), 0)

  /// Pours an order's form back in.
  const pour = (draft: Draft) => {
    setLines(draft.lines)
    setArrival(draft.arrival)
    setTerms(draft.terms)
    setTermsChosenFor(draft.termsChosenFor)
    setMethod(draft.method)
    setNotes(draft.notes)
    setConditions(draft.conditions)
    setDiscount(draft.discount)
    setDiscountPct(draft.discountPct)
    setDiscountBy(draft.discountBy)
    setStep("edit")
  }
  /// Puts a sent order's form back, for the receipt's Cancel PO.
  const restore = (draft: Draft) => {
    pour(draft)
    onReopen?.()
  }

  const reset = () => {
    setArrival("")
    setTerms("")
    setTermsChosenFor(null)
    setMethod("")
    setNotes("")
    setConditions(DEFAULT_TERMS)
    setDiscount("")
    setDiscountPct("")
    setDiscountBy("amount")
    setStep("edit")
    setLines([])
    setTried(false)
    setToAdd(null)
  }

  /// An order taken back from the device, poured into the form once, the way
  /// an order being edited is: keyed on its id so the list refreshing behind
  /// the sheet does not throw away what has been typed since.
  const resumeId = open ? resume?.id : undefined
  if (resumeId !== resumedFor) {
    setResumedFor(resumeId)
    if (resume !== undefined) {
      const form = resume.form as { supplierId: string; draft: Draft }
      setSupplierId(form.supplierId)
      pour({
        ...form.draft,
        // A photograph's local URL does not outlive the page that made it.
        lines: form.draft.lines.map((line) =>
          line.pending?.photo
            ? { ...line, preview: URL.createObjectURL(line.pending.photo) }
            : line
        ),
      })
    }
  }

  /// Shutting the sheet, from the × or from Cancel.
  ///
  /// The step goes back with it. Somebody who reached the review, thought
  /// better of the whole order and closed it would otherwise reopen New PO on
  /// the confirmation page of a document with nothing on it.
  const close = () => {
    setStep("edit")
    setTried(false)
    setToAdd(null)
    if (editing !== undefined) {
      // An edit abandoned is not a draft to come back to: the next Edit
      // should read the order as it stands, not this half-rewrite of it.
      setSupplierId(null)
      reset()
    }
    onClose()
  }

  /// Something has been typed that closing would lose. An edit is not a draft
  /// (see `close`), and a basket's lines were never typed.
  const dirty =
    editing === undefined &&
    resume === undefined &&
    (arrival !== "" ||
      notes.trim() !== "" ||
      discount !== "" ||
      discountPct !== "" ||
      (basket === undefined && lines.length > 0))
  /// Closing, from the ×, Cancel, Escape or the veil: asked first when it
  /// would lose something.
  const askClose = () => (dirty ? setDiscarding(true) : close())
  const discard = () => {
    setDiscarding(false)
    reset()
    if (basket === undefined) setSupplierId(null)
    close()
  }

  /// What Create PO sends for a new order, from the lines as they stand once
  /// every new item on them exists. One builder for both ways of sending:
  /// now, and from the device later (`hold`) — which is why a line for a new
  /// item may still carry its local `draft:` id here; it is swapped for the
  /// real one when the item is made.
  const newOrderBody = (sent: readonly DraftLine[]) => ({
    po_number: null,
    supplier_id: supplierId!,
    destination_site_id: landing,
    payment_terms_code: terms === "" ? null : terms,
    payment_method: method,
    notes: notes.trim() === "" ? null : notes.trim(),
    terms_and_conditions: conditions.trim() === "" ? null : conditions.trim(),
    discount_minor: discountMinor === 0 ? null : discountMinor,
    lines: sent.map((line) => {
      const name = line.name.trim()
      // Per unit, when this line has one (0656) — and, since there is
      // no catalogue price to compare a NEW order unit figure
      // against, "unchanged" here means "still what the catalogue's
      // own per-piece price comes to at this factor" (`basis`), the
      // same test the per-piece branch makes against
      // `line.catalogue.price`. Either way, unchanged is sent absent,
      // so a line nobody touched does not get an "agreed price"
      // stamped on it.
      const { orderUnit, perPiece, basis } = unitPricing(line, factorFor(line))
      const unchanged =
        orderUnit === null
          ? perPiece === line.catalogue.price
          : orderUnit === basis
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
        unit_price_minor: unchanged ? null : perPiece,
        order_unit_price_minor:
          unchanged || orderUnit === null ? null : orderUnit,
        article_name: name === "" || name === line.catalogue.name ? null : name,
        image_url: line.image,
        division_code:
          line.division === line.catalogue.division ? null : line.division,
        tags: sameTags(line.tags, line.catalogue.tags) ? null : [...line.tags],
      }
    }),
  })

  /// No line to head office: the order is finished here and kept on this
  /// device, to be sent by itself when the connection is back. The buyer has
  /// done everything Create PO asks of them — the keys that make a repeat
  /// harmless are fixed now, and a second tab or a second attempt cannot make
  /// the order twice. Fails loudly if the device would not keep it, so the
  /// form stays open: an order neither sent nor kept is the one thing this
  /// must never be.
  const hold = async (): Promise<void> => {
    const now = new Date().toISOString()
    const drafted = lines.filter((line) => line.pending !== undefined)
    const job: OutboxJob = {
      id: resume?.id ?? crypto.randomUUID(),
      owner: actor,
      created_at: resume?.created_at ?? now,
      updated_at: now,
      idempotency_key: idempotency.key,
      supplier_id: supplierId!,
      supplier_name: supplierName,
      items: drafted.map((line) => ({
        local_id: line.supplierItemId,
        key: line.pending!.key,
        request: line.pending!.request,
        photo: line.pending!.photo,
      })),
      body: newOrderBody(lines),
      line_count: lines.length,
      pieces,
      value_minor: gross - discountMinor,
      arrival: arrival === "" ? null : arrival,
      form: {
        supplierId,
        draft: {
          lines,
          arrival,
          terms,
          termsChosenFor,
          method,
          notes,
          conditions,
          discount,
          discountPct,
          discountBy,
        } satisfies Draft,
      },
      state: "waiting",
      refusal: null,
    }
    try {
      await enqueueOrder(job)
    } catch {
      throw new Error(
        "This device could not keep the order (its storage is full or blocked). Keep this form open and try again when you are online."
      )
    }
  }

  const raise = useMutation({
    // Run whether or not the browser thinks it is online. The default holds a
    // mutation until the connection is back, and this one has its own answer
    // for there being none: keep the order on the device (`hold`).
    networkMode: "always",
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: async () => {
      // No connection: keep the finished order on the device instead.
      if (editing === undefined && !navigator.onLine) {
        await hold()
        return HELD
      }
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
          const { item, photoTrouble } = await createSupplierItemWithPhoto(
            supplierId!,
            line.pending!.request,
            line.pending!.photo,
            supplierCode,
            line.pending!.key
          )
          // The order does not wait on a photograph, but the person is told:
          // a picture that quietly never arrived is worse than one refused.
          if (photoTrouble !== null) photoTroubles.current.push(line.name)
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
            terms_and_conditions:
              conditions.trim() === "" ? null : conditions.trim(),
            discount_minor: discountMinor === 0 ? null : discountMinor,
            // Absent leaves it as it was; null only to take away terms the
            // order had.
            payment_method: method,
            ...(terms !== ""
              ? { payment_terms_code: terms }
              : editing.payment_terms_code
                ? { payment_terms_code: null }
                : {}),
            lines: sent.map((line) => {
              const name = line.name.trim()
              // Per unit, exactly as agreed, when this line has one (0656);
              // `unit_price_minor` still goes along beside it — the
              // per-piece figure it derives to — but the server prices the
              // line by `order_unit_price_minor` and ignores it.
              const { orderUnit, perPiece } = unitPricing(line, factorFor(line))
              return {
                ...lineExtras(line),
                supplier_item_id: line.supplierItemId,
                quantity: Math.max(1, piecesOf(line)),
                promised_date: arrival === "" ? null : arrival,
                unit_price_minor: perPiece,
                order_unit_price_minor: orderUnit,
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
      return createCatalogPurchaseOrder(newOrderBody(sent), idempotency.key)
    },
    onSuccess: async (result) => {
      if ("held" in result) {
        // Kept on the device, not sent: no number, no receipt. The order
        // stands in the list as one that has not been sent yet.
        idempotency.rotate()
        toast.success(
          "Saved on this device. It will be sent when you are back online."
        )
        reset()
        onClose()
        return
      }
      const receipt = result
      if (resume !== undefined) void removeOrder(resume.id)
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
      // The number is said in the middle of the screen and stays until it is
      // read (the owner, 2026-10-04), and the sheet hands over to the list or
      // the order without waiting for the button.
      const photoLost = photoTroubles.current
      photoTroubles.current = []
      if (photoLost.length > 0) {
        toast.error(
          `${photoLost.join(", ")}: the photo could not be saved. Add it from the item.`
        )
      }
      setRaised({
        receipt,
        photoLost,
        verb: editing !== undefined ? "updated" : "created",
        draft:
          editing === undefined
            ? {
                lines,
                arrival,
                terms,
                termsChosenFor,
                method,
                notes,
                conditions,
                discount,
                discountPct,
                discountBy,
              }
            : undefined,
      })
      reset()
      onRaised(receipt)
    },
    // Reread the book on a refusal: whatever was refused, the list behind
    // this sheet may be what changed.
    onError: () => {
      void client.invalidateQueries({ queryKey: procurementKeys.orders() })
    },
  })

  /// What is past a ceiling, said where the order is read — nothing is sent
  /// while there is one, and no total is drawn from numbers this large.
  const limitProblem = (() => {
    for (const line of lines) {
      const pieces = piecesOf(line)
      if (pieces > MAX_LINE_QUANTITY)
        return `A line is at most ${count(MAX_LINE_QUANTITY)} pieces.`
      if (unitPricing(line, factorFor(line)).perPiece > MAX_UNIT_PRICE)
        return `A price is at most ${money(MAX_UNIT_PRICE)} a piece.`
    }
    if (
      lines.reduce((sum, line) => sum + lineAmount(line), 0) > MAX_ORDER_TOTAL
    )
      return `An order comes to at most ${money(MAX_ORDER_TOTAL)}.`
    return null
  })()

  /// A supplier, a delivery date — required since 2026-09-26 — and at least
  /// one line for a positive quantity.
  const ready =
    supplierId !== null &&
    arrival !== "" &&
    method !== "" &&
    limitProblem === null &&
    lines.length > 0 &&
    lines.every((line) => gapCount(gapsOf(line)) === 0)

  /// Review is never greyed out (the owner, 2026-09-28): pressed on an order
  /// that is not ready, it says every gap where it is and brings the first
  /// one into view.
  const review = () => {
    if (ready) {
      setStep("review")
      return
    }
    setTried(true)
    showFirstProblem(form.current)
  }

  /// Everything a sheet opened over this one needs, and the one thing that
  /// stops it opening: an order with no supplier has no catalogue to browse
  /// and no catalogue to add to.
  const supplierChosen = supplierId !== null

  /// The line open in the Add item sheet — the first still waiting.
  const adding = toAdd?.lines[0] ?? null
  /// Past the one showing: add it, or leave it out, and go on to the next.
  const advance = () =>
    setToAdd((was) =>
      was === null || was.lines.length <= 1
        ? null
        : { ...was, lines: was.lines.slice(1) }
    )

  /// A line as the Add item form opens on it: everything it already says,
  /// the price per the unit it is in.
  const seedOf = (line: DraftLine): LineSeed => {
    const index = toAdd === null ? 1 : toAdd.of - toAdd.lines.length + 1
    const priced = unitPricing(line, factorFor(line))
    const price = priced.orderUnit ?? priced.perPiece
    return {
      key: `${line.supplierItemId}:${index}`,
      title:
        toAdd !== null && toAdd.replaces !== null ? "Edit line" : "Add item",
      caption:
        toAdd !== null && toAdd.of > 1
          ? `${line.catalogue.name} · ${index} of ${toAdd.of}`
          : line.catalogue.name,
      name: line.name,
      description: line.description,
      division: line.division,
      tags: line.tags,
      colours: line.offered.colours.map((one) => one.code),
      sizes: line.offered.sizes,
      quantity: line.quantity,
      unit: line.unit,
      price: price > 0 ? String(price) : "",
      markup: line.markup,
      basePrice: line.basePrice,
      variants: line.variants,
      image: line.image,
      draftItem: line.pending !== undefined,
      photo: line.pending?.photo ?? null,
      units: unitsFor(line),
      stockUnit: line.stockUnitCode,
      factorOf: (unit) => factorOf(line, unit),
    }
  }

  /// The line as the form handed it back. A new item's own record follows
  /// what was set on it; a catalogue item keeps its link and its record.
  const edited = (line: DraftLine, got: LineResult): DraftLine => {
    const next: DraftLine = {
      ...line,
      name: got.name,
      division: got.division,
      tags: got.tags,
      quantity: got.quantity,
      unit: got.unit,
      price: got.price,
      markup: got.markup,
      basePrice: got.basePrice,
      variants: got.variants,
      // "10 kodi + 2 pcs" only while it is still what the line says.
      said:
        got.variants.length === 0 &&
        got.quantity === line.quantity &&
        got.unit === line.unit
          ? line.said
          : undefined,
    }
    if (line.pending === undefined) return next
    const label = (code: string) =>
      line.offered.colours.find((one) => one.code === code)?.label ?? code
    const photoChanged = got.photo !== line.pending.photo
    return {
      ...next,
      description: got.description,
      offered: {
        colours: got.colours.map((code) => ({ code, label: label(code) })),
        sizes: got.sizes,
      },
      pending: {
        ...line.pending,
        photo: got.photo,
        request: {
          ...line.pending.request,
          name: got.name,
          description: got.description === "" ? null : got.description,
          unit_price_minor: unitPricing(next, factorFor(next)).perPiece,
          division_code: got.division,
          tags: [...got.tags],
          colour_codes: [...got.colours],
          size_codes: [...got.sizes],
        },
      },
      preview: !photoChanged
        ? line.preview
        : got.photo === null
          ? undefined
          : URL.createObjectURL(got.photo),
    }
  }

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (next) return
          // Escape and the veil reach every sheet that is open, not only the
          // one on top: while another one stands over this, it alone closes.
          if (creating || toAdd !== null || addingSupplier || discarding) return
          askClose()
        }}
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
              <Button variant="ghost" onClick={askClose}>
                Cancel
              </Button>
              <Button variant="primary" onClick={review}>
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
                pending={raise.isPending}
                onClick={() => raise.mutate()}
              >
                {raise.isPending ? "Submitting…" : "Submit"}
              </Button>
            </div>
          )
        }
      >
        <div ref={form} className="flex flex-col gap-5">
          {!online && editing === undefined && (
            <Banner tone="warn">
              You are offline. Submit keeps this order on this device and sends
              it when the connection is back.
            </Banner>
          )}
          {raise.isError && (
            <Banner tone="bad">{(raise.error as Error).message}</Banner>
          )}

          {step === "review" ? (
            <OrderReview
              supplier={supplierName}
              arrival={arrival}
              paymentTerms={termsName}
              paymentMethod={
                method === "TRANSFER"
                  ? "Transfer"
                  : method === "CASH"
                    ? "Cash"
                    : method === "GIRO"
                      ? "Giro"
                      : "—"
              }
              lines={lines}
              divisions={divisionChoices}
              tags={tagChoices}
              gross={gross}
              discountMinor={discountMinor}
              notes={notes}
              conditions={conditions}
              piecesOf={piecesOf}
              pricingOf={(line) => unitPricing(line, factorFor(line))}
              amountOf={lineAmount}
            />
          ) : (
            <>
              {/* Two questions about the order itself, side by side: a form column
            down the middle of a 78rem sheet leaves the right half empty and
            pushes the table — the thing this screen is for — below the fold. */}
              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  label="Supplier"
                  required={editing === undefined}
                  problem={
                    tried && supplierId === null ? "Choose a supplier." : null
                  }
                >
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
                      value={nameOfSupplier(
                        editing.supplier_id,
                        editing.supplier_name,
                        editing.supplier_ref_id
                      )}
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
                      action={
                        // Registering a supplier needs the centre.
                        basket === undefined && online
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
                  label="Delivery Date"
                  required
                  problem={
                    tried && arrival === "" ? "Choose the delivery date." : null
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
                    label="Delivery Date"
                    // Nothing arrives yesterday.
                    notBefore={todayIso()}
                  />
                </Field>

                <Field label="Payment Terms">
                  <Select
                    aria-label="Payment terms"
                    disabled={frozen}
                    value={terms}
                    onChange={(code) => {
                      setTerms(code)
                      setTermsChosenFor(supplierId)
                    }}
                  >
                    <option value="">None</option>
                    {termChoices.map((one) => (
                      <option key={one.code} value={one.code}>
                        {one.label}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field
                  label="Payment Method"
                  required
                  problem={
                    tried && method === "" ? "Choose the payment method." : null
                  }
                >
                  <Select
                    aria-label="Payment method"
                    disabled={frozen}
                    value={method}
                    onChange={setMethod}
                  >
                    <option value="">Choose a method</option>
                    <option value="GIRO">Giro</option>
                    <option value="TRANSFER">Transfer</option>
                    <option value="CASH">Cash</option>
                  </Select>
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
              {limitProblem !== null && (
                <Banner tone="bad">{limitProblem}</Banner>
              )}
              {/* After goods have been received the order is a record of what was
                  bought: only the delivery date and the notes may change
                  (owner, 2026-10-05). */}
              {frozen && (
                <Banner tone="warn">
                  Goods have been received on this order. Only the delivery date
                  and the notes can change.
                </Banner>
              )}
              <fieldset disabled={frozen} className="contents">
                <Section
                  title="Items"
                  rule={false}
                  actions={
                    <div className="flex items-center gap-2">
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
                    <>
                      <EmptyState>
                        {supplierId === null
                          ? "Choose a supplier, then add what is being ordered."
                          : "Nothing on this order yet. Add what is being ordered."}
                      </EmptyState>
                      {tried && (
                        <span data-problem className="text-[0.875rem] text-bad">
                          Add at least one item.
                        </span>
                      )}
                    </>
                  ) : (
                    // The same table as the review and the order's own sheet
                    // (`ItemsTable`), with the pencil and the bin at the end of
                    // each row. Everything about a line was set on the Add item
                    // sheet; the pencil opens it again, and the supplier's own
                    // item code is not a column — eleven digits nobody
                    // recognises.
                    <ItemsTable
                      rows={lines.map((line) => {
                        const shown = lineView(line)
                        return {
                          key: line.supplierItemId,
                          image: line.image ?? line.preview ?? null,
                          name: shown.name,
                          division: line.division,
                          colour:
                            line.variants[0]?.colour ??
                            line.offered.colours[0]?.code,
                          filed: shown.filed,
                          said: shown.entered,
                          pieces: piecesOf(line),
                          price: shown.price,
                          amount: lineAmount(line),
                          // A line that arrived unfinished says what it lacks,
                          // with the way to finish it.
                          more:
                            shown.skus > 0 || shown.missing.length > 0 ? (
                              <>
                                {shown.skus > 0 && (
                                  <span className="text-[0.875rem] text-body">
                                    {`${shown.skus} SKUs`}
                                  </span>
                                )}
                                {shown.missing.length > 0 && (
                                  <span
                                    data-problem
                                    className="flex flex-wrap items-center gap-x-2 text-[0.875rem] text-bad"
                                  >
                                    {`Missing ${shown.missing.join(", ")}`}
                                    <button
                                      type="button"
                                      onClick={shown.complete}
                                      className="font-medium text-accent hover:underline"
                                    >
                                      Complete
                                    </button>
                                  </span>
                                )}
                              </>
                            ) : undefined,
                          actions: (
                            <>
                              {editButton(line, shown)}
                              <Button
                                variant="quiet"
                                aria-label={`Take ${shown.name} off this order`}
                                onClick={() => drop(line.supplierItemId)}
                              >
                                <Trash2 />
                              </Button>
                            </>
                          ),
                        }
                      })}
                      totals={{ pieces, gross }}
                    />
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
                <Section title="Discount" rule={false}>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Discount Amount">
                      <Money
                        label="Discount agreed off the whole order"
                        value={
                          discountBy === "percent"
                            ? discountMinor > 0
                              ? String(discountMinor)
                              : ""
                            : discount
                        }
                        onChange={(next) => {
                          setDiscountBy("amount")
                          setDiscount(next)
                        }}
                        prefix="Rp"
                      />
                    </Field>

                    <Field label="Discount Percentage">
                      <span className="relative flex w-full min-w-0 items-center">
                        <Input
                          aria-label="Discount percentage"
                          inputMode="decimal"
                          value={
                            discountBy === "amount"
                              ? discountMinor > 0
                                ? percentText(
                                    percentFromDiscount(discountMinor, gross)
                                  ).replace(".", ",")
                                : ""
                              : discountPct
                          }
                          className="pr-8 tabular-nums"
                          onChange={(event) => {
                            setDiscountBy("percent")
                            setDiscountPct(cleanPercent(event.target.value))
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
              </fieldset>

              {/* Payment terms are an optional choice at the top of the form
                  (a template from master data, pre-filled from the supplier's
                  standing terms). No terms & conditions here. */}

              {/* Last, under everything. A note is what somebody writes once the
              order is written — "call the warehouse before the truck leaves" —
              and asking for it above the goods put a free-text box between the
              supplier and the thing being bought. */}
              <Section title="Notes" rule={false}>
                <Textarea
                  rows={2}
                  aria-label="Notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </Section>

              {/* Printed under the notes on the order. The default is the
                  receiving hours; change it for this order only. */}
              <Section title="Terms and Conditions" rule={false}>
                <Textarea
                  rows={3}
                  aria-label="Terms and conditions"
                  value={conditions}
                  onChange={(event) => setConditions(event.target.value)}
                />
              </Section>
            </>
          )}
        </div>
      </Sheet>

      <Dialog
        open={discarding}
        onOpenChange={setDiscarding}
        title="Discard This Order?"
        confirm="Discard"
        cancel="Keep editing"
        tone="danger"
        onConfirm={discard}
      >
        Nothing has been saved.
      </Dialog>

      {/* Both open OVER the order, and neither replaces it: the half-written
          document is still there underneath, which is what makes adding a
          fourth line a two-click trip instead of a re-entry. */}
      {supplierId !== null && (
        <>
          {/* The Add item form itself, on the line: a pick from the
              catalogue, the pencil and Complete all open the same sheet as
              New item (the owner, 2026-10-02), and Submit puts the line on
              the order — or back where it stood. */}
          <ItemFormSheet
            open={adding !== null}
            supplierId={supplierId}
            line={adding === null ? undefined : seedOf(adding)}
            onLine={(got) => {
              if (adding === null) return
              const line = edited(adding, got)
              const replaces = toAdd?.replaces ?? null
              setLines((was) =>
                replaces === null
                  ? put(was, line)
                  : was.map((one) =>
                      one.supplierItemId === replaces ? line : one
                    )
              )
              advance()
            }}
            onSkip={
              toAdd !== null && toAdd.lines.length > 1 ? advance : undefined
            }
            onClose={() => setToAdd(null)}
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
            onDraft={(pending, keepOpen) => {
              setLines((was) => put(was, seeded(fromPending(pending))))
              // "Add next item" leaves the form up, empty, for the next one.
              if (!keepOpen) setCreating(false)
            }}
          />
        </>
      )}

      {/* Outside the `supplierId !== null` gate, for the obvious reason: this
          is the sheet somebody opens BECAUSE there is no supplier to choose
          yet. */}
      {/* The whole supplier form, not a four-field quick add (the owner,
          2026-09-28): a supplier registered from an order is the same record
          as one registered from the book. It shows the number it was given
          and closes itself back onto this order. */}
      <SupplierComposer
        open={addingSupplier}
        onClose={() => setAddingSupplier(false)}
        // Selected the moment it exists, while its number is still showing.
        // The list behind the picker is invalidated by the sheet itself, so
        // the new supplier is either already in `supplierChoices` or one
        // refetch away — and `<PickOne>` holds an id, not a label, so the
        // choice survives the gap either way.
        onCreated={(supplier) => setSupplierId(supplier.supplier_id)}
        savedNote="Chosen as this order's supplier."
      />

      {/* The save's receipt, over whatever the sheet handed over to — the
          list for a raised order, the order itself for a saved edit. State
          lives here, not in the screen, because this component outlives the
          close its own `onRaised` performs. */}
      <SavedDialog
        open={raised !== null}
        // A new order can be called back for a few seconds, like a ride: the
        // number stays used, and the order stands in the book as cancelled.
        undo={
          SHOW_CANCEL_AFTER_CREATE &&
          raised !== null &&
          raised.verb === "created"
            ? {
                label: "Cancel PO",
                onClick: async () => {
                  await cancelPurchaseOrder(
                    raised.receipt.purchase_order_id,
                    "Cancelled right after it was created",
                    crypto.randomUUID()
                  )
                  void client.invalidateQueries({
                    queryKey: procurementKeys.orders(),
                  })
                  toast.success(`${raised.receipt.po_number} cancelled`)
                  if (raised.draft !== undefined) restore(raised.draft)
                },
              }
            : undefined
        }
        onOpenChange={(next) => {
          if (!next) setRaised(null)
        }}
        title={
          raised !== null && (
            <>
              {raised.receipt.po_number} {raised.verb}
            </>
          )
        }
      >
        {raised === null
          ? undefined
          : raised.photoLost.length > 0
            ? `${raised.photoLost.join(", ")}: the photo could not be saved. Add it from the item.`
            : raised.verb === "created"
              ? undefined
              : money(raised.receipt.net_minor)}
      </SavedDialog>
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
    label: `${one.supplierName} — ${one.lines.length} ${one.lines.length === 1 ? "line" : "lines"}`,
  }))
}
