import { Sparkles } from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// The assistant, as a place.
///
/// **An aside, not a module row.** The module list is a map of what the
/// company does — bought, held, sold, what it cost, who did it — and asking a
/// question is not one of those; it is something you do about all of them.
/// Filed among the modules it would read as a department, which is exactly the
/// mistake "Workplace" made before the strip existed.
///
/// It is also still an `Action` at the top of the sidebar, because ⌘J opens
/// the panel and that is a different act: the panel asks about the screen you
/// are on, this is the screen. Two rows for two things, sharing one
/// conversation.
export const assistantNav: AppModule = {
  id: "assistant",
  label: "Assistant",
  icon: Sparkles,
  home: "/assistant",
  aside: true,
  sections: [
    {
      items: [{ path: "/assistant", label: "Assistant", icon: Sparkles }],
    },
  ],
}
