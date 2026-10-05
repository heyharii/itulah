// Hand-written beside the generated types: the purchase order detail is JSON
// built in `sync::purchase_order_status`, not a ts-rs struct.

/**
 * One receiving against a purchase order line — an accepted count, oldest
 * first in `lines[].receipts` of the PO detail. `quantity` is every piece
 * accepted (`matched_quantity + excess_quantity`); `received_at` is when the
 * count was accepted at the DC. `wrong_quantity` is what the checker counted
 * as not the article the order names — a part of `excess_quantity` (0829).
 */
export type PurchaseOrderLineReceipt = { receipt_number: string, quantity: number, matched_quantity: number, excess_quantity: number, wrong_quantity: number, received_at: string, };
