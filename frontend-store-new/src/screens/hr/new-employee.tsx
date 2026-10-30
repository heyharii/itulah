import { useRef, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Field, Input, Money, Select, Textarea } from "@/components/ui/field"
import {
  PeopleSheet,
  SheetFoot,
  SheetSection,
} from "@/components/ui/people-sheet"
import { Segmented } from "@/components/ui/segmented"
import { Banner } from "@/components/ui/states"
import { useSendNewEmployee } from "@/lib/queries/employee"
import { isoDay, type StoreScope } from "@/lib/queries/hr"
import { PAPER_KINDS } from "@/lib/queries/papers"
import { usePositions } from "@/lib/queries/staff"
import { describeCentre } from "@/screens/hr/centre"
import {
  blankDraft,
  pickedScans,
  type PersonalDraft,
} from "@/screens/hr/person-draft"
import { PapersFields, PersonalFields } from "@/screens/hr/person-form"
import { parseMoneyToMinor } from "@itulah/contract/money"

/// *New Employee* — the shop keys a person in, and head office approves them.
///
/// The hub's *Add employee* (`add-employee.tsx`) writes the whole record at
/// once: that is head office's. A shop files a **hire proposal** instead, with
/// the person's dossier on it, and nothing exists as an employee until head
/// office approves it and opens the record:
///
///  1. `POST /api/v1/hire-proposals` — the name, the post, the start day, the
///     contract, what the shop thinks the post is worth, and why;
///  2. `POST /api/v1/files` for each scan, as a raw body;
///  3. `PUT /api/v1/hire-proposals/{id}/dossier` — NIK, date of birth, address,
///     contact, the detail set and the scans, by file id.
///
/// Until it is approved the person is a *Waiting for HO* row on Staff. They are
/// not an employee, so nothing can schedule them: the roster lists employees.
///
/// # Validation is on Send, not before
///
/// The button is never greyed. A form whose button is dead until some unnamed
/// field is right leaves a person hunting for the reason; this one answers the
/// press with a red line under every field that is wrong and puts the cursor
/// in the first.
///
/// # What is not asked
///
/// **The employee number**, the **unit** (this shop), the **grade**, the **PTKP
/// status**, the **BPJS numbers**, **NPWP** and the **bank account** — those are
/// head office's, added on the person's page there. **Pay** is asked for one
/// reason only: the centre will not take a proposal without a base pay above
/// zero. The shop never reads anybody's pay back; this is what it thinks the
/// post is worth, for head office to correct.
export function NewEmployeeSheet({
  scope,
  onClose,
}: {
  scope: StoreScope
  onClose: () => void
}) {
  const positions = usePositions()
  const send = useSendNewEmployee(scope)
  const form = useRef<HTMLDivElement>(null)
  /// The proposal an earlier try already filed, so a retry only finishes the
  /// papers instead of filing the person twice.
  const [filed, setFiled] = useState<string | null>(null)

  const [draft, setDraft] = useState<PersonalDraft>(blankDraft)
  const [position, setPosition] = useState("")
  const [startOn, setStartOn] = useState("")
  const [kind, setKind] = useState<"PKWT" | "PKWTT">("PKWT")
  const [endsOn, setEndsOn] = useState("")
  const [need, setNeed] = useState<"ADDITION" | "REPLACEMENT">("ADDITION")
  const [pay, setPay] = useState("")
  const [reason, setReason] = useState("")
  const [problems, setProblems] = useState<Record<string, string>>({})

  /// A field that has been touched stops being red: the person is answering it.
  const clear = (...keys: string[]) =>
    setProblems((was) => {
      if (!keys.some((key) => key in was)) return was
      const next = { ...was }
      for (const key of keys) delete next[key]
      return next
    })
  /// The shared form hands back the whole draft; what differs is what was
  /// touched.
  const touch = (next: PersonalDraft) => {
    const touched: string[] = []
    for (const key of ["full_name", "nik", "birth_date", "address"] as const)
      if (next[key] !== draft[key]) touched.push(key)
    for (const key of [
      "birth_place",
      "gender",
      "religion",
      "marital_status",
    ] as const)
      if (next.details[key] !== draft.details[key]) touched.push(key)
    if (
      next.details.emergency_name !== draft.details.emergency_name ||
      next.details.emergency_phone !== draft.details.emergency_phone
    )
      touched.push("emergency")
    for (const kind of Object.keys(next.papers))
      if (next.papers[kind] !== draft.papers[kind])
        touched.push(`paper_${kind}`)
    setDraft(next)
    clear(...touched)
  }

  const submit = () => {
    const found: Record<string, string> = {}
    const payMinor = parseMoneyToMinor(pay)
    const d = draft.details
    if (draft.full_name.trim().length < 3)
      found.full_name = "Enter the full name"
    if (!/^\d{16}$/.test(draft.nik.trim())) found.nik = "Sixteen digits"
    if (d.birth_place.trim() === "")
      found.birth_place = "Enter the place of birth"
    if (draft.birth_date === "") found.birth_date = "Pick the date of birth"
    if (d.gender === "") found.gender = "Choose one"
    if (d.religion === "") found.religion = "Choose one"
    if (d.marital_status === "") found.marital_status = "Choose one"
    if (draft.address.trim() === "") found.address = "Enter the street"
    const named = (d.emergency_name ?? "").trim() !== ""
    const rung = (d.emergency_phone ?? "").trim() !== ""
    if (named !== rung) found.emergency = "A contact needs a name and a number"
    if (position === "") found.position = "Choose a position"
    if (startOn === "") found.startOn = "Pick the join date"
    if (kind === "PKWT") {
      if (endsOn === "") found.endsOn = "Pick the end date"
      else if (startOn !== "" && endsOn <= startOn)
        found.endsOn = "Must be after the join date"
    }
    if (payMinor === null || payMinor <= 0) found.pay = "Enter the proposed pay"
    for (const paper of PAPER_KINDS)
      if (paper.required && draft.papers[paper.kind] === undefined)
        found[`paper_${paper.kind}`] = "Attach the scan"
    if (reason.trim() === "") found.reason = "Say why this hire is needed"

    setProblems(found)
    if (Object.keys(found).length > 0) {
      // After the red lines are drawn: only then does a field say it is
      // invalid, and the first of them is where the cursor goes.
      window.requestAnimationFrame(() =>
        form.current
          ?.querySelector<HTMLElement>('[aria-invalid="true"]')
          ?.focus(),
      )
      return
    }

    send.mutate(
      {
        existing: filed,
        onFiled: setFiled,
        terms: {
          place: scope.unit_id,
          position,
          headcount: 1,
          need,
          candidateName: draft.full_name.trim(),
          startOn,
          contractKind: kind,
          contractEndsOn: kind === "PKWT" ? endsOn : undefined,
          basePayMinor: payMinor ?? 0,
          reason: reason.trim(),
        },
        dossier: {
          nik: draft.nik.trim(),
          birth_date: draft.birth_date,
          address: draft.address.trim(),
          phone: draft.phone.trim() === "" ? null : draft.phone.trim(),
          email: draft.email.trim() === "" ? null : draft.email.trim(),
          details: draft.details,
        },
        scans: pickedScans(draft.papers),
        reason: reason.trim(),
      },
      {
        onSuccess: () => {
          toast("Sent to head office")
          onClose()
        },
      },
    )
  }

  const problem =
    send.error === null
      ? null
      : filed !== null
        ? `The request is with head office, but the papers did not go up. ${describeCentre(send.error)} Send again to finish them.`
        : describeCentre(send.error)

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="New Employee"
      sub="Head office approves the employee"
      foot={
        <div className="flex flex-col gap-3">
          {problem !== null && <Banner tone="bad">{problem}</Banner>}
          <SheetFoot>
            <Button variant="quiet" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" pending={send.isPending} onClick={submit}>
              {send.isPending ? "Sending…" : "Send to HO"}
            </Button>
          </SheetFoot>
        </div>
      }
    >
      <div ref={form}>
        <PersonalFields
          draft={draft}
          onDraft={touch}
          problems={problems}
          strict
        />

        <SheetSection title="Employment">
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
              <Field label="Position" required problem={problems.position}>
                <Select
                  value={position}
                  onChange={(value) => {
                    setPosition(value)
                    clear("position")
                  }}
                >
                  <option value="">Choose…</option>
                  {(positions.data ?? []).map((one) => (
                    <option key={one.name} value={one.name}>
                      {one.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Join Date" required problem={problems.startOn}>
                <Input
                  type="date"
                  value={startOn}
                  onChange={(event) => {
                    setStartOn(event.target.value)
                    clear("startOn")
                    clear("endsOn")
                  }}
                />
              </Field>
              <Field label="Contract" required>
                <Select
                  value={kind}
                  onChange={(value) => {
                    setKind(value === "PKWTT" ? "PKWTT" : "PKWT")
                    clear("endsOn")
                  }}
                >
                  <option value="PKWT">PKWT · fixed term</option>
                  <option value="PKWTT">PKWTT · permanent</option>
                </Select>
              </Field>
              {kind === "PKWT" && (
                <Field label="Contract Ends" required problem={problems.endsOn}>
                  <Input
                    type="date"
                    value={endsOn}
                    min={startOn === "" ? isoDay(new Date()) : startOn}
                    onChange={(event) => {
                      setEndsOn(event.target.value)
                      clear("endsOn")
                    }}
                  />
                </Field>
              )}
            </div>
            <Field label="Because It Is" required>
              <Segmented
                options={[
                  { value: "ADDITION", label: "A new post" },
                  { value: "REPLACEMENT", label: "A replacement" },
                ]}
                value={need}
                onChange={setNeed}
              />
            </Field>
          </div>
        </SheetSection>

        <SheetSection title="Pay">
          <Field label="Proposed Pay" required problem={problems.pay}>
            <Money
              prefix="Rp"
              value={pay}
              onChange={(digits) => {
                setPay(digits)
                clear("pay")
              }}
            />
          </Field>
        </SheetSection>

        <PapersFields
          draft={draft}
          onDraft={touch}
          problems={problems}
          strict
        />

        <SheetSection title="Note to HO">
          <Field label="Why" required problem={problems.reason}>
            <Textarea
              rows={3}
              value={reason}
              placeholder="Why this hire"
              onChange={(event) => {
                setReason(event.target.value)
                clear("reason")
              }}
            />
          </Field>
        </SheetSection>
      </div>
    </PeopleSheet>
  )
}
