import {
  FolderTree,
  PackagePlus,
  Palette,
  Ruler,
  Scale,
  Shirt,
  Tag,
  TextCursorInput,
} from "lucide-react"

import type { AppModule } from "@/lib/navigation"
import { useNewArticlesCount } from "@/screens/master/nav"

/// The article and the words it is described with, again, under Merchandise.
///
/// These are Master's own screens, offered a second time because the people
/// who work on articles open Merchandise, not Master (owner, 2026-10-05: "ada
/// di master, ada di merchandise juga"). The paths are `/merchandise/…`
/// rather than the Master ones for a reason that is not taste: the sidebar
/// lights a department from the URL, and two departments cannot share one
/// path without the second always losing. The screens are the same
/// components, so nothing is built or kept twice; only these rows are.
///
/// Organisation Units, Destinations and Payment templates stay in Master
/// alone — they are not about an article.
export const merchandiseArticlesNav: AppModule = {
  id: "merchandise-articles",
  label: "Articles",
  icon: Shirt,
  home: "/merchandise",
  sections: [
    {
      items: [
        { path: "/merchandise", label: "Articles", icon: Shirt },
        {
          path: "/merchandise/new-articles",
          label: "New Articles",
          icon: PackagePlus,
          useCount: useNewArticlesCount,
          badge: "warn",
        },
      ],
    },
    {
      items: [
        {
          path: "/merchandise/divisions",
          label: "Divisions",
          icon: FolderTree,
        },
        { path: "/merchandise/tags", label: "Tags", icon: Tag },
        { path: "/merchandise/sizes", label: "Sizes", icon: Ruler },
        { path: "/merchandise/colours", label: "Colours", icon: Palette },
        {
          path: "/merchandise/name-suggestions",
          label: "Name Suggestions",
          icon: TextCursorInput,
        },
      ],
    },
    {
      items: [
        {
          path: "/merchandise/units",
          label: "Satuan & Conversions",
          icon: Scale,
        },
      ],
    },
  ],
}
