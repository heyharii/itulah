import type { ScreenMap } from "@/screens/registry"

import { OperationsGate } from "@/screens/operations/gate"

import { screens as activity } from "@/screens/operations/activity"
import { screens as articles } from "@/screens/operations/articles"
import { screens as board } from "@/screens/operations/board"
import { screens as count } from "@/screens/operations/count"
import { screens as despatch } from "@/screens/operations/despatch"
import { screens as intake } from "@/screens/operations/intake"
import { screens as ledger } from "@/screens/operations/ledger"
import { screens as node } from "@/screens/operations/node"
import { screens as packing } from "@/screens/operations/packing"
import { screens as picking } from "@/screens/operations/picking"
import { screens as stock } from "@/screens/operations/stock"
import { screens as tagging } from "@/screens/operations/tagging"
import { screens as quantityChecks } from "@/screens/operations/quantity-checks"
import { screens as workload } from "@/screens/operations/workload"

/// The module's screens, gathered from its six stations.
///
/// A layer the other modules do not have, because this module is the only one
/// with sub-folders: the stations were separate apps' worth of screens before
/// they were sections of one module, and each still owns its own map. Merging
/// happens here so `routes.tsx` spreads one thing per module, exactly as it
/// does for the rest.
/// Behind the node's own sign-in, all of them.
///
/// Wrapped here rather than screen by screen: it is one decision about a whole
/// module, and fourteen screens each remembering to make it is fourteen
/// chances for one of them to forget — which would not look like a bug, it
/// would look like an empty warehouse.
function gated(screens: ScreenMap): ScreenMap {
  return Object.fromEntries(
    Object.entries(screens).map(([path, Screen]) => [
      path,
      // `<Screen />` and not `Screen()`. Calling it runs the screen's hooks
      // inside this wrapper's own render, so every query on the page fires
      // before the gate has decided anything — fourteen screens' worth of
      // requests to a node nobody is signed in to, answered 401. As an element
      // it is a child React only mounts if the gate returns it.
      () => (
        <OperationsGate>
          <Screen />
        </OperationsGate>
      ),
    ])
  )
}

export const screens: ScreenMap = {
  // Stock reads the CLOUD — `fleetPools`, the purchase and allotment books —
  // not the DC edge node, so it sits outside `gated()`: the one Operations
  // screen nobody needs a warehouse sign-in to open.
  ...stock,
  ...articles,
  // Quantity checks read and write the cloud, like Stock — no warehouse
  // sign-in is needed to answer one.
  ...quantityChecks,
  ...gated({
    ...activity,
    ...intake,
    ...tagging,
    ...board,
    ...picking,
    ...packing,
    ...despatch,
    ...node,
    ...count,
    ...ledger,
    ...workload,
  }),
}
