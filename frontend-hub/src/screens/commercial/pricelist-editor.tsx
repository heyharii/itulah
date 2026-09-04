import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/field"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
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
  type MarkdownInput,
  type PublishReceipt,
} from "@/lib/queries/commercial"
import { cn } from "@/lib/utils"
import { Named } from "@/screens/commercial/parts"
import { cellKey, localInput, useActor } from "@/screens/commercial/shared"

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
/// **Only markdowns can be written today, and that is a backend limit rather
/// than a decision.** A markdown names a style and a shop, which is exactly
/// what a cell is, so one cell is one row the server accepts. A base price is
/// keyed by `sku_id`, and `article-prices` answers in styles and returns no
/// product ids at all — so a cell cannot name the rows a price rule would need.
/// The choice is offered and disabled with that reason rather than hidden,
/// because a merchandiser who wants a permanent price should be told why they
/// cannot have one yet, not left to conclude the product is priced per shop
/// only by sale.

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

/// A price somebody has typed and not yet published.
export interface PendingEdit extends CellRef {
  readonly priceMinor: number
  /// When the sale ends. `null` is open-ended, which the server accepts and
  /// which is worth being able to say: a clearance that runs until the stock
  /// is gone has no date.
  readonly until: string | null
}

/// The bar above the grid, in its two states.
///
/// A selection is a question ("what do you want these to cost?"); pending edits
/// are an answer nobody has sent yet. They are different sentences, and the bar
/// says whichever is true — both, when somebody has typed one price and is
/// picking the cells for the next.
export function EditBar({
  selected,
  pending,
  onSetPrice,
  onClearSelection,
  onDiscard,
  onPublish,
}: {
  selected: number
  pending: number
  onSetPrice: () => void
  onClearSelection: () => void
  onDiscard: () => void
  onPublish: () => void
}) {
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
          <Button variant="quiet" onClick={onClearSelection}>
            Clear
          </Button>
        </>
      )}
      {pending > 0 && (
        <>
          <span className="text-meta font-medium text-warn-fg">
            {count(pending)} change{pending === 1 ? "" : "s"} not published
          </span>
          <Button variant="quiet" onClick={onDiscard}>
            Discard
          </Button>
          {/* The one black CTA on this screen. Everything else here is soft or
              quiet, because there is exactly one act that reaches a till. */}
          <Button variant="dark" onClick={onPublish}>
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
  onClose,
}: {
  open: boolean
  cells: readonly CellRef[]
  onApply: (edits: readonly PendingEdit[]) => void
  onClose: () => void
}) {
  const [price, setPrice] = useState("")
  const [until, setUntil] = useState("")

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

  const ready = typed !== null && !untilBroken && cells.length > 0

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
            variant="dark"
            disabled={!ready}
            onClick={() => {
              if (!ready) return
              onApply(
                cells.map((cell) => ({
                  ...cell,
                  priceMinor: typed,
                  until: untilAt,
                }))
              )
              setPrice("")
              setUntil("")
            }}
          >
            Apply
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
          <Input
            value={price}
            inputMode="numeric"
            autoFocus
            placeholder="95.000"
            onChange={(event) => setPrice(event.target.value)}
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

          <label className="flex items-start gap-2.5 rounded-inner border border-accent bg-accent-bg px-3 py-2.5">
            <input
              type="radio"
              name="intent"
              checked
              readOnly
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

          <label className="flex items-start gap-2.5 rounded-inner border border-hairline px-3 py-2.5 opacity-60">
            <input
              type="radio"
              name="intent"
              disabled
              className="mt-0.5 accent-accent"
            />
            <span className="min-w-0">
              <span className="block text-[0.8125rem] font-medium text-ink">
                Fixed price
              </span>
              <span className="block text-[0.71875rem] leading-relaxed text-body">
                Permanent — it moves the base price itself. Not available from
                this grid: a base price is written per product and this view
                answers per style, so there is nothing here to name the products
                with. It needs `article-prices` to return a `sku_id` per cell.
              </span>
            </span>
          </label>
        </fieldset>

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
            A sale price is written for the whole style at that shop — every
            colour and every size. A style priced per size loses that spread for
            as long as the sale runs, which is what a clearance normally means
            and is worth knowing before it is published.
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
  onPublished: (receipt: PublishReceipt) => void
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

  /// A fresh key for each attempt, made where the command is built rather than
  /// held for the life of the sheet.
  ///
  /// Reusing one key across attempts is what an idempotency key is usually for,
  /// and here it would be wrong: a halted publish leaves a book behind, so the
  /// *next* attempt asks for a higher version — a different payload under the
  /// same key, which `command_deduplication` refuses outright. The guard
  /// against a double click is the disabled button, and the guard against a
  /// lost response is the version check, which refuses a second book at a
  /// number already taken.
  const publish = useMutation({
    mutationFn: () => {
      const markdowns: MarkdownInput[] = edits.map((edit) => ({
        // Unique within the book, which is all the server asks, and readable
        // in the cell that carries it: the drill-down prints this id beside
        // the rung it came from, so "which decision made this price" is
        // answerable from the screen rather than from the database.
        markdown_id: `md-v${nextVersion}-${edit.articleCode}-${edit.siteId}`,
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
        effective_from: effectiveFrom!,
        // The edit's own end date, not the book's. A book can carry sales that
        // finish on different days, and forcing one window on all of them would
        // make somebody publish three books to say three things.
        effective_to: edit.until,
      }))
      return writeAndPublish({
        ...NOTHING_TO_PUBLISH,
        version: nextVersion,
        name: name.trim(),
        effective_from: effectiveFrom!,
        effective_to: effectiveTo,
        markdowns,
        actor_id: actor,
        idempotency_key: crypto.randomUUID(),
      })
    },
    onError: () => {
      // A failure between the two calls still wrote a book, so the number this
      // sheet is offering is now taken. Refreshing the list is what moves it
      // on — without this, every retry asks for a version the server has
      // already refused once and the error never changes.
      client.invalidateQueries({ queryKey: commercialKeys.books() })
    },
    onSuccess: (receipt) => {
      // The whole prefix, and this is the case that earns it: publishing a book
      // changes the books list, what every shop is charging, how far behind
      // each shop now is, and the limits the usage report joins against.
      // Naming five keys here would be naming every key this module has.
      client.invalidateQueries({ queryKey: commercialKeys.all })
      onPublished(receipt)
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
            {count(edits.length)} sale price
            {edits.length === 1 ? "" : "s"}.
          </span>
          <Button
            variant="dark"
            disabled={!ready}
            onClick={() => publish.mutate()}
          >
            {publish.isPending ? "Publishing…" : "Publish to the fleet"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {halted !== null ? (
          <Banner tone="bad">{halted.message}</Banner>
        ) : publish.isError ? (
          <ErrorState error={publish.error} />
        ) : null}

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

        <Field
          label="Only between these hours"
          hint="Optional, and in the shop's own time. Leave empty and the prices are down all day."
          problem={
            slotBroken ? "Give both hours, or neither." : undefined
          }
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

        <div>
          <MiniTable
            head={["Cell", { label: "Until", align: "left" }, "Price"]}
          >
            {edits.map((edit) => (
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

        <p className="text-[0.71875rem] leading-relaxed text-mute">
          A book is a list of changes, not a replacement. Anything it does not
          name keeps the price the last book gave it — and the newest book that
          names a product wins, whether or not this one meant to touch it.
        </p>
      </div>
    </Sheet>
  )
}
