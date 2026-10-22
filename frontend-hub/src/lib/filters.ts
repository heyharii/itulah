import type { ColumnDef, RowData } from "@tanstack/react-table"
import { useNavigate, useSearch } from "@tanstack/react-router"
import type { LucideIcon } from "lucide-react"
import { useCallback, useMemo, type ReactNode } from "react"

import type { SheetSearch } from "@/lib/sheets"
import type { TableSetup } from "@/lib/table"

/// What a list is narrowed by, and the vocabulary for saying it.
///
/// The app had one narrowing move before this: a search box over every column
/// at once. That answers "where is this supplier" and nothing else. It cannot
/// answer "every store except the two outlets", "orders that are not
/// cancelled", or — the one that costs the most hours — "items with no
/// barcode", because a blank cell is invisible to a search box by definition.
///
/// So a filter here is a sentence with three parts: a **column**, an
/// **operator**, and the **values** the operator takes. The operator is the
/// part the old facet rail did not have; a checkbox list can only ever say
/// *is any of*, and four of the six things people actually ask are negations
/// or emptiness tests.
///
/// Values are held as text, always, even for numbers and dates. They come from
/// a URL and go back to one, and a model that stored them typed would need a
/// second representation for the trip — which is where the two drift apart.

/// The kind of question a column can be asked.
///
/// This is deliberately not the column's data type: `site_id` and `memo` are
/// both strings, but one is a closed set you pick from and the other is prose
/// you search. The kind decides which operators are offered and which editor
/// the value gets.
export type FilterKind =
  "text" | "option" | "multi" | "number" | "date" | "boolean"

export type Operator =
  | "is"
  | "isNot"
  | "isAnyOf"
  | "isNoneOf"
  | "isEmpty"
  | "isNotEmpty"
  | "contains"
  | "notContains"
  | "startsWith"
  | "includesAnyOf"
  | "includesAllOf"
  | "excludes"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "notBetween"
  | "before"
  | "after"
  | "onOrBefore"
  | "onOrAfter"

/// Which family an operator belongs to, so a menu of twenty can be read.
///
/// The groups are the sections the menu prints. They exist because a flat list
/// of twenty operators is a list nobody reads to the bottom: "is between" and
/// "is at least" are the same kind of question and belong under one heading,
/// and the heading is what lets somebody skip five rows at a glance.
export type OperatorGroup =
  "comparison" | "pattern" | "list" | "range" | "nullness"

export const GROUP_LABEL: Record<OperatorGroup, string> = {
  comparison: "Comparison",
  pattern: "Pattern matching",
  list: "In lists",
  range: "Range",
  nullness: "Emptiness",
}

/// Everything an operator is called, in one row each.
///
/// One table rather than three parallel `Record<Operator, …>` maps, because
/// three of them is three places to forget an operator and only the first gets
/// a type error. Every column is a different voice for the same idea:
///
///  * `label` is prose, for the chip and the menu row — a buyer reads "is none
///    of", never `isNoneOf` or `NOT IN`. These are the reference component's
///    own words: they are already the least ambiguous English for these ideas,
///    and a second set would only make our screens read differently from every
///    other tool on the same desk.
///  * `verb` heads the commit row — "Equals: “hari”" — where a sentence
///    beginning "is" would read as a fragment.
///  * `symbol` is the keycap badge. A real operator where one exists, a short
///    word where it does not: `∅` for empty would be a puzzle, `is null` is a
///    thing somebody has seen before.
interface OperatorMeta {
  readonly label: string
  readonly verb: string
  readonly symbol: string
  readonly group: OperatorGroup
}

