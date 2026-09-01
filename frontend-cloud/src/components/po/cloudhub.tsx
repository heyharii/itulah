/* eslint-disable react-refresh/only-export-components -- one file of small
   presentational pieces, deliberately not one file each. */
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { ChevronRight, MoreHorizontal } from "lucide-react"

/// PROVISIONAL — the Cloud Hub list and record vocabulary, scoped to `po/`.
///
/// These are the pieces `procurement-prototype.html` is built out of: the KPI
/// row, the toolbar chips, the identity cell, the row overflow, the card header
/// strip, the key/value rows, the mini-table, the totals ladder, the lifecycle
/// rail, the document trail and the exception row. A shared set of the same
/// names is being written into `src/components/custom/`; when it lands, these
/// go and the imports move — the props are shaped to match the brief's table
/// so that is an import swap rather than a rewrite.
///
/// Every measurement here is the declared px from the prototype divided by 16,
/// because the root is `14.4px`: `rem` lands on the prototype's zoomed pixel
/// and raw `px` does not.

/// A count worth putting above the list, not inside it.
export function KpiStrip({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "mb-[1.125rem] grid grid-cols-2 gap-3 lg:grid-cols-4",
        className,
      )}
    >
      {children}
    </div>
  )
}

/// Hairline, no fill. A KPI that is a filled tile competes with the card under
/// it; the reference paints it white and lets the number carry the weight.
export function Kpi({
  label,
  value,
  note,
  tone = "mute",
}: {
  label: React.ReactNode
  value: React.ReactNode
  /// The line under the figure — what it means, or what is wrong with it.
  note?: React.ReactNode
  tone?: "ok" | "bad" | "mute"
}) {
  return (
    <div className="rounded-[var(--os-r-card,1rem)] border border-[var(--os-hairline,#ececef)] bg-[var(--os-canvas,#fff)] px-[0.875rem] py-[0.8125rem] shadow-[var(--os-shadow-soft,0_1px_2px_rgba(20,20,25,.03))]">
      <div className="text-[0.625rem] font-semibold tracking-[0.04em] text-[var(--os-mute,#a6a6ad)] uppercase">
        {label}
      </div>
      <div className="mt-[0.4375rem] text-[1.4375rem] leading-[1.05] font-semibold tracking-[-0.02em] tabular-nums">
        {value}
      </div>
      {note !== undefined && (
        <div
          className={cn(
            "mt-[0.375rem] text-[0.71875rem] font-semibold",
            tone === "ok"
              ? "text-[var(--os-ok,#36b827)]"
              : tone === "bad"
                ? "text-[var(--os-bad,#d05151)]"
                : "text-[var(--os-mute,#a6a6ad)]",
          )}
        >
          {note}
        </div>
      )}
    </div>
  )
}

/// The row between the screen header and the card: what is being shown on the
/// left, how it is being narrowed on the right.
export function ListToolbar({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "mb-[0.875rem] flex flex-wrap items-center gap-[0.4375rem]",
        className,
      )}
    >
      {children}
    </div>
  )
}

/// The spacer inside a `ListToolbar`. Named rather than inlined so a toolbar
/// reads as left group · gap · right group.
export function ToolbarSpacer() {
  return <span className="flex-1" />
}

/// A toolbar control that is not a button-with-a-job: filter, sort, a date
/// range. `ghost` is the white-on-hairline variant the reference uses when the
/// chip opens something.
export function Chip({
  ghost = false,
  active = false,
  className,
  children,
  ...props
}: React.ComponentProps<"button"> & { ghost?: boolean; active?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex h-[1.875rem] items-center gap-1.5 rounded-full px-[0.6875rem]",
        "text-[0.75rem] font-medium whitespace-nowrap transition-colors",
        "[&_svg]:size-[0.8125rem] [&_svg]:shrink-0 [&_svg]:text-[var(--os-line-ico,#abacb2)]",
        ghost
          ? "border border-[var(--os-hairline-2,#e4e4e8)] bg-[var(--os-canvas,#fff)] hover:bg-[var(--os-soft-2,#f3f3f5)]"
          : "bg-[var(--os-soft-2,#f3f3f5)] hover:bg-[#ececee]",
        active
          ? "text-[var(--os-ink,#1d1d1f)]"
          : "text-[var(--os-text,#46464d)]",
        className,
      )}
    >
      {children}
    </button>
  )
}

