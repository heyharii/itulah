// Hand-written: `PartyMovementRow` is in the backend
// (`postgres/payment_ledger.rs`) but the ts-rs export has not been regenerated
// yet. Same shape; replace with the generated file when it is.

/**
 * One journal line tagged with the party, with the balance after it.
 * `balance_minor` is credits less debits — what is owed to the party.
 */
export type PartyMovementRow = { journal_line_id: string, entry_id: string, entry_number: string, posting_date: string, source_kind: string, source_id: string | null, account_code: string, account_name: string, unit_id: string, memo: string | null, debit_minor: number, credit_minor: number, balance_minor: number, };
