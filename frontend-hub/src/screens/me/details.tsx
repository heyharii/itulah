import { useState } from "react"

import { Async, Empty, Failure, List, Panel, Row } from "@/screens/me/ui/bits"
import { Field, Input, Select, TAP, Textarea } from "@/screens/me/ui/field"
import { StatusPill } from "@/screens/me/ui/status-pill"
import { Button } from "@/screens/me/ui/button"
import { Pill } from "@/screens/me/ui/pill"
import {
  dateTime,
  longDate,
  relativeDay,
  shortDate,
} from "@/screens/me/data/format"
import {
  useAcknowledgeLetter,
  useAskForDataChange,
  usePersonalDataRequests,
  useWithdrawDataChange,
  useWarningLetters,
  useContracts,
  useHolidays,
  usePayrollIdentity,
  useProfile,
} from "@/screens/me/data/queries"
import { useSession, useSignOut } from "@/screens/me/data/session"

/// Everything about the person that is not a task.
///
/// One long scroll rather than a menu of sub-pages: these are six short cards,
/// and a phone menu whose every entry leads to four lines of text is a menu
/// that exists to be navigated rather than read.
export function Me() {
  const session = useSession()
  const profile = useProfile()
  const contracts = useContracts()
  const payroll = usePayrollIdentity()
  const holidays = useHolidays()
  /// The mutation itself rather than `session.signOut`, which is the bare
  /// `mutate` and so cannot say whether the request is still in flight. On a
  /// phone over shop wifi that gap is a second or more of a button that looks
  /// untouched, and the second tap fires a second logout against a session the
  /// first one has already ended.
  const signOut = useSignOut()

  return (
    <div className="flex flex-col gap-4">
      <Letters />
      <Panel title="You">
        <Async query={profile}>
          {(person) => (
            <>
              <div className="flex items-start gap-3">
                <div className="min-w-0">
                  {/* A record can exist before anybody has typed a name into
                      it — accepted on Friday, enrolled on Monday. */}
                  <p className="text-card-title font-semibold text-ink">
                    {person.full_name ?? person.employee_code}
                  </p>
                  <p className="text-cell text-body">
                    {person.job_title ?? "No contract signed yet"}
                    {person.grade && ` · ${person.grade}`}
                  </p>
                </div>
                <StatusPill status={person.status} className="ml-auto" />
              </div>
              <hr className="border-hairline" />
              <Row label="Employee number">{person.employee_code}</Row>
              <Row label="Works at">{person.unit_name ?? "—"}</Row>
              {/* Null until the first HIRE takes effect, and saying so is
                  better than a formatted "Invalid Date": somebody who has not
                  started has no joining date yet. */}
              <Row label="Joined">
                {person.joined_on ? longDate(person.joined_on) : "Not started"}
              </Row>
              <p className="text-meta text-mute">
                Something wrong? Ask HR to change your phone, email or address
                here; name, NIK and birth date change with HR against a
                document.
              </p>
              <AskToChange />
            </>
          )}
        </Async>
      </Panel>

      <ChangeRequests />

      <Panel title="Contract">
        <Async query={contracts} empty="No contract on record.">
          {(list) =>
            list.map((contract) => (
              <div
                key={`${contract.kind}-${contract.starts_on}`}
                className="flex flex-col gap-3 not-first:border-t not-first:border-hairline not-first:pt-3"
              >
                <div className="flex items-center gap-2">
                  <p className="text-cell font-medium text-ink">
                    {contract.kind === "PKWTT"
                      ? "Permanent (PKWTT)"
                      : contract.kind === "PKWT"
                        ? "Fixed-term (PKWT)"
                        : contract.kind}
                  </p>
                  <Pill tone={contract.in_force ? "ok" : "neutral"}>
                    {contract.in_force ? "In force" : "Ended"}
                  </Pill>
                </div>
                <Row label="Position">
                  {contract.position} · {contract.grade}
                </Row>
                <Row label="Started">{longDate(contract.starts_on)}</Row>
                {/* A PKWT is fixed-term. The end date approaching is the whole
                    reason somebody opens this card, so it is spelled out in
                    days rather than left as a date to subtract. */}
                <Row label="Ends">
                  {contract.ends_on === null
                    ? "Open-ended"
                    : `${longDate(contract.ends_on)} · ${relativeDay(contract.ends_on)}`}
                </Row>
              </div>
            ))
          }
        </Async>
      </Panel>

      <Panel title="Payroll details">
        <Async query={payroll}>
          {(identity) => (
            <>
              <Row label="Bank">{identity.bank_name ?? "—"}</Row>
              <Row label="Account">{identity.bank_account_masked ?? "—"}</Row>
              <Row label="Account holder">{identity.bank_holder ?? "—"}</Row>
              <Row label="NPWP">{identity.npwp ?? "—"}</Row>
              <Row label="PTKP">{identity.ptkp ?? "—"}</Row>
              <Row label="BPJS Kesehatan">{identity.bpjs_kesehatan ?? "—"}</Row>
              <Row label="BPJS Ketenagakerjaan">
                {identity.bpjs_ketenagakerjaan ?? "—"}
              </Row>
              <p className="text-meta text-mute">
                Shown part-masked. To change where you are paid, ask HR in
                person.
              </p>
            </>
          )}
        </Async>
      </Panel>

      <Panel title="Days off">
        <Async query={holidays}>
          {(calendar) =>
            calendar.days.length === 0 ? (
              <Empty>No calendar published for {calendar.year}.</Empty>
            ) : (
              <>
                {calendar.days.map((day) => (
                  <Row key={day.date} label={day.name}>
                    {shortDate(day.date)}
                    {day.consumes_annual_leave && (
                      <span className="ml-1 text-meta font-normal text-mute">
                        (cuti bersama)
                      </span>
                    )}
                  </Row>
                ))}
                <p className="text-meta text-mute">{calendar.year} calendar</p>
              </>
            )
          }
        </Async>
      </Panel>

      <Panel title="This app">
        <Row label="Signed in as">{session.identity.username}</Row>
        <Row label="Role">{session.identity.role}</Row>
        {session.node !== null && (
          <Row label="Node">
            {session.node.node_id} · {session.node.node_role}
          </Row>
        )}
        <Button
          variant="danger"
          size="tap"
          className="mt-1 w-full md:h-control md:w-auto md:self-start"
          disabled={signOut.isPending}
          onClick={() => signOut.mutate()}
        >
          {signOut.isPending ? "Signing out…" : "Sign out"}
        </Button>
      </Panel>
    </div>
  )
}

