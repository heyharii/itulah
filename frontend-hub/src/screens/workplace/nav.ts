import { FileText, Files, MessagesSquare } from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// This module's place in the rail and everything under it in the sidebar.
/// Owned by the module, composed by `lib/navigation.ts` — so adding a screen
/// here never touches another module's file.
export const workplaceNav: AppModule = {
  id: "workplace",
  label: "Workplace",
  icon: MessagesSquare,
  tint: { top: "#c3cad6", bottom: "#868f9f" },
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
