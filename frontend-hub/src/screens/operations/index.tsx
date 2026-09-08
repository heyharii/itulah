import type { ScreenMap } from "@/screens/registry"

import { OperationsGate } from "@/screens/operations/gate"

import { screens as despatch } from "@/screens/operations/despatch"
import { screens as intake } from "@/screens/operations/intake"
import { screens as node } from "@/screens/operations/node"
import { screens as packing } from "@/screens/operations/packing"
import { screens as picking } from "@/screens/operations/picking"
import { screens as tagging } from "@/screens/operations/tagging"

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

export const screens: ScreenMap = gated({
  ...intake,
  ...tagging,
  ...picking,
  ...packing,
  ...despatch,
  ...node,
})
