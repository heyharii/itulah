import { createFileRoute, stripSearchParams } from "@tanstack/react-router"
import { zodValidator } from "@tanstack/zod-adapter"
import { z } from "zod"

import { System } from "@/components/system/system"
import { SystemError, SystemPending } from "@/components/system/route-states"
import { systemQueries } from "@/components/system/queries"

/**
 * `screen` is the sidebar selection — the `Screen` union in system.tsx.
 * `query` is the header search, `module` narrows the permission catalogue,
 * `resourceType` narrows the audit trail, and `systemOnly` filters the role
 * list. Every one of them decides what is on screen, so every one of them is
 * in the address; each is absent from the URL at its default value.
 */
const searchSchema = z.object({
  screen: z.enum(["users", "roles", "permissions", "audit"]).default("users"),
  query: z.string().optional(),
  module: z.string().optional(),
  resourceType: z.string().optional(),
  systemOnly: z.boolean().optional(),
})

export type SystemSearch = z.infer<typeof searchSchema>

/** A bare `/system` is the user list — which is what this schema's own note already promised. Defaults are stripped so it stays that way. */
const SEARCH_DEFAULTS: Partial<SystemSearch> = {
  screen: "users",
}

export const Route = createFileRoute("/system")({
  validateSearch: zodValidator(searchSchema),
  search: { middlewares: [stripSearchParams(SEARCH_DEFAULTS)] },

  /**
   * Neither query is scoped by a search param — the module/resourceType/query
   * filters all narrow client-side over data already in the cache — so
   * there is no `loaderDeps`.
   *
   * The access catalogue is the critical query: it is what the default
   * "users" screen renders, and every other screen's rail count also reads
   * it. The audit trail is its own tab and owns its own loading state, so it
   * is fired during navigation but not awaited.
   */
  loader: async ({ context: { queryClient } }) => {
    void queryClient.query(systemQueries.auditTrail()).catch(() => {})
    await queryClient.query({
      ...systemQueries.accessCatalogue(),
      staleTime: "static",
    })
  },

  component: System,
  pendingComponent: SystemPending,
  errorComponent: SystemError,
})
