import { useNavigate } from "@tanstack/react-router"
import { Plus, ShoppingBasket, Trash2 } from "lucide-react"
import { useMemo } from "react"
import type {
  AddToBasketRequest,
  BasketLine,
  CatalogPurchaseOrderRequest,
  SetBasketQuantityRequest,
  SourcedItem,
} from "@itulah/contract"

import { Button } from "@/kit/button"
import { SearchField } from "@/kit/field"
import { PageHead, Toolbar } from "@/kit/page"
import { Sheet } from "@/kit/sheet"
import { Tabs } from "@/kit/tabs"
import { Empty, Failed, Loading } from "@/kit/state"
import { amount, count, day, rp } from "@/lib/format"
import { api } from "@/lib/api"
import { useCursorList } from "@/lib/list"
import { guarded, useIdempotency, useWrite } from "@/lib/mutate"
import { useQueryState } from "@/lib/query-state"
import { useDebounced } from "@/lib/use-debounced"

import { Field, Fields, Numeric, PickOne, Text } from "@/modules/procurement/form"
import { nextPoNumber, whole } from "@/modules/procurement/labels"
import { Ladder, LinkButton, Quiet, Refused, Thumb } from "@/modules/procurement/parts"
import {
  useBasket,
  useDestinations,
  useOrderBook,
} from "@/modules/procurement/reads"
import {
  keys,
  unpackCatalogue,
  type CatalogPurchaseOrderReceipt,
} from "@/modules/procurement/wire"

/// Raising a purchase order.
///
/// ## The draft is not in this component
///
/// Not one field of it. The LINES are the caller's basket, grouped to the one
/// supplier this order is for — so they are on the server, and adding one,
/// changing a quantity or taking one out is a write the server acknowledged
/// before the screen believes it. Everything else — which supplier, which step,
/// where it lands, the promised date, the discount, the note — is in the URL.
///
/// There is therefore no state in this file at all, and the reason is the
/// failure it removes rather than tidiness: **a half-written order survives a
/// reload, a closed tab, a machine going to sleep and a second desk**, and
/// "the draft silently lost a line" is not a thing that can happen here. The
/// old screen held a `DraftLine[]` in `useState` seeded from the basket by an
/// effect, and the effect's own comment explains that reseeding on the wrong
/// dependency would throw away every edit each time the window regained focus.
///
/// ## Two steps, and they are in the URL for the same reason
///
/// Lines, then Review. A step is not a mode toggle — it is which half of the
/// document somebody is looking at, and it is linkable: "have a look at what I
/// am about to send" is a message a buyer wants to send.
///
/// ## What this screen does NOT let anybody change, and why
///
/// `CatalogPurchaseLineRequest` accepts a per-line override of the name, the
/// price, the division and the tags — a real feature, because a scraped
/// supplier catalogue goes stale between the day something is picked out and
/// the day it is ordered, and raising the order is the one moment somebody has
/// the quote and the goods in mind at once.
///
/// They are not offered here, and it is a deliberate omission rather than an
/// unfinished one. **Those overrides have no durable home.** Nothing stores
/// them until the order is raised: the basket has a quantity column and nothing
/// else, and there is no draft-order endpoint. Holding a twelve-row editable
/// grid in component state would put the module's one genuinely losable thing
/// back in memory, next to a basket that is deliberately not — and the loss
/// would be silent, because nothing on the page would say the price somebody
/// typed is the price the server will now ignore.
///
/// What would fix it is small and belongs on the server: either columns on
/// `sourcing_basket_line` for the four overrides, or a draft purchase order
/// with lines. Until one exists, the price on the order is the catalogue's, and
/// a price that has moved is corrected on Catalogue — where it is a fact about
/// the item rather than a fact about one order.
///
/// ## What a failure leaves behind
///
/// The order is created first and the consumed basket lines are removed
/// afterwards, in that order, because it is the safe direction to fail in: a
/// leftover basket line is a nuisance somebody deletes, a lost order is a
/// purchase nobody made. `create_catalog_purchase_order` does not touch the
/// basket — the old screen's comment claimed it did, and the refetch faithfully
/// returned the same six pieces so the next person raised the same order again
/// — so the removals are this screen's job, one line at a time because that is
/// the only route there is, and only for the lines THIS order consumed: a
/// basket can hold two suppliers.
///
/// A removal that fails is swallowed. The order exists, which is the write that
/// mattered, and a red banner over a purchase order that went through is worse
/// than a basket line somebody has to delete.

