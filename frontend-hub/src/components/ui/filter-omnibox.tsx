import { Combobox } from "@base-ui/react/combobox"
import { Search, X } from "lucide-react"
import { Fragment, useMemo, useRef, useState } from "react"

import {
  FilterChip,
  Keycap,
  OptionRowContent,
} from "@/components/ui/filter-chip"
import {
  CHIP,
  ITEM,
  POPUP,
  summarise,
  useOptions,
  type FilterOption,
} from "@/lib/filter-chrome"
import { facetMatches } from "@/components/ui/facets"
import {
  arity,
  isComplete,
  operatorSymbol,
  operatorVerb,
  operatorsFor,
  type Filter,
  type FilterField,
  type FilterState,
  type Operator,
} from "@/lib/filters"
import { cn } from "@/lib/utils"

/// One box that narrows a list: type a column, then type its value.
///
/// The bar this sits beside — `<FilterBar>` — builds the same clause with the
/// mouse: a menu for the column, a menu for the operator, a popover for the
/// value. Three surfaces and three clicks, and nothing reachable from the
/// keyboard. This builds it by typing, which is how somebody who uses the
/// screen daily actually wants to work.
///
/// **Everything happens in the one box.** That is the rule the whole component
/// is arranged around, and it is worth stating because the obvious
/// implementation breaks it: a chip that opens its own popover, a value list
/// anchored somewhere else, a second search field for free text. Each is easy
/// on its own and together they make a control with three carets, where
/// clicking anything moves focus somewhere you did not ask to go. So:
///
///  * there is ONE input, and it is the value editor as well as the column
///    picker — a prefix pill inside it says which clause is being edited, so
///    it is never ambiguous;
///  * there is ONE panel, and it does not unmount between column-picking and
///    value-picking — only its rows swap, so choosing a column produces no
///    close/open flicker;
///  * clicking a committed chip's value hands that clause back to the same
///    input and fills the same panel with its options, already ticked. A chip
///    is a trigger, not a surface.
///
/// Free text is a row like any other. When what has been typed names no
/// column, a `Search for …` row sits at the top of the panel and Enter commits
/// it to the screen's own text search. There is no heuristic and no timeout:
/// the row is visible, and Enter always takes the row that is highlighted.

/* -------------------------------------------------------------------------- */

/// A row in the panel. One flat list so a single highlight index addresses
/// everything — the same reason the command palette merges destinations and
/// records into one array.
type Row = {
  readonly id: string
  /// Which run of rows this belongs to, so the list can head each one. Rows of
  /// one group only are drawn without a heading — a heading over the whole
  /// list is furniture.
  readonly group?: "values" | "fields"
} & (
  | { readonly kind: "field"; readonly field: FilterField }
  | {
      readonly kind: "option"
      readonly option: FilterOption
      readonly checked: boolean
    }
  | { readonly kind: "commit" }
  | { readonly kind: "search" }
)

/// What the box is doing. `browsing` is also the resting state: the input is a
/// search box until somebody names a column.
type Stage =
  | { readonly at: "browsing" }
  | {
      readonly at: "editing"
      readonly field: FilterField
      readonly operator: Operator
      readonly values: readonly string[]
      /// The clause being edited, or `null` for one being raised. An index
      /// rather than a boolean because committing has to replace the right
      /// chip, not append a second one beside it.
      readonly index: number | null
    }

