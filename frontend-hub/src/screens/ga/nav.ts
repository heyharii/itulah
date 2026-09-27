import { Gauge } from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// Overview — the one GA screen nobody navigates to on purpose.
///
/// # Why it is a screen and not a dashboard of tiles
///
/// Because every row on it is a thing to DO, and each opens the record that
/// raised it. A tile saying "7 expiring contracts" is a number somebody reads
/// and closes; a row saying *CT-004 · Toko C003 · habis 37 hari lagi* is a
/// phone call. The count belongs on the sidebar row, where it is a nudge, and
/// the list belongs here, where it is the work.
///
/// # Why the server decides what is on it
///
/// Because "expires soon" is a business rule and not a rendering choice: a
/// contract carries its own `reminder_days`, a document its own ninety, a
/// service task its own seven. A screen that computed the thresholds would
/// answer differently the day somebody's laptop was in another timezone, and
/// the same question asked from a shop and from head office would have two
/// answers.
///
/// # One section at a time
///
/// The list grows with the estate — contracts, documents, service due, repairs,
/// replacements, supplies — and each section arrives with the table that can
/// answer it. A section with nothing in it is not drawn at all: an empty
/// heading is the screen telling somebody there is nothing wrong when it has
/// not been asked.
export const gaOverviewNav: AppModule = {
  id: "ga-overview",
  label: "Ringkasan",
  icon: Gauge,
  home: "/ga",
  sections: [{ items: [{ path: "/ga", label: "Ringkasan", icon: Gauge }] }],
}
