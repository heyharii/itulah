import { useMemo, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Field, Textarea } from "@/components/ui/field"
import { PeopleSheet, SheetFoot } from "@/components/ui/people-sheet"
import { Banner } from "@/components/ui/states"
import { useChangeData } from "@/lib/queries/employee"
import { describeCentre } from "@/screens/hr/centre"
import {
  changesOf,
  detailsIncomplete,
  draftOf,
  pickedScans,
  type PersonalDraft,
} from "@/screens/hr/person-draft"
import { PapersFields, PersonalFields } from "@/screens/hr/person-form"
import type { EmployeeDossierView } from "@itulah/contract"

/// *Change Data* — the shop corrects a person's file, and head office takes it.
///
/// The hub's *Edit* sheet (`employee-page.tsx`), as a store sees it: the same
/// fields, but nothing is written. The change goes up as one data update
/// (`POST /api/v1/employees/{id}/data-updates`) carrying only the fields that
/// differ, the detail set when it differs, and the scans picked; the person's
/// file is unchanged until head office takes it or sends it back. While one
/// waits the page says so and offers Withdraw instead of this.
export function ChangeDataSheet({
  employeeId,
  dossier,
  onClose,
}: {
  employeeId: string
  dossier: EmployeeDossierView | undefined
  onClose: () => void
}) {
  const send = useChangeData(employeeId)
  const original = useMemo(() => draftOf(dossier), [dossier])
  const [draft, setDraft] = useState<PersonalDraft>(original)
  const [reason, setReason] = useState("")

  const { personal, touched, detailsChanged } = changesOf(draft, original)
  const scans = pickedScans(draft.papers)
  // The detail set is one revision: once it changes, its required parts go
  // together.
  const incomplete = detailsChanged && detailsIncomplete(draft.details)
  const ready =
    (touched > 0 || detailsChanged || scans.length > 0) &&
    !incomplete &&
    reason.trim() !== ""

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Change Data"
      sub="Head office takes the change"
      foot={
        <div className="flex flex-col gap-3">
          {incomplete && (
            <Banner tone="warn">
              Place of birth, gender, religion and marital status go together,
              and an emergency contact needs a name and a number.
            </Banner>
          )}
          {send.error !== null && (
            <Banner tone="bad">{describeCentre(send.error)}</Banner>
          )}
          <SheetFoot>
            <Button variant="quiet" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              pending={send.isPending}
              disabled={!ready}
              onClick={() =>
                send.mutate(
                  {
                    personal,
                    details: detailsChanged ? draft.details : null,
                    scans,
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
            >
              {send.isPending ? "Sending…" : "Send to HO"}
            </Button>
          </SheetFoot>
        </div>
      }
    >
      <PersonalFields draft={draft} onDraft={setDraft} />
      <PapersFields draft={draft} onDraft={setDraft} />
      <Field label="Why" required>
        <Textarea
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
    </PeopleSheet>
  )
}
