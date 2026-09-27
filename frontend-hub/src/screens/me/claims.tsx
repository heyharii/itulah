import { useState } from "react"

import { Plus } from "lucide-react"

import { Async, List, Panel, Unbound } from "@/screens/me/ui/bits"
import { StatusPill } from "@/screens/me/ui/status-pill"
import { Button } from "@/screens/me/ui/button"
import { Day, Field, Input, Select, TAP } from "@/screens/me/ui/field"
import { isUnbound } from "@/screens/me/data/api"
import { isoDate, money, shortDate } from "@/screens/me/data/format"
import {
  useClaimTypes,
  useFileClaim,
  useMyClaims,
  useSubmitClaim,
} from "@/screens/me/data/queries"

/// Your claims: what you filed and what came of it, and — on request — the
/// form for the next one.
///
/// The list leads. Somebody opens this screen far more often to see whether a
/// claim was sanctioned than to file one, and a form standing at the top made
/// the screen read as an input box with a history hidden under it. The form
/// asks for lines, because that is what a claim is — a dated line against a
/// kind of expense, filed once and then sent up. Sanctioning is the store
/// head's and the money is Finance's; what you see here is the state of the ask.

export function Claims() {
  const mine = useMyClaims()
  const [filing, setFiling] = useState(false)
  const claims = mine.data ?? []
  const waiting = claims.filter(
    (claim) => claim.state !== "DRAFT" && claim.sanctioned_minor === null
  )
  const sanctioned = claims.reduce(
    (sum, claim) => sum + (claim.sanctioned_minor ?? 0),
    0
  )

  if (isUnbound(mine.error)) return <Unbound />

  return (
    <div className="flex flex-col gap-4">
      {claims.length > 0 && (
        <Panel>
          <div className="grid grid-cols-2 gap-3">
            <Figure
              label="Waiting on a decision"
              value={money(
                waiting.reduce((sum, claim) => sum + claim.claimed_minor, 0)
              )}
              note={`${waiting.length} claim${waiting.length === 1 ? "" : "s"}`}
            />
            <Figure
              label="Sanctioned"
              value={money(sanctioned)}
              note="Across everything you filed"
            />
          </div>
        </Panel>
      )}

      {filing ? (
        <ClaimForm onDone={() => setFiling(false)} />
      ) : (
        // Full width and tall on a phone, like "Apply for leave": the thumb
        // that holds the device is the one that reaches for it.
        <Button
          variant="primary"
          size="tap"
          className="w-full md:h-control md:w-auto md:self-start"
          onClick={() => setFiling(true)}
        >
          <Plus />
          New claim
        </Button>
      )}

      <Panel title="My claims">
        <Async query={mine} empty="Nothing filed yet.">
          {(list) => (
            <List>
              {list.map((claim) => (
                <div key={claim.claim_id} className="flex flex-col gap-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-cell font-medium text-ink">
                        {claim.claim_number}
                      </p>
                      <p className="text-meta text-body">
                        {shortDate(claim.posted_on)}
                      </p>
                    </div>
                    <div className="ml-auto flex flex-col items-end gap-1">
                      <p className="num text-cell font-semibold text-ink">
                        {money(claim.claimed_minor)}
                      </p>
                      <StatusPill status={claim.state} />
                    </div>
                  </div>
                  {claim.sanctioned_minor !== null && (
                    <p className="text-meta text-body">
                      {money(claim.sanctioned_minor)} sanctioned
                    </p>
                  )}
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
            </List>
          )}
        </Async>
      </Panel>
    </div>
  )
}

function Figure({
  label,
  value,
  note,
}: {
  label: string
  value: string
  note: string
}) {
  return (
    <div className="min-w-0">
      <p className="text-meta text-body">{label}</p>
      <p className="num truncate text-kpi font-semibold text-ink">{value}</p>
      <p className="text-meta text-mute">{note}</p>
    </div>
  )
}

function SubmitClaim({ claimId }: { claimId: string }) {
  const submit = useSubmitClaim()
  const [reason, setReason] = useState("")
  return (
    <div className="mt-1 flex flex-col gap-2">
      <Field label="Why you are sending it now" required>
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

function ClaimForm({ onDone }: { onDone: () => void }) {
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
    <Panel
      title="New claim"
      action={
        <Button size="sm" variant="quiet" onClick={onDone}>
          Cancel
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Kind of expense" required>
          <Select
            value={typeCode}
            onChange={setTypeCode}
            aria-label="Kind of expense"
            className={TAP}
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
        <Field label="What it was" required>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Field label="Spent on">
          <Day
            value={spentOn}
            onChange={setSpentOn}
            label="Spent on"
            placeholder="Choose a day"
            notAfter={isoDate(new Date())}
            clearable={false}
            className={TAP}
          />
        </Field>
        <Field label="Amount, whole rupiah" required>
          <Input
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
          />
        </Field>
        <Field label="Why" required>
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
                      onDone()
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
