import type { ScreenMap } from "@/screens/registry"
import { Articles } from "@/screens/master/articles"
import { Colours } from "@/screens/master/colours"
import { NameSuggestions } from "@/screens/master/name-suggestions"
import { NewArticles } from "@/screens/master/new-articles"
import { Divisions, Sizes, Tags } from "@/screens/master/vocabulary"
import { Units } from "@/screens/inventory/units"

/// Master's article screens, reached from Merchandise. The same components:
/// only the path (and so the department the sidebar lights) differs.
export const screens: ScreenMap = {
  "/merchandise": Articles,
  "/merchandise/new-articles": NewArticles,
  "/merchandise/divisions": Divisions,
  "/merchandise/tags": Tags,
  "/merchandise/sizes": Sizes,
  "/merchandise/colours": Colours,
  "/merchandise/name-suggestions": NameSuggestions,
  "/merchandise/units": Units,
}
