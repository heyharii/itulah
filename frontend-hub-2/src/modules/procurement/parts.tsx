import { AlertTriangle } from "lucide-react"

import { AppLink } from "@/kit/app-link"
import { cn } from "@/lib/cn"
import { amount } from "@/lib/format"
import type { SupplierItemColour } from "@itulah/contract"

/// The marks this module draws more than once.
///
/// Components only — the vocabularies are next door in `labels.ts`, which has
/// no JSX in it and can therefore be imported from a column definition without
/// dragging a component graph along.
///
/// `Facts`, `Fact`, `SubHead` and `Line` are the same four `modules/people`
/// declares, and the duplication is deliberate rather than overlooked: a module
/// owns its own folder, and the moment a third module wants them they belong in
/// `kit/` as one promotion rather than as a cross-module import that makes
/// People a dependency of Procurement.

/// Something that is absent, drawn as absent.
///
/// Grey, always, so a column of them recedes and the rows that DO carry a value
/// are what the eye lands on.
export function Quiet({ children = "—" }: { children?: React.ReactNode }) {
  return <span className="text-ink-4">{children}</span>
}

/// A figure the data could not answer, with the reason on hover.
///
/// The rule this serves is the module's sharpest: a zero standing in for "not
/// measured" is a lie that looks like a fact, and on a purchasing screen it is
/// the difference between "this supplier has never shipped short" and "nothing
/// here counts shortfalls". The dash says the question was asked; the title
/// says why there is no answer.
export function Unanswered({ why }: { why: string }) {
  return (
    <span className="text-ink-4 cursor-help" title={why}>
      —
    </span>
  )
}

/// A photograph, or the space where one is not.
///
/// The fallback is a box rather than a broken-image glyph: an item nobody has
/// shot yet is ordinary, and a catalogue of error icons reads as a catalogue
/// that failed to load.
export function Thumb({
  url,
  alt,
  className,
}: {
  url: string | null
  alt: string
  className?: string
}) {
  if (url === null || url === "") {
    return (
      <span
        aria-hidden
        className={cn(
          "rounded-tag border-line bg-field block shrink-0 border",
          className,
        )}
      />
    )
  }
  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      className={cn(
        "rounded-tag border-line bg-field block shrink-0 border object-cover",
        className,
      )}
    />
  )
}

/// The colours an item comes in, as dots.
///
/// Drawn from the ITEM rather than looked up: `SupplierItem.colours` carries
/// the label and the hex on every colourway precisely so a reader does not have
/// to fetch the colour master to draw a swatch.
///
/// A colour with no hex gets an empty ring rather than an invented grey — the
/// contract is explicit that a colour can be named before anybody decides which
/// pixel value stands for it, and a wrong swatch is worse than no swatch.
export function Swatches({
  colours,
  limit = 6,
}: {
  colours: readonly SupplierItemColour[]
  limit?: number
}) {
  if (colours.length === 0) return <Quiet>no colours recorded</Quiet>
  const shown = colours.slice(0, limit)
  return (
    <span className="flex items-center gap-1">
      {shown.map((colour) => (
        <span
          key={colour.colour_code}
          title={colour.label}
          className="border-line-2 block size-[13px] shrink-0 rounded-full border"
          style={
            colour.hex_code === null
              ? undefined
              : { background: colour.hex_code }
          }
        />
      ))}
      {colours.length > shown.length && (
        <span className="text-label text-ink-4 tabular-nums">
          +{colours.length - shown.length}
        </span>
      )}
    </span>
  )
}

/// A record's fields, inside a sheet.
///
/// A description list rather than a grid of divs, because that is what it is:
/// somebody reading with a screen reader gets "Destination, dc-01" as one
/// utterance instead of two unrelated strings.
export function Facts({ children }: { children: React.ReactNode }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-[18px] py-4">
      {children}
    </dl>
  )
}

export function Fact({
  label,
  children,
  wide,
}: {
  label: string
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <div className={cn("min-w-0", wide && "col-span-2")}>
      <dt className="text-label text-ink-4">{label}</dt>
      <dd className="text-cell text-ink-2 m-0 mt-0.5">{children}</dd>
    </div>
  )
}

