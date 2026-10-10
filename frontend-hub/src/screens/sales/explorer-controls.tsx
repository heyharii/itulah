import { Tabs } from "@base-ui/react/tabs"
import { Toggle } from "@base-ui/react/toggle"
import { ToggleGroup } from "@base-ui/react/toggle-group"
import type { ExplorerOptions } from "@itulah/contract"
import {
  CalendarDays,
  Check,
  ChevronRight,
  Download,
  ListFilter,
  Search,
  X,
} from "lucide-react"
import { useMemo, useState } from "react"

import { DockChoice, DockTools } from "@/components/shell/dock-tools"
import { DockPortal } from "@/components/shell/dock"
import { Button } from "@/components/ui/button"
import { Checkbox, Input } from "@/components/ui/field"
import { SwitchPill } from "@/components/ui/form"
import { SHEET_ROW } from "@/components/ui/list-chrome"
import { BottomSheet } from "@/components/ui/picker-sheet"
import { Segmented } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { exportXlsx, type ExportSheet } from "@/lib/export-xlsx"
import { count } from "@/lib/format"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { PickDates, PickDatesSheet } from "@/screens/sales/explorer-calendar"
import {
  applyView,
  deleteView,
  filterCount,
  FILTERS,
  GROUPS,
  noun,
  PRESETS,
  periodLabel,
  rangeOf,
  saveView,
  stillView,
  withoutFilters,
  type ExplorerState,
  type FilterKey,
  type GroupKey,
  type Range,
  type ViewMode,
} from "@/screens/sales/explorer-model"
import { useSavedViews, useSearchBox } from "@/screens/sales/explorer-state"

/// Everything the Explorer is controlled with that is not the table: the
/// period beside the title, the row of groupings (the "Navbar"), the tools over
/// the results, the filter sheet, and on a phone the hub's dock.
///
/// The hub's dock exists on a phone only (`components/shell/dock.tsx` draws
/// nothing at any other width), so a desk and a tablet get the same few
/// controls in the card's own tools row, and a phone gets them in the dock: the
/// grouping as its status button, the search with the filter button in it, and
/// the period.

export type Update = (
  next: (state: ExplorerState) => ExplorerState,
  push?: boolean,
  /// The search too, in the same step: it belongs to the rows that are leaving.
  q?: string
) => void

/// The days a period can be asked about, for the calendar.
export interface Bounds {
  readonly min: string
  readonly max: string
  readonly anchor: string
}

// ---------------------------------------------------------------------------
// The period
// ---------------------------------------------------------------------------

/// The presets and the calendar, to the right of the title.
export function PeriodBar({
  state,
  update,
  range,
  bounds,
}: {
  state: ExplorerState
  update: Update
  range: Range
  bounds: Bounds
}) {
  const custom = rangeOf(state.period) !== null
  return (
    <>
      <Segmented
        options={PRESETS}
        // The default is this year, and a picked range is none of the four.
        value={custom ? "" : state.period === "" ? "year" : state.period}
        onChange={(next) =>
          update((s) => ({ ...s, period: next === "year" ? "" : next }), true)
        }
      />
      <PickDates
        label={custom ? periodLabel(range) : "Pick dates"}
        custom={custom}
        range={range}
        bounds={bounds}
        onApply={(next) =>
          update((s) => ({ ...s, period: `${next.from}..${next.to}` }), true)
        }
      />
    </>
  )
}

