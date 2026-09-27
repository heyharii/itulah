import { ArrowRight, Boxes, Search, Shirt, Store, Trash, X } from "lucide-react"

import { AppLink } from "@/components/ui/app-link"
import { Input } from "@/components/ui/field"
import { allModules, visibleSections } from "@/lib/navigation"
import { cn } from "@/lib/utils"
import { Photograph } from "@/screens/catalogue"
import { readPlace, type PlaceCode } from "@/screens/stock/shared"

/// The drawn pieces the three Stock screens share. The words behind them are
/// in `shared.ts`.

// ── The frame ───────────────────────────────────────────────────────────────

/// The module's own screens, below `md` only — the GA strip's twin.
///
/// On a phone the sidebar is a drawer behind the last tab, and Stock is a
/// bottom-bar tab that lands on On hand: without this, Receive and Movements
/// are three taps away from somebody standing in the stockroom with a reader.
/// Read from the registry, so a screen added to Stock appears here without
/// anybody remembering this file.
export function StockStrip() {
  const module = allModules.find((one) => one.id === "stock")
  if (module === undefined) return null
  const items = visibleSections(module).flatMap((section) => section.items)
  return (
    <nav
      aria-label="Stock"
      className="-mx-4 mb-4 flex [scrollbar-width:none] gap-1.5 overflow-x-auto px-4 py-1 md:hidden [&::-webkit-scrollbar]:hidden"
    >
      {items.map((item) => {
        const Icon = item.icon
        return (
          <AppLink
            key={item.path}
            to={item.path}
            activeOptions={{ exact: true }}
            className="flex h-11 shrink-0 items-center gap-2 rounded-inner border border-hairline bg-canvas px-3.5 text-nav font-medium text-body shadow-soft data-[status=active]:border-accent/30 data-[status=active]:bg-accent-bg data-[status=active]:font-semibold data-[status=active]:text-accent"
          >
            <Icon className="size-[1.0625rem] shrink-0 stroke-[1.55]" />
            {item.label}
          </AppLink>
        )
      })}
    </nav>
  )
}

/// The row of controls over a list: the filter at the left, the search at
/// the right. Stacked on a phone, where the two cannot share 375px.
export function Toolbar({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-3",
        className,
      )}
    >
      {children}
    </div>
  )
}

/// The list's search box: a glass, the field, and a way to clear it.
///
/// Not the `ScanField`. That one is a scanner's keyboard and keeps the caret;
/// this one narrows a list somebody is reading, and gives the caret back.
export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (next: string) => void
  placeholder: string
}) {
  return (
    <div className="relative md:w-72">
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-line-ico" />
      <Input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        enterKeyHint="search"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        // The hub's compact field on a desk with a mouse; the touch floor, and
        // 16px type, anywhere a finger is — iOS zooms the page into any field
        // set smaller than that.
        className="h-11 pr-11 pl-10 md:pointer-fine:h-9 md:pointer-fine:text-cell [&::-webkit-search-cancel-button]:hidden"
      />
      {value !== "" && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear the search"
          className="absolute top-1/2 right-0 grid size-11 -translate-y-1/2 place-items-center text-line-ico md:pointer-fine:size-9"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}

// ── The detail ──────────────────────────────────────────────────────────────

export function Facts({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-2 gap-x-4 gap-y-3 md:gap-x-6 lg:grid-cols-3",
        className,
      )}
    >
      {children}
    </dl>
  )
}

export function Fact({
  term,
  children,
  wide = false,
  className,
}: {
  term: React.ReactNode
  children: React.ReactNode
  /// Spans the whole panel — for an id too long to share a line.
  wide?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        "min-w-0",
        wide && "col-span-2 lg:col-span-full",
        className,
      )}
    >
      <dt className="text-meta text-mute">{term}</dt>
      <dd className="mt-0.5 text-cell break-words text-ink tabular-nums">
        {children}
      </dd>
    </div>
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

/// A pool's glyph in the hub's small bordered tile — the same tile a record
/// card's strip carries, so a pool looks like the same thing on every screen.
export function PoolGlyph({ code }: { code: PlaceCode | null }) {
  return (
    <span className="grid size-[1.6875rem] shrink-0 place-items-center rounded-inner border border-hairline-2 bg-canvas text-line-ico [&_svg]:size-[0.9375rem]">
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
