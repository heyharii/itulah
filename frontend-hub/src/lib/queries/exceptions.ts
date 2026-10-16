import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

import { node } from "@/lib/api"
import { SHOW_MISSING } from "@/lib/features"
import type {
  AcknowledgeExceptionRequest,
  ExceptionItem,
  ExceptionKindCount,
  ExceptionLink,
  ExceptionList,
  ExceptionSettings,
  ExceptionSettingsView,
  ExceptionSummary,
  ExceptionUnitCount,
} from "@itulah/contract"

export type {
  AcknowledgeExceptionRequest,
  ExceptionItem,
  ExceptionKindCount,
  ExceptionLink,
  ExceptionList,
  ExceptionSettings,
  ExceptionSettingsView,
  ExceptionSummary,
  ExceptionUnitCount,
}

/// Store exceptions (0646-0648): what goes wrong in a store's own money and
/// goods, read from data rather than filed by hand — a shift left open, a
/// drawer that does not agree, a day's cash not banked, a delivery not
/// received in time, missing goods nobody has decided about, a shopper
/// charged with no sale behind it.
///
/// See `backend/src/cloud/http/exceptions.rs` and
/// `backend/src/cloud/domain/store_exception.rs`. `Exception*` are generated.

export type ExceptionState =
  "open" | "unacknowledged" | "acknowledged" | "resolved" | "all"

export interface ExceptionQuery {
  readonly unit?: string
  readonly kind?: string
  readonly state?: ExceptionState
  readonly limit?: number
}

export const exceptionsKeys = {
  all: ["exceptions"] as const,
  list: (query: ExceptionQuery) => ["exceptions", "list", query] as const,
  forStore: (unit: string, query: Omit<ExceptionQuery, "unit">) =>
    ["exceptions", "store", unit, query] as const,
  settings: () => ["exceptions", "settings"] as const,
}

function search(query: ExceptionQuery): string {
  const params = new URLSearchParams()
  if (query.unit) params.set("unit", query.unit)
  if (query.kind) params.set("kind", query.kind)
  if (query.state) params.set("state", query.state)
  if (query.limit) params.set("limit", String(query.limit))
  const text = params.toString()
  return text === "" ? "" : `?${text}`
}

export function listExceptions(
  query: ExceptionQuery,
  signal?: AbortSignal
): Promise<ExceptionList> {
  return node.get<ExceptionList>(`/api/v1/exceptions${search(query)}`, {
    signal,
  })
}

export function exceptionsForStore(
  unit: string,
  query: Omit<ExceptionQuery, "unit"> = {},
  signal?: AbortSignal
): Promise<ExceptionList> {
  return node.get<ExceptionList>(
    `/api/v1/stores/${encodeURIComponent(unit)}/exceptions${search(query)}`,
    { signal }
  )
}

export function acknowledgeException(
  id: string,
  note?: string
): Promise<ExceptionItem> {
  return node.post<ExceptionItem>(
    `/api/v1/exceptions/${encodeURIComponent(id)}/acknowledge`,
    note ? { note } : {}
  )
}

export function exceptionSettings(
  signal?: AbortSignal
): Promise<ExceptionSettingsView> {
  return node.get<ExceptionSettingsView>("/api/v1/exceptions/settings", {
    signal,
  })
}

export function updateExceptionSettings(
  settings: ExceptionSettings
): Promise<ExceptionSettingsView> {
  return node.put<ExceptionSettingsView>(
    "/api/v1/exceptions/settings",
    settings
  )
}

// ---- Hooks ------------------------------------------------------------------

/// Every store within reach, polled the same way the fleet page is — an open
/// exception is exactly the kind of thing somebody is watching for.
const EXCEPTIONS_POLL_MS = 30_000

