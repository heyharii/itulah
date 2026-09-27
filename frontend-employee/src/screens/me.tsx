import { Link } from "@tanstack/react-router"
import { ChevronRight } from "lucide-react"
import { Async, Empty, Panel, Row } from "@/components/bits"
import { StatusPill } from "@/components/status-pill"
import { Button } from "@/components/ui/button"
import { Pill } from "@/components/ui/pill"
import { longDate, relativeDay, shortDate } from "@/lib/format"
import {
  useContracts,
  useHolidays,
  usePayrollIdentity,
  useProfile,
} from "@/lib/hr/queries"
import { button } from "@/components/ui/button-style"
import { useSession, useSignOut } from "@/lib/session"

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
              <Row label="Works at">{person.place_name ?? "—"}</Row>
              {/* Null until the first HIRE takes effect, and saying so is
                  better than a formatted "Invalid Date": somebody who has not
                  started has no joining date yet. */}
              <Row label="Joined">
                {person.joined_on ? longDate(person.joined_on) : "Not started"}
              </Row>
              <p className="text-meta text-mute">
                Something wrong here? HR changes it — this screen only shows it.
              </p>
            </>
          )}
        </Async>
      </Panel>

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

      <Link
        to="/me/voice"
        className={button({
          size: "tap",
          className: "w-full justify-between md:h-control",
        })}
      >
        Raise a concern with HR
        <ChevronRight className="size-4" />
      </Link>

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
