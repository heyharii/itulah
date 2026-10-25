import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Archive, FileText, Paperclip } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { ConfirmButton } from "@/components/ui/dialog"
import { Field, Input } from "@/components/ui/field"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, LoadingState } from "@/components/ui/states"
import { Meter } from "@/components/ui/meter"
import { compactFormat, day, money, span } from "@/lib/format"
import {
  archiveGaContract,
  gaContractHub,
  gaKeys,
  recordMeterReading,
  updateGaContract,
} from "@/lib/queries/ga"
import { uploadDocument } from "@/lib/queries/workplace"
import { toast } from "@/lib/toast"
import {
  monthLabel,
  siteOf,
  useContractParty,
} from "@/screens/contracts/format"
import { coversAssets } from "@/screens/contracts/claim-words"
import { ClaimSheetHost, PolicyClaimsSection } from "@/screens/contracts/claims"
import { ContractCoversSection } from "@/screens/contracts/covers"
import { StandingPill } from "@/screens/contracts/parts"
import type {
  GaContractHub,
  GaContractRow,
  GaDocument,
  GaMeterReading,
  UpdateGaContractRequest,
} from "@itulah/contract"

/// PATCH leaves alone whatever is `null`; the generated type has no optionals,
/// so a status move spells out that it touches nothing else.
const UNCHANGED: UpdateGaContractRequest = {
  contract_number: null,
  contract_type: null,
  objek: null,
  supplier_id: null,
  counterparty_name: null,
  site_id: null,
  site_scope: null,
  starts_on: null,
  ends_on: null,
  contract_value_minor: null,
  is_signed: null,
  signed_by: null,
  customer_number: null,
  reminder_days: null,
  notes: null,
  status: null,
}

