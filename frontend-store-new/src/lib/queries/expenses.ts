import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query"

import { cacheKey, node } from "@/lib/api"
import { describe } from "@/lib/errors"
import { commandKey } from "@/lib/till"
import type { Identity } from "@itulah/contract/client"
import type {
  ExpenseRecorded,
  ExpenseWindow,
  PettyCashPosition,
  PettyCashTopUpRecorded,
  PettyCashTopUpRequest,
  RecordExpenseRequest,
  Supervisor,
} from "@itulah/contract"

/// The shop's small money, as the screen asks for it.
///
/// Two reads and two writes, and the two reads are deliberately separate calls
/// answering separate questions:
///
///   **the tin** is a lifetime figure — the money head office handed over in
///   July is still in it in September — so it is cached under a key of its own
///   and does not move when somebody changes the span;
///
///   **the book** is a span, and changing the span refetches only it.
///
/// Folding one into the other would mean the balance blinking — refetched,
/// identical, redrawn — every time a manager pressed "30 days".
///
/// Everything that writes writes with an idempotency key held across retries,
/// like `lib/till.ts` beside it. A till is offline half the time by design, and
/// an expense sent twice because the first answer never came back is a float
/// that reports itself short by exactly one receipt.

export const pettyCashKey = () => ["petty", "position"] as const

export const expenseKey = (from: string, to: string) =>
  ["petty", "expenses", from, to] as const

/// The merged book — receipts and hand-overs as one list, newest first — is a
/// span of its own and shares the `["petty", "expenses"]` prefix, so a write
/// that invalidates that prefix refreshes it too.
export const bookKey = (from: string, to: string) =>
  ["petty", "expenses", "book", from, to] as const

/// Who is doing this, from the session the app already holds.
///
/// The node overwrites `actor_id` from the authenticated principal whenever
/// auth is on, so this is belt and braces — except on a development node with
/// `INVENTORY_AUTH_MODE=disabled`, where there is no principal to overwrite it
/// with and a blank name is refused as "actor_id is required".
///
/// A local copy of the same three lines `lib/till.ts` keeps private rather than
/// an export prised out of that file: it is a file several lanes are editing,
/// and three lines of cache read are not worth a merge conflict over.
function actorFrom(client: ReturnType<typeof useQueryClient>): string {
  const me = client.getQueryData<Identity | null>(cacheKey.me())
  return me?.username ?? ""
}

/// What is in the tin: handed over, spent, left, and the line above which an
/// expense needs Finance's code. The line arrives with the position (Finance's
/// setting), never spelled here.
export const pettyCashQuery = () =>
  queryOptions({
    queryKey: pettyCashKey(),
    queryFn: ({ signal }) =>
      node.get<PettyCashPosition>("/api/v1/store/petty-cash", { signal }),
  })

export function usePettyCash() {
  return useQuery(pettyCashQuery())
}

/// The shop's petty cash book over a span, in the shop's own wall clock.
///
/// `utc_offset_minutes` is sent from the browser rather than assumed at the
/// node: a shop asking for "today" before seven in the morning would otherwise
/// be answered with yesterday.
export function useExpenses(from: string, to: string) {
  return useQuery({
    queryKey: expenseKey(from, to),
    // A new range keeps the old rows up until its own arrive — no skeleton blink.
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      node.get<ExpenseWindow>(
        `/api/v1/store/expenses?from=${from}&to=${to}` +
          `&utc_offset_minutes=${-new Date().getTimezoneOffset()}&limit=100`,
        { signal },
      ),
  })
}

export interface ExpenseDraft {
  readonly category: string
  readonly amountMinor: number
  readonly payee: string
  readonly reason: string
  /// Finance's one-time code; only needed above the line.
  readonly approvalCode: string | null
}

/// Record what the shop spent.
///
/// The answer carries the tin after this expense, so the header updates from
/// the write instead of from a second round trip — the same thing a cash
/// movement does when it answers with the whole Z report.
export function useRecordExpense(): UseMutationResult<
  ExpenseRecorded,
  Error,
  ExpenseDraft
> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (draft) => {
      const request: RecordExpenseRequest = {
        category: draft.category,
        amount_minor: draft.amountMinor,
        payee: draft.payee,
        reason: draft.reason,
        actor_id: actorFrom(client),
        approval_code: draft.approvalCode,
        idempotency_key: commandKey("expense"),
      }
      return node.post<ExpenseRecorded>("/api/v1/store/expenses", request)
    },
    onSuccess: (recorded) => {
      client.setQueryData(pettyCashKey(), recorded.position)
      // Every span, not the one on screen: an expense recorded today belongs to
      // "today", to "7 days" and to "30 days", and a manager who switches back
      // to a span they were looking at a minute ago should not find it missing.
      void client.invalidateQueries({ queryKey: ["petty", "expenses"] })
    },
  })
}

export interface TopUpDraft {
  readonly amountMinor: number
  readonly reference: string
  readonly note: string
  readonly supervisor: Supervisor
}

/// Record the float head office handed over.
export function useRecordTopUp(): UseMutationResult<
  PettyCashTopUpRecorded,
  Error,
  TopUpDraft
> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (draft) => {
      const request: PettyCashTopUpRequest = {
        amount_minor: draft.amountMinor,
        reference:
          draft.reference.trim() === "" ? null : draft.reference.trim(),
        note: draft.note.trim() === "" ? null : draft.note.trim(),
        actor_id: actorFrom(client),
        supervisor: draft.supervisor,
        idempotency_key: commandKey("petty-topup"),
      }
      return node.post<PettyCashTopUpRecorded>(
        "/api/v1/store/petty-cash/top-ups",
        request,
      )
    },
    onSuccess: (recorded) => {
      client.setQueryData(pettyCashKey(), recorded.position)
      void client.invalidateQueries({ queryKey: ["petty", "expenses"] })
    },
  })
}

