import { Menu } from "@base-ui/react/menu"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Bookmark,
  Check,
  ChevronRight,
  ChevronsUpDown,
  ListFilter,
  Columns3,
  Download,
  Save,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react"
import { useEffect, useState } from "react"

import { ClearFilters, FilterControls } from "@/components/ui/filter-bar"
import { BottomSheet, MorphHeight } from "@/components/ui/picker-sheet"
import { Sheet } from "@/components/ui/sheet"
import { csvName, downloadCsv, toCsv, type CsvColumn } from "@/lib/csv"
import { useOptions, POP_MOTION } from "@/lib/filter-chrome"
import { count } from "@/lib/format"
import { usePanelDock } from "@/lib/layout"
import { useSheet } from "@/lib/sheets"
import { toast } from "@/lib/toast"
import { columnName } from "@/components/ui/column-name"
import { cn } from "@/lib/utils"
import {
  operatorsFor,
  type Filter,
  type FilterField,
  type FilterState,
} from "@/lib/filters"

/// The chrome a list wears beside its rows: the filters as a column, the
/// columns as a menu, and the views somebody named because they ask the same
/// question every morning.
///
/// All three are drawn the way `hub-prototype.html` draws them, because that
/// prototype is what the owner approved — a panel of labelled selects rather
/// than a button called Filter, a tick list of the columns this table actually
/// has, and views that carry their clauses.
///
/// **Views and column choices live in the browser.** That was the ruling when
/// this round was scoped frontend-first: no table, no migration, no endpoint.
/// It is honest as long as nobody is told otherwise — a saved view is yours,
/// on this machine, and the panel says so.

/* -------------------------------------------------------------------------- */
/*  The filter column                                                          */
/* -------------------------------------------------------------------------- */

const ROW =
  "flex h-[2.375rem] w-full items-center gap-2 rounded-inner border border-hairline-2 bg-canvas px-3 text-left text-[0.875rem] transition-colors hover:border-hairline-strong"

