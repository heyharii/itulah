import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { node } from "@/lib/api"
import type { Filter, FilterKind, Operator } from "@/lib/filters"
import type { SavedReportPage, SavedReportRow } from "@itulah/contract"
import { toCsv as rowsToCsv } from "@/lib/csv"

/// Reports: the definition, not the rows.
///
/// Transcribed from `cloud/http/reports.rs` and `cloud/reports/`, which
/// assemble their answers with `json!()` — so like the sales reads, nothing
/// here is checked against the server at build time.
///
/// The shape to hold on to: a report is a **spec**, the spec is validated
/// against a catalogue the server owns, and running one never involves a model.
/// The assistant composes a spec once; after that this is an ordinary read.

// ---- What a report may be about ----------------------------------------

export interface CatalogueColumn {
  readonly key: string
  readonly label: string
}

export interface CatalogueDimension extends CatalogueColumn {
  /// The same vocabulary `lib/filters.ts` uses, which is what lets a filter
  /// the model wrote and a filter somebody added by hand be the same object.
  readonly kind: FilterKind
}

export interface CatalogueMeasure extends CatalogueColumn {
  readonly format: "money" | "count" | "percent"
}

export interface CatalogueDataset {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly dimensions: readonly CatalogueDimension[]
  readonly measures: readonly CatalogueMeasure[]
}

export interface Catalogue {
  readonly catalogue_version: number
  readonly datasets: readonly CatalogueDataset[]
  readonly operators: readonly Operator[]
  readonly grains: readonly Grain[]
}

// ---- The spec ----------------------------------------------------------

export type Grain = "none" | "day" | "week" | "month"

export type Period =
  | {
      readonly kind: "relative"
      readonly last: number
      readonly unit: "day" | "week" | "month"
    }
  | { readonly kind: "absolute"; readonly from: string; readonly to: string }
  | { readonly kind: "all" }

/// One clause. `op` is capitalised because that is how the Rust enum
/// serialises, and the two ends have to spell it identically.
export interface SpecFilter {
  readonly column: string
  readonly op:
    | "Is"
    | "IsNot"
    | "IsAnyOf"
    | "IsNoneOf"
    | "IsEmpty"
    | "IsNotEmpty"
    | "Contains"
    | "NotContains"
    | "StartsWith"
    | "Gt"
    | "Gte"
    | "Lt"
    | "Lte"
    | "Between"
    | "NotBetween"
  readonly values: readonly string[]
}

export interface Present {
  readonly kpis?: readonly string[]
  readonly chart?: readonly string[]
  readonly table?: readonly string[]
}

export interface ReportSpec {
  readonly dataset: string
  readonly period?: Period
  readonly grain?: Grain
  readonly filters?: readonly SpecFilter[]
  readonly group_by?: readonly string[]
  readonly measures: readonly string[]
  readonly sort?: { readonly key: string; readonly desc?: boolean }
  readonly limit?: number
  readonly present?: Present
}

// ---- What running one answers ------------------------------------------

export interface ResultColumn {
  readonly key: string
  readonly label: string
  readonly role: "bucket" | "dimension" | "measure"
  readonly format?: "money" | "count" | "percent"
}

export type ResultRow = Record<string, string | number | null>

export interface ReportResult {
  readonly columns: readonly ResultColumn[]
  /// The headline figures, computed by the database over the whole period
  /// rather than by adding up the rows. Null when the spec names no KPIs.
  ///
  /// Not a convenience: `units_per_sale` summed across fourteen days is not
  /// the fortnight's figure, and a browser that added the column up would be
  /// confidently wrong in a way nobody checks.
  readonly totals: Record<string, number | null> | null
  readonly rows: readonly ResultRow[]
  readonly row_count: number
  /// True when the row ceiling was hit. Drawn, never swallowed: a truncated
  /// report is one somebody will otherwise average.
  readonly truncated: boolean
  readonly as_of: string
  /// Which dates the period actually resolved to, so a relative report can be
  /// checked against something.
  readonly period: { readonly from: string; readonly to: string } | null
  readonly catalogue_version: number
  readonly report?: SavedReport
}

// ---- What is kept ------------------------------------------------------

export interface ReportVersion {
  readonly version: number
  readonly authored_by: string
  /// The sentence the assistant was given. Null when a person edited the spec
  /// by hand — and that distinction is the point of keeping it.
  readonly prompt: string | null
  readonly model: string | null
  readonly catalogue_version: number
  readonly created_at: string
}

export interface SavedReport {
  readonly report_id: string
  readonly name: string
  readonly owner: string
  readonly shared: boolean
  readonly version: number
  readonly spec: ReportSpec
  readonly catalogue_version: number
  readonly prompt: string | null
  readonly model: string | null
  readonly created_at: string
  readonly updated_at: string
  readonly editable: boolean
  readonly versions: readonly ReportVersion[]
}

/// Re-exported from the contract rather than transcribed.
///
/// It was hand-written here while `/reports/saved` answered with a `json!()`
/// literal the generator had nothing to read. The endpoint carries a struct
/// now, so this is generated from the Rust like everything else — and the day
/// somebody adds a field to it, the screen gets the field rather than a
/// silence.
export type { SavedReportRow }

export const reportKeys = {
  catalogue: () => ["reports", "catalogue"] as const,
  saved: () => ["reports", "saved"] as const,
  report: (id: string) => ["reports", "saved", id] as const,
  run: (id: string) => ["reports", "saved", id, "run"] as const,
  adhoc: (spec: ReportSpec) => ["reports", "run", spec] as const,
}

