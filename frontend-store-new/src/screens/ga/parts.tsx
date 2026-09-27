import { Check, ChevronRight, Search, X } from "lucide-react"

import { RelayRefusal } from "@/components/central-gate"
import { AppLink } from "@/components/ui/app-link"
import { Input } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { Screen } from "@/components/ui/screen"
import { Banner } from "@/components/ui/states"
import { count } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { allModules, visibleSections } from "@/lib/navigation"
import { useCloudIdentity } from "@/lib/queries/hr"
import { useNodeIdentity } from "@/lib/session"
import { cn } from "@/lib/utils"

// ── The gate ────────────────────────────────────────────────────────────────

/// Everything a GA screen needs settled before it may ask head office
/// anything: which shop this is, and whether the person signed in here is one
/// this node can relay for. Whether head office answers is each screen's own
/// error state: the node says so in a sentence when the line is down.
///
/// # The shop is the node's, and there is no picker
///
/// `site` comes from this till's own `/health` and is handed to the screen as
/// an argument, so there is exactly one place in the module where "which shop"
/// is decided. Every list is asked with it; a shop's premises are the only
/// premises a shop's till has any business showing.
///
/// # Why this is its own gate and not `CentralGate`
///
/// The question is the same one `CentralGate` asks, and the refusal is its
/// `RelayRefusal` — but a GA screen draws its module strip on a phone in every
/// state, so somebody refused on Contracts can still reach Assets without
/// opening the drawer.
///
/// # The header is the screen's, drawn here
///
/// `sub` says what the screen is for; `actions` is its one primary act, drawn
/// only once the gate is open — a "New request" button in front of a refusal
/// is a button that can only fail. The header is desk-only, so on a phone the
/// act stands under the strip instead.
export function GaScreen({
  sub,
  actions,
  children,
}: {
  sub?: React.ReactNode
  actions?: React.ReactNode
  children: (site: string) => React.ReactNode
}) {
  const where = useNodeIdentity()
  const session = useCloudIdentity()

  const site = where.data?.site_id ?? null
  const signedIn = session.data !== null
  const ready = site !== null && signedIn

  function body(): React.ReactNode {
    if (where.isPending || session.isPending) {
      return <Quiet>Checking who is signed in…</Quiet>
    }
    if (site === null) {
      return (
        <Banner tone="bad">
          This till has not been told which shop it is standing in, so there is
          no place to ask head office about. The node reports no{" "}
          <code className="font-mono">site_id</code>; that is a setting on the
          machine behind the counter, not something this screen can choose.
        </Banner>
      )
    }
    if (!signedIn) {
      return (
        <RelayRefusal
          access={session.access}
          what="General affairs — this shop's assets, contracts, repairs and supplies —"
        />
      )
    }
    return children(site)
  }

  return (
    <Screen sub={sub} actions={ready ? actions : undefined}>
      <GaStrip />
      {ready && actions !== undefined && (
        <div className="mb-4 flex flex-wrap gap-2 md:hidden [&>*]:flex-1">
          {actions}
        </div>
      )}
      {body()}
    </Screen>
  )
}

function Quiet({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[28em] px-4 py-12 text-center">
      <p className="text-meta text-body">{children}</p>
    </div>
  )
}