export function FilterOmnibox({
  model,
  text,
  onText,
  placeholder = "Filter, or search",
  className,
}: {
  readonly model: FilterState
  /// The screen's plain text search, in force. Drawn as a chip rather than
  /// left in the input, because a search that lives only in the box vanishes
  /// the moment somebody starts typing a column name — and then nothing on
  /// screen says why the list is short.
  readonly text?: string
  readonly onText: (next: string | undefined) => void
  readonly placeholder?: string
  readonly className?: string
}) {
  const { fields, filters, commit, update, remove, clear } = model

  const [stage, setStage] = useState<Stage>({ at: "browsing" })
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  /// Set while the draft's own dismiss button is being pressed. That button
  /// lives in the anchor rather than in the popup, so Base UI reads pressing
  /// it as a press outside and closes — but dropping a half-built clause is
  /// the one case where the panel should stay up, showing the columns it just
  /// went back to. A flag rather than a re-open afterwards, because a re-open
  /// races the close and loses about half the time.
  const dismissing = useRef(false)

  const options = useOptions(
    stage.at === "editing"
      ? stage.field
      : // `useOptions` is a hook and cannot be called conditionally. A field
        // with no spec and no counts costs one empty array.
        EMPTY_FIELD
  )

  const takes = stage.at === "editing" ? arity(stage.operator) : "one"
  const needle = query.trim()

  /// The panel's rows, derived every render and never stored.
  const rows = useMemo<Row[]>(() => {
    if (stage.at === "browsing") {
      const matched = fields
        .filter((field) => facetMatches(field.label, field.column, query))
        .map<Row>((field) => ({
          id: `field:${field.column}`,
          kind: "field",
          field,
        }))
      // The search row goes FIRST when nothing matched, so it is the
      // highlighted row and Enter does the obvious thing; under the columns
      // otherwise, where it is a deliberate arrow-down away.
      const search: Row[] =
        needle === "" ? [] : [{ id: "search", kind: "search" }]
      return matched.length === 0 ? search : [...matched, ...search]
    }

    if (takes === "none") return [{ id: "commit", kind: "commit" }]

    const kind = stage.field.spec.kind
    if (kind === "option" || kind === "multi" || kind === "boolean") {
      const shown = options
        .filter((option) => facetMatches(option.label, option.value, query))
        .map<Row>((option) => ({
          id: `option:${option.value}`,
          kind: "option",
          group: "values",
          option,
          checked:
            option.value === stage.field.spec.emptyValue
              ? stage.operator === "isEmpty"
              : stage.values.includes(option.value),
        }))
      // A `single` field applies each tick straight away — there is nothing
      // left to confirm, so no commit row. Everything else collects its values
      // first and commits them together.
      const commitRow: Row[] =
        stage.field.spec.single || stage.values.length === 0
          ? []
          : [{ id: "commit", kind: "commit", group: "values" }]
      // The other columns are always listed, under their own heading, not only
      // when what has been typed happens to name one. Reachability that
      // depends on guessing a word is not reachability: somebody who picked
      // the wrong column sees a list of divisions and nothing that says how to
      // leave, and the only ways out — Escape, Backspace — are keys with
      // nothing on screen to suggest them.
      const others: Row[] = fields
        .filter(
          (one) =>
            one.column !== stage.field.column &&
            facetMatches(one.label, one.column, query)
        )
        .map((one) => ({
          id: `field:${one.column}`,
          kind: "field",
          group: "fields",
          field: one,
        }))
      return [...shown, ...commitRow, ...others]
    }

    return [{ id: "commit", kind: "commit" }]
  }, [stage, fields, query, needle, options, takes])

  /* ---------------------------------------------------------------------- */

  const reset = () => {
    setStage({ at: "browsing" })
    setQuery("")
  }

  /// Hand a clause back to the input. Used when a column is picked, and when
  /// somebody clicks the value on a chip they have already committed.
  const edit = (field: FilterField, filter: Filter, index: number | null) => {
    setStage({
      at: "editing",
      field,
      operator: filter.operator,
      values: filter.values,
      index,
    })
    setQuery("")
    setOpen(true)
    input.current?.focus()
  }

  const save = (values: readonly string[], operator?: Operator) => {
    if (stage.at !== "editing") return
    const filter: Filter = {
      column: stage.field.column,
      operator: operator ?? stage.operator,
      values,
    }
    if (!isComplete(filter)) return
    if (stage.index === null) commit(filter)
    else update(stage.index, filter)
    reset()
    setOpen(false)
    input.current?.focus()
  }

  const choose = (row: Row) => {
    if (row.kind === "search") {
      onText(needle === "" ? undefined : needle)
      reset()
      setOpen(false)
      return
    }

    if (row.kind === "field") {
      edit(
        row.field,
        {
          column: row.field.column,
          operator: operatorsFor(row.field.spec)[0],
          values: [],
        },
        null
      )
      // An operator that takes nothing — "is empty" — is already a finished
      // clause the moment its column is named. Nothing to type, so nothing to
      // wait for.
      return
    }

    if (stage.at !== "editing") return

    if (row.kind === "option") {
      const value = row.option.value
      // The "nothing here" row is a question about the column, not a value it
      // holds, so it commits the operator that asks it. Offered in the list
      // rather than buried in the operator menu because the count beside it is
      // what makes somebody want it — "4 unfiled" is the whole prompt.
      if (value === stage.field.spec.emptyValue) return save([], "isEmpty")
      const held = stage.values.includes(value)
      const next = held
        ? stage.values.filter((one) => one !== value)
        : [...stage.values, value]
      // A single-value operator is finished the moment one is picked; a
      // set-valued one keeps the panel open so a second tick does not cost a
      // reopen. Clearing the query is what lets somebody type, tick, type,
      // tick without reaching for the mouse.
      if (takes === "one") return save([value])
      setStage({ ...stage, values: next })
      setQuery("")
      // A `single` field holds one clause per column, and `commit` replaces by
      // column — so every tick can go straight to the URL without any index to
      // keep track of, and the grid narrows as the list is read. This is what
      // the facet rail did, and losing it to a confirm step would be a worse
      // control wearing a better one's clothes. Unticking the last value
      // leaves an incomplete clause, which the encoder drops: the chip goes
      // away, which is what unticking everything means.
      if (stage.field.spec.single) {
        commit({
          column: stage.field.column,
          operator: stage.operator,
          values: next,
        })
      }
      return
    }

    // The commit row.
    if (takes === "none") return save([])
    if (takes === "many") return save(stage.values)
    save([needle])
  }

  /* ---------------------------------------------------------------------- */

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      if (stage.at === "editing") {
        event.preventDefault()
        event.stopPropagation()
        reset()
        return
      }
      if (open) {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
      }
      // Closed and browsing: let the screen or the sheet have it.
      return
    }

    if (event.key !== "Backspace" || query !== "") return

    // Backspace on an empty box steps back rather than deleting outright.
    if (stage.at === "editing") {
      event.preventDefault()
      // The label goes back into the box, so a mis-picked column costs one
      // keystroke to correct rather than a retype.
      setQuery(stage.field.label)
      setStage({ at: "browsing" })
      return
    }
    if (filters.length === 0) return
    event.preventDefault()
    // The last chip is popped into a live draft rather than dropped: Enter
    // puts it straight back, so the destructive reading of Backspace is never
    // the only one available.
    const index = filters.length - 1
    const last = filters[index]
    const field = fields.find((one) => one.column === last.column)
    if (!field) return
    remove(index)
    setStage({
      at: "editing",
      field,
      operator: last.operator,
      values: last.values,
      index: null,
    })
    setOpen(true)
  }

  if (fields.length === 0) return null

  const editing = stage.at === "editing" ? stage : null
  /// A clause being built that has no chip yet.
  ///
  /// It is the only state that wears the pill: the label, the border and the
  /// dismiss all exist to stand in for a chip that is not there. Once the
  /// clause IS a chip, wearing them again draws a second, empty chip beside
  /// the real one — which is exactly what a filter bar must never do, because
  /// every bordered thing in that row is supposed to be a filter.
  const drafting =
    editing !== null &&
    !filters.some((one) => one.column === editing.field.column)

  return (
    <Combobox.Root
      {...HIGHLIGHTS_FIRST}
      items={rows}
      // We have already filtered; the panel's rows depend on the stage as much
      // as on the query, which the built-in matcher cannot know about.
      filter={null}
      // Multi-select, though only ever one row is acted on, and the selection
      // is thrown away immediately. Single-select is the mode that reads
      // right and the wrong one to use: on picking, it writes the item's label
      // into the input and closes the popup — both correct for a combobox that
      // chooses one thing, and both wrong here, where picking a column is the
      // START of typing rather than the end of it. Fighting that with a state
      // update afterwards is a race. Multi-select simply does neither.
      multiple
      value={NOTHING_HELD}
      onValueChange={(picked) => {
        const row = (picked as Row[])[picked.length - 1]
        if (row) choose(row)
      }}
      inputValue={query}
      onInputValueChange={setQuery}
      open={open}
      onOpenChange={(next, details) => {
        // A pick is not an exit. Base UI closes the panel on `item-press`
        // because a combobox that chooses one thing is finished the moment it
        // is chosen; this one is usually only getting started — naming a
        // column is the beginning of typing a value, and ticking one of
        // several options says nothing about the rest. The panel closes when
        // the CLAUSE is done, which `save` decides, and on the ordinary exits
        // (a press outside, Escape) which arrive with their own reasons.
        if (!next && details.reason === "item-press") return
        if (!next && dismissing.current) {
          dismissing.current = false
          return
        }
        setOpen(next)
        // Closing ends the edit. Without this the box stays pointed at the
        // column somebody was last in, invisibly: the panel is gone, so
        // nothing on screen says "you are inside Division" — and the next
        // thing they type searches divisions and nothing else, which reads as
        // a box that has stopped offering the other filters.
        if (!next) setStage({ at: "browsing" })
      }}
      itemToStringLabel={(row) => (row ? rowLabel(row as Row) : "")}
      modal={false}
    >
      <div className={cn("relative", className)}>
        <Combobox.InputGroup
          className={cn(
            "flex min-h-10 w-full flex-wrap items-center gap-[0.375rem] rounded-[1.25rem] border border-transparent bg-soft-2 py-1.5 pr-3 pl-3 transition-colors",
            "hover:border-hairline-2 hover:bg-soft-3",
            "has-[input:focus-visible]:border-hairline-2 has-[input:focus-visible]:bg-canvas"
          )}
        >
          <Search className="ml-0.5 size-4 shrink-0 text-line-ico" />

          {/* The text search, if any, as the first chip. */}
          {text !== undefined && text !== "" && (
            <span
              className={cn(
                CHIP,
                "items-center gap-1.5 border border-hairline-2 bg-canvas pl-2.5"
              )}
            >
              <span className="text-mute">Search</span>
              <span className="max-w-[12rem] truncate font-medium text-ink">
                {text}
              </span>
              <button
                type="button"
                aria-label="Clear the search"
                onClick={() => onText(undefined)}
                className="flex items-center border-l border-hairline px-2 text-line-ico transition-colors hover:bg-soft-2 hover:text-ink"
              >
                <X className="size-3.5" />
              </button>
            </span>
          )}

          {/* The committed clauses. Rendered as our own chips rather than
              `Combobox.Chips`: that primitive models one chip per selected
              value and claims the arrow keys for walking between them, which
              would fight both the operator menu inside a chip and the panel's
              own highlight. */}
          {filters.map((filter, index) => {
            const field = fields.find((one) => one.column === filter.column)
            if (!field) return null
            const live = editing?.field.column === filter.column
            // While a chip is being edited it shows the DRAFT, not what the
            // URL still holds. Otherwise the chip and the panel below it
            // disagree — the chip saying "is null" over a list of divisions
            // being ticked for "is none of" — and the one thing this control
            // promises is that the sentence on screen is the question being
            // asked.
            const shown =
              live && editing
                ? {
                    ...filter,
                    operator: editing.operator,
                    values: editing.values,
                  }
                : filter
            return (
              <FilterChip
                key={`${filter.column}-${index}`}
                field={field}
                filter={shown}
                // Changing the operator can leave the clause needing values it
                // does not have — "is empty" to "is none of" asks for a list
                // nobody has picked yet. An incomplete clause cannot go in the
                // URL, so writing it would make the chip vanish under the
                // pointer as a reward for opening its menu. Handing it back to
                // the input instead is the same move as clicking the value:
                // the clause stays on screen, waiting for the part it lacks.
                onChange={(next) =>
                  isComplete(next)
                    ? update(index, next)
                    : edit(field, next, index)
                }
                onRemove={() => remove(index)}
              >
                <button
                  type="button"
                  onClick={() => edit(field, filter, index)}
                  className={cn(
                    "flex items-center px-2.5 font-medium transition-colors",
                    live
                      ? "bg-soft-2 text-ink"
                      : filter.values.length > 0
                        ? "text-accent hover:text-ink"
                        : "text-mute hover:text-ink"
                  )}
                >
                  {summarise(shown, field)}
                </button>
              </FilterChip>
            )
          })}

          {/* The typing area, and — while a clause is being built — the
              clause itself.
              
              The input never moves out of this wrapper, in any state. That is
              the whole reason the wrapper exists: React rebuilds an element
              that changes parent, and a rebuilt input is a lost caret and a
              lost selection in the middle of somebody typing. So the wrapper
              is always here and only its skin changes — bare while browsing,
              a pill while editing, with the column's name on its left and the
              way out on its right. What you type belongs to the chip, because
              you are typing INTO the chip. */}
          <span
            className={cn(
              "flex min-w-0 items-stretch overflow-hidden rounded-full transition-colors",
              // Browsing, the box is the row. Editing, it is a chip: sized to
              // something you can type a supplier's name into, and no wider —
              // stretched to the full row the dismiss ends up a hand's travel
              // away from the word it discards, which is a long way to go to
              // undo one keystroke's worth of decision.
              drafting
                ? "h-8 w-[20rem] max-w-full flex-none border border-hairline-2 bg-canvas"
                : "flex-1"
            )}
          >
            {/* The label, only until there is a chip carrying it. Once the
                clause is on screen the chip IS the label, and drawing both
                says "Supplier" twice in a row for one filter. */}
            {drafting && editing && (
                <span className="flex shrink-0 items-center gap-1.5 pl-2.5 text-meta">
                  <span className="font-medium text-ink">
                    {editing.field.label}
                  </span>
                  <Keycap>{operatorSymbol(editing.operator)}</Keycap>
                </span>
              )}

            <Combobox.Input
              ref={input}
              onKeyDown={onKeyDown}
              onFocus={() => setOpen(true)}
              placeholder={
                // Not the column's name while editing it: the chip or the
                // label is sitting immediately to the left already saying
                // "Division", and printing it twice reads as a stutter.
                editing
                  ? "Search…"
                  : filters.length > 0 || (text ?? "") !== ""
                    ? "Add more filters…"
                    : placeholder
              }
              aria-label={
                editing ? `Value for ${editing.field.label}` : "Filter"
              }
              className="h-7 min-w-[6rem] flex-1 self-center border-none bg-transparent px-2 text-[0.875rem] text-ink outline-none placeholder:text-mute"
            />

            {/* The way back, visible. A draft with no values is not a filter
                yet, so there is no chip to close and nothing else on screen
                offers an exit — which left the box looking like it had
                swallowed the other columns. */}
            {drafting && editing && (
              <button
                type="button"
                aria-label={`Stop filtering by ${editing.field.label}`}
                // The flag goes up on POINTER DOWN, not on click: that is when
                // the outside-press detection fires, and a flag raised
                // afterwards is a flag raised too late.
                onPointerDown={() => {
                  dismissing.current = true
                }}
                onClick={() => {
                  reset()
                  setOpen(true)
                  input.current?.focus()
                }}
                className="flex shrink-0 items-center border-l border-hairline px-2 text-line-ico transition-colors hover:bg-soft-2 hover:text-ink"
              >
                <X className="size-3.5" />
              </button>
            )}
          </span>

          {(filters.length > 0 || (text ?? "") !== "") && (
            <button
              type="button"
              onClick={() => {
                clear()
                onText(undefined)
                reset()
              }}
              className="shrink-0 rounded-full px-2 py-1 text-meta text-mute transition-colors hover:text-ink"
            >
              Clear
            </button>
          )}
        </Combobox.InputGroup>

        <Combobox.Portal>
          <Combobox.Positioner
            side="bottom"
            align="start"
            sideOffset={6}
            className="z-50 w-[var(--anchor-width)] min-w-[17rem]"
          >
            <Combobox.Popup className={cn(POPUP, "w-full")}>
              {/* Two boxes for a range operator. The one case the single
                  caret cannot serve: a bound typed into one box is half a
                  clause, and a list narrowed by half a clause is a list with
                  rows missing for no stated reason. */}
              {editing && takes === "two" ? (
                <Bounds
                  field={editing.field}
                  values={editing.values}
                  onChange={(values) => setStage({ ...editing, values })}
                  onCommit={save}
                />
              ) : (
                <Combobox.List>
                  {rows.length === 0 && (
                    <Combobox.Empty className="px-2.5 py-3 text-center text-meta text-mute">
                      {stage.at === "browsing"
                        ? "No column by that name."
                        : "Nothing matches."}
                    </Combobox.Empty>
                  )}
                  {/* The classes go on the item itself, not on anything
                      inside it: `data-highlighted` lands on this element, and
                      a highlight painted on a child is a highlight nobody
                      driving with the keyboard can see. */}
                  {rows.map((row, at) => (
                    <Fragment key={row.id}>
                      {/* A heading where one run of rows gives way to the
                          next. Drawn outside the item, so it is not a row the
                          arrow keys can land on. */}
                      {row.group === "fields" &&
                        rows[at - 1]?.group !== "fields" && (
                          <div className="px-2.5 pt-2 pb-1 text-[0.65625rem] font-semibold tracking-wide text-mute uppercase">
                            Filter by
                          </div>
                        )}
                      <Combobox.Item
                        value={row}
                        className={cn(ITEM, "justify-between")}
                      >
                        <RowView row={row} stage={stage} needle={needle} />
                      </Combobox.Item>
                    </Fragment>
                  ))}
                </Combobox.List>
              )}
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </div>
    </Combobox.Root>
  )
}

