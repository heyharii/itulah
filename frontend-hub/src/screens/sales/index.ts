import type { ScreenMap } from "@/screens/registry"
import { SalesAnalytics } from "@/screens/sales/analytics"
import {
  SalesByArticle,
  SalesByCampaign,
  SalesByDivision,
  SalesByPayment,
  SalesByPo,
  SalesBySession,
  SalesBySku,
  SalesByStore,
  SalesBySupplier,
  SalesByTag,
} from "@/screens/sales/breakdown"
import { Member } from "@/screens/sales/customer"
import { SalesExplorer } from "@/screens/sales/explorer"
import { Overview } from "@/screens/sales/overview"
import { Returns } from "@/screens/sales/returns"
import { Sales } from "@/screens/sales/sales"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
///
/// Six of these arrived from Store ops on 2026-09-13 when that module was
/// absorbed — see `nav.ts` for why.
export const screens: ScreenMap = {
  "/sales": Sales,
  "/sales/explorer": SalesExplorer,
  "/sales/analytics": SalesAnalytics,
  "/sales/by-store": SalesByStore,
  "/sales/by-division": SalesByDivision,
  "/sales/by-tag": SalesByTag,
  "/sales/by-article": SalesByArticle,
  "/sales/by-sku": SalesBySku,
  "/sales/by-po": SalesByPo,
  "/sales/by-supplier": SalesBySupplier,
  "/sales/by-campaign": SalesByCampaign,
  "/sales/by-payment": SalesByPayment,
  "/sales/by-session": SalesBySession,
  "/sales/returns": Returns,
  "/sales/customer": Member,
  "/sales/overview": Overview,
}