const META: Record<Operator, OperatorMeta> = {
  is: { label: "is", verb: "Equals", symbol: "=", group: "comparison" },
  isNot: {
    label: "is not",
    verb: "Not equal",
    symbol: "<>",
    group: "comparison",
  },
  gt: {
    label: "is greater than",
    verb: "Greater than",
    symbol: ">",
    group: "comparison",
  },
  gte: {
    label: "is at least",
    verb: "At least",
    symbol: ">=",
    group: "comparison",
  },
  lt: {
    label: "is less than",
    verb: "Less than",
    symbol: "<",
    group: "comparison",
  },
  lte: {
    label: "is at most",
    verb: "At most",
    symbol: "<=",
    group: "comparison",
  },
  contains: {
    label: "contains",
    verb: "Contains",
    symbol: "~~*",
    group: "pattern",
  },
  notContains: {
    label: "does not contain",
    verb: "Does not contain",
    symbol: "!~~*",
    group: "pattern",
  },
  startsWith: {
    label: "starts with",
    verb: "Starts with",
    symbol: "~~",
    group: "pattern",
  },
  isAnyOf: { label: "is any of", verb: "Any of", symbol: "in", group: "list" },
  isNoneOf: {
    label: "is none of",
    verb: "None of",
    symbol: "not in",
    group: "list",
  },
  includesAnyOf: {
    label: "include any of",
    verb: "Includes any of",
    symbol: "&&",
    group: "list",
  },
  includesAllOf: {
    label: "include all of",
    verb: "Includes all of",
    symbol: "@>",
    group: "list",
  },
  excludes: {
    label: "exclude",
    verb: "Excludes",
    symbol: "!&&",
    group: "list",
  },
  between: {
    label: "is between",
    verb: "Between",
    symbol: "[ ]",
    group: "range",
  },
  notBetween: {
    label: "is not between",
    verb: "Not between",
    symbol: "![ ]",
    group: "range",
  },
  before: { label: "is before", verb: "Before", symbol: "<", group: "range" },
  after: { label: "is after", verb: "After", symbol: ">", group: "range" },
  onOrBefore: {
    label: "is on or before",
    verb: "On or before",
    symbol: "<=",
    group: "range",
  },
  onOrAfter: {
    label: "is on or after",
    verb: "On or after",
    symbol: ">=",
    group: "range",
  },
  isEmpty: {
    label: "is empty",
    verb: "Is empty",
    symbol: "is null",
    group: "nullness",
  },
  isNotEmpty: {
    label: "is not empty",
    verb: "Is not empty",
    symbol: "not null",
    group: "nullness",
  },
}

export function operatorLabel(operator: Operator): string {
  return META[operator].label
}

export function operatorVerb(operator: Operator): string {
  return META[operator].verb
}

export function operatorSymbol(operator: Operator): string {
  return META[operator].symbol
}

/// One section per family, in the order the field's own list mentions them.
///
/// Driven by the whitelist rather than by a fixed group order, so `OPERATORS`'
/// existing rule — the common one first, its negation second — still decides
/// what somebody sees at the top of the menu. A field offering two operators
/// gets one section, and a section of one is drawn without a heading by the
/// menu, because a heading over a single row is furniture.
export function operatorSections(operators: readonly Operator[]): readonly {
  readonly group: OperatorGroup
  readonly label: string
  readonly operators: readonly Operator[]
}[] {
  const order: OperatorGroup[] = []
  const held = new Map<OperatorGroup, Operator[]>()
  for (const operator of operators) {
    const { group } = META[operator]
    const seen = held.get(group)
    if (seen) seen.push(operator)
    else {
      order.push(group)
      held.set(group, [operator])
    }
  }
  return order.map((group) => ({
    group,
    label: GROUP_LABEL[group],
    operators: held.get(group) ?? [],
  }))
}

/// Which operators each kind offers, in menu order.
///
/// Ordered so the common one is first and its negation is second: the pair is
/// read together, and burying "is not" under four range operators is how a
/// menu ends up with a scroll for six items. Emptiness always sits last,
/// because it is a question about the column rather than about a value.
export const OPERATORS: Record<FilterKind, readonly Operator[]> = {
  text: [
    "contains",
    "notContains",
    "startsWith",
    "is",
    "isNot",
    "isEmpty",
    "isNotEmpty",
  ],
  option: ["is", "isNot", "isAnyOf", "isNoneOf", "isEmpty", "isNotEmpty"],
  multi: [
    "includesAnyOf",
    "includesAllOf",
    "excludes",
    "isEmpty",
    "isNotEmpty",
  ],
  number: [
    "is",
    "isNot",
    "gt",
    "gte",
    "lt",
    "lte",
    "between",
    "notBetween",
    "isEmpty",
    "isNotEmpty",
  ],
  date: [
    "is",
    "before",
    "onOrBefore",
    "after",
    "onOrAfter",
    "between",
    "notBetween",
    "isEmpty",
    "isNotEmpty",
  ],
  boolean: ["is"],
}

