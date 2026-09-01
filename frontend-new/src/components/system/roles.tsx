/*
 * Roles — each role's permission set, grouped by module and editable.
 *
 * The editor holds a working set in memory. cloud-hub has no set-replacement
 * route for a role's permissions and no version token: the only verbs are
 * `POST …/roles/{id}/permissions` (one permission at a time) and
 * `DELETE …/roles/{id}/permissions/{permId}`. A save is therefore a sequence of
 * small writes that can partly succeed, and there is no optimistic-concurrency
 * check to catch a concurrent editor. The footer says so, and a partial save is
 * reported as a partial save rather than smoothed into "Saved".
 */

import { useMemo, useState } from "react"

import { Icon, paths } from "@/components/dashboard/parts"
import { SheetShell, sheetButton } from "@/components/dashboard/sheet-shell"
import {
  type SystemAccessCatalogue,
  type SystemPermission,
  type SystemRole,
} from "@/components/system/api"
import { useSaveRolePermissions } from "@/components/system/mutations"
import {
  Count,
  Empty,
  Note,
  relativeTime,
  SectionLabel,
  Stat,
  StatusChip,
} from "@/components/system/parts"
import { getErrorMessage } from "@/lib/api"
import { VirtualRows } from "@/shared/table"
import { cn } from "@/lib/utils"

const ROLE_COLUMNS = "minmax(0,1fr) 110px 80px 90px 100px 130px"

export function RolesScreen({
  catalogue,
  query,
  systemOnly,
}: {
  catalogue: SystemAccessCatalogue | undefined
  query: string
  systemOnly: boolean
}) {
  const [openId, setOpenId] = useState<string | null>(null)

  const roles = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (catalogue?.roles ?? [])
      .filter((role) => !systemOnly || role.isSystem)
      .filter(
        (role) =>
          !needle ||
          role.name.toLowerCase().includes(needle) ||
          role.key.toLowerCase().includes(needle)
      )
  }, [catalogue?.roles, query, systemOnly])

  const open = catalogue?.roles.find((role) => role.id === openId) ?? null

  return (
    <>
      <div className="min-h-0 flex-1 overflow-auto">
        {roles.length === 0 ? (
          <Empty>No role matches that search.</Empty>
        ) : (
          <VirtualRows
            rows={roles}
            rowKey={(role) => role.id}
            columns={ROLE_COLUMNS}
            rowHeight={44}
            className="min-w-[760px]"
            onRowClick={(role) => setOpenId(role.id)}
            header={
              <>
                <span className="pl-3.5 text-left">Role</span>
                <span className="text-right">Permissions</span>
                <span className="text-right">Users</span>
                <span className="text-left">Origin</span>
                <span className="text-left">Status</span>
                <span className="pr-3.5 text-right">Updated</span>
              </>
            }
            renderRow={(role) => (
              <>
                <span role="gridcell" className="truncate py-2 pr-3 pl-3.5">
                  <span className="block truncate font-medium text-ink">{role.name}</span>
                  <span className="block truncate font-mono text-[10.5px] text-ink-4">
                    {role.key}
                    {role.description ? ` · ${role.description}` : ""}
                  </span>
                </span>
                <span role="gridcell" className="px-3 text-right">
                  <Count value={role.permissionCount} />
                </span>
                <span role="gridcell" className="px-3 text-right">
                  <Count value={role.userCount} />
                </span>
                <span role="gridcell" className="px-3 text-[11.5px] text-ink-3">
                  {role.isSystem ? "system" : "custom"}
                </span>
                <span role="gridcell" className="px-3">
                  <StatusChip value={role.status} />
                </span>
                <span role="gridcell" className="px-3 pr-3.5 text-right text-[11px] text-ink-4">
                  {relativeTime(role.updatedAt)}
                </span>
              </>
            )}
          />
        )}
      </div>

      <RoleSheet
        key={openId ?? "closed"}
        role={open}
        permissions={catalogue?.permissions ?? []}
        onClose={() => setOpenId(null)}
      />
    </>
  )
}

