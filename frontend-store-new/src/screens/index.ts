import { Assets } from "@/screens/assets"
import { Catalogue } from "@/screens/catalogue"
import { Expenses } from "@/screens/expenses"
import { HrPeriod } from "@/screens/hr/period"
import { HrRequests } from "@/screens/hr/requests"
import { HrRoster } from "@/screens/hr/roster"
import { HrTeam } from "@/screens/hr/team"
import { HrToday } from "@/screens/hr/today"
import { Movements } from "@/screens/movements"
import { News } from "@/screens/news"
import { Offers } from "@/screens/offers"
import { Password } from "@/screens/password"
import { Product } from "@/screens/product"
import { Queue } from "@/screens/queue"
import { Reconciliation } from "@/screens/reconciliation"
import { ReceiptScreen } from "@/screens/receipt"
import { Receive } from "@/screens/receive"
import { ReturnsScreen } from "@/screens/returns"
import { Reports } from "@/screens/reports"
import { Sales } from "@/screens/sales"
import { Sell } from "@/screens/sell"
import { ShiftScreen } from "@/screens/shift"
import { Stock } from "@/screens/stock"
import { SyncScreen } from "@/screens/sync"
import { Tender } from "@/screens/tender"
import type { ScreenMap } from "@/screens/registry"

/// Path → screen. `routes.tsx` builds the router from `lib/navigation.ts` and
/// looks each path up here, and it throws at module load if either list has an
/// entry the other does not. Eighteen screens, eighteen nav entries, and no
/// placeholders: a tab that opens on "not built yet" in front of a customer is
/// worse than no tab at all.
export const screens: ScreenMap = {
  "/shop/assets": Assets,
  "/shop/news": News,
  "/sell": Sell,
  "/sell/tender": Tender,
  "/sell/receipt": ReceiptScreen,
  "/sell/queue": Queue,
  "/sell/returns": ReturnsScreen,
  "/till/shift": ShiftScreen,
  "/catalogue": Catalogue,
  "/catalogue/product": Product,
  "/catalogue/offers": Offers,
  "/receive": Receive,
  "/stock": Stock,
  "/stock/movements": Movements,
  "/reports": Reports,
  "/money/sales": Sales,
  "/money/reconciliation": Reconciliation,
  "/money/expenses": Expenses,
  // The only screens in this app answered by head office rather than by the
  // node behind the counter. They live in their own folder because they share
  // a gate — a second session, and a scope locked to this node's own site —
  // and because "which server answers this" is the sharpest line in the app.
  "/hr/today": HrToday,
  "/hr/roster": HrRoster,
  "/hr/requests": HrRequests,
  "/hr/team": HrTeam,
  "/hr/period": HrPeriod,
  "/node/sync": SyncScreen,
  "/node/password": Password,
}