export function ComposeScreen() {
  const url = useQueryState()
  const navigate = useNavigate()
  const supplierId = url.one("supplier")
  const step = url.one("step") || "lines"
  const pick = url.one("pick")

  const basket = useBasket()
  const destinations = useDestinations()
  // The whole book, for the next number in it. It is the same cache entry the
  // order book screen is reading, so nine times out of ten this is a hit.
  const book = useOrderBook({})

  const lines = useMemo(
    () =>
      basket.rows.filter((line) => line.supplier.supplier_id === supplierId),
    [basket.rows, supplierId],
  )
  const supplier = lines[0]?.supplier

  /// Every supplier with something in the basket, which is the list of orders
  /// that could be raised right now.
  const choices = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; lines: number }>()
    for (const line of basket.rows) {
      const id = line.supplier.supplier_id
      const held = seen.get(id)
      if (held) held.lines += 1
      else seen.set(id, { id, name: line.supplier.name, lines: 1 })
    }
    return [...seen.values()]
  }, [basket.rows])

  const poNumber = useMemo(
    () => nextPoNumber(book.data?.rows ?? []),
    [book.data],
  )

  /// Where the goods land. A warehouse by default — a full container routed to
  /// a shop is the unusual case and should be chosen rather than arrived at.
  const fallbackSite =
    destinations.rows.find((one) => one.node_role === "DC")?.site_id ??
    destinations.rows[0]?.site_id ??
    ""
  const dest = url.one("dest") || fallbackSite

  const promised = url.one("promised")
  const note = url.one("note")
  const discount = whole(url.one("discount"), 0)

  const gross = lines.reduce(
    (sum, line) => sum + line.quantity * line.item.unit_price_minor,
    0,
  )
  const net = Math.max(gross - discount, 0)

  const idempotency = useIdempotency()

  const raise = useWrite<void, CatalogPurchaseOrderReceipt>({
    send: async () => {
      const request: CatalogPurchaseOrderRequest = {
        po_number: poNumber,
        supplier_id: supplierId,
        destination_site_id: dest,
        notes: note.trim() === "" ? null : note.trim(),
        discount_minor: discount === 0 ? null : discount,
        lines: lines.map((line) => ({
          supplier_item_id: line.item.supplier_item_id,
          quantity: line.quantity,
          // One date, stamped on every line. The wire carries it per line
          // because a supplier may promise half an order for March and the
          // rest for April, and the DC's outstanding list reads it line by
          // line — but nobody has asked for two dates on one order, and a date
          // box on every row would be twelve controls answering one question.
          promised_date: promised === "" ? null : promised,
          // Absent means "the catalogue's price", which is the only price this
          // screen can honestly send — see the note at the top. Echoing the
          // catalogue's own figure back would record an agreed price on every
          // line of every order and make the column that exists to flag
          // negotiated prices meaningless.
          unit_price_minor: null,
          article_name: null,
          // Copied off the item rather than overridden. It was hardcoded
          // `null` on every order the old screen raised, so orders reached the
          // DC as a list of words and a warehouse checking a carton against
          // one had nothing to look at.
          image_url: line.item.image_url,
          division_code: null,
          tags: null,
        })),
      }

      const receipt = await api.post<CatalogPurchaseOrderReceipt>(
        "/api/v1/purchase-orders/catalog",
        request,
        undefined,
        // Held across retries, so a double-clicked button raises one order and
        // is answered with the same receipt twice. See `lib/mutate.ts`.
        guarded(idempotency.key),
      )

      // Only the lines this order consumed, and failures swallowed — see the
      // note at the top of this file.
      await Promise.allSettled(
        lines.map((line) =>
          api.post(
            `/api/v1/sourcing-basket/${encodeURIComponent(line.item.supplier_item_id)}/remove`,
            {},
          ),
        ),
      )
      return receipt
    },
    settles: () => [keys.orders, keys.basket],
    onDone: (receipt) => {
      idempotency.rotate()
      // One navigation, to the record. The order book is where an order lives,
      // and landing on it with the sheet open is the receipt — a banner on a
      // screen somebody is about to leave is a receipt nobody reads.
      //
      // `as never` for the reason `kit/app-link.tsx` gives once: this app's
      // route tree is built from the navigation registry in a loop, so the
      // router's literal-path union collapses and the guarantee is the
      // registry's rather than the type's.
      void navigate({
        to: "/procurement" as never,
        search: { order: receipt.purchase_order_id } as never,
      })
    },
    // A refused order is usually a refused NUMBER — somebody raised one while
    // this was open. Rereading the book is what offers the next press a free
    // one, which is the only way out now that nobody types a number by hand.
    onFailed: () => void book.refetch(),
  })

  const ready =
    supplierId !== "" &&
    lines.length > 0 &&
    dest !== "" &&
    poNumber !== "" &&
    !raise.pending

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        module="Procurement"
        title="New order"
        description={
          supplier
            ? `A purchase order for ${supplier.name}, from what is in the basket under their name.`
            : "A purchase order is for one supplier. Pick whose."
        }
        action={
          <LinkButton to="/procurement/basket">
            <ShoppingBasket className="size-4" /> The whole basket
          </LinkButton>
        }
      />

      {raise.problem !== null && <Refused problem={raise.problem} />}

      {supplierId === "" ? (
        <ChooseSupplier
          choices={choices}
          pending={basket.query.isPending}
          onChoose={(id) => url.set({ supplier: id }, false)}
        />
      ) : (
        <>
          <Tabs
            label="Which half of the order"
            value={step}
            onChange={(value) => url.set({ step: value }, false)}
            tabs={[
              { value: "lines", label: "Lines", count: lines.length },
              { value: "review", label: "Review & send" },
            ]}
          />

          {step === "lines" ? (
            <Lines
              lines={lines}
              pending={basket.query.isPending}
              error={basket.query.isError ? basket.query.error : null}
              onRetry={() => void basket.query.refetch()}
              onPick={() => url.set({ pick: "1" }, false)}
            />
          ) : (
            <Review
              poNumber={poNumber}
              dest={dest}
              destinations={destinations.rows}
              promised={promised}
              note={note}
              discountText={url.one("discount")}
              gross={gross}
              discount={discount}
              net={net}
              lineCount={lines.length}
              pieces={lines.reduce((sum, line) => sum + line.quantity, 0)}
              onField={(patch) => url.set(patch, false)}
              ready={ready}
              pending={raise.pending}
              onRaise={() => raise.run()}
            />
          )}
        </>
      )}

      <PickPanel
        open={pick === "1"}
        supplierId={supplierId}
        supplierName={supplier?.name ?? ""}
        onClose={() => url.set({ pick: null, pq: null }, false)}
      />
    </div>
  )
}

