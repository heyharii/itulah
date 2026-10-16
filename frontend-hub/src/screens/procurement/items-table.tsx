import { Fragment } from "react"

import { PhotoImg } from "@/components/ui/photo-img"
import { ZoomPhoto } from "@/components/ui/photo-viewer"
import { Thumbnail } from "@/components/ui/thumbnail"
import { useColourwayFill } from "@/lib/colourway-fill"
import { money } from "@/lib/format"
import { pcs } from "@/screens/procurement/shared"
import { cn } from "@/lib/utils"

/// The items of a purchase order, drawn one way wherever they are drawn.
///
/// The order's own sheet, the review before an order is created and the form
/// it is made on each had a table of their own — different paddings, rules
/// between the columns in two of them and not in the third, totals that
/// stopped at a different place, and no phone layout at all on the review. The
/// buyer reads the same order three times in a row; it should look like the
/// same order (the owner, 2026-10-05).
///
/// What differs between them is data, not layout: the sheet has a Received
/// column and shows what came in against each line; the form has actions at
/// the end of a row and may say what a line still lacks. Both arrive as props.
/// Quantities are pieces, always, with what was typed — "20 kodi" — quiet
/// under them. A desk gets a table with horizontal rules only; a phone gets
/// one card per line, read down.

export type ReceivedTone = "ok" | "bad" | null

/// One colour × size of a line, drawn as a quiet sub-row under it.
export interface ItemsVariant {
  readonly key: string
  /// "Black M".
  readonly label: string
  readonly pieces: number
  readonly photo?: string | null
}

export interface ItemsRow {
  readonly key: string
  readonly image: string | null
  readonly name: string
  /// For the thumbnail's placeholder, when there is no picture.
  readonly division: string | null
  /// The colour the placeholder wears — a code or label from the colour
  /// master, the line's first colourway.
  readonly colour?: string | null
  /// Division and tags as words: "Pria · Basic".
  readonly filed: string
  /// What was typed when it was not pieces, quiet under them: "20 kodi".
  readonly said?: string | null
  readonly pieces: number
  /// "Rp 20.000 / kodi" — the price per the unit it was agreed in.
  readonly price: string
  readonly amount: number
  /// What has arrived against the line, when the table has that column.
  readonly received?: { readonly pieces: number; readonly tone: ReceivedTone }
  /// More about the line, under its name: every receiving against it, or what
  /// it still lacks.
  readonly more?: React.ReactNode
  /// Buttons at the row's end — the form's pencil and bin.
  readonly actions?: React.ReactNode
  /// Opens what the line is — the item's own record — as a layer over this
  /// one. Every object with a detail is a link to it (owner, 14 Oct: "semua
  /// bisa di klik").
  readonly onOpen?: () => void
  /// The line split by colour and size, when it is (the owner, 2026-10-10):
  /// each one under the line, so the order says how many Black M it wants.
  readonly variants?: readonly ItemsVariant[]
}

export interface ItemsTotals {
  readonly pieces: number
  readonly received?: { readonly pieces: number; readonly tone: ReceivedTone }
  readonly gross: number
  readonly discount?: {
    readonly minor: number
    /// "Discount · 10 %".
    readonly label: string
    /// What it comes to on each piece, under the label.
    readonly perPiece: number | null
  }
  readonly closedShort?: { readonly pieces: number; readonly value: number }
  /// What the supplier will invoice. Absent where the order is still being
  /// written: the form shows the lines' total only, and the review the rest.
  readonly grand?: number
}

/// The lines whose pictures start coming as the order opens. An order is read
/// from its top, and sixteen thumbnails are a few hundred kilobytes; lazy is for
/// an order of two hundred.
const EAGER_ROWS = 24

/// The head and cell of this table, for another document's table that should
/// read the same (Inventory › Counts' articles, 16 Oct 2026).
export const ITEMS_HEAD =
  "items-head bg-soft px-4 py-2.5 text-[0.9375rem] font-medium whitespace-nowrap text-body"
export const ITEMS_CELL =
  "border-t border-hairline px-4 py-3.5 align-middle text-cell"
const HEAD = ITEMS_HEAD
const CELL = ITEMS_CELL

function toneText(tone: ReceivedTone): string {
  return tone === "bad"
    ? "text-bad-fg"
    : tone === "ok"
      ? "text-ok-fg"
      : "text-mute"
}

