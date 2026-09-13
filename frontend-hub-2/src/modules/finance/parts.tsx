import { useMemo } from "react"
import { CalendarDays, MapPin } from "lucide-react"
import type { MoneyOverview } from "@itulah/contract"

import { api, search } from "@/lib/api"
import { cn } from "@/lib/cn"
import { useQuery } from "@tanstack/react-query"

/// The controls three finance screens share, and the one read behind them.
///
/// Lifted here once `journal`, `assets` and `reports` all needed to narrow by
/// location and to stand on a date — and no earlier. Everything drawn is the
/// shape `ledger.tsx` and `aging.tsx` already settled on for their own as-at
/// boxes; this is that shape, named, so a fourth screen cannot invent a fifth.

/// A day, as a control.
///
/// `max` is today on every caller so far and is still a prop: a period-close
/// screen legitimately stands on a future month-end, and a control that refused
/// it would be enforcing a rule nobody wrote down.
export function DayField({
  label,
  value,
  max,
  onChange,
  className,
}: {
  label: string
  value: string
  max?: string
  onChange: (value: string) => void
  className?: string
}) {
  return (
    <label
      className={cn(
        "h-ctl rounded-ctl border-line-2 bg-canvas shadow-btn focus-within:border-blue flex shrink-0 items-center gap-2 border px-2.5",
        className,
      )}
    >
      <CalendarDays className="text-ink-4 size-4 shrink-0" />
      <span className="text-ctl text-ink-4">{label}</span>
      <input
        type="date"
        value={value}
        max={max}
        onChange={(event) => onChange(event.target.value)}
        className="text-ctl text-ink bg-transparent outline-none"
      />
    </label>
  )
}

/// A native `<select>`, dressed as one of this app's controls.
///
/// Native rather than a listbox built out of divs: a select is what a keyboard
/// opens with Space, what a screen reader announces as a select, and what a
/// phone renders as the platform's own wheel. None of those is worth
/// re-implementing for a list of fourteen shops.
export function PickField({
  label,
  icon,
  value,
  onChange,
  children,
  className,
}: {
  label: string
  icon?: React.ReactNode
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <label
      className={cn(
        "h-ctl rounded-ctl border-line-2 bg-canvas shadow-btn focus-within:border-blue flex shrink-0 items-center gap-2 border px-2.5",
        className,
      )}
    >
      {icon}
      <span className="text-ctl text-ink-4">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="text-ctl text-ink min-w-0 bg-transparent outline-none"
      >
        {children}
      </select>
    </label>
  )
}

/// A list of term-and-value rows, for the inside of a record panel.
///
/// Here rather than in `kit/`: four finance panels want it and nothing else in
/// the app does yet. A component promoted before its second caller is a
/// component shaped by one screen's needs.
export function Facts({
  rows,
}: {
  /// Term, value. A `null` value drops the row entirely — "Closed by" on a
  /// month nobody has closed is not an empty field, it is a field that does not
  /// apply, and an empty one invites somebody to wonder what went wrong.
  rows: readonly (readonly [string, React.ReactNode] | null)[]
}) {
  return (
    <dl className="m-0 flex flex-col">
      {rows.map((row) =>
        row === null ? null : (
          <div
            key={row[0]}
            className="border-line flex items-baseline gap-3 border-b py-1.5 last:border-b-0"
          >
            <dt className="text-ctl text-ink-4 w-[10rem] shrink-0">{row[0]}</dt>
            <dd className="text-ctl text-ink-2 m-0 min-w-0 flex-1">{row[1]}</dd>
          </div>
        ),
      )}
    </dl>
  )
}

