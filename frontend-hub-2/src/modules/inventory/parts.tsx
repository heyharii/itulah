import { AppLink } from "@/kit/app-link"
import { CheckRow, SearchField } from "@/kit/field"
import { Sheet } from "@/kit/sheet"
import { cn } from "@/lib/cn"
import { useQueryState } from "@/lib/query-state"
import { signed } from "@/modules/inventory/labels"
import type { FleetPool } from "@/modules/inventory/wire"

/// The marks this module draws more than once.
///
/// Components only — the vocabulary and the two clocks live next door in
/// `labels.ts`, which has no JSX and can therefore be imported from a column
/// definition without dragging a component graph along. Splitting them is also
/// what keeps Fast Refresh working on this file.

/// Something that is absent, drawn as absent.
///
/// ## The `why` is the point, and it is not decoration
///
/// This module has three different absences and drawing them alike is the
/// defect the house rule is aimed at: **nought, unknown and not-applicable are
/// three findings, not one.** A pool that lost nothing reports `lost_rate: 0`;
/// a pool that models no loss at all reports `null`; a pool nobody has counted
/// reports nothing anywhere. Printed as `0%` they are indistinguishable and two
/// of the three are a lie.
///
/// So an em dash here carries the reason on hover, the way the `reconciled`
/// column in `modules/finance/payments.tsx` does — it says which question was
/// not asked, so nobody reads the dash as "no".
export function Quiet({
  children = "—",
  why,
}: {
  children?: React.ReactNode
  /// One sentence naming what is missing and why. Omitted only where the
  /// absence is self-evident from the column it sits in.
  why?: string
}) {
  return (
    <span className="text-ink-4" title={why}>
      {children}
    </span>
  )
}

/// An identifier, in the one face identifiers are read in.
///
/// Mono because these are compared character by character — `dc.warehouse`
/// against `dc-01.warehouse`, `EPC00001940` against `EPC00001904` — and a
/// proportional face makes two strings that differ in one glyph look the same
/// length.
export function Ident({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <span className={cn("text-label text-ink-3 font-mono", className)}>
      {children}
    </span>
  )
}

/// A place id, split into the shelf and the state it sits in.
///
/// `store-02.warehouse:on_hand` is one place, but it is two facts, and the
/// second is the interesting half: a movement between the two halves of the
/// same pool is a piece going missing or being found, which reads as a no-op if
/// the suffix is dropped.
///
/// The shelf is a link into the pool it names. `system/lost`,
/// `external/supplier` and `system/opening` are outside the pool grammar
/// entirely and are deliberately not links — stock crossing that line is
/// leaving the company rather than moving inside it, and there is no page for
/// the outside.
export function Place({ id }: { id: string }) {
  const cut = id.lastIndexOf(":")
  if (cut === -1) return <Quiet why="Outside the pool grammar">{id}</Quiet>
  const pool = id.slice(0, cut)
  return (
    <>
      <AppLink
        to="/inventory"
        search={{ pool }}
        className="text-ink-2 hover:text-ink hover:underline"
      >
        {pool}
      </AppLink>
      <span className="text-ink-4">:{id.slice(cut + 1)}</span>
    </>
  )
}

/// A difference, where the sign is the whole reading.
///
/// Nought is grey and drawn as a dash: a count that found exactly what it
/// expected needs nobody, and colouring it green would put a mark on every row
/// that is fine. A shortage is red and a gain is amber, because they are not
/// symmetrical — stock that is missing is a loss and stock that appeared is a
/// record nobody can explain.
export function Delta({ value }: { value: number }) {
  if (value === 0) return <Quiet why="Found exactly what was expected" />
  return (
    <span
      className={cn(
        "font-medium tabular-nums",
        value < 0 ? "text-bad-ink" : "text-warn-ink",
      )}
    >
      {signed(value)}
    </span>
  )
}

/// The sentence under a table that says what the table could not ask.
///
/// Its own mark because this module needs it on six screens and every one of
/// them is the same shape of admission: a cap the endpoint does not let the
/// client set, a figure the ledger does not hold, a filter that does not exist.
export function Caveat({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-line text-meta text-ink-4 shrink-0 border-t px-4 py-2">
      {children}
    </p>
  )
}