/// One contract, as GA keeps the deal.
///
/// # No bills here
///
/// A supplier's invoice always goes to Finance, never through GA, so the
/// bills and recurring bills under a contract are Finance's to read on
/// Finance's screens. GA keeps the deal itself: its details, usage and papers.
///
/// # Usage exists for one group
///
/// A meter is a Subscriptions fact: listrik, air, telepon. A rent contract has no
/// meter, so the tab is not drawn for it — a tab that always says "no
/// readings" is a tab asking to be ignored.
export function ContractHubSheet({
  contractId,
  open,
  onClose,
}: {
  contractId: string | undefined
  open: boolean
  onClose: () => void
}) {
  const partyName = useContractParty()
  const hub = useQuery({
    queryKey: gaKeys.contract(contractId ?? ""),
    queryFn: ({ signal }) => gaContractHub(contractId ?? "", signal),
    enabled: open && contractId !== undefined,
  })

  // The archive is the sheet's one head action, and its form — reason and
  // all — lands in the footer, below every tab: a decision about the RECORD,
  // not about whichever tab happens to be open. The screen keys this sheet
  // per contract, so the question drops whenever another record opens.
  const [archiving, setArchiving] = useState(false)

  // The ladder is DRAFT → ACTIVE → TERMINATED and the server refuses any
  // other step. A contract made here starts DRAFT, and the reminder job and
  // the GA overview read only ACTIVE ones, so this is how a deal goes live.
  // Ending it keeps the reason in the notes, the way archiving does.
  const client = useQueryClient()
  const move = useMutation({
    mutationFn: (change: {
      row: GaContractRow
      status: "ACTIVE" | "TERMINATED"
      reason?: string
    }) =>
      updateGaContract(change.row.contract_id, {
        ...UNCHANGED,
        status: change.status,
        notes:
          change.reason === undefined
            ? null
            : [change.row.notes, `Terminated: ${change.reason.trim()}`]
                .filter((part) => part !== null && part !== "")
                .join(" "),
      }),
    onSuccess: (_saved, change) => {
      void client.invalidateQueries({ queryKey: gaKeys.all })
      toast.success(
        change.status === "ACTIVE" ? "Contract active" : "Contract terminated"
      )
    },
  })
  const contract = hub.data?.contract

  return (
    // A claim opens over the policy; a stack that already hosts the claim
    // sheet (the asset's) keeps hosting it.
    <ClaimSheetHost>
      <Sheet
        open={open}
        onOpenChange={(next) => !next && onClose()}
        width="wide"
        title={
          hub.data === undefined ? "Contract" : partyName(hub.data.contract)
        }
        id={
          hub.data === undefined
            ? undefined
            : (hub.data.contract.contract_number ??
              hub.data.contract.contract_id)
        }
        caption={
          hub.data === undefined ? undefined : (
            <>
              {hub.data.contract.contract_type_name} ·{" "}
              {siteOf(hub.data.contract)}
            </>
          )
        }
        subject={
          contractId === undefined
            ? undefined
            : { kind: "contract", id: contractId }
        }
        // One status: a living contract's window, or how an ended one ended
        // (`standingOf`).
        badge={
          hub.data === undefined ? undefined : (
            <StandingPill row={hub.data.contract} />
          )
        }
        actions={
          contract === undefined || contract.archived ? undefined : (
            <>
              {contract.status === "ACTIVE" && (
                <ConfirmButton
                  label="Terminate"
                  title="Terminate this contract?"
                  description="It stops being active and leaves the reminders. A terminated contract cannot be activated again."
                  tone="danger"
                  reason={{ label: "Why it is terminated" }}
                  onConfirm={(reason) =>
                    move.mutateAsync({
                      row: contract,
                      status: "TERMINATED",
                      reason,
                    })
                  }
                />
              )}
              <Button variant="soft" onClick={() => setArchiving(true)}>
                <Archive />
                End contract
              </Button>
              {contract.status === "DRAFT" && (
                <Button
                  variant="primary"
                  pending={move.isPending}
                  onClick={() =>
                    move.mutate(
                      { row: contract, status: "ACTIVE" },
                      { onError: (error) => toast.error(error.message) }
                    )
                  }
                >
                  {move.isPending ? "Activating…" : "Activate"}
                </Button>
              )}
            </>
          )
        }
        footer={
          hub.data !== undefined && archiving ? (
            <ArchiveForm
              row={hub.data.contract}
              onDone={onClose}
              onCancel={() => setArchiving(false)}
            />
          ) : undefined
        }
        tabs={
          hub.data === undefined
            ? undefined
            : [
                {
                  value: "detail",
                  label: "Details",
                  content: <DetailTab hub={hub.data} />,
                },
                // Only the subscribers carry meters. The other fifteen types
                // would draw a tab with nothing to read.
                ...(hub.data.contract.group_code === "LANGGANAN"
                  ? [
                      {
                        value: "usage",
                        label: "Usage",
                        content: (
                          <UsageTab
                            contractId={hub.data.contract.contract_id}
                            readings={hub.data.meter_readings}
                          />
                        ),
                      },
                    ]
                  : []),
                {
                  value: "documents",
                  label: "Documents",
                  content: (
                    <DocumentsTab
                      row={hub.data.contract}
                      documents={hub.data.documents}
                    />
                  ),
                },
              ]
        }
      >
        {hub.isLoading && <LoadingState>Opening the contract…</LoadingState>}
        {hub.error instanceof Error && (
          <Banner tone="bad">{hub.error.message}</Banner>
        )}
      </Sheet>
    </ClaimSheetHost>
  )
}

/// The deal's own facts.
function DetailTab({ hub }: { hub: GaContractHub }) {
  const partyName = useContractParty()
  const contract = hub.contract

  return (
    <div className="flex flex-col gap-5">
      <section>
        <h4 className="mb-2.5 border-b border-hairline pb-1.5 text-card-title font-semibold text-ink">
          Contract details
        </h4>
        <Facts>
          <Fact term="Party">
            {partyName(contract)}
            {contract.counterparty_name !== null && (
              <span className="text-pill font-normal text-mute">
                {" "}
                · text, not a vendor
              </span>
            )}
          </Fact>
          <Fact term="Type">{contract.contract_type_name}</Fact>
          {contract.objek_name !== null && (
            <Fact term="Object">{contract.objek_name}</Fact>
          )}
          <Fact term="Location">{siteOf(contract)}</Fact>
          <Fact term="Term">{span(contract.starts_on, contract.ends_on)}</Fact>
          {contract.customer_number !== null && (
            <Fact term="Customer no.">{contract.customer_number}</Fact>
          )}
          <Fact term="Signed">
            {contract.is_signed
              ? contract.signed_by === null
                ? "Yes"
                : `Yes · by ${contract.signed_by}`
              : "Not yet"}
          </Fact>
          <Fact term="Contract value">
            {money(contract.contract_value_minor)}
            {contract.contract_value_minor === null && (
              <span className="text-pill font-normal text-mute">
                {" "}
                · no contract value
              </span>
            )}
          </Fact>
          <Fact term="Reminder">
            {`${contract.reminder_days} days before expiry`}
          </Fact>
          {contract.notes !== null && (
            <Fact term="Notes">{contract.notes}</Fact>
          )}
        </Facts>
      </section>

      {/* What it covers (0975): one policy over a fleet, one maintenance
          contract over a store's ACs. */}
      {(coversAssets(contract.contract_type) || hub.covers.length > 0) && (
        <ContractCoversSection contract={contract} covers={hub.covers} />
      )}

      {contract.group_code === "ASURANSI" && (
        <PolicyClaimsSection contract={contract} covers={hub.covers} />
      )}
    </div>
  )
}

