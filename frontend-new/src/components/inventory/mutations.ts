/**
 * Inventory writes.
 *
 * Each mutation owns its own cache effect — the screen calls the mutation and
 * never calls `invalidateQueries` itself. See docs/frontend-rules.md §M1.
 *
 * None of the four writes in this domain are optimistic. Per rule M4 and
 * docs/tanstack-gap-plan.md §0:
 *
 *  - `useSubmitInventoryCount` posts a signed Movement for every counted
 *    line — it moves stock, full stop. M4 is absolute here: show a pending
 *    state and wait for the server.
 *  - `useDisposeInboundReturn` posts restock/write-off Movements — stock
 *    again, same rule.
 *  - `useScheduleInboundReturnPickup` and `useInspectInboundReturn` do not
 *    move stock themselves, but the sheet that starts them
 *    (`InventoryOperations` in operations.tsx) closes on success either way —
 *    there is nothing left on screen for an optimistic write to update, so
 *    this is the "sheet that closes on success" row of the shape table:
 *    neither variables-based nor cache-based, just `onSettled` invalidation.
 *
 * So all four are "Neither," which is the expected shape for this domain —
 * see the task note that inventory should produce very few optimistic
 * mutations.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"

import {
  disposeInboundReturn,
  inspectInboundReturn,
  scheduleInboundReturnPickup,
  submitInventoryCount,
  type InboundReturnInspection,
  type InventoryCountResult,
  type InventoryCountRow,
} from "./api"
import { inventoryQueries } from "./queries"

export interface InventoryCountInput {
  locationId: string
  rows: InventoryCountRow[]
}

/**
 * Posting a count moves stock, so the whole inventory namespace is stale
 * afterwards — balances, the ledger, and the operations projections alike.
 * That is the widest prefix in `inventoryQueries`, and it is genuinely what
 * a posted adjustment affects, so M2's "narrowest affected prefix" is the
 * whole domain here, not a scoping shortcut.
 */
export function useSubmitInventoryCount() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: InventoryCountInput) =>
      submitInventoryCount(input.locationId, input.rows),
    onSettled: () => client.invalidateQueries({ queryKey: inventoryQueries.all() }),
  })
}

/** Scheduling a pickup touches the operations worklist and that one return's
 * detail sheet — nothing else. */
export function useScheduleInboundReturnPickup() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => scheduleInboundReturnPickup(id),
    onSettled: (_data, _error, id) => {
      void client.invalidateQueries({
        queryKey: inventoryQueries.operations().queryKey,
      })
      void client.invalidateQueries({
        queryKey: inventoryQueries.inboundReturn(id).queryKey,
      })
    },
  })
}

export interface InboundReturnInspectInput {
  id: string
  inspection: InboundReturnInspection
}

/** Recording an inspection is the same blast radius as scheduling a pickup:
 * the worklist row and that return's own detail. */
export function useInspectInboundReturn() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: InboundReturnInspectInput) =>
      inspectInboundReturn(input.id, input.inspection),
    onSettled: (_data, _error, input) => {
      void client.invalidateQueries({
        queryKey: inventoryQueries.operations().queryKey,
      })
      void client.invalidateQueries({
        queryKey: inventoryQueries.inboundReturn(input.id).queryKey,
      })
    },
  })
}

/** Disposal posts restock/write-off movements, so balances move too — the
 * same whole-namespace blast radius as a posted count. */
export function useDisposeInboundReturn() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => disposeInboundReturn(id),
    onSettled: () => client.invalidateQueries({ queryKey: inventoryQueries.all() }),
  })
}

export type { InventoryCountResult }
