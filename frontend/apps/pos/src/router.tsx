import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";

import { CatalogScreen } from "./routes/catalog";
import { SellScreen } from "./routes/sell";

/// The shell every screen sits in.
///
/// Deliberately thin. A till is one job at a time — a cashier is either ringing
/// up a basket or looking something up, never both — so navigation is two
/// links, not a menu.
const rootRoute = createRootRoute({
  component: Shell,
});

function Shell() {
  const path = useRouterState({ select: (state) => state.location.pathname });
  return (
    <>
      <nav>
        <Link to="/" aria-current={path === "/" ? "page" : undefined}>
          Jual
        </Link>
        <Link to="/katalog" aria-current={path === "/katalog" ? "page" : undefined}>
          Katalog
        </Link>
      </nav>
      <Outlet />
    </>
  );
}

const sellRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: SellScreen,
});

const catalogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/katalog",
  component: CatalogScreen,
});

const routeTree = rootRoute.addChildren([sellRoute, catalogRoute]);

export const router = createRouter({
  routeTree,
  // Hash routing, because the till is served as plain files.
  //
  // The shop's binary hands out a directory; a browser asked for `/katalog`
  // would ask it for a file of that name and be told there is none. Keeping
  // every screen behind `#/` means navigation never depends on the server
  // knowing the app's routes — and the server keeps serving files, which is
  // all it was ever asked to do.
  history: createHashHistory(),
  // Nothing is preloaded. A till is on a local network with a handful of
  // screens; spending a request to guess where the cashier is going next buys
  // nothing and can only get in the way of the one they are on.
  defaultPreload: false,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
