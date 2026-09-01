/*
 * Users — who holds which role, and what that reaches.
 *
 * This screen is deliberately honest about its provenance. cloud-hub publishes
 * no user directory an API-key caller may read: `GET /api/v1/auth/users` is
 * JWT-gated behind `platform.users.manage` and answers 401 here. The one
 * user-facing thing the permissions API will disclose is the membership of each
 * role, so the list below is the union of `…/roles/{id}/users` across all 23
 * roles — user ids and nothing else. There is no display name, no email, no
 * account status and no session route on this backend, so those columns are not
 * shown at all rather than being drawn empty and read as "unknown but knowable".
 *
 * Opening a row reads that user's live role assignments, which is where the
 * scope, the grantor and the assignment timestamp actually come from.
 */

import { useCallback, useEffect, useMemo, useState } from "react"

import { Icon, paths } from "@/components/dashboard/parts"
import { SheetShell, sheetButton } from "@/components/dashboard/sheet-shell"
import {
  fetchRoleAssignments,
  type SystemAccessCatalogue,
  type SystemRoleAssignment,
  type SystemUser,
} from "@/components/system/api"
import {
  Count,
  Empty,
  Note,
  relativeTime,
  SectionLabel,
  Stat,
} from "@/components/system/parts"
import { getErrorMessage } from "@/lib/api"
import { VirtualRows } from "@/shared/table"

const USER_COLUMNS = "240px 80px minmax(0,1fr) 110px"

export function UsersScreen({
  catalogue,
  query,
}: {
  catalogue: SystemAccessCatalogue | undefined
  query: string
}) {
  const [open, setOpen] = useState<SystemUser | null>(null)

  const users = useMemo(() => catalogue?.users ?? [], [catalogue?.users])

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return users
    return users.filter(
      (user) =>
        user.id.toLowerCase().includes(needle) ||
        user.roleNames.some((name) => name.toLowerCase().includes(needle))
    )
  }, [users, query])

  return (
    <>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="px-3.5 pt-3.5">
          <Note tone="warn">
            cloud-hub exposes no user directory to an API-key caller —{" "}
            <span className="font-mono">GET /api/v1/auth/users</span> requires a
            JWT carrying <span className="font-mono">platform.users.manage</span>{" "}
            and answers 401 here. This list is therefore the union of{" "}
            <span className="font-mono">/v1/permissions/roles/{"{id}"}/users</span>{" "}
            across every role: it reaches every user that holds at least one
            role, and it carries user ids only. Names, addresses, account status
            and sessions are not available on this backend.
          </Note>
        </div>

        {rows.length === 0 ? (
          <Empty>
            {users.length === 0
              ? "No role has any member, so no user can be listed."
              : "No user matches that search."}
          </Empty>
        ) : (
          <VirtualRows
            rows={rows}
            rowKey={(user) => user.id}
            columns={USER_COLUMNS}
            rowHeight={40}
            className="mt-3.5 min-w-[820px]"
            onRowClick={(user) => setOpen(user)}
            header={
              <>
                <span className="pl-3.5 text-left">User</span>
                <span className="text-right">Roles</span>
                <span className="pl-3 text-left">Holds</span>
                <span className="pr-3.5 text-right">Permissions</span>
              </>
            }
            renderRow={(user) => (
              <>
                <span role="gridcell" className="truncate py-2 pr-3 pl-3.5">
                  <span className="block truncate font-mono text-[12px] font-medium text-ink">
                    {user.id}
                  </span>
                </span>
                <span role="gridcell" className="px-3 text-right">
                  <Count value={user.roleIds.length} />
                </span>
                <span role="gridcell" className="truncate px-3">
                  <span className="flex flex-wrap gap-1">
                    {user.roleNames.map((name, index) => (
                      <span
                        key={`${user.id}-${name}-${index}`}
                        className="inline-flex h-[18px] items-center rounded-[5px] bg-inset px-1.5 text-[10.5px] text-ink-3"
                      >
                        {name}
                      </span>
                    ))}
                  </span>
                </span>
                <span role="gridcell" className="px-3 pr-3.5 text-right">
                  <Count value={user.permissionCodes.length} className="text-ink-4" />
                </span>
              </>
            )}
          />
        )}
      </div>

      <UserSheet user={open} catalogue={catalogue} onClose={() => setOpen(null)} />
    </>
  )
}

