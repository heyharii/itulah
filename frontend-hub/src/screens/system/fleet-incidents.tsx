import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ConfirmButton } from "@/components/ui/dialog"
import { Field, Input } from "@/components/ui/field"
import { Toggle } from "@/components/ui/form"
import { Pill } from "@/components/ui/pill"
import { Sheet } from "@/components/ui/sheet"
import { EmptyState, Problem } from "@/components/ui/states"
import { ago, moment } from "@/lib/format"
import {
  useAcknowledgeFleetIncident,
  useFleetAlertSettings,
  useFleetIncidents,
  useUpdateFleetAlertSettings,
  type FleetIncident,
  type FleetSettings,
} from "@/lib/queries/fleet"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { useSections } from "@/lib/session"

const STATE_TONE: Readonly<Record<FleetIncident["state"], "bad" | "warn" | "ok">> = {
  OPEN: "bad",
  ACKNOWLEDGED: "warn",
  RESOLVED: "ok",
}

const STATE_WORD: Readonly<Record<FleetIncident["state"], string>> = {
  OPEN: "Open",
  ACKNOWLEDGED: "Acknowledged",
  RESOLVED: "Resolved",
}

/// System › Store servers › Incidents — every fleet incident, newest first,
/// with an Acknowledge that stops the escalation (never closes it; only
/// recovery does — the server's own rule,
/// `postgres/fleet_status.rs::fleet_acknowledge_incident`). Alert Settings
/// (Admin) sits in a sheet over this list rather than a fifth tab, the same
/// reason Company sits in a sheet over the home screen.
export function FleetIncidents() {
  const [openOnly, setOpenOnly] = useState(true)
  const incidents = useFleetIncidents({ state: openOnly ? "open" : "all" })
  const settings = useSheet("fleet-alert-settings")
  const { bypass } = useSections()

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant={openOnly ? "primary" : "quiet"}
            onClick={() => setOpenOnly(true)}
          >
            Open
          </Button>
          <Button
            size="sm"
            variant={!openOnly ? "primary" : "quiet"}
            onClick={() => setOpenOnly(false)}
          >
            Every incident
          </Button>
        </div>
        {bypass && (
          <Button variant="quiet" size="sm" onClick={() => settings.open(true)}>
            Alert settings
          </Button>
        )}
      </div>

      <Card className="overflow-hidden">
        {queryState(incidents, {
          loading: "Reading incidents…",
          render: (page) =>
            page.items.length === 0 ? (
              <EmptyState>
                {openOnly
                  ? "Nothing open — the fleet has no unanswered incident."
                  : "No incident in the last thirty days."}
              </EmptyState>
            ) : (
              <ul className="divide-y divide-hairline">
                {page.items.map((incident) => (
                  <IncidentRow key={incident.incident_id} incident={incident} />
                ))}
              </ul>
            ),
        })}
      </Card>

      <AlertSettingsSheet open={settings.isOpen} onClose={settings.close} />
    </div>
  )
}

function IncidentRow({ incident }: { incident: FleetIncident }) {
  const acknowledge = useAcknowledgeFleetIncident()
  return (
    <li className="flex flex-col gap-1.5 px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <b className="text-[0.9375rem] font-semibold text-ink">
              {incident.title}
            </b>
            <Pill tone={STATE_TONE[incident.state]}>
              {STATE_WORD[incident.state]}
            </Pill>
          </div>
          <p className="mt-0.5 text-meta text-body">
            {incident.unit_code ?? incident.subject}
            {incident.component_label ? ` · ${incident.component_label}` : ""} ·
            opened {ago(incident.opened_at)}
          </p>
        </div>
        {incident.state === "OPEN" && (
          <ConfirmButton
            label="Acknowledge"
            variant="quiet"
            title="Acknowledge this incident?"
            description="Somebody has it — this stops it escalating further, but only recovery closes it."
            confirmLabel="Acknowledge"
            reason={{
              label: "Note (optional)",
              optional: true,
              placeholder: "Anything worth recording",
            }}
            onConfirm={(note) =>
              acknowledge.mutateAsync({
                id: incident.incident_id,
                note: note.trim() === "" ? undefined : note,
              })
            }
          />
        )}
      </div>

      <p className="text-[0.875rem] text-body">{incident.body}</p>

      {incident.acknowledged_by && (
        <p className="text-meta text-mute">
          Acknowledged by {incident.acknowledged_by}
          {incident.acknowledged_at ? ` · ${moment(incident.acknowledged_at)}` : ""}
          {incident.acknowledged_note ? ` — “${incident.acknowledged_note}”` : ""}
        </p>
      )}
      {incident.resolved_at && (
        <p className="text-meta text-mute">
          Resolved {moment(incident.resolved_at)}.
        </p>
      )}
    </li>
  )
}