/// How many values the operator takes: none, one, two, or a set.
///
/// The bar needs this to decide which editor to open and — more importantly —
/// whether a filter is finished. A half-typed "is between" with one bound is
/// not a narrower list, it is a list with rows missing for no stated reason,
/// so it does not run until both bounds are there.
export type Arity = "none" | "one" | "two" | "many"

export function arity(operator: Operator): Arity {
  switch (operator) {
    case "isEmpty":
    case "isNotEmpty":
      return "none"
    case "isAnyOf":
    case "isNoneOf":
    case "includesAnyOf":
    case "includesAllOf":
    case "excludes":
      return "many"
    case "between":
    case "notBetween":
      return "two"
    default:
      return "one"
  }
}

/// One clause. A list is narrowed by every clause it carries, ANDed.
///
/// Two clauses on the same column also AND — "posting date after 1 Aug" and
/// "posting date before 1 Sep" is a legal, and common, pair. That is why this
/// is a flat list rather than a map keyed by column.
export interface Filter {
  readonly column: string
  readonly operator: Operator
  readonly values: readonly string[]
}

/// A filter is ready when its operator has the values it needs.
export function isComplete(filter: Filter): boolean {
  switch (arity(filter.operator)) {
    case "none":
      return true
    case "two":
      return filter.values.length === 2 && filter.values.every((v) => v !== "")
    case "many":
      return filter.values.length > 0
    default:
      return filter.values.length > 0 && filter.values[0] !== ""
  }
}

/// What a column declares about being filtered, in `columnDef.meta.filter`.
///
/// On the column rather than in a list beside the table, and that is the whole
/// point: the app this one replaces keeps its filter fields in a separate
/// `orderFilterFields()` function, and on the purchase-orders screen that
/// function drifted so far from its table that it now builds four facets which
/// reach no UI at all. A declaration that lives on the thing it describes
/// cannot come loose from it.
export interface FilterSpec {
  readonly kind: FilterKind
  /// What the chip calls the column. Defaults to the column's header when that
  /// header is a plain string, which it is nearly everywhere.
  readonly label?: string
  /// Turn a raw cell value into the label its option wears in the picker —
  /// a site id into a shop name, a status code into a sentence.
  readonly format?: (value: string) => string
  /// A fixed set, for columns whose data does not contain every possibility.
  /// Left out, the options are the values actually present in the list, with
  /// their counts, which is what people expect from a facet.
  readonly options?: readonly {
    readonly value: string
    readonly label: string
  }[]
  /// What the typed number is multiplied by before comparing.
  ///
  /// ## Not for money — this line used to say otherwise and it was wrong
  ///
  /// It read "`100` for the money columns, which hold minor units", and twenty
  /// columns across nine screens were written to match. They were all wrong in
  /// the same direction: **IDR has no minor unit in practice, so the server's
  /// "minor" is already whole rupiah** — `money()` in `lib/format.ts` prints it
  /// undivided, and says so. Multiplying the bound by a hundred turned "takings
  /// over 80 juta" into a question about eight miliar, which matched nothing
  /// and looked like an empty result rather than a broken filter.
  ///
  /// Leave it unset for money. It is for a column stored in a unit nobody
  /// types — a rate held as `0.005` and read as `0.5%` wants `0.01`, which is
  /// what `scale` is actually good for.
  readonly scale?: number
  /// Sits in the number box — "Rp", "pcs", "%".
  readonly unit?: string
  /// Which operators this field offers, overriding `OPERATORS[kind]`.
  ///
  /// For the fields a SERVER narrows rather than the browser. The endpoint
  /// decides which questions it can answer, and an operator in the menu that
  /// the request cannot carry is a chip that silently narrows nothing — the
  /// same failure `matches()` refuses to commit further down this file. A
  /// column filtered in the browser has no reason to set this: everything the
  /// kind offers, the predicate can answer.
  readonly operators?: readonly Operator[]
  /// Options the server has already counted, keyed by raw code.
  ///
  /// Structurally the contract's `FacetCount` and `ui/facets`'s `FacetValue`,
  /// and named structurally on purpose so `facets?.divisions` assigns without
  /// a cast and this file imports neither a component nor a wire type. Given,
  /// the picker never asks the table what values exist — which is what lets a
  /// screen with no table draw a counted list at all.
  readonly counted?: readonly {
    readonly value: string
    readonly count: number
  }[]
  /// The value in `counted` that stands for "nothing in this column".
  ///
  /// A server that counts its facets almost always invents one: ours groups
  /// unfiled items under the synthetic label `Unclassified`, which is a real
  /// count of real rows but is NOT a code any row holds — asking for it as one
  /// matches nothing, which is how a facet with 4 beside it used to return an
  /// empty page. Named here so the picker can offer the row (the count is the
  /// whole reason somebody clicks it) while committing the clause that
  /// actually answers it: `is empty`.
  readonly emptyValue?: string
  /// Something to set beside the option's label — a colour swatch, a status
  /// dot. `ui/facets` calls the same idea `leadingOf`.
  readonly leading?: (value: string) => ReactNode
  /// The mark an answer wears as a chip in `<ListFilters>` (owner,
  /// 2026-10-18: "pakai radio icon"): a car for vehicles, a printer for
  /// stationery. `null` is "All".
  readonly icon?: (value: string | null) => LucideIcon | undefined
  /// At most one clause on this column; a second replaces the first.
  ///
  /// True for every server-backed field, because each maps to ONE array on the
  /// request: two clauses flattened into `divisionCodes` would read as OR
  /// where the model promises AND, and the list would come back wider than the
  /// chips say. A column the browser filters has no such ceiling — two clauses
  /// on one date column AND correctly, which is the case `columnFilters`
  /// below exists to group.
  readonly single?: boolean
  /// Always offer a search box over the options, however few there are. The
  /// picker leaves it out of a short list (eight or fewer) where scanning is
  /// quicker; a supplier is looked for by name, and a book that has three
  /// today has three hundred in a year.
  readonly searchable?: boolean
}

