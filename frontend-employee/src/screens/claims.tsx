import { useState } from "react"

import { Panel } from "@/components/bits"
import { StatusPill } from "@/components/status-pill"
import { Button } from "@/components/ui/button"
import { Field, Input, Select } from "@/components/ui/field"
import { money, shortDate } from "@/lib/format"
import {
  useClaimTypes,
  useFileClaim,
  useMyClaims,
  useSubmitClaim,
} from "@/lib/hr/queries"

/// Your claims: what you filed, what was sanctioned, and the form for the
/// next one.
///
/// The form asks for lines, because that is what a claim is — a dated line
/// against a kind of expense, filed once and then sent up. Sanctioning is
/// the store head's and the money is Finance's; what you see here is the
/// state of the ask.

export function Claims() {
  const mine = useMyClaims()

  return (
    <div className="flex flex-col gap-4">
      <ClaimForm />

      <Panel title="My claims">
        {(mine.data ?? []).length === 0 ? (
          <p className="text-meta text-mute">Nothing filed yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {(mine.data ?? []).map((claim) => (
              <div key={claim.claim_id} className="flex flex-col gap-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-cell font-medium text-ink">
                    {claim.claim_number}
                  </p>
                  <StatusPill status={claim.state} className="ml-auto" />
                </div>
                <p className="text-meta text-body">
                  {money(claim.claimed_minor)} filed ·{" "}
                  {claim.sanctioned_minor !== null
                    ? `${money(claim.sanctioned_minor)} sanctioned`
                    : "not decided yet"}{" "}
                  · {shortDate(claim.posted_on)}
                </p>
                {claim.state === "DRAFT" && (
                  <SubmitClaim claimId={claim.claim_id} />
                )}
                {claim.state !== "DRAFT" && claim.decide_reason !== null && (
                  <p className="text-meta text-mute">
                    {claim.decided_by}: {claim.decide_reason}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}

function SubmitClaim({ claimId }: { claimId: string }) {
  const submit = useSubmitClaim()
  const [reason, setReason] = useState("")
  return (
    <div className="mt-1 flex flex-col gap-2">
      <Field label="Why you are sending it now">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Button
        size="sm"
        variant="primary"
        disabled={reason.trim() === "" || submit.isPending}
        onClick={() => submit.mutate({ claimId, reason })}
      >
        Send
      </Button>
    </div>
  )
}

function ClaimForm() {
  const kinds = useClaimTypes()
  const file = useFileClaim()
  const send = useSubmitClaim()
  const [typeCode, setTypeCode] = useState("")
  const [description, setDescription] = useState("")
  const [spentOn, setSpentOn] = useState(new Date().toISOString().slice(0, 10))
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  return (
    <Panel title="File a claim">
      <div className="flex flex-col gap-3">
        <Field label="Kind of expense">
          <Select
            value={typeCode}
            onChange={(e) => setTypeCode(e.target.value)}
          >
            <option value="">Choose…</option>
            {(kinds.data ?? [])
              .filter((kind) => kind.retired_at === null)
              .map((kind) => (
                <option key={kind.code} value={kind.code}>
                  {kind.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="What it was">
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Field label="Spent on">
          <Input
            type="date"
            value={spentOn}
            onChange={(e) => setSpentOn(e.target.value)}
          />
        </Field>
        <Field label="Amount, whole rupiah">
          <Input
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
          />
        </Field>
        <Field label="Why">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {failed !== null && <p className="text-meta text-bad">{failed}</p>}
        <Button
          variant="primary"
          size="tap"
          disabled={
            typeCode === "" ||
            description.trim() === "" ||
            amount === "" ||
            reason.trim() === "" ||
            file.isPending
          }
          onClick={() => {
            file.mutate(
              {
                lines: [
                  {
                    type_code: typeCode,
                    description,
                    spent_on: spentOn,
                    claimed_minor: Number(amount),
                  },
                ],
                reason,
              },
              {
                // Filing makes a DRAFT; sending it up is its own act on the
                // same id. One button, two recorded acts, because the ask is
                // only complete when both happened.
                onSuccess: (claim) => {
                  return send
                    .mutateAsync({ claimId: claim.claim_id, reason })
                    .then(() => {
                      setTypeCode("")
                      setDescription("")
                      setAmount("")
                      setReason("")
                      setFailed(null)
                    })
                    .catch((error: Error) => setFailed(error.message))
                },
                onError: (error: Error) => setFailed(error.message),
              }
            )
          }}
        >
          File and send
        </Button>
        <p className="text-meta text-mute">
          Batas per jenis ada di aturan head office. Yang disetujui boleh lebih
          rendah dari yang diajukan.
        </p>
      </div>
    </Panel>
  )
}
