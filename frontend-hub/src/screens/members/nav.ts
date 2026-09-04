import { PieChart, Users } from "lucide-react"

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
      ],
    },
  ],
}