/* -------------------------------------------------------------------------- */

/// The combobox's own selection, always empty.
///
/// This component holds its clauses in the URL, not in the combobox: a row
/// being "selected" here means only that somebody pressed Enter on it, and
/// what that does depends on the stage. Handing back an empty array every
/// render is what keeps the library from accumulating a selection of its own
/// and drawing ticks this component did not ask for.
const NOTHING_HELD: Row[] = []

/// Keep the first row highlighted, so Enter always has something to act on.
///
/// Without this nothing is highlighted until an arrow key is pressed, and
/// Enter over a list somebody is already reading does nothing — which is the
/// one keystroke this whole control is arranged around. Base UI's combobox
/// reads `autoHighlight` but omits it from `ComboboxRoot`'s exported type;
/// the root spreads its remaining props straight into the implementation, so
/// the value arrives. Spread rather than passed, because the type is what says
/// no and the runtime is what says yes.
const HIGHLIGHTS_FIRST = {
  autoHighlight: "always",
} as unknown as Record<never, never>

/// A field with nothing in it, so `useOptions` can be called unconditionally.
const EMPTY_FIELD: FilterField = {
  column: "",
  label: "",
  spec: { kind: "option", options: [] },
}

function rowLabel(row: Row): string {
  switch (row.kind) {
    case "field":
      return row.field.label
    case "option":
      return row.option.label
    case "search":
      return "Search"
    default:
      return "Apply"
  }
}