/// The passbook's lines: receipts and hand-overs of one span as ONE book,
/// newest first (`paged=true`), so a running balance can be worked out from the
/// tin's balance without the two halves reaching back different distances.
///
/// 500 is the node's ceiling for a page. A shop's petty cash is a few dozen
/// vouchers a month, and when the span does hold more `next_cursor` says so —
/// the screen then says it shows the latest only, rather than a balance that is
/// quietly wrong at the old end.
export const bookQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: bookKey(from, to),
    queryFn: ({ signal }) =>
      node.get<ExpenseWindow>(
        `/api/v1/store/expenses?from=${from}&to=${to}` +
          `&utc_offset_minutes=${-new Date().getTimezoneOffset()}` +
          `&limit=500&paged=true`,
        { signal },
      ),
  })

export function useBook(from: string, to: string) {
  return useQuery({
    ...bookQuery(from, to),
    placeholderData: keepPreviousData,
  })
}

/// One line of a BKK, as the node takes it: an expense of its own.
///
/// There is no voucher on the node — a BKK with three lines is three expenses
/// saved one after the other — so every line carries the idempotency key the
/// caller minted when the line was added, and holds it across retries.
export interface ExpenseLineDraft {
  readonly key: string
  readonly category: string
  readonly amountMinor: number
  readonly reason: string
  /// Finance's one-time code, for a line above the line.
  readonly approvalCode: string | null
}

export interface ExpensesDraft {
  readonly payee: string
  readonly lines: readonly ExpenseLineDraft[]
}

/// One line of a BKM: a float head office handed over.
export interface TopUpLineDraft {
  readonly key: string
  readonly amountMinor: number
  readonly note: string
}

export interface TopUpsDraft {
  readonly reference: string
  readonly supervisor: Supervisor
  readonly lines: readonly TopUpLineDraft[]
}

/// What a voucher left in the book: the record each line became, first line
/// first, and the tin after the last of them.
export interface VoucherSaved {
  readonly ids: readonly string[]
  readonly position: PettyCashPosition
}

/// Some of a voucher's lines are in the book and one was refused.
///
/// The ones before it stay: each is a record of its own, and the node has no
/// way to take them back. Pressing Save again sends every line under the same
/// key it had, so the saved ones are answered as they were and only the rest is
/// tried.
class PartialVoucher extends Error {
  constructor(line: number, saved: number, cause: unknown) {
    const said = describe(cause)
    // The node's sentence, closed with a full stop if it has none.
    const closed = /[.!?]$/.test(said) ? said : `${said}.`
    super(
      saved === 0
        ? said
        : `Line ${line} was refused: ${closed} The ${
            saved === 1 ? "line" : `${saved} lines`
          } before it ${saved === 1 ? "is" : "are"} saved. Fix it and save again.`,
    )
    this.name = "PartialVoucher"
  }
}

/// Save each line in turn, stopping at the first the node refuses.
async function saveInTurn<T, R>(
  lines: readonly T[],
  send: (line: T) => Promise<R>,
): Promise<[R, ...R[]]> {
  if (lines.length === 0) throw new Error("A voucher needs a line.")
  const answers: R[] = []
  for (const [index, line] of lines.entries()) {
    try {
      answers.push(await send(line))
    } catch (error) {
      throw new PartialVoucher(index + 1, answers.length, error)
    }
  }
  return answers as [R, ...R[]]
}

/// A BKK: one expense per line, for the one payee.
export function useRecordExpenses(): UseMutationResult<
  VoucherSaved,
  Error,
  ExpensesDraft
> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (draft) => {
      const actor = actorFrom(client)
      const answers = await saveInTurn(draft.lines, (line) => {
        const request: RecordExpenseRequest = {
          category: line.category,
          amount_minor: line.amountMinor,
          payee: draft.payee,
          reason: line.reason,
          actor_id: actor,
          approval_code: line.approvalCode,
          idempotency_key: line.key,
        }
        return node.post<ExpenseRecorded>("/api/v1/store/expenses", request)
      })
      return {
        ids: answers.map((one) => one.expense.id),
        position: answers[answers.length - 1].position,
      }
    },
    onSettled: () => {
      // Settled, not succeeded: a refusal half way leaves the lines before it
      // in the book, and the tin has moved with them.
      void client.invalidateQueries({ queryKey: pettyCashKey() })
      void client.invalidateQueries({ queryKey: ["petty", "expenses"] })
    },
  })
}

/// A BKM: one hand-over per line, counted with the same second person.
export function useRecordTopUps(): UseMutationResult<
  VoucherSaved,
  Error,
  TopUpsDraft
> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (draft) => {
      const actor = actorFrom(client)
      const answers = await saveInTurn(draft.lines, (line) => {
        const request: PettyCashTopUpRequest = {
          amount_minor: line.amountMinor,
          reference:
            draft.reference.trim() === "" ? null : draft.reference.trim(),
          note: line.note.trim() === "" ? null : line.note.trim(),
          actor_id: actor,
          supervisor: draft.supervisor,
          idempotency_key: line.key,
        }
        return node.post<PettyCashTopUpRecorded>(
          "/api/v1/store/petty-cash/top-ups",
          request,
        )
      })
      return {
        ids: answers.map((one) => one.top_up.id),
        position: answers[answers.length - 1].position,
      }
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: pettyCashKey() })
      void client.invalidateQueries({ queryKey: ["petty", "expenses"] })
    },
  })
}
