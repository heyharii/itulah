import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Day } from "@/components/ui/day"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { SubHead } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { Banner } from "@/components/ui/states"
import { useUnits } from "@/lib/queries/organisation"
import {
  addContract,
  agreePay,
  amendPayrollIdentity,
  applyTransition,
  assignToUnit,
  enrolPersonalData,
  peopleKeys,
  registerEmployee,
  type ContractKind,
} from "@/lib/queries/people"

/// Add employee, as Talenta's form does it: one sheet with who they are, where
/// and from when they work, on what contract, and what they are paid.
///
/// # Many acts, one form
///
/// The server keeps each of these as its own dated, signed act — a record
/// opened with a number, personal data enrolled, a hire on a day, a posting,
/// a contract, a pay agreement, a PTKP status — because each can later change
/// on its own and the history has to say which did. This form files them in
/// that order. If one is refused, the ones before it stand, the sheet says
/// which step stopped, and the rest can be finished on the person's sheet.
///
/// This replaced the hire request (`/people/hire`), which the owner dropped
/// with recruitment on 2026-09-30.

const PTKP_STATUSES = [
  "TK/0",
  "TK/1",
  "TK/2",
  "TK/3",
  "K/0",
  "K/1",
  "K/2",
  "K/3",
] as const

interface Draft {
  code: string
  fullName: string
  nik: string
  birthDate: string
  address: string
  joinDate: string
  unitId: string
  contract: ContractKind
  contractEnds: string
  position: string
  grade: string
  base: string
  ptkp: string
}

const EMPTY: Draft = {
  code: "",
  fullName: "",
  nik: "",
  birthDate: "",
  address: "",
  joinDate: "",
  unitId: "",
  contract: "PKWT",
  contractEnds: "",
  position: "",
  grade: "",
  base: "",
  ptkp: "TK/0",
}

export function AddEmployeeSheet({
  open,
  onClose,
  onAdded,
}: {
  open: boolean
  onClose: () => void
  /// The new record's id, so the list can open its sheet.
  onAdded: (employeeId: string) => void
}) {
  const client = useQueryClient()
  const units = useUnits()
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [step, setStep] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft({ ...draft, [key]: value })

  const baseMinor = Number(draft.base.replace(/\D/g, ""))
  const ready =
    draft.code.trim() !== "" &&
    draft.fullName.trim() !== "" &&
    /^\d{16}$/.test(draft.nik.trim()) &&
    draft.birthDate !== "" &&
    draft.address.trim() !== "" &&
    draft.joinDate !== "" &&
    draft.unitId !== "" &&
    draft.position.trim() !== "" &&
    (draft.contract === "PKWTT" || draft.contractEnds !== "") &&
    baseMinor > 0

  async function submit() {
    setPending(true)
    setFailed(null)
    const reason = "karyawan baru"
    let id: string | null = null
    try {
      setStep("Opening the record")
      const record = await registerEmployee(draft.code.trim())
      id = record.employee_id
      setStep("Personal data")
      await enrolPersonalData(id, {
        fullName: draft.fullName.trim(),
        nik: draft.nik.trim(),
        birthDate: draft.birthDate,
        address: draft.address.trim(),
      })
      setStep("Hire")
      await applyTransition(id, "HIRE", draft.joinDate, reason)
      setStep("Posting")
      await assignToUnit(id, draft.unitId, draft.joinDate, reason)
      setStep("Contract")
      await addContract(id, {
        kind: draft.contract,
        startsOn: draft.joinDate,
        endsOn: draft.contract === "PKWT" ? draft.contractEnds : undefined,
        position: draft.position.trim(),
        grade: draft.grade.trim() || "-",
        reason,
      })
      setStep("Pay")
      await agreePay(id, {
        effectiveFrom: draft.joinDate,
        baseMinor,
        allowances: [],
        reason,
      })
      setStep("PTKP")
      await amendPayrollIdentity(id, {
        field: "ptkp",
        value: draft.ptkp,
        effectiveFrom: draft.joinDate,
        reason,
      })
      setStep(null)
      setDraft(EMPTY)
      void client.invalidateQueries({ queryKey: peopleKeys.all })
      onAdded(id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setFailed(
        id === null
          ? message
          : `${message} — the record was opened and the steps before "${step ?? ""}" were saved; finish on the person's sheet.`
      )
      if (id !== null)
        void client.invalidateQueries({ queryKey: peopleKeys.all })
    } finally {
      setPending(false)
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Add employee"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <SubHead>Personal</SubHead>
          <Field label="Employee number" required>
            <Input
              value={draft.code}
              onChange={(e) => set("code", e.target.value)}
            />
          </Field>
          <Field label="Full name" required>
            <Input
              value={draft.fullName}
              onChange={(e) => set("fullName", e.target.value)}
            />
          </Field>
          <Field
            label="NIK"
            required
            problem={
              draft.nik !== "" && !/^\d{16}$/.test(draft.nik.trim())
                ? "Sixteen digits."
                : undefined
            }
          >
            <Input
              keyboard
              inputMode="numeric"
              value={draft.nik}
              onChange={(e) => set("nik", e.target.value)}
            />
          </Field>
          <Field label="Date of birth" required>
            <Day
              value={draft.birthDate}
              onChange={(value) => set("birthDate", value)}
            />
          </Field>
          <Field label="Address" required>
            <Textarea
              value={draft.address}
              onChange={(e) => set("address", e.target.value)}
            />
          </Field>
        </div>

        <div className="flex flex-col gap-3">
          <SubHead>Employment</SubHead>
          <Field label="Join date" required>
            <Day
              value={draft.joinDate}
              onChange={(value) => set("joinDate", value)}
            />
          </Field>
          <Field label="Unit" required>
            <Select
              value={draft.unitId}
              onChange={(value) => set("unitId", value)}
            >
              <option value="">Choose a unit…</option>
              {(units.data ?? []).map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.code} · {unit.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Employment status" required>
            <Select
              value={draft.contract}
              onChange={(value) => set("contract", value as ContractKind)}
            >
              <option value="PKWT">Contract (PKWT)</option>
              <option value="PKWTT">Permanent (PKWTT)</option>
            </Select>
          </Field>
          {draft.contract === "PKWT" && (
            <Field label="Contract ends" required>
              <Day
                value={draft.contractEnds}
                onChange={(value) => set("contractEnds", value)}
              />
            </Field>
          )}
          <Field label="Job position" required>
            <Input
              value={draft.position}
              onChange={(e) => set("position", e.target.value)}
            />
          </Field>
          <Field label="Grade">
            <Input
              value={draft.grade}
              onChange={(e) => set("grade", e.target.value)}
            />
          </Field>
        </div>

        <div className="flex flex-col gap-3">
          <SubHead>Pay</SubHead>
          <Field label="Base salary" aside="rupiah a month" required>
            <Input
              inputMode="numeric"
              value={draft.base}
              onChange={(e) => set("base", e.target.value)}
            />
          </Field>
          <Field label="PTKP status" required>
            <Select value={draft.ptkp} onChange={(value) => set("ptkp", value)}>
              {PTKP_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </Select>
          </Field>
          <p className="text-[0.875rem] text-mute">
            Fixed allowances, BPJS numbers, NPWP and the bank account are added
            on the person's Pay tab.
          </p>
        </div>

        {failed !== null && <Banner tone="bad">{failed}</Banner>}
        {pending && step !== null && <Banner tone="info">{step}…</Banner>}

        <div>
          <Button
            variant="primary"
            pending={pending}
            disabled={!ready}
            onClick={() => void submit()}
          >
            Add employee
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
