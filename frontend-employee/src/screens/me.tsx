import { Async, Empty, Panel, Row } from "@/components/bits"
import { StatusPill } from "@/components/status-pill"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useTheme } from "@/components/theme-provider"
import { dateTime, longDate, relativeDay, shortDate } from "@/lib/format"
import {
  useContracts,
  useEndSession,
  useHolidays,
  usePayrollIdentity,
  useProfile,
  useSessions,
} from "@/lib/hr/queries"
import { useSession } from "@/lib/session"

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
  const sessions = useSessions()
  const endSession = useEndSession()
  const { theme, setTheme } = useTheme()

  return (
    <div className="flex flex-col gap-4">
      <Panel title="You">
        <Async query={profile}>
          {(person) => (
            <>
              <div className="flex items-start gap-3">
                <div className="min-w-0">
                  <p className="text-base font-semibold">{person.full_name}</p>
                  <p className="text-[13px] text-muted-foreground">
                    {person.job_title} · {person.department}
                  </p>
                </div>
                <StatusPill status={person.status} className="ml-auto" />
              </div>
              <Separator />
              <Row label="Employee number">{person.employee_number}</Row>
              <Row label="Works at">{person.place_name}</Row>
              <Row label="Manager">{person.manager_name ?? "—"}</Row>
              <Row label="Joined">{longDate(person.joined_on)}</Row>
              <Row label="Work email">{person.work_email ?? "—"}</Row>
              <Row label="Phone">{person.phone ?? "—"}</Row>
              <p className="text-xs text-muted-foreground">
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
              <div key={contract.contract_id} className="flex flex-col gap-3">
                <Row label="Type">{contract.kind}</Row>
                <Row label="Started">{longDate(contract.started_on)}</Row>
                {/* A PKWT is fixed-term. The end date approaching is the whole
                    reason somebody opens this card, so it is spelled out in
                    days rather than left as a date to subtract. */}
                <Row label="Ends">
                  {contract.ends_on === null
                    ? "Open-ended"
                    : `${longDate(contract.ends_on)} · ${relativeDay(contract.ends_on)}`}
                </Row>
                <Row label="Hours a week">{contract.weekly_hours}</Row>
                <Row label="Place">{contract.place_name}</Row>
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
              <Row label="Account holder">{identity.account_holder ?? "—"}</Row>
              <Row label="NPWP">{identity.npwp ?? "—"}</Row>
              <Row label="PTKP">{identity.ptkp_status ?? "—"}</Row>
              <Row label="BPJS Kesehatan">{identity.bpjs_kesehatan ?? "—"}</Row>
              <Row label="BPJS Ketenagakerjaan">
                {identity.bpjs_ketenagakerjaan ?? "—"}
              </Row>
              <p className="text-xs text-muted-foreground">
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
                    {day.kind === "JOINT_LEAVE" && (
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        (cuti bersama)
                      </span>
                    )}
                  </Row>
                ))}
                <p className="text-xs text-muted-foreground">
                  {calendar.name} · {calendar.year}
                </p>
              </>
            )
          }
        </Async>
      </Panel>

      <Panel title="Signed in on">
        <Async query={sessions}>
          {(list) => (
            <div className="flex flex-col gap-3">
              {list.map((device) => (
                <div key={device.session_id} className="flex items-start gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium">
                      {device.user_agent ?? "Unknown device"}
                      {device.current && " · this one"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Last seen {dateTime(device.last_seen_at)}
                    </p>
                  </div>
                  {!device.current && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-auto"
                      disabled={endSession.isPending}
                      onClick={() => endSession.mutate(device.session_id)}
                    >
                      End
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
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
        <Separator />
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-muted-foreground">Appearance</span>
          <div className="ml-auto flex gap-1">
            {(["light", "dark", "system"] as const).map((option) => (
              <Button
                key={option}
                size="sm"
                variant={theme === option ? "secondary" : "ghost"}
                onClick={() => setTheme(option)}
              >
                {option}
              </Button>
            ))}
          </div>
        </div>
        <Button
          variant="outline"
          size="lg"
          className="h-11 w-full md:w-auto md:self-start"
          onClick={session.signOut}
        >
          Sign out
        </Button>
      </Panel>
    </div>
  )
}
