import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input, Money } from "@/components/ui/field"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { Banner, ErrorState } from "@/components/ui/states"
import { count, day, money } from "@/lib/format"
import {
  BookWrittenNotPublished,
  commercialKeys,
  instantOf,
  minorOf,
  minutesOf,
  NOTHING_TO_PUBLISH,
  writeAndPublish,
  type CommercialChannel,
  type MarkdownInput,
  type OfferRuleInput,
  type PublishReceipt,
  type TaxRuleInput,
} from "@/lib/queries/commercial"
import { cn } from "@/lib/utils"
import { Named } from "@/screens/commercial/parts"
import {
  cellKey,
  localInput,
  percent,
  useActor,
} from "@/screens/commercial/shared"

/// Monday first, ISO order — the numbering the engine stores, and the order a
/// week is read in.
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const

/// Writing prices from the grid.
///
/// The unit of publication is still a **book** — that did not go away when the
/// books screen did. What went away is having to open one, name it, remember
/// which products it was for and come back later to publish it. Here the edits
/// are made where the prices are read, they collect in a bar, and one act wraps
/// them into a book and sends it to the fleet.
///
/// **A cell writes a sale price; a base price is written per product.** A
/// markdown names a style and a shop, which is exactly what a cell is, so one
/// cell is one row the server accepts. A base price is keyed by `sku_id`, and
/// `article-prices` answers in styles and carries no product ids — so the grid
/// cannot name the rows a price rule needs, and the composer in `price-form`
/// resolves them through `/commercial/products` instead. The two meet again in
/// the bar below and travel to the fleet as one book.
///
/// **Nothing here amends a published price.** There is no edit: a book is a
/// list of changes and the newest one naming a product wins, so pushing a new
/// figure IS the whole of changing an old one. That is why the second choice
/// in the sale sheet hands over to the composer rather than turning this cell
/// into a form — the cell is where a price is *read*, and what a permanent
/// price needs said is per product, not per style.

/// One cell of the grid, as the editor needs to talk about it.
export interface CellRef {
  readonly articleCode: string
  readonly articleName: string | null
  readonly siteId: string
  readonly siteLabel: string
  /// What the till charges now. The number a new one is judged against, and
  /// the only thing that decides which intent is offered as the default.
  readonly currentMinor: number | null
}

/// A sale price somebody has typed and not yet published.
///
/// Article-wide at one shop — every colour, every size — because that is both
/// what a cell means and what `commercial_markdown` takes.
export interface PendingMarkdown extends CellRef {
  readonly kind: "markdown"
  readonly priceMinor: number
  /// When the sale ends. `null` is open-ended, which the server accepts and
  /// which is worth being able to say: a clearance that runs until the stock
  /// is gone has no date.
  readonly until: string | null
}

/// A base price somebody has authored and not yet published.
///
/// Keyed by product, not by style, because `commercial_price_rule` is — and
/// scoped to the whole fleet, to one shop, or to a named set of shops, which is
/// the level the engine ranks by once the book version has had its say.
export interface PendingPrice {
  readonly kind: "price"
  /// `sku · site scope · channel`, which is the server's own uniqueness
  /// mirrored: `commercial_price_scope_unique` is on `(publication_id, sku_id,
  /// COALESCE(site_id,'*'), channel)`. Keying the pending list the same way
  /// means a second price for the same product and scope REPLACES the first
  /// here — rather than travelling to the server as two rows and being refused
  /// after the book has been written.
  ///
  /// It also makes the collision the constraint really has visible: a fleet
  /// price and a group price both store `site_id = NULL`, so they are one key,
  /// and one book cannot carry both for the same product.
  ///
  /// The start date is part of it too, because two rows that start on two days
  /// are bound for two books — where the server's uniqueness does not reach,
  /// and where collapsing them would silently drop one of the two decisions.
  readonly key: string
  readonly skuId: string
  readonly skuCode: string
  readonly articleCode: string
  readonly articleName: string | null
  /// "Khaki · 02". Empty when the product carries neither colour nor size.
  readonly variant: string
  /// What it sells for now, so the summary reads as a change rather than as a
  /// number out of nowhere. `null` when no published book has ever named it.
  readonly wasMinor: number | null
  readonly priceMinor: number
  readonly currency: string
  readonly channel: CommercialChannel
  /// One level per price, never two: migration 0033's
  /// `price_rule_names_one_level` refuses a row claiming to be both. Both null
  /// is the company price, which is the level every product must have.
  readonly siteId: string | null
  readonly siteIds: readonly string[] | null
  /// How that scope reads out loud — "Every shop", "Toko Bandung", "3 shops".
  readonly where: string
  /// When this price starts, when that is not when the book starts.
  ///
  /// `datetime-local` text, or `null` for "with the book". A price rule has no
  /// dates of its own — `commercial_price_rule` carries none, and
  /// `load_site_price_book` reads the *publication's* window for every price in
  /// it — so a shop that starts a week later cannot be a different row. It is a
  /// different book, and this field is what makes the publish sheet write one.
  ///
  /// A book carrying one shop's row is safe, and that is not obvious: the
  /// loader takes every published book whose window is open, not the newest
  /// one, and the engine ranks per product. So a second book naming Bandung
  /// alone adds a rung at Bandung and leaves every other price standing. A
  /// loader that read one book would have made this feature a way to wipe a
  /// shop's range.
  readonly from: string | null
  readonly sellable: boolean
  readonly taxCategory: string
  readonly taxRateBps: number
  readonly taxInclusive: boolean
}

