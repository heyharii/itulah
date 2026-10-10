import { useState } from "react"

import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { FOCUSED, openable } from "@/lib/openable"
import { cn } from "@/lib/utils"

/// The phone's layouts for Finance's wide tables. (The record card, its list
/// and its group headings are the kit's: `components/ui/phone-cards.tsx`.)
///
/// A ledger-shaped table (an account, six columns of figures) is a desk's
/// layout: on a phone it is neither a table you scroll sideways (owner,
/// 2026-10-06: nothing scrolls sideways) nor one the browser can stack well.
/// So on a phone each line is a row or a card that says the ONE figure it is
/// read for, and every other column is a tap away in a sheet. A screen draws
/// these only when `useLayout() === "phone"`; the desk's table stays as it is.

/// A fact in a row's sheet: what the column was called, and what it said.
export interface PhoneFact {
  readonly label: string
  readonly value: React.ReactNode
}

/// A record's other columns, as the sheet a row opens: label over value, two to
/// a line.
export function FactsSheet({
  open,
  onClose,
  title,
  id,
  caption,
  facts,
  footer,
  children,
}: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  id?: React.ReactNode
  caption?: React.ReactNode
  facts: readonly PhoneFact[]
  footer?: React.ReactNode
  /// Anything that does not fit a label and a value.
  children?: React.ReactNode
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={title}
      id={id}
      caption={caption}
      footer={footer}
    >
      <Facts>
        {facts.map((fact, index) => (
          <Fact key={`${index}:${fact.label}`} term={fact.label}>
            {fact.value}
          </Fact>
        ))}
      </Facts>
      {children}
    </Sheet>
  )
}

/// One line of a short ledger on a phone: what it is over what it says, and
/// its amount at the right with a line under it.
export interface PhoneRow {
  readonly key: string
  readonly title: React.ReactNode
  readonly sub?: React.ReactNode
  readonly figure: React.ReactNode
  readonly note?: React.ReactNode
}

/// A few lines of a record's own table — advances paid, invoices gathered —
/// as one list, without columns: the thing and the amount.
export function PhoneRows({ rows }: { rows: readonly PhoneRow[] }) {
  return (
    <ul className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft">
      {rows.map((row) => (
        <li
          key={row.key}
          className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-3 last:border-b-0"
        >
          <div className="min-w-0">
            <div className="text-[0.9375rem] break-words text-ink">
              {row.title}
            </div>
            {row.sub !== undefined && (
              <div className="text-[0.875rem] break-words text-mute">
                {row.sub}
              </div>
            )}
          </div>
          <div className="shrink-0 text-right tabular-nums">
            <div className="text-[0.9375rem] font-medium text-ink">
              {row.figure}
            </div>
            {row.note !== undefined && (
              <div className="text-[0.875rem] text-mute">{row.note}</div>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

/// One line of a statement.
export interface StatementLine {
  readonly key: string
  /// `section` is a tinted band (a class, with its total); `total` closes the
  /// statement; everything else is a `line`.
  readonly kind?: "section" | "line" | "total"
  readonly code?: string
  readonly name: React.ReactNode
  /// How far down the tree it stands, from 0.
  readonly level?: number
  /// The one figure, already formatted.
  readonly figure: React.ReactNode
  readonly tone?: "bad"
  /// The other columns. A line that has some opens a sheet when it is
  /// tapped.
  readonly facts?: readonly PhoneFact[]
}

/// A statement's lines as one list on a phone: the account (indented by how
/// deep it stands) on the left, its amount on the right, and every other
/// column in the sheet a tap opens. One column of figures is all a phone has
/// room to read; the rest is a tap away, not off the edge.
export function PhoneStatement({ lines }: { lines: readonly StatementLine[] }) {
  const [shown, setShown] = useState<StatementLine | null>(null)
  return (
    <>
      <ul className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft">
        {lines.map((line) => {
          const kind = line.kind ?? "line"
          const open =
            line.facts !== undefined && line.facts.length > 0
              ? () => setShown(line)
              : undefined
          return (
            <li
              key={line.key}
              onClick={open}
              {...(open ? { role: "button" as const, ...openable(open) } : {})}
              className={cn(
                "flex items-baseline justify-between gap-3 border-b border-hairline px-4 py-3 last:border-b-0",
                kind === "section" && "bg-soft",
                kind === "total" && "border-t border-t-hairline-strong bg-soft",
                open && cn("cursor-pointer active:bg-soft-2", FOCUSED)
              )}
            >
              <span
                className={cn(
                  "min-w-0 text-[0.9375rem] break-words",
                  kind === "line" ? "text-text" : "font-semibold text-ink"
                )}
                style={{ paddingLeft: `${(line.level ?? 0) * 0.75}rem` }}
              >
                {line.code !== undefined && (
                  <span className="mr-1.5 font-mono text-[0.875rem] font-normal text-mute">
                    {line.code}
                  </span>
                )}
                {line.name}
              </span>
              <span
                className={cn(
                  "shrink-0 text-[0.9375rem] tabular-nums",
                  kind === "line" ? "font-medium" : "font-semibold",
                  line.tone === "bad" ? "text-bad-fg" : "text-ink"
                )}
              >
                {line.figure}
              </span>
            </li>
          )
        })}
      </ul>
      <FactsSheet
        open={shown !== null}
        onClose={() => setShown(null)}
        title={shown?.name ?? ""}
        id={shown?.code}
        facts={shown?.facts ?? []}
      />
    </>
  )
}
