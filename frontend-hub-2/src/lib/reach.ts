import { useQuery } from "@tanstack/react-query"
import type { ReachView } from "@itulah/contract"

import { api } from "@/lib/api"

/// How far the signed-in person reaches — and therefore which face of People
/// they get, and whose list they are reading.
///
/// Ported from `frontend-hub/src/lib/queries/people.ts` and
/// `frontend-hub/src/screens/people/scope.ts`. The reasoning below is theirs
/// and is restated rather than summarised, because every line of it is a
/// decision somebody would otherwise make again from scratch.
///
/// ## One module, two faces
///
/// Store and DC managers do the same HR job as each other — build the roster,
/// see who is in, approve the leave that breaks it, sign the month off — and
/// only their data differs. Head office does a different job: it is the
/// **employer**, and contracts, pay and every rule the places are measured
/// against are its work. So there is one module with two faces rather than two
/// modules, and this file is the one place the face is decided.
///
/// ## The answer is the SERVER's, and it is not a permission
///
/// The rule — head office reaches everywhere, a posting reaches that one place,
/// no posting reaches nothing — is enforced on every route. A browser that
/// re-derived it from `place_id === "ho"` would be a second place it is
/// decided, and the day the two disagreed the screen would be the one that
/// looked right. That is exactly how head office stopped being a pass to every
/// place without anybody noticing; see `domain::employment::reach`.
///
/// Nothing here grants anything. A screen hidden by audience is a convenience;
/// a route refused by the server is the control. A bounded caller who pastes a
/// payroll URL gets the server's refusal, which is the honest answer — and the
/// screens in this module render that refusal rather than pre-empting it.
///
/// ## `null` means "not yet", never "no"
///
/// Every helper below answers `null` while the read is in flight. A caller that
/// read that as "no" would draw the head-office rows and then take them away a
/// moment later, and a menu that removes items teaches people not to trust it.
/// The same goes for the sentence at the top of a bounded list: "every place"
/// printed for a quarter of a second, on a screen that is in fact one shop's,
/// is the wrong half of the truth to guess at.

/// Who a screen is for. Absent means everyone who can see the module.
export type Audience = "employer"

/// The three answers `ReachView.scope` carries.
///
/// The contract types it as `String` — ts-rs cannot narrow a Rust `String` —
/// so the union is restated here, once, rather than each screen comparing
/// against a bare literal and one of them eventually spelling it `ONEPLACE`.
export type Scope = "EVERYWHERE" | "ONE_PLACE" | "NOWHERE"

/// How far this caller reaches, as a query.
///
/// Kept for five minutes, because it changes when somebody is transferred or
/// their rung is changed — twice in a career, not twice in a session — and
/// every screen in the module reads it. A short stale time here would buy
/// nothing and cost a request per navigation.
///
/// It is deliberately not part of the session. A session says who signed in and
/// which rung they hold; where somebody is posted is HR data with a history and
/// an authorising officer behind every change, so a place stamped into the
/// session would be wrong from the transfer until the next sign-in.
export function useReach() {
  return useQuery({
    queryKey: ["people", "reach"] as const,
    queryFn: ({ signal }) =>
      api.get<ReachView>("/api/v1/employees/me/reach", signal),
    staleTime: 5 * 60_000,
  })
}

/// Whether this caller is the **employer** — head office — or one place's
/// manager. `null` while the read is in flight; see the note above.
export function isEmployer(reach: ReachView | undefined): boolean | null {
  if (reach === undefined) return null
  return scopeOf(reach) === "EVERYWHERE"
}

/// The place a bounded caller is posted to, for a screen that has to say whose
/// list this is. `null` for head office, which is not standing in one shop —
/// and `null` while the read is in flight, which is why no screen may print
/// "every place" on the strength of this alone.
///
/// The NAME when the server sent one. `store-01` is an identifier this system
/// files a shop under; `Store 01` is what the shop is called, and an identifier
/// in a sentence is an identifier that has escaped into the interface.
export function boundedTo(reach: ReachView | undefined): string | null {
  if (reach === undefined) return null
  if (scopeOf(reach) !== "ONE_PLACE") return null
  return reach.place_name ?? reach.place_id
}

/// A caller with no open posting at all — a machine account, or a login HR has
/// not finished the paperwork for. Every list route in this module refuses them
/// outright, so a screen that knows this can say why before the refusal lands.
export function reachesNowhere(reach: ReachView | undefined): boolean | null {
  if (reach === undefined) return null
  return scopeOf(reach) === "NOWHERE"
}

/// The sentence a list puts at the top saying WHOSE list it is.
///
/// **This is not decoration, it is the point of the file.** The workforce route
/// is bounded on the server: a supervisor posted to one shop is served that
/// shop and nothing else. A directory that silently showed eight people where
/// the company has ninety would read as a company of eight — and nothing on the
/// page would be wrong, which is what makes it dangerous.
///
/// While the reach is in flight the sentence says so rather than guessing. "Every
/// place you reach", printed for a quarter of a second on a list that is in fact
/// one shop's, is the wrong half of the truth to guess at.
export function whoseList(
  reach: ReachView | undefined,
  wording: {
    /// For head office, which is not standing in one shop.
    readonly everywhere: string
    /// For a bounded caller, given the place's own name.
    readonly at: (place: string) => string
  },
): string {
  if (reach === undefined) return "Working out how far you reach…"
  switch (scopeOf(reach)) {
    case "EVERYWHERE":
      return wording.everywhere
    case "ONE_PLACE":
      // `place_id` cannot in practice be absent for `ONE_PLACE` — the scope is
      // derived from the posting — but the contract types it as nullable and a
      // screen must not print `undefined` if the server ever changes its mind.
      return wording.at(reach.place_name ?? reach.place_id ?? "your place")
    case "NOWHERE":
      return "You have no open posting, so no place's list is yours to read."
  }
}

/// The audience this caller belongs to, for the nav rows that declare one.
export function useAudience(): Audience | null {
  const reach = useReach()
  return isEmployer(reach.data) === true ? "employer" : null
}

function scopeOf(reach: ReachView): Scope {
  switch (reach.scope) {
    case "EVERYWHERE":
    case "ONE_PLACE":
      return reach.scope
    // Anything this client does not recognise is the narrowest reading. A
    // scope nobody here understands must not be the one that opens everything.
    default:
      return "NOWHERE"
  }
}