/// What the bar is holding, in either shape.
///
/// One book carries both — `CreateCommercialPublicationRequest` takes
/// `markdowns` and `offer_rules` side by side — so they collect in one place
/// and reach the fleet in one act. Splitting them into two bars and two
/// publishes would mean two version numbers for one decision, and a shop
/// applying half of it first.
export type PendingEdit = PendingMarkdown | PendingPrice

/// The bar above the grid, in its two states.
///
/// A selection is a question ("what do you want these to cost?"); pending edits
/// are an answer nobody has sent yet. They are different sentences, and the bar
/// says whichever is true — both, when somebody has typed one price and is
/// picking the cells for the next.
export function EditBar({
  selected,
  markdowns,
  prices,
  onSetPrice,
  onNewPrice,
  onClearSelection,
  onDiscard,
  onPublish,
}: {
  selected: number
  markdowns: number
  prices: number
  onSetPrice: () => void
  onNewPrice: () => void
  onClearSelection: () => void
  onDiscard: () => void
  onPublish: () => void
}) {
  const pending = markdowns + prices
  if (selected === 0 && pending === 0) return null
  return (
    <div className="mb-3.5 flex flex-wrap items-center gap-2.5 rounded-inner border border-hairline bg-soft px-3.5 py-2.5">
      {selected > 0 && (
        <>
          <span className="text-meta text-text">
            {count(selected)} cell{selected === 1 ? "" : "s"} selected
          </span>
          <Button variant="soft" onClick={onSetPrice}>
            Set a sale price
          </Button>
          {/* The other thing somebody standing on a cell may want, and the
              grid is the only place they can say WHICH styles and WHICH shops
              without typing the codes out. It opens the composer seeded from
              the selection rather than pricing anything here: a base price is
              per product, and a cell is a style. */}
          <Button variant="soft" onClick={onNewPrice}>
            New price for these
          </Button>
          <Button variant="quiet" onClick={onClearSelection}>
            Clear
          </Button>
        </>
      )}
      {pending > 0 && (
        <>
          {/* Counted apart, because they are not the same promise. A sale
              price expires and leaves the old figure underneath; a new price
              supersedes it and stays. "12 changes" said neither. */}
          <span className="text-meta font-medium text-warn-fg">
            {[
              markdowns > 0
                ? `${count(markdowns)} sale price${markdowns === 1 ? "" : "s"}`
                : null,
              prices > 0
                ? `${count(prices)} new price${prices === 1 ? "" : "s"}`
                : null,
            ]
              .filter((one) => one !== null)
              .join(" · ")}{" "}
            not published
          </span>
          <Button variant="quiet" onClick={onDiscard}>
            Discard
          </Button>
          {/* The one black CTA on this screen. Everything else here is soft or
              quiet, because there is exactly one act that reaches a till. */}
          <Button variant="primary" onClick={onPublish}>
            Publish
          </Button>
        </>
      )}
    </div>
  )
}