function RoleSheet({
  role,
  permissions,
  onClose,
}: {
  role: SystemRole | null
  permissions: SystemPermission[]
  onClose: () => void
}) {
  /* `server` is what the role looked like when this sheet last agreed with
   * cloud-hub; `selected` is the working set. The sheet is remounted per role
   * (see the `key` above), so the working set is seeded once from the row that
   * opened it and is never clobbered by a catalogue reload landing underneath
   * an edit in progress. */
  const [server, setServer] = useState<SystemRole | null>(role)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(role?.permissionIds ?? []))
  const [filter, setFilter] = useState("")
  const [onlyHeld, setOnlyHeld] = useState(false)
  const mutation = useSaveRolePermissions()
  const saving = mutation.isPending
  const error = mutation.error ? getErrorMessage(mutation.error) : null
  const result = mutation.data
  const outcome = result
    ? result.ok
      ? `${result.granted.length} granted · ${result.revoked.length} revoked · the role now holds ${result.role.permissionCount}.`
      : `Partly applied: ${result.granted.length} granted, ${result.revoked.length} revoked, ` +
        `${result.failures.length} refused (${result.failures
          .map((failure) => `${failure.operation} ${failure.permissionId}: ${failure.message}`)
          .join("; ")}). The set shown below is what the server now holds.`
    : null

  const byId = useMemo(
    () => new Map(permissions.map((permission) => [permission.id, permission] as const)),
    [permissions]
  )

  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    const byModule = new Map<string, SystemPermission[]>()
    for (const permission of permissions) {
      if (onlyHeld && !selected.has(permission.id)) continue
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
  }, [permissions, filter, onlyHeld, selected])

  /* Ids the role holds that the catalogue does not list would be unrevokable
   * through this screen, so they are surfaced rather than silently dropped. */
  const unlisted = useMemo(
    () => [...selected].filter((id) => !byId.has(id)),
    [byId, selected]
  )

  const baseline = server?.permissionIds ?? []
  const added = [...selected].filter((id) => !baseline.includes(id))
  const removed = baseline.filter((id) => !selected.has(id))
  const dirty = added.length > 0 || removed.length > 0

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleModule = (ids: string[]) => {
    const all = ids.every((id) => selected.has(id))
    setSelected((current) => {
      const next = new Set(current)
      for (const id of ids) {
        if (all) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  const save = () => {
    if (!server) return
    mutation.mutate(
      {
        roleId: server.id,
        nextPermissionIds: [...selected],
        currentPermissionIds: server.permissionIds,
      },
      {
        onSuccess: (result) => {
          setServer(result.role)
          setSelected(new Set(result.role.permissionIds))
        },
      }
    )
  }

  const strippingSystem = server?.isSystem === true && removed.length > 0

  return (
    <SheetShell
      open={Boolean(role)}
      size="wide"
      eyebrow={server?.key ?? "Role"}
      title={server?.name ?? ""}
      onRequestClose={onClose}
      footer={
        <>
          {error ? (
            <span className="flex-1 truncate text-[11.5px] text-ember">{error}</span>
          ) : dirty ? (
            <span className="flex-1 truncate text-[11.5px] text-ink-3">
              {added.length} to grant · {removed.length} to revoke · applied one call at a time
            </span>
          ) : (
            <span className="flex-1 truncate text-[11.5px] text-ink-4">
              No changes · {server?.permissionCount ?? 0} permissions held
            </span>
          )}
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={() => {
              setSelected(new Set(server?.permissionIds ?? []))
              mutation.reset()
            }}
            className={cn(sheetButton.secondary, "disabled:pointer-events-none disabled:opacity-45")}
          >
            Revert
          </button>
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={save}
            className={cn(sheetButton.primary, "disabled:pointer-events-none disabled:opacity-45")}
          >
            <Icon path={paths.check} size={14} width={2.2} />
            {saving ? "Saving…" : "Apply changes"}
          </button>
        </>
      }
    >
      {server && (
        <div className="px-4 py-4">
          <div className="mb-3 grid grid-cols-4 gap-2">
            <Stat
              label="Permissions"
              value={String(selected.size)}
              hint={`of ${permissions.length}`}
            />
            <Stat label="Users" value={String(server.userCount)} />
            <Stat label="Origin" value={server.isSystem ? "system" : "custom"} />
            <Stat label="Status" value={server.status} />
          </div>

          {outcome && (
            <div className="pb-3">
              <Note tone="warn">{outcome}</Note>
            </div>
          )}

          {unlisted.length > 0 && (
            <div className="pb-3">
              <Note tone="warn">
                {unlisted.length} of this role's permission ids are not in the catalogue
                ({unlisted.join(", ")}). They cannot be toggled from here, and they are
                left untouched by a save.
              </Note>
            </div>
          )}

          {strippingSystem && (
            <div className="pb-3">
              <Note tone="warn">
                {server.name} is a system role seeded by the platform. Revoking{" "}
                {removed.length} permission{removed.length === 1 ? "" : "s"} from it changes
                what {server.userCount} user{server.userCount === 1 ? "" : "s"} may do, and
                there is no version check on this backend to stop a concurrent editor
                overwriting the result.
              </Note>
            </div>
          )}

          <div className="mb-3 flex items-center gap-2">
            <span className="relative flex-1">
              <Icon
                path={paths.search}
                size={14}
                width={1.9}
                className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-4"
              />
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter permission codes"
                className="h-[32px] w-full rounded-control bg-field pr-2.5 pl-8 text-xs text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none focus:bg-surface focus:shadow-[inset_0_0_0_1px_var(--accent)] placeholder:text-ink-4"
              />
            </span>
            <button
              type="button"
              onClick={() => setOnlyHeld((value) => !value)}
              className={cn(sheetButton.secondary, onlyHeld && "bg-hover font-semibold")}
            >
              Held only
            </button>
          </div>

          {groups.length === 0 ? (
            <Empty>No permission matches that filter.</Empty>
          ) : (
            <div className="grid gap-3">
              {groups.map(([module, list]) => {
                const held = list.filter((permission) => selected.has(permission.id)).length
                return (
                  <section key={module}>
                    <div className="flex items-center gap-2 pb-1.5">
                      <SectionLabel>{module}</SectionLabel>
                      <span className="pb-1.5">
                        <Count value={`${held}/${list.length}`} className="text-ink-4" />
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleModule(list.map((permission) => permission.id))}
                        className="mb-1.5 ml-auto rounded-chip px-1.5 py-0.5 text-[11px] text-ink-3 transition-colors hover:bg-hover hover:text-ink"
                      >
                        {held === list.length ? "Clear module" : "Select module"}
                      </button>
                    </div>
                    <div className="grid gap-px overflow-hidden rounded-panel bg-line shadow-[0_0_0_1px_var(--line)] sm:grid-cols-2">
                      {list.map((permission) => {
                        const on = selected.has(permission.id)
                        return (
                          <button
                            key={permission.id}
                            type="button"
                            onClick={() => toggle(permission.id)}
                            title={permission.description || permission.code}
                            className={cn(
                              "flex items-center gap-2 bg-surface px-2.5 py-1.5 text-left transition-colors hover:bg-hover",
                              on && "bg-[color-mix(in_srgb,var(--accent)_6%,var(--surface))]"
                            )}
                          >
                            <span
                              className={cn(
                                "grid size-[15px] shrink-0 place-items-center rounded-[4px] transition-colors",
                                on
                                  ? "bg-accent text-white"
                                  : "shadow-[inset_0_0_0_1px_var(--line-strong)]"
                              )}
                            >
                              {on && <Icon path={paths.check} size={10} width={3} />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-mono text-[11.5px] text-ink-2">
                                {permission.code}
                              </span>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </section>
                )
              })}
            </div>
          )}

          <div className="pt-4">
            <SectionLabel>Members</SectionLabel>
          </div>
          {server.userIds.length === 0 ? (
            <Note>No user holds this role.</Note>
          ) : (
            <div className="flex flex-wrap gap-1">
              {server.userIds.map((userId) => (
                <span
                  key={userId}
                  className="inline-flex h-[18px] items-center rounded-[5px] bg-inset px-1.5 font-mono text-[10.5px] text-ink-3"
                >
                  {userId}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </SheetShell>
  )
}