/// Warning letters given to you. Shown only when there is one; acknowledging
/// says you received it, not that you agree with it.
function Letters() {
  const letters = useWarningLetters()
  const acknowledge = useAcknowledgeLetter()
  const rows = (letters.data ?? []).filter((letter) => !letter.revoked)
  if (rows.length === 0) return null
  return (
    <Panel title="Warning letters">
      {rows.map((letter) => (
        <div key={letter.id} className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink">
              {letter.level === "TEGURAN"
                ? "Teguran"
                : letter.level.replace("SP", "SP ")}
            </span>
            <span className="text-[0.875rem] text-mute">
              {shortDate(letter.issued_on)}
            </span>
            {letter.active ? (
              <Pill tone="warn">
                In force to {shortDate(letter.valid_until)}
              </Pill>
            ) : (
              <Pill tone="neutral">Lapsed</Pill>
            )}
          </div>
          <p className="text-[0.875rem] text-body">{letter.violation}</p>
          {letter.acknowledged_at === null ? (
            <Button
              variant="primary"
              size="tap"
              disabled={acknowledge.isPending}
              onClick={() => acknowledge.mutate(letter.id)}
            >
              I have received this letter
            </Button>
          ) : (
            <p className="text-[0.875rem] text-mute">You acknowledged it.</p>
          )}
        </div>
      ))}
    </Panel>
  )
}

type DataField = "phone" | "email" | "address"

const DATA_FIELD: Record<string, string> = {
  phone: "Phone",
  email: "Email",
  address: "Address",
}

