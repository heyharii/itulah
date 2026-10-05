import { CalendarClock, Hammer, Repeat } from "lucide-react"

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
/// # Two modules of one row each
///
/// Repairs and the service schedule are different work over different tables
/// — a breakdown somebody filed, and the recurring care that exists to make
/// fewer of them — so each keeps its row. They are declared as two one-row
/// modules rather than one module with two rows because GA is drawn as one
/// flat list (owner, 2026-09-27): a module with two rows would bring its
/// heading back, and a heading over two rows is the clutter that was removed.
///
/// Replacements are the third screen, and not a row: a replacement is the
/// answer "do not repair it" on one asset, proposed from that asset's sheet,
/// rare, and already listed on the GA overview while it runs. Its row lights
/// Repairs, the work it grew out of.
export const maintenanceNav: AppModule = {
  id: "maintenance",
  label: "Repairs",
  icon: Hammer,
  home: "/maintenance",
  sections: [
    {
      items: [
        {
          path: "/maintenance",
          label: "Repairs",
          icon: Hammer,
          alsoLights: ["/maintenance/replacements"],
        },
        {
          path: "/maintenance/replacements",
          label: "Replacements",
          icon: Repeat,
          hidden: true,
        },
      ],
    },
  ],
}

/// The service schedule and the inspections that come out of it. Its own
/// module for the reason above; `moduleForPath` picks it for its own path
/// because its home is the longer match.
export const serviceScheduleNav: AppModule = {
  id: "maintenance-schedule",
  label: "Service Schedule",
  icon: CalendarClock,
  home: "/maintenance/schedule",
  sections: [
    {
      items: [
        {
          path: "/maintenance/schedule",
          label: "Service Schedule",
          icon: CalendarClock,
        },
      ],
    },
  ],
}
