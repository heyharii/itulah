// Hand-written: `PartyMovements` is in the backend
// (`postgres/payment_ledger.rs`) but the ts-rs export has not been regenerated
// yet. Same shape; replace with the generated file when it is.
import type { PartyMovementRow } from "./PartyMovementRow";

/**
 * A party's movements over a window, opening and closing balance included.
 */
export type PartyMovements = { party_type: string, party_id: string, from: string, to: string, unit_id: string | null, opening_minor: number, debit_minor: number, credit_minor: number, closing_minor: number, rows: Array<PartyMovementRow>, };
