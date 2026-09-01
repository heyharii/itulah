/*
 * Audit log — what the platform recorded, and when.
 *
 * Users, Roles and Permissions answer "who may do what"; this screen answers
 * "what happened". Every field comes from `/api/v1/audit`, whose rows are
 * operational rather than access-control: an `actor_id` that is a username or a
 * service name (not a uuid), a dotted `action`, a `resource_type` and a
 * `resource_id`. There is no subject id and no account id on these rows, so
 * there is nothing to resolve them against and no name is manufactured — what
 * the hub wrote is what is shown.
 */

import { useMemo, useState } from "react"

import { Icon, paths } from "@/components/dashboard/parts"
import { SheetShell, sheetButton } from "@/components/dashboard/sheet-shell"
import { type SystemAuditEvent } from "@/components/system/api"
import {
  Count,
  Empty,
  Note,
  relativeTime,
  rule,
  SectionLabel,
  StatusChip,
} from "@/components/system/parts"
import { VirtualRows } from "@/shared/table"
import { cn } from "@/lib/utils"

const shortId = (id: string) => (id.length > 12 ? `${id.slice(0, 8)}…` : id)

const clock = (iso: string) => {
  const at = new Date(iso)
  return Number.isFinite(at.getTime())
    ? at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "—"
}

const AUDIT_COLUMNS = "96px 240px minmax(0,1fr) 190px 96px"

/** A day heading or one event — the two things the audit feed interleaves. */
type AuditFeedEntry =
  | { kind: "day"; day: string; count: number }
  | { kind: "event"; event: SystemAuditEvent }

const dayOf = (iso: string) => iso.slice(0, 10)

const dayLabel = (day: string) => {
  const at = new Date(`${day}T00:00:00Z`)
  if (!Number.isFinite(at.getTime())) return day
  return at.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
}

/** `warning` and `error` rows are the ones worth spotting in a wall of `info`. */
const SEVERITY_TONE: Record<string, string> = {
  info: "text-ink-3",
  warning: "text-honey",
  error: "text-ember",
  critical: "text-ember",
}