/// Which operators a field offers — its own list, or everything its kind has.
export function operatorsFor(spec: FilterSpec): readonly Operator[] {
  return spec.operators ?? OPERATORS[spec.kind]
}

/* -------------------------------------------------------------------------- */
/*  Matching                                                                   */
/* -------------------------------------------------------------------------- */

/// Nothing in the cell — the state `is empty` asks about.
///
/// An empty array counts, because a tagless item is untagged whether the
/// column holds `null` or `[]`, and which one it holds is a fact about the
/// serialiser rather than about the item.
function isBlank(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  )
}

/// A day, comparable as text.
///
/// `YYYY-MM-DD` sorts lexicographically in date order, so the whole date
/// family is string comparison once both sides are cut to ten characters. That
/// avoids the timezone bug the obvious implementation has: `new Date("2026-09-02")`
/// is midnight UTC, which in Jakarta is the 2nd at 07:00 and in Los Angeles is
/// still the 1st — so "is 2 September" would answer differently depending on
/// where the browser is standing.
function day(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : value.toISOString().slice(0, 10)
  }
  if (typeof value === "number") {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
  }
  if (typeof value !== "string") return null
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value)
  return match ? match[1] : null
}

function num(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/// The cell as a set of strings, for the array columns.
function items(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v) => !isBlank(v)).map(String)
  return isBlank(value) ? [] : [String(value)]
}

/// Whether this operator says what a row is *not*.
///
/// It matters for blank cells. A positive test never matches a blank — an item
/// with no supplier is not "supplier is Acme". A negative one does: an item
/// with no supplier is, truthfully, not Acme, and the alternative silently
/// drops exactly the unfinished rows people are usually hunting for. This is
/// not SQL's `NULL` semantics, deliberately; SQL is answering a different
/// question than a person reading a list.
function isNegative(operator: Operator): boolean {
  return (
    operator === "isNot" ||
    operator === "isNoneOf" ||
    operator === "notContains" ||
    operator === "excludes" ||
    operator === "notBetween"
  )
}

