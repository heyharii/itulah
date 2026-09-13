import { useMemo } from "react"
import type { EmployeeList } from "@itulah/contract"

import { useReport } from "@/lib/list"
import { boundedTo, useReach } from "@/lib/reach"

/// Which place a screen is about, when the endpoint insists on being told.
///
/// ## Why this exists
///
/// `GET /roster` and `GET /attendance-periods` both refuse to answer without a
/// `place`. That is right of them — a rota is a place's rota and there is no
/// sensible union of thirteen shops' weeks — but it leaves the browser needing
/// a list of places to pick from, and **there is no places endpoint on this
/// surface.** `frontend-hub` sidestepped it by only ever asking about
/// `reach.place_id`, which means head office, who reaches everywhere and is
/// posted nowhere, could open neither screen at all.
///
/// ## Where the list actually comes from
///
/// `EmployeeFacets.places` — the facet `GET /employees` already sends, carrying
/// each place's id, its NAME, and how many people are posted there. It is not a
/// workaround: it is the set of places that have staff, which is exactly the
/// set that has a roster or a month worth closing. `directory.tsx` says the
/// same thing in its own words and declines to build a filter out of it; this
/// is that filter, built, for the two screens that cannot work without one.
///
/// ## Two callers, two answers, and only one of them gets a control
///
/// The facet is **empty for a caller bounded to one posting**, deliberately —
/// see the note on `EmployeeFacets`. A filter offering a single value is a
/// control that cannot change the answer, and drawing one beside a store
/// manager's roster suggests there is somewhere else they might look. So a
/// bounded caller's place comes from their reach and there is no picker; head
/// office gets the facet and a strip of it.
///
/// Neither is a permission. Asking for a place outside the caller's reach is
/// refused by the server with a sentence, and the screens render that refusal.

export interface Place {
  readonly value: string
  readonly label: string
  readonly count: number
}

export interface Places {
  /// Everywhere this caller may ask about, with staff counts. Empty for a
  /// bounded caller, who has exactly one and needs no list.
  readonly all: readonly Place[]
  /// The place to ask about when the URL names none.
  ///
  /// `null` while either read is in flight, and `null` for a caller who reaches
  /// nowhere — both of which mean "do not ask the server yet" rather than "ask
  /// about nothing". A screen that treated a pending answer as an empty one
  /// would fire a request for `place=` and be refused.
  readonly fallback: string | null
  /// The place's own NAME, for a sentence. `store-01` is what this system files
  /// a shop under; `Store 01` is what it is called.
  readonly nameOf: (id: string) => string
  /// True once both reads have answered, so a screen can tell "no places" from
  /// "not yet".
  readonly ready: boolean
}

export function usePlaces(): Places {
  const reach = useReach()
  const bounded = boundedTo(reach.data)

  // `limit: 1` on purpose. The facets are computed over everything the search
  // and the caller's REACH match rather than over the page, so one row is
  // enough to carry every place — and this hook wants the facet, not the
  // workforce. `workforce.ts` asks for a thousand because it is a dictionary
  // being looked up in; this is a list of about fifteen strings.
  //
  // Skipped entirely for a bounded caller: their place is already known from
  // the reach, and the facet would come back empty anyway.
  const list = useReport<EmployeeList>({
    key: ["people", "places"],
    path: "/api/v1/employees",
    params: { limit: 1 },
    enabled: reach.data !== undefined && bounded === null,
  })

  return useMemo(() => {
    const all: readonly Place[] = (list.data?.facets.places ?? []).map(
      (facet) => ({
        value: facet.value,
        label: facet.label ?? facet.value,
        count: facet.count,
      }),
    )
    const names = new Map(all.map((place) => [place.value, place.label]))

    // A bounded caller's own posting, or head office's first place. First
    // rather than any particular one: the facet arrives ordered by headcount,
    // so the default is the place with the most people in it, which is the one
    // most likely to be worth opening.
    const fallback =
      reach.data === undefined
        ? null
        : (reach.data.place_id ?? all[0]?.value ?? null)

    return {
      all,
      fallback,
      nameOf: (id: string) =>
        names.get(id) ?? (id === reach.data?.place_id ? bounded : null) ?? id,
      ready: reach.data !== undefined && (bounded !== null || !list.isPending),
    }
  }, [list.data, list.isPending, reach.data, bounded])
}
