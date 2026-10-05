// Hand-written: `PeriodEvent` is in the backend (`postgres/period_close.rs`) but
// the ts-rs export has not been regenerated yet. Same shape; replace with the
// generated file when it is.

/**
 * One close or reopen of a month, as recorded. Newest first from the server.
 */
export type PeriodEvent = { event_id: string, year: number, month: number, 
/**
 * `CLOSE` or `REOPEN`.
 */
event: string, actor: string, 
/**
 * Required on a reopen, absent on a close.
 */
reason: string | null, 
/**
 * The checklist as it stood. Present on a close, absent on a reopen.
 */
checklist: unknown | null, at: string, };
