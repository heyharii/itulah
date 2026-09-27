import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query"

import { cacheKey, node } from "@/lib/api"
import type { Identity } from "@itulah/contract/client"
import type {
  CashMovementRequest,
  CloseShiftRequest,
  OpenShiftRequest,
  ReceiptDocument,
  PrintReceiptRequest,
  ReturnRequest,
  ReturnResult,
  ShiftReport,
  Supervisor,
  VoidResult,
  VoidSaleRequest,
} from "@itulah/contract"

/// The drawer, the reversal, and the paper.
///
/// Everything here writes, and everything here writes with an idempotency key
/// that survives a retry. The till is offline half the time by design; a
/// refund sent twice because the first answer never came back is money the
/// shop hands out twice.

// ─────────────────────────────────────────────────────────────────────────────
// Which terminal this is

const TERMINAL_KEY = "till.terminal.v1"

/// This machine's name, minted once and kept.
///
/// A shift belongs to a terminal, and "terminal" has to mean the same physical
/// counter across a reload or nobody can be asked to account for a drawer. The
/// browser has no such identity, so one is minted here and written to disk. It
/// is not a secret and not a credential — the node authorises on the session,
/// not on this.
export function terminalId(): string {
  try {
    const held = window.localStorage.getItem(TERMINAL_KEY)
    if (held !== null && held !== "") return held
    const minted = `TILL-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
    window.localStorage.setItem(TERMINAL_KEY, minted)
    return minted
  } catch {
    // Private browsing, or storage refused. A session-lived name still lets the
    // shift work for as long as this tab is open, which is better than
    // refusing to open a drawer.
    return "TILL-1"
  }
}

/// Where the receipt printer is, as this terminal knows it.
///
/// Held per browser rather than per node for the same reason a print session
/// holds its printer: two counters in one shop have two printers, and a receipt
/// that came out in the other room is a receipt nobody hands over.
export interface PrinterSetting {
  readonly host: string
  readonly port: number
  readonly paper: "NARROW" | "WIDE"
  readonly drawer: "PRINTER_PULSE" | "MANUAL" | "NONE"
}

const PRINTER_KEY = "till.printer.v1"

export function readPrinter(): PrinterSetting | null {
  try {
    const raw = window.localStorage.getItem(PRINTER_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) return null
    const held = parsed as Partial<PrinterSetting>
    if (typeof held.host !== "string" || held.host === "") return null
    return {
      host: held.host,
      port: typeof held.port === "number" ? held.port : 9100,
      paper: held.paper === "WIDE" ? "WIDE" : "NARROW",
      drawer:
        held.drawer === "PRINTER_PULSE" || held.drawer === "MANUAL"
          ? held.drawer
          : "NONE",
    }
  } catch {
    return null
  }
}

export function writePrinter(setting: PrinterSetting | null): void {
  try {
    if (setting === null) window.localStorage.removeItem(PRINTER_KEY)
    else window.localStorage.setItem(PRINTER_KEY, JSON.stringify(setting))
  } catch {
    // Nothing to do. The screen re-asks next time, which is the honest
    // outcome of a browser that will not remember.
  }
}

/// Who is doing this, from the session the app already holds.
///
/// The node overwrites `actor_id` from the authenticated principal whenever
/// auth is on, so this is belt and braces — except in a development node with
/// `INVENTORY_AUTH_MODE=disabled`, where there is no principal to overwrite it
/// with and a blank name is refused as "actor_id is required". Reading the
/// cache rather than threading a name through every caller keeps the screens
/// from having to know.
function actorFrom(client: ReturnType<typeof useQueryClient>): string {
  const me = client.getQueryData<Identity | null>(cacheKey.me())
  return me?.username ?? ""
}

/// A fresh key per attempt-group, not per attempt.
///
/// Held by the caller across retries: a key that changed on each try would turn
/// a retry into a second operation, which is the one thing idempotency exists
/// to prevent.
export function commandKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

// ─────────────────────────────────────────────────────────────────────────────
// The shift

export const shiftKey = () => ["till", "shift"] as const

/// The shift running on this terminal, or `null`.
///
/// `null` is an ordinary answer at nine in the morning, so it is not an error
/// and the screen does not treat it as one.
export function useActiveShift() {
  return useQuery({
    queryKey: shiftKey(),
    queryFn: ({ signal }) =>
      node.get<ShiftReport | null>(
        `/api/v1/store/shifts/active?terminal_id=${encodeURIComponent(terminalId())}`,
        { signal },
      ),
    // The Z report moves with every sale, and a cashier looking at it wants
    // today's number rather than the one from when the screen opened.
    refetchInterval: 30_000,
  })
}

export function useOpenShift(): UseMutationResult<
  ShiftReport,
  Error,
  { floatMinor: number }
> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ floatMinor }) => {
      const request: OpenShiftRequest = {
        terminal_id: terminalId(),
        opening_float_minor: floatMinor,
        actor_id: actorFrom(client),
        idempotency_key: commandKey("shift-open"),
      }
      return node.post<ShiftReport>("/api/v1/store/shifts", request)
    },
    onSuccess: (report) => client.setQueryData(shiftKey(), report),
  })
}

export function useCloseShift(
  shiftId: string,
): UseMutationResult<
  ShiftReport,
  Error,
  { declaredMinor: number; note: string }
> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ declaredMinor, note }) => {
      const request: CloseShiftRequest = {
        declared_cash_minor: declaredMinor,
        // This screen counts a total, not a sheet; the node takes either.
        counted: [],
        note: note.trim() === "" ? null : note.trim(),
        actor_id: actorFrom(client),
        idempotency_key: commandKey("shift-close"),
      }
      return node.post<ShiftReport>(
        `/api/v1/store/shifts/${encodeURIComponent(shiftId)}/close`,
        request,
      )
    },
    // The closed report is the answer, but the ACTIVE shift is now none — and
    // leaving the closed one in that slot is how a till shows a drawer as open
    // after somebody counted it.
    onSuccess: () => client.setQueryData(shiftKey(), null),
  })
}

export function useCashMovement(shiftId: string): UseMutationResult<
  ShiftReport,
  Error,
  {
    kind: "DROP" | "PAYOUT" | "PICKUP" | "CORRECTION"
    amountMinor: number
    reason: string
    supervisor: Supervisor | null
  }
> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ kind, amountMinor, reason, supervisor }) => {
      const request: CashMovementRequest = {
        kind,
        // Signed at the edge of the app, once. Every caller below thinks in
        // "how much", and the direction is a property of the KIND — a payout
        // that was recorded positive because a screen forgot the sign is a
        // drawer that reports itself long by twice the payout.
        amount_minor:
          kind === "PICKUP" ? Math.abs(amountMinor) : -Math.abs(amountMinor),
        reason,
        actor_id: actorFrom(client),
        supervisor,
        idempotency_key: commandKey(`cash-${kind.toLowerCase()}`),
      }
      return node.post<ShiftReport>(
        `/api/v1/store/shifts/${encodeURIComponent(shiftId)}/movements`,
        request,
      )
    },
    onSuccess: (report) => client.setQueryData(shiftKey(), report),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Taking it back

export const receiptKey = (saleId: string) =>
  ["till", "receipt", saleId] as const

export function useReceipt(saleId: string | null) {
  return useQuery({
    queryKey: receiptKey(saleId ?? ""),
    queryFn: ({ signal }) =>
      node.get<ReceiptDocument>(
        `/api/v1/store/sales/${encodeURIComponent(saleId ?? "")}/receipt`,
        { signal },
      ),
    enabled: saleId !== null && saleId !== "",
    // A receipt is a fact about a completed sale. It only changes when the sale
    // is voided or returned against, and both of those invalidate it by hand.
    staleTime: Infinity,
    retry: false,
  })
}

export function useVoidSale(): UseMutationResult<
  VoidResult,
  Error,
  { saleId: string; reason: string; supervisor: Supervisor }
> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ saleId, reason, supervisor }) => {
      const request: VoidSaleRequest = {
        reason,
        supervisor,
        actor_id: actorFrom(client),
        idempotency_key: commandKey("void"),
      }
      return node.post<VoidResult>(
        `/api/v1/store/sales/${encodeURIComponent(saleId)}/void`,
        request,
      )
    },
    onSuccess: (_result, { saleId }) => {
      // The receipt now carries a stamp, the drawer's figures moved, and the
      // garments are back on the floor.
      void client.invalidateQueries({ queryKey: receiptKey(saleId) })
      void client.invalidateQueries({ queryKey: shiftKey() })
      void client.invalidateQueries({ queryKey: ["inventory"] })
      void client.invalidateQueries({ queryKey: ["sales"] })
    },
  })
}

export function useReturnSale(): UseMutationResult<
  ReturnResult,
  Error,
  Omit<ReturnRequest, "actor_id" | "idempotency_key">
> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (request) =>
      node.post<ReturnResult>("/api/v1/store/returns", {
        ...request,
        actor_id: actorFrom(client),
        idempotency_key: commandKey("return"),
      } satisfies ReturnRequest),
    onSuccess: (_result, request) => {
      void client.invalidateQueries({ queryKey: receiptKey(request.sale_id) })
      void client.invalidateQueries({ queryKey: shiftKey() })
      void client.invalidateQueries({ queryKey: ["inventory"] })
      void client.invalidateQueries({ queryKey: ["sales"] })
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// The paper

export interface PrintOutcome {
  readonly sale_id: string
  readonly receipt_no: string
  readonly printer: string
  readonly bytes: number
}

export function usePrintReceipt(): UseMutationResult<
  PrintOutcome,
  Error,
  { saleId: string; copy?: boolean }
> {
  return useMutation({
    mutationFn: ({ saleId, copy = false }) => {
      const printer = readPrinter()
      if (printer === null) {
        // Refused here rather than sent with a blank host, so the message names
        // the thing to fix instead of arriving as the node's validation error.
        throw new Error(
          "This till has no receipt printer set. Add one under Shift → Printer.",
        )
      }
      const request: PrintReceiptRequest = {
        printer_host: printer.host,
        printer_port: printer.port,
        paper: printer.paper,
        drawer: printer.drawer,
        copy,
      }
      return node.post<PrintOutcome>(
        `/api/v1/store/sales/${encodeURIComponent(saleId)}/receipt`,
        request,
      )
    },
  })
}