/// A line's identity: the picture, the name, what it is filed under, and
/// whatever more the caller has to say.
export function ItemIdentity({
  row,
  eager,
}: {
  row: Pick<
    ItemsRow,
    "image" | "name" | "division" | "colour" | "filed" | "more" | "onOpen"
  >
  eager: boolean
}) {
  const fill = useColourwayFill()
  return (
    <div className="flex min-w-0 items-start gap-3">
      {/* A tap shows the photograph full size. */}
      <ZoomPhoto url={row.image} name={row.name} className="size-10">
        <Thumbnail
          url={row.image}
          name={row.name}
          division={row.division}
          colours={fill(row.colour)}
          fallback="—"
          className="size-10 shrink-0 rounded-inner"
          eager={eager}
        />
      </ZoomPhoto>
      <div className="flex min-w-0 flex-col gap-0.5">
        {row.onOpen ? (
          <button
            type="button"
            onClick={(event) => {
              // The row may open something of its own; this is the item.
              event.stopPropagation()
              row.onOpen?.()
            }}
            className="record-link line-clamp-2 text-left text-ink"
          >
            {row.name}
          </button>
        ) : (
          <span className="line-clamp-2 text-ink">{row.name}</span>
        )}
        <span className="truncate text-[0.9375rem] text-body">
          {titleCase(row.filed)}
        </span>
        {row.more}
      </div>
    </div>
  )
}

/// A variant's name with its first photograph, when it has one of its own —
/// not when it only wears the article's, which is already beside the name
/// (owner, 2026-10-16: "kalau fotonya sama jangan ada foto").
function VariantName({
  variant,
  articlePhoto,
}: {
  variant: ItemsVariant
  articlePhoto: string | null
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {variant.photo && variant.photo !== articlePhoto ? (
        <ZoomPhoto
          url={variant.photo}
          name={variant.label}
          className="size-7 shrink-0"
        >
          <PhotoImg
            url={variant.photo}
            alt={variant.label}
            className="size-7 rounded-inner border border-hairline object-cover"
          />
        </ZoomPhoto>
      ) : null}
      <span className="truncate">{variant.label}</span>
      {/* Its pieces beside its name, not in the Quantity column, where they
          read as more of the line's total (owner, 2026-10-14: "biar ga
          bingung jadi 4000"). */}
      <span className="shrink-0 whitespace-nowrap text-mute tabular-nums">
        · {pcs(variant.pieces)}
      </span>
    </span>
  )
}

function Pieces({ row }: { row: ItemsRow }) {
  return (
    <span className="flex flex-col items-end gap-0.5 whitespace-nowrap tabular-nums">
      <span className="text-ink">{pcs(row.pieces)}</span>
      {row.said != null && (
        <span className="text-[0.9375rem] text-mute">{row.said}</span>
      )}
    </span>
  )
}

/// A labelled figure on a phone card.
function Figure({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[0.9375rem] text-mute">{label}</dt>
      <dd className={cn("text-ink tabular-nums", className)}>{children}</dd>
    </div>
  )
}

