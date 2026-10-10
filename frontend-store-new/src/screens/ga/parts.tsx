import { Menu } from "@base-ui/react/menu"
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  Plus,
  Search,
  X,
  type LucideIcon,
} from "lucide-react"

import { RelayRefusal } from "@/components/central-gate"
import { DockTools } from "@/components/shell/dock-tools"
import { Banner, LoadingState } from "@/components/ui/states"
import { Button } from "@/components/ui/button"
import { Fab } from "@/components/ui/fab"
import { SheetFoot } from "@/components/ui/people-sheet"
import { Screen } from "@/components/ui/screen"
import { Segmented } from "@/components/ui/segmented"
import { Fact, Facts as KitFacts } from "@/components/ui/sheet"
import { count } from "@/lib/format"
import { ITEM, PANEL, POSITIONER } from "@/lib/popup-chrome"
import { useCloudIdentity } from "@/lib/queries/hr"
import { useNodeIdentity } from "@/lib/session"
import { cn } from "@/lib/utils"
import { describeGa, useGaTeam } from "@/screens/ga/state"
import type { EmployeeList } from "@itulah/contract"

// ── The gate ────────────────────────────────────────────────────────────────

/// What a GA screen is handed once the gate is open: which shop this is, and
/// who works there (for turning a login into a full name; `undefined` while it
/// is unread or if this account may not read it).
export interface GaContext {
  readonly site: string
  readonly team: EmployeeList | undefined
}

/// Everything a GA screen needs settled before it may ask head office
/// anything: which shop this is, and whether the person signed in here is one
/// this node can relay for. Whether head office answers is each screen's own
/// error state: the node says so in a sentence when the line is down.
///
/// # The shop is the node's, and there is no picker
///
/// `site` comes from this till's own `/health` and is handed to the screen, so
/// there is exactly one place in the module where "which shop" is decided.
/// Every list is asked with it; a shop's premises are the only premises a
/// shop's till has any business showing.
///
/// # The one primary act
///
/// A screen names the one thing it makes (`primary`: "New repair request"): a
/// filled button in the desk's page header and, on a phone, the round "+" in
/// the dock over the bottom bar (`Fab`) — never a button at the top of the
/// page. It is drawn only once the gate is open: a "New request" button in
/// front of a refusal is a button that can only fail.
///
/// # Moving between GA's screens
///
/// There is no strip of chips: the module's screens are rows of the
/// navigation drawer on a phone and of the panel beside the page on a desk.
export function GaScreen({
  primary,
  children,
}: {
  primary?: {
    /// The entry point's own words: "New {thing}".
    label: string
    onClick: () => void
    icon?: LucideIcon
  }
  children: (context: GaContext) => React.ReactNode
}) {
  const where = useNodeIdentity()
  const session = useCloudIdentity()

  const site = where.data?.site_id ?? null
  const signedIn = session.data !== null
  const ready = site !== null && signedIn
  const team = useGaTeam(ready)

  function body(): React.ReactNode {
    if (where.isPending || session.isPending) {
      return <LoadingState>Checking who is signed in…</LoadingState>
    }
    if (site === null) {
      return (
        <Banner tone="bad">
          This server has no shop set (
          <code className="font-mono">site_id</code>).
        </Banner>
      )
    }
    if (!signedIn) {
      return <RelayRefusal access={session.access} what="General affairs" />
    }
    return children({ site, team })
  }

  const Icon = primary?.icon ?? Plus
  return (
    <Screen
      actions={
        ready && primary !== undefined ? (
          <Button variant="primary" onClick={primary.onClick}>
            <Icon />
            {primary.label}
          </Button>
        ) : undefined
      }
    >
      {/* The phone's one act: the dock's round "+", where the thumb is. */}
      {ready && primary !== undefined && (
        <Fab label={primary.label} icon={Icon} onClick={primary.onClick} />
      )}
      {body()}
    </Screen>
  )
}

// ── List chrome ─────────────────────────────────────────────────────────────

export interface Choice {
  readonly value: string
  readonly label: string
  /// How many rows the choice holds.
  readonly count?: number
}

