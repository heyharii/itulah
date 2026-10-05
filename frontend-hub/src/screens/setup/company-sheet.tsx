import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { SavedDialog } from "@/components/ui/dialog"
import { Field, Input } from "@/components/ui/field"
import { Toggle } from "@/components/ui/form"
import { Sheet } from "@/components/ui/sheet"
import { Problem } from "@/components/ui/states"
import {
  legalFormOf,
  saveCompany,
  setupKeys,
  type LegalForm,
  type SetupCompany,
} from "@/lib/queries/setup"
import { LegalFormPills } from "@/screens/setup/legal-form-pills"
import { companyName } from "@/screens/setup/names"

/// The company's own description, after setup — where the NPWP is entered.
///
/// The wizard does not ask for the NPWP: nothing needs it until the first
/// purchase order is printed, and "Add NPWP" on the home screen opens this
/// when that comes. It is also where a company that existed before the wizard
/// finally says its legal form, which the letterhead never recorded.
///
/// One write for all of it — the same PUT as the wizard's first step, so the
/// letterhead is rewritten from the same answer either way.
export function CompanySheet({
  company,
  open,
  onClose,
}: {
  company: SetupCompany | null
  open: boolean
  onClose: () => void
}) {
  /// The save that went through, held in the receipt dialog until it is read.
  /// State lives here because the form inside is deliberately unmounted on
  /// close — it must start from the saved answer next time.
  const [saved, setSaved] = useState(false)
  return (
    <>
      <Sheet
        open={open && company !== null}
        onOpenChange={(next) => !next && onClose()}
        title="Company"
        caption="Printed on the letterhead, purchase orders and invoices."
      >
        {/* Mounted only while open, so the form starts from the saved answer
            each time rather than from what was typed and abandoned last time. */}
        {company && open && (
          <CompanyForm company={company} onDone={onClose} onSaved={() => setSaved(true)} />
        )}
      </Sheet>
      <SavedDialog
        open={saved}
        onOpenChange={(next) => {
          if (!next) setSaved(false)
        }}
        title="Company saved"
      />
    </>
  )
}

function CompanyForm({
  company,
  onDone,
  onSaved,
}: {
  company: SetupCompany
  onDone: () => void
  /// The save went through; the receipt is the wrapper's to show — this form
  /// unmounts the moment it closes.
  onSaved: () => void
}) {
  const client = useQueryClient()
  const [name, setName] = useState(company.name)
  const [legalForm, setLegalForm] = useState<LegalForm | null>(
    legalFormOf(company.legal_form)
  )
  const [address, setAddress] = useState(company.address)
  const [hasWarehouse, setHasWarehouse] = useState(company.has_warehouse)
  const [taxId, setTaxId] = useState(company.tax_id ?? "")
  const [touched, setTouched] = useState(false)

  const digits = taxId.replace(/\D/g, "")
  const taxProblem =
    touched && digits !== "" && digits.length !== 15 && digits.length !== 16
      ? "NPWP is 16 digits."
      : null
  const nameProblem =
    touched && name.trim() === "" ? "Enter the business name." : null
  const formProblem =
    touched && legalForm === null ? "Choose the legal form." : null
  const addressProblem =
    touched && address.trim() === "" ? "Enter the head office address." : null

  const save = useMutation({
    mutationFn: (form: LegalForm) =>
      saveCompany({
        name: name.trim(),
        legal_form: form,
        address: address.trim(),
        has_warehouse: hasWarehouse,
        tax_id: taxId.trim() === "" ? null : taxId,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: setupKeys.status() })
      onSaved()
      onDone()
    },
  })

  return (
    <div className="flex flex-col gap-5">
      <Field label="Business name" required problem={nameProblem}>
        <Input value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <div className="flex flex-col gap-[0.4375rem]">
        <span className="text-[0.875rem] font-medium text-text">
          Legal form<span className="ml-0.5 text-bad">*</span>
        </span>
        <LegalFormPills value={legalForm} onChange={setLegalForm} />
        {formProblem && (
          <span className="text-[0.875rem] text-bad">{formProblem}</span>
        )}
      </div>
      <Field label="Head office address" required problem={addressProblem}>
        <Input
          value={address}
          onChange={(event) => setAddress(event.target.value)}
        />
      </Field>
      <Field
        label="NPWP"
        aside="16 digits"
        hint="Dots and dashes are fine. A 15-digit number gets its leading zero."
        problem={taxProblem}
      >
        <Input
          inputMode="numeric"
          value={taxId}
          onChange={(event) => setTaxId(event.target.value)}
          className="font-mono"
        />
      </Field>
      <Toggle
        on={hasWarehouse}
        onToggle={() => setHasWarehouse((on) => !on)}
        label="Gudang"
        note={
          hasWarehouse
            ? "Suppliers deliver to the Gudang, and it ships to the stores."
            : "Suppliers deliver straight to the stores."
        }
      />

      {legalForm !== null && name.trim() !== "" && (
        <p className="text-meta text-body">
          Printed as{" "}
          <b className="font-medium text-ink">{companyName(name, legalForm)}</b>
          .
        </p>
      )}

      <Problem error={save.error} />
      <div className="flex justify-end gap-2">
        <Button variant="quiet" onClick={onDone}>
          Cancel
        </Button>
        <Button
          variant="primary"
          pending={save.isPending}
          onClick={() => {
            setTouched(true)
            if (
              legalForm === null ||
              name.trim() === "" ||
              address.trim() === "" ||
              (digits !== "" && digits.length !== 15 && digits.length !== 16)
            )
              return
            save.mutate(legalForm)
          }}
        >
          {save.isPending ? "Submitting…" : "Submit"}
        </Button>
      </div>
    </div>
  )
}
