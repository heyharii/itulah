import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
} from "@tanstack/react-router";

// Fonts first: retail.css names them, and a face that arrives after the
// stylesheet that asks for it makes the page reflow once in front of the
// reader. Vendored, never fetched — a shop may have no internet.
import "@itulah/skin/fonts.css";
import "@itulah/skin/retail.css";
import "./skin.css";

import { OffersScreen } from "./routes/offers";
import { PublicationsScreen } from "./routes/publications";
import { SetupScreen } from "./routes/setup";
import { SourcingScreen } from "./routes/sourcing";
import { SuppliersScreen } from "./routes/suppliers";

/// The centre's shell.
///
/// Grouped the way the work actually runs: first find and buy, then decide
/// what arrived is and what it costs. A person doing one of those should not
/// have to read past the other.
const rootRoute = createRootRoute({
  component: () => (
    <div className="window">
      <nav className="side" aria-label="Navigasi utama">
        <div className="grp">Pengadaan</div>
        <Link to="/">Sourcing</Link>
        <Link to="/pemasok">Pemasok</Link>
        <div className="grp">Barang &amp; harga</div>
        <Link to="/barang-baru">Barang baru</Link>
        <Link to="/harga">Buku harga</Link>
        <Link to="/toko">Harga per toko</Link>
      </nav>
      <Outlet />
    </div>
  ),
});

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: SourcingScreen }),
  createRoute({ getParentRoute: () => rootRoute, path: "/pemasok", component: SuppliersScreen }),
  createRoute({ getParentRoute: () => rootRoute, path: "/barang-baru", component: SetupScreen }),
  createRoute({ getParentRoute: () => rootRoute, path: "/harga", component: PublicationsScreen }),
  createRoute({ getParentRoute: () => rootRoute, path: "/toko", component: OffersScreen }),
]);

export const router = createRouter({
  routeTree,
  // Hash routing: the binary hands out a directory, not an application that
  // knows these paths.
  history: createHashHistory(),
  defaultPreload: false,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
