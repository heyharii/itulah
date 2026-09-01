/**
 * Named cache classes.
 *
 * Nothing in the suite sets `staleTime` by hand. A query picks a class from
 * this table, because how long a number may be trusted is a property of what
 * the number *is*, not of the screen that happens to be showing it — and two
 * screens reading the same endpoint must not disagree about it.
 *
 * See docs/frontend-rules.md §C1 for the reasoning behind each boundary.
 */

export interface StaleClass {
  staleTime: number | "static"
  gcTime: number
  refetchOnWindowFocus: boolean
}

const minutes = (n: number) => n * 60_000

export const STALE = {
  /**
   * Masterdata: locations, divisions, tags, roles, chart of accounts, the
   * permission catalogue. This changes on a change-request, not on a shift.
   * Refetching a location list every 30 seconds across 18 apps is pure noise.
   */
  reference: {
    staleTime: minutes(30),
    gcTime: minutes(60),
    refetchOnWindowFocus: false,
  },

  /** Articles, price lists, campaigns, supplier records. Edited by a person
   * during the day, but not while someone else is watching the screen. */
  catalogue: {
    staleTime: minutes(5),
    gcTime: minutes(30),
    refetchOnWindowFocus: false,
  },

  /** Inventory balances, PO lists, receiving batches, the roster. Moves with
   * the working day; a refetch on focus would be noise, a 5-minute stale
   * window would not. */
  operational: {
    staleTime: 30_000,
    gcTime: minutes(5),
    refetchOnWindowFocus: false,
  },

  /**
   * Movements, journal, general ledger, audit — anything money- or
   * stock-bearing. A stale figure here is not a slow UI, it is a wrong
   * decision by someone who wrote the number down. Always revalidate, and
   * reconcile when the user comes back to the tab.
   */
  ledger: {
    staleTime: 0,
    gcTime: minutes(5),
    refetchOnWindowFocus: true,
  },

  /** `/me` and permissions. Invalidated by events — login, logout, a role
   * change — never by a timer. A permission that expires on a clock is worse
   * than one that expires on logout. */
  session: {
    staleTime: "static",
    gcTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  },

  /** A sealed `docartifact` artifact, by id. Immutable by construction — the
   * backend hashes it — so "never stale" is the literal truth here rather than
   * an optimisation. */
  document: {
    staleTime: "static",
    gcTime: minutes(30),
    refetchOnWindowFocus: false,
  },
} as const satisfies Record<string, StaleClass>

export type StaleClassName = keyof typeof STALE