export function AuditScreen({
  events,
  total,
  query,
  resourceType,
}: {
  events: SystemAuditEvent[]
  /** What the server reports exists, which can exceed what was fetched. */
  total: number
  query: string
  resourceType: string | null
}) {
  const [open, setOpen] = useState<SystemAuditEvent | null>(null)

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return events
      .filter((event) => !resourceType || event.resourceType === resourceType)
      .filter((event) => {
        if (!needle) return true
        return (
          event.action.toLowerCase().includes(needle) ||
          event.resourceType.toLowerCase().includes(needle) ||
          event.actorId.toLowerCase().includes(needle) ||
          event.resourceId.toLowerCase().includes(needle)
        )
      })
  }, [events, query, resourceType])

  /** Grouped by the day the event occurred, newest day first. */
  const days = useMemo(() => {
    const byDay = new Map<string, SystemAuditEvent[]>()
    for (const event of rows) {
      const day = dayOf(event.occurredAt)
      const list = byDay.get(day)
      if (list) list.push(event)
      else byDay.set(day, [event])
    }
    return [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [rows])

  /* One flat list: a virtualizer positions by index, so the day headings have
   * to be entries in the same array as the events they introduce rather than a
   * nesting around them. */
  const feed = useMemo<AuditFeedEntry[]>(
    () =>
      days.flatMap(([day, list]) => [
        { kind: "day" as const, day, count: list.length },
        ...list.map((event) => ({ kind: "event" as const, event })),
      ]),
    [days]
  )

  return (
    <>
      <div className="min-h-0 flex-1 overflow-auto">
        {events.length > 0 && events.length < total && (
          <div className="px-3.5 pt-3.5">
            <Note>
              The audit route caps a page at 500 rows. {events.length} of {total} entries
              are loaded.
            </Note>
          </div>
        )}

        {rows.length === 0 ? (
          <Empty>
            {events.length === 0
              ? "The audit log is empty."
              : "No audit entry matches that search."}
          </Empty>
        ) : (
          <VirtualRows
            rows={feed}
            rowKey={(entry) =>
              entry.kind === "day" ? `day:${entry.day}` : entry.event.id
            }
            columns={AUDIT_COLUMNS}
            rowHeight={(entry) => (entry.kind === "day" ? 32 : 30)}
            className="min-w-[880px]"
            onRowClick={(entry) => {
              if (entry.kind === "event") setOpen(entry.event)
            }}
            header={
              <>
                <span className="pl-3.5 text-right">Time</span>
                <span className="pl-3">Action</span>
                <span className="px-3">Resource</span>
                <span className="px-3">Actor</span>
                <span className="px-3 pr-3.5">Severity</span>
              </>
            }
            renderRow={(entry) =>
              entry.kind === "day" ? (
                <span
                  role="gridcell"
                  style={{ gridColumn: "1 / -1" }}
                  className="flex h-full items-center gap-2 bg-inset px-3.5"
                >
                  <SectionLabel>{dayLabel(entry.day)}</SectionLabel>
                  <span className="ml-auto">
                    <Count
                      value={`${entry.count} event${entry.count === 1 ? "" : "s"}`}
                      className="text-ink-4"
                    />
                  </span>
                </span>
              ) : (
                <>
                  <span
                    role="gridcell"
                    className="pr-3 pl-3.5 text-right font-mono text-[11.5px] text-ink-3 tabular-nums"
                  >
                    {clock(entry.event.occurredAt)}
                  </span>
                  <span role="gridcell" className="truncate px-3 font-mono text-[12px] text-ink">
                    {entry.event.action}
                  </span>
                  <span role="gridcell" className="truncate px-3">
                    {entry.event.resourceId ? (
                      <span className="font-mono text-[11.5px] text-ink-4">
                        {entry.event.resourceType} {shortId(entry.event.resourceId)}
                      </span>
                    ) : (
                      <span className="text-[11.5px] text-ink-4">
                        {entry.event.resourceType}
                      </span>
                    )}
                  </span>
                  <span role="gridcell" className="truncate px-3 text-[12px] text-ink-2">
                    {entry.event.actorId}
                    <span className="pl-1.5 text-[10.5px] text-ink-4">
                      {entry.event.actorType}
                    </span>
                  </span>
                  <span
                    role="gridcell"
                    className={cn("px-3 pr-3.5", SEVERITY_TONE[entry.event.severity])}
                  >
                    <StatusChip value={entry.event.severity} />
                  </span>
                </>
              )
            }
          />
        )}
      </div>

      <AuditSheet event={open} onClose={() => setOpen(null)} />
    </>
  )
}

function AuditSheet({
  event,
  onClose,
}: {
  event: SystemAuditEvent | null
  onClose: () => void
}) {
  const metadata = event ? Object.entries(event.metadata) : []

  return (
    <SheetShell
      open={Boolean(event)}
      eyebrow={event?.action ?? "Audit entry"}
      title={event ? (event.resourceId ? shortId(event.resourceId) : event.resourceType) : ""}
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
      {event && (
        <div className="px-4 py-4">
          <div className="mb-4 grid gap-1.5">
            <Row label="Occurred" value={`${event.occurredAt} · ${relativeTime(event.occurredAt)}`} />
            <Row label="Action" value={event.action} mono />
            <Row label="Severity" value={event.severity} />
            <Row label="Resource type" value={event.resourceType} />
            <Row label="Resource id" value={event.resourceId} mono />
            <Row label="Actor" value={event.actorId} />
            <Row label="Actor type" value={event.actorType} />
            <Row label="Store" value={event.storeId} mono />
            <Row label="IP address" value={event.ipAddress} mono />
            <Row label="Entry id" value={event.id} mono />
          </div>

          {(event.oldValue || event.newValue) && (
            <>
              <SectionLabel>Change</SectionLabel>
              <div className="mb-4 grid gap-1.5">
                <Row label="Before" value={event.oldValue} mono missing="not recorded" />
                <Row label="After" value={event.newValue} mono missing="not recorded" />
              </div>
            </>
          )}

          <SectionLabel>Metadata</SectionLabel>
          {metadata.length === 0 ? (
            <Note>This entry carries no metadata.</Note>
          ) : (
            <div className="grid gap-1.5">
              {metadata.map(([key, value]) => (
                <Row key={key} label={key} value={value} mono />
              ))}
            </div>
          )}

          <div className="pt-4">
            <Note>
              These rows are the platform's operational audit log, not an
              access-control trail: they name an actor by username or service
              name and carry no subject or account id, so nothing on this screen
              is resolved into a person. cloud-hub records no user agent on them,
              and an IP address only where the request carried one.
            </Note>
          </div>
        </div>
      )}
    </SheetShell>
  )
}

function Row({
  label,
  value,
  mono,
  missing = "—",
}: {
  label: string
  value: string | null | undefined
  mono?: boolean
  missing?: string
}) {
  return (
    <div className={cn("flex items-baseline gap-3 pb-1.5", rule)}>
      <span className="w-[104px] shrink-0 text-[11px] text-ink-4">{label}</span>
      {value ? (
        <span
          className={cn("min-w-0 flex-1 truncate text-[12px] text-ink-2", mono && "font-mono")}
          title={value}
        >
          {value}
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-4 italic">{missing}</span>
      )}
    </div>
  )
}

export const auditIcon = <Icon path={paths.clock} size={15} width={1.9} />