/// Thresholds, quiet hours, escalation and who is told — the whole settings
/// object read and written at once (`GET`/`PUT /fleet/alert-settings`).
function AlertSettingsSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Alert settings"
      caption="Thresholds, quiet hours, escalation and who is told."
    >
      {open && <AlertSettingsForm onDone={onClose} />}
    </Sheet>
  )
}

function AlertSettingsForm({ onDone }: { onDone: () => void }) {
  const settings = useFleetAlertSettings(true)
  if (settings.data === undefined) {
    return (
      <p className="text-meta text-body">
        {settings.isError ? "Could not read the settings." : "Reading…"}
      </p>
    )
  }
  return <AlertSettingsFields initial={settings.data} onDone={onDone} />
}

function AlertSettingsFields({
  initial,
  onDone,
}: {
  initial: FleetSettings
  onDone: () => void
}) {
  const [form, setForm] = useState<FleetSettings>(initial)
  const update = useUpdateFleetAlertSettings()

  const set = <K extends keyof FleetSettings>(key: K, value: FleetSettings[K]) =>
    setForm((was) => ({ ...was, [key]: value }))

  return (
    <div className="flex flex-col gap-5">
      <Toggle
        on={form.alerts_enabled}
        onToggle={() => set("alerts_enabled", !form.alerts_enabled)}
        label="Alerts on"
        note="Off stops every notification; the fleet page still colours rows."
      />

      <div className="grid grid-cols-2 gap-3">
        <Field label="Synced within (s)">
          <Input
            type="number"
            min={0}
            value={form.synced_within_seconds}
            onChange={(event) =>
              set("synced_within_seconds", Number(event.target.value))
            }
          />
        </Field>
        <Field label="Behind alert (min)">
          <Input
            type="number"
            min={0}
            value={form.behind_alert_minutes}
            onChange={(event) =>
              set("behind_alert_minutes", Number(event.target.value))
            }
          />
        </Field>
        <Field label="Offline after (s)">
          <Input
            type="number"
            min={0}
            value={form.offline_after_seconds}
            onChange={(event) =>
              set("offline_after_seconds", Number(event.target.value))
            }
          />
        </Field>
        <Field label="Red after (min)">
          <Input
            type="number"
            min={0}
            value={form.red_after_minutes}
            onChange={(event) => set("red_after_minutes", Number(event.target.value))}
          />
        </Field>
        <Field label="Backup max age (h)">
          <Input
            type="number"
            min={0}
            value={form.backup_max_age_hours}
            onChange={(event) =>
              set("backup_max_age_hours", Number(event.target.value))
            }
          />
        </Field>
        <Field label="Reader silent (min)">
          <Input
            type="number"
            min={0}
            value={form.reader_silent_minutes}
            onChange={(event) =>
              set("reader_silent_minutes", Number(event.target.value))
            }
          />
        </Field>
        <Field label="Escalate after (min)">
          <Input
            type="number"
            min={0}
            value={form.escalate_after_minutes}
            onChange={(event) =>
              set("escalate_after_minutes", Number(event.target.value))
            }
          />
        </Field>
        <Field label="History (days)">
          <Input
            type="number"
            min={0}
            value={form.history_days}
            onChange={(event) => set("history_days", Number(event.target.value))}
          />
        </Field>
      </div>

      <div className="flex flex-col gap-2.5">
        <Toggle
          on={form.alert_on_red}
          onToggle={() => set("alert_on_red", !form.alert_on_red)}
          label="Alert on red"
          note={
            form.alert_on_red
              ? `Notified once a row has been red for ${form.red_after_minutes} min.`
              : "A red row is silent — the page still colours it."
          }
        />
        <Toggle
          on={form.alert_on_sync_behind}
          onToggle={() => set("alert_on_sync_behind", !form.alert_on_sync_behind)}
          label="Alert on sync behind"
          note={
            form.alert_on_sync_behind
              ? `Notified past ${form.behind_alert_minutes} min behind.`
              : "A store falling behind is silent."
          }
        />
        <Toggle
          on={form.alert_on_printer_fault}
          onToggle={() => set("alert_on_printer_fault", !form.alert_on_printer_fault)}
          label="Alert on printer fault"
          note={
            form.alert_on_printer_fault
              ? "Notified the moment a printer faults."
              : "A printer fault is silent."
          }
        />
        <Toggle
          on={form.alert_on_backup}
          onToggle={() => set("alert_on_backup", !form.alert_on_backup)}
          label="Alert on backup"
          note={
            form.alert_on_backup
              ? `Notified once a backup is older than ${form.backup_max_age_hours} h.`
              : "A stale backup is silent."
          }
        />
        <Toggle
          on={form.alert_on_reader_silent}
          onToggle={() => set("alert_on_reader_silent", !form.alert_on_reader_silent)}
          label="Alert on a silent reader"
          note={
            form.alert_on_reader_silent
              ? `Notified past ${form.reader_silent_minutes} min without a scan.`
              : "A silent reader is not reported on its own."
          }
        />
        <Toggle
          on={form.notify_unit_pic}
          onToggle={() => set("notify_unit_pic", !form.notify_unit_pic)}
          label="Notify the unit's PIC"
          note={
            form.notify_unit_pic
              ? "The store's own PIC is told, beside the roles below."
              : "Only the roles below are told."
          }
        />
      </div>

      <Field
        label="Notify roles"
        hint="Job role codes, comma-separated — OWNER, ADMIN, IT…"
      >
        <Input
          value={form.notify_roles.join(", ")}
          onChange={(event) =>
            set(
              "notify_roles",
              event.target.value
                .split(",")
                .map((role) => role.trim().toUpperCase())
                .filter((role) => role !== "")
            )
          }
        />
      </Field>
      <Field
        label="Escalate to roles"
        hint="Job role codes, comma-separated — who hears it if nobody acknowledges."
      >
        <Input
          value={form.escalate_to_roles.join(", ")}
          onChange={(event) =>
            set(
              "escalate_to_roles",
              event.target.value
                .split(",")
                .map((role) => role.trim().toUpperCase())
                .filter((role) => role !== "")
            )
          }
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Quiet from" hint="HH:MM, head office's clock">
          <Input
            placeholder="22:00"
            value={form.quiet_from ?? ""}
            onChange={(event) =>
              set("quiet_from", event.target.value.trim() === "" ? null : event.target.value)
            }
          />
        </Field>
        <Field label="Quiet until" hint="HH:MM">
          <Input
            placeholder="07:00"
            value={form.quiet_until ?? ""}
            onChange={(event) =>
              set("quiet_until", event.target.value.trim() === "" ? null : event.target.value)
            }
          />
        </Field>
      </div>

      <Problem error={update.error} />
      <div className="flex justify-end gap-2">
        <Button variant="quiet" onClick={onDone}>
          Cancel
        </Button>
        <Button
          variant="primary"
          pending={update.isPending}
          onClick={() =>
            update.mutate(form, {
              onSuccess: onDone,
            })
          }
        >
          {update.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  )
}
