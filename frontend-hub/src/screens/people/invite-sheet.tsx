import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Check, Copy, MessageCircle, Plus, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { button } from "@/components/ui/button-style"
import { Field, Input, Select } from "@/components/ui/field"
import { Sheet } from "@/components/ui/sheet"
import { Banner, Problem } from "@/components/ui/states"
import { moment } from "@/lib/format"
import { unitLabel, useUnits, type UnitView } from "@/lib/queries/organisation"
import {
  createInvitations,
  invitationKeys,
  roleHint,
  useRoles,
  type IssuedInvitation,
  type JobRole,
} from "@/lib/queries/invitations"
import { setupKeys } from "@/lib/queries/setup"
import { useCanWrite } from "@/lib/session"

/// Invite people by link — a sheet, opened from People, from System › Users &
/// roles, and from the "Invite your team" task on Home.
///
/// One row per person; "Create links" hands back a link for each, and the
/// links are shown here ONCE. There is no email and no WhatsApp integration —
/// the owner's instruction — so a link is copied, or handed to WhatsApp's own
/// share page (`wa.me`, nothing of ours in between), and the screen says
/// plainly that it will not be shown again.

interface DraftPerson {
  readonly key: string
  name: string
  roleCode: string
  unitId: string
  position: string
}

function draftPerson(unitId = ""): DraftPerson {
  return {
    key: crypto.randomUUID(),
    name: "",
    roleCode: "",
    unitId,
    position: "",
  }
}

function personReady(row: DraftPerson): boolean {
  return row.name.trim() !== "" && row.roleCode !== "" && row.unitId !== ""
}

export function InviteSheet({
  open,
  onClose,
  /// The unit this sheet was opened from — a store's own screen, People
  /// filtered to one store — so the first row starts there instead of asking
  /// again for what the caller already knows. Left out on Home and on the
  /// unfiltered People screen, where there is no such unit.
  defaultUnitId,
}: {
  open: boolean
  onClose: () => void
  defaultUnitId?: string
}) {
  const client = useQueryClient()
  const canWrite = useCanWrite()
  const roles = useRoles()
  const units = useUnits()
  const [rows, setRows] = useState<DraftPerson[]>(() => [
    draftPerson(defaultUnitId),
  ])
  const [issued, setIssued] = useState<readonly IssuedInvitation[] | null>(null)

  const eligible = rows.filter(personReady)

  const create = useMutation({
    mutationFn: () =>
      createInvitations(
        eligible.map((row) => ({
          name: row.name.trim(),
          role_code: row.roleCode,
          unit_id: row.unitId,
          ...(row.position.trim() !== ""
            ? { position: row.position.trim() }
            : {}),
        }))
      ),
    onSuccess: (answer) => {
      setIssued(answer.items)
      // Somebody has now been invited — the fact both the queue and the setup
      // task on Home read.
      void client.invalidateQueries({ queryKey: invitationKeys.all })
      void client.invalidateQueries({ queryKey: setupKeys.status() })
    },
  })

  function reset() {
    setRows([draftPerson(defaultUnitId)])
    setIssued(null)
    create.reset()
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset()
          onClose()
        }
      }}
      title={issued ? "Send these links" : "Invite people"}
      caption={
        issued
          ? undefined
          : "One row per person. Add as many as you like — a role and a unit for each."
      }
      footer={
        issued ? (
          <div className="flex justify-end">
            <Button
              onClick={() => {
                reset()
                onClose()
              }}
            >
              Done
            </Button>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <Button
              variant="quiet"
              onClick={() => {
                reset()
                onClose()
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={eligible.length === 0 || !canWrite}
              pending={create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending
                ? "Submitting…"
                : eligible.length > 1
                  ? "Submit"
                  : "Submit"}
            </Button>
          </div>
        )
      }
    >
      {issued ? (
        <LinksList items={issued} />
      ) : (
        <Composer
          rows={rows}
          onChange={setRows}
          roles={roles.data ?? []}
          units={units.data ?? []}
        />
      )}
      {create.isError && <Problem error={create.error} className="mt-4" />}
    </Sheet>
  )
}

