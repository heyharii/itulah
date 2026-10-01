import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Day } from "@/components/ui/day"
import { Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { PickOne } from "@/components/ui/pick"
import { KeyValue, MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { EmptyState } from "@/components/ui/states"
import { day } from "@/lib/format"
import { orgCompany, orgKeys, registerBpjs } from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useCanWrite } from "@/lib/session"
import { FormSheet } from "@/screens/people/settings-parts"
import { useSheetTarget } from "@/screens/people/settings-hooks"
import type { CompanyView } from "@itulah/contract"

/// Settings › Company: who the company is, and its BPJS registration over
/// time. Name, address and NPWP are the company's own, set in System › Setup;
/// the BPJS numbers are stated here, from a date, and the history is kept.
export function CompanySettings() {
  const canWrite = useCanWrite()
  const company = useQuery({
    queryKey: orgKeys.company(),
    queryFn: ({ signal }) => orgCompany(signal),
  })
  const sheet = useSheetTarget<null>()

  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="Company"
        sub="Who the company is, and the BPJS numbers it is registered under."
        actions={
          canWrite && (
            <Button variant="primary" onClick={() => sheet.show(null)}>
              Update BPJS registration
            </Button>
          )
        }
      />
      {queryState(company, {
        loading: "Reading the company…",
        render: (view) => {
          const current = view.bpjs[0]
          return (
            <>
              <Card className="mb-4">
                <CardHeader>
                  <CardTitle>Company</CardTitle>
                </CardHeader>
                <div className="px-4 pb-4">
                  <KeyValue term="Name">
                    {[view.legal_form, view.name].filter(Boolean).join(" ") ||
                      "—"}
                  </KeyValue>
                  <KeyValue term="Address">{view.address ?? "—"}</KeyValue>
                  <KeyValue term="NPWP">{view.tax_id ?? "—"}</KeyValue>
                  <KeyValue term="NPP BPJS Ketenagakerjaan">
                    {current?.npp ?? "not stated"}
                  </KeyValue>
                  <KeyValue term="Kode badan usaha BPJS Kesehatan">
                    {current?.kesehatan_code ?? "not stated"}
                  </KeyValue>
                  <KeyValue term="JKK risk class">
                    {current?.jkk_risk_class ?? "not stated"}
                  </KeyValue>
                  <p className="mt-2 text-[0.875rem] text-mute">
                    Name, address and NPWP are the company&rsquo;s own, set in
                    System › Setup.
                  </p>
                </div>
              </Card>
              <Card className="mb-4">
                <CardHeader>
                  <CardTitle>BPJS registration history</CardTitle>
                </CardHeader>
                <div className="px-4 pb-4">
                  {view.bpjs.length === 0 ? (
                    <EmptyState>
                      No BPJS registration stated yet. Use Update BPJS
                      registration to state the numbers from a date.
                    </EmptyState>
                  ) : (
                    <MiniTable
                      head={[
                        { label: "From", align: "left" },
                        { label: "NPP", align: "left" },
                        { label: "Kesehatan", align: "left" },
                        { label: "JKK", align: "left" },
                        { label: "By", align: "left" },
                      ]}
                    >
                      {view.bpjs.map((row) => (
                        <MiniRow key={row.effective_from}>
                          <MiniCell>{day(row.effective_from)}</MiniCell>
                          <MiniCell>{row.npp ?? "—"}</MiniCell>
                          <MiniCell>{row.kesehatan_code ?? "—"}</MiniCell>
                          <MiniCell>{row.jkk_risk_class ?? "—"}</MiniCell>
                          <MiniCell>{row.registered_by}</MiniCell>
                        </MiniRow>
                      ))}
                    </MiniTable>
                  )}
                </div>
              </Card>
              <BpjsSheet
                key={sheet.target.id}
                open={sheet.open}
                onClose={sheet.close}
                view={view}
              />
            </>
          )
        },
      })}
    </PageContent>
  )
}

function BpjsSheet({
  open,
  onClose,
  view,
}: {
  open: boolean
  onClose: () => void
  view: CompanyView
}) {
  const client = useQueryClient()
  const current = view.bpjs[0]
  const [from, setFrom] = useState("")
  const [npp, setNpp] = useState(current?.npp ?? "")
  const [kesehatan, setKesehatan] = useState(current?.kesehatan_code ?? "")
  const [risk, setRisk] = useState<string | null>(
    current?.jkk_risk_class ?? null
  )
  const [reason, setReason] = useState("")
  const save = useMutation({
    mutationFn: () =>
      registerBpjs({
        effective_from: from,
        npp: npp.trim() === "" ? null : npp.trim(),
        kesehatan_code: kesehatan.trim() === "" ? null : kesehatan.trim(),
        jkk_risk_class: risk,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: orgKeys.company() })
      onClose()
    },
  })

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title="Update BPJS registration"
      error={save.error}
      saveLabel="Save registration"
      saving={save.isPending}
      canSave={from !== "" && reason.trim() !== ""}
      onSave={() => save.mutate()}
    >
      <p className="text-[0.875rem] text-mute">
        State the numbers from a date. Earlier months keep the registration they
        were paid under.
      </p>
      <Field label="From" required>
        <Day value={from} onChange={setFrom} />
      </Field>
      <Field label="NPP BPJS Ketenagakerjaan">
        <Input value={npp} onChange={(e) => setNpp(e.target.value)} />
      </Field>
      <Field label="Kode badan usaha BPJS Kesehatan">
        <Input
          value={kesehatan}
          onChange={(e) => setKesehatan(e.target.value)}
        />
      </Field>
      <Field label="JKK risk class">
        <PickOne
          label="JKK risk class"
          placeholder="Choose…"
          choices={["I", "II", "III", "IV", "V"].map((one) => ({
            value: one,
            label: one,
          }))}
          value={risk}
          onChange={setRisk}
        />
      </Field>
      <Field label="Why" required>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </FormSheet>
  )
}
