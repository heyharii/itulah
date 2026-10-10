import { Combobox } from "@base-ui/react/combobox"
import { useQuery } from "@tanstack/react-query"
import { Check as CheckIcon, ChevronDown, X } from "lucide-react"
import { useMemo, useState } from "react"

import { DockPortal, useDock } from "@/components/shell/dock"
import { Button } from "@/components/ui/button"
import { Day } from "@/components/ui/day"
import { Input, Select } from "@/components/ui/field"
import {
  FORM_BOX,
  FORM_HALO_WITHIN,
  useInForm,
} from "@/components/ui/field-state"
import { SHEET_ROW } from "@/components/ui/list-chrome"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { Meter } from "@/components/ui/meter"
import { BottomSheet } from "@/components/ui/picker-sheet"
import { Tag } from "@/components/ui/tag"
import { ITEM, POPUP } from "@/lib/filter-chrome"
import { count, money } from "@/lib/format"
import { financeKeys, searchAccounts } from "@/lib/queries/finance"
import {
  siteChoices,
  unitLabel,
  useSiteLabel,
  useUnits,
} from "@/lib/queries/organisation"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import {
  useLineCategories,
  useLocations,
  useMeaningLabel,
  useSupplierName,
  useSuppliers,
  useUnitName,
  type AsOf,
  type DateWindow,
} from "@/screens/finance/hooks"
import { supplierDisplayName } from "@/screens/procurement/supplier-format"
import type { LineCategory } from "@/lib/queries/finance"
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
/// else. `<AccountPicker>`, `<CategoryPicker>`, `<UnitSelect>` and
/// `<UnitName>` each fetch a specific URL, and a shared component that fetches
/// a specific URL is a shared component with a module hidden inside it.
///
/// `<AccountAndCategory>` is the one to reach for in a form. Since the chart
/// collapsed to forty accounts, choosing an account is two answers rather than
/// one — the account, and the category its family demands — and which second
/// box to draw, or whether to draw one at all, is decided by the first answer.
/// Six screens deciding that for themselves would be six chances to decide it
/// differently. `<AccountPicker>` on its own is right only where nothing is
/// being posted: a report's filter, or the account a bank statement *is*.
///
/// The hooks those three call — and the module's date vocabulary,
/// `useAsOf` and `useWindow` — live in `hooks.ts` rather than here. Not
/// taste: a file exporting both components and hooks loses fast refresh, so
/// editing a component in this file would remount every screen holding one of
/// those hooks.

/// Money, with a zero that gets out of the way.
///
/// Most cells in most of these grids are zero — fourteen units, and a given
/// account is live in three of them. Printing "Rp 0" fourteen times a row makes
/// the numbers that matter impossible to find, so a zero is a dash wherever the
/// caller says the grid is dense. It is still a rendered zero and never a gap:
/// "no cash in C007's books" and "we never asked" are different facts.
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
// Units and sites
// ---------------------------------------------------------------------------

/// The two things a finance filter can be about, and they are not the same.
///
/// A UNIT keeps books: head office and each store (0605). Everything read off
/// the journal — a ledger, a balance, a statement, money, payments, deposits,
/// bank accounts — is a unit's, and its filter is a `<UnitSelect>`.
///
/// A SITE is premises — the warehouse, a shop. A bill, an asset, a cash count, a
/// payment instruction or a trading day happened at one, and keeps it; its
/// filter is a `<SiteSelect>`. A store's unit and its shop share an id today,
/// head office's unit and the warehouse do not, so the two are never swapped.
///
/// Both replaced a free-text box that was a quiz — the ids are ours and
/// nothing on any screen said what they were. The value on the wire is still
/// the id; the client's code and name are for reading, never for sending.

/// Choose a unit, or all units.
export function UnitSelect({
  value,
  onChange,
  /// What the empty option says. A filter means "all units"; a form field
  /// that must be answered says so instead, and the caller's own validation is
  /// what refuses the empty string.
  emptyLabel = "All units",
  /// Units this particular field cannot take. An option whose only outcome is
  /// a refusal is better not offered.
  exclude,
  className,
  ...props
}: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange"> & {
  value: string
  onChange: (unitId: string) => void
  emptyLabel?: string
  exclude?: readonly string[]
}) {
  const map = useLocations()
  const units = (map.data?.locations ?? []).filter(
    (row) => !(exclude ?? []).includes(row.unit_id)
  )
  return (
    <PickerSelect
      value={value}
      onChange={onChange}
      emptyLabel={emptyLabel}
      options={units.map((unit) => ({
        value: unit.unit_id,
        label: unitLabel(unit),
      }))}
      loading={map.isPending}
      className={className}
      {...props}
    />
  )
}

