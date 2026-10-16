import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query"
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  MessageCircle,
  Plus,
  QrCode,
  X,
} from "lucide-react"
import QRCode from "qrcode"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { button } from "@/components/ui/button-style"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { Segmented } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { Banner } from "@/components/ui/states"
import { moment } from "@/lib/format"
import { unitLabel, useUnits, type UnitView } from "@/lib/queries/organisation"
import {
  createInvitations,
  invitationKeys,
  roleAccess,
  useRoles,
  whatsappNumber,
  type IssuedInvitation,
  type JobRole,
} from "@/lib/queries/invitations"
import { listWorkforce } from "@/lib/queries/people"
import { setupKeys } from "@/lib/queries/setup"
import {
  createUser,
  setUserRole,
  systemKeys,
  usersPage,
} from "@/lib/queries/system"
import { useCanWrite } from "@/lib/session"
import { useDebounced } from "@/lib/use-debounced"
import { cn } from "@/lib/utils"
import { Secret } from "@/screens/system/shared"
import { saying } from "@/screens/system/units"

/// Add an account — the one door, opened from People, from System › Users, and
/// from the "Invite your team" task on Home.
///
/// Two ways in, said as a switch at the top and nothing else:
///
///  - **Send a link** (the default). One row per person; "Create links" hands
///    back a link for each, shown HERE ONCE. The person opens it, picks a
///    username and sets their own password, and is signed in — the admin never
///    types a password. A link goes by WhatsApp (owner, 2026-10-12): each row
///    carries the person's WhatsApp number, and the result opens WhatsApp to
///    that number with the message written (`wa.me`, nothing of ours in
///    between — the number is not kept). Copy and a QR stay beside it for
///    somebody standing at the screen.
///  - **Set a password**, for the login nobody is invited to — a machine
///    account moving stock between nodes. It was a second sheet ("Add user
///    directly"); it is a mode of this one now, so there is one door to learn.
///    The login has no employee record, as before.
///
/// One person, one account: a name that is already an employee in HR — with a
/// login, or without one — is said under the row, and the row waits until the
/// admin says it is a different person. A second record for somebody who
/// already has one is how two logins for one human happen.
///
/// Rows can be pasted from a spreadsheet (name, job role, unit, WhatsApp number
/// — one person per line); what is not found is said under that row, in place.

type Mode = "link" | "password"

interface DraftPerson {
  readonly key: string
  name: string
  roleCode: string
  unitId: string
  position: string
  /// Where the link is sent — as typed; `whatsappNumber` makes it dialable.
  phone: string
  username: string
  /// Typed by hand: stop suggesting one from the name.
  usernameSet: boolean
  password: string
  /// The admin said the person the name matched is somebody else.
  distinct: boolean
  /// What a paste could not match — said under the row until it is edited.
  problem: string
}

function draftPerson(unitId = ""): DraftPerson {
  return {
    key: crypto.randomUUID(),
    name: "",
    roleCode: "",
    unitId,
    position: "",
    phone: "",
    username: "",
    usernameSet: false,
    password: "",
    distinct: false,
    problem: "",
  }
}

const MIN_PASSWORD = 8

/// A name as it is compared: no accents, no case, no punctuation.
function plain(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function suggestUsername(name: string): string {
  return plain(name).split(" ").filter(Boolean).slice(0, 2).join(".")
}

function generatePassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("")
}