/// What one row says. The row's own box is the `Combobox.Item` above; this is
/// only its contents, so the highlight the combobox paints reaches everything.
function RowView({
  row,
  stage,
  needle,
}: {
  row: Row
  stage: Stage
  needle: string
}) {
  if (row.kind === "field") {
    return (
      <>
        <span className="truncate">{row.field.label}</span>
        <Keycap>{operatorSymbol(operatorsFor(row.field.spec)[0])}</Keycap>
      </>
    )
  }

  if (row.kind === "search") {
    return (
      <>
        <span className="flex min-w-0 items-center gap-2">
          <Search className="size-3.5 shrink-0 text-line-ico" />
          <span className="truncate">
            Search for <span className="font-medium text-ink">{needle}</span>
          </span>
        </span>
        <Keycap>text</Keycap>
      </>
    )
  }

  if (row.kind === "option" && stage.at === "editing") {
    return (
      <OptionRowContent
        option={row.option}
        field={stage.field}
        checked={row.checked}
        single={arity(stage.operator) === "one"}
      />
    )
  }

  if (row.kind === "commit" && stage.at === "editing") {
    const takes = arity(stage.operator)
    const said =
      takes === "none"
        ? ""
        : takes === "many"
          ? `${stage.values.length} selected`
          : needle
    return (
      <>
        <span className="truncate">
          {operatorVerb(stage.operator)}
          {said === "" ? "" : ": "}
          {said !== "" && (
            <span className="font-medium text-ink">{`\u201C${said}\u201D`}</span>
          )}
        </span>
        <Keycap>{operatorSymbol(stage.operator)}</Keycap>
      </>
    )
  }

  return null
}