/// A phone's period: the presets as rows, and Pick dates under them.
export function PeriodSheet({
  open,
  onOpenChange,
  state,
  update,
  range,
  bounds,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  state: ExplorerState
  update: Update
  range: Range
  bounds: Bounds
}) {
  const [calendar, setCalendar] = useState(false)
  const custom = rangeOf(state.period) !== null
  const active = custom ? "" : state.period === "" ? "year" : state.period
  return (
    <>
      <BottomSheet open={open} onOpenChange={onOpenChange} title="Period">
        <div className="min-h-0 overflow-y-auto overscroll-contain px-2 pb-3">
          {PRESETS.map((one) => (
            <button
              key={one.value}
              type="button"
              aria-pressed={active === one.value}
              onClick={() => {
                update(
                  (s) => ({
                    ...s,
                    period: one.value === "year" ? "" : one.value,
                  }),
                  true
                )
                onOpenChange(false)
              }}
              className={cn(
                SHEET_ROW,
                active === one.value && "font-medium text-accent"
              )}
            >
              <span className="flex-1">{one.label}</span>
              <Check
                className={cn(
                  "size-4 shrink-0",
                  active !== one.value && "opacity-0"
                )}
              />
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              onOpenChange(false)
              setCalendar(true)
            }}
            className={cn(SHEET_ROW, custom && "font-medium text-accent")}
          >
            <span className="flex-1">Pick dates</span>
            {custom && (
              <span className="text-[0.875rem] font-normal text-mute tabular-nums">
                {periodLabel(range)}
              </span>
            )}
            <ChevronRight className="size-4 shrink-0 text-line-ico" />
          </button>
        </div>
      </BottomSheet>
      <PickDatesSheet
        open={calendar}
        onOpenChange={setCalendar}
        custom={custom}
        range={range}
        bounds={bounds}
        onApply={(next) =>
          update((s) => ({ ...s, period: `${next.from}..${next.to}` }), true)
        }
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// The groupings
// ---------------------------------------------------------------------------

/// The row of groupings: pills in a white box, the lit one in ink. One word
/// each, and on a tablet the two long ones say less.
export function Navbar({
  group,
  short,
  onChange,
}: {
  group: GroupKey
  short: boolean
  onChange: (group: GroupKey) => void
}) {
  return (
    <Tabs.Root
      value={group}
      onValueChange={(next, details) => {
        // Only a click or a key moves the tab; this root is always controlled.
        if (details.reason === "none") onChange(next as GroupKey)
      }}
      className="contents"
    >
      <Tabs.List className="inline-flex max-w-full [scrollbar-width:none] gap-0.5 self-start overflow-x-auto rounded-xl border border-hairline bg-canvas p-1 shadow-soft [&::-webkit-scrollbar]:hidden">
        {GROUPS.map((one) => (
          <Tabs.Tab
            key={one.value}
            value={one.value}
            className={cn(
              "h-[2.125rem] shrink-0 rounded-inner px-3.5 text-[0.875rem] font-medium whitespace-nowrap transition-[background-color,color,scale] duration-(--t-press) ease-(--ease-out) outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-[0.97]",
              one.value === group
                ? "bg-ink text-white"
                : "text-body hover:bg-soft hover:text-ink"
            )}
          >
            {short ? one.short : one.label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
    </Tabs.Root>
  )
}

// ---------------------------------------------------------------------------
// The tools over the results
// ---------------------------------------------------------------------------

/// The search, over the rows: it narrows them through the server's `q`.
export function SearchField({
  q,
  setQuery,
  label,
  className,
}: {
  q: string
  setQuery: (value: string) => void
  /// "Search divisions".
  label: string
  className?: string
}) {
  const [value, onChange] = useSearchBox(q, setQuery)
  return (
    <label
      className={cn(
        "flex h-control w-56 items-center gap-2 rounded-inner border border-hairline-2 bg-canvas px-3 focus-within:border-accent lg:w-72",
        className
      )}
    >
      <Search className="size-4 shrink-0 text-line-ico" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        placeholder={label}
        autoComplete="off"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-mute"
      />
      {value !== "" && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="-mr-1 grid size-6 shrink-0 place-items-center rounded-full text-line-ico transition-[color,scale] duration-(--t-press) ease-(--ease-out) hover:text-ink active:scale-[0.92]"
        >
          <X className="size-3.5" />
        </button>
      )}
    </label>
  )
}

/// Totals or Per store. Per store is not offered for rows that are stores.
export function ViewSwitch({
  view,
  perStore,
  onChange,
}: {
  view: ViewMode
  perStore: boolean
  onChange: (view: ViewMode) => void
}) {
  const option = (value: ViewMode, label: string, off = false) => (
    <Toggle
      key={value}
      value={value}
      disabled={off}
      className={cn(
        "h-[1.75rem] shrink-0 rounded-[0.375rem] px-2.5 text-meta font-medium whitespace-nowrap transition-[background-color,color,box-shadow,scale] duration-(--t-press) ease-(--ease-out) pointer-coarse:h-10 pointer-coarse:px-3",
        view === value
          ? "bg-canvas text-ink shadow-soft"
          : "text-body hover:text-ink",
        off && "pointer-events-none opacity-45"
      )}
    >
      {label}
    </Toggle>
  )
  return (
    <ToggleGroup
      value={[view]}
      onValueChange={(next) => {
        const picked = next[0] as ViewMode | undefined
        if (picked !== undefined && picked !== view) onChange(picked)
      }}
      className="inline-flex shrink-0 rounded-inner bg-soft-2 p-0.5"
    >
      {option("totals", "Totals")}
      {option("stores", "Per store", !perStore)}
    </ToggleGroup>
  )
}

/// Export, as an icon alone on a tablet.
export function ExportTool({
  build,
  disabled,
  iconOnly,
}: {
  build: () => ExportSheet | null
  disabled: boolean
  iconOnly: boolean
}) {
  const [pending, setPending] = useState(false)
  const run = () => {
    const sheet = build()
    if (sheet === null) {
      toast("The report is still loading — try again in a moment.")
      return
    }
    setPending(true)
    exportXlsx(sheet)
      .catch(() => toast.error("The Excel file could not be written."))
      .finally(() => setPending(false))
  }
  return (
    <Button
      variant="ghost"
      size={iconOnly ? "icon" : "default"}
      disabled={disabled}
      pending={pending}
      aria-label="Export"
      title="Export"
      onClick={run}
    >
      <Download />
      {!iconOnly && "Export"}
    </Button>
  )
}

/// The tools row at the top of the results card: the search, how to read the
/// rows, the heatmap, the filter and the export.
export function Tools({
  q,
  setQuery,
  state,
  update,
  onOpenFilter,
  exporter,
  refresh,
}: {
  q: string
  setQuery: (value: string) => void
  state: ExplorerState
  update: Update
  onOpenFilter: () => void
  exporter: React.ReactNode
  /// When the rows were read, and the reload (`RefreshStamp`).
  refresh?: React.ReactNode
}) {
  const perStore = state.group !== "store"
  const stores = state.view === "stores" && perStore
  const filters = filterCount(state)
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-hairline px-4 py-2.5">
      <SearchField
        q={q}
        setQuery={setQuery}
        label={`Search ${noun(state.group, 2)}`}
        className="md:max-lg:w-52"
      />
      <div className="flex-1" />
      {refresh}
      <ViewSwitch
        view={stores ? "stores" : "totals"}
        perStore={perStore}
        onChange={(view) => update((s) => ({ ...s, view }), true)}
      />
      <SwitchPill
        label="Heatmap"
        on={state.heat}
        onToggle={() => update((s) => ({ ...s, heat: !s.heat }))}
        className={cn(!stores && "pointer-events-none opacity-45")}
      />
      <Button variant="ghost" onClick={onOpenFilter}>
        <ListFilter />
        Filter
        {filters > 0 && (
          <span className="grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-full bg-ink px-1 text-[0.875rem] leading-none text-white tabular-nums">
            {filters}
          </span>
        )}
      </Button>
      {exporter}
    </div>
  )
}

/// What is narrowing the rows, said in a line under the tools: "Division:
/// Wanita · Tag: Denim", and the way to take it all off.
export function Applied({
  state,
  update,
  options,
}: {
  state: ExplorerState
  update: Update
  options: ExplorerOptions | undefined
}) {
  const parts = FILTERS.flatMap((one) => {
    const values = state[one.key]
    if (values.length === 0) return []
    const names = values.map(
      (code) =>
        options?.[one.key].find((choice) => choice.code === code)?.label ?? code
    )
    const shown = names.slice(0, 3).join(", ")
    return [
      `${one.label}: ${shown}${names.length > 3 ? ` +${names.length - 3}` : ""}`,
    ]
  })
  if (parts.length === 0) return null
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-hairline px-4 py-2 text-[0.875rem] text-body max-md:rounded-card max-md:border max-md:bg-canvas">
      <span>{parts.join(" · ")}</span>
      <button
        type="button"
        onClick={() => update((s) => withoutFilters(s), true)}
        className="rounded-inner font-medium text-accent transition-[opacity,scale] duration-(--t-press) ease-(--ease-out) hover:opacity-80 active:scale-[0.97]"
      >
        Clear
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The filter sheet
// ---------------------------------------------------------------------------

type Pane = FilterKey | "saved"

/// What a pane says about itself on the left: how many are chosen, or All.
function summary(state: ExplorerState, pane: Pane, saved: number): string {
  if (pane === "saved") return saved > 0 ? count(saved) : ""
  return state[pane].length === 0 ? "All" : count(state[pane].length)
}

const PANES: readonly { pane: Pane; label: string }[] = [
  ...FILTERS.map((one) => ({ pane: one.key as Pane, label: one.label })),
  { pane: "saved", label: "Saved views" },
]

function ChoicePane({
  filter,
  options,
  values,
  onToggle,
}: {
  filter: (typeof FILTERS)[number]
  options: ExplorerOptions | undefined
  values: readonly string[]
  onToggle: (code: string, on: boolean) => void
}) {
  const [query, setQuery] = useState("")
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const all = options?.[filter.key] ?? []
    return needle === ""
      ? all
      : all.filter(
          (one) =>
            one.label.toLowerCase().includes(needle) ||
            one.code.toLowerCase().includes(needle)
        )
  }, [options, filter.key, query])
  return (
    <div className="flex flex-col gap-1.5">
      <label className="mb-1 flex h-9 items-center gap-2 rounded-inner border border-hairline-2 bg-canvas px-2.5 focus-within:border-accent">
        <Search className="size-4 shrink-0 text-line-ico" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={`Search ${filter.search}`}
          placeholder={`Search ${filter.search}`}
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-mute max-md:text-base"
        />
      </label>
      {options === undefined && (
        <p className="px-1.5 py-3 text-[0.875rem] text-mute">Loading…</p>
      )}
      {options !== undefined && rows.length === 0 && (
        <p className="px-1.5 py-3 text-[0.875rem] text-mute">
          Nothing matches.
        </p>
      )}
      {rows.map((one) => (
        <div
          key={one.code}
          className="flex min-h-10 items-center rounded-inner px-1.5 transition-colors duration-(--t-hover) hover:bg-soft"
        >
          <Checkbox
            label={one.label}
            checked={values.includes(one.code)}
            onChange={(on) => onToggle(one.code, on)}
            className="w-full [&>label]:min-h-10 [&>label]:w-full [&>label]:text-[0.9375rem] [&>label]:text-text [&>label]:normal-case"
          />
        </div>
      ))}
    </div>
  )
}

function SavedPane({
  state,
  update,
  onDone,
}: {
  state: ExplorerState
  update: Update
  onDone: () => void
}) {
  const saved = useSavedViews()
  const [name, setName] = useState("")
  const save = () => {
    if (name.trim() === "") return
    const view = saveView(name, state)
    toast(`Saved ${view.name}`)
    setName("")
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Input
          value={name}
          aria-label="Name this view"
          placeholder="Name this view"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              save()
            }
          }}
          className="min-w-0 flex-1"
        />
        <Button variant="ghost" disabled={name.trim() === ""} onClick={save}>
          Save view
        </Button>
      </div>
      {saved.length > 0 && (
        <ul className="flex flex-col">
          {saved.map((view) => {
            const on = stillView(state, view)
            return (
              <li key={view.id} className="flex items-center gap-1">
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    update(() => applyView(view), true)
                    onDone()
                  }}
                  className={cn(
                    SHEET_ROW,
                    "min-w-0 flex-1",
                    on && "font-medium text-accent"
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{view.name}</span>
                  <Check
                    className={cn("size-4 shrink-0", !on && "opacity-0")}
                  />
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${view.name}`}
                  onClick={() => deleteView(view.id)}
                  className="grid size-9 shrink-0 place-items-center rounded-inner text-line-ico transition-[color,background-color,scale] duration-(--t-press) ease-(--ease-out) hover:bg-soft-2 hover:text-ink active:scale-[0.97]"
                >
                  <X className="size-4" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/// The filter: a floating sheet with two panes — the categories on the left,
/// each with its choice beside it, and the list of that category on the right —
/// and, on a phone, the same two as one pane at a time. The saved views are the
/// last category.
export function FilterSheet({
  open,
  onOpenChange,
  state,
  update,
  options,
  total,
  phone,
  exporter,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  state: ExplorerState
  update: Update
  options: ExplorerOptions | undefined
  /// How many rows the view holds now: the sheet's way out says so.
  total: number
  phone: boolean
  /// The export, which a phone has no tools row to put it in.
  exporter: React.ReactNode
}) {
  const [pane, setPane] = useState<Pane>("stores")
  // A phone shows the categories first and one list at a time.
  const [inside, setInside] = useState(false)
  const saved = useSavedViews()
  const current = PANES.find((one) => one.pane === pane) ?? PANES[0]
  const content =
    pane === "saved" ? (
      <SavedPane
        state={state}
        update={update}
        onDone={() => onOpenChange(false)}
      />
    ) : (
      <ChoicePane
        // A fresh search for each category.
        key={pane}
        filter={FILTERS.find((one) => one.key === pane) ?? FILTERS[0]}
        options={options}
        values={state[pane]}
        // Against the filter as the address bar holds it now, so two ticks in
        // quick succession both count.
        onToggle={(code, on) =>
          update((s) => ({
            ...s,
            [pane]: on
              ? s[pane].includes(code)
                ? s[pane]
                : [...s[pane], code]
              : s[pane].filter((value) => value !== code),
            // A step down the page named this filter; changing it by hand ends
            // that step.
            crumbs: s.crumbs.filter((crumb) => crumb.filter !== pane),
          }))
        }
      />
    )
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setInside(false)
      }}
      title={phone && inside ? current.label : "Filter"}
      back={
        phone && inside
          ? { label: "Filter", onClick: () => setInside(false) }
          : undefined
      }
      size="rail"
      footer={
        <SheetFooter
          start={
            <Button
              variant="quiet"
              onClick={() => update((s) => withoutFilters(s), true)}
            >
              Reset
            </Button>
          }
          secondary={phone ? exporter : undefined}
          primary={
            <Button variant="primary" onClick={() => onOpenChange(false)}>
              Show {count(total)} {noun(state.group, total)}
            </Button>
          }
        />
      }
    >
      {phone ? (
        inside ? (
          content
        ) : (
          <ul className="-mx-3 -my-3 flex flex-col">
            {PANES.map((one) => (
              <li key={one.pane}>
                <button
                  type="button"
                  onClick={() => {
                    setPane(one.pane)
                    setInside(true)
                  }}
                  className={SHEET_ROW}
                >
                  <span className="flex-1">{one.label}</span>
                  <span className="text-[0.875rem] text-mute tabular-nums">
                    {summary(state, one.pane, saved.length)}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-line-ico" />
                </button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <div
          className="-mx-7 -my-8 flex"
          style={{ height: "calc(100% + 4rem)" }}
        >
          <nav className="flex w-48 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-hairline p-2">
            {PANES.map((one) => (
              <button
                key={one.pane}
                type="button"
                aria-pressed={pane === one.pane}
                onClick={() => setPane(one.pane)}
                className={cn(
                  "flex h-[2.625rem] w-full shrink-0 items-center rounded-inner px-3 text-[0.875rem] font-medium transition-[background-color,color,scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.98]",
                  pane === one.pane
                    ? "bg-soft-2 text-ink"
                    : "text-text hover:bg-soft"
                )}
              >
                {one.label}
                <small className="ml-auto text-[0.875rem] font-normal text-mute tabular-nums">
                  {summary(state, one.pane, saved.length)}
                </small>
              </button>
            ))}
          </nav>
          <div className="min-w-0 flex-1 overflow-y-auto p-4">{content}</div>
        </div>
      )}
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// The phone's dock
// ---------------------------------------------------------------------------

/// The hub's dock: the grouping as its status button, the search with the
/// filter button in it, and the period. Nothing is drawn at the top.
export function PhoneDock({
  q,
  onQuery,
  state,
  update,
  periodText,
  custom,
  onOpenFilter,
  onOpenPeriod,
}: {
  q: string
  onQuery: (value: string) => void
  state: ExplorerState
  update: Update
  periodText: string
  custom: boolean
  onOpenFilter: () => void
  onOpenPeriod: () => void
}) {
  const [needle, onNeedle] = useSearchBox(q, onQuery)
  const options = useMemo(
    () => GROUPS.map((one) => ({ value: one.value, label: one.label })),
    []
  )
  return (
    <>
      <DockTools
        search={{
          value: needle,
          onChange: onNeedle,
          label: `Search ${noun(state.group, 2)}`,
        }}
        filter={{ count: filterCount(state), onOpen: onOpenFilter }}
      />
      <DockChoice
        title="Group by"
        value={state.group}
        options={options}
        onChange={(next) =>
          update((s) => ({ ...s, group: next as GroupKey }), true, "")
        }
      />
      <DockPortal slot="action">
        <button
          type="button"
          aria-label={`Period: ${periodText}`}
          aria-haspopup="dialog"
          onClick={onOpenPeriod}
          className={cn(
            "grid size-11 place-items-center rounded-full transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.92]",
            custom ? "bg-accent-bg text-accent" : "bg-soft-2 text-body"
          )}
        >
          <CalendarDays className="size-4" />
        </button>
      </DockPortal>
    </>
  )
}
