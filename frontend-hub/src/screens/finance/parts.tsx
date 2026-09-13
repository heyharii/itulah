import { Combobox } from "@base-ui/react/combobox"
import { useQuery } from "@tanstack/react-query"
import { Check as CheckIcon, ChevronDown, X } from "lucide-react"
import { useMemo, useState } from "react"

import { Day } from "@/components/ui/day"
import { Input, Select } from "@/components/ui/field"
import { Meter } from "@/components/ui/meter"
import { Tag } from "@/components/ui/tag"
import { ITEM, POPUP } from "@/lib/filter-chrome"
import { money } from "@/lib/format"
import { financeKeys, searchAccounts } from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import {
  useLocations,
  useMeaningLabel,
  useSiteName,
  useSupplierName,
  useSuppliers,
  type AsOf,
  type DateWindow,
} from "@/screens/finance/hooks"
import type { LedgerAccount, Supplier } from "@itulah/contract"

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
/// shared component with a module hidden inside it.
///
/// The hooks those three call — and the module's date vocabulary,
/// `useAsOf` and `useWindow` — live in `hooks.ts` rather than here. Not
/// taste: a file exporting both components and hooks loses fast refresh, so
/// editing a component in this file would remount every screen holding one of
/// those hooks.

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

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

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
  /// Locations this particular field cannot take. One caller so far: an asset
  /// transfer, whose destination is every location *but* the one it is at —
  /// the database refuses a move to where a thing already is, because that
  /// entry debits and credits the same account at the same location, which
  /// balances perfectly and is a lie. An option whose only outcome is a refusal
  /// is better not offered.
  exclude,
  className,
  ...props
}: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange"> & {
  value: string
  onChange: (siteId: string) => void
  emptyLabel?: string
  exclude?: readonly string[]
}) {
  const map = useLocations()
  const locations = (map.data?.locations ?? []).filter(
    (row) => !(exclude ?? []).includes(row.site_id)
  )
  // A value the list does not carry — a site that has been renamed away, or a
  // draft reopened before the list arrived — is shown as itself rather than
  // silently reset to "every location". Losing somebody's answer while a
  // request is in flight is worse than an ugly option for one render.
  const unknown =
    value !== "" && !locations.some((row) => row.site_id === value)

  return (
    // Wrapped, and the wrapper is the whole point of this element.
    //
    // `<Select>` draws a `w-full` span around the native control so that a
    // `<Field>` gets a full-width picker. In a `<Toolbar>` — which is
    // `flex-wrap` — that `w-full` claims the entire row, so a location select
    // beside a date box pushed itself onto a line of its own and floated its
    // chevron out at the far right of the page. Every finance toolbar with
    // both was three rows tall.
    //
    // The width has to be constrained *outside* that span, and the class the
    // caller passes is a width, so it goes on both: the wrapper to size the
    // row, the select to fill it. Height flows the other way — the select is
    // the tallest thing in the wrapper — so `h-8` needs no help.
    <span className={cn("inline-flex w-full shrink-0", className)}>
      <Select
        value={value}
        onChange={(next) => onChange(next)}
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
    </span>
  )
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
// Suppliers and meanings
// ---------------------------------------------------------------------------

/// One supplier id, printed as the client's name for it.
///
/// The sibling of `<SiteName>`, and here for the same reason: a `supplier_id`
/// is a uuid, and a uuid in a column headed "Supplier" is a cell nobody can
/// read. The id stays in `title`, because that is what a support conversation
/// and every other screen's URL will be about.
export function SupplierName({
  id,
  /// The name the row was carrying, when it carries one.
  ///
  /// A bill records the name it was invoiced under, and that is the name on the
  /// paper — worth preferring over today's master list for a supplier that has
  /// since been renamed. Rows that carry nothing (a delivery, an allocation)
  /// leave it out and get the lookup.
  name,
  className,
}: {
  id: string | null | undefined
  name?: string | null
  className?: string
}) {
  const lookup = useSupplierName()
  if (id === null || id === undefined || id === "") {
    return <span className={cn("text-faint", className)}>—</span>
  }
  return (
    <span className={className} title={id}>
      {name ?? lookup(id)}
    </span>
  )
}

/// The chrome a picker wears in a form: an `<Input>`, to the pixel.
///
/// `ui/pick.tsx` draws its own combobox on a `bg-canvas` pill with a hairline,
/// which is right in a table cell and wrong here — this one stands in a grid
/// beside four `<Input>`s, and a control that is a different colour and two
/// pixels shorter than the box above it reads as a different kind of thing.
const PICKER_FIELD =
  "flex h-9 w-full items-center gap-2 rounded-full border border-transparent bg-soft-2 px-3.5 text-[0.84375rem] text-ink transition-colors hover:border-hairline-2 hover:bg-soft-3 has-[input:focus-visible]:border-line"

/// Choose one of the client's suppliers, by name or by code.
///
/// This replaced a text box labelled "Supplier id" and a second one beside it
/// for the name — which was not a form field, it was an exam. A `supplier_id`
/// is a uuid; nobody knows one, nobody can check one they have pasted, and the
/// only way to find one was to open another module, open a supplier and copy it
/// out of the address bar. Worse, the two boxes could disagree: the name was
/// free text and went to the server as the name of whatever uuid was in the box
/// next door, so one bad paste files an invoice under the right name and the
/// wrong debt.
///
/// One control now, and it sets both. The name is no longer somebody's typing —
/// it is the master list's, recorded on the bill as the name the supplier was
/// invoiced under at the time.
///
/// Thirty rows, so the whole list is fetched and matched in the browser —
/// deliberately not `<AccountPicker>`'s bargain, which asks the server on every
/// keystroke because its list is 7,528 accounts and a megabyte of JSON. What is
/// borrowed from it is the part that matters: the code beside the name, the
/// client's own Indonesian never translated, and the id kept in `title` because
/// that is what a support conversation will be about.
export function SupplierPicker({
  /// The chosen `supplier_id`, or `""`.
  value,
  /// Both halves at once, or `null` when the field is cleared. A caller that
  /// stores only the id is storing half an answer.
  onPick,
  placeholder = "Search by name or code",
  className,
  /// For the screen reader, when the visible label is not a `<label>` around
  /// this control.
  label,
}: {
  value: string
  onPick: (supplier: { supplier_id: string; name: string } | null) => void
  placeholder?: string
  className?: string
  label?: string
}) {
  const suppliers = useSuppliers()
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)

  const all = useMemo(() => suppliers.data ?? [], [suppliers.data])
  // Name and code both, because the client's buyers quote both — "SUP26" on a
  // purchase order and "Arjuna" on the telephone. Matched here rather than by
  // the combobox's own filter, which only ever sees `itemToStringLabel`.
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === "") return all
    return all.filter(
      (one) =>
        one.name.toLowerCase().includes(needle) ||
        one.supplier_code.toLowerCase().includes(needle)
    )
  }, [all, query])

  const chosen = all.find((one) => one.supplier_id === value) ?? null

  return (
    <Combobox.Root
      items={rows as Supplier[]}
      filter={null}
      value={chosen}
      onValueChange={(next) => {
        const supplier = next as Supplier | null
        onPick(
          supplier === null
            ? null
            : { supplier_id: supplier.supplier_id, name: supplier.name }
        )
        setQuery("")
      }}
      // What is chosen while the panel is shut, what is being typed while it is
      // open — `ui/pick.tsx`'s rule, and for its reason: showing the chosen name
      // as a placeholder instead draws it in the muted colour that means
      // "nothing here yet".
      inputValue={open ? query : (chosen?.name ?? "")}
      onInputValueChange={(next) => open && setQuery(next)}
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setQuery("")
      }}
      itemToStringLabel={(one) => (one ? (one as Supplier).name : "")}
      modal={false}
    >
      <Combobox.InputGroup className={cn(PICKER_FIELD, className)}>
        <Combobox.Input
          aria-label={label}
          placeholder={
            suppliers.isPending ? "Reading the supplier list…" : placeholder
          }
          className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-mute"
        />
        {chosen !== null && (
          <button
            type="button"
            aria-label="Clear"
            className="shrink-0 rounded-full p-0.5 text-line-ico hover:bg-soft-3 hover:text-ink"
            onClick={(event) => {
              event.stopPropagation()
              onPick(null)
            }}
          >
            <X className="size-3" />
          </button>
        )}
        <Combobox.Trigger
          aria-label="Open"
          className="shrink-0 text-line-ico hover:text-ink"
        >
          <ChevronDown className="size-3.5" />
        </Combobox.Trigger>
      </Combobox.InputGroup>

      <Combobox.Portal>
        <Combobox.Positioner
          side="bottom"
          align="start"
          sideOffset={6}
          className="z-50 w-[var(--anchor-width)] min-w-[16rem]"
        >
          <Combobox.Popup className={cn(POPUP, "w-full")}>
            <Combobox.List>
              <Combobox.Empty className="px-2.5 py-3 text-center text-meta text-mute">
                {suppliers.isPending
                  ? "Reading the supplier list…"
                  : "No supplier matches."}
              </Combobox.Empty>
              {rows.map((one) => (
                <Combobox.Item
                  key={one.supplier_id}
                  value={one}
                  // The uuid never reaches the page; it stays here, where a
                  // support call can still find it.
                  title={one.supplier_id}
                  className={cn(ITEM, "gap-2")}
                >
                  <Tag>{one.supplier_code}</Tag>
                  <span className="min-w-0 flex-1 truncate text-ink">
                    {one.name}
                  </span>
                  {one.supplier_id === value && (
                    <CheckIcon className="size-3.5 shrink-0 text-line-ico" />
                  )}
                </Combobox.Item>
              ))}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}