/// Choose a site, or all sites — for the documents that happened at one.
export function SiteSelect({
  value,
  onChange,
  emptyLabel = "All sites",
  /// Sites this field cannot take. One caller so far: an asset transfer,
  /// whose destination is every site *but* the one it is at — the database
  /// refuses a move to where a thing already is.
  exclude,
  className,
  ...props
}: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange"> & {
  value: string
  onChange: (siteId: string) => void
  emptyLabel?: string
  exclude?: readonly string[]
}) {
  const units = useUnits()
  const sites = siteChoices(units.data ?? []).filter(
    (site) => !(exclude ?? []).includes(site.siteId)
  )
  return (
    <PickerSelect
      value={value}
      onChange={onChange}
      emptyLabel={emptyLabel}
      options={sites.map((site) => ({ value: site.siteId, label: site.label }))}
      loading={units.isPending}
      className={className}
      {...props}
    />
  )
}

function PickerSelect({
  value,
  onChange,
  emptyLabel,
  options,
  loading,
  className,
  ...props
}: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange"> & {
  value: string
  onChange: (value: string) => void
  emptyLabel: string
  options: readonly { readonly value: string; readonly label: string }[]
  loading: boolean
}) {
  // A value the list does not carry — one retired since, or a draft reopened
  // before the list arrived — is kept rather than silently reset to "every":
  // losing somebody's answer while a request is in flight is worse than an
  // odd option for one render.
  const unknown = value !== "" && !options.some((row) => row.value === value)

  return (
    // Wrapped, and the wrapper is the whole point of this element.
    //
    // `<Select>` draws a `w-full` span around the native control so that a
    // `<Field>` gets a full-width picker. In a `<Toolbar>` — which is
    // `flex-wrap` — that `w-full` claims the entire row, so a unit select
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
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
        {unknown && <option value={value}>{loading ? "…" : value}</option>}
      </Select>
    </span>
  )
}

/// One unit id, printed as the client's code and name.
///
/// A component rather than a call so a table's column definitions can stay
/// module-level constants: a cell is a React element, and the lookup belongs
/// inside it.
export function UnitName({
  id,
  className,
}: {
  id: string | null | undefined
  className?: string
}) {
  const name = useUnitName()
  if (id === null || id === undefined || id === "") {
    return <span className={cn("text-faint", className)}>—</span>
  }
  return <span className={className}>{name(id)}</span>
}

/// One site id, printed the way `siteLabel` says it — the owning unit's code
/// and name, and the site's own name where the unit keeps more than one.
export function SiteName({
  id,
  className,
}: {
  id: string | null | undefined
  className?: string
}) {
  const name = useSiteLabel()
  if (id === null || id === undefined || id === "") {
    return <span className={cn("text-faint", className)}>—</span>
  }
  return <span className={className}>{name(id)}</span>
}

// ---------------------------------------------------------------------------
// Suppliers and meanings
// ---------------------------------------------------------------------------

/// One supplier id, printed as the client's name for it.
///
/// The sibling of `<UnitName>`, and here for the same reason: a `supplier_id`
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
      {/* Some reads send the code back as the name when they have none of
          their own; that is not a name, so the register is asked instead. */}
      {lookup(id, name)}
    </span>
  )
}

