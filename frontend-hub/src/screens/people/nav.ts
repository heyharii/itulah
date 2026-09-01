import { CalendarClock, Users } from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// This module's place in the rail and everything under it in the sidebar.
/// Owned by the module, composed by `lib/navigation.ts` — so adding a screen
/// here never touches another module's file.
export const peopleNav: AppModule = {
  id: "people",
  label: "People",
  icon: Users,
  mesh: { c1: "#ffc2a2", c2: "#ffadad", c3: "#ec7d4d", base: "#f08a5d" },
  home: "/people",
  sections: [
    {
      items: [
        { path: "/people", label: "Directory", icon: Users },
        {
          path: "/people/attendance",
          label: "Attendance policy",
          icon: CalendarClock,
        },
      ],
    },
  ],
}
