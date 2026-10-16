import { units } from "@/lib/format"

/// What a fan-out over cartons actually achieved.
///
/// Two things happen at every despatch step and they are genuinely separate in
/// the server: the **document** (`POST shipments`, `POST dispatches`,
/// `POST dispatches/{id}/depart`) says who is carrying what and touches no
/// stock at all, and the **stock** moves one carton at a time
/// (`koli/{id}/shipment`, `/dispatch`, `/in-transit`), each writing its own
/// movement group.
///
/// A warehouse that only files the paperwork leaves its goods sitting in
/// `outbound.packed` while the consignment note claims they are on the road.
/// So every action does both — and because advancing is one request per carton
/// over warehouse wifi, a screen that said "done" after eleven of twelve would
/// leave one carton behind in a pool nobody looks at again.
///
/// This is the honest tally, reported rather than swallowed.
export interface Progress {
  readonly moved: number
  readonly failed: readonly string[]
  readonly message: string
}

/// One request per carton, and a sentence at the end that says what really
/// happened. Sequential rather than `Promise.all`: these write movement groups
/// against the same pools, and a warehouse's wifi is not the place to find out
/// how the node handles twelve at once.
export async function advanceEach(
  koliIds: readonly string[],
  verb: string,
  advance: (koliId: string) => Promise<unknown>
): Promise<Progress> {
  const failed: string[] = []
  for (const koliId of koliIds) {
    try {
      await advance(koliId)
    } catch {
      failed.push(koliId)
    }
  }
  const moved = koliIds.length - failed.length
  return {
    moved,
    failed,
    message:
      failed.length === 0
        ? `${units(moved)} koli ${verb}.`
        : `${units(moved)} of ${units(koliIds.length)} koli ${verb}; ${failed.length} did not move and are still where they were.`,
  }
}