/// Does one cell satisfy one clause.
export function matches(
  value: unknown,
  filter: Filter,
  kind: FilterKind,
  scale = 1
): boolean {
  const { operator, values } = filter

  if (operator === "isEmpty") return isBlank(value)
  if (operator === "isNotEmpty") return !isBlank(value)
  if (!isComplete(filter)) return true
  if (isBlank(value)) return isNegative(operator)

  if (kind === "multi") {
    const held = items(value).map((item) => item.toLowerCase())
    const wanted = values.map((v) => v.toLowerCase())
    switch (operator) {
      case "includesAnyOf":
        return wanted.some((v) => held.includes(v))
      case "includesAllOf":
        return wanted.every((v) => held.includes(v))
      case "excludes":
        return !wanted.some((v) => held.includes(v))
      default:
        return true
    }
  }

  if (kind === "number") {
    const cell = num(value)
    if (cell === null) return isNegative(operator)
    const bounds = values.map((v) => {
      const parsed = num(v)
      return parsed === null ? null : parsed * scale
    })
    const [first, second] = bounds
    if (first === null || first === undefined) return true
    switch (operator) {
      case "is":
        return cell === first
      case "isNot":
        return cell !== first
      case "gt":
        return cell > first
      case "gte":
        return cell >= first
      case "lt":
        return cell < first
      case "lte":
        return cell <= first
      case "between":
      case "notBetween": {
        if (second === null || second === undefined) return true
        const low = Math.min(first, second)
        const high = Math.max(first, second)
        const inside = cell >= low && cell <= high
        return operator === "between" ? inside : !inside
      }
      default:
        return true
    }
  }

  if (kind === "date") {
    const cell = day(value)
    if (cell === null) return isNegative(operator)
    const [first, second] = values
    switch (operator) {
      case "is":
        return cell === first
      case "before":
        return cell < first
      case "onOrBefore":
        return cell <= first
      case "after":
        return cell > first
      case "onOrAfter":
        return cell >= first
      case "between":
      case "notBetween": {
        if (second === undefined) return true
        const low = first <= second ? first : second
        const high = first <= second ? second : first
        const inside = cell >= low && cell <= high
        return operator === "between" ? inside : !inside
      }
      default:
        return true
    }
  }

  // text, option and boolean all compare the cell as one string. Case is
  // folded on both sides: nobody filtering for a supplier types its casing the
  // way the import did.
  const cell = String(value).toLowerCase()
  const wanted = values.map((v) => v.toLowerCase())
  switch (filter.operator) {
    case "is":
      return cell === wanted[0]
    case "isNot":
      return cell !== wanted[0]
    case "isAnyOf":
      return wanted.includes(cell)
    case "isNoneOf":
      return !wanted.includes(cell)
    case "contains":
      return cell.includes(wanted[0])
    case "notContains":
      return !cell.includes(wanted[0])
    case "startsWith":
      return cell.startsWith(wanted[0])
    default:
      return true
  }
}

/* -------------------------------------------------------------------------- */
/*  The URL                                                                    */
/* -------------------------------------------------------------------------- */

/// Filters belong in the address bar, for every reason `lib/sheets.ts` already
/// gives for sheets: a narrowed list is a thing people send each other ("look
/// at the items with no barcode"), it should survive the reload a shop's
/// browser gets each morning, and it should be openable by a notification or
/// the command palette rather than only by the component that drew the table.
///
/// The wire form is `column:operator:value,value~column:operator`. Compact
/// enough to read in the bar, and the three delimiters are percent-escaped
/// inside values so a supplier called "PT Maju, Jaya" survives the trip.
const SEP = "~"
const PART = ":"
const VALUE = ","