/// A heading inside a sheet, over a list that is not the record itself — the
/// lines behind an order, the items behind a supplier.
export function SubHead({
  children,
  trailing,
}: {
  children: React.ReactNode
  /// A count, a total — the one figure that belongs beside the heading rather
  /// than inside the list it names.
  trailing?: React.ReactNode
}) {
  return (
    <h2 className="border-line bg-side text-meta text-ink-3 flex items-baseline gap-3 border-y px-[18px] py-1.5 font-medium">
      <span className="min-w-0 flex-1">{children}</span>
      {trailing !== undefined && (
        <span className="text-ink-4 shrink-0 tabular-nums">{trailing}</span>
      )}
    </h2>
  )
}

/// One line of such a list.
export function Line({
  children,
  note,
}: {
  children: React.ReactNode
  note?: React.ReactNode
}) {
  return (
    <div className="border-line border-b px-[18px] py-2.5 last:border-b-0">
      <div className="text-cell text-ink-2 flex items-baseline gap-3">
        {children}
      </div>
      {note !== undefined && (
        <div className="text-label text-ink-4 mt-0.5">{note}</div>
      )}
    </div>
  )
}

/// What a document comes to, stated the way an invoice states it.
///
/// Only the last row is in full ink. The rows above are the working — the
/// lines, what was knocked off — and the one somebody acts on is the figure the
/// supplier will actually bill.
export function Ladder({
  rows,
  total,
  className,
}: {
  rows: readonly { label: string; value: React.ReactNode }[]
  total: { label: string; value: React.ReactNode }
  className?: string
}) {
  return (
    <dl className={cn("flex flex-col", className)}>
      {rows.map((row) => (
        <div
          key={row.label}
          className="text-ctl text-ink-3 flex items-baseline justify-between gap-4 py-1"
        >
          <dt>{row.label}</dt>
          <dd className="m-0 tabular-nums">{row.value}</dd>
        </div>
      ))}
      <div className="border-line text-cell text-ink mt-1 flex items-baseline justify-between gap-4 border-t pt-2 font-semibold">
        <dt>{total.label}</dt>
        <dd className="m-0 tabular-nums">{total.value}</dd>
      </div>
    </dl>
  )
}

/// A write was refused, said where the button that sent it is.
///
/// Not `kit/state.tsx`'s `Failed`: that replaces the content, and a refused
/// write must leave the document on screen. Nothing local changed — see
/// `lib/mutate.ts` — so the sentence can promise that rather than hedge it.
export function Refused({ problem }: { problem: string }) {
  return (
    <div
      role="alert"
      className="border-bad/40 bg-bad-wash text-ctl text-bad-ink flex items-start gap-2 border-b px-4 py-2"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">
        <b className="font-medium">The write was refused.</b> {problem} Nothing
        here has changed, so it is safe to correct and send again.
      </span>
    </div>
  )
}

/// A link that reads as a button.
///
/// `kit/button.tsx` renders a `<button>`, and a destination inside an `onClick`
/// is a link nobody can middle-click, copy, or open in a second tab — which on
/// this module matters more than most, because half its screens are places
/// somebody wants two of open at once: the order book and the order they are
/// composing against it.
///
/// The classes are `Button`'s, restated rather than imported, because `Button`
/// bakes in its element. Promoting a polymorphic `as` prop into the kit is the
/// better answer the moment a second module needs one; until then this is
/// twelve characters of duplication with a comment on it.
export function LinkButton({
  to,
  search,
  variant = "ghost",
  className,
  children,
}: {
  to: string
  search?: Record<string, string>
  variant?: "primary" | "ghost"
  className?: string
  children: React.ReactNode
}) {
  return (
    <AppLink
      to={to}
      search={search}
      className={cn(
        "h-ctl rounded-ctl text-ctl inline-flex shrink-0 items-center gap-1.5 px-2.5 font-medium whitespace-nowrap transition-colors",
        variant === "primary" &&
          "text-canvas hover:bg-black-hover [&_svg]:text-canvas bg-black",
        variant === "ghost" &&
          "border-line-2 bg-canvas text-ink-2 shadow-btn hover:bg-hover hover:text-ink [&_svg]:text-ink-4 border",
        className,
      )}
    >
      {children}
    </AppLink>
  )
}

/// Money in a cell, with zero drawn quietly.
///
/// A zero is a real answer here — an order with nothing received is payable
/// zero — and drawing it in full ink puts the eye on the rows that have least
/// to say.
export function Money({ minor }: { minor: number }) {
  return (
    <span className={minor === 0 ? "text-ink-4 tabular-nums" : "tabular-nums"}>
      {amount(minor)}
    </span>
  )
}
