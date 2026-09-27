import { CalendarClock, Hammer, Repeat, Wrench } from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// Maintenance — keeping the company's things working: the repair that
/// follows a breakdown, and the schedule that tries to prevent one.
///
/// # Why this stands in GA
///
/// The asset's register belongs to two people by design (0070): GA knows
/// where the thing is and whether it works; Finance knows what it is worth.
/// A breakdown sits entirely in the first half — who was sent, what it
/// should cost, when it was fixed — and the money enters only later, when
/// Finance records the bill that points back at the repair. GA never posts
/// a journal; it records the fact and names the KIND of object, and the
/// account comes from Finance's `account_map` by that kind.
///
/// # Perbaikan first, Jadwal second, Replacement third
///
/// Because that is the order of the work: a thing breaks and somebody files
/// the repair; the recurring schedule is the quieter half that exists to
/// make fewer of the first kind; and when the answer is that the thing
/// should not be repaired at all, that is a replacement — a happening on one
/// asset, not a kind of asset. The register all three read is the same table.
export const maintenanceNav: AppModule = {
  id: "maintenance",
  label: "Pemeliharaan",
  icon: Wrench,
  home: "/maintenance",
  sections: [
    {
      items: [
        { path: "/maintenance", label: "Perbaikan", icon: Hammer },
        {
          path: "/maintenance/schedule",
          label: "Jadwal servis",
          icon: CalendarClock,
        },
        {
          path: "/maintenance/replacements",
          label: "Penggantian",
          icon: Repeat,
        },
      ],
    },
  ],
}