/// The Missing kind, taken out of a list while `SHOW_MISSING` is off. The
/// server's own totals are left as they are.
function withoutMissingKind(list: ExceptionList): ExceptionList {
  if (SHOW_MISSING) return list
  return {
    ...list,
    items: list.items.filter((item) => item.kind !== "MISSING_OPEN"),
    summary: {
      ...list.summary,
      by_kind: list.summary.by_kind.filter(
        (row) => row.kind !== "MISSING_OPEN"
      ),
    },
  }
}

/// The list as a query: what the Stores › Exceptions screen reads (under a
/// `<Suspense>`) and what its prefetcher asks for
/// (`screens/stores/prefetch.ts`).
export const exceptionsQuery = (query: ExceptionQuery) =>
  queryOptions({
    queryKey: exceptionsKeys.list(query),
    queryFn: ({ signal }) => listExceptions(query, signal),
    select: withoutMissingKind,
    refetchInterval: EXCEPTIONS_POLL_MS,
  })

export function useExceptions(query: ExceptionQuery) {
  return useQuery(exceptionsQuery(query))
}

export function useExceptionsForStore(
  unit: string,
  query: Omit<ExceptionQuery, "unit"> = {},
  enabled = true
) {
  return useQuery({
    queryKey: exceptionsKeys.forStore(unit, query),
    queryFn: ({ signal }) => exceptionsForStore(unit, query, signal),
    select: withoutMissingKind,
    enabled,
    refetchInterval: EXCEPTIONS_POLL_MS,
  })
}

export function useAcknowledgeException() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      acknowledgeException(id, note),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: exceptionsKeys.all })
    },
  })
}

export function useExceptionSettings(enabled: boolean) {
  return useQuery({
    queryKey: exceptionsKeys.settings(),
    queryFn: ({ signal }) => exceptionSettings(signal),
    enabled,
  })
}

export function useUpdateExceptionSettings() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (settings: ExceptionSettings) =>
      updateExceptionSettings(settings),
    onSuccess: (view) => {
      client.setQueryData(exceptionsKeys.settings(), view)
    },
  })
}

// ---- Kinds, in words ---------------------------------------------------------

export const EXCEPTION_KIND_LABEL: Readonly<Record<string, string>> = {
  SHIFT_NOT_CLOSED: "Shift not closed",
  CASH_DIFFERENCE: "Cash difference",
  DEPOSIT_MISSING: "Deposit missing",
  RECEIVE_OVERDUE: "Receiving overdue",
  MISSING_OPEN: "Missing goods open",
  CHECKOUT_UNRESOLVED: "Unresolved checkout",
}

/// One line saying what the kind means, for a reader who has never seen it
/// before — a chip or a filter option, not the row itself, which already
/// carries the data's own `sentence`.
export const EXCEPTION_KIND_EXPLANATION: Readonly<Record<string, string>> = {
  SHIFT_NOT_CLOSED: "A shift ended without being closed out.",
  CASH_DIFFERENCE: "A counted drawer did not match what was expected.",
  DEPOSIT_MISSING: "A day's cash takings have not reached the bank.",
  RECEIVE_OVERDUE: "A delivery has not been received in time.",
  MISSING_OPEN: "Goods reported missing are still undecided.",
  CHECKOUT_UNRESOLVED: "A shopper was charged and no sale was written.",
}

export function exceptionKindLabel(kind: string): string {
  return EXCEPTION_KIND_LABEL[kind] ?? kind
}

export function exceptionKindExplanation(kind: string): string | undefined {
  return EXCEPTION_KIND_EXPLANATION[kind]
}

const SEVERITY_TONE: Readonly<Record<string, "info" | "warn" | "bad">> = {
  INFO: "info",
  WARN: "warn",
  BAD: "bad",
}

export function exceptionSeverityTone(
  severity: string
): "info" | "warn" | "bad" {
  return SEVERITY_TONE[severity] ?? "warn"
}

const STATE_LABEL: Readonly<Record<string, string>> = {
  OPEN: "Open",
  ACKNOWLEDGED: "Acknowledged",
  RESOLVED: "Resolved",
}

export function exceptionStateLabel(state: string): string {
  return STATE_LABEL[state] ?? state
}
