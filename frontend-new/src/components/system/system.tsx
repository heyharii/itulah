/*
 * System — access control: users, roles, permissions and the audit trail.
 *
 * One sidebar over four screens, all reading the same two resources so the
 * counts in the rail always agree with the tables: `useAccessCatalogue` (the
 * 23 roles with their permissions, the 150-permission catalogue, and the user
 * list that role membership implies) and `useAuditTrail`.
 *
 * The user list is derived, not fetched — cloud-hub publishes no user directory
 * to an API-key caller. See the header of `api.ts`.
 */

import { useMemo, useState } from "react"
import { Link } from "@tanstack/react-router"

import { Icon, paths } from "@/components/dashboard/parts"
import { IconButton } from "@/components/dashboard/nav-sidebar"
import { AppHeading } from "@/components/app-switcher"
import { UsersScreen } from "@/components/system/accounts"
import { AuditScreen } from "@/components/system/audit"
import { PermissionsScreen } from "@/components/system/permissions"
import { RolesScreen } from "@/components/system/roles"
import { useAccessCatalogue, useAuditTrail } from "@/components/system/api"
import { cn } from "@/lib/utils"
import { Route } from "@/routes/system"
import {
  AppShell,
  AppShellSidebar,
  SidebarTrigger,
} from "@/components/app-shell"

type Screen = "users" | "roles" | "permissions" | "audit"

const SCREENS: {
  id: Screen
  label: string
  icon: React.ReactNode
  hint: string
}[] = [
  {
    id: "users",
    label: "Users",
    icon: paths.people,
    hint: "Who holds which role",
  },
  {
    id: "roles",
    label: "Roles",
    icon: paths.workspace,
    hint: "Permission sets",
  },
  {
    id: "permissions",
    label: "Permissions",
    icon: paths.list,
    hint: "The permission catalogue",
  },
  {
    id: "audit",
    label: "Audit log",
    icon: paths.clock,
    hint: "What the platform recorded",
  },
]

const PLACEHOLDER: Record<Screen, string> = {
  users: "User id or role",
  roles: "Role name or code",
  permissions: "Permission code or description",
  audit: "Action, resource or actor",
}

