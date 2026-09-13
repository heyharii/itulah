import type { Audience } from "@/lib/navigation"
import { employerScope, useReach } from "@/lib/queries/people"

/// Which face of People this caller gets.
///
/// Store and DC managers do the same HR job as each other — build the roster,
/// see who is in, approve the leave that breaks it, sign off the month — and
/// only their data differs. Head office does a different job: it is the
/// **employer**, and contracts, pay and every rule the places are measured
/// against are its work. So there is one module with two faces rather than two
/// modules, and this is the one place the face is decided.
///
/// The answer comes from the server, which resolves it from the caller's rung
/// and their own posting: the Admin rung reaches every place, any posting
/// reaches that one place, and no posting reaches nothing. Deriving it here
/// from `place_id === "ho"` would put the rule in two files, and the day they
/// disagreed the sidebar would be the one that looked right — which is exactly
/// how head office stopped being a pass to every place without this file
/// noticing. See `domain::employment::reach`: head office employs buyers and
/// finance staff too, so the building is not the credential.
///
/// `null` while the read is in flight. The sidebar treats that as "not yet"
/// rather than as "no", so the head-office rows arrive a moment after the menu
/// rather than being drawn and then taken away.
///
/// **Nothing here is a permission.** Every route re-checks the rung and the
/// reach; this only decides which rows are worth offering. A place manager who
/// pastes a payroll URL gets the server's refusal, which is the honest answer.
export function usePeopleAudience(): Audience | null {
  const reach = useReach()
  const employer = employerScope(reach.data)
  if (employer === null) return null
  return employer ? "employer" : null
}