function escape(value: string): string {
  return value.replace(
    /[~:,%]/g,
    (char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`
  )
}

function unescape(value: string): string {
  return value.replace(/%([0-9a-fA-F]{2})/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16))
  )
}

export function encodeFilters(filters: readonly Filter[]): string | undefined {
  const encoded = filters
    .filter(isComplete)
    .map((filter) => {
      const head = `${filter.column}${PART}${filter.operator}`
      if (arity(filter.operator) === "none") return head
      return `${head}${PART}${filter.values.map(escape).join(VALUE)}`
    })
    .join(SEP)
  return encoded === "" ? undefined : encoded
}

const OPERATOR_NAMES = new Set<string>(Object.keys(META))

/// Anything malformed is dropped rather than repaired.
///
/// The same rule `validateSheetSearch` follows, for the same reason: a URL is a
/// public surface, and a half-understood clause is a list that is narrowed by
/// something nobody can see in the bar.
export function decodeFilters(raw: unknown): Filter[] {
  if (typeof raw !== "string" || raw === "") return []
  const out: Filter[] = []
  for (const clause of raw.split(SEP)) {
    const [column, operator, values] = clause.split(PART)
    if (!column || !operator || !OPERATOR_NAMES.has(operator)) continue
    const parsed: Filter = {
      column,
      operator: operator as Operator,
      values:
        values === undefined || values === ""
          ? []
          : values.split(VALUE).map(unescape),
    }
    if (isComplete(parsed)) out.push(parsed)
  }
  return out
}

/// The search key a bar reads and writes.
///
/// Two, because two screens in the app draw two filterable tables side by side
/// (`system/access.tsx` and `articles/setups.tsx`), and one key
/// would have them fighting over it.
export type FilterParam = "f" | "f2"

/* -------------------------------------------------------------------------- */
/*  The hook                                                                   */
/* -------------------------------------------------------------------------- */

/// A column that can be filtered, as the bar needs to know it.
export interface FilterField {
  readonly column: string
  readonly label: string
  readonly spec: FilterSpec
}

/// The clauses in the URL, and the four ways to change them.
///
/// This is the half of the model that has nothing to do with a table. It was
/// separated out because two of the screens that most want a filter bar —
/// Sourcing and Articles — have no table at all: they draw a grid of cards and
/// narrow it at the SERVER, so their options and counts arrive in the response
/// rather than from a faceted row model. Every one of them had, until this
/// split, a facet rail with its selection in a `useState`, which cannot be
/// sent to a colleague and does not survive the reload a shop's browser gets
/// each morning — the two things this file's URL format exists to give.
export interface FilterState {
  readonly filters: readonly Filter[]
  readonly fields: readonly FilterField[]
  /// Start an empty clause on a column, with its first operator. What the
  /// "+ Filter" menu does.
  readonly addColumn: (column: string) => void
  /// Add a clause that is already finished. What the omnibox does when
  /// somebody presses Enter over a value, and the reason this is not just
  /// `addColumn` + `update`: those are two navigations, and the first one
  /// writes an incomplete clause the URL should never carry.
  readonly commit: (filter: Filter) => void
  readonly update: (index: number, next: Filter) => void
  readonly remove: (index: number) => void
  readonly clear: () => void
  /// Replace every clause in one write. For a control that changes two at
  /// once — a date range is a `gte` and an `lte` — where two calls would each
  /// start from the clauses of the same render and the second would undo the
  /// first.
  readonly set: (next: readonly Filter[]) => void
}

export interface FilterModel<TRow extends RowData> extends FilterState {
  /// The column definitions, with the shared predicate attached to every
  /// filterable one. Hand these to `useTable`, not the originals: v9 resolves
  /// an unnamed `filterFn` by data type, and a column filtered by a clause
  /// object would be handed to `includesString`, which would quietly match
  /// nothing.
  readonly columns: ColumnDef<TableSetup, TRow>[]
  /// For `state.columnFilters`.
  readonly columnFilters: { id: string; value: unknown }[]
  /// The name `<FilterBar>` and eleven screens already call `addColumn` by.
  readonly add: (column: string) => void
}

/// Read the clauses out of the URL and hand back the ways to change them.
///
/// Takes the fields directly, so a screen with no table can declare what is
/// filterable in a plain array. `useFilters` below is this hook plus the
/// TanStack adapter, and is what a screen with a table should use.
export function useFilterState(
  fields: readonly FilterField[],
  param: FilterParam = "f"
): FilterState {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as SheetSearch
  const raw = search[param]

  const known = useMemo(
    () => new Map(fields.map((field) => [field.column, field])),
    [fields]
  )

  /// Clauses naming a column this screen does not have are dropped on the way
  /// in. That is what keeps a filtered link to one screen from half-applying
  /// itself to the next: the parameter rides along, finds no matching column,
  /// and narrows nothing.
  ///
  /// Dropped from what is READ, note, not from what is written — a screen that
  /// hides a field for a while (Sourcing hides Supplier inside a shop) leaves
  /// the clause in the address bar untouched, so leaving the shop brings it
  /// back rather than silently discarding it.
  const filters = useMemo(
    () => decodeFilters(raw).filter((filter) => known.has(filter.column)),
    [raw, known]
  )

  const write = useCallback(
    (next: readonly Filter[]) => {
      navigate({
        to: ".",
        // Setting a filter is not a place you go back from one clause at a
        // time. Replacing keeps the back button meaning "the screen before".
        replace: true,
        search: (prev: SheetSearch) => ({
          ...prev,
          [param]: encodeFilters(next),
        }),
      })
    },
    [navigate, param]
  )

  const commit = useCallback(
    (filter: Filter) => {
      // `single` fields hold one clause: each maps to one array on a request,
      // and a second clause flattened into it would read as OR where this file
      // promises AND. Replacing is what somebody means anyway — they are
      // editing the chip they just opened, not raising a second one.
      const spec = known.get(filter.column)?.spec
      const next = spec?.single
        ? [...filters.filter((held) => held.column !== filter.column), filter]
        : [...filters, filter]
      write(next)
    },
    [filters, known, write]
  )

  return {
    filters,
    fields,
    commit,
    addColumn: useCallback(
      (column: string) => {
        const field = known.get(column)
        if (!field) return
        write([
          ...filters,
          { column, operator: operatorsFor(field.spec)[0], values: [] },
        ])
      },
      [filters, known, write]
    ),
    update: useCallback(
      (index: number, next: Filter) =>
        write(filters.map((held, at) => (at === index ? next : held))),
      [filters, write]
    ),
    remove: useCallback(
      (index: number) => write(filters.filter((_, at) => at !== index)),
      [filters, write]
    ),
    clear: useCallback(() => write([]), [write]),
    set: write,
  }
}

/// Read the filter bar's state out of the URL and give the table its shape.
///
/// The columns are the source of truth for what is filterable: pass the same
/// array the table is built from and every column carrying `meta.filter`
/// becomes a field in the "+ Filter" menu. Nothing is declared twice.
export function useFilters<TRow extends RowData>(
  columns: readonly ColumnDef<TableSetup, TRow>[],
  param: FilterParam = "f"
): FilterModel<TRow> {
  const fields = useMemo<FilterField[]>(
    () =>
      columns.flatMap((column) => {
        const spec = column.meta?.filter
        const id = columnId(column)
        if (!spec || id === undefined) return []
        return [
          {
            column: id,
            label:
              spec.label ??
              (typeof column.header === "string" ? column.header : id),
            spec,
          },
        ]
      }),
    [columns]
  )

  const state = useFilterState(fields, param)
  const { filters } = state

  const known = useMemo(
    () => new Map(fields.map((field) => [field.column, field])),
    [fields]
  )

  const withPredicate = useMemo(
    () =>
      columns.map((column) =>
        column.meta?.filter
          ? {
              ...column,
              filterFn: "predicate" as const,
              enableColumnFilter: true,
            }
          : column
      ),
    [columns]
  )

  /// One entry per column, holding every clause on that column. TanStack keys
  /// column filters by column id, so the clauses have to arrive grouped — and
  /// grouping them here rather than in the predicate is what lets two clauses
  /// on one date column AND together.
  const columnFilters = useMemo(() => {
    const grouped = new Map<string, PredicateValue>()
    for (const filter of filters) {
      const field = known.get(filter.column)
      if (!field || !isComplete(filter)) continue
      const held = grouped.get(filter.column)
      if (held) held.clauses.push(filter)
      else
        grouped.set(filter.column, {
          kind: field.spec.kind,
          scale: field.spec.scale ?? 1,
          clauses: [filter],
        })
    }
    return [...grouped].map(([id, value]) => ({ id, value }))
  }, [filters, known])

  return {
    ...state,
    columns: withPredicate,
    columnFilters,
    // The name eleven screens and `<FilterBar>` already call it by.
    add: state.addColumn,
  }
}

/// What the predicate receives as its filter value.
export interface PredicateValue {
  readonly kind: FilterKind
  readonly scale: number
  readonly clauses: Filter[]
}

/// The one filter function every filterable column is given.
///
/// Registered in `lib/table.ts` under `predicate`. It receives the clause list
/// rather than a bare value, which is what lets one column carry "after 1 Aug"
/// and "before 1 Sep" at once.
export function predicate(value: unknown, filterValue: unknown): boolean {
  const held = filterValue as PredicateValue | undefined
  if (!held || held.clauses.length === 0) return true
  return held.clauses.every((clause) =>
    matches(value, clause, held.kind, held.scale)
  )
}

function columnId<TRow extends RowData>(
  column: ColumnDef<TableSetup, TRow>
): string | undefined {
  if (typeof column.id === "string") return column.id
  const keyed = column as { accessorKey?: string | number }
  return typeof keyed.accessorKey === "string" ? keyed.accessorKey : undefined
}