export function System() {
  const catalogue = useAccessCatalogue()
  const audit = useAuditTrail()
  const { screen, module, resourceType } = Route.useSearch()
  const query = Route.useSearch({ select: (search) => search.query ?? "" })
  const systemOnly = Route.useSearch({
    select: (search) => search.systemOnly ?? false,
  })
  const navigate = Route.useNavigate()

  const [railHidden, setRailHidden] = useState(false)

  const permissions = useMemo(
    () => catalogue.data?.permissions ?? [],
    [catalogue.data?.permissions]
  )
  const roles = useMemo(
    () => catalogue.data?.roles ?? [],
    [catalogue.data?.roles]
  )
  const users = useMemo(
    () => catalogue.data?.users ?? [],
    [catalogue.data?.users]
  )
  const events = useMemo(() => audit.data?.events ?? [], [audit.data?.events])
  const auditTotal = audit.data?.total ?? events.length

  const modules = useMemo(() => {
    const counts = new Map<string, number>()
    for (const permission of permissions) {
      counts.set(permission.module, (counts.get(permission.module) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [permissions])

  const resourceTypes = useMemo(() => {
    const counts = new Map<string, number>()
    for (const event of events) {
      counts.set(event.resourceType, (counts.get(event.resourceType) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [events])

  const systemRoles = roles.filter((role) => role.isSystem).length

  const loading = catalogue.isLoading || audit.isLoading
  const failure = catalogue.errorMessage ?? audit.errorMessage ?? undefined

  const subtitle = (() => {
    if (loading && !catalogue.data) return "Reading the access control plane…"
    if (screen === "users") {
      return `${users.length} users · derived from role membership`
    }
    if (screen === "roles") {
      const held = roles.reduce((sum, role) => sum + role.permissionCount, 0)
      return `${roles.length} roles · ${held} role-permission links`
    }
    if (screen === "permissions") {
      const covered = new Set(roles.flatMap((role) => role.permissionCodes))
        .size
      return `${permissions.length} permissions in the catalogue · ${covered} held by a role`
    }
    const shown = events.length
    return shown === auditTotal
      ? `${shown} audit entries · newest first`
      : `${shown} of ${auditTotal} audit entries · newest first`
  })()

  const navRow =
    "flex h-8 w-full items-center gap-2.5 rounded-control px-2 text-left text-[13px] font-medium transition-colors duration-[110ms]"

  return (
    <AppShell
      label="System navigation"
      railWidth={240}
      cols={
        railHidden
          ? "grid-cols-[0px_minmax(0,1fr)]"
          : "grid-cols-[240px_minmax(0,1fr)]"
      }
    >
      <AppShellSidebar className={cn(railHidden && "invisible")}>
        <aside className="flex h-full min-h-0 flex-col overflow-hidden bg-page">
          <div className="flex h-[52px] shrink-0 items-center gap-1.5 pr-2 pl-2.5">
            <AppHeading app="system" />
            <IconButton
              label="Collapse sidebar"
              onClick={() => setRailHidden((value) => !value)}
            >
              <Icon path={paths.panel} size={17} />
            </IconButton>
          </div>

          <nav className="flex-1 overflow-auto px-2 pt-0.5 pb-2">
            {SCREENS.map((entry) => {
              const on = screen === entry.id
              const count =
                entry.id === "users"
                  ? users.length
                  : entry.id === "roles"
                    ? roles.length
                    : entry.id === "permissions"
                      ? permissions.length
                      : auditTotal
              return (
                <Link
                  key={entry.id}
                  from="/system"
                  to="/system"
                  replace
                  title={entry.hint}
                  search={() => ({ screen: entry.id })}
                  className={cn(
                    navRow,
                    "text-ink-2 hover:bg-hover hover:text-ink",
                    on && "bg-hover font-semibold text-ink"
                  )}
                >
                  <Icon path={entry.icon} className="shrink-0 text-ink-4" />
                  {entry.label}
                  <span className="ml-auto font-mono text-[10.5px] text-ink-4 tabular-nums">
                    {count}
                  </span>
                </Link>
              )
            })}

            {screen === "permissions" && (
              <>
                <div className="mt-3.5 flex h-7 items-center px-2">
                  <span className="text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
                    Modules
                  </span>
                </div>
                <Link
                  from="/system"
                  to="/system"
                  replace
                  search={(prev) => ({ ...prev, module: undefined })}
                  className={cn(
                    navRow,
                    "text-ink-2 hover:bg-hover hover:text-ink",
                    !module && "bg-hover font-semibold text-ink"
                  )}
                >
                  <span className="truncate">All modules</span>
                  <span className="ml-auto font-mono text-[10.5px] text-ink-4 tabular-nums">
                    {permissions.length}
                  </span>
                </Link>
                {modules.map(([name, count]) => (
                  <Link
                    key={name}
                    from="/system"
                    to="/system"
                    replace
                    search={(prev) => ({
                      ...prev,
                      module: prev.module === name ? undefined : name,
                    })}
                    className={cn(
                      navRow,
                      "text-ink-2 hover:bg-hover hover:text-ink",
                      module === name && "bg-hover font-semibold text-ink"
                    )}
                  >
                    <span className="truncate">{name}</span>
                    <span className="ml-auto font-mono text-[10.5px] text-ink-4 tabular-nums">
                      {count}
                    </span>
                  </Link>
                ))}
              </>
            )}

            {screen === "audit" && (
              <>
                <div className="mt-3.5 flex h-7 items-center px-2">
                  <span className="text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
                    Resource
                  </span>
                </div>
                <Link
                  from="/system"
                  to="/system"
                  replace
                  search={(prev) => ({ ...prev, resourceType: undefined })}
                  className={cn(
                    navRow,
                    "text-ink-2 hover:bg-hover hover:text-ink",
                    !resourceType && "bg-hover font-semibold text-ink"
                  )}
                >
                  <span className="truncate">Everything</span>
                  <span className="ml-auto font-mono text-[10.5px] text-ink-4 tabular-nums">
                    {events.length}
                  </span>
                </Link>
                {resourceTypes.map(([name, count]) => (
                  <Link
                    key={name}
                    from="/system"
                    to="/system"
                    replace
                    search={(prev) => ({
                      ...prev,
                      resourceType:
                        prev.resourceType === name ? undefined : name,
                    })}
                    className={cn(
                      navRow,
                      "text-ink-2 hover:bg-hover hover:text-ink",
                      resourceType === name && "bg-hover font-semibold text-ink"
                    )}
                  >
                    <span className="truncate">{name}</span>
                    <span className="ml-auto font-mono text-[10.5px] text-ink-4 tabular-nums">
                      {count}
                    </span>
                  </Link>
                ))}
              </>
            )}

            {screen === "roles" && (
              <>
                <div className="mt-3.5 flex h-7 items-center px-2">
                  <span className="text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
                    Filter
                  </span>
                </div>
                <Link
                  from="/system"
                  to="/system"
                  replace
                  search={(prev) => ({
                    ...prev,
                    systemOnly: prev.systemOnly ? undefined : true,
                  })}
                  className={cn(
                    navRow,
                    "text-ink-2 hover:bg-hover hover:text-ink",
                    systemOnly && "bg-hover font-semibold text-ink"
                  )}
                >
                  <span className="truncate">System roles only</span>
                  <span className="ml-auto font-mono text-[10.5px] text-ink-4 tabular-nums">
                    {systemRoles}
                  </span>
                </Link>
              </>
            )}
          </nav>
        </aside>
      </AppShellSidebar>

      <main className="flex h-full min-h-0 flex-col overflow-hidden p-2 pl-0 max-lg:pl-2">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-window bg-surface shadow-card">
          <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-3.5">
            <SidebarTrigger className="-ml-1" />
            <span className="text-sm font-semibold text-ink">
              {SCREENS.find((entry) => entry.id === screen)?.label}
            </span>
            <span className="ml-2 truncate text-[11.5px] text-ink-3">
              {subtitle}
            </span>

            <span className="relative ml-auto">
              <Icon
                path={paths.search}
                size={14}
                width={1.9}
                className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-4"
              />
              <input
                value={query}
                onChange={(event) =>
                  void navigate({
                    search: (prev) => ({
                      ...prev,
                      query: event.target.value || undefined,
                    }),
                    replace: true,
                  })
                }
                placeholder={PLACEHOLDER[screen]}
                className="h-[32px] w-[240px] rounded-control bg-field pr-2.5 pl-8 text-xs text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none placeholder:text-ink-4 focus:bg-surface focus:shadow-[inset_0_0_0_1px_var(--accent)]"
              />
            </span>

            <IconButton
              label="Reload"
              onClick={() => {
                catalogue.reload()
                audit.reload()
              }}
            >
              <Icon path={paths.clock} size={15} width={1.9} />
            </IconButton>
          </header>

          {failure && (
            <p className="border-b border-line px-3.5 py-2.5 text-[11.5px] text-ember">
              cloud-hub refused part of this screen: {failure}
            </p>
          )}

          {screen === "users" && (
            <UsersScreen catalogue={catalogue.data} query={query} />
          )}
          {screen === "roles" && (
            <RolesScreen
              catalogue={catalogue.data}
              query={query}
              systemOnly={systemOnly}
            />
          )}
          {screen === "permissions" && (
            <PermissionsScreen
              catalogue={catalogue.data}
              query={query}
              module={module ?? null}
            />
          )}
          {screen === "audit" && (
            <AuditScreen
              events={events}
              total={auditTotal}
              query={query}
              resourceType={resourceType ?? null}
            />
          )}
        </div>
      </main>
    </AppShell>
  )
}
