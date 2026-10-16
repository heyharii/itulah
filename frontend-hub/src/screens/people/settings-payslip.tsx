import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { Suspense, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { useLayout } from "@/lib/layout"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox, Field, Input, Textarea } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { KeyValue } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { Problem } from "@/components/ui/states"
import {
  payKeys,
  savePayslipTemplate,
  payslipTemplateQuery,
} from "@/lib/queries/people"
import { useCanWrite } from "@/lib/session"
import { PageFoot, SheetFooter } from "@/screens/people/settings-kit"
import { useOpener } from "@/screens/people/settings-lib"
import type { PayslipTemplate } from "@itulah/contract"
import { awaiting } from "@/screens/people/awaiting"

/// Settings › Payslip — what the slip says around its figures, whether the
/// employee sees what the company pays on top, and whether opening one's own
/// payslips takes a password of its own.
export function PayslipSettings() {
  const canWrite = useCanWrite()
  const phone = useLayout() === "phone"
  const edit = useOpener()

  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="Payslip"
        sub="What the payslip says around its figures and who may open it."
        actions={
          !phone &&
          canWrite && (
            <Button variant="primary" onClick={() => edit.show()}>
              Edit
            </Button>
          )
        }
      />

      <Card className="mb-4 overflow-hidden">
        <CardHeader>
          <CardTitle>Template</CardTitle>
        </CardHeader>
        <div className="px-4 pb-3">
          {awaiting(payslipTemplateQuery(), {
            loading: "Reading the template…",
            render: (current) => (
              <>
                <KeyValue term="Company name">
                  {current.company_name ?? "—"}
                </KeyValue>
                <KeyValue term="Address">
                  {current.company_address ?? "—"}
                </KeyValue>
                <KeyValue term="Closing note">{current.footer ?? "—"}</KeyValue>
                <KeyValue term="Employees see what the company pays on top">
                  {current.show_company_contributions ? "Yes" : "No"}
                </KeyValue>
                <KeyValue term="Employees open payslips with a password of their own">
                  {current.password_required ? "Yes" : "No"}
                </KeyValue>
              </>
            ),
          })}
        </div>
      </Card>

      {/* The sheet reads the template itself, so the buttons need no answer
          to be enabled: one pressed before it lands opens when it does. */}
      <Suspense fallback={null}>
        <EditSheetOpen key={edit.n} open={edit.isOpen} onClose={edit.hide} />
      </Suspense>
      {canWrite && <PageFoot label="Edit" onClick={() => edit.show()} />}
    </PageContent>
  )
}

function EditSheetOpen({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { data } = useSuspenseQuery(payslipTemplateQuery())
  return <EditSheet open={open} onClose={onClose} current={data} />
}

function EditSheet({
  open,
  onClose,
  current,
}: {
  open: boolean
  onClose: () => void
  current: PayslipTemplate
}) {
  const client = useQueryClient()
  const [name, setName] = useState(current.company_name ?? "")
  const [address, setAddress] = useState(current.company_address ?? "")
  const [footer, setFooter] = useState(current.footer ?? "")
  const [contributions, setContributions] = useState(
    current.show_company_contributions
  )
  const [locked, setLocked] = useState(current.password_required)
  const [reason, setReason] = useState("")
  const blank = (text: string) => (text.trim() === "" ? null : text.trim())

  const save = useMutation({
    mutationFn: () =>
      savePayslipTemplate({
        company_name: blank(name),
        company_address: blank(address),
        footer: blank(footer),
        show_company_contributions: contributions,
        password_required: locked,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: payKeys.payslipTemplate() })
      onClose()
    },
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Edit payslip"
      footer={
        <SheetFooter
          onCancel={onClose}
          onSave={() => save.mutate()}
          saveLabel="Submit"
          pending={save.isPending}
          disabled={reason.trim() === ""}
        />
      }
    >
      <div className="flex flex-col gap-3.5">
        <Problem error={save.error} />
        <Field label="Company name">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Address">
          <Input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
        </Field>
        <Field label="Closing note" aside="printed under the figures">
          <Textarea
            rows={2}
            value={footer}
            onChange={(event) => setFooter(event.target.value)}
          />
        </Field>
        <Checkbox
          label="Show employees what the company pays on top (BPJS share, borne tax)"
          checked={contributions}
          onChange={setContributions}
        />
        <Checkbox
          label="Employees open their payslips with a password of their own"
          hint="Separate from their login. Head office is never asked for it."
          checked={locked}
          onChange={setLocked}
        />
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