/// Rows from a spreadsheet: link mode reads name, job role, unit, WhatsApp
/// number, position;
/// password mode reads name, job role, username, password. Anything the lists
/// do not hold is left empty and said under the row.
function parsePaste(
  text: string,
  mode: Mode,
  roles: readonly JobRole[],
  units: readonly UnitView[]
): DraftPerson[] {
  const rows: DraftPerson[] = []
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue
    const cells = line.split(/\t|;|,/).map((cell) => cell.trim())
    if (/^name$/i.test(cells[0])) continue
    const [name = "", roleText = "", third = "", fourth = "", fifth = ""] =
      cells
    const role = roles.find(
      (one) =>
        plain(one.name) === plain(roleText) ||
        one.code.toLowerCase() === roleText.toLowerCase()
    )
    const missing: string[] = []
    if (roleText !== "" && role === undefined)
      missing.push(`job role “${roleText}”`)
    const row = draftPerson()
    row.name = name
    row.roleCode = role?.code ?? ""
    if (mode === "link") {
      const unit = units.find(
        (one) =>
          plain(one.name) === plain(third) ||
          one.code.toLowerCase() === third.toLowerCase() ||
          plain(unitLabel(one)) === plain(third)
      )
      if (third !== "" && unit === undefined) missing.push(`unit “${third}”`)
      row.unitId = unit?.id ?? ""
      row.phone = fourth
      row.position = fifth
    } else {
      row.username = third || suggestUsername(name)
      row.usernameSet = third !== ""
      row.password = fourth
    }
    if (missing.length > 0) {
      const said = `${missing.join(" and ")} not found. Pick from the lists.`
      row.problem = said.charAt(0).toUpperCase() + said.slice(1)
    }
    rows.push(row)
  }
  return rows
}

function download(file: string, rows: readonly (readonly string[])[]) {
  const body = rows
    .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
    .join("\n")
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv" }))
  const link = document.createElement("a")
  link.href = url
  link.download = file
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 500)
}

/// A login that was made here, said once: the password is whatever the admin
/// typed or generated, and nothing on this node will read it back.
interface Created {
  readonly name: string
  readonly username: string
  readonly password: string
  readonly roleName: string
  /// Set when the account exists but its job role could not be given.
  readonly note: string | null
}

interface Outcome {
  readonly created: readonly Created[]
  readonly failed: readonly { readonly name: string; readonly reason: string }[]
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
  const roleList = roles.data ?? []
  const unitList = units.data ?? []
  const [mode, setMode] = useState<Mode>("link")
  const [rows, setRows] = useState<DraftPerson[]>(() => [
    draftPerson(defaultUnitId),
  ])
  const [pasting, setPasting] = useState(false)
  const [pasteText, setPasteText] = useState("")
  const [issued, setIssued] = useState<readonly IssuedInvitation[] | null>(null)
  /// The WhatsApp number of each link, by invitation — only for this screen:
  /// the server is not told it and keeps no copy.
  const [numbers, setNumbers] = useState<Readonly<Record<string, string>>>({})
  const sentTo = useRef<readonly { name: string; number: string }[]>([])
  const [made, setMade] = useState<Outcome | null>(null)

  // Who each typed name might already be. Asked once the typing settles, one
  // question per distinct name, and answered for the row by comparing the
  // whole name — "Dewi" alone matches nothing, "Dewi Anggraini" does.
  const settled = useDebounced(
    rows.map((row) => plain(row.name)).join("\n"),
    350
  )
  const needles = Array.from(
    new Set(settled.split("\n").filter((name) => name.length >= 4))
  )
  const matches = useQueries({
    queries: needles.map((q) => ({
      queryKey: ["people", "name-match", q] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        listWorkforce({ q, limit: 5 }, signal),
      staleTime: 30_000,
      retry: false,
    })),
  })
  const hitOf = (name: string) => {
    const at = needles.indexOf(plain(name))
    if (at < 0) return undefined
    return matches[at]?.data?.rows.find(
      (one) => plain(one.full_name ?? "") === plain(name)
    )
  }

