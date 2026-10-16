import { useRef, useState } from "react"

import { Field, Input, Money, Select, Textarea } from "@/components/ui/field"
import { PeopleSheet } from "@/components/ui/people-sheet"
import { Segmented } from "@/components/ui/segmented"
import { isoDay, type StoreScope } from "@/lib/queries/hr"
import { usePositions, useRequestStaff } from "@/lib/queries/staff"
import { Submit } from "@/screens/hr/parts"
import { parseMoneyToMinor } from "@itulah/contract/money"

/// *Request new staff* — the store asks head office for a person.
///
/// "Head office adds the employee": this form creates nothing. It files a hire
/// proposal (`POST /hire-proposals`); head office decides it, and an approval
/// is what lets head office open the person's record and give them a number.
///
/// # Validation is on Send, not before
///
/// The Send button is never greyed. A form whose button is dead until some
/// unnamed field is right leaves a person hunting for the reason; this one
/// answers the press with a red line under every field that is wrong and puts
/// the cursor in the first. (The prototype's behaviour, kept.)
///
/// # What it asks, and why not more
///
/// The proposal holds a name, a position, a start date, a contract, the
/// proposed pay and a reason, and this asks for those. The prototype also had
/// the NIK, date of birth, address, phone and email; the centre has nowhere to
/// put them on a proposal (see `lib/queries/staff.ts`), so a field for them
/// would collect what nothing can send.
///
/// **The proposed pay is on the form because the centre will not take a
/// proposal without one** (it refuses a base pay of zero). The store never
/// reads anybody's pay back — it is not on the Staff sheet — this is only what
/// the store thinks the post is worth, for head office to correct.
export function RequestStaffSheet({
  scope,
  onSent,
  onClose,
}: {
  scope: StoreScope
  /// Called once head office has the request, before the sheet closes.
  onSent: () => void
  onClose: () => void
}) {
  const positions = usePositions()
  const request = useRequestStaff(scope)
  const form = useRef<HTMLDivElement>(null)

  const [name, setName] = useState("")
  const [position, setPosition] = useState("")
  const [startOn, setStartOn] = useState("")
  const [kind, setKind] = useState<"PKWT" | "PKWTT">("PKWT")
  const [endsOn, setEndsOn] = useState("")
  const [need, setNeed] = useState<"ADDITION" | "REPLACEMENT">("ADDITION")
  const [pay, setPay] = useState("")
  const [reason, setReason] = useState("")
  const [problems, setProblems] = useState<Record<string, string>>({})

  /// A field that has been touched stops being red: the person is answering it.
  const clear = (key: string) =>
    setProblems((was) => {
      if (!(key in was)) return was
      const next = { ...was }
      delete next[key]
      return next
    })

  const send = () => {
    const found: Record<string, string> = {}
    const payMinor = parseMoneyToMinor(pay)
    if (name.trim().length < 3) found.name = "Enter the full name"
    if (position === "") found.position = "Choose a position"
    if (startOn === "") found.startOn = "Pick the join date"
    if (kind === "PKWT") {
      if (endsOn === "") found.endsOn = "Pick the end date"
      else if (startOn !== "" && endsOn <= startOn)
        found.endsOn = "Must be after the join date"
    }
    if (payMinor === null || payMinor <= 0) found.pay = "Enter the proposed pay"
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

    request.mutate(
      {
        position,
        need,
        name: name.trim(),
        startOn,
        contractKind: kind,
        endsOn: kind === "PKWT" ? endsOn : undefined,
        basePayMinor: payMinor ?? 0,
        reason: reason.trim(),
      },
      {
        onSuccess: () => {
          onSent()
          onClose()
        },
      },
    )
  }

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Request new staff"
      sub="Head office adds the employee"
      foot={
        <Submit
          label="Send to HO"
          pendingLabel="Sending…"
          pending={request.isPending}
          disabled={false}
          error={request.error}
          onSubmit={send}
          onCancel={onClose}
        />
      }
    >
      <div ref={form} className="flex flex-col gap-3">
        <Field label="Full name" required problem={problems.name}>
          <Input
            value={name}
            placeholder="As on the ID card"
            autoComplete="off"
            onChange={(event) => {
              setName(event.target.value)
              clear("name")
            }}
          />
        </Field>

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
          <Field label="Join date" required problem={problems.startOn}>
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
        </div>

        <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
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
            <Field label="Contract ends" required problem={problems.endsOn}>
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

        <Field label="Because it is" required>
          <Segmented
            options={[
              { value: "ADDITION", label: "A new post" },
              { value: "REPLACEMENT", label: "A replacement" },
            ]}
            value={need}
            onChange={setNeed}
          />
        </Field>

        <Field label="Proposed pay" required problem={problems.pay}>
          <Money
            prefix="Rp"
            value={pay}
            onChange={(digits) => {
              setPay(digits)
              clear("pay")
            }}
          />
        </Field>

        <Field label="Note to HO" required problem={problems.reason}>
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
      </div>
    </PeopleSheet>
  )
}