/// A checkbox that belongs on a toolbar rather than in a filter panel.
///
/// A real `<input type="checkbox">` for the reason `kit/field.tsx`'s `CheckRow`
/// is one: it is what Tab reaches and Space toggles, and what a screen reader
/// announces as checked. This is that control wearing the toolbar's chrome
/// instead of a panel row's, because "and also show me the inactive ones" is a
/// widening of the list somebody is already reading — not a facet with a count.
export function CheckField({
  label,
  checked,
  onChange,
  className,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  className?: string
}) {
  return (
    <label
      className={cn(
        "h-ctl rounded-ctl border-line-2 bg-canvas shadow-btn focus-within:border-blue flex shrink-0 cursor-pointer items-center gap-2 border px-2.5",
        className,
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="border-line-2 bg-canvas checked:border-blue checked:bg-blue size-[15px] shrink-0 appearance-none rounded-[4px] border-[1.5px]"
      />
      <span className="text-ctl text-ink-3">{label}</span>
    </label>
  )
}

/// Every location the books are kept for, with the client's own name for it.
///
/// ## Why this reads the money overview rather than a list of sites
///
/// **There is no locations endpoint on this surface.** The one place the node
/// answers with `BookLocation` is inside `GET /finance/account-map`, and that
/// response also carries 695 mappings — 165 KB — to hand back fourteen names.
/// A select is not worth a sixth of a megabyte.
///
/// `GET /finance/money?limit=1` answers in 1.4 KB with `facets.sites`, which is
/// the same fourteen with the same labels, counted by the server. Asking for one
/// row rather than none is deliberate: the facets are computed over every
/// matching account regardless of the page, so the page size is the cheapest
/// thing to make small.
///
/// The honest caveat: these are the locations that have a MAPPED MONEY ACCOUNT,
/// not the locations the chart is kept for. Today they are the same fourteen. A
/// location whose cash account nobody has mapped would be missing from this
/// select while still owning ledger accounts — which is a reason for a real
/// `GET /sites`, not a reason to load the account map on three screens.
export function useSites() {
  const query = useQuery({
    queryKey: ["finance", "sites"] as const,
    queryFn: ({ signal }) =>
      api.get<MoneyOverview>(
        `/api/v1/finance/money${search({ limit: 1 })}`,
        signal,
      ),
    // The chart of accounts is imported once and then sits for months. A list
    // of shops is not something to re-ask on every screen change.
    staleTime: 10 * 60 * 1000,
  })

  const sites = useMemo(
    () => query.data?.facets.sites ?? [],
    [query.data?.facets.sites],
  )

  const names = useMemo(() => {
    const map = new Map<string, string>()
    for (const site of sites) map.set(site.value, site.label ?? site.value)
    return map
  }, [sites])

  return { sites, names }
}

/// A location select, filled from `useSites`.
///
/// The empty value is "every location" and is the default everywhere — an
/// unstated scope reads as "everything", and here it genuinely is everything,
/// which `kit/scope.tsx` says on the page in words.
export function SitePicker({
  value,
  onChange,
  className,
}: {
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  const { sites } = useSites()
  return (
    <PickField
      label="Unit"
      icon={<MapPin className="text-ink-4 size-4 shrink-0" />}
      value={value}
      onChange={onChange}
      className={className}
    >
      <option value="">Every unit</option>
      {sites.map((site) => (
        <option key={site.value} value={site.value}>
          {site.label ?? site.value}
        </option>
      ))}
      {/* A value the facets do not carry — a stale bookmark, or a location with
          no mapped money account — would otherwise render as the first option
          and silently look like "every unit". Kept as its own option so the URL
          and the control agree. */}
      {value !== "" && !sites.some((site) => site.value === value) && (
        <option value={value}>{value}</option>
      )}
    </PickField>
  )
}

/// A location's name, from the id a row carries.
///
/// Most finance rows carry `site_id` and nothing else — `store-01` is what the
/// account codes are built from and what a support call is about, and it is not
/// what anybody calls the shop. The id stays in `title` for exactly that reason.
export function SiteName({
  id,
  className,
}: {
  id: string | null | undefined
  className?: string
}) {
  const { names } = useSites()
  if (id === null || id === undefined || id === "") {
    // Not a dash. An account with no location is a real and ordinary state in
    // this chart — the headings, and everything kept for the company as a whole
    // — and it is not the same as a location we could not name.
    return <span className={cn("text-ink-4", className)}>Unscoped</span>
  }
  return (
    <span className={className} title={id}>
      {names.get(id) ?? id}
    </span>
  )
}
