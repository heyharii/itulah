import { createFileRoute } from "@tanstack/react-router"

import { PeopleScope } from "@/components/hr/people-scope"

/**
 * A pathless layout over the three apps that read the People register:
 * `/hr-ho`, `/hr-store` and `/finance`. It adds nothing to the URL — those
 * paths are unchanged — and exists only to own `HrProvider`.
 *
 * ## Why this route exists
 *
 * `HrProvider` was mounted in `__root.tsx`, which broke the rule that a
 * domain's context belongs to that domain's subtree (docs/frontend-rules.md
 * §S6) and cost every user real bytes for it: the provider closes over
 * `hr/store.tsx` (~1,400 lines of fixture state) and `hr/data.ts`, and because
 * the root route is in the entry chunk, so were they. All eighteen apps paid
 * to download the People register before painting, and fifteen of them never
 * read it.
 *
 * A layout route fixes both halves at once. The provider is code-split with
 * this route, so it loads when someone opens People or Finance and not before;
 * and because a layout route stays mounted while navigation moves between its
 * children, the store still survives `/hr-ho` → `/finance` the way it did when
 * it lived at the root. That continuity is the reason this is a layout rather
 * than three separate providers: Finance reads `netFor` and `payroll` off the
 * same register Head Office edits, and per-route providers would have shown
 * Finance the seed values while HO held the edits.
 *
 * Those writes are fixtures — nothing here reaches the backend, and everything
 * resets on reload. That is a known limit of the People apps, not something
 * this route changes.
 */
export const Route = createFileRoute("/_people")({
  component: PeopleScope,
})