/// The module's own screens, below `md` only — the People strip's twin.
///
/// On a phone the sidebar is a drawer behind the last tab, and moving between
/// six related screens by opening it each time is five taps too many. Above
/// `md` the sidebar is already showing these rows, and a second copy would be
/// the duplication that rule exists to prevent. Read from the registry, so a
/// screen added to GA appears here without anybody remembering this file.
function GaStrip() {
  const module = allModules.find((one) => one.id === "ga")
  if (module === undefined) return null
  const items = visibleSections(module).flatMap((section) => section.items)
  return (
    <nav
      aria-label="General affairs"
      className="-mx-4 mb-4 flex [scrollbar-width:none] gap-1.5 overflow-x-auto px-4 py-1 md:hidden [&::-webkit-scrollbar]:hidden"
    >
      {items.map((item) => {
        const Icon = item.icon
        return (
          <AppLink
            key={item.path}
            to={item.path}
            activeOptions={{ exact: item.path === module.home }}
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

// ── List chrome ─────────────────────────────────────────────────────────────

/// The row above a list: filters on the left, search on the right; stacked
/// on a phone.
export function Toolbar({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-3">
      {children}
    </div>
  )
}

/// A row of filter chips with their counts — the hub's build chips, as
/// buttons rather than links because a shop's filter is a reading of one
/// screen, not a bookmarkable place. It scrolls sideways on a phone rather
/// than wrapping into three ragged lines.
export function ChipRow<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly {
    readonly value: T
    readonly label: string
    readonly count: number
    readonly icon?: React.ComponentType<{ className?: string }>
  }[]
  value: T
  onChange: (next: T) => void
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="-mx-4 flex min-w-0 [scrollbar-width:none] items-center gap-1.5 overflow-x-auto px-4 py-0.5 md:mx-0 md:flex-wrap md:px-0 [&::-webkit-scrollbar]:hidden"
    >
      {options.map((option) => {
        const on = option.value === value
        const Glyph = option.icon
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-2 rounded-full border px-3 text-meta font-medium whitespace-nowrap transition-colors pointer-coarse:h-tap",
              on
                ? "border-accent bg-accent-bg text-accent"
                : "border-hairline-2 bg-canvas text-text hover:bg-soft",
            )}
          >
            {Glyph !== undefined && (
              <Glyph
                className={cn(
                  "size-4 stroke-[1.7]",
                  on ? "text-accent" : "text-line-ico",
                )}
              />
            )}
            {option.label}
            <span
              className={cn(
                "text-pill tabular-nums",
                on ? "text-accent" : "text-mute",
              )}
            >
              {count(option.count)}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/// The list's search box: a glass, the field, and a way to clear it. The
/// hub's compact field under a mouse; the touch floor and 16px type under a
/// finger, because iOS zooms the page into any smaller field.
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
    <div className="relative shrink-0 md:w-64">
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-line-ico" />
      <Input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        enterKeyHint="search"
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

// ── The list ────────────────────────────────────────────────────────────────

export interface RowColumn<T> {
  readonly id: string
  readonly header: string
  readonly cell: (row: T) => React.ReactNode
  readonly align?: "left" | "right"
  readonly className?: string
  /// What the column becomes in a phone's row. The first column is the title
  /// unless it says otherwise; anything unstated is a line of context.
  readonly card?: "title" | "status" | "meta" | "hide"
}

/// A list whose rows open a record sheet — `ListTable`'s drawing (the hub's
/// data table: a `{soft}` heading band, hairline rows, a tint under the
/// pointer), with the row opening a sheet instead of unfolding in place.
///
/// A sheet because a GA record carries more than a row can unfold into —
/// an asset's history and papers, a repair's ladder, the form to report a
/// problem — and because that is how the hub's GA opens the same records.
///
/// On a phone the same declaration reads as a stack of rows: title and status
/// on the first line, the context under it. A row is a 44px target at least.
export function RowTable<T>({
  rows,
  columns,
  rowKey,
  onOpen,
  empty,
}: {
  rows: readonly T[]
  columns: readonly RowColumn<T>[]
  rowKey: (row: T) => string
  onOpen?: (row: T) => void
  /// Said in place of the rows — the caller's sentence, because an empty
  /// filter and an empty shop are different kinds of nothing.
  empty: React.ReactNode
}) {
  const phone = useLayout() === "phone"

  if (rows.length === 0) {
    return (
      <div className="px-4 py-10 text-center">
        <p className="mx-auto max-w-[28em] text-meta text-body">{empty}</p>
      </div>
    )
  }

  if (phone) {
    const roleOf = (column: RowColumn<T>, index: number) =>
      column.card ?? (index === 0 ? "title" : "meta")
    return (
      <ul>
        {rows.map((row) => {
          const cells = columns.map((column, index) => ({
            column,
            role: roleOf(column, index),
          }))
          const inside = (
            <>
              <span className="flex items-start justify-between gap-2">
                <span className="min-w-0 flex-1">
                  {cells
                    .filter((one) => one.role === "title")
                    .map(({ column }) => (
                      <span
                        key={column.id}
                        className="block text-card-title font-medium text-ink"
                      >
                        {column.cell(row)}
                      </span>
                    ))}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {cells
                    .filter((one) => one.role === "status")
                    .map(({ column }) => (
                      <span key={column.id}>{column.cell(row)}</span>
                    ))}
                </span>
              </span>
              {cells
                .filter((one) => one.role === "meta")
                .map(({ column }) => (
                  <span
                    key={column.id}
                    className="mt-1 block text-meta text-body tabular-nums"
                  >
                    {column.cell(row)}
                  </span>
                ))}
            </>
          )
          return (
            <li
              key={rowKey(row)}
              className="border-b border-hairline last:border-b-0"
            >
              {onOpen === undefined ? (
                <div className="px-3.5 py-3">{inside}</div>
              ) : (
                <button
                  type="button"
                  onClick={() => onOpen(row)}
                  className="block min-h-tap w-full px-3.5 py-3 text-left active:bg-soft"
                >
                  {inside}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full border-collapse text-cell">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                className={cn(
                  "h-10 border-b border-hairline bg-soft px-3.5 py-0 text-eyebrow font-medium whitespace-nowrap text-body",
                  column.align === "right" ? "text-right" : "text-left",
                )}
              >
                {column.header}
              </th>
            ))}
            {onOpen !== undefined && (
              <th
                aria-hidden
                className="h-10 w-10 border-b border-hairline bg-soft"
              />
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onOpen === undefined ? undefined : () => onOpen(row)}
              onKeyDown={
                onOpen === undefined
                  ? undefined
                  : (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        onOpen(row)
                      }
                    }
              }
              tabIndex={onOpen === undefined ? undefined : 0}
              className={cn(
                "h-row border-b border-hairline last:border-b-0 pointer-coarse:h-tap",
                onOpen !== undefined &&
                  "cursor-pointer outline-none hover:bg-soft/60 focus-visible:bg-soft",
              )}
            >
              {columns.map((column) => (
                <td
                  key={column.id}
                  className={cn(
                    "px-3.5 py-2.5 align-middle whitespace-nowrap text-text",
                    column.align === "right" && "text-right",
                    column.className,
                  )}
                >
                  {column.cell(row)}
                </td>
              ))}
              {onOpen !== undefined && (
                <td className="w-10 pr-3 text-right align-middle">
                  <ChevronRight
                    aria-hidden
                    className="inline size-4 text-faint"
                  />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/// Two lines in one cell — the name and what it is — the way the hub's
/// register sets a thing and its number.
export function TwoLine({
  top,
  under,
  icon: Glyph,
}: {
  top: React.ReactNode
  under?: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
}) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {Glyph !== undefined && (
        <span className="grid size-[1.875rem] shrink-0 place-items-center rounded-inner bg-soft-2 text-body max-md:hidden">
          <Glyph className="size-4 stroke-[1.7]" />
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate font-medium text-ink">{top}</span>
        {under !== undefined && under !== null && (
          <span className="block truncate text-meta text-mute">{under}</span>
        )}
      </span>
    </span>
  )
}

// ── Inside a sheet ──────────────────────────────────────────────────────────

/// The two-column fact grid a record opens with — the hub sheet's `Facts`.
export function Facts({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5">{children}</dl>
}

export function Fact({
  term,
  wide = false,
  children,
}: {
  term: React.ReactNode
  /// Spans both columns — an address, a note.
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={cn("min-w-0", wide && "col-span-2")}>
      <dt className="text-[0.75rem] leading-[1.125rem] text-body">{term}</dt>
      <dd
        className={cn(
          "mt-[0.3125rem] text-[0.875rem] leading-[1.375rem] text-ink tabular-nums",
          wide ? "break-words" : "truncate",
        )}
      >
        {children}
      </dd>
    </div>
  )
}

/// A titled block inside a sheet.
export function SheetBlock({
  title,
  aside,
  children,
}: {
  title: React.ReactNode
  aside?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="mt-6 first:mt-0">
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <h3 className="text-card-title font-semibold text-ink">{title}</h3>
        {aside !== undefined && (
          <span className="text-meta text-mute">{aside}</span>
        )}
      </div>
      {children}
    </section>
  )
}

/// Where a request has got to on its ladder — each rung named, the ones
/// behind ticked, the current one lit, the ones ahead faint. A request that
/// left the ladder (cancelled, rejected) says so in bad above a greyed ladder,
/// so it is still readable how far it got.
export function StageLadder({
  flow,
  at,
  words,
  exit,
}: {
  flow: readonly string[]
  at: string
  words: (stage: string) => string
  /// The exit the flow has — CANCELLED, REJECTED — if `at` is it.
  exit?: string
}) {
  const left = exit !== undefined && at === exit
  const reached = flow.indexOf(at)
  return (
    <div>
      {left && (
        <Pill tone="bad" className="mb-2.5">
          {words(at)}
        </Pill>
      )}
      <ol
        className={cn(
          "flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-1.5",
          left && "opacity-50",
        )}
      >
        {flow.map((stage, index) => {
          const done = !left && index < reached
          const current = !left && index === reached
          return (
            <li key={stage} className="flex items-center gap-1.5">
              <span
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full border text-[0.625rem] font-semibold tabular-nums",
                  done && "border-ok bg-ok text-on-dark",
                  current && "border-accent bg-accent text-on-dark",
                  !done && !current && "border-hairline-2 bg-canvas text-mute",
                )}
              >
                {done ? <Check className="size-3" /> : index + 1}
              </span>
              <span
                className={cn(
                  "text-meta",
                  current ? "font-semibold text-ink" : "text-body",
                )}
              >
                {words(stage)}
              </span>
              {index < flow.length - 1 && (
                <span
                  aria-hidden
                  className="mx-1 hidden h-px w-4 bg-hairline-2 sm:inline-block"
                />
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/// A multi-line field in the kit's control language — `{soft-2}` filled,
/// 16px type so a phone does not zoom into it.
export function TextArea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-24 w-full resize-y rounded-inner border border-transparent bg-soft-2 px-4 py-3 text-[1rem] text-ink transition-colors outline-none placeholder:text-mute disabled:opacity-45",
        className,
      )}
      {...props}
    />
  )
}

/// Tiles that choose one of a few — the hub form's `Choices`, at the touch
/// floor. Used where the options are worth seeing all at once (a repair's
/// object, a supply's category) rather than hidden in a dropdown.
export function ChoiceTiles<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly {
    readonly value: T
    readonly label: string
    readonly icon?: React.ComponentType<{ className?: string }>
  }[]
  value: T | null
  onChange: (next: T) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid grid-cols-2 gap-2 sm:grid-cols-3"
    >
      {options.map((option) => {
        const on = option.value === value
        const Glyph = option.icon
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex min-h-tap items-center gap-2 rounded-inner border px-3 py-2 text-left text-meta font-medium transition-colors",
              on
                ? "border-accent bg-accent-bg text-accent"
                : "border-hairline-2 bg-canvas text-text hover:bg-soft",
            )}
          >
            {Glyph !== undefined && (
              <Glyph
                className={cn(
                  "size-4 shrink-0 stroke-[1.7]",
                  on ? "text-accent" : "text-line-ico",
                )}
              />
            )}
            <span className="min-w-0">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
