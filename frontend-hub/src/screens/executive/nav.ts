import {
  Boxes,
  LayoutDashboard,
  Megaphone,
  Store,
  Users,
  Wallet,
} from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// The executive report: the whole business on six pages, read over one period
/// and one shop at a time.
///
/// Its own chip on the rail, first of all (owner, 2026-09-25), rather than a
/// kept report under Reports: it is the page a director opens every morning,
/// not a query somebody composed once. Every figure on it is a read the rest of
/// the app already serves — sales series, the layered P&L, cash, payables, the
/// fleet's pools, the order book, the workforce, GA — so it adds no endpoint
/// and can never disagree with the screen a figure came from.
export const executiveNav: AppModule = {
  id: "executive",
  label: "Executive",
  icon: LayoutDashboard,
  home: "/executive",
  sections: [
    {
      items: [
        { path: "/executive", label: "Ringkasan", icon: LayoutDashboard },
        { path: "/executive/stores", label: "Kinerja toko", icon: Store },
        { path: "/executive/stock", label: "Barang & pembelian", icon: Boxes },
        { path: "/executive/finance", label: "Kas & laba", icon: Wallet },
        {
          path: "/executive/customers",
          label: "Pelanggan & promosi",
          icon: Megaphone,
        },
        { path: "/executive/people", label: "Tim & aset", icon: Users },
      ],
    },
  ],
}