/// Whose order this is.
///
/// The list is the baskets that EXIST, rather than every supplier: an order
/// raised from the catalogue needs lines, the lines come from the basket, and
/// offering a supplier with an empty basket is offering a document with nothing
/// on it. Somebody who wants to order from a supplier they have picked nothing
/// from goes shopping first, which is one click away and is what the empty
/// state says.
function ChooseSupplier({
  choices,
  pending,
  onChoose,
}: {
  choices: readonly { id: string; name: string; lines: number }[]
  pending: boolean
  onChoose: (id: string) => void
}) {
  if (pending) return <Loading rows={4} cols={2} />
  if (choices.length === 0) {
    return (
      <Empty
        what="baskets to order from"
        detail="An order is raised from what has been picked out, and nothing has been. Sourcing is every supplier's catalogue in one place."
      />
    )
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {choices.map((choice) => (
        <button
          key={choice.id}
          type="button"
          onClick={() => onChoose(choice.id)}
          className="border-line hover:bg-hover flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors"
        >
          <span className="text-cell text-ink min-w-0 flex-1 truncate font-medium">
            {choice.name}
          </span>
          <span className="text-ctl text-ink-3 shrink-0 tabular-nums">
            {count(choice.lines)} {choice.lines === 1 ? "line" : "lines"} in the
            basket
          </span>
        </button>
      ))}
    </div>
  )
}