export function DockedFilters({
  model,
  table,
  kpis,
  children,
  id = "orders",
  subject = "Purchase order",
  className,
}: {
  readonly model: FilterState
  /// The table, when the list is narrowed in the BROWSER rather than at the
  /// server. Its faceted row model is where a one-tap row gets its values —
  /// without it, a screen that declares no `options` and receives no `counted`
  /// facets has nothing to offer, and every row in this panel falls through to
  /// the clause editor as though it were a date band. That is what the three
  /// inventory lists looked like the first time they mounted this panel.
  ///
  /// Untyped for the same reason `ColumnsMenu` takes it untyped: `useTable`'s
  /// return type is generic over the feature set and invariant in v9, so
  /// naming it here would lock the panel to one screen's columns.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly table?: any
  /// Screen-specific view controls that belong above the generic filter rows.
  /// They stay optional so the shared dock keeps the same shape everywhere else.
  readonly children?: React.ReactNode
  /// A few figures about the list as it currently stands, above the controls
  /// that narrow it — so the number and the thing that changed it are read in
  /// one glance. Each carries its own `exact` flag: a sum over a page that is
  /// not the whole book is an estimate, and says so rather than printing a
  /// confident wrong total.
  readonly kpis?: readonly {
    readonly label: string
    readonly value: string
    readonly note?: string
  }[]
  /// Which list this panel belongs to, for the browser-side memory of which
  /// fields it shows.
  readonly id?: string
  /// What a row of this list IS, over the tick list of its fields. It said
  /// "Purchase order" on every screen that mounted this panel, which is a
  /// heading written for the first one — three lists in, it was labelling a
  /// catalogue's facets as an order's.
  readonly subject?: string
  readonly className?: string
}) {
  /// Two sheets, because they are two different questions. `filters` is the
  /// clause editor — what the list is narrowed BY, with the operators the
  /// panel's one-tap rows cannot express; `fields` is which of the questions
  /// this panel puts at all. They shared one key until 2026-09-13, which is
  /// why "Edit filters" opened a tick list of field names and a row with no
  /// options to offer opened it too.
  const sheet = useSheet("filters")
  const picker = useSheet("fields")
  const docked = usePanelDock()
  const { fields, filters } = model
  const [picked, setPicked] = useState<string[] | null>(null)
  const [needle, setNeedle] = useState("")
  useEffect(() => setPicked(readFields(id)), [id])

  // Everything, until somebody has said otherwise. And a field that is
  // narrowing the list is shown whether or not it was ticked: a filter you
  // cannot see is a filter you cannot drop.
  const on = (column: string) =>
    picked === null ||
    picked.includes(column) ||
    filters.some((one) => one.column === column)
  const showing = fields.filter((field) => on(field.column))
  const matching = fields.filter(
    (field) =>
      needle.trim() === "" ||
      field.label.toLowerCase().includes(needle.trim().toLowerCase())
  )

  // Nothing at all below the dock width — not `display:none`. The sheets below
  // are portalled, so a hidden panel still puts a dialog on the same
  // `?filters=` key as the narrow-width `<FilterPanel>` a screen renders in its
  // place, and opening one opened two. See `usePanelDock`.
  if (fields.length === 0 || !docked) return null

  return (
    <aside
      aria-label="Filters"
      className={cn(
        "sticky top-5 flex flex-col gap-2.5 self-start rounded-card border border-hairline bg-canvas p-4",
        className
      )}
    >
      {kpis && kpis.length > 0 && (
        <dl className="-mx-1 mb-1 grid grid-cols-2 gap-x-3 gap-y-2 border-b border-hairline px-1 pb-3">
          {kpis.map((kpi) => (
            <div key={kpi.label} className="min-w-0">
              <dt className="truncate text-[0.875rem] font-medium tracking-[0.04em] text-mute uppercase">
                {kpi.label}
              </dt>
              <dd
                title={kpi.note}
                className="truncate text-[0.875rem] font-semibold text-ink tabular-nums"
              >
                {kpi.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {children && (
        <div className="-mx-1 border-b border-hairline px-1 pb-3">
          {children}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[0.875rem] font-medium text-body">Filter by</h4>
        {filters.length > 0 && (
          <ClearFilters model={model} label={`Clear ${filters.length}`} />
        )}
      </div>

      {showing.map((field) => (
        <FieldRow
          key={field.column}
          field={field}
          model={model}
          table={table}
        />
      ))}

      {/* Two ways out of the one-tap rows above. The clause editor is where an
          operator is changed, a price band typed and a date range set — the
          questions nobody could have listed in advance; the field picker is
          which questions this panel asks at all. */}
      <div className="mt-0.5 flex items-center gap-4">
        <button
          type="button"
          onClick={() => (sheet.isOpen ? sheet.close() : sheet.open(true))}
          className="inline-flex items-center gap-1.5 text-[0.875rem] font-medium text-body transition-colors hover:text-ink"
        >
          <SlidersHorizontal className="size-3.5" />
          Edit filters
        </button>
        <button
          type="button"
          onClick={() => (picker.isOpen ? picker.close() : picker.open(true))}
          className="inline-flex items-center gap-1.5 text-[0.875rem] font-medium text-body transition-colors hover:text-ink"
        >
          <Check className="size-3.5" />
          Fields
        </button>
      </div>

      <SavedViews model={model} />

      {/* The clauses themselves, as the chips and the "+ Filter" menu the
          rest of the app narrows lists with. The same model the rows above
          read, drawn the way a panel wants it — down a column. A field the
          rows cannot ask in one tap (a price band, a date range) hands over to
          this rather than growing a second grammar in the column. */}
      <Sheet
        open={sheet.isOpen}
        onOpenChange={(open) => !open && sheet.close()}
        title="Filters"
      >
        <FilterControls model={model} stacked />
      </Sheet>

      {/* The field picker, the way ERPNext's "Select Filters" works: the panel
          shows what somebody chose to be asked, and this is where they choose.
          It does not touch the clauses — hiding a field is not answering it. */}
      <Sheet
        open={picker.isOpen}
        onOpenChange={(open) => !open && picker.close()}
        title="Select filters"
        footer={
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-meta text-mute">
              {count(showing.length)} of {count(fields.length)} shown
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  writeFields(id, null)
                  setPicked(null)
                }}
                className="text-[0.875rem] font-medium text-body transition-colors hover:text-ink"
              >
                Show all
              </button>
              <button
                type="button"
                onClick={() => picker.close()}
                className="inline-flex h-8 items-center rounded-inner bg-cta px-3 text-[0.875rem] font-medium text-cta-fg transition-colors hover:bg-cta-hover"
              >
                Save
              </button>
            </div>
          </div>
        }
      >
        <div className="mb-3 flex items-center gap-2 rounded-inner bg-soft-2 px-3">
          <Search className="size-4 shrink-0 text-line-ico" />
          <input
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
            aria-label="Search fields"
            className="h-9 min-w-0 flex-1 bg-transparent text-[0.875rem] text-ink outline-none placeholder:text-mute"
          />
        </div>
        <h4 className="mb-1.5 text-[0.875rem] font-medium text-body">
          {subject}
        </h4>
        <div className="grid gap-x-6 sm:grid-cols-2">
          {matching.map((field) => {
            const ticked = on(field.column)
            const forced = filters.some((one) => one.column === field.column)
            return (
              <label
                key={field.column}
                title={
                  forced
                    ? "This field is narrowing the list, so it stays on screen"
                    : undefined
                }
                className="flex min-h-9 cursor-pointer items-center gap-2.5 text-[0.875rem] text-text"
              >
                <input
                  type="checkbox"
                  checked={ticked}
                  disabled={forced}
                  onChange={() => {
                    const base = picked ?? fields.map((one) => one.column)
                    const next = base.includes(field.column)
                      ? base.filter((one) => one !== field.column)
                      : [...base, field.column]
                    writeFields(id, next)
                    setPicked(next)
                  }}
                  className="size-4 shrink-0 accent-[var(--accent)] disabled:opacity-50"
                />
                {field.label}
              </label>
            )
          })}
          {matching.length === 0 && (
            <p className="text-[0.875rem] text-mute">No field like that.</p>
          )}
        </div>
      </Sheet>
    </aside>
  )
}

/// One field, as the prototype draws it: the column's name until something is
/// chosen, then what was chosen, with the way to drop it on the same row.
function FieldRow({
  field,
  model,
  table,
  quick,
}: {
  field: FilterField
  model: FilterState
  /// See `DockedFilters.table`: the source of this row's values on a list the
  /// browser narrows.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table?: any
  /// In the row above the table rather than the column beside it: same
  /// control, with the shadow an input wears there.
  quick?: boolean
}) {
  const sheet = useSheet("filters")
  // A supplier list is two hundred names long; a status list is four. The box
  // appears when the list is long enough to need one, and not before.
  const [needle, setNeedle] = useState("")
  const index = model.filters.findIndex((one) => one.column === field.column)
  const clause = index === -1 ? undefined : model.filters[index]
  const row = quick ? cn(ROW, "shadow-soft") : ROW
  // `useOptions`, not `spec.options`. A screen that narrows at the SERVER — the
  // catalogue, the order book, the supplier book — declares no options at all
  // and gets its values from the facet counts the response carries, so reading
  // the static list left every one of those rows with nothing to offer and
  // sent it to the clause editor instead. This is the same call the omnibox
  // makes, so one field cannot offer two different sets of values depending on
  // which control you reached it from.
  const options = useOptions(field, table)
  /// The operator a one-tap row commits, when the field has no clause yet.
  ///
  /// The field's OWN first operator, not a hardcoded `isAnyOf`. A list-shaped
  /// column — a tag, a colour, a size — declares `includesAnyOf`, because "is"
  /// over a garment sold in five colours is a claim that is simply false; the
  /// row used to commit `isAnyOf` anyway, and the translator that turns clauses
  /// into request parameters (`articleScopeFromFilters`, `scopeFromFilters`)
  /// looks for the operator the FIELD declared. So the chip appeared, the URL
  /// carried it, and the list did not move.
  const first = operatorsFor(field.spec)[0]
  const chosen = clause?.values ?? []
  const shortlist =
    needle.trim() === ""
      ? options
      : options.filter((one) =>
          one.label.toLowerCase().includes(needle.trim().toLowerCase())
        )
  const shown =
    chosen.length === 0
      ? null
      : chosen.length === 1
        ? (field.spec.format?.(chosen[0]) ?? chosen[0])
        : `${count(chosen.length)} chosen`

  /// Which kinds a one-tap row can actually ask.
  ///
  /// Not "has it any values": `useOptions` walks the table for ANY kind, so a
  /// quantity column offered a menu of every distinct number and a date column
  /// a menu of every distinct timestamp — one row each, unpickable, and both
  /// of them the wrong question. A band is what those columns are asked, and
  /// the clause editor is where a band is typed.
  const oneTap =
    field.spec.kind === "option" ||
    field.spec.kind === "multi" ||
    field.spec.kind === "boolean" ||
    field.spec.kind === "text"

  // A field the panel cannot ask in one tap — a date range, a number band —
  // hands over to the clause editor rather than growing a second grammar here.
  if (!oneTap || options.length === 0) {
    return (
      <button
        type="button"
        onClick={() => sheet.open(true)}
        className={cn(row, "justify-between text-body")}
      >
        <span className="truncate">{shown ?? field.label}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-line-ico" />
      </button>
    )
  }

  return (
    <Menu.Root>
      <Menu.Trigger
        className={cn(
          row,
          "justify-between",
          shown ? "border-accent/40 bg-accent-bg text-accent" : "text-body"
        )}
      >
        <span className="truncate">{shown ?? field.label}</span>
        {shown ? (
          <span
            role="button"
            tabIndex={-1}
            aria-label={`Clear ${field.label}`}
            onClick={(event) => {
              event.stopPropagation()
              if (index !== -1) model.remove(index)
            }}
            className="grid size-4 shrink-0 place-items-center rounded-full text-accent"
          >
            <X className="size-3" />
          </span>
        ) : (
          <ChevronsUpDown className="size-3.5 shrink-0 text-line-ico" />
        )}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          side="bottom"
          align="start"
          sideOffset={4}
          className="z-50"
        >
          <Menu.Popup
            className={cn(
              "flex max-h-80 min-w-[15rem] flex-col rounded-card border border-hairline bg-canvas p-1.5 shadow-pop",
              POP_MOTION
            )}
          >
            {options.length > 8 && (
              <div className="mb-1 flex items-center gap-2 border-b border-hairline px-2 pb-1.5">
                <Search className="size-3.5 shrink-0 text-line-ico" />
                <input
                  autoFocus
                  value={needle}
                  onChange={(event) => setNeedle(event.target.value)}
                  onKeyDown={(event) => event.stopPropagation()}
                  aria-label={`Search ${field.label}`}
                  className="min-w-0 flex-1 bg-transparent py-1 text-[0.875rem] text-ink outline-none placeholder:text-mute"
                />
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {shortlist.length === 0 && (
                <p className="px-2 py-3 text-[0.875rem] text-mute">
                  No {field.label.toLowerCase()} like that.
                </p>
              )}
              {shortlist.map((option) => {
                const on = chosen.includes(option.value)
                return (
                  <Menu.Item
                    key={option.value}
                    onClick={() => {
                      const next: Filter = {
                        ...(clause ?? {
                          column: field.column,
                          operator: first,
                        }),
                        column: field.column,
                        operator: clause?.operator ?? first,
                        values: on ? [] : [option.value],
                      }
                      if (next.values?.length === 0 && index !== -1) {
                        model.remove(index)
                      } else if (index === -1) {
                        model.commit(next)
                      } else {
                        model.update(index, next)
                      }
                    }}
                    className={cn(
                      "flex min-h-8 cursor-default items-center gap-2 rounded-inner px-2 text-[0.875rem] outline-none select-none",
                      on ? "text-ink" : "text-text",
                      "data-[highlighted]:bg-soft-2"
                    )}
                  >
                    <span className="grid w-3.5 shrink-0 place-items-center text-accent">
                      {on && <Check className="size-3.5" />}
                    </span>
                    {/* A colour swatch, a status dot — whatever the field says
                        stands beside its values. The omnibox's rows have drawn
                        it since they existed (`OptionRowContent`); this list
                        did not, so the one facet that is RECOGNISED rather than
                        read arrived here as a column of ticked words. */}
                    {field.spec.leading?.(option.value)}
                    <span className="truncate">{option.label}</span>
                  </Menu.Item>
                )
              })}
            </div>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

/* -------------------------------------------------------------------------- */
/*  Saved views                                                                */
/* -------------------------------------------------------------------------- */

interface SavedView {
  readonly name: string
  readonly filters: readonly Filter[]
}

const storageKey = (id: string) => `hub.saved-views.${id}`
const fieldsKey = (id: string) => `hub.filter-fields.${id}`

/// Which fields the panel shows, or `null` for "all of them" — the state a
/// list starts in and returns to with Show all.
function readFields(id: string): string[] | null {
  try {
    const raw = localStorage.getItem(fieldsKey(id))
    if (raw === null) return null
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.map(String) : null
  } catch {
    return null
  }
}

function writeFields(id: string, next: string[] | null) {
  try {
    if (next === null) localStorage.removeItem(fieldsKey(id))
    else localStorage.setItem(fieldsKey(id), JSON.stringify(next))
  } catch {
    /* the choice still applies for this session */
  }
}

/// Both the panel and the picker read this store, and a view saved in one has
/// to appear in the other without a reload. `storage` events do not fire in the
/// tab that wrote, so the store keeps its own list of listeners.
const listeners = new Set<() => void>()
function announce() {
  listeners.forEach((fn) => fn())
}

function readViews(id: string): SavedView[] {
  try {
    const raw = localStorage.getItem(storageKey(id))
    const parsed = raw === null ? [] : (JSON.parse(raw) as unknown)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (one): one is SavedView =>
        typeof one === "object" &&
        one !== null &&
        typeof (one as SavedView).name === "string" &&
        Array.isArray((one as SavedView).filters)
    )
  } catch {
    // A browser with storage switched off still gets a working list; it simply
    // cannot keep a view. Better than a screen that fails to draw.
    return []
  }
}

/// The named questions, kept in this browser.
export function SavedViews({
  model,
  id = "orders",
}: {
  readonly model: FilterState
  readonly id?: string
}) {
  const [views, setViews] = useState<SavedView[]>([])
  const [name, setName] = useState("")
  useEffect(() => setViews(readViews(id)), [id])

  useEffect(() => {
    const refresh = () => setViews(readViews(id))
    listeners.add(refresh)
    return () => void listeners.delete(refresh)
  }, [id])

  const write = (next: SavedView[]) => {
    setViews(next)
    announce()
    try {
      localStorage.setItem(storageKey(id), JSON.stringify(next))
    } catch {
      /* nothing to do: the list still works, it just will not be here tomorrow */
    }
  }

  const save = () => {
    const trimmed = name.trim()
    if (trimmed === "") return
    write([
      ...views.filter((one) => one.name !== trimmed),
      { name: trimmed, filters: model.filters },
    ])
    setName("")
  }

  const apply = (view: SavedView) => {
    model.clear()
    view.filters.forEach((one) => model.commit(one))
  }

  return (
    <div className="mt-1 flex flex-col gap-2 border-t border-hairline pt-3">
      <h5 className="text-[0.875rem] font-semibold text-body">Saved views</h5>

      {views.length > 0 && (
        <ul className="flex flex-col gap-px">
          {views.map((view) => (
            <li key={view.name} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => apply(view)}
                className="flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-inner px-2 text-left text-[0.875rem] text-text transition-colors hover:bg-soft-2 hover:text-ink"
              >
                <Bookmark className="size-3.5 shrink-0 text-line-ico" />
                <span className="truncate">{view.name}</span>
                <span className="ml-auto shrink-0 text-[0.875rem] text-mute tabular-nums">
                  {count(view.filters.length)}
                </span>
              </button>
              <button
                type="button"
                aria-label={`Delete ${view.name}`}
                onClick={() =>
                  write(views.filter((one) => one.name !== view.name))
                }
                className="grid size-7 shrink-0 place-items-center rounded-inner text-line-ico transition-colors hover:bg-soft-2 hover:text-text"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-1.5">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && save()}
          aria-label="Name this view"
          className="h-[2.125rem] min-w-0 flex-1 rounded-inner border border-hairline-2 bg-canvas px-2.5 text-[0.875rem] text-ink outline-none placeholder:text-mute focus:border-accent"
        />
        <button
          type="button"
          onClick={save}
          disabled={name.trim() === ""}
          className="inline-flex h-[2.125rem] shrink-0 items-center gap-1.5 rounded-inner border border-hairline-2 bg-canvas px-2.5 text-[0.875rem] font-medium text-text transition-colors hover:bg-soft-2 disabled:opacity-50"
        >
          <Save className="size-3.5" />
          Save
        </button>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  The columns menu                                                           */
/* -------------------------------------------------------------------------- */

/// Which columns this table is showing — the ones it HAS, no more.
///
/// A catalogue of every field the document could offer is a different feature
/// and needs the server to declare its fields; this is the tick list for the
/// columns already here, which is what was asked for.
/// Export what the list holds as a CSV file — the one button every list uses.
///
/// The screen says what the file is called, which columns it has, and how to
/// get the rows; this does the rest. `rows` is a function rather than an
/// array because the list on screen is usually one page of the book, and an
/// export is of the whole of what the filters match — so the screen fetches
/// it, once, when the button is pressed.
export function ExportCsv<Row>({
  title,
  columns,
  rows,
  className,
}: {
  /// What the file is named after — `Suppliers` becomes `Suppliers.csv`.
  readonly title: string
  readonly columns: readonly CsvColumn<Row>[]
  readonly rows: () => Promise<readonly Row[]> | readonly Row[]
  readonly className?: string
}) {
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          const all = await rows()
          downloadCsv(csvName(title), toCsv(columns, all))
        } catch (problem) {
          toast.error(
            problem instanceof Error ? problem.message : "The export failed."
          )
        } finally {
          setBusy(false)
        }
      }}
      className={cn(
        "inline-flex h-control items-center gap-1.5 rounded-inner px-[0.5625rem] text-[0.875rem] font-medium text-body transition-colors hover:bg-soft-2 hover:text-ink disabled:opacity-60",
        className
      )}
    >
      <Download className="size-3.5 stroke-[1.7]" />
      {busy ? "Exporting…" : "Export CSV"}
    </button>
  )
}

export function ColumnsMenu({
  table,
  className,
  label = "Columns",
  extra,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly table: any
  readonly className?: string
  /// The button's word. "View" on a screen whose menu also carries other
  /// view switches (see `extra`).
  readonly label?: string
  /// Other view controls, drawn above the column ticks.
  readonly extra?: React.ReactNode
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const columns = table.getAllLeafColumns().filter((column: any) => {
    const header = column.columnDef.header
    return typeof header === "string" && header !== ""
  })

  return (
    <Menu.Root>
      <Menu.Trigger
        className={cn(
          "inline-flex h-control items-center gap-1.5 rounded-inner px-[0.5625rem] text-[0.875rem] font-medium text-body transition-colors hover:bg-soft-2 hover:text-ink",
          className
        )}
      >
        <Columns3 className="size-3.5 stroke-[1.7]" />
        {label}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          side="bottom"
          align="end"
          sideOffset={4}
          className="z-50"
        >
          <Menu.Popup
            className={cn(
              "min-w-[13rem] rounded-card border border-hairline bg-canvas p-1.5 shadow-pop",
              POP_MOTION
            )}
          >
            {extra}
            <span className="block px-2 pt-1 pb-1.5 text-eyebrow font-semibold tracking-[0.05em] text-mute uppercase">
              Columns
            </span>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {columns.map((column: any) => {
              const on = column.getIsVisible()
              return (
                <Menu.Item
                  key={column.id}
                  closeOnClick={false}
                  onClick={() => column.toggleVisibility(!on)}
                  className={cn(
                    "flex min-h-8 cursor-default items-center gap-2 rounded-inner px-2 text-[0.875rem] outline-none select-none",
                    on ? "text-ink" : "text-text",
                    "data-[highlighted]:bg-soft-2"
                  )}
                >
                  <span className="grid w-3.5 shrink-0 place-items-center text-accent">
                    {on && <Check className="size-3.5" />}
                  </span>
                  {columnName(column)}
                </Menu.Item>
              )
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

/* -------------------------------------------------------------------------- */
/*  The view picker                                                            */
/* -------------------------------------------------------------------------- */

/// The named questions, beside the title where the screen's own controls are.
///
/// It says which view you are in, and `edited` the moment the filters stop
/// matching it — picking a view REPLACES what the toolbar is showing, which is
/// the same kind of act as switching a screen, so it stands with the title
/// rather than among the tools that narrow one list.
export function ViewPicker({
  model,
  id = "orders",
  all = "All orders",
  views,
  view,
  onView,
  className,
}: {
  readonly model: FilterState
  readonly id?: string
  /// What the button says when nothing is narrowing the list. It names the
  /// ROWS — "All suppliers" over the supplier book — because the picker is
  /// read as a statement about what is on screen, and a second list that
  /// called itself "All orders" was the giveaway that this control had been
  /// written for one screen.
  readonly all?: string
  /// Readings of the list the SCREEN owns, above the ones somebody saved.
  ///
  /// Allotment has three — the book, one shop's, one garment's — and they are
  /// not filter clauses: each is a different question asked of a different
  /// endpoint, so no set of chips could express them. They were a row of tabs
  /// until 2026-09-13, which said "these are three screens" when they are three
  /// readings of one list; here they sit with the saved views because picking
  /// either is the same act — replacing what the list is showing.
  readonly views?: readonly { readonly value: string; readonly label: string }[]
  readonly view?: string
  readonly onView?: (value: string) => void
  readonly className?: string
}) {
  const [saved, setSaved] = useState<SavedView[]>([])
  useEffect(() => {
    const refresh = () => setSaved(readViews(id))
    refresh()
    listeners.add(refresh)
    return () => void listeners.delete(refresh)
  }, [id])

  const same = (a: readonly Filter[], b: readonly Filter[]) =>
    JSON.stringify(a) === JSON.stringify(b)
  const here = saved.find((one) => same(one.filters, model.filters))
  /// What the list is showing when no clause is narrowing it: the screen's own
  /// reading if it has several, and otherwise the name of the rows.
  const standing = views?.find((one) => one.value === view)?.label ?? all
  const label = model.filters.length === 0 ? standing : (here?.name ?? standing)

  const save = () => {
    const name = window.prompt("Name this view")?.trim()
    if (!name) return
    const next = [
      ...readViews(id).filter((one) => one.name !== name),
      { name, filters: model.filters },
    ]
    try {
      localStorage.setItem(storageKey(id), JSON.stringify(next))
    } catch {
      /* the view is still applied; it just will not be here tomorrow */
    }
    announce()
  }

  return (
    <Menu.Root>
      <Menu.Trigger
        className={cn(
          "inline-flex h-control items-center gap-2 rounded-inner border border-hairline-2 bg-canvas px-2.5 text-[0.875rem] font-medium text-text shadow-soft transition-colors hover:bg-soft-2",
          className
        )}
      >
        <Bookmark className="size-3.5 text-line-ico" />
        {label}
        {here === undefined && model.filters.length > 0 && (
          <span className="rounded-full bg-warn-bg px-1.5 py-px text-[0.875rem] font-semibold text-warn-fg">
            edited
          </span>
        )}
        <ChevronsUpDown className="size-3.5 text-line-ico" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          side="bottom"
          align="end"
          sideOffset={4}
          className="z-50"
        >
          <Menu.Popup
            className={cn(
              "min-w-[14rem] rounded-card border border-hairline bg-canvas p-1.5 shadow-pop",
              POP_MOTION
            )}
          >
            <span className="block px-2 pt-1 pb-1.5 text-[0.875rem] font-semibold tracking-[0.06em] text-mute uppercase">
              Views
            </span>
            {/* The screen's own readings, when it has more than one. Choosing
                one does not touch the clauses: "by store" and "issued after 1
                Aug" are different questions, and a picker that silently dropped
                the second would be a picker nobody could trust. */}
            {views?.map((one) => (
              <Menu.Item
                key={one.value}
                onClick={() => onView?.(one.value)}
                className={cn(ITEM, one.value === view && "text-ink")}
                aria-current={one.value === view}
              >
                <span className="grid w-3.5 shrink-0 place-items-center text-accent">
                  {one.value === view && <Check className="size-3.5" />}
                </span>
                <span className="truncate">{one.label}</span>
              </Menu.Item>
            ))}
            {views &&
              views.length > 0 &&
              (saved.length > 0 || model.filters.length > 0) && (
                <hr className="my-1.5 border-hairline" />
              )}
            {views === undefined && (
              <Menu.Item
                onClick={() => model.clear()}
                className={ITEM}
                aria-current={model.filters.length === 0}
              >
                <span className="grid w-3.5 shrink-0 place-items-center text-accent">
                  {model.filters.length === 0 && <Check className="size-3.5" />}
                </span>
                {all}
              </Menu.Item>
            )}
            {views !== undefined && model.filters.length > 0 && (
              <Menu.Item onClick={() => model.clear()} className={ITEM}>
                <span className="grid w-3.5 shrink-0 place-items-center text-accent" />
                Clear the filters
              </Menu.Item>
            )}
            {saved.map((one) => (
              <Menu.Item
                key={one.name}
                onClick={() => {
                  model.clear()
                  one.filters.forEach((clause) => model.commit(clause))
                }}
                className={ITEM}
              >
                <span className="grid w-3.5 shrink-0 place-items-center text-accent">
                  {here?.name === one.name && <Check className="size-3.5" />}
                </span>
                <span className="truncate">{one.name}</span>
                <span className="ml-auto shrink-0 text-[0.875rem] text-mute tabular-nums">
                  {count(one.filters.length)}
                </span>
              </Menu.Item>
            ))}
            {model.filters.length > 0 && here === undefined && (
              <>
                <hr className="my-1.5 border-hairline" />
                <Menu.Item onClick={save} className={ITEM}>
                  <Save className="size-3.5 text-line-ico" />
                  Save this as a view
                </Menu.Item>
              </>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

const ITEM =
  "flex min-h-8 cursor-default items-center gap-2 rounded-inner px-2 text-[0.875rem] text-text outline-none select-none data-[highlighted]:bg-soft-2"

/* -------------------------------------------------------------------------- */
/*  The sort menu                                                              */
/* -------------------------------------------------------------------------- */

/// Which column the list is ordered by, said in words.
///
/// The headers sort too, and will go on doing so: this is for the reader who
/// wants to know what the order IS without hunting for the arrow, and for a
/// touch screen where a header is a small target.
export function SortMenu({
  table,
  sorting,
  onSort,
  compact = false,
  className,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly table: any
  /// The screen's own sorting state. Read from the caller rather than from the
  /// table: this app is on TanStack v9, where the table instance does not
  /// expose `getState`, and the screens hold the state anyway because it
  /// travels in the request.
  readonly sorting: readonly { readonly id: string; readonly desc: boolean }[]
  readonly onSort: (id: string, desc: boolean) => void
  /// Under 48rem the trigger is the arrow alone. A column name on its own —
  /// "Receiving" — read on a phone as a button that did something called
  /// receiving, and it was the one label pushing the toolbar off the glass.
  /// The menu still names the column; the trigger's accessible name says it.
  readonly compact?: boolean
  readonly className?: string
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const columns = (table?.getAllLeafColumns() ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (column: any) =>
        column.getCanSort() && typeof column.columnDef.header === "string"
    )
  const current = sorting[0]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const by = columns.find((column: any) => column.id === current?.id)
  const label = by === undefined ? "Sort" : columnName(by)

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`Sort by ${label}`}
        title={`Sort by ${label}`}
        className={cn(
          "inline-flex h-control items-center gap-1.5 rounded-inner px-[0.5625rem] text-[0.875rem] font-medium text-body transition-colors hover:bg-soft-2 hover:text-ink",
          className
        )}
      >
        {current?.desc ? (
          <ArrowDown className="size-3.5 stroke-[1.7]" />
        ) : (
          <ArrowUp className="size-3.5 stroke-[1.7]" />
        )}
        <span className={cn(compact && "max-md:sr-only")}>{label}</span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          side="bottom"
          align="end"
          sideOffset={4}
          className="z-50"
        >
          <Menu.Popup
            className={cn(
              "min-w-[13rem] rounded-card border border-hairline bg-canvas p-1.5 shadow-pop",
              POP_MOTION
            )}
          >
            <span className="block px-2 pt-1 pb-1.5 text-[0.875rem] font-semibold tracking-[0.06em] text-mute uppercase">
              Sort by
            </span>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {columns.map((column: any) => {
              const on = column.id === current?.id
              return (
                <Menu.Item
                  key={column.id}
                  closeOnClick={false}
                  onClick={() =>
                    onSort?.(column.id, on ? !current.desc : false)
                  }
                  className={cn(ITEM, on && "text-ink")}
                >
                  <span className="grid w-3.5 shrink-0 place-items-center text-accent">
                    {on &&
                      (current.desc ? (
                        <ArrowDown className="size-3.5" />
                      ) : (
                        <ArrowUp className="size-3.5" />
                      ))}
                  </span>
                  {columnName(column)}
                </Menu.Item>
              )
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

/// The same menu for a list that is not a table.
///
/// `SortMenu` above reads the sort out of a TanStack table's columns, which a
/// screen drawing a grid of cards does not have — Sourcing's four orders are
/// relevance, newest and the price in each direction, and none of them is a
/// column anybody could tick. Rather than let that screen keep its own row of
/// pills, which is how one module ends up with two sort controls that look
/// nothing alike, the trigger is the same and only the source of the options
/// differs.
export function ChoiceMenu({
  heading,
  value,
  options,
  onChange,
  icon: Icon = ArrowUpDown,
  className,
}: {
  /// What is being chosen, over the list. "Sort by" on both menus.
  readonly heading: string
  /// The chosen value, or null for the first option — the state a list is in
  /// before anybody has asked for an order.
  readonly value: string | null
  readonly options: readonly {
    readonly value: string | null
    readonly label: string
  }[]
  readonly onChange: (value: string | null) => void
  /// The mark on the trigger, which says WHICH KIND of choice this is. Two
  /// arrows means an order; a screen narrowing its list by a status wants the
  /// filter mark instead, or the button claims to sort and does not. Defaults
  /// to the sort mark because that is what this menu was first for.
  readonly icon?: React.ComponentType<{ className?: string }>
  readonly className?: string
}) {
  const here = options.find((option) => option.value === value) ?? options[0]

  return (
    <Menu.Root>
      <Menu.Trigger
        className={cn(
          "inline-flex h-control items-center gap-1.5 rounded-inner px-[0.5625rem] text-[0.875rem] font-medium text-body transition-colors hover:bg-soft-2 hover:text-ink",
          className
        )}
      >
        <Icon className="size-3.5 stroke-[1.7]" />
        {here?.label}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          side="bottom"
          align="end"
          sideOffset={4}
          className="z-50"
        >
          <Menu.Popup
            className={cn(
              "min-w-[13rem] rounded-card border border-hairline bg-canvas p-1.5 shadow-pop",
              POP_MOTION
            )}
          >
            <span className="block px-2 pt-1 pb-1.5 text-[0.875rem] font-semibold tracking-[0.06em] text-mute uppercase">
              {heading}
            </span>
            {options.map((option) => {
              const on = option.value === (here?.value ?? null)
              return (
                <Menu.Item
                  key={option.label}
                  onClick={() => onChange(option.value)}
                  className={cn(ITEM, on && "text-ink")}
                >
                  <span className="grid w-3.5 shrink-0 place-items-center text-accent">
                    {on && <Check className="size-3.5" />}
                  </span>
                  {option.label}
                </Menu.Item>
              )
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

/* -------------------------------------------------------------------------- */
/*  The quick filter row                                                       */
/* -------------------------------------------------------------------------- */

/// A box per column, above the rows it narrows.
///
/// The prototype keeps this AND the panel at the right, and the duplication is
/// the point: the row is for the question you already know the answer to —
/// this supplier, that status — and the panel is for building one. Frappe does
/// the same, with the handful of fields a doctype marks `in_standard_filter`.
///
/// There is no text box in it. One stood here and was taken out: a PO number
/// is what ⌘K is for, and a box that searches beside three boxes that filter
/// is two grammars on one line.
export function QuickFilters({
  model,
  table,
  className,
}: {
  readonly model: FilterState
  /// See `DockedFilters.table`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly table?: any
  readonly className?: string
}) {
  const { fields } = model
  return (
    <div
      className={cn(
        // As many columns as there are boxes, so the row fills the width the
        // way the prototype's four do rather than trailing off half way.
        "grid gap-2 sm:grid-cols-2",
        fields.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3",
        className
      )}
    >
      {fields.map((field) => (
        <FieldRow
          key={field.column}
          field={field}
          model={model}
          table={table}
          quick
        />
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  The phone's one button for all three                                       */
/* -------------------------------------------------------------------------- */

/// Filter, sort and views, as ONE control on a phone — a dynamic sheet.
///
/// On the desk they are three controls on the toolbar's line, and that is
/// right there. On a 375px screen the three, plus search and New order, broke
/// the toolbar onto two and three lines and pushed the list down the glass.
/// So below 48rem a list shows one button beside its search, and it opens one
/// sheet whose first page names the three with what each is set to; tapping
/// one changes the sheet's page in place (`MorphHeight`) rather than stacking
/// a second sheet on the first, and ← goes back. Nothing here is new
/// behaviour: the filter page is `FilterControls`, the sort page is the same
/// columns `SortMenu` offers, the views page is `ViewPicker`'s list.
export function ListOptionsSheet({
  model,
  filterModel,
  table,
  sorting = [],
  onSort,
  orders,
  id = "orders",
  all = "All orders",
  className,
}: {
  /// What the views are compared against and applied to.
  readonly model: FilterState
  /// What the filter page edits — the same state, usually with the server's
  /// facet counts folded into its fields.
  readonly filterModel?: FilterState
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly table?: any
  readonly sorting?: readonly { readonly id: string; readonly desc: boolean }[]
  readonly onSort?: (id: string, desc: boolean) => void
  /// A list sorted by a named order rather than by a table column — Sourcing's
  /// "Best match · Newest · Price low" — offered on the sort page instead of
  /// the columns. `null` is the list's own default order.
  readonly orders?: {
    readonly options: readonly {
      readonly value: string | null
      readonly label: string
    }[]
    readonly value: string | null
    readonly onChange: (value: string | null) => void
  }
  readonly id?: string
  readonly all?: string
  readonly className?: string
}) {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState<string>("menu")
  const [back, setBack] = useState(false)
  const go = (next: string, backwards = next === "menu") => {
    setBack(backwards)
    setPage(next)
  }
  const fm = filterModel ?? model
  const fieldPage = page.startsWith("field:")
    ? fm.fields.find((one) => one.column === page.slice(6))
    : undefined

  const [saved, setSaved] = useState<SavedView[]>([])
  useEffect(() => {
    const refresh = () => setSaved(readViews(id))
    refresh()
    listeners.add(refresh)
    return () => void listeners.delete(refresh)
  }, [id])
  const same = (a: readonly Filter[], b: readonly Filter[]) =>
    JSON.stringify(a) === JSON.stringify(b)
  const here = saved.find((one) => same(one.filters, model.filters))
  const viewLabel = model.filters.length === 0 ? all : (here?.name ?? "Custom")

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const columns = (table?.getAllLeafColumns() ?? []).filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (column: any) =>
      column.getCanSort() && typeof column.columnDef.header === "string"
  )
  const current = sorting[0]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const by = columns.find((column: any) => column.id === current?.id)
  const sortLabel =
    orders !== undefined
      ? (orders.options.find((one) => one.value === orders.value)?.label ??
        "Default")
      : by === undefined
        ? "Default"
        : columnName(by)

  const narrowing = model.filters.length
  const title =
    fieldPage !== undefined
      ? fieldPage.label
      : page === "clauses"
        ? "Edit filters"
        : page === "filter"
          ? "Filter"
          : page === "sort"
            ? "Sort by"
            : page === "views"
              ? "Views"
              : "Show"

  const ROW =
    "flex min-h-12 w-full items-center gap-3 rounded-inner px-3 text-left text-[0.9375rem] text-ink active:bg-soft-2"

  return (
    <>
      <button
        type="button"
        aria-label={
          narrowing > 0
            ? `Filter, sort and views, ${narrowing} filters`
            : "Filter, sort and views"
        }
        aria-haspopup="dialog"
        onClick={() => {
          setPage("menu")
          setOpen(true)
        }}
        className={cn(
          "relative grid size-tap shrink-0 place-items-center rounded-inner border border-hairline-2 bg-canvas text-text shadow-soft transition-[scale] duration-(--t-press) active:scale-[0.97]",
          className
        )}
      >
        <SlidersHorizontal className="size-4" />
        {narrowing > 0 && (
          <span className="absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[0.875rem] font-semibold text-white tabular-nums ring-2 ring-canvas">
            {narrowing}
          </span>
        )}
      </button>

      <BottomSheet
        open={open}
        onOpenChange={setOpen}
        title={title}
        onBack={
          page === "menu"
            ? undefined
            : () =>
                go(fieldPage || page === "clauses" ? "filter" : "menu", true)
        }
        action={
          page === "filter" && narrowing > 0 ? (
            <button
              type="button"
              onClick={() => model.clear()}
              className="h-tap shrink-0 rounded-inner px-3 text-[0.9375rem] font-medium text-accent"
            >
              Clear
            </button>
          ) : undefined
        }
      >
        <MorphHeight page={page} back={back}>
          <div className="px-2 pb-3">
            {page === "menu" && (
              <>
                {[
                  {
                    to: "filter" as const,
                    icon: ListFilter,
                    label: "Filter",
                    value: narrowing === 0 ? "None" : count(narrowing),
                  },
                  {
                    to: "sort" as const,
                    icon: current?.desc ? ArrowDown : ArrowUp,
                    label: "Sort by",
                    value: sortLabel,
                  },
                  {
                    to: "views" as const,
                    icon: Bookmark,
                    label: "View",
                    value: viewLabel,
                  },
                ].map((one) => (
                  <button
                    key={one.to}
                    type="button"
                    onClick={() => go(one.to)}
                    className={ROW}
                  >
                    <one.icon className="size-4 shrink-0 text-line-ico" />
                    <span className="flex-1">{one.label}</span>
                    <span className="max-w-[45%] truncate text-body">
                      {one.value}
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-line-ico" />
                  </button>
                ))}
              </>
            )}

            {page === "filter" && (
              <>
                {fm.fields.map((field) => (
                  <SheetFieldRow
                    key={field.column}
                    field={field}
                    model={fm}
                    table={table}
                    className={ROW}
                    onOpen={(oneTap) =>
                      go(oneTap ? `field:${field.column}` : "clauses")
                    }
                  />
                ))}
                {/* The questions a one-tap list cannot ask — a date range,
                    a price band, "is not" — in the full clause editor. */}
                <button
                  type="button"
                  onClick={() => go("clauses")}
                  className={cn(ROW, "text-body")}
                >
                  <SlidersHorizontal className="size-4 shrink-0 text-line-ico" />
                  <span className="flex-1">Edit filters</span>
                  <ChevronRight className="size-4 shrink-0 text-line-ico" />
                </button>
              </>
            )}

            {fieldPage !== undefined && (
              <SheetFieldOptions
                field={fieldPage}
                model={fm}
                table={table}
                rowClass={ROW}
              />
            )}

            {page === "clauses" && (
              <div className="px-2">
                <FilterControls
                  model={fm}
                  table={table}
                  stacked
                  touch
                  withClear={false}
                />
              </div>
            )}

            {page === "sort" &&
              orders !== undefined &&
              orders.options.map((one) => {
                const on = one.value === orders.value
                return (
                  <button
                    key={one.label}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      orders.onChange(one.value)
                      setOpen(false)
                    }}
                    className={cn(ROW, on && "font-medium")}
                  >
                    <span className="flex-1">{one.label}</span>
                    {on && <Check className="size-4 text-accent" />}
                  </button>
                )
              })}

            {page === "sort" &&
              orders === undefined &&
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              columns.map((column: any) => {
                const on = column.id === current?.id
                return (
                  <button
                    key={column.id}
                    type="button"
                    aria-pressed={on}
                    // A second tap on the column that is already the order
                    // turns it round, the way a header does.
                    onClick={() =>
                      onSort?.(column.id, on ? !current.desc : false)
                    }
                    className={cn(ROW, on && "font-medium")}
                  >
                    <span className="flex-1">{columnName(column)}</span>
                    {on &&
                      (current.desc ? (
                        <ArrowDown className="size-4 text-accent" />
                      ) : (
                        <ArrowUp className="size-4 text-accent" />
                      ))}
                  </button>
                )
              })}

            {page === "views" && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    model.clear()
                    setOpen(false)
                  }}
                  className={ROW}
                >
                  <span className="flex-1">{all}</span>
                  {narrowing === 0 && <Check className="size-4 text-accent" />}
                </button>
                {saved.map((one) => (
                  <button
                    key={one.name}
                    type="button"
                    onClick={() => {
                      model.clear()
                      one.filters.forEach((clause) => model.commit(clause))
                      setOpen(false)
                    }}
                    className={ROW}
                  >
                    <span className="flex-1 truncate">{one.name}</span>
                    <span className="text-meta text-mute tabular-nums">
                      {count(one.filters.length)}
                    </span>
                    {here?.name === one.name && (
                      <Check className="size-4 text-accent" />
                    )}
                  </button>
                ))}
                {narrowing > 0 && here === undefined && (
                  <button
                    type="button"
                    onClick={() => {
                      const name = window.prompt("Name this view")?.trim()
                      if (!name) return
                      const next = [
                        ...readViews(id).filter((one) => one.name !== name),
                        { name, filters: model.filters },
                      ]
                      try {
                        localStorage.setItem(
                          storageKey(id),
                          JSON.stringify(next)
                        )
                      } catch {
                        /* applied; it just will not be here tomorrow */
                      }
                      announce()
                    }}
                    className={cn(ROW, "text-accent")}
                  >
                    <Save className="size-4" />
                    <span className="flex-1">Save this as a view</span>
                  </button>
                )}
              </>
            )}
          </div>
        </MorphHeight>
      </BottomSheet>
    </>
  )
}

/// Whether a field's values can be listed and picked with one tap — the same
/// test the docked panel's rows apply.
function isOneTap(field: FilterField, options: readonly unknown[]): boolean {
  const kind = field.spec.kind
  return (
    (kind === "option" ||
      kind === "multi" ||
      kind === "boolean" ||
      kind === "text") &&
    options.length > 0
  )
}

/// One field on the sheet's filter page: its name, what it is set to, and a
/// step into its values. A component rather than a map body because the
/// values come from a hook (`useOptions`).
function SheetFieldRow({
  field,
  model,
  table,
  className,
  onOpen,
}: {
  field: FilterField
  model: FilterState
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table?: any
  className: string
  onOpen: (oneTap: boolean) => void
}) {
  const options = useOptions(field, table)
  const clause = model.filters.find((one) => one.column === field.column)
  const chosen = clause?.values ?? []
  const shown =
    clause === undefined
      ? "Any"
      : chosen.length === 1
        ? (field.spec.format?.(chosen[0]) ??
          options.find((one) => one.value === chosen[0])?.label ??
          chosen[0])
        : chosen.length > 1
          ? `${count(chosen.length)} chosen`
          : "Set"
  return (
    <button
      type="button"
      onClick={() => onOpen(isOneTap(field, options))}
      className={className}
    >
      <span className="flex-1 truncate">{field.label}</span>
      <span
        className={cn(
          "max-w-[50%] truncate",
          clause === undefined ? "text-body" : "font-medium text-accent"
        )}
      >
        {shown}
      </span>
      <ChevronRight className="size-4 shrink-0 text-line-ico" />
    </button>
  )
}

/// A field's values as a page of the sheet: tap one to narrow the list to it,
/// tap it again to let go — the docked panel's one-tap rows, a thumb's size.
function SheetFieldOptions({
  field,
  model,
  table,
  rowClass,
}: {
  field: FilterField
  model: FilterState
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table?: any
  rowClass: string
}) {
  const options = useOptions(field, table)
  const [needle, setNeedle] = useState("")
  const index = model.filters.findIndex((one) => one.column === field.column)
  const clause = index === -1 ? undefined : model.filters[index]
  const first = operatorsFor(field.spec)[0]
  const chosen = clause?.values ?? []
  const shortlist =
    needle.trim() === ""
      ? options
      : options.filter((one) =>
          one.label.toLowerCase().includes(needle.trim().toLowerCase())
        )
  const pick = (value: string) => {
    const on = chosen.includes(value)
    const next: Filter = {
      ...(clause ?? { column: field.column, operator: first }),
      column: field.column,
      operator: clause?.operator ?? first,
      values: on ? [] : [value],
    }
    if (next.values?.length === 0 && index !== -1) model.remove(index)
    else if (index === -1) model.commit(next)
    else model.update(index, next)
  }
  return (
    <>
      {options.length > 8 && (
        <label className="mx-2 mb-2 flex h-11 items-center gap-2 rounded-inner border border-hairline-2 bg-soft px-3 focus-within:border-accent">
          <Search className="size-4 shrink-0 text-line-ico" />
          <input
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && shortlist[0]) {
                event.preventDefault()
                pick(shortlist[0].value)
              }
            }}
            enterKeyHint="done"
            aria-label={`Search ${field.label}`}
            className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-mute"
          />
        </label>
      )}
      {shortlist.length === 0 && (
        <p className="px-3 py-6 text-center text-meta text-mute">
          No {field.label.toLowerCase()} like that.
        </p>
      )}
      {shortlist.map((option) => {
        const on = chosen.includes(option.value)
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            onClick={() => pick(option.value)}
            className={cn(rowClass, on && "font-medium")}
          >
            {field.spec.leading?.(option.value)}
            <span className="flex-1 truncate">{option.label}</span>
            {on && <Check className="size-4 shrink-0 text-accent" />}
          </button>
        )
      })}
    </>
  )
}