/// Identity, said the way the reference says it: a coloured tile carrying the
/// initials, the name, and the id in mono underneath.
///
/// The tile's colour is derived from the id rather than chosen, so the same
/// supplier is the same colour on every screen without anybody maintaining a
/// mapping. These are the categorical accents, which is what they are for —
/// identity, never status.
const TILE_FILLS = [
  "var(--os-accent,#3c52f0)",
  "var(--os-a-violet,#8a6cf0)",
  "var(--os-a-green,#46a06a)",
  "var(--os-a-orange,#e0823c)",
  "var(--os-a-pink,#d65b95)",
  "var(--os-a-blue,#4a82f0)",
]

export function tileFill(seed: string): string {
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0
  }
  return TILE_FILLS[hash % TILE_FILLS.length] as string
}

export function initialsOf(name: string): string {
  const words = name
    .replace(/\b(PT|CV|UD|PD)\b/gi, " ")
    .split(/[\s.·-]+/)
    .filter((word) => word.length > 0)
  if (words.length === 0) return "—"
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()
  return (words[0]![0]! + words[1]![0]!).toUpperCase()
}

export function IdCell({
  name,
  id,
  seed,
}: {
  name: string
  /// Drawn in mono under the name. An identifier, never a sentence.
  id?: React.ReactNode
  /// What the tile's colour and initials are derived from. Defaults to `name`.
  seed?: string
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="grid size-[1.875rem] shrink-0 place-items-center rounded-[var(--os-r-inner,0.5625rem)] text-[0.6875rem] font-semibold text-white"
        style={{ background: tileFill(seed ?? name) }}
      >
        {initialsOf(name)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[0.78125rem] font-medium text-[var(--os-ink,#1d1d1f)]">
          {name}
        </span>
        {id !== undefined && (
          <span className="block truncate font-mono text-[0.6875rem] text-[var(--os-mute,#a6a6ad)]">
            {id}
          </span>
        )}
      </span>
    </div>
  )
}

/// The trailing `⋯` every list row in the reference ends with.
///
/// Pale until hovered, and it stops the click reaching the row — opening the
/// menu is not opening the record.
export function RowActions({
  label = "Row actions",
  items,
}: {
  label?: string
  items: readonly {
    label: string
    onSelect: () => void
    tone?: "default" | "destructive"
  }[]
}) {
  return (
    <div
      className="flex justify-end"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={label}
          className="grid size-[1.5rem] place-items-center rounded-[0.4375rem] text-[var(--os-faint,#d3d3d8)] transition-colors hover:bg-[var(--os-soft-2,#f3f3f5)] hover:text-[var(--os-ink,#1d1d1f)]"
        >
          <MoreHorizontal className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          data-cloudhub=""
          align="end"
          className="min-w-[11.625rem] rounded-[0.6875rem]"
        >
          <DropdownMenuLabel>{label}</DropdownMenuLabel>
          {items.map((item) => (
            <DropdownMenuItem
              key={item.label}
              variant={item.tone}
              onClick={item.onSelect}
            >
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/// The `{soft}` band a data card opens with. Full-bleed, rounded to the card's
/// own top corners, and the body stays white under it.
export function CardHeaderStrip({
  title,
  meta,
  children,
}: {
  title: React.ReactNode
  meta?: React.ReactNode
  /// A trailing control or cross-link.
  children?: React.ReactNode
}) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--os-hairline,#ececef)] bg-[var(--os-soft,#f7f7f8)] px-4 pt-[0.875rem] pb-[0.6875rem]">
      <div className="flex min-w-0 items-baseline gap-2">
        <h3 className="truncate text-[0.875rem] font-semibold tracking-[-0.01em] text-[var(--os-ink,#1d1d1f)]">
          {title}
        </h3>
        {meta !== undefined && (
          <span className="shrink-0 text-[0.75rem] text-[var(--os-mute,#a6a6ad)]">
            {meta}
          </span>
        )}
      </div>
      {children !== undefined && (
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      )}
    </div>
  )
}

/// A section label inside a record panel.
export function PanelLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-[1.125rem] mb-2 text-[0.6875rem] font-semibold tracking-[0.04em] text-[var(--os-mute,#a6a6ad)] uppercase">
      {children}
    </div>
  )
}

/// The quiet paragraph under a section — what the buttons above it will do.
export function PanelNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 text-[0.71875rem] leading-[1.55] text-[var(--os-mute,#a6a6ad)]">
      {children}
    </p>
  )
}

/// One fact per row: label left in `{mute}`, value right in `{ink}`.
export function KeyValueRows({
  rows,
}: {
  rows: readonly { key: React.ReactNode; value: React.ReactNode }[]
}) {
  return (
    <dl>
      {rows.map((row, index) => (
        <div
          key={index}
          className="flex justify-between gap-3 border-b border-[var(--os-hairline,#ececef)] py-2 text-[0.78125rem] last:border-b-0"
        >
          <dt className="shrink-0 text-[var(--os-mute,#a6a6ad)]">{row.key}</dt>
          <dd className="min-w-0 text-right font-medium text-[var(--os-ink,#1d1d1f)] tabular-nums">
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/// The in-card item table. Mono micro-caps belong here and nowhere else.
export function MiniTable({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <table
      className={cn(
        "mt-1 w-full border-collapse text-[0.75rem]",
        // Micro-caps on the header, hairline under every row, numbers right.
        "[&_td]:border-b [&_td]:border-[var(--os-hairline,#ececef)] [&_td]:px-[0.375rem] [&_td]:py-[0.4375rem] [&_td]:text-right [&_td]:align-top [&_td]:text-[var(--os-text,#46464d)]",
        "[&_th]:border-b [&_th]:border-[var(--os-hairline,#ececef)] [&_th]:px-[0.375rem] [&_th]:py-[0.375rem] [&_th]:text-right",
        "[&_th]:font-mono [&_th]:text-[0.625rem] [&_th]:font-medium [&_th]:tracking-[0.03em] [&_th]:text-[var(--os-faint,#d3d3d8)] [&_th]:uppercase",
        "[&_td:first-child]:text-left [&_th:first-child]:text-left",
        "[&_tbody_tr:last-child_td]:border-b-0",
        className,
      )}
    >
      {children}
    </table>
  )
}

/// The name of a line in a mini-table: what it is, then its code underneath.
export function MiniTitle({
  title,
  code,
}: {
  title: React.ReactNode
  code?: React.ReactNode
}) {
  return (
    <>
      <span className="block font-medium text-[var(--os-ink,#1d1d1f)]">
        {title}
      </span>
      {code !== undefined && (
        <span className="block font-mono text-[0.625rem] text-[var(--os-mute,#a6a6ad)]">
          {code}
        </span>
      )}
    </>
  )
}

/// Right-aligned key→value rows under a hairline. Only the last row is `{ink}`.
export function TotalsLadder({
  rows,
  total,
}: {
  rows: readonly { label: React.ReactNode; value: React.ReactNode }[]
  total: { label: React.ReactNode; value: React.ReactNode }
}) {
  return (
    <div className="mt-[0.625rem] border-t border-[var(--os-hairline,#ececef)] pt-2">
      {rows.map((row, index) => (
        <div
          key={index}
          className="flex justify-between py-[3px] text-[0.75rem] text-[var(--os-body,#74747b)]"
        >
          <span>{row.label}</span>
          <span className="tabular-nums">{row.value}</span>
        </div>
      ))}
      <div className="mt-1 flex justify-between border-t border-[var(--os-hairline,#ececef)] pt-[0.4375rem] text-[0.75rem] font-semibold text-[var(--os-ink,#1d1d1f)]">
        <span>{total.label}</span>
        <span className="tabular-nums">{total.value}</span>
      </div>
    </div>
  )
}

export type LifecycleState = "done" | "current" | "todo"

/// Where the record is in its own life, on one line.
export function Lifecycle({
  steps,
}: {
  steps: readonly { label: string; state: LifecycleState }[]
}) {
  return (
    <div className="mt-[2px] mb-4 flex flex-wrap items-center gap-y-2">
      {steps.map((step, index) => (
        <div key={step.label} className="flex flex-1 items-center">
          <span
            className={cn(
              "flex shrink-0 items-center gap-[0.3125rem] text-[0.65625rem] font-semibold whitespace-nowrap",
              step.state === "done"
                ? "text-[var(--os-text,#46464d)]"
                : step.state === "current"
                  ? "text-[var(--os-ink,#1d1d1f)]"
                  : "text-[var(--os-mute,#a6a6ad)]",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "grid size-[1.0625rem] shrink-0 place-items-center rounded-full text-[0.5625rem]",
                step.state === "done"
                  ? "bg-[var(--os-ok-bg,#d9f4d2)] text-[var(--os-ok,#36b827)]"
                  : step.state === "current"
                    ? "bg-[var(--os-ink,#1d1d1f)] text-white"
                    : "bg-[var(--os-soft-2,#f3f3f5)] text-[var(--os-faint,#d3d3d8)]",
              )}
            >
              {step.state === "done" ? "✓" : step.state === "current" ? "●" : ""}
            </span>
            {step.label}
          </span>
          {index < steps.length - 1 && (
            <span
              aria-hidden
              className={cn(
                "mx-[0.3125rem] h-[2px] min-w-2 flex-1",
                step.state === "done"
                  ? "bg-[var(--os-ok,#36b827)]"
                  : "bg-[var(--os-hairline,#ececef)]",
              )}
            />
          )}
        </div>
      ))}
    </div>
  )
}

/// What this record is joined to, and how far along each of those has got.
export function DocumentTrail({
  steps,
}: {
  steps: readonly {
    code: string
    title: React.ReactNode
    sub?: React.ReactNode
    amount?: React.ReactNode
    state: LifecycleState
  }[]
}) {
  return (
    <div className="mt-1.5 mb-0.5">
      {steps.map((step, index) => (
        <div key={index} className="relative flex items-center gap-[0.6875rem] py-[0.375rem]">
          {index < steps.length - 1 && (
            <span
              aria-hidden
              className="absolute top-[1.875rem] left-[0.75rem] h-[0.875rem] w-[1.5px] bg-[var(--os-hairline-2,#e4e4e8)]"
            />
          )}
          <span
            aria-hidden
            className={cn(
              "z-[1] grid size-[1.5625rem] shrink-0 place-items-center rounded-[0.4375rem] font-mono text-[0.53125rem] font-semibold",
              step.state === "done"
                ? "bg-[var(--os-ok-bg,#d9f4d2)] text-[var(--os-ok,#36b827)]"
                : step.state === "current"
                  ? "bg-[var(--os-accent,#3c52f0)] text-white"
                  : "bg-[var(--os-soft-2,#f3f3f5)] text-[var(--os-faint,#d3d3d8)]",
            )}
          >
            {step.code}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[0.78125rem] font-medium text-[var(--os-ink,#1d1d1f)]">
              {step.title}
            </span>
            {step.sub !== undefined && (
              <span className="block truncate text-[0.6875rem] text-[var(--os-mute,#a6a6ad)]">
                {step.sub}
              </span>
            )}
          </span>
          {step.amount !== undefined && (
            <span className="shrink-0 text-[0.75rem] whitespace-nowrap text-[var(--os-body,#74747b)] tabular-nums">
              {step.amount}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

/// The buttons that belong to a record, inside its card.
///
/// The first is the one black CTA; every other action on the surface is ghost.
/// A row of equally dark buttons is a row with no answer to "what now".
export function ActionRow({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {children}
    </div>
  )
}

/// One blocked thing, in a queue of blocked things.
///
/// Deliberately one line high: the queue is read by scanning it, and a row that
/// carries its own explanation and its own form is a row nobody scans.
export function ExceptionRow({
  tone = "warn",
  icon,
  title,
  sub,
  amount,
  status,
  open = false,
  onToggle,
  children,
}: {
  tone?: "ok" | "warn" | "bad" | "info" | "neutral"
  icon?: React.ReactNode
  title: React.ReactNode
  sub?: React.ReactNode
  amount?: React.ReactNode
  status?: React.ReactNode
  /// Whether the decision under the row is showing.
  open?: boolean
  onToggle?: () => void
  /// The decision itself, revealed under the row rather than beside it.
  children?: React.ReactNode
}) {
  const fill = {
    ok: "bg-[var(--os-ok-bg,#d9f4d2)] text-[var(--os-ok,#36b827)]",
    warn: "bg-[var(--os-warn-bg,#faeacd)] text-[var(--os-warn,#c9892e)]",
    bad: "bg-[var(--os-bad-bg,#fbeaea)] text-[var(--os-bad,#d05151)]",
    info: "bg-[var(--os-info-bg,#ddebfa)] text-[var(--os-info,#2f86d8)]",
    neutral: "bg-[var(--os-soft-2,#f3f3f5)] text-[var(--os-body,#74747b)]",
  }[tone]
  return (
    <li className="border-b border-[var(--os-hairline,#ececef)] last:border-b-0">
      <div
        role={onToggle === undefined ? undefined : "button"}
        tabIndex={onToggle === undefined ? undefined : 0}
        aria-expanded={onToggle === undefined ? undefined : open}
        onClick={onToggle}
        onKeyDown={
          onToggle === undefined
            ? undefined
            : (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  onToggle()
                }
              }
        }
        className={cn(
          "flex items-center gap-3 px-4 py-[0.6875rem]",
          onToggle !== undefined &&
            "cursor-pointer hover:bg-[var(--os-soft,#f7f7f8)]",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "grid size-[1.875rem] shrink-0 place-items-center rounded-[var(--os-r-inner,0.5625rem)]",
            "[&_svg]:size-4",
            fill,
          )}
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.84375rem] font-medium text-[var(--os-ink,#1d1d1f)]">
            {title}
          </span>
          {sub !== undefined && (
            <span className="block truncate text-[0.75rem] text-[var(--os-mute,#a6a6ad)]">
              {sub}
            </span>
          )}
        </span>
        {amount !== undefined && (
          <span className="shrink-0 text-right text-[0.84375rem] font-semibold whitespace-nowrap tabular-nums">
            {amount}
          </span>
        )}
        {status}
        {onToggle !== undefined && (
          <ChevronRight
            aria-hidden
            className={cn(
              "size-[0.9375rem] shrink-0 text-[var(--os-faint,#d3d3d8)] transition-transform",
              open && "rotate-90",
            )}
          />
        )}
      </div>
      {open && children !== undefined && (
        <div className="px-4 pt-1 pb-3.5">{children}</div>
      )}
    </li>
  )
}

/// A labelled control. The label is the eyebrow; the control keeps the themed
/// height, which is why nothing here sets one.
export function Field({
  label,
  htmlFor,
  hint,
  className,
  children,
}: {
  label: React.ReactNode
  htmlFor?: string
  /// One line under the control saying what it does to the record.
  hint?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("flex min-w-0 flex-col", className)}>
      <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
      {children}
      {hint !== undefined && (
        <p className="mt-1.5 text-[0.65625rem] text-[var(--os-mute,#a6a6ad)]">
          {hint}
        </p>
      )}
    </div>
  )
}

export function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string
  children: React.ReactNode
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-[0.3125rem] block text-[0.625rem] font-semibold tracking-[0.04em] text-[var(--os-mute,#a6a6ad)] uppercase"
    >
      {children}
    </label>
  )
}

/// A word about a thing, in the mono micro-cap the reference uses for tags.
/// Tinted, never inverted — an inverted chip is the one black CTA's job.
export function MiniTag({
  tone = "neutral",
  className,
  children,
  ...props
}: React.ComponentProps<"span"> & { tone?: "neutral" | "accent" }) {
  return (
    <span
      {...props}
      className={cn(
        "inline-flex h-[1.125rem] shrink-0 items-center rounded-[0.375rem] px-[0.4375rem]",
        "font-mono text-[0.625rem] font-semibold whitespace-nowrap",
        tone === "accent"
          ? "bg-[var(--os-accent-bg,#e9ebfc)] text-[var(--os-accent,#3c52f0)]"
          : "bg-[var(--os-soft-2,#f3f3f5)] text-[var(--os-body,#74747b)]",
        className,
      )}
    >
      {children}
    </span>
  )
}
