import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { HireProposalView } from "@itulah/contract"
import { useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input, Select } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner } from "@/components/ui/states"
import { day, money } from "@/lib/format"
import { useNameOfLogin } from "@/lib/queries/hr-employees"
import {
  createInvitations,
  invitationKeys,
  useRoles,
  whatsappNumber,
} from "@/lib/queries/invitations"
import {
  decideHire,
  hireKeys,
  openHiredEmployment,
} from "@/lib/queries/people"
import { problemOf } from "@/lib/problem"
import { useCanWrite } from "@/lib/session"
import {
  CopyButton,
  WhatsAppLinkButton,
} from "@/screens/people/invite-sheet"

/// A store's request for a new person (owner, 2026-10-16): the store app's
/// *Request new staff* files it, head office decides it here, in HR's one
/// inbox.
///
/// Waiting, it is Return, Reject or Approve, each with a reason (the server
/// refuses a decision without one). Approved, one button opens the person's
/// employment record and an account link bound to it (`employee_id` on the
/// invitation), handed over on WhatsApp — so the person who joins is the
/// record HR approved, never a second one.
export function HireSheet({
  proposal,
  onClose,
}: {
  proposal: HireProposalView | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const canWrite = useCanWrite()
  const roles = useRoles().data ?? []
  const nameOfLogin = useNameOfLogin()
  const [why, setWhy] = useState("")
  const [code, setCode] = useState("")
  const [roleCode, setRoleCode] = useState("")
  const [phone, setPhone] = useState("")
  const [opened, setOpened] = useState(false)
  /// The employment record this sheet already opened, kept across a retry so
  /// a failed invitation does not open a second record.
  const made = useRef<string | null>(null)

  const terms = proposal?.versions.at(-1) ?? null
  const guessedRole =
    roles.find(
      (role) =>
        terms !== null &&
        role.name.toLowerCase() === terms.position.trim().toLowerCase()
    )?.code ?? ""
  const role = roleCode || guessedRole

  const refresh = () => {
    void client.invalidateQueries({ queryKey: hireKeys.all })
    void client.invalidateQueries({ queryKey: invitationKeys.all })
  }

  const decide = useMutation({
    mutationFn: (decision: "APPROVE" | "RETURN" | "REJECT") =>
      decideHire(proposal!.id, decision, why.trim()),
    onSuccess: (_, decision) => {
      refresh()
      setWhy("")
      if (decision !== "APPROVE") onClose()
    },
  })

  const invite = useMutation({
    mutationFn: async () => {
      if (proposal === null || terms === null) throw new Error("No request.")
      if (made.current === null) {
        const view = await openHiredEmployment(
          proposal.id,
          code.trim(),
          "Approved request for new staff"
        )
        made.current = view.employee_ids.at(-1) ?? null
      }
      if (made.current === null)
        throw new Error("The employment record was not opened.")
      const issued = await createInvitations([
        {
          name: terms.candidate_name,
          role_code: role,
          unit_id: proposal.unit_id,
          position: terms.position,
          employee_id: made.current,
        },
      ])
      const first = issued.items[0]
      if (first === undefined) throw new Error("No link came back.")
      return first
    },
    onSuccess: refresh,
  })

  const close = () => {
    decide.reset()
    invite.reset()
    setWhy("")
    setCode("")
    setRoleCode("")
    setPhone("")
    setOpened(false)
    made.current = null
    onClose()
  }

  const waiting = proposal?.state === "PROPOSED"
  const toFill =
    proposal !== null &&
    proposal.state === "APPROVED" &&
    proposal.outstanding > 0 &&
    invite.data === undefined
  const number = whatsappNumber(phone)
  const issued = invite.data

  return (
    <Sheet
      open={proposal !== null}
      onOpenChange={(next) => !next && close()}
      title={terms === null ? "New staff" : terms.candidate_name}
      badge={
        proposal === null ? undefined : (
          <Pill tone={proposal.state === "PROPOSED" ? "warn" : "neutral"}>
            {STATE_LABEL[proposal.state] ?? proposal.state}
          </Pill>
        )
      }
      footer={
        waiting && canWrite ? (
          <div className="flex justify-end gap-2">
            <Button
              variant="quiet"
              disabled={why.trim() === ""}
              pending={decide.isPending && decide.variables === "RETURN"}
              onClick={() => decide.mutate("RETURN")}
            >
              Return
            </Button>
            <Button
              variant="destructive"
              disabled={why.trim() === ""}
              pending={decide.isPending && decide.variables === "REJECT"}
              onClick={() => decide.mutate("REJECT")}
            >
              Reject
            </Button>
            <Button
              variant="primary"
              disabled={why.trim() === ""}
              pending={decide.isPending && decide.variables === "APPROVE"}
              onClick={() => decide.mutate("APPROVE")}
            >
              Approve
            </Button>
          </div>
        ) : toFill && canWrite ? (
          <div className="flex justify-end">
            <Button
              variant="primary"
              disabled={code.trim() === "" || role === "" || number === null}
              pending={invite.isPending}
              onClick={() => invite.mutate()}
            >
              Create account
            </Button>
          </div>
        ) : undefined
      }
    >
      {proposal !== null && terms !== null && (
        <div className="flex flex-col gap-5">
          <Facts>
            <Fact term="Position">{terms.position}</Fact>
            <Fact term="Unit">{proposal.unit_name ?? proposal.unit_id}</Fact>
            <Fact term="Start">{day(terms.start_on)}</Fact>
            <Fact term="Contract">
              {terms.contract_kind === "PKWT"
                ? `Fixed term${terms.contract_ends_on ? ` until ${day(terms.contract_ends_on)}` : ""}`
                : "Permanent"}
            </Fact>
            <Fact term="Pay">{`${money(terms.base_pay_minor)} / month`}</Fact>
            <Fact term="Need">
              {terms.need === "REPLACEMENT" ? "Replacement" : "Addition"}
              {terms.headcount > 1 ? ` · ${terms.headcount} people` : ""}
            </Fact>
            <Fact term="Asked by">{nameOfLogin(proposal.proposed_by)}</Fact>
            {terms.filed_reason && (
              <Fact term="Reason">{terms.filed_reason}</Fact>
            )}
          </Facts>

          {waiting && canWrite && (
            <Field label="Why" required>
              <Input value={why} onChange={(event) => setWhy(event.target.value)} />
            </Field>
          )}
          {decide.error !== null && (
            <Banner tone="bad">{problemOf(decide.error)}</Banner>
          )}

          {toFill && canWrite && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Employee code" required>
                <Input
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                />
              </Field>
              <Field label="Job role" required>
                <Select value={role} onChange={setRoleCode}>
                  <option value="" disabled>
                    Choose
                  </option>
                  {roles.map((one) => (
                    <option key={one.code} value={one.code}>
                      {one.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="WhatsApp number" required className="sm:col-span-2">
                <Input
                  type="tel"
                  inputMode="tel"
                  placeholder="0812 3456 7890"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                />
              </Field>
            </div>
          )}
          {invite.error !== null && (
            <Banner tone="bad">{problemOf(invite.error)}</Banner>
          )}

          {issued !== undefined && (
            <div className="flex flex-col gap-3 rounded-card border border-hairline p-4">
              <p className="font-medium text-ink">
                Account created — send the link
              </p>
              <p className="font-mono text-[0.9375rem] break-all text-body">
                {issued.link}
              </p>
              <p className="text-[0.9375rem] text-mute">
                Expires {day(issued.expires_at)}
              </p>
              <div className="flex flex-wrap gap-2">
                <WhatsAppLinkButton
                  link={issued.link}
                  name={issued.name}
                  number={number}
                  opened={opened}
                  onOpen={() => setOpened(true)}
                />
                <CopyButton text={issued.link} />
              </div>
            </div>
          )}
        </div>
      )}
    </Sheet>
  )
}

const STATE_LABEL: Readonly<Record<string, string>> = {
  PROPOSED: "Waiting",
  RETURNED: "Returned",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  FILLED: "Filled",
}
