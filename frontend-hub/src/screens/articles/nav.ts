import { Palette, Shirt, Tags } from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// This module's row in the sidebar and the sub-items under it.
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
/// **Setups moved here from Procurement**, and then stopped being a screen at
/// all. Turning a delivery that arrived without an identity into an article —
/// sizes, colours, a photograph, a code — is minting the master product, which
/// is this module's whole subject; it sat under Procurement only because the
/// delivery it starts from is a purchase. It still reads purchasing's endpoints
/// (`/api/v1/article-setups` is served there, and the sheets keep importing
/// `queries/procurement`), because where something lives and where its data
/// comes from are different questions.
export const articlesNav: AppModule = {
  id: "articles",
  label: "Articles",
  icon: Shirt,
  home: "/articles",
  /// Two: what exists, and the vocabulary it is described with.
  ///
  /// Giving a delivery an identity is not a third one. It is done to a single
  /// delivery that arrived without one, which makes it an action over this
  /// list rather than a place beside it — a trigger on `/articles` opening a
  /// queue sheet, then the setup form. See `SetupSheets` in `setups.tsx`.
  sections: [
    {
      items: [
        { path: "/articles", label: "Articles", icon: Tags },
        { path: "/articles/colours", label: "Colours", icon: Palette },
      ],
    },
  ],
}