function UserSheet({
  user,
  catalogue,
  onClose,
}: {
  user: SystemUser | null
  catalogue: SystemAccessCatalogue | undefined
  onClose: () => void
}) {
  const [assignments, setAssignments] = useState<SystemRoleAssignment[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const userId = user?.id

  useEffect(() => {
    setAssignments(null)
    setError(null)
    if (!userId) return

    const controller = new AbortController()
    fetchRoleAssignments(userId, controller.signal).then(
      (list) => setAssignments(list),
      (caught: unknown) => {
        if (!controller.signal.aborted) setError(getErrorMessage(caught))
      }
    )
    return () => controller.abort()
  }, [userId])

  const permissionsByModule = useCallback(() => {
    const index = new Map(
      (catalogue?.permissions ?? []).map((permission) => [permission.code, permission] as const)
    )
    const byModule = new Map<string, string[]>()
    for (const code of user?.permissionCodes ?? []) {
      const module = index.get(code)?.module ?? code.split(".")[0] ?? "—"
      const list = byModule.get(module)
      if (list) list.push(code)
      else byModule.set(module, [code])
    }
    return [...byModule.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [catalogue?.permissions, user?.permissionCodes])()

  const scoped = assignments?.filter((assignment) => assignment.scope !== "*") ?? []

  return (
    <SheetShell
      open={Boolean(user)}
      eyebrow="User"
      title={user?.id ?? ""}
      onRequestClose={onClose}
      footer={
        <>
          <span className="flex-1" />
          <button type="button" onClick={onClose} className={sheetButton.secondary}>
            Close
          </button>
        </>
      }
    >
      {user && (
        <div className="px-4 py-4">
          <div className="mb-3 grid grid-cols-3 gap-2">
            <Stat label="Roles" value={String(user.roleIds.length)} />
            <Stat
              label="Permissions"
              value={String(user.permissionCodes.length)}
              hint={`of ${catalogue?.permissions.length ?? 0}`}
            />
            <Stat
              label="Scoped grants"
              value={assignments === null ? "…" : String(scoped.length)}
              hint="not org-wide"
            />
          </div>

          <SectionLabel>Role assignments</SectionLabel>
          {error ? (
            <Note tone="warn">Role assignments could not be read: {error}</Note>
          ) : assignments === null ? (
            <p className="py-3 text-[11.5px] text-ink-4">Reading the assignment store…</p>
          ) : assignments.length === 0 ? (
            <Note>
              This user appears in role membership but{" "}
              <span className="font-mono">/v1/permissions/users/{"{id}"}/role-assignments</span>{" "}
              returned nothing for it.
            </Note>
          ) : (
            <ul className="grid gap-1.5">
              {assignments.map((assignment) => (
                <li
                  key={`${assignment.roleId}-${assignment.assignedAt}`}
                  className="rounded-panel bg-inset px-3 py-2 shadow-[inset_0_0_0_1px_var(--line)]"
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[12.5px] font-medium text-ink">
                      {assignment.roleName}
                    </span>
                    <span className="ml-auto shrink-0 font-mono text-[10.5px] text-ink-4">
                      {assignment.scope === "*" ? "org-wide" : assignment.scope}
                    </span>
                  </div>
                  <div className="truncate pt-0.5 font-mono text-[10.5px] text-ink-4">
                    {assignment.roleKey || assignment.roleId}
                  </div>
                  <div className="pt-1 text-[11px] text-ink-4">
                    assigned {relativeTime(assignment.assignedAt)}
                    {assignment.assignedBy ? ` by ${assignment.assignedBy}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="pt-4">
            <SectionLabel>Permissions reached</SectionLabel>
          </div>
          {permissionsByModule.length === 0 ? (
            <Note>These roles carry no permission, so this user authorises nothing.</Note>
          ) : (
            <div className="grid gap-2">
              {permissionsByModule.map(([module, codes]) => (
                <div key={module}>
                  <div className="pb-1 text-[10.5px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
                    {module}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {codes.map((code) => (
                      <span
                        key={code}
                        className="inline-flex h-[18px] items-center rounded-[5px] bg-inset px-1.5 font-mono text-[10.5px] text-ink-3"
                      >
                        {code}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="pt-4">
            <Note>
              This backend records no last-seen time, no session list and no
              lifecycle state for a user. `user_sessions` exists in the database
              but no route reads it — the handler that would (`listAllSessions`)
              is never registered on the router — so there is nothing here to
              show rather than nothing to find.
            </Note>
          </div>
        </div>
      )}
    </SheetShell>
  )
}

export const usersIcon = <Icon path={paths.people} size={15} width={1.9} />