  // Which usernames are already taken — password mode only.
  const handles = useDebounced(
    mode === "password"
      ? rows.map((row) => row.username.trim().toLowerCase()).join("\n")
      : "",
    350
  )
  const handleNeedles = Array.from(
    new Set(handles.split("\n").filter((name) => name.length >= 3))
  )
  const handleAnswers = useQueries({
    queries: handleNeedles.map((q) => ({
      queryKey: ["system", "username-taken", q] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        usersPage({ q }, signal),
      staleTime: 15_000,
      retry: false,
    })),
  })
  const takenOf = (username: string) => {
    const at = handleNeedles.indexOf(username.trim().toLowerCase())
    if (at < 0) return false
    return (
      handleAnswers[at]?.data?.rows.some(
        (one) => one.username.toLowerCase() === username.trim().toLowerCase()
      ) ?? false
    )
  }

  const ready = (row: DraftPerson): boolean => {
    if (row.name.trim() === "" || row.roleCode === "") return false
    if (hitOf(row.name) !== undefined && !row.distinct) return false
    if (mode === "link")
      return row.unitId !== "" && whatsappNumber(row.phone) !== null
    return (
      row.username.trim().length >= 3 &&
      !takenOf(row.username) &&
      row.password.length >= MIN_PASSWORD
    )
  }
  const eligible = rows.filter(ready)
  const everyReady = rows.length > 0 && eligible.length === rows.length

  const createLinks = useMutation({
    mutationFn: () => {
      sentTo.current = eligible.map((row) => ({
        name: row.name.trim(),
        number: whatsappNumber(row.phone) ?? "",
      }))
      return createInvitations(
        eligible.map((row) => ({
          name: row.name.trim(),
          role_code: row.roleCode,
          unit_id: row.unitId,
          ...(row.position.trim() !== ""
            ? { position: row.position.trim() }
            : {}),
        }))
      )
    },
    onSuccess: (answer) => {
      const planned = sentTo.current
      setNumbers(
        Object.fromEntries(
          answer.items.flatMap((item, at) => {
            const same =
              planned[at]?.name === item.name ? planned[at] : undefined
            const found = same ?? planned.find((one) => one.name === item.name)
            return found ? [[item.invitation_id, found.number]] : []
          })
        )
      )
      setIssued(answer.items)
      // Somebody has now been invited — the fact both the queue and the setup
      // task on Home read.
      void client.invalidateQueries({ queryKey: invitationKeys.all })
      void client.invalidateQueries({ queryKey: setupKeys.status() })
    },
  })

  const createAccounts = useMutation({
    mutationFn: async (): Promise<Outcome> => {
      const created: Created[] = []
      const failed: { name: string; reason: string }[] = []
      for (const row of eligible) {
        const role = roleList.find((one) => one.code === row.roleCode)
        if (role === undefined) continue
        try {
          const user = await createUser({
            username: row.username.trim(),
            display_name: row.name.trim(),
            password: row.password,
            role: role.rung,
          })
          let note: string | null = null
          try {
            await setUserRole(user.id, { role_code: role.code })
          } catch {
            note = "Created with the default job role. Set it from the account."
          }
          created.push({
            name: row.name.trim(),
            username: user.username,
            password: row.password,
            roleName: role.name,
            note,
          })
        } catch (error) {
          failed.push({ name: row.name.trim(), reason: saying(error) })
        }
      }
      return { created, failed }
    },
    onSuccess: (outcome) => {
      setMade(outcome)
      void client.invalidateQueries({ queryKey: systemKeys.users() })
    },
  })

  const create = mode === "link" ? createLinks : createAccounts

  function reset() {
    setMode("link")
    setRows([draftPerson(defaultUnitId)])
    setPasting(false)
    setPasteText("")
    setIssued(null)
    setNumbers({})
    setMade(null)
    createLinks.reset()
    createAccounts.reset()
  }

  function close() {
    reset()
    onClose()
  }

  function addPasted() {
    const pasted = parsePaste(pasteText, mode, roleList, unitList)
    if (pasted.length === 0) return
    const empty = rows.length === 1 && rows[0].name.trim() === ""
    setRows(empty ? pasted : [...rows, ...pasted])
    setPasteText("")
    setPasting(false)
  }

