// Hand-written: `BookOnlyLine` is in the backend (`postgres/banking.rs`) but the
// ts-rs export has not been regenerated yet. Same shape; replace with the
// generated file when it is.

/**
 * A posting on the bank account that no statement line has claimed yet —
 * ERPNext's "Amounts not reflected in bank".
 */
export type BookOnlyLine = { journal_line_id: string, entry_id: string, entry_number: string, posting_date: string, source_kind: string, memo: string, 
/**
 * Money into the account (a debit in our books).
 */
deposit_minor: number, 
/**
 * Money out of it (a credit in our books).
 */
withdrawal_minor: number, 
/**
 * Days between the posting and the statement's last day.
 */
days_outstanding: number, };