/// What these cells should cost, and for how long.
///
/// A `Sheet` rather than a floating popover, and not for want of one: the two
/// intents below are a *decision* with a consequence — one moves the price of
/// the shirt for a fortnight, the other moves what the shirt costs — and this
/// language puts a decision in the panel where a record is edited, not in
/// something that closes when the mouse leaves it.
export function SalePriceSheet({
  open,
  cells,
  onApply,
  onNewPrice,
  onClose,
}: {
  open: boolean
  cells: readonly CellRef[]
  onApply: (edits: readonly PendingMarkdown[]) => void
  /// Hand these cells to the price composer, carrying whatever figure has been
  /// typed. Not an apply: a base price is per product and needs a scope, a
  /// channel and a tax class this sheet has no business asking for.
  onNewPrice: (priceMinor: number | null) => void
  onClose: () => void
}) {
  const [price, setPrice] = useState("")
  const [until, setUntil] = useState("")
  /// Which of the two this is. A radio and not a second sheet, because the
  /// question people arrive with is one question — "what should this cost?" —
  /// and only the answer's *duration* decides which record it becomes.
  const [intent, setIntent] = useState<"SALE" | "FIXED">("SALE")

  const typed = minorOf(price)
  /// The dearest thing in the selection. The comparison has to hold for every
  /// cell, not for the first one: "below the current price" across a selection
  /// spanning two shops is only true if it is true of the dearer.
  const highest = cells.reduce<number | null>(
    (top, cell) =>
      cell.currentMinor === null
        ? top
        : top === null
          ? cell.currentMinor
          : Math.max(top, cell.currentMinor),
    null
  )
  const below = typed !== null && highest !== null && typed < highest

  const untilAt = until === "" ? null : instantOf(until)
  const untilBroken = until !== "" && untilAt === null

  const problem =
    price.trim() === ""
      ? undefined
      : typed === null
        ? "A price is whole rupiah. No decimals, and nothing but digits."
        : undefined

  /// A base price is authored elsewhere and needs no figure to get there —
  /// the composer can be opened empty and filled in. Only a sale price has to
  /// be a number before this sheet can do anything with it.
  const ready =
    cells.length > 0 && (intent === "FIXED" || (typed !== null && !untilBroken))

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={
        cells.length === 1
          ? (cells[0].articleName ?? cells[0].articleCode)
          : `${count(cells.length)} cells`
      }
      id={
        cells.length === 1
          ? `${cells[0].articleCode} · ${cells[0].siteLabel}`
          : undefined
      }
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-[0.71875rem] text-mute">
            Held here until you publish. Nothing reaches a till yet.
          </span>
          <Button
            variant="primary"
            disabled={!ready}
            onClick={() => {
              if (!ready) return
              if (intent === "FIXED") {
                onNewPrice(typed)
                setPrice("")
                setUntil("")
                setIntent("SALE")
                return
              }
              onApply(
                cells.map((cell) => ({
                  ...cell,
                  kind: "markdown" as const,
                  priceMinor: typed!,
                  until: untilAt,
                }))
              )
              setPrice("")
              setUntil("")
            }}
          >
            {intent === "FIXED" ? "Choose the products" : "Apply"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="New price"
          hint={
            typed === null
              ? "Whole rupiah, as it would be written on a ticket."
              : `${money(typed)} per unit.`
          }
          problem={problem}
        >
          <Money
            value={price}
            onChange={setPrice}
            autoFocus
            placeholder="95.000"
          />
        </Field>

        {/* The two intents, and the difference between them is duration rather
            than direction. A markdown keeps the base price visible and expires;
            a fixed price moves the base and stays. The engine only refuses a
            negative number — a markdown *above* the base is legal and is
            sometimes exactly what somebody means — so the typed figure decides
            which is offered first and never which is allowed. */}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-[0.78125rem] font-medium text-text">
            What kind of change is this?
          </legend>

          <label
            className={cn(
              "flex cursor-pointer items-start gap-2.5 rounded-inner border px-3 py-2.5",
              intent === "SALE"
                ? "border-accent bg-accent-bg"
                : "border-hairline"
            )}
          >
            <input
              type="radio"
              name="intent"
              checked={intent === "SALE"}
              onChange={() => setIntent("SALE")}
              className="mt-0.5 accent-accent"
            />
            <span className="min-w-0">
              <span className="block text-[0.8125rem] font-medium text-ink">
                Sale price
              </span>
              <span className="block text-[0.71875rem] leading-relaxed text-body">
                Temporary. It replaces what the shop charges and leaves the
                original price visible underneath, so a receipt can show what
                was saved.
                {below
                  ? " Below the current price, which is the ordinary case."
                  : typed !== null && highest !== null
                    ? " Above the current price — legal, and worth a second look."
                    : ""}
              </span>
            </span>
          </label>

          <label
            className={cn(
              "flex cursor-pointer items-start gap-2.5 rounded-inner border px-3 py-2.5",
              intent === "FIXED"
                ? "border-accent bg-accent-bg"
                : "border-hairline"
            )}
          >
            <input
              type="radio"
              name="intent"
              checked={intent === "FIXED"}
              onChange={() => setIntent("FIXED")}
              className="mt-0.5 accent-accent"
            />
            <span className="min-w-0">
              <span className="block text-[0.8125rem] font-medium text-ink">
                Fixed price
              </span>
              <span className="block text-[0.71875rem] leading-relaxed text-body">
                Permanent — it becomes what the style costs, with no old figure
                underneath. It is written per product rather than per style, so
                choosing this carries{" "}
                {cells.length === 1
                  ? "this cell"
                  : `these ${count(cells.length)} cells`}{" "}
                into the composer where the sizes and colours can be named.
              </span>
            </span>
          </label>
        </fieldset>

        {intent === "FIXED" && (
          <Banner tone="info">
            Nothing is amended. A price book is a list of changes and the newest
            book naming a product wins, so this pushes a new figure and the old
            one stops being reached — there is no second act that retires it.
          </Banner>
        )}

        {/* Only a sale price ends. A base price has no dates of its own at all
            — `commercial_price_rule` carries none, and the engine reads the
            book's window for every price in it — so offering an end date here
            for a fixed price would be a control that quietly went nowhere. */}
        {intent === "SALE" && (
          <Field
            label="On sale until"
            hint="Leave empty for a clearance that runs until the stock is gone."
            problem={
              untilBroken ? "That is not a date this can read." : undefined
            }
          >
            <Input
              type="datetime-local"
              value={until}
              onChange={(event) => setUntil(event.target.value)}
            />
          </Field>
        )}

        <div>
          <MiniTable
            head={["Cell", { label: "Now", align: "right" }, "Becomes"]}
          >
            {cells.map((cell) => (
              <MiniRow key={cellKey(cell.articleCode, cell.siteId)}>
                <MiniCell>
                  <Named
                    name={cell.articleName ?? cell.articleCode}
                    code={`${cell.articleCode} · ${cell.siteLabel}`}
                  />
                </MiniCell>
                <MiniCell align="right">
                  <span className="text-mute">{money(cell.currentMinor)}</span>
                </MiniCell>
                <MiniCell align="right">
                  <span className={typed === null ? "text-mute" : "text-ink"}>
                    {typed === null ? "—" : money(typed)}
                  </span>
                </MiniCell>
              </MiniRow>
            ))}
          </MiniTable>
          <p className="mt-2 text-[0.71875rem] leading-relaxed text-mute">
            {intent === "SALE" ? (
              <>
                A sale price is written for the whole style at that shop — every
                colour and every size. A style priced per size loses that spread
                for as long as the sale runs, which is what a clearance normally
                means and is worth knowing before it is published.
              </>
            ) : (
              <>
                A fixed price is written per product, so the spread across sizes
                is kept — the composer opens with every product of these styles
                listed and one price filled in, and any of them can be given its
                own.
              </>
            )}
          </p>
        </div>
      </div>
    </Sheet>
  )
}