/// The chrome a picker wears in a form: an `<Input>`, to the pixel.
///
/// `ui/pick.tsx` draws its own combobox, which is right in a table cell and
/// wrong here — this one stands in a grid beside four `<Input>`s, and a
/// control that is a different colour and a few pixels shorter than the box
/// above it reads as a different kind of thing. It had drifted into exactly
/// that — a grey pill, from before the inputs became white boxes — until
/// 2026-09-28, when the forms took the form's box (`FORM_BOX`) and this
/// followed them.
const PICKER_FIELD =
  "flex h-10 w-full items-center gap-2 rounded-inner border border-hairline-2 bg-canvas px-3 text-[0.875rem] text-ink transition-[border-color,box-shadow] hover:border-hairline-strong has-[input:focus-visible]:border-accent"

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
  className,
  /// For the screen reader, when the visible label is not a `<label>` around
  /// this control.
  label,
}: {
  value: string
  /// `supplier_code` rides along because bills, advances and payments carry
  /// the code the buying side gave the supplier, not the register's id.
  onPick: (
    supplier: {
      supplier_id: string
      name: string
      legal_form: string | null
      supplier_code: string
    } | null
  ) => void
  className?: string
  label?: string
}) {
  const suppliers = useSuppliers()
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const form = useInForm() && [FORM_BOX, FORM_HALO_WITHIN]

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
            : {
                supplier_id: supplier.supplier_id,
                name: supplier.name,
                legal_form: supplier.legal_form,
                supplier_code: supplier.supplier_code,
              }
        )
        setQuery("")
      }}
      // What is chosen while the panel is shut, what is being typed while it is
      // open — `ui/pick.tsx`'s rule, and for its reason: showing the chosen name
      // as a placeholder instead draws it in the muted colour that means
      // "nothing here yet".
      inputValue={open ? query : chosen ? supplierDisplayName(chosen) : ""}
      onInputValueChange={(next) => open && setQuery(next)}
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setQuery("")
      }}
      itemToStringLabel={(one) =>
        one ? supplierDisplayName(one as Supplier) : ""
      }
      modal={false}
    >
      <Combobox.InputGroup className={cn(PICKER_FIELD, form, className)}>
        <Combobox.Input
          aria-label={label}
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
                    {supplierDisplayName(one)}
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
/// name.
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
/// units, seven asset families — where the categories are names rather
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
    /// wider column: fourteen units of two-word names should not each take
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
    return <p className="text-[0.875rem] text-mute">{empty}</p>
  }

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {ranked.map((row) => (
        <div
          key={row.key}
          className="flex items-center gap-2.5 text-[0.875rem]"
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
    <label className="flex items-center gap-1.5 text-[0.875rem] text-mute">
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
      <span className="text-[0.875rem] text-mute">to</span>
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
/// What choosing an account hands back.
///
/// `category_family` travels with the code because it is not a property of the
/// screen, it is a property of the account: 6301 takes an `expense_category`
/// and 1102 takes nothing, and a caller that stored only the code would have
/// to ask a second time to find out which.
export interface PickedAccount {
  readonly account_code: string
  readonly name: string
  readonly category_family: string | null
}

export function AccountPicker({
  onPick,
  seed = "",
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
  /// In a filter row: a control-height box whose matches drop over the page
  /// instead of pushing the row open.
  floating = false,
}: {
  onPick: (account: PickedAccount) => void
  seed?: string
  allowGroups?: boolean
  accept?: (account: LedgerAccount) => string | null
  floating?: boolean
}) {
  const [needle, setNeedle] = useState(seed)
  const trimmed = needle.trim()
  const ready = trimmed.length >= 2

  const results = useQuery({
    queryKey: financeKeys.accountSearch(trimmed, true),
    queryFn: ({ signal }) =>
      // Include retired accounts so the picker can explain why an exact
      // account is unavailable instead of saying it does not exist. The
      // refusal below keeps inactive accounts out of new postings/mappings.
      searchAccounts(trimmed, { inactive: true, limit: 50 }, signal).then(
        (page) => page.rows
      ),
    enabled: ready,
    // The chart is imported once and then sits for months.
    staleTime: 60_000,
  })

  return (
    <div className={cn("flex flex-col gap-2", floating && "relative")}>
      <Input
        value={needle}
        onChange={(event) => setNeedle(event.target.value)}
        className={floating ? "h-control" : undefined}
      />
      {!ready ? null : (
        <div
          className={cn(
            "max-h-56 overflow-y-auto rounded-inner border border-hairline",
            floating &&
              "absolute top-full right-0 left-0 z-30 mt-1 bg-canvas shadow-soft"
          )}
        >
          {queryState(results, {
            loading: "Searching the chart…",
            render: (accounts) =>
              accounts.length === 0 ? (
                <p className="px-3 py-4 text-center text-[0.875rem] text-body">
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
                    (!account.is_active ? "inactive account" : null) ??
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
                          category_family: account.category_family,
                        })
                      }
                      className="flex w-full items-center gap-2 border-b border-hairline px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-soft disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      <Tag>{account.account_code}</Tag>
                      <span className="min-w-0 flex-1 truncate text-[0.875rem] text-ink">
                        {account.name}
                      </span>
                      {refusal !== null && (
                        <span className="shrink-0 text-[0.875rem] text-mute">
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

// ---------------------------------------------------------------------------
// Categories — the second half of choosing an account
// ---------------------------------------------------------------------------

/// Choose the category the account's family asks for.
///
/// Never rendered on its own: a category without an account is a word with no
/// sentence around it, and the family it belongs to is the account's to
/// declare. `<AccountAndCategory>` below is the control; this is its second
/// box.
///
/// Names are the client's own Indonesian and are never translated — an
/// accountant is looking for "Biaya Pemakaian Listrik", and an English
/// rendering is a different line as far as they are concerned. `name_en`,
/// where the chart carries one, stays in `title` beside the code, which is
/// where the id of everything else in this module lives too.
///
/// # Why it searches rather than dropping down
///
/// Because `expense_category` has 51 values and is the box a person will use
/// most — it is what 6101, 6301 and 6401 all take, which is every cost this
/// client has. A native select of 51 Indonesian names is a scroll, and the
/// codes are `UPPER_SNAKE` slugs of the client's own account names, so
/// somebody who half-remembers "listrik" can type it and find
/// `BIAYA_PEMAKAIAN_LISTRIK` without knowing the slug. The small families —
/// `item_class` has two — lose nothing by using the same control, and a
/// second control for them would be a second answer to "what does choosing
/// look like".
///
/// # Why retired categories are not offered
///
/// That is the opposite of `<AccountPicker>`'s rule and the difference is
/// real: a retired *account* is one somebody is holding a piece of paper for
/// and has to be told about, and these lists are two to fifty-one words long,
/// so an option that can only be refused is noise rather than an answer. One
/// already chosen is still shown — losing somebody's answer because the list
/// moved under them is worse than an option that is no longer offered.
export function CategoryPicker({
  family,
  value,
  onPick,
  className,
  label,
}: {
  /// The family the chosen account declares. Never `null` here — the caller
  /// does not render this box at all for an account that takes no category.
  family: string
  /// The chosen `category_code`, or `""`.
  value: string
  onPick: (categoryCode: string | null) => void
  className?: string
  label?: string
}) {
  const categories = useLineCategories(family)
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const form = useInForm() && [FORM_BOX, FORM_HALO_WITHIN]

  const offered = useMemo(
    () =>
      categories.rows.filter(
        (one) => one.is_active || one.category_code === value
      ),
    [categories.rows, value]
  )

  // Name and code both: the accountant reads the name and the person who set
  // the map quotes the code.
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === "") return offered
    return offered.filter(
      (one) =>
        one.name.toLowerCase().includes(needle) ||
        one.category_code.toLowerCase().includes(needle)
    )
  }, [offered, query])

  const chosen = offered.find((one) => one.category_code === value) ?? null

  return (
    <Combobox.Root
      items={rows as LineCategory[]}
      filter={null}
      value={chosen}
      onValueChange={(next) => {
        const category = next as LineCategory | null
        onPick(category === null ? null : category.category_code)
        setQuery("")
      }}
      inputValue={open ? query : chosen ? supplierDisplayName(chosen) : ""}
      onInputValueChange={(next) => open && setQuery(next)}
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setQuery("")
      }}
      itemToStringLabel={(one) => (one ? (one as LineCategory).name : "")}
      modal={false}
    >
      <Combobox.InputGroup className={cn(PICKER_FIELD, form, className)}>
        <Combobox.Input
          aria-label={label}
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
                {categories.isPending
                  ? "Reading the categories…"
                  : categories.isError
                    ? "The categories could not be read."
                    : `No category in ${family} matches.`}
              </Combobox.Empty>
              {rows.map((one) => (
                <Combobox.Item
                  key={one.category_code}
                  value={one}
                  title={
                    one.name_en === null || one.name_en === undefined
                      ? one.category_code
                      : `${one.category_code} · ${one.name_en}`
                  }
                  className={cn(ITEM, "gap-2")}
                >
                  <Tag>{one.category_code}</Tag>
                  <span className="min-w-0 flex-1 truncate text-ink">
                    {one.name}
                  </span>
                  {one.category_code === value && (
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

/// An account, and the category that account's family asks for.
///
/// The chart collapsed from 190 postable accounts to 40, and everything that
/// used to tell two of them apart — which bank, which rack, PPh 21 or PPh 23,
/// electricity or water — became a category on the line. So picking an account
/// is now two answers where it used to be one, and the second one is not
/// optional: `assert_category_matches_account` refuses a line whose account
/// declares a family and whose category is missing, and refuses a line whose
/// account declares none and whose category is set.
///
/// # Why this is one control and not two beside each other
///
/// Because which second box to draw — and whether to draw one at all — is
/// decided by the *first* answer, and five screens each deciding that for
/// themselves is five chances to decide it differently. Choosing 1102 Bank
/// shows no category box at all, because a bank line's identity is the bank
/// account it already names; choosing 6301 shows forty-eight expense
/// categories and will not let go until one is picked. Neither is the screen's
/// judgement to make.
///
/// # What a caller still owns
///
/// Whether the answer is usable. `accountChoiceReady` is the whole of it, and
/// the caller decides what an unfinished answer means: a journal row with no
/// category is one somebody has not finished, a bill line with none is a line
/// the server will refuse. Nothing here disables anybody's button.
export interface AccountChoice {
  readonly account_code: string
  readonly name: string
  /// What the account declares, carried so the caller does not have to look it
  /// up again to know whether a category is owed.
  readonly category_family: string | null
  readonly category_code: string | null
}

/// An account is chosen and, if its family asks for one, so is a category.
///
/// The one rule, written once. `null` — nothing chosen at all — is not ready
/// either, which is what every caller means by it.
export function accountChoiceReady(
  choice: AccountChoice | null | undefined
): boolean {
  if (choice === null || choice === undefined) return false
  if (choice.account_code === "") return false
  return choice.category_family === null || choice.category_code !== null
}

/// What is missing from a choice, in the caller's own sentence — or `null`
/// when nothing is.
///
/// Separate from `accountChoiceReady` because a disabled button and an
/// explanation are different jobs: the button asks a yes/no question, and the
/// person looking at a greyed-out "Post entry" needs the sentence.
export function accountChoiceProblem(
  choice: AccountChoice | null | undefined
): string | null {
  if (choice === null || choice === undefined || choice.account_code === "")
    return "No account chosen."
  if (choice.category_family !== null && choice.category_code === null)
    return "This account needs a category."
  return null
}

export function AccountAndCategory({
  value,
  onChange,
  seed,
  allowGroups,
  accept,
  /// What the category box is called to a screen reader, when the visible
  /// label is a table header rather than a `<Field>`.
  categoryLabel = "Category",
  /// Drawn under the category box when the account asks for one and none has
  /// been chosen. Off by default: a table of six journal rows does not want
  /// six copies of the same sentence, and the composer says it once at the
  /// bottom instead.
  explain = false,
}: {
  value: AccountChoice | null
  onChange: (next: AccountChoice | null) => void
  seed?: string
  allowGroups?: boolean
  accept?: (account: LedgerAccount) => string | null
  categoryLabel?: string
  explain?: boolean
}) {
  if (value === null || value.account_code === "") {
    return (
      <AccountPicker
        seed={seed}
        allowGroups={allowGroups}
        accept={accept}
        onPick={(account) =>
          onChange({
            account_code: account.account_code,
            name: account.name,
            category_family: account.category_family,
            // Never carried across from whatever was chosen before: a
            // category belongs to a family, and a new account may not be in
            // the same one.
            category_code: null,
          })
        }
      />
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="flex min-w-0 items-center gap-2">
        <Tag>{value.account_code}</Tag>
        <span className="min-w-0 flex-1 truncate text-[0.875rem] text-ink">
          {value.name}
        </span>
        <Button size="sm" variant="quiet" onClick={() => onChange(null)}>
          Change
        </Button>
      </span>

      {value.category_family !== null && (
        <>
          <CategoryPicker
            family={value.category_family}
            value={value.category_code ?? ""}
            label={categoryLabel}
            onPick={(code) => onChange({ ...value, category_code: code })}
          />
          {explain && value.category_code === null && (
            <span className="text-[0.875rem] text-warn-fg">
              {value.account_code} is one line of the statement; the category is
              what it was for. The database refuses the entry without it.
            </span>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// On a phone
// ---------------------------------------------------------------------------

/// "Pick one of a few" on a phone: a chip in the dock over the bottom bar and
/// the sheet it opens — a shop, a day, a month, a bank account, a unit.
///
/// Nothing is drawn at the top of the page (owner, 2026-10-06), and nothing
/// is drawn at all on a desk: the screen keeps its own control there and
/// renders this beside it. The chip names the current answer; the sheet lists
/// every answer, each with a `note` (the figure it holds) where there is one.
///
/// The chip keeps 6px off a neighbour on either side (the dock's tabs slot does
/// not space its chips, and the Filters and status chips carry no margin of
/// their own): its own left margin, and the next chip's, whoever's it is.
export function PhoneChoice({
  title,
  value,
  options,
  onChange,
}: {
  /// What is being chosen: "Shop", "Day". The sheet's heading and the chip's
  /// spoken name.
  title: string
  value: string
  options: readonly {
    readonly value: string
    /// The row's words, and the chip's too unless `short` says otherwise.
    readonly label: string
    readonly short?: string
    /// The figure under or beside the row ("Rp 1,2 M").
    readonly note?: React.ReactNode
  }[]
  onChange: (value: string) => void
}) {
  const dock = useDock()
  const [open, setOpen] = useState(false)
  const current = options.find((one) => one.value === value)
  if (dock?.available !== true) return null
  return (
    <>
      <DockPortal slot="tabs">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-label={`${title}: ${current?.label ?? ""}`}
          className="ml-1.5 inline-flex h-9 max-w-full items-center gap-1 rounded-full bg-soft-2 pr-2.5 pl-3.5 text-[0.875rem] font-medium text-ink transition-[scale] duration-(--t-press) ease-(--ease-out) first:ml-0 active:scale-[0.97] [&+*]:ml-1.5"
        >
          <span className="truncate">{current?.short ?? current?.label}</span>
          <ChevronDown className="size-4 shrink-0 text-line-ico" />
        </button>
      </DockPortal>
      <BottomSheet open={open} onOpenChange={setOpen} title={title}>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-2 pb-3">
          {options.map((one) => {
            const on = one.value === value
            return (
              <button
                key={one.value}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  onChange(one.value)
                  setOpen(false)
                }}
                className={cn(SHEET_ROW, on && "font-medium text-accent")}
              >
                <span className="min-w-0 flex-1 truncate">{one.label}</span>
                {one.note !== undefined && (
                  <span className="shrink-0 text-body tabular-nums">
                    {one.note}
                  </span>
                )}
                <CheckIcon
                  className={cn("size-4 shrink-0", on ? "" : "opacity-0")}
                />
              </button>
            )
          })}
        </div>
      </BottomSheet>
    </>
  )
}

/// The figures above a list, on a phone: ONE card, two to a row (`KpiStrip`),
/// where a desk has a card to each (`<NumberCard>`). Drawn on a phone only —
/// the screen keeps its desk cards and says `max-md:hidden` on them.
///
/// A note under a figure is left out here: the card is two lines tall so that
/// six figures are three rows, and "As of today" is not worth a third line.
export interface PhoneFigureItem {
  readonly label: string
  /// A number is money (or a count, with `unit`); a string is printed as is.
  readonly value: number | null | string
  readonly unit?: "money" | "count"
  readonly tone?: "bad" | "ok" | "warn"
}

export function PhoneFigures({
  items,
  className,
}: {
  items: readonly PhoneFigureItem[]
  className?: string
}) {
  return (
    <KpiStrip className={cn("md:hidden", className)}>
      {items.map((item) => (
        <Kpi
          key={item.label}
          label={item.label}
          value={
            <span
              className={
                item.tone === "bad"
                  ? "text-bad-fg"
                  : item.tone === "warn"
                    ? "text-warn-fg"
                    : item.tone === "ok"
                      ? "text-ok-fg"
                      : undefined
              }
            >
              {typeof item.value === "string"
                ? item.value
                : item.value === null
                  ? "—"
                  : item.unit === "count"
                    ? count(item.value)
                    : money(item.value)}
            </span>
          }
        />
      ))}
    </KpiStrip>
  )
}

/// `<UnitSelect>` as the dock's chip: pick a unit, or all units, on a phone.
/// The same list, the same words (`unitLabel`), and nothing on a desk.
export function PhoneUnitChoice({
  value,
  onChange,
  emptyLabel = "All units",
  title = "Unit",
}: {
  value: string
  onChange: (unitId: string) => void
  emptyLabel?: string
  title?: string
}) {
  const map = useLocations()
  const units = map.data?.locations ?? []
  const options = [
    { value: "", label: emptyLabel },
    ...units.map((unit) => ({
      value: unit.unit_id,
      label: unitLabel(unit),
    })),
  ]
  // A value the list does not carry (retired since, or not read yet) is kept
  // rather than reset, as `<UnitSelect>` keeps it.
  if (value !== "" && !options.some((one) => one.value === value)) {
    options.push({ value, label: map.isPending ? "…" : value })
  }
  return (
    <PhoneChoice
      title={title}
      value={value}
      onChange={onChange}
      options={options}
    />
  )
}
