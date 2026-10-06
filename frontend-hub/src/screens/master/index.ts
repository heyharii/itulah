import type { ScreenMap } from "@/screens/registry"
import { Articles } from "@/screens/master/articles"
import { Colours } from "@/screens/master/colours"
import { NameSuggestions } from "@/screens/master/name-suggestions"
import { NewArticles } from "@/screens/master/new-articles"
import { PaymentTemplates } from "@/screens/master/payment-templates"
import { Divisions, Sizes, Tags } from "@/screens/master/vocabulary"
import { Destinations } from "@/screens/procurement/destinations"
import { SuppliersGate } from "@/screens/procurement/offline-suppliers"
import { Units } from "@/screens/inventory/units"
import { Organisation } from "@/screens/system/organisation"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
///
/// New articles is its own page since 2026-10-02: the work area itself,
/// `SetupWorkspace` in `procurement/setups.tsx`.
///
/// Each module owns this file alone, so two modules being built at once never
/// touch the same registry.
export const screens: ScreenMap = {
  "/master": Articles,
  "/master/new-articles": NewArticles,
  // Units is written in `inventory/`: one move of the MENU is not a reason to
  // move the code; only the path and the nav row belong to this module.
  "/master/organisation": Organisation,
  "/master/units": Units,
  "/master/destinations": Destinations,
  // The supplier book, as Procurement has it: one screen, two paths.
  "/master/suppliers": SuppliersGate,
  "/master/divisions": Divisions,
  "/master/colours": Colours,
  "/master/name-suggestions": NameSuggestions,
  "/master/sizes": Sizes,
  "/master/tags": Tags,
  "/master/payment-templates": PaymentTemplates,
}