/// The catalogue changes when the server is deployed, not while somebody is
/// looking at it.
export function useCatalogue() {
  return useQuery({
    queryKey: reportKeys.catalogue(),
    queryFn: () => node.get<Catalogue>("/api/v1/reports/catalogue"),
    staleTime: 10 * 60_000,
  })
}

/// The saved reports, with the envelope opened here rather than on the screen.
///
/// `/reports/saved` answers `{ rows, … }` — it was given the same envelope every
/// other list in this system now carries. It used to answer `{ items }`, and for
/// a while after the change this hook still said `items`: the screen read
/// `page.items.length` on `undefined` and threw before it could draw. Nothing
/// was wrong with either side on its own, which is exactly why the break was
/// invisible until somebody opened the screen.
///
/// So the unwrapping lives in ONE place. `items` is kept as the name the screen
/// reads, because the screen holds the whole list and does not page — and the
/// day it should page, it asks for the envelope here instead of eight screens
/// each learning a new shape.
export function useSavedReports() {
  return useQuery({
    queryKey: reportKeys.saved(),
    queryFn: async () => {
      const page = await node.get<SavedReportPage>("/api/v1/reports/saved")
      return { items: page.rows }
    },
  })
}

export function useReport(id: string) {
  return useQuery({
    queryKey: reportKeys.report(id),
    queryFn: () => node.get<SavedReport>(`/api/v1/reports/saved/${id}`),
  })
}

/// How the filter bar's vocabulary maps onto the server's.
///
/// Most operators are the same word in a different case. The four date ones
/// are not: `before` and `onOrAfter` are comparisons the server already has,
/// and it casts by the column's kind — so a date column compares as a date and
/// a number as a number, which is the whole reason the two ends agree on
/// `kind` in the first place.
///
/// Anything absent here is an operator the server cannot honour. Dropping it
/// silently would narrow the table by less than the chip claims, so it is
/// dropped *loudly* — see `toServerFilters`.
const SERVER_OP: Partial<Record<Operator, SpecFilter["op"]>> = {
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

/// The filter bar's clauses, as the server understands them.
///
/// Returns what could be translated and what could not. The caller has to draw
/// the second list: a clause the server ignored is a chip on screen promising
/// a narrowing that did not happen, and that is worse than an error.
export function toServerFilters(clauses: readonly Filter[]): {
  filters: SpecFilter[]
  untranslated: Filter[]
} {
  const filters: SpecFilter[] = []
  const untranslated: Filter[] = []
  for (const clause of clauses) {
    const op = SERVER_OP[clause.operator]
    if (op) {
      filters.push({ column: clause.column, op, values: clause.values })
    } else {
      untranslated.push(clause)
    }
  }
  return { filters, untranslated }
}

/// Run a kept report, narrowed by whatever the reader has in the filter bar.
///
/// The narrowing goes to the server rather than being applied to the rows that
/// came back. A report is capped at 5.000 rows; filtering inside that cap would
/// search a truncated table and call it an answer.
///
/// A POST for a read, because the clauses travel in the body — see
/// `cloud/http/reports.rs`. The shareable URL is still the browser's `?f=`.
export function useReportRun(id: string, filters: readonly SpecFilter[] = []) {
  return useQuery({
    queryKey: [...reportKeys.run(id), filters],
    queryFn: () =>
      node.post<ReportResult>(`/api/v1/reports/saved/${id}/run`, { filters }),
    // The previous answer stays on screen while a narrowed one is fetched.
    // Filtering that blanks the table on every keystroke reads as broken.
    placeholderData: (previous) => previous,
  })
}

/// Run a spec that has not been kept — the preview before a report gets a name.
export function useSpecRun(
  spec: ReportSpec | null,
  filters: readonly SpecFilter[] = []
) {
  return useQuery({
    queryKey: [
      ...reportKeys.adhoc(spec ?? { dataset: "", measures: [] }),
      filters,
    ],
    queryFn: () =>
      node.post<ReportResult>("/api/v1/reports/run", { spec, filters }),
    enabled: spec !== null,
  })
}

export function useSaveReport() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      name: string
      spec: ReportSpec
      prompt?: string
      model?: string
    }) => node.post<SavedReport>("/api/v1/reports/saved", body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: reportKeys.saved() })
    },
  })
}

/// Editing appends a version. The old one still resolves, which is what makes
/// "why is last month's figure different" answerable.
export function useReviseReport(id: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: { spec: ReportSpec; prompt?: string }) =>
      node.post<SavedReport>(`/api/v1/reports/saved/${id}/versions`, body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: reportKeys.report(id) })
      void client.invalidateQueries({ queryKey: reportKeys.run(id) })
      void client.invalidateQueries({ queryKey: reportKeys.saved() })
    },
  })
}

export function useAmendReport(id: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      name?: string
      shared?: boolean
      archived?: boolean
    }) => node.patch<SavedReport>(`/api/v1/reports/saved/${id}`, body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: reportKeys.report(id) })
      void client.invalidateQueries({ queryKey: reportKeys.saved() })
    },
  })
}

/// The rows as a CSV file, built here rather than asked of the server.
///
/// The server already sent every row the report has — a second endpoint that
/// re-ran the query to format it as text would be a second chance for the two
/// to disagree. The quoting is `lib/csv.ts`'s, shared with every list export.
export function toCsv(result: ReportResult): string {
  return rowsToCsv(
    result.columns.map((column) => ({
      label: column.label,
      value: (row: ReportResult["rows"][number]) => row[column.key],
    })),
    result.rows
  )
}