/// The two bounds of a range, side by side.
function Bounds({
  field,
  values,
  onChange,
  onCommit,
}: {
  field: FilterField
  values: readonly string[]
  onChange: (values: readonly string[]) => void
  onCommit: (values: readonly string[]) => void
}) {
  const type = field.spec.kind === "date" ? "date" : "number"
  const set = (at: number, value: string) => {
    const next = [values[0] ?? "", values[1] ?? ""]
    next[at] = value
    onChange(next)
  }

  return (
    <form
      className="flex flex-col gap-1.5 p-1"
      onSubmit={(event) => {
        event.preventDefault()
        onCommit(values)
      }}
    >
      {[0, 1].map((at) => (
        <span key={at} className="flex items-center gap-2">
          <span className="w-8 shrink-0 text-meta text-mute">
            {at === 0 ? "From" : "To"}
          </span>
          <input
            autoFocus={at === 0}
            type={type}
            inputMode={type === "number" ? "decimal" : undefined}
            value={values[at] ?? ""}
            onChange={(event) => set(at, event.target.value)}
            placeholder={field.spec.unit ?? field.label}
            className="h-8 w-full rounded-full border border-transparent bg-soft-2 px-3 text-[0.84375rem] text-ink outline-none placeholder:text-mute"
          />
        </span>
      ))}
      <button type="submit" className="sr-only">
        Apply
      </button>
      {field.spec.scale === 100 && (
        <p className="px-1 text-meta text-mute">
          In whole {field.spec.unit ?? "currency"}, not cents.
        </p>
      )}
    </form>
  )
}