export function ItemsTable({
  rows,
  totals,
  totalsApart = false,
  quantityLabel = "Quantity",
}: {
  rows: readonly ItemsRow[]
  totals: ItemsTotals
  /// The totals are drawn by the caller, in a box of their own under the table
  /// (as Review Count does), so neither the table's foot nor the phone's totals
  /// card is drawn. `totals.received` still says whether there is a Received
  /// column.
  totalsApart?: boolean
  /// What the pieces column is called: "Quantity" on the form an order is made on,
  /// "Ordered" once it is a document — beside Received, a pair (owner, 2026-10-12).
  quantityLabel?: string
}) {
  const withReceived = totals.received !== undefined
  const withActions = rows.some((row) => row.actions !== undefined)
  /// Columns a total's label runs across: everything before the Amount.
  const labelSpan = 3 + (withReceived ? 1 : 0)
  return (
    <>
      {/* A desk: horizontal rules only, one padding, the totals standing under
          the columns they add up. */}
      <div className="items-box hidden overflow-hidden rounded-inner border border-hairline md:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] table-fixed border-collapse">
            <colgroup>
              <col />
              <col className="w-[8.5rem]" />
              {withReceived && <col className="w-[9rem]" />}
              <col className="w-[10rem]" />
              <col className="w-[9.5rem]" />
              {withActions && <col className="w-[8rem]" />}
            </colgroup>
            <thead>
              <tr>
                <th className={cn(HEAD, "text-left")}>Item</th>
                <th className={cn(HEAD, "text-right")}>{quantityLabel}</th>
                {withReceived && (
                  <th className={cn(HEAD, "text-right")}>Received</th>
                )}
                <th className={cn(HEAD, "text-right")}>Unit Price</th>
                <th className={cn(HEAD, "text-right")}>Amount</th>
                {withActions && (
                  <th className={HEAD}>
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="[&_tr:first-child_td]:border-t-0">
              {rows.map((row, at) => (
                <Fragment key={row.key}>
                  <tr>
                    <td className={CELL}>
                      <ItemIdentity row={row} eager={at < EAGER_ROWS} />
                    </td>
                    <td className={cn(CELL, "text-right")}>
                      <Pieces row={row} />
                    </td>
                    {withReceived && (
                      <td
                        className={cn(
                          CELL,
                          "text-right whitespace-nowrap tabular-nums"
                        )}
                      >
                        <span className={toneText(row.received?.tone ?? null)}>
                          {row.received === undefined ||
                          row.received.pieces === 0
                            ? "—"
                            : pcs(row.received.pieces)}
                        </span>
                      </td>
                    )}
                    <td
                      className={cn(
                        CELL,
                        "text-right whitespace-nowrap text-ink tabular-nums"
                      )}
                    >
                      {row.price}
                    </td>
                    <td
                      className={cn(
                        CELL,
                        "text-right font-medium whitespace-nowrap text-ink tabular-nums"
                      )}
                    >
                      {money(row.amount)}
                    </td>
                    {withActions && (
                      <td className={cn(CELL, "px-2 text-center")}>
                        <span className="inline-flex items-center justify-center gap-0.5">
                          {row.actions}
                        </span>
                      </td>
                    )}
                  </tr>
                  {(row.variants ?? []).map((variant, index, all) => (
                    <tr key={variant.key}>
                      <td
                        className={cn(
                          "px-4 pt-0 pb-2 text-[0.9375rem] text-body",
                          index === all.length - 1 && "pb-3.5"
                        )}
                      >
                        {/* Under the name: the picture is 40px and its gap 12px. */}
                        <span className="block pl-[3.25rem]">
                          <VariantName variant={variant} articlePhoto={row.image} />
                        </span>
                      </td>
                      <td />
                      {withReceived && <td />}
                      <td />
                      <td />
                      {withActions && <td />}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
            {!totalsApart && (
              <tfoot className="text-[0.9375rem] tabular-nums">
                <tr className="border-t border-hairline bg-soft font-medium">
                  <td className="px-4 py-3 text-body">Total</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap text-ink">
                    {pcs(totals.pieces)}
                  </td>
                  {withReceived && (
                    <td
                      className={cn(
                        "px-4 py-3 text-right whitespace-nowrap",
                        toneText(totals.received?.tone ?? null)
                      )}
                    >
                      {totals.received === undefined ||
                      totals.received.pieces === 0
                        ? "—"
                        : pcs(totals.received.pieces)}
                    </td>
                  )}
                  <td />
                  <td className="px-4 py-3 text-right whitespace-nowrap text-ink">
                    {money(totals.gross)}
                  </td>
                  {withActions && <td />}
                </tr>
                {totals.discount !== undefined && (
                  <tr className="border-t border-hairline">
                    <td colSpan={labelSpan} className="px-4 py-3 text-body">
                      {totals.discount.label}
                      {totals.discount.perPiece !== null && (
                        <span className="block text-mute">
                          {`${money(totals.discount.perPiece)} / pc`}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap text-ink">
                      {money(-totals.discount.minor)}
                    </td>
                    {withActions && <td />}
                  </tr>
                )}
                {totals.closedShort !== undefined && (
                  <tr className="border-t border-hairline">
                    <td colSpan={labelSpan} className="px-4 py-3 text-body">
                      {`Closed Short · ${pcs(totals.closedShort.pieces)}`}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap text-ink">
                      {money(-totals.closedShort.value)}
                    </td>
                    {withActions && <td />}
                  </tr>
                )}
                {totals.grand !== undefined && (
                  <tr className="border-t border-hairline bg-soft text-[0.9375rem] font-semibold">
                    <td colSpan={labelSpan} className="px-4 py-3.5 text-ink">
                      Grand Total
                    </td>
                    <td className="px-4 py-3.5 text-right whitespace-nowrap text-ink">
                      {money(totals.grand)}
                    </td>
                    {withActions && <td />}
                  </tr>
                )}
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* A phone: one card per line, read down. Two columns of figures and the
          line's own total on a row under them, then the order's totals in a
          card of their own — the same figures as the table, in the same order. */}
      <div className="flex flex-col gap-3 md:hidden">
        <ul className="items-list flex flex-col overflow-hidden rounded-inner border border-hairline">
          {rows.map((row, at) => (
            <li
              key={row.key}
              className="flex flex-col border-t border-hairline first:border-t-0"
            >
              <div className="flex items-start gap-1 p-3.5 pb-3">
                <div className="min-w-0 flex-1">
                  <ItemIdentity row={row} eager={at < EAGER_ROWS} />
                </div>
                {row.actions !== undefined && (
                  <span className="flex shrink-0 items-center">
                    {row.actions}
                  </span>
                )}
              </div>
              {(row.variants ?? []).length > 0 && (
                <ul className="flex flex-col gap-1.5 pr-3.5 pb-3 pl-[4.25rem] text-[0.9375rem] text-body">
                  {(row.variants ?? []).map((variant) => (
                    <li key={variant.key} className="flex items-center gap-3">
                      <VariantName variant={variant} articlePhoto={row.image} />
                    </li>
                  ))}
                </ul>
              )}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 px-3.5 pb-3.5 text-[0.9375rem]">
                <Figure label={quantityLabel}>
                  {pcs(row.pieces)}
                  {row.said != null && (
                    <span className="block text-[0.9375rem] text-mute">
                      {row.said}
                    </span>
                  )}
                </Figure>
                {withReceived ? (
                  <>
                    <Figure
                      label="Received"
                      className={toneText(row.received?.tone ?? null)}
                    >
                      {row.received === undefined || row.received.pieces === 0
                        ? "—"
                        : pcs(row.received.pieces)}
                    </Figure>
                    <Figure label="Unit Price">{row.price}</Figure>
                    <Figure label="Amount" className="font-medium">
                      <span className="whitespace-nowrap">
                        {money(row.amount)}
                      </span>
                    </Figure>
                  </>
                ) : (
                  <>
                    <Figure label="Unit Price">{row.price}</Figure>
                    <div className="col-span-2 flex items-baseline justify-between gap-3 border-t border-hairline pt-2.5">
                      <dt className="text-[0.9375rem] text-body">Amount</dt>
                      <dd className="font-medium whitespace-nowrap text-ink tabular-nums">
                        {money(row.amount)}
                      </dd>
                    </div>
                  </>
                )}
              </dl>
            </li>
          ))}
        </ul>
        {!totalsApart && (
          <div className="items-totals flex flex-col gap-2 rounded-inner border border-hairline bg-soft p-3.5 text-[0.9375rem] tabular-nums">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium text-body">Total</span>
              <span className="font-medium text-ink">
                {`${pcs(totals.pieces)} · ${money(totals.gross)}`}
              </span>
            </div>
            {totals.received !== undefined && (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-body">Received</span>
                <span className={toneText(totals.received.tone)}>
                  {totals.received.pieces === 0
                    ? "—"
                    : pcs(totals.received.pieces)}
                </span>
              </div>
            )}
            {totals.discount !== undefined && (
              <div className="flex items-baseline justify-between gap-3 text-body">
                <span>
                  {totals.discount.label}
                  {totals.discount.perPiece !== null && (
                    <span className="block text-mute">
                      {`${money(totals.discount.perPiece)} / pc`}
                    </span>
                  )}
                </span>
                <span className="text-ink">
                  {money(-totals.discount.minor)}
                </span>
              </div>
            )}
            {totals.closedShort !== undefined && (
              <div className="flex items-baseline justify-between gap-3 text-body">
                <span>{`Closed Short · ${pcs(totals.closedShort.pieces)}`}</span>
                <span className="text-ink">
                  {money(-totals.closedShort.value)}
                </span>
              </div>
            )}
            {totals.grand !== undefined && (
              <div className="flex items-baseline justify-between gap-3 border-t border-hairline pt-2 font-semibold">
                <span className="text-ink">Grand Total</span>
                <span className="text-ink">{money(totals.grand)}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}

/// The division and tags in Title Case ("Tangan pendek" → "Tangan Pendek"):
/// the masters hold them as typed, the order reads them as names (owner,
/// 2026-10-16). Only first letters are raised; codes like "XL" stay as they are.
function titleCase(text: string): string {
  return text.replace(/(^|[\s·/-])(\p{Ll})/gu, (_, gap: string, letter: string) =>
    gap + letter.toUpperCase()
  )
}