/// Where money left by, said the way a person says it.
///
/// A payment stores a meaning and a qualifier — `bank_giro` + `BCA` — and the
/// account those resolve to today. All three are worth drawing and only one of
/// them is worth drawing large: the meaning is what somebody chose, the
/// qualifier is which bank, and the code is the thing an accountant will quote
/// down a telephone. So the code goes in `title` beside the account's own
/// name, exactly as a site id does.
export function AccountMeaning({
  meaning,
  qualifier,
  code,
  name,
  className,
}: {
  meaning: string
  qualifier: string
  code: string | null
  name: string | null
  className?: string
}) {
  const label = useMeaningLabel()
  return (
    <span
      className={cn("min-w-0 truncate", className)}
      title={
        code === null
          ? // Mapped away since the payment was written. Saying so is better
            // than a blank tooltip that reads as a missing feature.
            "No account is mapped for this meaning any more."
          : `${code} ${name ?? ""}`.trim()
      }
    >
      {label(meaning)}
      {qualifier !== "" && <span className="text-mute"> · {qualifier}</span>}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Horizontal bars
// ---------------------------------------------------------------------------

/// "How much of the biggest", ranked, for a handful of named things.
///
/// `<BarSeries>` next door is vertical and belongs to a time axis or to five
/// fixed buckets. This is the other shape finance keeps needing — fourteen
/// locations, seven asset families — where the categories are names rather
/// than an order, and where a vertical axis would thin its own tick labels out
/// and drop the very row somebody was looking for.
///
/// It is `<Meter>` plus a label and a figure, which is what two screens had
/// each written for themselves before this existed. No new primitive: the
/// track, the fill and the clamp are all the kit's.
///
/// # Why the bar is a magnitude and the figure keeps its sign
///
/// The ledger sends credit-natured classes negative, and a track cannot draw a
/// negative. Flipping the sign here would print a figure the column head above
/// it does not, so the bar is scaled on the largest magnitude and the number is
/// drawn exactly as its source holds it.
export function RankedBars({
  rows,
  empty,
  className,
}: {
  rows: readonly {
    readonly key: string
    readonly label: React.ReactNode
    /// The label in full, for a name the column cannot hold.
    ///
    /// The client's class names run to "BEBAN USAHA LAINNYA" and their account
    /// names are longer still, so the column is sized for the ordinary case and
    /// this is what stops the long ones from being a mystery. `title` and not a
    /// wider column: fourteen locations of two-word names should not each take
    /// two lines because one class is nineteen characters.
    readonly title?: string
    readonly value: number
  }[]
  /// What to say when every value is zero. A row of empty tracks says
  /// "fourteen shops hold nothing" in fourteen lines; one sentence says it
  /// once.
  empty: React.ReactNode
  className?: string
}) {
  const ranked = [...rows].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
  const peak = Math.max(...ranked.map((row) => Math.abs(row.value)), 0)

  if (peak === 0) {
    return <p className="text-[0.71875rem] text-mute">{empty}</p>
  }

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {ranked.map((row) => (
        <div
          key={row.key}
          className="flex items-center gap-2.5 text-[0.71875rem]"
        >
          <span className="w-44 shrink-0 truncate text-mute" title={row.title}>
            {row.label}
          </span>
          <Meter
            value={Math.abs(row.value) / peak}
            className="min-w-0 flex-1"
          />
          <span className="w-32 shrink-0 text-right text-ink tabular-nums">
            {money(row.value)}
          </span>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

export function AsOfControl({ asOf }: { asOf: AsOf }) {
  return (
    <label className="flex items-center gap-1.5 text-[0.71875rem] text-mute">
      As at
      <Day
        value={asOf.value}
        onChange={asOf.set}
        className="h-8 w-40"
        label="As at"
      />
    </label>
  )
}

/// The prop is `range` and not `window`: naming a local `window` in a browser
/// app shadows the global, and the day somebody reaches for `window.location`
/// three lines down they get a pair of dates instead.
export function WindowControl({ range }: { range: DateWindow }) {
  return (
    <>
      <Day
        value={range.from}
        onChange={range.setFrom}
        className="h-8 w-40"
        label="From"
      />
      <span className="text-[0.71875rem] text-mute">to</span>
      <Day
        value={range.to}
        onChange={range.setTo}
        className="h-8 w-40"
        label="To"
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
  /// Why this particular field will not take this particular account, in the
  /// caller's own words — or `null` when it will.
  ///
  /// The same argument as `allowGroups`, generalised: an account the server
  /// would refuse is *shown*, disabled, with the reason beside it. Filtering it
  /// out instead makes a chart of 7,528 accounts look like it is missing the
  /// one somebody is holding an invoice for, and the reason they cannot use it
  /// — "that is a payable, not a cost" — is the thing they actually need to
  /// read. The server refuses the same set and says the same thing; this is
  /// what stops anybody having to meet that refusal.
  accept,
}: {
  onPick: (account: { account_code: string; name: string }) => void
  seed?: string
  placeholder?: string
  allowGroups?: boolean
  accept?: (account: LedgerAccount) => string | null
}) {
  const [needle, setNeedle] = useState(seed)
  const trimmed = needle.trim()
  const ready = trimmed.length >= 2

  const results = useQuery({
    queryKey: financeKeys.accountSearch(trimmed, false),
    queryFn: ({ signal }) =>
      searchAccounts(trimmed, { limit: 50 }, signal).then((page) => page.rows),
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
                  // A heading first, because "you cannot post to a heading" is
                  // the answer even when the caller's own rule would also have
                  // refused it, and saying both would be two reasons for one
                  // click that will not happen.
                  const refusal =
                    (account.is_group && !allowGroups ? "heading" : null) ??
                    (accept ? accept(account) : null)
                  return (
                    <button
                      key={`${account.account_code}-${account.site_id ?? ""}`}
                      type="button"
                      disabled={refusal !== null}
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
                      {refusal !== null && (
                        <span className="shrink-0 text-[0.65625rem] text-mute">
                          {refusal}
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
