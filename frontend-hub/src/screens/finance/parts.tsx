import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { Input, Select } from "@/components/ui/field"
import { Tag } from "@/components/ui/tag"
import { day, money } from "@/lib/format"
import {
  accountMap,
  financeKeys,
  listPeriods,
  searchAccounts,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import { isoDay, todayIso } from "@/screens/finance/chart"

/// The chrome finance needs that `components/ui` does not carry, kept inside
/// the module rather than pushed into the shared layer.
///
/// Deliberately not counted in this sentence any more. It used to open "the
/// three pieces" and then export two — `<Select>` had graduated to
/// `components/ui/field.tsx` and nobody changed the number — which is what a
/// count in prose does the second time somebody edits the file. What matters
/// is the split, and it is this:
///
/// `<Amount>` and `<Check>` are general and would be welcome upstairs the day
/// a second module wants them; System has written its own `<Check>` already,
/// which is an argument for promoting rather than for importing across a
/// module boundary.
///
/// Everything else here is bound to a finance endpoint and belongs nowhere
/// else. `<AccountPicker>`, `<LocationSelect>` and `<SiteName>` each fetch a
/// specific URL, and a shared component that fetches a specific URL is a
/// shared component with a module hidden inside it. `useAsOf` and `useWindow`
/// are the module's date vocabulary: two shapes of question — *what is it
/// worth now* and *what happened between these dates* — so that fourteen
/// screens cannot each invent their own default.

/// Money, with a zero that gets out of the way.
///
/// Most cells in most of these grids are zero — fourteen locations, and a given
/// account is live at three of them. Printing "Rp 0" fourteen times a row makes
/// the numbers that matter impossible to find, so a zero is a dash wherever the
/// caller says the grid is dense. It is still a rendered zero and never a gap:
/// "no cash at store 07" and "we never asked" are different facts.
export function Amount({
  minor,
  muteZero,
  warnNegative,
  className,
}: {
  minor: number | null | undefined
  muteZero?: boolean
  /// A negative is not an error everywhere — a credit-natured account is
  /// negative by nature — so the caller says when it is worth marking.
  warnNegative?: boolean
  className?: string
}) {
  if (muteZero && minor === 0) {
    return <span className="text-faint tabular-nums">—</span>
  }
  return (
    <span
      className={cn(
        "tabular-nums",
        warnNegative && (minor ?? 0) < 0 && "text-bad-fg",
        className
      )}
    >
      {money(minor)}
    </span>
  )
}

/// A yes/no that changes how the page reads, not what it holds.
///
/// A segmented control was here first and said the wrong thing twice over: two
/// pills reading "Active / Including inactive" spend a third of a toolbar
/// announcing that a default is a default, and "All assets / Not assessed"
/// looked like two datasets when the second is a subset of the first. A
/// checkbox says "and also show me…" in the width of a checkbox.
///
/// `disabled` carries a `hint` because a control that cannot be used has to
/// say why on the page — a tooltip is not an explanation on a screen somebody
/// is reading, and a greyed box with nothing beside it reads as broken.
export function Check({
  label,
  hint,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: React.ReactNode
  hint?: React.ReactNode
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <label
        className={cn(
          "inline-flex items-center gap-2 text-[0.78125rem] text-text",
          props.disabled && "opacity-55"
        )}
      >
        <input type="checkbox" className="size-3.5 accent-accent" {...props} />
        {label}
      </label>
      {hint && <span className="text-[0.71875rem] text-mute">{hint}</span>}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

/// The locations the books are kept for.
///
/// `GET /account-map` is the only endpoint that answers this, and it answers it
/// from the chart itself rather than from the list of places a delivery can
/// reach — a location the books are kept for is one that has accounts scoped to
/// it. Every caller here shares the key the Account map screen and the overview
/// already use, so a module full of location pickers is still one request.
///
/// Held for five minutes: the client opens a shop about once a year.
export function useLocations() {
  return useQuery({
    queryKey: financeKeys.accountMap(null),
    queryFn: ({ signal }) => accountMap(undefined, signal),
    staleTime: 5 * 60 * 1000,
  })
}

/// Choose a location, or every location.
///
/// This replaced a free-text box on six screens. The box was not a filter, it
/// was a quiz: the site ids are `dc`, `store-01`… and nothing on any screen
/// said so, so an accountant typing "DC01" or "Store 07" got an empty report
/// and no reason for it. A list of fourteen names cannot be typed wrong.
///
/// The value on the wire is still the `site_id` — the names are the client's
/// and are for reading, never for sending.
export function LocationSelect({
  value,
  onChange,
  /// What the empty option says. A filter means "every location"; a form field
  /// that must be answered says so instead, and the caller's own validation is
  /// what refuses the empty string.
  emptyLabel = "Every location",
  className,
  ...props
}: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange"> & {
  value: string
  onChange: (siteId: string) => void
  emptyLabel?: string
}) {
  const map = useLocations()
  const locations = map.data?.locations ?? []
  // A value the list does not carry — a site that has been renamed away, or a
  // draft reopened before the list arrived — is shown as itself rather than
  // silently reset to "every location". Losing somebody's answer while a
  // request is in flight is worse than an ugly option for one render.
  const unknown = value !== "" && !locations.some((row) => row.site_id === value)

  return (
    <Select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={className}
      {...props}
    >
      <option value="">{emptyLabel}</option>
      {locations.map((location) => (
        <option key={location.site_id} value={location.site_id}>
          {location.name}
        </option>
      ))}
      {unknown && <option value={value}>{value}</option>}
    </Select>
  )
}

/// A `site_id` as the client says it: "Store 07", not `store-07`.
///
/// Falls back to the id, which is the only honest thing to draw for a location
/// the account map does not carry — inventing a label for an id nobody
/// recognises would be worse than showing the id.
export function useSiteName(): (siteId: string | null | undefined) => string {
  const map = useLocations()
  const byId = useMemo(() => {
    const table = new Map<string, string>()
    for (const location of map.data?.locations ?? []) {
      table.set(location.site_id, location.name)
    }
    return table
  }, [map.data])

  return (siteId) =>
    siteId === null || siteId === undefined || siteId === ""
      ? "—"
      : (byId.get(siteId) ?? siteId)
}

/// One site id, printed as its name.
///
/// A component rather than a call so a table's column definitions can stay
/// module-level constants: a cell is a React element, and the lookup belongs
/// inside it. The id stays in `title` — it is what the account codes carry and
/// what a support conversation will be about, so it must remain findable.
export function SiteName({
  id,
  className,
}: {
  id: string | null | undefined
  className?: string
}) {
  const name = useSiteName()
  if (id === null || id === undefined || id === "") {
    return <span className={cn("text-faint", className)}>—</span>
  }
  return (
    <span className={className} title={id}>
      {name(id)}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/// The two shapes of date question finance asks, and nothing else.
///
/// A balance is a moment: *what is this worth as at a date*. A movement is a
/// window: *what happened between two*. Before these, six screens each had a
/// pair of bare `<input type="date">` boxes left blank, every one of them
/// relying on a different server-side default, and none of them saying on the
/// page what date they were actually reporting. Blank is the problem: the
/// reader cannot tell "today" from "the server picked something" from "I
/// forgot to fill this in", and all three look identical.
///
/// So the boxes arrive filled, and the effective answer is always echoed in
/// words. The server's own defaults are untouched — these send what is on
/// screen, which is what the screen says it is sending.
export interface AsOf {
  readonly value: string
  readonly set: (value: string) => void
  /// "As at 02 Sep 2026" — for the screen's existing muted chip.
  readonly chip: string
}

export function useAsOf(): AsOf {
  const [value, setValue] = useState(todayIso)
  return { value, set: setValue, chip: `As at ${day(value)}` }
}

export function AsOfControl({ asOf }: { asOf: AsOf }) {
  return (
    <label className="flex items-center gap-1.5 text-[0.71875rem] text-mute">
      As at
      <Input
        type="date"
        value={asOf.value}
        onChange={(event) => asOf.set(event.target.value)}
        className="h-8 w-40"
        aria-label="As at"
      />
    </label>
  )
}

export interface DateWindow {
  readonly from: string
  readonly to: string
  readonly setFrom: (value: string) => void
  readonly setTo: (value: string) => void
  /// "01 Aug 2026 – 02 Sep 2026".
  readonly chip: string
}

/// A window, defaulting to the month the books are actually being worked in.
///
/// Not the current calendar month: on the third of September an accountant is
/// usually still in August, and the system already knows which month that is —
/// the most recent period somebody opened and has not sealed. Falling back to
/// the first of the current month is right when no period is open at all,
/// because then nothing can be posted anywhere and the calendar is the only
/// honest guess.
///
/// The default follows the periods query until somebody edits a box, and stops
/// the moment they do. No effect and no reset: an answer that rewrites itself
/// under a reader half a second after a list arrives is worse than a stale one.
export function useWindow(): DateWindow {
  const [draft, setDraft] = useState<{ from: string; to: string } | null>(null)

  const periods = useQuery({
    queryKey: financeKeys.periods(),
    queryFn: ({ signal }) => listPeriods(signal),
    staleTime: 60_000,
  })

  const fallback = useMemo(() => {
    const now = new Date()
    const open = (periods.data ?? [])
      .filter((row) => row.status.toUpperCase() === "OPEN")
      .sort((a, b) => b.year * 12 + b.month - (a.year * 12 + a.month))[0]
    const start =
      open === undefined
        ? new Date(now.getFullYear(), now.getMonth(), 1)
        : new Date(open.year, open.month - 1, 1)
    return { from: isoDay(start), to: isoDay(now) }
  }, [periods.data])

  const value = draft ?? fallback

  return {
    from: value.from,
    to: value.to,
    setFrom: (from) => setDraft({ ...value, from }),
    setTo: (to) => setDraft({ ...value, to }),
    chip: `${day(value.from)} – ${day(value.to)}`,
  }
}

/// The prop is `range` and not `window`: naming a local `window` in a browser
/// app shadows the global, and the day somebody reaches for `window.location`
/// three lines down they get a pair of dates instead.
export function WindowControl({ range }: { range: DateWindow }) {
  return (
    <>
      <Input
        type="date"
        value={range.from}
        onChange={(event) => range.setFrom(event.target.value)}
        className="h-8 w-40"
        aria-label="From"
      />
      <span className="text-[0.71875rem] text-mute">to</span>
      <Input
        type="date"
        value={range.to}
        onChange={(event) => range.setTo(event.target.value)}
        className="h-8 w-40"
        aria-label="To"
      />
    </>
  )
}

/// Find one of the client's accounts and choose it.
///
/// The chart is 7,528 accounts and about a megabyte of JSON, so it is never
/// loaded to be filtered in the browser: the server matches codes by prefix and
/// names anywhere, and nothing is asked until two characters are typed. Names
/// are the client's own Indonesian and are never translated — an accountant is
/// looking for "Piutang Affiliasi Pembiayaan CIKUPA", and anything else is a
/// different account as far as they are concerned.
export function AccountPicker({
  onPick,
  seed = "",
  placeholder = "Search the chart by code or name",
  /// Headings cannot be posted to or mapped, so a picker feeding either shows
  /// them and refuses them rather than hiding them — an accountant who cannot
  /// find `10110` at all assumes the search is broken.
  allowGroups = false,
}: {
  onPick: (account: { account_code: string; name: string }) => void
  seed?: string
  placeholder?: string
  allowGroups?: boolean
}) {
  const [needle, setNeedle] = useState(seed)
  const trimmed = needle.trim()
  const ready = trimmed.length >= 2

  const results = useQuery({
    queryKey: financeKeys.accountSearch(trimmed, false),
    queryFn: ({ signal }) => searchAccounts(trimmed, { limit: 50 }, signal),
    enabled: ready,
    // The chart is imported once and then sits for months.
    staleTime: 60_000,
  })

  return (
    <div className="flex flex-col gap-2">
      <Input
        value={needle}
        onChange={(event) => setNeedle(event.target.value)}
        placeholder={placeholder}
      />
      {!ready ? (
        <p className="text-[0.71875rem] text-mute">
          Two characters to search. Codes match from the start, names match
          anywhere.
        </p>
      ) : (
        <div className="max-h-56 overflow-y-auto rounded-inner border border-hairline">
          {queryState(results, {
            loading: "Searching the chart…",
            render: (accounts) =>
              accounts.length === 0 ? (
                <p className="px-3 py-4 text-center text-[0.71875rem] text-body">
                  No account matches “{trimmed}”.
                </p>
              ) : (
                accounts.map((account) => {
                  const refused = account.is_group && !allowGroups
                  return (
                    <button
                      key={`${account.account_code}-${account.site_id ?? ""}`}
                      type="button"
                      disabled={refused}
                      onClick={() =>
                        onPick({
                          account_code: account.account_code,
                          name: account.name,
                        })
                      }
                      className="flex w-full items-center gap-2 border-b border-hairline px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-soft disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      <Tag>{account.account_code}</Tag>
                      <span className="min-w-0 flex-1 truncate text-[0.78125rem] text-ink">
                        {account.name}
                      </span>
                      {account.is_group && (
                        <span className="shrink-0 text-[0.65625rem] text-mute">
                          heading
                        </span>
                      )}
                    </button>
                  )
                })
              ),
          })}
        </div>
      )}
    </div>
  )
}
