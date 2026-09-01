import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
} from "@tanstack/react-router";

import { CountScreen } from "./routes/count";
import { PickScreen } from "./routes/pick";
import { TaggingScreen } from "./routes/tagging";

/// The shell.
///
/// One link per station on the warehouse floor, in the order goods pass
/// through them: what arrived, what needs tagging, what is going out. A person
/// standing at one station should not have to hunt for their own screen.
const rootRoute = createRootRoute({
  component: () => (
    <>
      <nav>
        <Link to="/">Terima &amp; hitung</Link>
        <Link to="/tagging">Tagging</Link>
        <Link to="/pick">Picking</Link>
      </nav>
      <Outlet />
    </>
  ),
});

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: CountScreen }),
  createRoute({ getParentRoute: () => rootRoute, path: "/tagging", component: TaggingScreen }),
  createRoute({ getParentRoute: () => rootRoute, path: "/pick", component: PickScreen }),
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
