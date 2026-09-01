import { Movements } from "@/screens/movements"
import { Password } from "@/screens/password"
import { Queue } from "@/screens/queue"
import { ReceiptScreen } from "@/screens/receipt"
import { Receive } from "@/screens/receive"
import { Reports } from "@/screens/reports"
import { Sell } from "@/screens/sell"
import { Stock } from "@/screens/stock"
import { SyncScreen } from "@/screens/sync"
import { Tender } from "@/screens/tender"
import type { ScreenMap } from "@/screens/registry"

/// Path → screen. `routes.tsx` builds the router from `lib/navigation.ts` and
/// looks each path up here, and it throws at module load if either list has an
/// entry the other does not. Ten screens, ten nav entries, and no placeholders:
/// a tab that opens on "not built yet" in front of a customer is worse than no
/// tab at all.
export const screens: ScreenMap = {
  "/sell": Sell,
  "/sell/tender": Tender,
  "/sell/receipt": ReceiptScreen,
  "/sell/queue": Queue,
  "/receive": Receive,
  "/stock": Stock,
  "/stock/movements": Movements,
  "/reports": Reports,
  "/node/sync": SyncScreen,
  "/node/password": Password,
}
