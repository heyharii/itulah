import { ArrowRight, Boxes, Search, Shirt, Store, Trash, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Photograph } from "@/screens/catalogue-parts"
import { readPlace, type PlaceCode } from "@/screens/stock/shared"

/// The drawn pieces the Stock screens share. The words behind them are in
/// `shared.ts`.

// ── The frame ───────────────────────────────────────────────────────────────

/// A footer button on a phone: 44px, whatever the kit's footer says. The kit's
/// `Sheet` pins every button in its foot to 36px (`[&_button]:h-9`); a thumb
/// needs 44 (audit D1), and `!` is the only way to beat a parent's arbitrary
/// variant from the button itself.
export const FOOT = "max-md:h-11!"

/// The figures under a list's title, as one sentence: "**12** movements".
/// Nothing else sits at the top of a list on a phone.
export function Figures({
  children,
  trailing,
}: {
  children: React.ReactNode
  /// Quiet and right-aligned: when the list was last read.
  trailing?: React.ReactNode
}) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <p className="min-w-0 flex-1 truncate text-meta text-body">{children}</p>
      {trailing !== undefined && (
        <span className="shrink-0 text-meta text-mute tabular-nums">
          {trailing}
        </span>
      )}
    </div>
  )
}

/// The desk's search box, over a list: a glass, the field, and a way to clear
/// it. On a phone the same search is the dock's, so this is `max-md:hidden`.
///
/// Not the `ScanField`. That one is a scanner's keyboard and keeps the caret;
/// this one narrows a list somebody is reading, and gives the caret back.
export function DeskSearch({
  value,
  onChange,
  label,
  placeholder,
  className,
}: {
  value: string
  onChange: (next: string) => void
  label: string
  placeholder: string
  className?: string
}) {
  return (
    <label className={cn("relative min-w-0 flex-[0_1_18rem]", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-line-ico" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        enterKeyHint="search"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className="h-9 w-full rounded-inner border border-hairline-2 bg-canvas pr-9 pl-8 text-[0.875rem] text-ink shadow-soft outline-none placeholder:text-body hover:border-hairline-strong focus:border-accent pointer-coarse:h-11"
      />
      {value !== "" && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear the search"
          className="absolute top-1/2 right-1 grid size-7 -translate-y-1/2 place-items-center rounded-inner text-line-ico transition-colors hover:bg-soft-2 hover:text-ink pointer-coarse:size-9"
        >
          <X className="size-4" />
        </button>
      )}
    </label>
  )
}

// ── The sheet's body ────────────────────────────────────────────────────────

/// A section of a record sheet: a heading with its count beside it, then the
/// content. The sheet's body spaces its sections (`gap-6`); nothing here sets a
/// margin of its own.
export function SheetSection({
  title,
  aside,
  children,
}: {
  title: React.ReactNode
  aside?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section>
      <h3 className="mb-2 flex items-baseline gap-2 text-[1rem] font-medium text-ink">
        {title}
        {aside !== undefined && (
          <span className="text-[0.9375rem] font-normal text-mute tabular-nums">
            {aside}
          </span>
        )}
      </h3>
      {children}
    </section>
  )
}

/// Rows in a sheet: hairlines between them, no card around them — a sheet is
/// already the surface.
export function RowList({ children }: { children: React.ReactNode }) {
  return (
    <ul className="divide-y divide-hairline border-y border-hairline">
      {children}
    </ul>
  )
}

/// One row of a `RowList`: a name over a quiet line at the left, a figure (and
/// a quiet line under it) at the right.
export function Row({
  title,
  sub,
  figure,
  figureSub,
  leading,
  tone,
}: {
  title: React.ReactNode
  sub?: React.ReactNode
  figure?: React.ReactNode
  figureSub?: React.ReactNode
  leading?: React.ReactNode
  /// A figure that says something is wrong.
  tone?: "bad"
}) {
  return (
    <li className="flex items-start gap-3 py-3">
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block text-[0.9375rem] font-medium break-words text-ink">
          {title}
        </span>
        {sub !== undefined && sub !== null && (
          <span className="mt-0.5 block text-[0.875rem] break-words text-mute">
            {sub}
          </span>
        )}
      </span>
      {figure !== undefined && (
        <span className="flex shrink-0 flex-col items-end text-right tabular-nums">
          <span
            className={cn(
              "text-[0.9375rem] font-medium",
              tone === "bad" ? "text-bad-fg" : "text-ink",
            )}
          >
            {figure}
          </span>
          {figureSub !== undefined && (
            <span
              className={cn(
                "text-[0.875rem]",
                tone === "bad" ? "text-bad-fg" : "text-mute",
              )}
            >
              {figureSub}
            </span>
          )}
        </span>
      )}
    </li>
  )
}

/// An id somebody may have to read out over the phone to head office: mono,
/// and allowed to break anywhere, because a 24-character EPC does not fit a
/// phone's column and must not push the page sideways.
export function Code({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-id break-all text-body">{children}</span>
  )
}

/// The garment in hand, as a 64px tile: its photograph when the node holds
/// one, a quiet glyph when it does not. Not the catalogue's "No photograph"
/// sentence — at this size it breaks mid-word, and a tile the size of a thumb
/// only has to say "this is a garment".
export function Thumb({ sku, has }: { sku: string; has: boolean }) {
  return (
    <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-inner bg-soft-2 text-line-ico">
      {has ? (
        <Photograph sku={sku} has className="px-1" />
      ) : (
        <Shirt aria-hidden className="size-6 stroke-[1.4]" />
      )}
    </span>
  )
}

// ── The places ──────────────────────────────────────────────────────────────

const POOL_GLYPH: Record<PlaceCode, React.ReactNode> = {
  warehouse: <Boxes />,
  floor: <Store />,
  reject: <Trash />,
}

/// A pool's glyph, filling the card's 64px media slot — the same tile on every
/// screen, so a pool looks like the same thing wherever it turns up.
export function PoolGlyph({ code }: { code: PlaceCode | null }) {
  return (
    <span
      aria-hidden
      className="grid size-full place-items-center text-line-ico [&_svg]:size-7 [&_svg]:stroke-[1.4]"
    >
      {code === null ? <Boxes /> : POOL_GLYPH[code]}
    </span>
  )
}

const CHIP =
  "inline-flex min-w-0 max-w-full items-baseline gap-1 rounded-full border px-2 py-px text-pill leading-[1.35rem]"

/// One end of a movement, as a chip — the hub's route chip, cut to one shop.
///
/// The hub's chip carries the site in front of the shelf; here every place
/// is this shop's, so the site would be the same word on every row. A place
/// outside the shop — a customer, a delivery, a write-off — is drawn dashed
/// and grey, because the piece is crossing the shop's walls rather than moving
/// about inside them.
export function PlaceChip({ id, cause }: { id: string; cause?: string }) {
  const place = readPlace(id, cause)
  return (
    <span
      title={id}
      className={cn(
        CHIP,
        place.inside
          ? "border-hairline-2 bg-soft-2 text-text"
          : "border-dashed border-hairline-2 text-mute",
      )}
    >
      <span className="min-w-0 truncate">{place.name}</span>
      {place.state !== null && (
        <span className="shrink-0 text-warn-fg">{place.state}</span>
      )}
    </span>
  )
}

/// Out of here, into there — one line and one arrow. The chips shrink and the
/// arrow does not, so a long name truncates inside its own chip rather than
/// pushing the columns to its right out of line.
export function Route({
  from,
  to,
  cause,
  className,
}: {
  from: string
  to: string
  cause?: string
  className?: string
}) {
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-1.5 overflow-hidden",
        className,
      )}
    >
      <PlaceChip id={from} cause={cause} />
      <ArrowRight aria-hidden className="size-3.5 shrink-0 text-line-ico" />
      <PlaceChip id={to} cause={cause} />
    </span>
  )
}
