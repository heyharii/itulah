import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Pill } from "@/components/ui/pill"
import {
  MiniCell,
  MiniRow,
  MiniTable,
  SheetSection,
} from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { SheetEmpty, SheetQuery } from "@/components/ui/sheet-states"
import {
  EMPTY,
  clock,
  count,
  money,
  moment,
  recentMoment,
  time,
} from "@/lib/format"
import { useNameOfLogin } from "@/lib/queries/hr-employees"
import { fingerLabel } from "@/lib/queries/people"
import {
  posName,
  storePersonQuery,
  useResumePerson,
  type StoreFingerPerson,
  type StorePersonActivity,
  type StorePersonEvent,
  type StoreSummary,
} from "@/lib/queries/stores"
import { useSheet } from "@/lib/sheets"
import { StopPersonDialog } from "@/screens/stores/tills-tab"

/// One person of the store's team, opened from their row on the People tab
/// (owner, 2026-10-24: `store-opening-prototype.html`): who they are, whether
/// they are on a shift now, what they sold today, which POS they used and what
/// they did lately — and, for head office, the stop on their POS access.
///
/// A rail over the page, held in the address as `?person=<user id>` so a
/// reload keeps it and a link to it can be sent. It reads the person every ten
/// seconds while it is open and asks for nothing once it is shut.
///
/// The verbs are the POS tab's: Stop POS access asks the same question as the
/// Cashiers table (`StopPersonDialog`) and Resume POS access is the same write
/// (`useResumePerson`). Stopping is per person at every store, and once the
/// store itself is stopped or removed nothing is switched from here, as on the
/// POS tab.
export function PersonSheet({
  store,
  people,
}: {
  store: StoreSummary
  /// The team as the tab has read it: the name and role drawn while the
  /// person is read.
  people: readonly StoreFingerPerson[]
}) {
  const unit = store.unit_id
  const sheet = useSheet("person")
  const nameOf = useNameOfLogin()
  // The sheet's last person stays while it slides away, so it does not flash
  // empty on its way out.
  const [last, setLast] = useState<string | undefined>(sheet.value)
  if (sheet.value !== undefined && sheet.value !== last) setLast(sheet.value)
  const userId = sheet.value ?? last

  const activity = useQuery({
    ...storePersonQuery(unit, userId ?? ""),
    enabled: sheet.isOpen && userId !== undefined,
  })
  const person = activity.data
  const row = people.find((one) => one.user_id === userId)

  const resume = useResumePerson(unit)
  // The stop question is asked in a dialog beside the sheet; a new `asked` is
  // a fresh dialog with a clean write.
  const [stopOpen, setStopOpen] = useState(false)
  const [asked, setAsked] = useState(0)

  const stopped =
    person === undefined ? row?.stopped === true : person.stop !== null
  // Who the caller may stop or resume here: nobody once the store itself is
  // stopped or removed.
  const actor =
    person !== undefined &&
    person.can_manage &&
    store.status !== "STOPPED" &&
    store.status !== "CLOSED"
      ? person
      : undefined
  const employee = person?.employee_id ?? null

  return (
    <>
      <Sheet
        open={sheet.isOpen}
        onOpenChange={(next) => !next && sheet.close()}
        size="rail"
        stack
        id={store.code}
        title={person?.name ?? row?.name ?? "Person"}
        badge={stopped ? <Pill tone="bad">Stopped</Pill> : undefined}
        footer={
          person !== undefined && (actor !== undefined || employee !== null) ? (
            <SheetFooter
              error={resume.error}
              danger={
                actor !== undefined && !stopped ? (
                  <Button
                    variant="destructive"
                    onClick={() => {
                      setAsked((times) => times + 1)
                      setStopOpen(true)
                    }}
                  >
                    Stop POS access
                  </Button>
                ) : undefined
              }
              secondary={
                employee !== null ? (
                  <AppLink
                    to="/people"
                    sheet={{ key: "employee", value: employee }}
                    variant="primary"
                    className="max-md:h-11 md:h-9"
                  >
                    Open employee
                  </AppLink>
                ) : undefined
              }
              primary={
                actor !== undefined && stopped
                  ? {
                      label: "Resume POS access",
                      pendingLabel: "Resuming…",
                      pending: resume.isPending,
                      onClick: () => resume.mutate(actor.user_id),
                    }
                  : undefined
              }
            />
          ) : undefined
        }
      >
        <SheetQuery query={activity} what="person">
          {(found) => <PersonBody person={found} nameOf={nameOf} />}
        </SheetQuery>
      </Sheet>

      {asked > 0 && person !== undefined && (
        <StopPersonDialog
          key={asked}
          person={person}
          shift={
            person.on_shift === null
              ? "None open"
              : `${posName(person.on_shift.pos)} · ${time(person.on_shift.opened_at)} · closing only`
          }
          action="Stop POS access"
          unit={unit}
          open={stopOpen}
          onOpenChange={setStopOpen}
        />
      )}
    </>
  )
}