/// A request to HR to change a phone number, email or address.
///
/// Inline rather than a route of its own: it is three fields, and the person is
/// already looking at the record they think is wrong. HR decides; nothing on
/// the record moves until they do.
function AskToChange() {
  const ask = useAskForDataChange()
  const [open, setOpen] = useState(false)
  const [field, setField] = useState<DataField>("phone")
  const [value, setValue] = useState("")
  const [why, setWhy] = useState("")

  const close = () => {
    setOpen(false)
    setValue("")
    setWhy("")
    ask.reset()
  }

  if (!open) {
    return (
      <Button
        className="self-start"
        onClick={() => {
          setOpen(true)
        }}
      >
        Ask to change
      </Button>
    )
  }

  const blank = field === "address" && value.trim() === ""
  return (
    <form
      className="flex flex-col gap-3.5"
      onSubmit={(event) => {
        event.preventDefault()
        ask.mutate(
          { field, value: value.trim(), reason: why.trim() },
          { onSuccess: close }
        )
      }}
    >
      <Field label="What should change" required>
        <Select
          value={field}
          onChange={(next) => setField(next as DataField)}
          aria-label="What should change"
          className={TAP}
        >
          <option value="phone">Phone</option>
          <option value="email">Email</option>
          <option value="address">Address</option>
        </Select>
      </Field>
      <Field
        label="New value"
        required={field === "address"}
        hint={field !== "address" && "Leave it empty to remove it."}
      >
        {field === "address" ? (
          <Textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            rows={3}
            required
          />
        ) : (
          <Input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            type={field === "email" ? "email" : "tel"}
          />
        )}
      </Field>
      <Field label="Why" required>
        <Input
          value={why}
          onChange={(event) => setWhy(event.target.value)}
          required
        />
      </Field>
      {ask.error !== null && <Failure error={ask.error} />}
      <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
        <Button
          type="button"
          variant="quiet"
          size="tap"
          className="md:h-control"
          onClick={close}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="tap"
          className="md:h-control"
          disabled={ask.isPending || why.trim() === "" || blank}
        >
          {ask.isPending ? "Sending…" : "Send"}
        </Button>
      </div>
    </form>
  )
}

/// What the person has asked HR to change, and what came of it. Shown only
/// when there is something to show.
function ChangeRequests() {
  const requests = usePersonalDataRequests()
  const withdraw = useWithdrawDataChange()
  const rows = requests.data ?? []
  if (rows.length === 0) return null
  return (
    <Panel title="Change requests">
      <List>
        {rows.map((request) => (
          <div key={request.id} className="flex flex-col gap-1.5">
            <div className="flex items-start gap-2">
              <div className="min-w-0">
                <p className="text-cell font-medium text-ink">
                  {DATA_FIELD[request.field] ?? request.field}
                </p>
                <p className="text-meta break-words text-body">
                  {/* "Now" is the live record, so it only means something
                      while the request waits; afterwards say what was asked. */}
                  {request.state === "PENDING"
                    ? `${request.current ?? "—"} → `
                    : "Asked for "}
                  {request.value === "" ? "removed" : request.value}
                </p>
              </div>
              <StatusPill status={request.state} className="ml-auto" />
            </div>
            <p className="text-cell text-text">{request.reason}</p>
            {request.decision_reason !== null && (
              <p className="text-meta text-body italic">
                {request.decided_by}: {request.decision_reason}
              </p>
            )}
            <p className="text-meta text-mute">
              Asked {dateTime(request.filed_at)}
            </p>
            {request.state === "PENDING" && (
              <Button
                className="mt-1 self-start"
                disabled={withdraw.isPending}
                onClick={() =>
                  withdraw.mutate({
                    requestId: request.id,
                    reason: "ditarik oleh pemohon",
                  })
                }
              >
                Withdraw
              </Button>
            )}
          </div>
        ))}
      </List>
      {withdraw.error !== null && (
        <Empty>Could not withdraw that request. Try again.</Empty>
      )}
    </Panel>
  )
}
