import { ListChecks, Palette, Shirt, Tags } from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// This module's place in the rail and everything under it in the sidebar.
/// Owned by the module, composed by `lib/navigation.ts` — so adding a screen
/// here never touches another module's file.
///
/// Articles is a module of its own rather than a screen under Procurement, and
/// that placement is the argument: the master product is read by everyone.
/// Procurement mints it, Commercial prices it, Inventory counts it and the shop
/// floor sells it. Filed under any one of them it would read as that one's
/// property, and the other three would keep their own half-copies — which is
/// how the catalogue came to be visible only through a price list in the first
/// place.
///
/// Three entries, and neither of the last two is an afterthought. Colours are a
/// company vocabulary now, not words typed per article, so there has to be
/// somewhere to keep the list itself — a picker with nothing behind it is just
/// free text with extra clicks.
///
/// **Setups moved here from Procurement.** It is the screen where a delivery
/// that arrived without an identity is turned into an article: sizes, colours,
/// a photograph, a code. That is minting the master product, which is this
/// module's whole subject — it sat under Procurement only because the delivery
/// it starts from is a purchase. It still reads purchasing's endpoints
/// (`/api/v1/article-setups` is served there, and the screen keeps importing
/// `queries/procurement`), because where a screen lives and where its data
/// comes from are different questions.
export const articlesNav: AppModule = {
  id: "articles",
  label: "Articles",
  icon: Shirt,
  // Violet: the one hue the rail was not already using. The first draft was
  // amber, which sat a few degrees from another module's tile — and a rail is
  // read by colour before it is read by label, so two tiles that look alike are
  // two tiles nobody can tell apart at a glance.
  tint: { top: "#ce8cff", bottom: "#8e33d6" },
  home: "/articles",
  /// One visible row and two hidden ones, which is what makes the shell draw no
  /// sidebar at all and hand the width back to the page. The three surfaces are
  /// reached by the tab strip inside the screens — the arrangement Procurement
  /// and Commercial already use.
  sections: [
    {
      items: [
        { path: "/articles", label: "Articles", icon: Tags },
        {
          path: "/articles/setups",
          label: "Setups",
          icon: ListChecks,
          hidden: true,
        },
        {
          path: "/articles/colours",
          label: "Colours",
          icon: Palette,
          hidden: true,
        },
      ],
    },
  ],
}