/// What the sheet says: the stop, if there is one, then the facts, the POS the
/// person used and what they did.
function PersonBody({
  person,
  nameOf,
}: {
  person: StorePersonActivity
  nameOf: (username: string) => string
}) {
  const stop = person.stop
  return (
    <>
      {stop !== null && (
        <p className="text-[0.9375rem] text-bad-fg">
          Stopped{stop.by === "" ? "" : ` by ${nameOf(stop.by)}`} on{" "}
          {moment(stop.at)}
          {stop.reason === "" ? "" : `: ${stop.reason}`}
        </p>
      )}

      <Facts>
        <Fact term="Role">{person.role}</Fact>
        <Fact term="Login">{person.username}</Fact>
        <Fact term="Fingers" wide>
          {fingersSaid(person)}
        </Fact>
        <Fact term="Now" wide>
          {person.on_shift === null
            ? "Not on shift"
            : `On shift at ${posName(person.on_shift.pos)} since ${clock(person.on_shift.opened_at)}`}
        </Fact>
        <Fact term="Sales today">
          {count(person.sales_today)} · {money(person.takings_today_minor)}
        </Fact>
        <Fact term="Last active">
          {person.last_active_at === null
            ? EMPTY
            : moment(person.last_active_at)}
        </Fact>
      </Facts>

      <SheetSection title="POS used">
        {person.devices.length === 0 ? (
          <SheetEmpty>No POS used in the last 30 days</SheetEmpty>
        ) : (
          <MiniTable head={["POS", "Shifts", "Last used"]}>
            {person.devices.map((device) => (
              <MiniRow key={device.pos}>
                <MiniCell className="font-medium text-ink">
                  {posName(device.pos)}
                </MiniCell>
                <MiniCell align="right">{count(device.shifts)}</MiniCell>
                <MiniCell align="right">
                  {recentMoment(device.last_used_at)}
                </MiniCell>
              </MiniRow>
            ))}
          </MiniTable>
        )}
      </SheetSection>

      <SheetSection
        title="Activity"
        aside={person.recent.length > 0 ? person.recent.length : undefined}
      >
        {person.recent.length === 0 ? (
          <SheetEmpty>Nothing in the last 14 days</SheetEmpty>
        ) : (
          <ul className="flex flex-col divide-y divide-hairline border-y border-hairline">
            {person.recent.map((event, index) => (
              <li
                key={`${event.at}-${event.kind}-${index}`}
                className="flex items-baseline justify-between gap-4 py-2.5 text-[0.9375rem]"
              >
                <span className="min-w-0 [overflow-wrap:anywhere] text-ink">
                  {eventSaid(event)}
                </span>
                <span className="shrink-0 text-mute tabular-nums">
                  {recentMoment(event.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SheetSection>
    </>
  )
}

/// The fingers in words — `Left thumb, Right index` — and how many still wait
/// for head office.
function fingersSaid(person: StorePersonActivity): string {
  const parts: string[] = []
  if (person.fingers.length > 0)
    parts.push(person.fingers.map(fingerLabel).join(", "))
  if (person.waiting > 0) parts.push(`${person.waiting} waiting for approval`)
  return parts.length === 0 ? "No finger yet" : parts.join(" · ")
}

/// One line of activity, as a sentence. A drawer closed with a difference says
/// it, with its sign; a day's sales say how many and how much.
function eventSaid(event: StorePersonEvent): string {
  const at = event.pos === null ? null : posName(event.pos)
  switch (event.kind) {
    case "SHIFT_OPENED":
      return ["Opened a shift", at].filter(present).join(" · ")
    case "SHIFT_CLOSED": {
      const difference = event.amount_minor
      return [
        "Closed a shift",
        at,
        difference === null || difference === 0
          ? null
          : `Difference ${difference > 0 ? "+" : ""}${money(difference)}`,
      ]
        .filter(present)
        .join(" · ")
    }
    case "SALES": {
      const sales = event.count ?? 0
      const said = `${count(sales)} ${sales === 1 ? "sale" : "sales"}`
      return event.amount_minor === null
        ? said
        : `${said} · ${money(event.amount_minor)}`
    }
    default:
      return event.kind
  }
}

function present(part: string | null): part is string {
  return part !== null && part !== ""
}