/// What is on the order, which is what is in the basket under this supplier.
///
/// Read-only here, and that is the whole design: the quantities are edited on
/// the Basket screen, which is the one place a basket line is written. Two
/// screens that both write a quantity would be two ideas of what the number
/// means the moment one of them is optimistic.
function Lines({
  lines,
  pending,
  error,
  onRetry,
  onPick,
}: {
  lines: readonly BasketLine[]
  pending: boolean
  error: unknown
  onRetry: () => void
  onPick: () => void
}) {
  return (
    <>
      <Toolbar
        trailing={`${count(lines.reduce((sum, line) => sum + line.quantity, 0))} pieces`}
      >
        <Button icon={<Plus className="size-4" />} onClick={onPick}>
          Add from this supplier's catalogue
        </Button>
        <LinkButton to="/procurement/basket">
          <Trash2 className="size-4" /> Change quantities in the basket
        </LinkButton>
      </Toolbar>

      {error !== null ? (
        <Failed what="the basket" error={error} onRetry={onRetry} />
      ) : pending ? (
        <Loading rows={4} cols={4} />
      ) : lines.length === 0 ? (
        <Empty
          what="lines on this order"
          detail="Nothing of this supplier's is in the basket any more. Add something from their catalogue, or pick a different supplier."
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {lines.map((line) => (
            <div
              key={line.item.supplier_item_id}
              className="border-line flex items-center gap-3 border-b px-4 py-2.5"
            >
              <Thumb
                url={line.item.image_url}
                alt={line.item.name}
                className="size-10"
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-cell text-ink truncate">
                  {line.item.name}
                </span>
                <span className="text-label text-ink-4 truncate font-mono">
                  {line.item.supplier_item_code}
                </span>
              </span>
              <span className="text-ctl text-ink-3 w-32 shrink-0 text-right tabular-nums">
                {count(line.quantity)} × {amount(line.item.unit_price_minor)}
              </span>
              <span className="text-cell text-ink w-32 shrink-0 text-right font-medium tabular-nums">
                {amount(line.quantity * line.item.unit_price_minor)}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

/// Everything about the order that is not a line, and the one button that sends
/// it.
function Review({
  poNumber,
  dest,
  destinations,
  promised,
  note,
  discountText,
  gross,
  discount,
  net,
  lineCount,
  pieces,
  onField,
  ready,
  pending,
  onRaise,
}: {
  poNumber: string
  dest: string
  destinations: readonly { site_id: string; label: string; node_role: string }[]
  promised: string
  note: string
  discountText: string
  gross: number
  discount: number
  net: number
  lineCount: number
  pieces: number
  onField: (patch: Record<string, string | null>) => void
  ready: boolean
  pending: boolean
  onRaise: () => void
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <Fields>
        <Field
          label="PO number"
          hint="Read from the book, not typed. It is a suggestion and nothing reserves it — if somebody else takes it first this order is refused and the next press is offered a free one."
        >
          <Text value={poNumber} onChange={() => {}} mono disabled />
        </Field>

        <Field
          label="Where it lands"
          hint="The server requires one. A warehouse by default; routing a full container to a shop is the unusual case."
        >
          <PickOne
            value={dest}
            onChange={(value) => onField({ dest: value })}
            empty="Choose a destination"
            choices={destinations.map((one) => ({
              value: one.site_id,
              label: `${one.label} — ${one.node_role}`,
            }))}
          />
        </Field>

        <Field
          label="Promised arrival"
          hint="One date, stamped on every line. Leave it empty when nobody has promised anything — a made-up date is what the whole of Outstanding is measured against."
        >
          <input
            type="date"
            value={promised}
            onChange={(event) => onField({ promised: event.target.value })}
            className="h-ctl rounded-ctl border-line-2 bg-canvas shadow-btn text-ctl text-ink focus:border-blue w-full min-w-0 border px-2.5 outline-none"
          />
        </Field>

        <Field
          label="Discount on the whole order"
          hint="Whole rupiah off the order, not off a line — that is how it is negotiated and how an invoice states it."
        >
          <Numeric
            value={discountText}
            onChange={(value) => onField({ discount: value || null })}
            unit="Rp"
            placeholder="0"
          />
        </Field>

        <Field
          label="Note"
          wide
          hint="It travels to the warehouse with the order."
        >
          <Text
            value={note}
            onChange={(value) => onField({ note: value || null })}
            placeholder="Anything the people receiving this should know"
          />
        </Field>
      </Fields>

      <div className="border-line border-t px-4 py-4">
        <Ladder
          className="ml-auto max-w-[26rem]"
          rows={[
            {
              label: `${count(lineCount)} ${lineCount === 1 ? "line" : "lines"}, ${count(pieces)} pieces`,
              value: amount(gross),
            },
            {
              label: "Discount",
              value: discount === 0 ? "—" : `− ${amount(discount)}`,
            },
            {
              label: "Promised",
              value: promised === "" ? <Quiet>no date</Quiet> : day(promised),
            },
          ]}
          total={{ label: "The supplier will invoice", value: rp(net) }}
        />

        <div className="mt-4 flex items-center justify-end gap-3">
          <span className="text-ctl text-ink-4">
            Prices are the catalogue's and are snapshotted by the server as the
            order is written.
          </span>
          <Button variant="primary" disabled={!ready} onClick={onRaise}>
            {pending ? "Sending…" : "Create the order"}
          </Button>
        </div>
      </div>
    </div>
  )
}

/// This supplier's catalogue, over the document.
///
/// The same endpoint Sourcing browses, narrowed to the one supplier this order
/// is for — so there is no shape of request here that can put another
/// supplier's item on this order. Adding one is the same `POST` the grid makes,
/// and it lands in the basket, which is where this order's lines are.
function PickPanel({
  open,
  supplierId,
  supplierName,
  onClose,
}: {
  open: boolean
  supplierId: string
  supplierName: string
  onClose: () => void
}) {
  const url = useQueryState()
  const typed = url.one("pq")
  const q = useDebounced(typed, 250)

  const catalogue = useCursorList<SourcedItem>({
    key: [...keys.items, "pick"],
    path: "/api/v1/supplier-items",
    unpack: unpackCatalogue,
    limit: 40,
    enabled: open && supplierId !== "",
    params: { q, status: "ACTIVE", supplier_id: supplierId },
  })

  const basket = useBasket()
  const held = useMemo(
    () =>
      new Map(
        basket.rows.map(
          (line) => [line.item.supplier_item_id, line.quantity] as const,
        ),
      ),
    [basket.rows],
  )

  /// Adding one piece. The same route the sourcing grid uses, and the same
  /// decision: `POST` adds to whatever the line already holds, and saying
  /// exactly how many belongs to the basket.
  const add = useWrite<string, BasketLine>({
    send: (supplier_item_id) =>
      api.post<BasketLine>("/api/v1/sourcing-basket", {
        supplier_item_id,
        quantity: 1,
      } satisfies AddToBasketRequest),
    settles: () => [keys.basket],
  })

  /// Saying exactly one, for an item already on the order. Offered here only
  /// because the alternative — leaving the panel to go and correct a number —
  /// is how somebody loses the list they were picking from.
  const setQuantity = useWrite<
    { id: string; quantity: number },
    BasketLine | undefined
  >({
    send: ({ id, quantity }) =>
      api.patch<BasketLine | undefined>(
        `/api/v1/sourcing-basket/${encodeURIComponent(id)}`,
        { quantity } satisfies SetBasketQuantityRequest,
      ),
    settles: () => [keys.basket],
  })

  return (
    <Sheet
      open={open}
      onClose={onClose}
      width="record"
      title={supplierName === "" ? "Catalogue" : supplierName}
      subtitle="Everything this supplier offers. Adding puts it in the basket, which is where this order's lines are."
      foot={
        <span className="text-ctl text-ink-4">
          {catalogue.query.isPending
            ? "Loading…"
            : `${count(catalogue.rows.length)} shown`}
        </span>
      }
    >
      <div className="border-line border-b px-[18px] py-2.5">
        <SearchField
          value={typed}
          onChange={(value) => url.set({ pq: value || null })}
          placeholder="Search this supplier's catalogue"
        />
      </div>

      {(add.problem ?? setQuantity.problem) !== null && (
        <Refused problem={(add.problem ?? setQuantity.problem)!} />
      )}

      {catalogue.query.isError ? (
        <Failed
          what="this catalogue"
          error={catalogue.query.error}
          onRetry={() => void catalogue.query.refetch()}
        />
      ) : catalogue.query.isPending ? (
        <Loading rows={6} cols={3} />
      ) : catalogue.rows.length === 0 ? (
        <p className="text-ctl text-ink-4 px-[18px] py-6 text-center">
          {q === ""
            ? "This supplier has nothing on offer. An item is added to their catalogue on Catalogue."
            : "Nothing of theirs matches that."}
        </p>
      ) : (
        <>
          {catalogue.rows.map((row) => {
            const on = held.get(row.item.supplier_item_id) ?? 0
            return (
              <div
                key={row.item.supplier_item_id}
                className="border-line flex items-center gap-3 border-b px-[18px] py-2.5"
              >
                <Thumb
                  url={row.item.image_url}
                  alt={row.item.name}
                  className="size-10"
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-cell text-ink truncate">
                    {row.item.name}
                  </span>
                  <span className="text-label text-ink-4 truncate font-mono">
                    {row.item.supplier_item_code}
                  </span>
                </span>
                <span className="text-ctl text-ink-3 shrink-0 tabular-nums">
                  {amount(row.item.unit_price_minor)}
                </span>
                {on > 0 ? (
                  <Button
                    disabled={setQuantity.pending}
                    onClick={() =>
                      setQuantity.run({
                        id: row.item.supplier_item_id,
                        quantity: on + 1,
                      })
                    }
                  >
                    On the order · {count(on)}
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    disabled={add.pending}
                    icon={<Plus className="size-4" />}
                    onClick={() => add.run(row.item.supplier_item_id)}
                  >
                    Add
                  </Button>
                )}
              </div>
            )
          })}

          {catalogue.hasMore && (
            <div className="flex justify-center py-4">
              <Button
                disabled={catalogue.loadingMore}
                onClick={() => void catalogue.loadMore()}
              >
                {catalogue.loadingMore ? "Fetching…" : "Show more"}
              </Button>
            </div>
          )}
        </>
      )}
    </Sheet>
  )
}
