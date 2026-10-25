import { FolderKanban } from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// Projects — a store opening or a renovation, run by GA and capitalised by
/// Finance (owner, 2026-10-25: `project-cip-prototype.html`, A · Tabs).
///
/// One row, `/projects`: the list. A project opens on a page of its own,
/// `/projects/$project`, on tabs — Tasks, Assets, Work, Files — because what
/// it holds are records with sheets of their own, and a sheet holding sheets
/// would be three layers deep before anybody opened a repair. Finance reads the
/// same page from Assets › Projects, with Costs in front.
export const projectsNav: AppModule = {
  id: "projects",
  label: "Projects",
  icon: FolderKanban,
  home: "/projects",
  sections: [
    {
      items: [
        { path: "/projects", label: "Projects", icon: FolderKanban },
        {
          path: "/projects/$project",
          label: "Project",
          icon: FolderKanban,
          hidden: true,
        },
      ],
    },
  ],
}