// ── publishing ─────────────────────────────────────────────────────────────

/// Wrap the pending edits into a book and send it to the fleet.
///
/// The two server calls are two decisions — writing a price is a
/// merchandiser's, sending it to thirty tills is somebody's to approve — and
/// they are chained behind one button here because on this screen the same
/// person is doing both. The failure *between* them is not hidden: a book that
/// was written and not published leaves a numbered draft, and the banner below
/// says so rather than inviting somebody to type it all again into a number
/// that is now taken.
export function PublishSheet({
  open,
  edits,
  nextVersion,
  onClose,
  onPublished,
}: {
  open: boolean
  edits: readonly PendingEdit[]
  nextVersion: number
  onClose: () => void
  /// Every book this publish wrote, in the order they went out. A list rather
  /// than one receipt because a batch with two start dates is two books.
  onPublished: (receipts: readonly PublishReceipt[]) => void
}) {
  const client = useQueryClient()
  const actor = useActor()
  const [name, setName] = useState("")
  const [from, setFrom] = useState(() => localInput(new Date()))
  const [until, setUntil] = useState("")
  /// The hours the prices in this book are actually down, if not all of them.
  ///
  /// Set once for the whole publish rather than per cell, because that is how a
  /// flash sale is decided: "noon to two, on these forty styles". Every price
  /// drop in the book carries it.
  const [slotFrom, setSlotFrom] = useState("")
  const [slotTo, setSlotTo] = useState("")
  const [slotDays, setSlotDays] = useState<readonly number[]>([])

  const effectiveFrom = instantOf(from)
  const effectiveTo = until === "" ? null : instantOf(until)
  const slotStart = minutesOf(slotFrom)
  const slotEnd = minutesOf(slotTo)
  /// One hour without the other is not a window. Refused rather than guessed:
  /// filling in the missing half would invent a schedule nobody typed.
  const slotBroken = (slotStart === null) !== (slotEnd === null)
  const windowBroken =
    effectiveFrom !== null &&
    effectiveTo !== null &&
    new Date(effectiveTo) <= new Date(effectiveFrom)

  /// The book's two halves, kept apart from here on.
  ///
  /// They are different records with different rules — a markdown carries its
  /// own dates and its own hours, a price carries none and takes the book's —
  /// so every count, every table and every sentence below asks which it is
  /// talking about rather than saying "changes".
  const sales = edits.filter((one) => one.kind === "markdown")
  const priced = edits.filter((one) => one.kind === "price")

  /// One tax rule per category the prices in a book actually name.
  ///
  /// The server refuses both ways round: a book that sets prices needs at
  /// least one tax rule to categorise them, and a book that sets none may not
  /// carry any, because they would categorise nothing. Deriving the list from
  /// the prices themselves is what keeps both true without anybody choosing.
  const taxRulesOf = (prices: readonly PendingPrice[]): TaxRuleInput[] => [
    ...new Map(
      prices.map((price) => [
        price.taxCategory,
        {
          tax_category: price.taxCategory,
          rate_bps: price.taxRateBps,
          tax_inclusive: price.taxInclusive,
        },
      ])
    ).values(),
  ]

  /// The books this publish will write: one per start date the prices ask for.
  ///
  /// A price rule has no dates. `commercial_price_rule` carries none, and
  /// `load_site_price_book` reads the *publication's* window for every price in
  /// it — so "Bandung starts a week later" cannot be a column on a row. It is a
  /// second book, with its own version number and its own window, and this is
  /// where the pending list splits into however many of them its dates ask for.
  ///
  /// That is safe, and it is worth saying why, because the obvious fear is that
  /// a book naming one shop wipes the rest of its range: the loader takes
  /// *every* published book whose window is open, not the newest one, and the
  /// engine ranks per product. The later book adds a rung at Bandung and leaves
  /// every other price standing.
  ///
  /// The markdowns all travel in the book that starts when this sheet says,
  /// because a markdown takes the book's `effective_from` — its own dates are
  /// the end date and the hours, which it already carries per row.
  const books = useMemo(() => {
    const by = new Map<string, PendingPrice[]>()
    for (const price of priced) {
      const at = price.from ?? ""
      const held = by.get(at)
      if (held !== undefined) held.push(price)
      else by.set(at, [price])
    }
    if (!by.has("") && sales.length > 0) by.set("", [])
    return [...by.entries()]
      .map(([at, prices]) => ({
        at,
        prices,
        from: at === "" ? effectiveFrom : instantOf(at),
        markdowns: at === "" ? sales : [],
      }))
      .sort((left, right) =>
        left.from === null || right.from === null
          ? 0
          : left.from === right.from
            ? left.at === ""
              ? -1
              : 1
            : left.from < right.from
              ? -1
              : 1
      )
    // `sales` and `priced` are derived from `edits` on every render, so they
    // are new arrays each time and useless as dependencies. The list they come
    // from is the honest one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edits, effectiveFrom])

  /// Two prices filed under one class at two different rates.
  ///
  /// A category is unique within a book — the server enforces that — so the
  /// list above would silently keep one of them and file both prices under it.
  /// That is a wrong tax on a real sale arrived at by a `Map` overwriting a
  /// key, so it is refused here instead, where the two batches that disagree
  /// can still be seen. Asked per book: two books may disagree freely, which
  /// is what "publish them separately" meant when this could only write one.
  const taxConflict = books
    .flatMap((book) => {
      const filed = taxRulesOf(book.prices)
      return book.prices.filter((price) => {
        const rule = filed.find((tax) => tax.tax_category === price.taxCategory)
        return (
          rule !== undefined &&
          (rule.rate_bps !== price.taxRateBps ||
            rule.tax_inclusive !== price.taxInclusive)
        )
      })
    })
    .at(0)

  /// One book: its prices, its markdowns if it is the one the sheet dated, and
  /// its own version number.
  ///
  /// A fresh idempotency key for each attempt, made where the command is built
  /// rather than held for the life of the sheet. Reusing one key across
  /// attempts is what an idempotency key is usually for, and here it would be
  /// wrong: a halted publish leaves a book behind, so the *next* attempt asks
  /// for a higher version — a different payload under the same key, which
  /// `command_deduplication` refuses outright. The guard against a double click
  /// is the disabled button, and the guard against a lost response is the
  /// version check, which refuses a second book at a number already taken.
  const publishOne = (book: (typeof books)[number], version: number) => {
    const offerRules: OfferRuleInput[] = book.prices.map((price) => ({
      sku_id: price.skuId,
      // Exactly one level, and `null` for the other — not `undefined`. The
      // check constraint counts the ones that are set, and a group price
      // that also carried a shop id would be refused by Postgres rather
      // than by anything with a sentence to say about it.
      site_id: price.siteId,
      site_ids: price.siteIds,
      channel: price.channel,
      // Authored together with the price, because the server refuses one
      // without the other: a priced product nobody may sell, or a sellable
      // one with no price, both fail the publication's coherence check.
      sellable: price.sellable,
      currency: price.currency,
      unit_price_minor: price.priceMinor,
      tax_category: price.taxCategory,
    }))
    const markdowns: MarkdownInput[] = book.markdowns.map((edit) => ({
      // Unique within the book, which is all the server asks, and readable
      // in the cell that carries it: the drill-down prints this id beside
      // the rung it came from, so "which decision made this price" is
      // answerable from the screen rather than from the database.
      markdown_id: `md-v${version}-${edit.articleCode}-${edit.siteId}`,
      article_code: edit.articleCode,
      site_id: edit.siteId,
      replacement_unit_price_minor: edit.priceMinor,
      priority: 0,
      // The same schedule on every drop in the book. The server keeps it per
      // row because a later book may reschedule one product without touching
      // the rest, but nothing here needs that yet.
      iso_weekdays: slotDays,
      from_minute: slotStart,
      to_minute: slotEnd,
      effective_from: book.from!,
      // The edit's own end date, not the book's. A book can carry sales that
      // finish on different days, and forcing one window on all of them would
      // make somebody publish three books to say three things.
      effective_to: edit.until,
    }))
    return writeAndPublish({
      ...NOTHING_TO_PUBLISH,
      version,
      // Every book in a run is named for the day it starts. They arrive in a
      // shop's activation log as separate entries, and three lines reading
      // "Autumn repricing" would leave nobody able to tell which one their
      // till had taken.
      name:
        books.length === 1
          ? name.trim()
          : `${name.trim()} · ${day(book.from!)}`,
      effective_from: book.from!,
      effective_to: effectiveTo,
      tax_rules: taxRulesOf(book.prices),
      offer_rules: offerRules,
      markdowns,
      actor_id: actor,
      idempotency_key: crypto.randomUUID(),
    })
  }

  /// The books that actually went out, kept across the failure of a later one.
  ///
  /// A run that publishes three books and fails on the third has changed what
  /// two shops charge. "Publishing failed" would be a lie by omission, and the
  /// mutation's own error carries nothing about what succeeded before it. State
  /// rather than a ref, because the banner that says so has to be drawn.
  const [sent, setSent] = useState<readonly PublishReceipt[]>([])

  const publish = useMutation({
    mutationFn: async () => {
      const receipts: PublishReceipt[] = []
      setSent([])
      for (const [index, book] of books.entries()) {
        receipts.push(await publishOne(book, nextVersion + index))
        setSent([...receipts])
      }
      return receipts
    },
    onError: () => {
      // A failure between the two calls still wrote a book, so the number this
      // sheet is offering is now taken. Refreshing the list is what moves it
      // on — without this, every retry asks for a version the server has
      // already refused once and the error never changes.
      client.invalidateQueries({ queryKey: commercialKeys.books() })
    },
    onSuccess: (receipts) => {
      // The whole prefix, and this is the case that earns it: publishing a book
      // changes the books list, what every shop is charging, how far behind
      // each shop now is, and the limits the usage report joins against.
      // Naming five keys here would be naming every key this module has.
      client.invalidateQueries({ queryKey: commercialKeys.all })
      onPublished(receipts)
      setName("")
      setUntil("")
    },
  })

  const ready =
    actor !== "" &&
    name.trim() !== "" &&
    effectiveFrom !== null &&
    !windowBroken &&
    // Half an hours window would publish a book the server accepts and the
    // engine reads as no schedule at all — a flash sale that quietly runs all
    // day. Refused at the button, where somebody can still see why.
    !slotBroken &&
    taxConflict === undefined &&
    // A per-shop start that is not a date yet. The batch would silently go out
    // as one book on the sheet's own date, which is the opposite of what was
    // being typed.
    books.every((book) => book.from !== null) &&
    edits.length > 0 &&
    !publish.isPending

  const halted =
    publish.error instanceof BookWrittenNotPublished ? publish.error : null

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Publish these prices"
      id={`v${nextVersion}`}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-[0.71875rem] text-mute">
            {[
              sales.length > 0
                ? `${count(sales.length)} sale price${sales.length === 1 ? "" : "s"}`
                : null,
              priced.length > 0
                ? `${count(priced.length)} new price${priced.length === 1 ? "" : "s"}`
                : null,
            ]
              .filter((one) => one !== null)
              .join(" · ")}
            .
          </span>
          <Button
            variant="primary"
            disabled={!ready}
            onClick={() => publish.mutate()}
          >
            {publish.isPending ? "Publishing…" : "Publish to the fleet"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {publish.isError && sent.length > 0 && (
          // Said before the error itself, because it is the half that changed
          // the world: those versions are live at the tills now, and retrying
          // must not send them again.
          <Banner tone="warn">
            {sent.map((one) => `v${one.version}`).join(" and ")}{" "}
            {sent.length === 1 ? "is" : "are"} already published and at the
            tills. Only the {count(books.length - sent.length)} book
            {books.length - sent.length === 1 ? "" : "s"} after{" "}
            {sent.length === 1 ? "it" : "them"} failed — discard the prices that
            did go out before trying again, or this will publish them twice
            under two version numbers.
          </Banner>
        )}

        {halted !== null ? (
          <Banner tone="bad">{halted.message}</Banner>
        ) : publish.isError ? (
          <ErrorState error={publish.error} />
        ) : null}

        {books.length > 1 && (
          <Banner tone="info">
            These prices do not all start on the same day, and a price carries
            no date of its own — every till reads the book's window. So this
            writes {count(books.length)} books, v{nextVersion} to v
            {nextVersion + books.length - 1}, one per date:{" "}
            {books
              .map(
                (book) =>
                  `${book.from === null ? "an unreadable date" : day(book.from)} (${count(book.prices.length)} price${book.prices.length === 1 ? "" : "s"})`
              )
              .join(", ")}
            . A shop reads every book whose window is open, so the later ones
            add a price where they name one and leave the rest standing.
          </Banner>
        )}

        {taxConflict !== undefined && (
          <Banner tone="bad">
            Two of these prices are filed under {taxConflict.taxCategory} at
            different rates. A book holds one rule per tax class, so one of the
            two readings would be applied to both — discard the prices from one
            of the batches and publish them separately.
          </Banner>
        )}

        <Field
          label="What this book is called"
          hint="How it will read in a shop's activation log, and on every price it sets."
        >
          <Input
            value={name}
            autoFocus
            placeholder="Weekend clearance"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        <Field
          label="In force from"
          hint="Before this instant the tills keep charging what the last book gave them."
        >
          <Input
            type="datetime-local"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </Field>

        <Field
          label="Until"
          hint="Optional. The book stops applying then; each sale price can also end earlier on its own."
          problem={
            windowBroken ? "The end has to come after the start." : undefined
          }
        >
          <Input
            type="datetime-local"
            value={until}
            onChange={(event) => setUntil(event.target.value)}
          />
        </Field>

        {/* Hours belong to a markdown and to nothing else. A base price has no
            schedule at all, so on a book carrying only prices this control
            would set a field with nowhere to go. */}
        {sales.length > 0 && (
          <Field
            label="Only between these hours"
            hint="Optional, and in the shop's own time. Leave empty and the sale prices are down all day."
            problem={slotBroken ? "Give both hours, or neither." : undefined}
          >
            <div className="flex items-center gap-2">
              <Input
                type="time"
                value={slotFrom}
                onChange={(event) => setSlotFrom(event.target.value)}
              />
              <span className="text-[0.75rem] text-mute">to</span>
              <Input
                type="time"
                value={slotTo}
                onChange={(event) => setSlotTo(event.target.value)}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {WEEKDAYS.map((label, index) => {
                const day = index + 1
                const on = slotDays.includes(day)
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setSlotDays(
                        on
                          ? slotDays.filter((one) => one !== day)
                          : [...slotDays, day].sort((a, b) => a - b)
                      )
                    }
                    className={cn(
                      "h-7 rounded-full px-2.5 text-[0.71875rem] font-medium transition-colors",
                      on
                        ? "bg-ink text-white"
                        : "border border-hairline-2 bg-canvas text-body"
                    )}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            {/* Said where the decision is made, not in a document nobody opens.
              A promotion outside its hours simply does not fire; a price drop
              outside its hours means the ticket on the garment is wrong. */}
            {(slotStart !== null || slotDays.length > 0) && (
              <p className="mt-2 text-[0.71875rem] leading-relaxed text-mute">
                Outside these hours the tills charge the full price again — the
                label on the garment will not.
              </p>
            )}
          </Field>
        )}

        {sales.length > 0 && (
          <div>
            <SubHead aside="whole style, one shop">Sale prices</SubHead>
            <MiniTable
              head={["Cell", { label: "Until", align: "left" }, "Price"]}
            >
              {sales.map((edit) => (
                <MiniRow key={cellKey(edit.articleCode, edit.siteId)}>
                  <MiniCell>
                    <Named
                      name={edit.articleName ?? edit.articleCode}
                      code={`${edit.articleCode} · ${edit.siteLabel}`}
                    />
                  </MiniCell>
                  <MiniCell>
                    <span className="text-[0.71875rem] text-body">
                      {edit.until === null ? "No end date" : day(edit.until)}
                    </span>
                  </MiniCell>
                  <MiniCell align="right">{money(edit.priceMinor)}</MiniCell>
                </MiniRow>
              ))}
            </MiniTable>
          </div>
        )}

        {priced.length > 0 && (
          <div>
            <SubHead aside="per product">New prices</SubHead>
            <MiniTable
              head={["Product", { label: "Where", align: "left" }, "Price"]}
            >
              {priced.map((price) => (
                <MiniRow key={price.key}>
                  <MiniCell>
                    <Named
                      name={price.articleName ?? price.articleCode}
                      code={[price.skuCode, price.variant]
                        .filter((one) => one !== "")
                        .join(" · ")}
                    />
                  </MiniCell>
                  <MiniCell>
                    <span className="block text-[0.71875rem] text-body">
                      {price.where}
                    </span>
                    {/* Only where it differs from the book's, because a date
                        printed on every row would read as a per-row window,
                        which is the one thing a price rule does not have. */}
                    {price.from !== null && (
                      <span className="block text-[0.6875rem] text-mute">
                        from {day(instantOf(price.from) ?? price.from)}
                      </span>
                    )}
                  </MiniCell>
                  <MiniCell align="right">
                    {/* The figure it supersedes, struck, beside the new one.
                        A price on its own cannot be read as a rise or a cut,
                        and that is the first thing anybody checks before a
                        book goes to thirty tills. */}
                    {price.wasMinor !== null &&
                      price.wasMinor !== price.priceMinor && (
                        <span className="mr-1.5 text-mute tabular-nums line-through decoration-1">
                          {money(price.wasMinor)}
                        </span>
                      )}
                    <span className="tabular-nums">
                      {money(price.priceMinor)}
                    </span>
                  </MiniCell>
                </MiniRow>
              ))}
            </MiniTable>
            {taxRulesOf(priced).length > 0 && (
              <p className="mt-2 text-[0.71875rem] leading-relaxed text-mute">
                Filed under{" "}
                {taxRulesOf(priced)
                  .map(
                    (tax) =>
                      `${tax.tax_category} at ${percent(tax.rate_bps)}${tax.tax_inclusive ? ", inclusive" : ", on top"}`
                  )
                  .join(" · ")}
                . A book that sets prices carries the tax rule that categorises
                them; one that sets none may not.
              </p>
            )}
          </div>
        )}

        <p className="text-[0.71875rem] leading-relaxed text-mute">
          A book is a list of changes, not a replacement. Anything it does not
          name keeps the price the last book gave it — and the newest book that
          names a product wins, whether or not this one meant to touch it.
          {priced.length > 0 && (
            <>
              {" "}
              A price rule carries no dates of its own, so the book's window is
              the whole of when its prices apply.{" "}
              {books.length > 1
                ? "The one above belongs to the first book; the rest start on the days their prices asked for, and all of them end when “Until” says."
                : "The one above is theirs."}
            </>
          )}
        </p>
      </div>
    </Sheet>
  )
}
