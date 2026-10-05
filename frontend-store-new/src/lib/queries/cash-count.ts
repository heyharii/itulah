import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query"

import { CENTRAL_KEY_PREFIX, cloud } from "@/lib/cloud"
import type { CashCountRow } from "@itulah/contract"

/// The shop's three boxes of cash, counted note by note.
///
/// Reads and writes go to head office through the relay, like the HR screens:
/// the books live at the centre, and a count is only worth anything beside
/// what the books say. Money is whole Rupiah.

export type CashMeaning = "cash" | "petty_cash" | "cashier_float"

export interface StoreCashBox {
  readonly meaning: CashMeaning
  readonly account_code: string
  readonly account_name: string
  readonly books_minor: number
  readonly last_counted_on: string | null
  /// Counted less books: negative is short.
  readonly last_variance_minor: number | null
}

export interface CashNoteInput {
  readonly denomination_minor: number
  readonly quantity: number
}

export interface CashCountDraft {
  readonly meaning: CashMeaning
  readonly countedOn?: string
  readonly witnessedBy: string
  readonly reason: string
  readonly notes: readonly CashNoteInput[]
}

export const cashCountKeys = {
  boxes: () => [CENTRAL_KEY_PREFIX, "cash-count", "boxes"] as const,
  counts: () => [CENTRAL_KEY_PREFIX, "cash-count", "counts"] as const,
}

/// `GET /api/v1/store-cash/boxes`
export function useCashBoxes() {
  return useQuery({
    queryKey: cashCountKeys.boxes(),
    queryFn: ({ signal }) =>
      cloud.get<StoreCashBox[]>("/api/v1/store-cash/boxes", { signal }),
  })
}

/// `GET /api/v1/store-cash/counts`
export function useCashCounts() {
  return useQuery({
    queryKey: cashCountKeys.counts(),
    queryFn: ({ signal }) =>
      cloud.get<CashCountRow[]>("/api/v1/store-cash/counts", { signal }),
  })
}

/// `POST /api/v1/store-cash/counts`
///
/// The server sums the notes and refuses a total that differs from the books
/// when the reason is empty; its sentence is shown as it comes.
export function useRecordCashCount(): UseMutationResult<
  CashCountRow,
  Error,
  CashCountDraft
> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (draft) =>
      cloud.post<CashCountRow>("/api/v1/store-cash/counts", {
        meaning: draft.meaning,
        ...(draft.countedOn !== undefined && draft.countedOn !== ""
          ? { counted_on: draft.countedOn }
          : {}),
        witnessed_by: draft.witnessedBy,
        reason: draft.reason,
        notes: draft.notes,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: cashCountKeys.boxes() })
      void client.invalidateQueries({ queryKey: cashCountKeys.counts() })
    },
  })
}
