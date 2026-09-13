import { operatorLabel, arity, type Operator } from "@/lib/filters"
import { money } from "@/lib/format"
import { describeSegment, type SegmentDefinition } from "@/lib/queries/members"
import type { SpecFilter } from "@/lib/queries/reports"

/// Saying the same thing in three vocabularies.
///
/// A clause exists in three spellings: the browser's (`isNoneOf`, what
/// `lib/filters.ts` has names and menus for), the server's (`IsNoneOf`, how the
/// Rust enum serialises), and English (`is none of`, what a card prints). This
/// file is the only place any of them is translated into another, which is what
/// keeps "is at least" from meaning one thing on the form and another on the
/// card beside it.
///
/// Beside the form rather than inside it because none of it is a component —
/// and because the segments screen draws saved definitions it never opens.

/// Money is typed with the separators people actually type it with. The rupiah
/// is its own minor unit, so nothing is scaled — but "5.000.000" has to reach
/// the server as `5000000` or the comparison is against a string.
export function numeric(text: string): string {
  return text.replace(/[^\d-]/g, "")
}

export function isMoney(column: string): boolean {
  return column.endsWith("_minor")
}

/// A value the boolean editor wrote. Checked by value rather than by the
/// column's kind so the card can be drawn from a saved definition alone,
/// without waiting on the catalogue to say what kind each column is.
function isBoolean(value: string): boolean {
  return value === "true" || value === "false"
}

/// The browser's operator vocabulary, as the server spells it. `Is` rather than
/// `is`, because that is how the Rust enum serialises.
export const SERVER: Record<string, SpecFilter["op"]> = {
  is: "Is",
  isNot: "IsNot",
  isAnyOf: "IsAnyOf",
  isNoneOf: "IsNoneOf",
  isEmpty: "IsEmpty",
  isNotEmpty: "IsNotEmpty",
  contains: "Contains",
  notContains: "NotContains",
  startsWith: "StartsWith",
  gt: "Gt",
  gte: "Gte",
  lt: "Lt",
  lte: "Lte",
  between: "Between",
  notBetween: "NotBetween",
  before: "Lt",
  after: "Gt",
  onOrBefore: "Lte",
  onOrAfter: "Gte",
}

/// The reverse, for reading a saved definition back into the form. Ambiguous
/// on purpose in one direction only: four browser operators mean `Lt`/`Gt`, so
/// a definition read back shows the plain comparison rather than guessing
/// whether somebody originally typed "is before".
export const BROWSER: Partial<Record<SpecFilter["op"], Operator>> = {
  Is: "is",
  IsNot: "isNot",
  IsAnyOf: "isAnyOf",
  IsNoneOf: "isNoneOf",
  IsEmpty: "isEmpty",
  IsNotEmpty: "isNotEmpty",
  Contains: "contains",
  NotContains: "notContains",
  StartsWith: "startsWith",
  Gt: "gt",
  Gte: "gte",
  Lt: "lt",
  Lte: "lte",
  Between: "between",
  NotBetween: "notBetween",
}

/// A clause as this form holds it: the browser's operator, so the menu can
/// offer the twenty words `lib/filters.ts` already has names for.
export interface Clause {
  column: string
  operator: Operator
  values: string[]
}

export function clauseOf(filter: SpecFilter): Clause {
  return {
    column: filter.column,
    operator: BROWSER[filter.op] ?? "is",
    values: [...filter.values],
  }
}

/// A clause is finished when its operator has the values it needs. The same
/// rule `lib/filters.ts` applies to a chip, because a half-written clause in a
/// saved segment is a list that is narrowed by something nobody can see.
export function isComplete(clause: SpecFilter, operator: Operator): boolean {
  switch (arity(operator)) {
    case "none":
      return true
    case "two":
      return clause.values.length === 2 && clause.values.every((v) => v !== "")
    default:
      return clause.values.length > 0 && clause.values[0] !== ""
  }
}

export function toSpec(clause: Clause): SpecFilter {
  return {
    column: clause.column,
    op: SERVER[clause.operator] ?? "Is",
    values: clause.values,
  }
}

/// A definition as a sentence, for a card that has no room for a form.
///
/// The column's own label and the operator's own words, both from the places
/// that already define them — so a card cannot describe a segment in terms the
/// form would not accept back. Money is printed as money: "5000000" on a card
/// is a number somebody has to count the digits of.
export function describeDefinition(
  definition: SegmentDefinition,
  columns: readonly { readonly key: string; readonly label: string }[]
): string {
  const joiner = definition.match === "ALL" ? " · " : " or "
  return definition.filters
    .map((clause) => {
      const label =
        columns.find((one) => one.key === clause.column)?.label ?? clause.column
      const operator = BROWSER[clause.op]
      const words = operator ? operatorLabel(operator) : clause.op

      // "Paired to the app is true" is a sentence nobody says. A boolean reads
      // as a yes or a no against its own label, and the negating operators
      // flip it rather than adding a second word to un-read.
      if (clause.values.length === 1 && isBoolean(clause.values[0])) {
        const yes = clause.values[0] === "true"
        const negated = clause.op === "IsNot" || clause.op === "IsNoneOf"
        return `${label}: ${yes !== negated ? "yes" : "no"}`
      }

      const values = clause.values
        .map((value) =>
          isMoney(clause.column) && value !== ""
            ? money(Number(value))
            : clause.column === "segment"
              ? describeSegment(value, { active_days: 90, lapsing_days: 180 })
                  .label
              : value
        )
        .join(" and ")
      return values === "" ? `${label} ${words}` : `${label} ${words} ${values}`
    })
    .join(joiner)
}