/// The rows somebody is typing into — a name, a role, a unit and an optional
/// position each, added and removed like `screens/setup/store-list.tsx`'s
/// stores: Enter for a new row, Backspace on an empty one to drop it.
function Composer({
  rows,
  onChange,
  roles,
  units,
}: {
  rows: readonly DraftPerson[]
  onChange: (rows: DraftPerson[]) => void
  roles: readonly JobRole[]
  units: readonly UnitView[]
}) {
  const inputs = useRef(new Map<string, HTMLInputElement>())
  const focusNext = useRef<string | null>(null)

  useEffect(() => {
    if (focusNext.current === null) return
    inputs.current.get(focusNext.current)?.focus()
    focusNext.current = null
  })

  const set = (index: number, patch: Partial<DraftPerson>) =>
    onChange(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)))

  const insert = (at: number) => {
    const row = draftPerson(rows[at - 1]?.unitId ?? rows[0]?.unitId ?? "")
    focusNext.current = row.key
    onChange([...rows.slice(0, at), row, ...rows.slice(at)])
  }

  const remove = (index: number) => {
    const rest = rows.filter((_, at) => at !== index)
    const next = rest.length === 0 ? [draftPerson(rows[0]?.unitId)] : rest
    focusNext.current = next[Math.max(0, index - 1)].key
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row, index) => (
        <div
          key={row.key}
          className="group flex flex-col gap-2.5 rounded-card border border-hairline-2 bg-canvas p-3.5"
        >
          <div className="flex items-start gap-2">
            <div className="grid flex-1 grid-cols-2 gap-2.5">
              <Field label="Name" required className="col-span-2">
                <Input
                  ref={(element) => {
                    if (element) inputs.current.set(row.key, element)
                    else inputs.current.delete(row.key)
                  }}
                  value={row.name}
                  onChange={(event) => set(index, { name: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault()
                      insert(index + 1)
                    }
                  }}
                />
              </Field>
              <Field label="Role" required>
                <Select
                  value={row.roleCode}
                  onChange={(next) => set(index, { roleCode: next })}
                >
                  {roles.map((role) => (
                    <option key={role.code} value={role.code}>
                      {role.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Unit" required>
                <Select
                  value={row.unitId}
                  onChange={(next) => set(index, { unitId: next })}
                >
                  {units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unitLabel(unit)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Position" className="col-span-2">
                <Input
                  value={row.position}
                  onChange={(event) =>
                    set(index, { position: event.target.value })
                  }
                />
              </Field>
            </div>
            {rows.length > 1 && (
              <Button
                variant="quiet"
                size="icon"
                aria-label={`Remove ${row.name || "this row"}`}
                onClick={() => remove(index)}
                className="mt-6 shrink-0"
              >
                <X />
              </Button>
            )}
          </div>
          {roleHint(
            roles.find((role) => role.code === row.roleCode) ?? {
              code: row.roleCode,
              description: "",
            }
          ) && (
            <p className="text-[0.875rem] text-mute">
              {roleHint(
                roles.find((role) => role.code === row.roleCode) ?? {
                  code: row.roleCode,
                  description: "",
                }
              )}
            </p>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => insert(rows.length)}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-card border border-dashed border-hairline-strong text-cell font-medium text-body transition-colors hover:bg-soft"
      >
        <Plus className="size-4 text-line-ico" />
        Add another person
      </button>
    </div>
  )
}

/// The links, shown once. Nothing here reads one back — this is the only
/// place in the app that ever will, because the server hands each one over
/// exactly once and this screen does not keep a copy either.
function LinksList({ items }: { items: readonly IssuedInvitation[] }) {
  return (
    <div className="flex flex-col gap-3.5">
      <Banner tone="warn">
        Each link is shown here once and never again. Send it now — WhatsApp,
        chat, email, in person.
      </Banner>
      <div className="flex flex-col gap-2.5">
        {items.map((item) => (
          <div
            key={item.invitation_id}
            className="flex flex-col gap-2 rounded-card border border-hairline-2 bg-canvas p-3.5"
          >
            <div className="flex items-center justify-between gap-2">
              <b className="truncate text-cell font-semibold text-ink">
                {item.name}
              </b>
              <span className="shrink-0 text-meta text-mute">
                Expires {moment(item.expires_at)} · 72 h
              </span>
            </div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-inner bg-soft-2 px-2.5 py-2 font-mono text-id text-body">
                {item.link}
              </code>
              <CopyLinkButton link={item.link} />
              <WhatsAppLinkButton link={item.link} name={item.name} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/// Copy, and say so for a few seconds — the same feedback
/// `screens/workplace/vault-tile.tsx` uses for a file link, kept local rather
/// than a toast because several of these can sit on one screen at once.
export function CopyLinkButton({ link }: { link: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="sm"
      variant={copied ? "quiet" : "primary"}
      onClick={() => {
        void navigator.clipboard?.writeText(link).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 3000)
        })
      }}
      className="shrink-0"
    >
      {copied ? (
        <>
          <Check className="size-3.5" /> Copied
        </>
      ) : (
        <>
          <Copy className="size-3.5" /> Copy
        </>
      )}
    </Button>
  )
}

/// Hand the link to WhatsApp: `wa.me` with no number opens its own "send to"
/// picker, the message already written. A link out, not a button — it goes
/// somewhere — styled as the quiet partner of Copy. The message is Indonesian
/// because it is read by the person invited, in their chat, not on a screen
/// of ours.
export function WhatsAppLinkButton({
  link,
  name,
}: {
  link: string
  name?: string | null
}) {
  const greeting = name?.trim() ? `Halo ${name.trim()}, ini` : "Ini"
  const text = `${greeting} link untuk masuk ke Central. Berlaku 72 jam, sekali pakai:\n${link}`
  return (
    <a
      href={`https://wa.me/?text=${encodeURIComponent(text)}`}
      target="_blank"
      rel="noreferrer"
      className={button({
        variant: "ghost",
        size: "sm",
        className: "shrink-0",
      })}
    >
      <MessageCircle className="size-3.5" /> WhatsApp
    </a>
  )
}