/// Meter readings, one bar a month — GA's own record, so nothing here is
/// marked Finance's.
function UsageTab({
  contractId,
  readings,
}: {
  contractId: string
  readings: readonly GaMeterReading[]
}) {
  const [recording, setRecording] = useState(false)

  // Relative to the heaviest month, never absolute: 40.100 kWh and 105 m³
  // must read as the same shape of chart, and both must survive a month
  // where nothing was recorded without dividing by zero.
  const max = Math.max(1, ...readings.map((one) => one.usage))

  return (
    <div className="flex flex-col gap-4">
      {readings.length === 0 ? (
        <p className="text-meta text-body">
          No readings yet. GA records the meter reading once a month, from the
          opening figure to the closing figure; the difference is the usage.
        </p>
      ) : (
        <div>
          <div className="text-eyebrow font-medium text-body">
            Usage per month · {readings[readings.length - 1].unit}
          </div>
          <div className="mt-3 flex items-end gap-3">
            {readings.map((one) => (
              <div
                key={one.reading_id}
                className="flex w-[2.5rem] flex-col items-center gap-1"
              >
                <span className="text-pill text-mute tabular-nums">
                  {abbr(one.usage)}
                </span>
                <span
                  className="w-full rounded-t-inner bg-accent"
                  style={{
                    height: Math.max(2, Math.round((one.usage / max) * 64)),
                  }}
                />
                <span className="text-pill text-mute">
                  {monthLabel(one.period).split(" ")[0]}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-pill text-mute">
        GA records the meter figure per month; the bill amount is read from
        Finance. Recording a month that already exists replaces its figures,
        rather than adding a row.
      </p>

      {recording ? (
        <ReadingForm
          contractId={contractId}
          readings={readings}
          onDone={() => setRecording(false)}
          onCancel={() => setRecording(false)}
        />
      ) : (
        <div>
          <Button variant="soft" onClick={() => setRecording(true)}>
            Record reading
          </Button>
        </div>
      )}
    </div>
  )
}

/// Large readings, short enough over a 64px bar: 40100 is "40,1 K" — the
/// kit's own K / M / B letters, since a nine-character figure over a bar is
/// wider than the bar.
const compact = compactFormat()
const abbr = (value: number) => compact.format(value)

/// One reading: the month, the unit, opening → closing, and when it was read.
///
/// Errors only ever name the field that is wrong, appear on the submit that
/// finds the problem and disappear the moment that field is edited again —
/// brief §10.2's rule, kept by clearing per field on change.
function ReadingForm({
  contractId,
  readings,
  onDone,
  onCancel,
}: {
  contractId: string
  readings: readonly GaMeterReading[]
  onDone: () => void
  onCancel: () => void
}) {
  const client = useQueryClient()
  const last = readings[readings.length - 1]
  const [form, setForm] = useState<Record<string, string>>({
    unit: last?.unit ?? "",
    read_on: new Date().toISOString().slice(0, 10),
  })
  const [problems, setProblems] = useState<Record<string, string>>({})
  const set = (key: string, value: string) => {
    // Editing a field is the reader taking the error back; keep the sentence
    // only while the field itself stays wrong.
    setProblems((current) => ({ ...current, [key]: "" }))
    setForm((current) => ({ ...current, [key]: value }))
  }

  const save = useMutation({
    mutationFn: () =>
      recordMeterReading(contractId, {
        period: `${form.period ?? ""}-01`,
        unit: (form.unit ?? "").trim(),
        opening: Number(form.opening),
        closing: Number(form.closing),
        read_on: form.read_on ?? "",
      }),
    onSuccess: () => {
      // The reading changes the contract's hub and the register's usage
      // column; both live under the GA prefix.
      void client.invalidateQueries({ queryKey: gaKeys.all })
      onDone()
    },
  })

  const submit = () => {
    const next: Record<string, string> = {}
    if ((form.period ?? "") === "") next.period = "Enter the reading month."
    if ((form.unit ?? "").trim() === "") next.unit = "Enter the unit."
    if ((form.opening ?? "") === "") next.opening = "Enter the opening figure."
    if ((form.closing ?? "") === "") next.closing = "Enter the closing figure."
    if (
      (form.opening ?? "") !== "" &&
      (form.closing ?? "") !== "" &&
      Number(form.closing) < Number(form.opening)
    ) {
      next.closing = "The closing figure cannot be below the opening figure."
    }
    if (Object.keys(next).length > 0) {
      setProblems(next)
      return
    }
    save.mutate()
  }

  return (
    <div className="rounded-inner border border-hairline-2 p-3.5">
      {save.error instanceof Error && (
        <Banner tone="bad">{save.error.message}</Banner>
      )}
      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Reading month"
          required
          aside={
            last === undefined ? undefined : `last ${monthLabel(last.period)}`
          }
          problem={problems.period || undefined}
        >
          <Input
            type="month"
            value={form.period ?? ""}
            onChange={(event) => set("period", event.target.value)}
          />
        </Field>
        <Field label="Unit" problem={problems.unit || undefined} required>
          <Input
            value={form.unit ?? ""}
            onChange={(event) => set("unit", event.target.value)}
          />
        </Field>
        <Field
          label="Opening figure"
          problem={problems.opening || undefined}
          required
        >
          <Input
            inputMode="numeric"
            value={form.opening ?? ""}
            onChange={(event) => set("opening", event.target.value)}
          />
        </Field>
        <Field
          label="Closing figure"
          problem={problems.closing || undefined}
          required
        >
          <Input
            inputMode="numeric"
            value={form.closing ?? ""}
            onChange={(event) => set("closing", event.target.value)}
          />
        </Field>
        <Field label="Reading date" required>
          <Input
            type="date"
            value={form.read_on ?? ""}
            onChange={(event) => set("read_on", event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button variant="primary" pending={save.isPending} onClick={submit}>
          {save.isPending ? "Submitting…" : "Submit"}
        </Button>
        <Button data-cancel variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/// The papers with a date on them, filed from the record they belong to.
///
/// The same door the asset hub opens onto the Library: the person holding the
/// paper is standing at this contract, and a door here still lands in the
/// Library like every other document — linked, not copied.
function DocumentsTab({
  row,
  documents,
}: {
  row: GaContractRow
  documents: readonly GaDocument[]
}) {
  const client = useQueryClient()
  const [adding, setAdding] = useState(false)

  return (
    <div className="flex flex-col gap-4">
      {documents.length === 0 ? (
        <p className="text-meta text-body">
          No documents yet. Signed agreements, amendment attachments, notice
          letters — attached here and indexed in the Library.
        </p>
      ) : (
        <ul className="flex flex-col">
          {documents.map((document) => (
            <li
              key={document.document_id}
              className="flex items-center gap-3 border-b border-hairline py-2.5 last:border-b-0"
            >
              <FileText className="size-4 shrink-0 stroke-[1.7] text-line-ico" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-cell text-ink">
                  {document.doc_type ?? document.title ?? document.name}
                </span>
                <span className="block truncate font-mono text-pill text-mute">
                  {document.doc_number ?? document.name}
                </span>
              </span>
              <span className="shrink-0 text-pill text-mute tabular-nums">
                {document.expires_on === null
                  ? "no expiry date"
                  : `until ${day(document.expires_on)}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <AttachForm
          row={row}
          onDone={() => {
            setAdding(false)
            void client.invalidateQueries({ queryKey: gaKeys.all })
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <div>
          <Button variant="soft" onClick={() => setAdding(true)}>
            <Paperclip />
            Attach document
          </Button>
        </div>
      )}
    </div>
  )
}

/// The form's empty string, as the wire spells "not given". Five fields read
/// it, so they stay honest about absence in one place rather than five ways.
function blank(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim()
  return trimmed === "" ? null : trimmed
}

/// Filing one paper against this contract — the Library's two-step: bytes
/// first, document row second, so a slow photograph never blocks the form.
function AttachForm({
  row,
  onDone,
  onCancel,
}: {
  row: GaContractRow
  onDone: () => void
  onCancel: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const set = (key: string, value: string) =>
    setForm((current) => ({ ...current, [key]: value }))

  const save = useMutation({
    mutationFn: () => {
      if (file === null) throw new Error("Choose the file first.")
      return uploadDocument(file, {
        title: blank(form.title) ?? undefined,
        doc_type: blank(form.doc_type) ?? undefined,
        doc_number: blank(form.doc_number) ?? undefined,
        issuer: blank(form.issuer) ?? undefined,
        issued_on: blank(form.issued_on) ?? undefined,
        expires_on: blank(form.expires_on) ?? undefined,
        path_tokens: ["GA", row.contract_number ?? row.contract_id],
        tags: [],
        links: [{ subject_kind: "contract", subject_id: row.contract_id }],
      })
    },
    onSuccess: onDone,
  })

  return (
    <div className="rounded-inner border border-hairline-2 p-3.5">
      {save.error instanceof Error && (
        <Banner tone="bad">{save.error.message}</Banner>
      )}
      <div className="grid grid-cols-2 gap-4">
        <Field label="File" required>
          <Input
            type="file"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </Field>
        <Field label="Document type" aside="agreement, amendment, letter">
          <Input
            value={form.doc_type ?? ""}
            onChange={(event) => set("doc_type", event.target.value)}
          />
        </Field>
        <Field label="Number">
          <Input
            value={form.doc_number ?? ""}
            onChange={(event) => set("doc_number", event.target.value)}
          />
        </Field>
        <Field label="Issuer">
          <Input
            value={form.issuer ?? ""}
            onChange={(event) => set("issuer", event.target.value)}
          />
        </Field>
        <Field label="Issued">
          <Input
            type="date"
            value={form.issued_on ?? ""}
            onChange={(event) => set("issued_on", event.target.value)}
          />
        </Field>
        <Field label="Valid until" aside="empty = no expiry">
          <Input
            type="date"
            value={form.expires_on ?? ""}
            onChange={(event) => set("expires_on", event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button
          variant="primary"
          pending={save.isPending}
          disabled={file === null}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Submitting…" : "Submit"}
        </Button>
        <Button data-cancel variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/// Archiving — the register's only exit, and a reasoned one.
///
/// There is no delete on this register (brief §12): a contract a bill has
/// pointed at must stay answerable. The reason is the server's requirement
/// and the form's: a deal that leaves the living list without a recorded why
/// is a question six months later that nobody can answer.
function ArchiveForm({
  row,
  onDone,
  onCancel,
}: {
  row: GaContractRow
  onDone: () => void
  onCancel: () => void
}) {
  const client = useQueryClient()
  const [reason, setReason] = useState("")
  const [problem, setProblem] = useState("")

  const archive = useMutation({
    mutationFn: () =>
      archiveGaContract(row.contract_id, { archived: true, reason }),
    onSuccess: () => {
      // The register's lists and the overview both count this contract; the
      // whole GA namespace drops together, as every GA write does here.
      void client.invalidateQueries({ queryKey: gaKeys.all })
      onDone()
    },
  })

  const submit = () => {
    if (reason.trim() === "") {
      setProblem("Write the reason first.")
      return
    }
    archive.mutate()
  }

  return (
    <div className="flex items-end gap-3">
      <Field
        label={`Why ${row.contract_number ?? "this contract"} ends`}
        problem={problem || undefined}
        className="flex-1"
        required
      >
        <Input
          value={reason}
          onChange={(event) => {
            setProblem("")
            setReason(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit()
          }}
        />
      </Field>
      <Button variant="primary" pending={archive.isPending} onClick={submit}>
        {archive.isPending ? "Ending…" : "End contract"}
      </Button>
      <Button data-cancel variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  )
}
