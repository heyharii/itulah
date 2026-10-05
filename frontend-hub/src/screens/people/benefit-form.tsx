import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Field, Input, Money } from "@/components/ui/field"
import { PickOne } from "@/components/ui/pick"
import { Sheet } from "@/components/ui/sheet"
import { Problem } from "@/components/ui/states"
import {
  adjustBenefit,
  BENEFIT_ACTION_LABEL,
  benefitKeys,
  type BenefitAction,
} from "@/lib/queries/hr-benefit"
import { SheetFooter } from "@/screens/people/settings-kit"

const ACTIONS = (Object.keys(BENEFIT_ACTION_LABEL) as BenefitAction[]).map(
  (value) => ({ value, label: BENEFIT_ACTION_LABEL[value] })
)

/// Add to, take off or reset the balance of one or many people, by hand and
/// with a reason. `who` is who it is for; `intro` says so in words.
export function AdjustSheet({
  open,
  onClose,
  employeeIds,
  intro,
  startWith = "ADD",
  picker,
}: {
  open: boolean
  onClose: () => void
  employeeIds: readonly string[]
  intro: React.ReactNode
  startWith?: BenefitAction
  /// When nobody is chosen yet, the caller's own way of choosing.
  picker?: React.ReactNode
}) {
  const client = useQueryClient()
  const [action, setAction] = useState<BenefitAction>(startWith)
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const save = useMutation({
    mutationFn: () =>
      adjustBenefit({
        action,
        amount_minor: Number(amount === "" ? "0" : amount),
        employee_ids: [...employeeIds],
        reason: reason.trim(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: benefitKeys.all() })
      onClose()
    },
  })
  // Resetting to nothing is a figure too; add and take off need something.
  const amountOk = amount !== "" && (action === "RESET" || Number(amount) > 0)

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Fill balances"
      footer={
        <SheetFooter
          onCancel={onClose}
          onSave={() => save.mutate()}
          saveLabel="Submit"
          pending={save.isPending}
          disabled={
            employeeIds.length === 0 || !amountOk || reason.trim() === ""
          }
        />
      }
    >
      <div className="flex flex-col gap-3.5">
        <Problem error={save.error} />
        <p className="text-meta text-body">{intro}</p>
        {picker}
        <Field label="Action" required>
          <PickOne
            label="Action"
            choices={ACTIONS}
            value={action}
            required
            onChange={(next) =>
              next !== null && setAction(next as BenefitAction)
            }
          />
        </Field>
        <Field label="Amount" required>
          <Money
            label="Amount"
            prefix="Rp"
            value={amount}
            onChange={setAmount}
          />
        </Field>
        <Field label="Why" required>
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </div>
    </Sheet>
  )
}
