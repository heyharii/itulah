import { FileText, Files, MessagesSquare } from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// This module's place in the rail and everything under it in the sidebar.
/// Owned by the module, composed by `lib/navigation.ts` — so adding a screen
/// here never touches another module's file.
export const workplaceNav: AppModule = {
  id: "workplace",
  label: "Workplace",
  icon: MessagesSquare,
  mesh: { c1: "#d1d9e3", c2: "#cbd3df", c3: "#8d97a8", base: "#9aa3b2" },
  home: "/workplace",
  sections: [
    {
      items: [
        { path: "/workplace", label: "Discussions", icon: MessagesSquare },
        { path: "/workplace/chat", label: "Chat", icon: MessagesSquare },
        { path: "/workplace/files", label: "Files", icon: Files },
        { path: "/workplace/documents", label: "Documents", icon: FileText },
      ],
    },
  ],
}
