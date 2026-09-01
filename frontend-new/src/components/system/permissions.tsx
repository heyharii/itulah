/*
 * Permissions — the registered permission catalogue, grouped by module, with
 * the roles that currently hold each one.
 *
 * "Which roles hold this permission" is computed from the roles' own embedded
 * permission lists (which `/v1/permissions/roles` returns in full); cloud-hub
 * has no reverse index route, so this is derived here rather than fetched.
 *
 * The catalogue is much larger than what is actually wired up: 150 permissions
 * are registered and only a handful are attached to any role. That gap is the
 * most useful thing this screen can tell you, so the header states it rather
 * than letting a wall of "no role" rows imply a loading failure.
 */

import { useMemo, useState } from "react"

import { Icon, paths } from "@/components/dashboard/parts"
import { type SystemAccessCatalogue, type SystemPermission } from "@/components/system/api"
import { Count, Empty, Note, SectionLabel } from "@/components/system/parts"
import { VirtualRows } from "@/shared/table"
import { cn } from "@/lib/utils"

const PERMISSION_COLUMNS = "300px 110px minmax(0,1fr) 130px"

/** A role that holds a permission, with the member count shown on its chip. */
interface Holder {
  id: string
  name: string
  users: number
}

/** A module heading (collapsible) or one permission beneath it — flattened so
 *  the virtualizer, which positions by index, can place the heading beside
 *  the rows it introduces rather than nesting them inside it. */
type PermissionFeedEntry =
  | { kind: "module"; moduleKey: string; covered: number; total: number; shut: boolean }
  | { kind: "permission"; permission: SystemPermission; roles: Holder[] }

export function PermissionsScreen({
  catalogue,
  query,
  module,
}: {
  catalogue: SystemAccessCatalogue | undefined
  query: string
  module: string | null
}) {
  const [collapsed, setCollapsed] = useState<string[]>([])

  /** permission code → the roles holding it. */
  const holders = useMemo(() => {
    const index = new Map<string, { id: string; name: string; users: number }[]>()
    for (const role of catalogue?.roles ?? []) {
      for (const code of role.permissionCodes) {
        const entry = { id: role.id, name: role.name, users: role.userCount }
        const list = index.get(code)
        if (list) list.push(entry)
        else index.set(code, [entry])
      }
    }
    return index
  }, [catalogue?.roles])

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const byModule = new Map<string, SystemPermission[]>()
    for (const permission of catalogue?.permissions ?? []) {
      if (module && permission.module !== module) continue
      if (
        needle &&
        !permission.code.toLowerCase().includes(needle) &&
        !permission.description.toLowerCase().includes(needle)
      ) {
        continue
      }
      const list = byModule.get(permission.module)
      if (list) list.push(permission)
      else byModule.set(permission.module, [permission])
    }
    return [...byModule.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [catalogue?.permissions, module, query])

  const total = catalogue?.permissions.length ?? 0
  const wired = holders.size

  const toggleModule = (moduleKey: string) =>
    setCollapsed((all) =>
      all.includes(moduleKey)
        ? all.filter((entry) => entry !== moduleKey)
        : [...all, moduleKey]
    )

  /* One flat list: a virtualizer positions by index, so a module's permission
   * rows have to be entries beside its heading rather than nested inside it. */
  const feed = useMemo<PermissionFeedEntry[]>(
    () =>
      groups.flatMap(([moduleKey, list]): PermissionFeedEntry[] => {
        const shut = collapsed.includes(moduleKey)
        const covered = list.filter(
          (permission) => (holders.get(permission.code)?.length ?? 0) > 0
        )
        const head: PermissionFeedEntry = {
          kind: "module",
          moduleKey,
          covered: covered.length,
          total: list.length,
          shut,
        }
        if (shut) return [head]
        return [
          head,
          ...list.map((permission): PermissionFeedEntry => ({
            kind: "permission",
            permission,
            roles: holders.get(permission.code) ?? [],
          })),
        ]
      }),
    [groups, collapsed, holders]
  )

  if (groups.length === 0) return <Empty>No permission matches that search.</Empty>

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {total > 0 && wired < total && (
        <div className="px-3.5 pt-3.5 pb-1">
          <Note>
            {wired} of {total} registered permissions are attached to at least one role.
            The rest are declared by their modules but authorise nothing on this hub
            yet — that is what the catalogue says, not a gap in this screen.
          </Note>
        </div>
      )}

      <VirtualRows
        rows={feed}
        rowKey={(entry) =>
          entry.kind === "module" ? `module:${entry.moduleKey}` : entry.permission.id
        }
        columns={PERMISSION_COLUMNS}
        rowHeight={(entry) =>
          entry.kind === "module" ? 32 : entry.permission.description ? 44 : 30
        }
        className="min-w-[860px]"
        header={
          <>
            <span className="pl-3.5 text-left">Permission</span>
            <span className="text-left">Action</span>
            <span className="text-left">Held by</span>
            <span className="pr-3.5 text-left">Resource</span>
          </>
        }
        renderRow={(entry) => {
          if (entry.kind === "module") {
            return (
              <span
                role="gridcell"
                style={{ gridColumn: "1 / -1" }}
                className="flex h-full items-center bg-inset px-3.5"
              >
                <button
                  type="button"
                  onClick={() => toggleModule(entry.moduleKey)}
                  className="flex h-8 w-full items-center gap-2 text-left"
                >
                  <Icon
                    path={paths.chevronDown}
                    size={12}
                    width={2.2}
                    className={cn(
                      "shrink-0 text-ink-4 transition-transform duration-200",
                      entry.shut && "-rotate-90"
                    )}
                  />
                  <SectionLabel>{entry.moduleKey}</SectionLabel>
                  <span className="ml-auto">
                    <Count
                      value={`${entry.covered}/${entry.total} held`}
                      className="text-ink-4"
                    />
                  </span>
                </button>
              </span>
            )
          }

          const { permission, roles } = entry
          return (
            <>
              <span role="gridcell" className="truncate py-1.5 pr-3 pl-3.5">
                <span className="block truncate font-mono text-[12px] text-ink">
                  {permission.code}
                </span>
                {permission.description && (
                  <span className="block truncate text-[11px] text-ink-4">
                    {permission.description}
                  </span>
                )}
              </span>
              <span role="gridcell" className="px-3 text-[11.5px] text-ink-3">
                {permission.action}
              </span>
              <span role="gridcell" className="px-3">
                {roles.length === 0 ? (
                  <span className="text-[11.5px] text-ink-4">no role</span>
                ) : (
                  <span className="flex flex-wrap gap-1">
                    {roles.map((role) => (
                      <span
                        key={role.id}
                        title={`${role.users} user${role.users === 1 ? "" : "s"} hold this role`}
                        className="inline-flex h-[18px] items-center gap-1 rounded-[5px] bg-inset px-1.5 text-[10.5px] text-ink-3"
                      >
                        {role.name}
                        <span className="font-mono tabular-nums text-ink-4">
                          {role.users}
                        </span>
                      </span>
                    ))}
                  </span>
                )}
              </span>
              <span role="gridcell" className="truncate px-3 pr-3.5 text-[11px] text-ink-4">
                {permission.resource || "—"}
              </span>
            </>
          )
        }}
      />
    </div>
  )
}
