import { Coins, PieChart, ScrollText, Users } from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// The people who buy, as opposed to the people who work here.
///
/// **Why this is not a tab under Store Ops.** Store Ops is about a shop's day:
/// its takings, its shifts, its returns. A member outlives all of that — they
/// were enrolled at one till, they buy at another, and the question asked of
/// them ("who has stopped coming in") is asked across the estate and across
/// years. Filed under one shop's day, that question has nowhere to live.
///
/// **Why it is not under People.** People is employment — contracts, shifts,
/// attendance, payroll. The two modules share nothing but the word "person",
/// and one list mixing staff with shoppers is the sort of thing that ends with
/// a cashier appearing in a marketing segment.
///
/// **Members → Segments**, in that order, because the directory is the fact and
/// the segmentation is a reading of it. Segments is derived from exactly the
/// rows the first screen lists, so opening it second is opening the summary of
/// what you just saw — and every count on it links back into a filtered
/// directory, which is what makes the arithmetic checkable rather than
/// asserted.
///
/// **Points arrived 2026-09-13**, by the owner's ruling that loyalty belongs to
/// the customer and not to Commercial. A point is a liability the business owes
/// a member; everything in Commercial is what something costs. Filing points
/// beside pricing is how an obligation comes to be read as a discount.
///
/// Two rows and not one, for the reason a bank statement is not a balance:
/// **Points** is what each member holds now, **Points Ledger** is every
/// movement that got them there. One screen showing both would have to choose
/// which of the two it is the source of truth for, and the answer — the ledger,
/// always — is exactly what a balance-shaped screen hides.
///
/// Both are routed and neither is written: there is no points endpoint at the
/// centre yet, so they render `Placeholder` on purpose rather than being left
/// out and forgotten.
export const membersNav: AppModule = {
  id: "members",
  label: "Members",
  icon: Users,
  home: "/members",
  sections: [
    {
      items: [
        { path: "/members", label: "Members", icon: Users },
        { path: "/members/segments", label: "Segments", icon: PieChart },
        { path: "/members/points", label: "Points", icon: Coins },
        {
          path: "/members/points-ledger",
          label: "Points Ledger",
          icon: ScrollText,
        },
      ],
    },
  ],
}
