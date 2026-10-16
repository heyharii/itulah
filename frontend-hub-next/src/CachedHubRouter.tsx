import { cacheLife, cacheTag } from "next/cache"
import { randomUUID } from "node:crypto"

import { HubRouter } from "./HubRouter"

type InitialVersions = {
  versions: Record<string, string>
  cacheStates: Record<string, string>
}

export async function CachedHubRouter({
  ownerHash,
  scopeKey,
  dataVersionKey,
  initialPath,
  initialVersions,
}: {
  ownerHash: string
  scopeKey: string
  dataVersionKey: string
  initialPath: string
  initialVersions: InitialVersions
}) {
  "use cache"

  // Cache only this rendered client subtree. Auth/session and data freshness
  // are resolved by the request wrapper before this cache is consulted.
  cacheLife("minutes")
  cacheTag(`prototype-hub-render-${ownerHash}`)

  return (
    <div
      data-prototype-component-cache-scope={scopeKey}
      data-prototype-component-cache-version={dataVersionKey}
      data-prototype-component-cache-generated={randomUUID()}
    >
      <HubRouter initialPath={initialPath} initialVersions={initialVersions} />
    </div>
  )
}