/// A list's search, status, sort and extra choices — on a phone the dock over
/// the bottom bar (`DockTools`), on a desk a toolbar above the cards.
///
/// One declaration for both, so the two cannot drift: `DockTools` renders
/// nothing off a phone, and the desk's own row is hidden on one (`max-md:`).
/// `status` is the dock's chip (one choice, with counts); anything else a list
/// can be narrowed by goes in `views`, behind the ⚙.
export function ListBar({
  search,
  status,
  sort,
  views,
}: {
  search: {
    value: string
    onChange: (value: string) => void
    /// What is searched: "Search assets".
    label: string
  }
  status?: {
    /// What is chosen — the desk menu's heading.
    title: string
    value: string
    options: readonly Choice[]
    onChange: (value: string) => void
  }
  sort?: {
    value: string
    options: readonly { readonly value: string; readonly label: string }[]
    onChange: (value: string) => void
  }
  views?: readonly {
    readonly title: string
    readonly value: string
    readonly options: readonly {
      readonly value: string
      readonly label: string
    }[]
    readonly onChange: (value: string) => void
  }[]
}) {
  return (
    <>
      <DockTools
        search={search}
        status={status}
        sort={
          sort === undefined
            ? undefined
            : {
                label:
                  sort.options.find((one) => one.value === sort.value)
                    ?.label ?? "",
                directional: false,
                choices: {
                  options: sort.options,
                  value: sort.value,
                  desc: false,
                  onChange: (value) => sort.onChange(value),
                },
              }
        }
        views={views}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 max-md:hidden">
        <DeskSearch {...search} />
        {status !== undefined && (
          <DeskChoice
            title={status.title}
            value={status.value}
            options={status.options}
            onChange={status.onChange}
          />
        )}
        {views?.map((view) => (
          <DeskChoice
            key={view.title}
            title={view.title}
            value={view.value}
            options={view.options}
            onChange={view.onChange}
          />
        ))}
        <span className="flex-1" />
        {sort !== undefined && (
          <ChoiceMenu
            title="Sort by"
            value={sort.value}
            options={sort.options}
            onChange={sort.onChange}
            icon={ArrowUpDown}
            quiet
          />
        )}
      </div>
    </>
  )
}

