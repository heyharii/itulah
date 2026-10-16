import type { QueryClient } from "@tanstack/react-query"

import { cacheKey } from "@/lib/api"
import { warmQuery, type PrefetchMap } from "@/lib/prefetch"
import {
  assetsQuery,
  contractTypesQuery,
  placeQuery,
  repairsQuery,
  suppliesQuery,
  tasksQuery,
} from "@/lib/queries/ga"
import { relayedUnit, relayReady, teamQuery } from "@/lib/queries/hr"
import type { NodeIdentity } from "@itulah/contract/client"

/// What each General affairs screen asks first, before it is open
/// (`lib/prefetch.ts`). The options are the screens' own
/// (`lib/queries/ga.ts`).
///
/// Answered by head office through the node's relay, so none of it is warmed
/// while idle (there is no `warm` here). The screens open behind the gate
/// (`GaScreen`): this node's own site, and somebody it can relay for. The shop
/// is the one the node says it is, read from the cache the shell already
/// filled; with no answer yet there is nothing to ask for.
///
/// Left to the screen: the repair composer's reads (the register, the place,
/// the repair objects) and the supply composer's categories. They belong to a
/// sheet that is closed when the screen opens, and the register is a page of up
/// to a thousand rows.

function siteOf(client: QueryClient): string | null {
  const where = client.getQueryData<NodeIdentity | null>(cacheKey.identity())
  return where?.site_id ?? null
}

/// Ask for this shop's reads. The team comes with them, as it does on the
/// screen: it is how a card turns a login into a name.
async function inShop(
  client: QueryClient,
  ask: (site: string) => Promise<unknown>,
) {
  const site = siteOf(client)
  if (site === null || !relayReady(client)) return
  await Promise.all([
    ask(site),
    relayedUnit(client).then((unit) =>
      unit === null ? undefined : warmQuery(client, teamQuery(unit)),
    ),
  ])
}

export const prefetch: PrefetchMap = {
  // Overview: the place, and the three lists its figures count.
  "/ga": (client) =>
    inShop(client, (site) =>
      Promise.all([
        warmQuery(client, placeQuery(site)),
        warmQuery(client, repairsQuery(site)),
        warmQuery(client, tasksQuery(site)),
        warmQuery(client, suppliesQuery(site)),
      ]),
    ),
  "/ga/assets": (client) =>
    inShop(client, (site) => warmQuery(client, assetsQuery(site))),
  // Contracts: the place's contracts ride on its hub, and the types name them.
  "/ga/contracts": (client) =>
    inShop(client, (site) =>
      Promise.all([
        warmQuery(client, placeQuery(site)),
        warmQuery(client, contractTypesQuery(site)),
      ]),
    ),
  "/ga/servicing": (client) =>
    inShop(client, (site) => warmQuery(client, tasksQuery(site))),
  "/ga/repairs": (client) =>
    inShop(client, (site) => warmQuery(client, repairsQuery(site))),
  "/ga/supplies": (client) =>
    inShop(client, (site) => warmQuery(client, suppliesQuery(site))),
}