/// Which shelf the question is about.
///
/// ## Why a panel rather than a dropdown
///
/// There is no picker in `kit/` at all, and adding one would be a decision for
/// the whole app made from inside one module. There is also no dropdown that
/// would do: a hundred and twelve pools is not a list anybody scans, so it
/// needs its own search box, and **the number beside each row is what makes
/// the choice** — a shelf with nothing on it is not the shelf somebody meant,
/// and its name does not say so. A native `<select>` could offer neither, and
/// its panel belongs to the operating system besides, so the same filter row
/// would be one control on a Mac and a different one on the counter machines
/// these screens are read on.
///
/// Single choice, so a row replaces rather than adds. They are real checkboxes
/// all the same: `CheckRow` is what a keyboard reaches with Tab and what a
/// screen reader announces, and a hand-drawn radio would be neither.
///
/// Three screens share it — Availability, Movements, Sightings — and all three
/// keep the chosen pool in `?pool` and the panel's own filter in `?find`, so a
/// narrowed list is a link somebody can send.
export function PoolPicker({
  open,
  pools,
  chosen,
  onPick,
  onClose,
  subtitle,
  /// The row offered above the list for "no pool at all". Absent where the
  /// endpoint insists on one.
  anyLabel,
}: {
  open: boolean
  pools: readonly FleetPool[]
  chosen: string
  onPick: (id: string) => void
  onClose: () => void
  subtitle: string
  anyLabel?: string
}) {
  const url = useQueryState()
  const typed = url.one("find")
  const needle = typed.toLowerCase()

  const shown = pools.filter(
    (row) =>
      needle === "" ||
      row.id.toLowerCase().includes(needle) ||
      row.label.toLowerCase().includes(needle) ||
      (row.site_name ?? "").toLowerCase().includes(needle),
  )

  return (
    <Sheet open={open} onClose={onClose} title="Which pool" subtitle={subtitle}>
      <div className="border-line shrink-0 border-b p-3">
        <SearchField
          value={typed}
          onChange={(value) => url.set({ find: value || null })}
          placeholder="Filter by site or shelf"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {anyLabel !== undefined && needle === "" && (
          <CheckRow
            checked={chosen === ""}
            onChange={() => onPick("")}
            label={anyLabel}
            count={pools.length}
          />
        )}
        {shown.map((row) => (
          <CheckRow
            key={row.id}
            checked={row.id === chosen}
            onChange={() => onPick(row.id)}
            label={`${row.site_name ?? row.site_id} · ${row.label}`}
            count={row.stock}
          />
        ))}
        {shown.length === 0 && (
          <p className="text-ctl text-ink-3 p-4 text-center">
            No shelf matches that.
          </p>
        )}
      </div>
    </Sheet>
  )
}

// ── inside a sheet ─────────────────────────────────────────────────────────
//
// These four are the same four as `modules/people/parts.tsx`, copied rather
// than imported: one module reaching into another's parts is the coupling that
// makes both impossible to move. They belong in `kit/` the moment a third
// module wants them, and that is the trigger for lifting them — not this one.

/// A record's fields, inside a sheet.
///
/// A description list rather than a grid of divs, because that is what it is:
/// somebody reading with a screen reader gets "Missing from, Floor" as one
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
  /// Across both columns, for a sentence rather than a value.
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
/// counts behind a pool, the lines behind a count.
export function SubHead({
  children,
  note,
}: {
  children: React.ReactNode
  /// What the list below is capped at, where it is. The caps on
  /// `GET /inventory/pools/{id}` are in the SQL and no parameter moves them, so
  /// the only honest thing a screen can do is say the number.
  note?: React.ReactNode
}) {
  return (
    <h2 className="border-line bg-side text-meta text-ink-3 flex items-baseline gap-2 border-y px-[18px] py-1.5 font-medium">
      <span>{children}</span>
      {note !== undefined && (
        <span className="text-ink-4 ml-auto font-normal">{note}</span>
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
  /// The reason, the actor, the date — whatever the line is evidence of.
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