/// The desk's search box: a glass, the field, and a way to clear it.
function DeskSearch({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (value: string) => void
  label: string
}) {
  return (
    <label className="relative min-w-0 flex-[0_1_18rem]">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-line-ico" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={label}
        aria-label={label}
        enterKeyHint="search"
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

/// One of a few, on a desk: a segmented control while it is three or fewer,
/// a menu past that — a menu never grows a second row.
function DeskChoice({
  title,
  value,
  options,
  onChange,
}: {
  title: string
  value: string
  options: readonly Choice[]
  onChange: (value: string) => void
}) {
  if (options.length <= 3) {
    return (
      <Segmented
        value={value}
        onChange={onChange}
        options={options.map((one) => ({
          value: one.value,
          label:
            one.count === undefined
              ? one.label
              : `${one.label} · ${count(one.count)}`,
        }))}
      />
    )
  }
  return (
    <ChoiceMenu
      title={title}
      value={value}
      options={options}
      onChange={onChange}
    />
  )
}

/// A choice as one menu — the desk's; on a phone every choice is a row of the
/// dock's sheets.
function ChoiceMenu({
  title,
  value,
  options,
  onChange,
  icon: Icon,
  quiet = false,
}: {
  title: string
  value: string
  options: readonly Choice[]
  onChange: (value: string) => void
  icon?: LucideIcon
  quiet?: boolean
}) {
  const current = options.find((one) => one.value === value) ?? options[0]
  return (
    <Menu.Root>
      <Menu.Trigger
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-inner px-3 text-[0.875rem] font-medium transition-colors pointer-coarse:h-11",
          quiet
            ? "text-body hover:bg-soft-2 hover:text-ink data-[popup-open]:bg-soft-2 data-[popup-open]:text-ink"
            : "border border-hairline-2 bg-canvas text-text shadow-soft hover:bg-soft-2 data-[popup-open]:bg-soft-2",
        )}
      >
        {Icon !== undefined && <Icon className="size-4 stroke-[1.7]" />}
        {current?.label}
        <ChevronDown className="size-3.5 text-line-ico" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          side="bottom"
          align={quiet ? "end" : "start"}
          sideOffset={4}
          className={POSITIONER}
        >
          <Menu.Popup className={cn(PANEL, "min-w-[13rem]")}>
            <span className="block px-2 pt-1 pb-1.5 text-[0.875rem] font-medium text-mute">
              {title}
            </span>
            {options.map((one) => {
              const on = one.value === value
              return (
                <Menu.Item
                  key={one.value}
                  onClick={() => onChange(one.value)}
                  className={cn(ITEM, "min-h-9", on && "text-ink")}
                >
                  <span className="grid w-4 shrink-0 place-items-center text-accent">
                    {on && <Check className="size-4" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{one.label}</span>
                  {one.count !== undefined && (
                    <span className="text-body tabular-nums">
                      {count(one.count)}
                    </span>
                  )}
                </Menu.Item>
              )
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

// ── Inside a sheet ──────────────────────────────────────────────────────────

/// A record's facts, label over value, two to a row — the kit's `Facts`
/// (`components/ui/sheet.tsx`) behind `[term, value]` pairs. A pair that is
/// `false`/`null` is left out; a long value (or a third `true`) takes the whole
/// row. Never a disabled input.
export function Facts({
  rows,
}: {
  rows: readonly (
    readonly [React.ReactNode, React.ReactNode, boolean?] | null | false
  )[]
}) {
  return (
    <KitFacts>
      {rows.map((row, index) =>
        row === null || row === false ? null : (
          <Fact
            key={index}
            term={row[0]}
            wide={
              row[2] === true ||
              (typeof row[1] === "string" && row[1].length > 28)
            }
          >
            {row[1]}
          </Fact>
        ),
      )}
    </KitFacts>
  )
}

/// One line of a hairline list: a name over what it is, and one figure or
/// status at the right.
export function ListLine({
  top,
  under,
  end,
}: {
  top: React.ReactNode
  under?: React.ReactNode
  end?: React.ReactNode
}) {
  return (
    <li className="flex items-center justify-between gap-3 border-b border-hairline py-2.5 last:border-b-0">
      <span className="min-w-0">
        <span className="block truncate text-cell font-medium text-ink">
          {top}
        </span>
        {under !== undefined && under !== null && under !== "" && (
          <span className="block truncate text-meta text-mute">{under}</span>
        )}
      </span>
      {end !== undefined && (
        <span className="shrink-0 text-right text-meta text-body tabular-nums">
          {end}
        </span>
      )}
    </li>
  )
}

/// Where a request has got to on its ladder — each rung named, the ones
/// behind ticked, the current one lit, the ones ahead faint. A request that
/// left the ladder (cancelled, rejected) shows a greyed ladder, so it is still
/// readable how far it got; the head's badge says how it ended.
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
    <ol
      className={cn(
        "flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-1.5",
        left && "opacity-50",
      )}
    >
      {flow.map((stage, index) => {
        const done = !left && index < reached
        const current = !left && index === reached
        return (
          <li key={stage} className="flex items-center gap-2">
            <span
              className={cn(
                "grid size-5 shrink-0 place-items-center rounded-full border",
                done && "border-ok bg-ok text-on-dark",
                current && "border-accent bg-accent",
                !done && !current && "border-hairline-2 bg-canvas",
              )}
            >
              {done && <Check className="size-3" />}
              {current && <span className="size-1.5 rounded-full bg-canvas" />}
            </span>
            <span
              className={cn(
                "text-[0.875rem]",
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
  )
}

// ── Forms ───────────────────────────────────────────────────────────────────

/// A question whose answer is not one input — tiles, a segmented choice — in
/// the same label language as `Field`: the label, a red star when an answer is
/// needed, and the refusal under it.
///
/// Not `Field`: that is a `<label>`, and a click on a label would press the
/// first tile inside it.
export function Question({
  label,
  required = false,
  problem,
  children,
}: {
  label: string
  required?: boolean
  problem?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      <span className="text-[0.9375rem] font-medium text-text">
        {label}
        {required && (
          <>
            <span aria-hidden className="ml-0.5 text-bad">
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        )}
      </span>
      {children}
      {problem !== undefined && problem !== null && problem !== false && (
        <span className="text-[0.875rem] text-bad">{problem}</span>
      )}
    </div>
  )
}

/// Tiles that choose one of a few — used where the options are worth seeing
/// all at once (a repair's kind, a supply's category) rather than hidden in a
/// dropdown. A tile is a 44px target; they wrap, never scroll.
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

/// A form's foot: what went wrong, then `[ Cancel ] [ Create … ]` — the one
/// filled button on the right. Goes in a `Sheet`'s `footer`.
///
/// The words are the audit's D4: a new record is **Create {thing}**, an edit
/// **Save changes**; while the write is on its way the label is the present
/// participle ("Creating…").
export function Submit({
  label,
  pendingLabel,
  pending,
  disabled = false,
  error,
  onSubmit,
  onCancel,
}: {
  label: string
  /// What the button says while the write is on its way: "Creating…".
  pendingLabel?: string
  pending: boolean
  disabled?: boolean
  error: unknown
  onSubmit: () => void
  /// Shows a quiet Cancel to the left of the button.
  onCancel?: () => void
}) {
  return (
    <div className="flex flex-col gap-3">
      {error !== null && error !== undefined && (
        <Banner tone="bad">{describeGa(error)}</Banner>
      )}
      <SheetFoot>
        {onCancel !== undefined && (
          <Button variant="quiet" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          variant="primary"
          pending={pending}
          disabled={disabled}
          onClick={onSubmit}
        >
          {pending ? (pendingLabel ?? "Saving…") : label}
        </Button>
      </SheetFoot>
    </div>
  )
}
