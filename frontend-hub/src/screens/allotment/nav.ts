import { Grid3x3, Truck, Undo2 } from "lucide-react"

import type { AppModule } from "@/lib/navigation"
import { useUnfilledCount } from "@/screens/allotment/unfilled-data"

/// Goods promised out of a pool, and where they are promised to.
///
/// # Why this is a row of its own
///
/// It left Inventory because it is not a reading of stock — it is an
/// instruction to move some. Inventory answers *what is held and can the
/// number be trusted*; an allotment answers *what leaves, for whom*. Filing a
/// verb under a module named after a noun is how that sidebar reached eleven
/// rows.
///
/// **And it did not go into Operations, though the picking it creates lives
/// there.** Every screen in that module is wrapped in `OperationsGate` — the
/// DC node's own sign-in — because every one of them reads an edge. An
/// allotment is raised at the centre against the cloud ledger, so filing it
/// there would demand a warehouse login before anybody could read a cloud
/// list. The module's own comment calls the gate "one decision about a whole
/// module", and breaking that to save a sidebar row is the wrong trade.
///
/// One row, not a folder. The composer at `/allotment/new` is a place people
/// ARRIVE at — from the button on the list, or from ⌘K — not a place they set
/// out for, and a module that unfolds into "Allotments · New allotment" spends
/// a chevron and two lines of sidebar saying what one line already said.
///
/// # Why the URL says `allotment` and not `distribution`
///
/// "Distribution" is the name of the department. `ALT-00000412` is the name of
/// the thing, it is what the screen lists, what the button raises and what
/// everybody says out loud — and the module was the only one in the app whose
/// URL named the room rather than the record. `/distribution` is kept in
/// `moved` because it is in people's history and in the links they have sent
/// each other, and a 404 is a worse answer than the screen they wanted.
export const allotmentNav: AppModule = {
  id: "allotment",
  label: "Allotment",
  icon: Truck,
  home: "/allotment",
  moved: ["/distribution"],
  sections: [
    {
      items: [
        {
          path: "/allotment",
          label: "Allotments",
          icon: Truck,
          // Lines the Gudang could not fill, waiting for MD to close short.
          useCount: useUnfilledCount,
          badge: "warn",
        },
        {
          // Owner's menu of 2026-09-28: Merchandise's second primary row from
          // this module, after Articles/Divisions/Tags/Sizes/Colours from
          // `master`. Goods a store sent back to the DC — the mirror of
          // Procurement's "Return to supplier" — pre-filtering the same list
          // to `RETURN_TO_DC`. See `screens/allotment/returns.tsx`.
          path: "/allotment/returns",
          label: "Return to HO",
          icon: Undo2,
        },
        {
          path: "/allotment/new",
          label: "New Allotment",
          icon: Grid3x3,
          hidden: true,
        },
      ],
    },
  ],
}