  function switchTo(next: Mode) {
    setMode(next)
    if (next === "password") {
      setRows(
        rows.map((row) =>
          row.usernameSet || row.username !== ""
            ? row
            : { ...row, username: suggestUsername(row.name) }
        )
      )
    }
  }

  const finished = issued !== null || made !== null
  const count = eligible.length
  const verb =
    mode === "link"
      ? count > 1
        ? `Create ${count} links`
        : "Create link"
      : count > 1
        ? `Create ${count} accounts`
        : "Create account"

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
      size="wide"
      title={
        issued !== null
          ? "Send these links"
          : made !== null
            ? "Accounts created"
            : "Add account"
      }
      dirty={!finished && rows.some((row) => row.name.trim() !== "")}
      footer={
        finished ? (
          <SheetFooter
            start={
              <>
                <CopyAllButton
                  text={
                    issued !== null
                      ? issued
                          .map((one) => `${one.name} — ${one.link}`)
                          .join("\n")
                      : (made?.created ?? [])
                          .map(
                            (one) =>
                              `${one.name} — ${one.username} / ${one.password}`
                          )
                          .join("\n")
                  }
                />
                <Button
                  variant="ghost"
                  onClick={() =>
                    issued !== null
                      ? download("central-links.csv", [
                          [
                            "name",
                            "job role",
                            "unit",
                            "whatsapp",
                            "link",
                            "expires",
                          ],
                          ...issued.map((one) => [
                            one.name,
                            roleList.find((role) => role.code === one.role_code)
                              ?.name ?? one.role_code,
                            unitList.find((unit) => unit.id === one.unit_id)
                              ?.name ?? one.unit_id,
                            numbers[one.invitation_id] ?? "",
                            one.link,
                            moment(one.expires_at),
                          ]),
                        ])
                      : download("central-accounts.csv", [
                          ["name", "job role", "username", "password"],
                          ...(made?.created ?? []).map((one) => [
                            one.name,
                            one.roleName,
                            one.username,
                            one.password,
                          ]),
                        ])
                  }
                >
                  <Download /> Download CSV
                </Button>
              </>
            }
            primary={{ label: "Done", onClick: close }}
          />
        ) : (
          <SheetFooter
            onCancel={close}
            error={create.error}
            primary={{
              label: verb,
              pendingLabel: "Creating…",
              pending: create.isPending,
              disabled: !everyReady || !canWrite,
              onClick: () => create.mutate(),
            }}
          />
        )
      }
    >
      {issued !== null ? (
        <LinksList
          items={issued}
          roles={roleList}
          units={unitList}
          numbers={numbers}
        />
      ) : made !== null ? (
        <CreatedList outcome={made} />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[0.9375rem] font-medium text-text">How</span>
            <Segmented
              options={[
                { value: "link", label: "Send a link" },
                { value: "password", label: "Set a password" },
              ]}
              value={mode}
              onChange={switchTo}
            />
          </div>
          <Composer
            rows={rows}
            mode={mode}
            onChange={setRows}
            roles={roleList}
            units={unitList}
            hitOf={hitOf}
            takenOf={takenOf}
          />
          <div className="flex flex-col gap-2">
            <button
              type="button"
              aria-expanded={pasting}
              onClick={() => setPasting((on) => !on)}
              className="flex w-fit items-center gap-1 rounded-inner text-[0.9375rem] font-medium text-accent transition-colors hover:text-cta-hover"
            >
              Paste from a spreadsheet
              <ChevronDown
                className={cn(
                  "size-4 transition-transform duration-(--t-panel) ease-(--ease-out)",
                  pasting && "rotate-180"
                )}
              />
            </button>
            {pasting && (
              <div className="flex flex-col gap-2">
                <Textarea
                  rows={5}
                  value={pasteText}
                  onChange={(event) => setPasteText(event.target.value)}
                  aria-label="Rows to paste"
                  placeholder={
                    mode === "link"
                      ? "Name, Job role, Unit, WhatsApp number — one person per line"
                      : "Name, Job role, Username, Password — one person per line"
                  }
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={pasteText.trim() === ""}
                    onClick={addPasted}
                  >
                    Add these rows
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Sheet>
  )
}

/// The rows somebody is typing into — a name, a role and a place each, added
/// and removed like `screens/setup/store-list.tsx`'s stores: Enter for a new
/// row, Backspace on an empty one to drop it.
function Composer({
  rows,
  mode,
  onChange,
  roles,
  units,
  hitOf,
  takenOf,
}: {
  rows: readonly DraftPerson[]
  mode: Mode
  onChange: (rows: DraftPerson[]) => void
  roles: readonly JobRole[]
  units: readonly UnitView[]
  hitOf: (name: string) =>
    | {
        readonly username: string | null
        readonly unit_name: string | null
        readonly position: string | null
      }
    | undefined
  takenOf: (username: string) => boolean
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
      {rows.map((row, index) => {
        const hit = hitOf(row.name)
        const said = hit !== undefined && !row.distinct
        const preview = roleAccess(
          roles.find((role) => role.code === row.roleCode)
        )
        const taken = mode === "password" && takenOf(row.username)
        return (
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
                    onChange={(event) =>
                      set(index, {
                        name: event.target.value,
                        distinct: false,
                        problem: "",
                        ...(mode === "password" && !row.usernameSet
                          ? { username: suggestUsername(event.target.value) }
                          : {}),
                      })
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault()
                        insert(index + 1)
                      } else if (
                        event.key === "Backspace" &&
                        row.name === "" &&
                        rows.length > 1
                      ) {
                        event.preventDefault()
                        remove(index)
                      }
                    }}
                  />
                </Field>

                {said && (
                  <Banner
                    tone={hit.username ? "bad" : "warn"}
                    className="col-span-2"
                  >
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="min-w-0 flex-1">
                        {hit.username
                          ? `${row.name.trim()} already has the login ${hit.username}.`
                          : `${row.name.trim()} is already in HR${hit.unit_name ? ` at ${hit.unit_name}` : ""}, with no login. Give that record a login from People.`}
                      </span>
                      <Button
                        size="sm"
                        variant="quiet"
                        onClick={() => set(index, { distinct: true })}
                      >
                        Different person
                      </Button>
                    </span>
                  </Banner>
                )}

                <Field
                  label="Job role"
                  required
                  className={mode === "password" ? "col-span-2" : undefined}
                >
                  <Select
                    value={row.roleCode}
                    onChange={(next) =>
                      set(index, { roleCode: next, problem: "" })
                    }
                  >
                    {roles.map((role) => (
                      <option key={role.code} value={role.code}>
                        {role.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                {mode === "link" && (
                  <Field label="Unit" required>
                    <Select
                      value={row.unitId}
                      onChange={(next) =>
                        set(index, { unitId: next, problem: "" })
                      }
                    >
                      {units.map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unitLabel(unit)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}

                {row.problem !== "" && (
                  <p className="col-span-2 text-[0.9375rem] text-bad-fg">
                    {row.problem}
                  </p>
                )}
                {row.problem === "" && preview !== null && (
                  <p
                    className={cn(
                      "col-span-2 text-[0.9375rem]",
                      preview.tone === "warn" ? "text-warn-fg" : "text-mute"
                    )}
                  >
                    {preview.text}
                  </p>
                )}

                {mode === "link" ? (
                  <>
                    <Field
                      label="WhatsApp number"
                      required
                      problem={
                        row.phone.replace(/\D/g, "").length >= 7 &&
                        whatsappNumber(row.phone) === null
                          ? "Use a number like 0812 3456 7890."
                          : undefined
                      }
                    >
                      <Input
                        type="tel"
                        keyboard
                        autoComplete="off"
                        placeholder="0812 3456 7890"
                        value={row.phone}
                        onChange={(event) =>
                          set(index, { phone: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Position">
                      <Input
                        value={row.position}
                        onChange={(event) =>
                          set(index, { position: event.target.value })
                        }
                      />
                    </Field>
                  </>
                ) : (
                  <>
                    <Field
                      label="Username"
                      required
                      problem={taken ? "That username is taken." : undefined}
                    >
                      <Input
                        autoComplete="off"
                        spellCheck={false}
                        value={row.username}
                        onChange={(event) =>
                          set(index, {
                            username: event.target.value
                              .toLowerCase()
                              .replace(/[^a-z0-9._-]/g, ""),
                            usernameSet: true,
                          })
                        }
                      />
                    </Field>
                    <Field
                      label="Password"
                      required
                      aside={
                        <button
                          type="button"
                          onClick={() =>
                            set(index, { password: generatePassword() })
                          }
                          className="rounded-inner font-medium text-accent hover:text-cta-hover"
                        >
                          Generate
                        </button>
                      }
                      hint={
                        row.password.length > 0 &&
                        row.password.length < MIN_PASSWORD
                          ? `${MIN_PASSWORD} or more characters.`
                          : undefined
                      }
                    >
                      <Secret
                        value={row.password}
                        onChange={(event) =>
                          set(index, { password: event.target.value })
                        }
                      />
                    </Field>
                  </>
                )}
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
          </div>
        )
      })}
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
function LinksList({
  items,
  roles,
  units,
  numbers,
}: {
  items: readonly IssuedInvitation[]
  roles: readonly JobRole[]
  units: readonly UnitView[]
  numbers: Readonly<Record<string, string>>
}) {
  return (
    <div className="flex flex-col gap-3.5">
      <Banner tone="warn">Each link is shown only once. Send it now.</Banner>
      <div className="flex flex-col gap-2.5">
        {items.map((item) => (
          <LinkCard
            key={item.invitation_id}
            item={item}
            number={numbers[item.invitation_id]}
            roleName={
              roles.find((role) => role.code === item.role_code)?.name ??
              item.role_code
            }
            unitName={
              units.find((unit) => unit.id === item.unit_id)?.name ??
              item.unit_id
            }
          />
        ))}
      </div>
    </div>
  )
}

function LinkCard({
  item,
  number,
  roleName,
  unitName,
}: {
  item: IssuedInvitation
  number: string | undefined
  roleName: string
  unitName: string
}) {
  const [qr, setQr] = useState(false)
  const [opened, setOpened] = useState(false)
  return (
    <div className="flex flex-col gap-2 rounded-card border border-hairline-2 bg-canvas p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 leading-tight">
          <b className="block truncate text-cell font-semibold text-ink">
            {item.name}
          </b>
          <span className="block truncate text-[0.9375rem] text-mute">
            {roleName} · {unitName}
            {number ? ` · +${number}` : ""}
          </span>
        </span>
        <span className="shrink-0 text-meta text-mute">
          Expires {moment(item.expires_at)} · 72 h
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-inner bg-soft-2 px-2.5 py-2 font-mono text-id text-body max-md:basis-full">
          {item.link}
        </code>
        <WhatsAppLinkButton
          link={item.link}
          name={item.name}
          number={number}
          opened={opened}
          onOpen={() => setOpened(true)}
        />
        <CopyButton text={item.link} />
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={qr}
          onClick={() => setQr((on) => !on)}
          className="shrink-0"
        >
          <QrCode className="size-3.5" /> QR
        </Button>
      </div>
      {qr && <LinkQr link={item.link} />}
    </div>
  )
}

/// The link drawn as a code, for a phone held up to this screen.
function LinkQr({ link }: { link: string }) {
  const [svg, setSvg] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void QRCode.toString(link, { type: "svg", margin: 1, width: 160 }).then(
      (drawn) => {
        if (alive) setSvg(drawn)
      }
    )
    return () => {
      alive = false
    }
  }, [link])
  if (svg === null) return null
  return (
    <div
      role="img"
      aria-label="QR code of the link"
      className="size-40 self-start rounded-inner border border-hairline bg-white p-1.5"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

/// Logins made with a password, shown once; and any that were refused, with
/// the server's own sentence.
function CreatedList({ outcome }: { outcome: Outcome }) {
  return (
    <div className="flex flex-col gap-3.5">
      {outcome.created.length > 0 && (
        <Banner tone="warn">Passwords are shown only once.</Banner>
      )}
      {outcome.failed.map((one) => (
        <Banner key={one.name} tone="bad">
          {one.name} was not created. {one.reason}
        </Banner>
      ))}
      <div className="flex flex-col gap-2.5">
        {outcome.created.map((one) => (
          <div
            key={one.username}
            className="flex flex-col gap-2 rounded-card border border-hairline-2 bg-canvas p-3.5"
          >
            <span className="leading-tight">
              <b className="block truncate text-cell font-semibold text-ink">
                {one.name}
              </b>
              <span className="block truncate text-[0.9375rem] text-mute">
                {one.roleName} · no employee record
              </span>
            </span>
            <div className="flex items-center gap-2">
              <dl className="grid min-w-0 flex-1 grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[0.9375rem]">
                <dt className="text-mute">Username</dt>
                <dd className="font-mono break-all text-ink">{one.username}</dd>
                <dt className="text-mute">Password</dt>
                <dd className="font-mono break-all text-ink">{one.password}</dd>
              </dl>
              <CopyButton
                text={`Username: ${one.username}\nPassword: ${one.password}`}
              />
            </div>
            {one.note && (
              <p className="text-[0.9375rem] text-warn-fg">{one.note}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/// Copy, and say so for a few seconds — the same feedback
/// `screens/workplace/vault-tile.tsx` uses for a file link, kept local rather
/// than a toast because several of these can sit on one screen at once.
function CopyButton({
  text,
  label = "Copy",
}: {
  text: string
  label?: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="sm"
      variant={copied ? "quiet" : "ghost"}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
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
          <Copy className="size-3.5" /> {label}
        </>
      )}
    </Button>
  )
}

export function CopyLinkButton({ link }: { link: string }) {
  return <CopyButton text={link} />
}

/// Every link or login of the batch at once, one per line — for a message that
/// goes to the people who hand them out.
function CopyAllButton({ text }: { text: string }) {
  return <CopyButton text={text} label="Copy all" />
}

/// Hand the link to WhatsApp: `wa.me` with no number opens its own "send to"
/// picker, the message already written. A link out, not a button — it goes
/// somewhere — styled as the quiet partner of Copy. The message is Indonesian
/// because it is read by the person invited, in their chat, not on a screen
/// of ours.
export function WhatsAppLinkButton({
  link,
  name,
  number,
  opened = false,
  onOpen,
}: {
  link: string
  name?: string | null
  /// Digits with the country code. Without it WhatsApp asks who to send to,
  /// which is what a renewed link on the Invitations screen still does.
  number?: string | null
  /// The message has been opened in WhatsApp.
  opened?: boolean
  onOpen?: () => void
}) {
  const greeting = name?.trim() ? `Halo ${name.trim()}, ini` : "Ini"
  const text = `${greeting} link untuk masuk ke Central. Berlaku 72 jam, sekali pakai:\n${link}`
  return (
    <a
      href={`https://wa.me/${number ?? ""}?text=${encodeURIComponent(text)}`}
      target="_blank"
      rel="noreferrer"
      onClick={onOpen}
      className={button({
        variant: opened ? "quiet" : number ? "primary" : "ghost",
        size: "sm",
        className: "shrink-0",
      })}
    >
      {opened ? (
        <>
          <Check className="size-3.5" /> Opened in WhatsApp
        </>
      ) : (
        <>
          <MessageCircle className="size-3.5" />{" "}
          {number ? "Send on WhatsApp" : "WhatsApp"}
        </>
      )}
    </a>
  )
}
