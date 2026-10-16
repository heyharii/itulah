import { QueryClient, dehydrate } from "@tanstack/react-query"
import { createHash } from "node:crypto"
import { redirect } from "next/navigation"
import { Suspense } from "react"

import { CachedHubRouter } from "../../src/CachedHubRouter"
import { ClientProviders } from "../../src/ClientProviders"
import { HubRouter } from "../../src/HubRouter"
import { LoginDoor } from "../../src/LoginDoor"
import { loadInitialData, requestCookieHeader, sessionContext } from "../../src/server/data"

type PageProps = {
  params: Promise<{ path?: string[] }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default function HubPage(props: PageProps) {
  return (
    <Suspense fallback={<main className="grid min-h-screen place-items-center bg-soft-3 text-ink">Loading workspace…</main>}>
      <AuthenticatedHubPage {...props} />
    </Suspense>
  )
}

async function AuthenticatedHubPage({ params, searchParams }: PageProps) {
  const [{ path = [] }, search] = await Promise.all([params, searchParams])
  const pathname = path.length === 0 ? "/procurement/orders" : `/${path.join("/")}`
  if (path.length === 0) redirect("/procurement/orders")
  if (pathname !== "/procurement/orders" && pathname !== "/operations/intake") {
    redirect("/procurement/orders")
  }

  const cookieHeader = await requestCookieHeader()
  const context = await sessionContext(cookieHeader)
  if (!context) return <LoginDoor />

  const cacheArm = first(search.__cacheArm) === "component" ? "component" : "snapshot-json"
  const routeSearch = { ...search }
  delete routeSearch.__cacheArm
  const initial = await loadInitialData(pathname, routeSearch, cookieHeader, context)
  const queryClient = new QueryClient()
  for (const query of initial.queries) {
    queryClient.setQueryData(query.queryKey, query.data, { updatedAt: query.createdAt })
  }
  const state = dehydrate(queryClient)
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(search)) {
    if (key === "__cacheArm") continue
    if (Array.isArray(value)) value.forEach((item) => query.append(key, item))
    else if (typeof value === "string") query.set(key, value)
  }
  const initialPath = `${pathname}${query.size > 0 ? `?${query.toString()}` : ""}`
  const permissionScope = JSON.stringify({
    tenant: context.node.node_id,
    principal: context.identity.username,
    role: context.identity.role_code,
    roleName: context.identity.role_name,
    sections: [...context.identity.sections].sort(),
    readOnly: context.identity.read_only,
  })
  const scopeKey = createHash("sha256")
    .update(`${context.ownerHash}\n${permissionScope}\n${pathname}\n${query.toString()}`)
    .digest("hex")
  const dataVersionKey = createHash("sha256")
    .update(JSON.stringify(Object.entries(initial.versions).sort(([a], [b]) => a.localeCompare(b))))
    .digest("hex")
  return (
    <div
      data-prototype-cache-arm={cacheArm}
      data-prototype-snapshot-states={JSON.stringify(initial.cacheStates)}
      data-prototype-data-version={dataVersionKey}
    >
      <ClientProviders state={state}>
        {cacheArm === "component" ? (
          <CachedHubRouter
            ownerHash={context.ownerHash}
            scopeKey={scopeKey}
            dataVersionKey={dataVersionKey}
            initialPath={initialPath}
            initialVersions={{ versions: initial.versions, cacheStates: {} }}
          />
        ) : (
          <HubRouter
            initialPath={initialPath}
            initialVersions={{ versions: initial.versions, cacheStates: initial.cacheStates }}
          />
        )}
      </ClientProviders>
    </div>
  )
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}
