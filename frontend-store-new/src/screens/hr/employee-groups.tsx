import { useQuery } from "@tanstack/react-query"
import {
  FileSignature,
  HeartPulse,
  IdCard,
  Paperclip,
  User,
  UsersRound,
  type LucideIcon,
} from "lucide-react"

import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { LoadingState } from "@/components/ui/states"
import { label } from "@/lib/format"
import { leaveRequestsQuery } from "@/lib/queries/employee"
import {
  claimsQuery,
  hrKeys,
  leaveBalancesOf,
  lifecycleTasks,
  readCentidays,
  readDate,
  type StoreScope,
} from "@/lib/queries/hr"
import type { LineRead } from "@/lib/queries/line"
import {
  GENDERS,
  MARITAL,
  PAPER_KINDS,
  RELIGIONS,
  wordFor,
} from "@/lib/queries/papers"
import { cn } from "@/lib/utils"
import { describeCentre } from "@/screens/hr/centre"
import {
  Block,
  Blank,
  Fact,
  Facts,
  Quiet,
  Row,
  Rows,
  Timeline,
} from "@/screens/hr/employee-parts"
import { ReportsToBlock } from "@/screens/hr/employee-reports"
import { requestState } from "@/screens/hr/words"
import { money } from "@itulah/contract/money"
import type { EmployeeDossierView, EmployeeView } from "@itulah/contract"

/// The groups of a person's page, as the hub has them — **Profile · Work · Time
/// · Pay · Access** (`employee-page.tsx`) — for what a shop is allowed to see.
///
/// What is not here, because the relay does not carry it to a till: **Pay** (the
/// whole group — remuneration, loans, benefit), the **contracts** list, the
/// **position** record, **discipline**, **fingerprints**, and the scans
/// themselves (a shop files papers; it does not browse them). Each is
/// head office's, and a block that said it existed and was hidden would be
/// a block about pay.

// ── Profile ─────────────────────────────────────────────────────────────────

export function ProfileGroup({
  dossier,
  loading,
  error,
}: {
  dossier: EmployeeDossierView | undefined
  loading: boolean
  error: unknown
}) {
  if (loading) return <LoadingState>Reading the file…</LoadingState>
  if (dossier === undefined) {
    return <Quiet>{describeCentre(error, "this person's file")}</Quiet>
  }
  const personal = dossier.personal
  const details = dossier.details?.details
  const or = (value: string | null | undefined) =>
    value === null || value === undefined || value === "" ? <Blank /> : value

  return (
    <>
      <Block title="Personal">
        <Facts>
          <Fact term="Full Name">{or(personal?.full_name)}</Fact>
          <Fact term="NIK">{or(personal?.nik)}</Fact>
          <Fact term="Place of Birth">{or(details?.birth_place)}</Fact>
          <Fact term="Date of Birth">
            {personal ? readDate(personal.birth_date) : <Blank />}
          </Fact>
          <Fact term="Gender">{or(wordFor(GENDERS, details?.gender))}</Fact>
          <Fact term="Religion">
            {or(wordFor(RELIGIONS, details?.religion))}
          </Fact>
          <Fact term="Blood Type">{or(details?.blood_type)}</Fact>
          <Fact term="Nationality">{or(details?.nationality)}</Fact>
        </Facts>
      </Block>

      <Block title="Family">
        <Facts>
          <Fact term="Marital Status">
            {or(wordFor(MARITAL, details?.marital_status))}
          </Fact>
          <Fact term="Children">
            {details ? (
              details.children === 0 ? (
                "None"
              ) : details.children === 1 ? (
                "1 child"
              ) : (
                `${details.children} children`
              )
            ) : (
              <Blank />
            )}
          </Fact>
          <Fact term="Reads As">
            {dossier.details ? (
              <>
                {dossier.details.ptkp_hint}{" "}
                <span className="text-mute">PTKP</span>
              </>
            ) : (
              <Blank />
            )}
          </Fact>
        </Facts>
      </Block>

      <Block title="Address on the KTP">
        <Facts>
          <Fact term="Street" wide>
            {or(personal?.address)}
          </Fact>
          <Fact term="RT/RW">{or(details?.rt_rw)}</Fact>
          <Fact term="Village">{or(details?.village)}</Fact>
          <Fact term="District">{or(details?.district)}</Fact>
          <Fact term="City">{or(details?.city)}</Fact>
          <Fact term="Province">{or(details?.province)}</Fact>
        </Facts>
      </Block>

      <Block title="Contact">
        <Facts>
          <Fact term="Phone">{or(personal?.phone)}</Fact>
          <Fact term="Email">{or(personal?.email)}</Fact>
          <Fact term="Emergency Contact">{or(details?.emergency_name)}</Fact>
          <Fact term="Relation">{or(details?.emergency_relation)}</Fact>
          <Fact term="Their Phone">{or(details?.emergency_phone)}</Fact>
        </Facts>
      </Block>
    </>
  )
}

// ── Work ────────────────────────────────────────────────────────────────────

export function WorkGroup({
  person,
  scope,
  line,
}: {
  person: EmployeeView
  scope: StoreScope
  line: LineRead
}) {
  return (
    <>
      <Block title="Job">
        <Facts>
          <Fact term="Posted To">
            {person.current_unit_name ?? person.current_unit_id ?? "—"}
          </Fact>
          <Fact term="Registered">
            {readDate(person.created_at.slice(0, 10))}
          </Fact>
        </Facts>
      </Block>

      <ReportsToBlock scope={scope} id={person.employee_id} line={line} />

      <Block title="History">
        {person.history.length === 0 ? (
          <Quiet>
            Nothing has happened to this record yet — not even a hire.
          </Quiet>
        ) : (
          <Timeline
            events={person.history.map((event, index) => ({
              id: `${event.transition}-${event.at}-${index}`,
              title: `${event.transition} — ${event.from} → ${event.to}`,
              detail: `${event.actor} · ${event.reason}`,
              at: readDate(event.effective_on),
              current: index === person.history.length - 1,
            }))}
          />
        )}
      </Block>

      <Block title="Checklist">
        <Checklist employeeId={person.employee_id} />
      </Block>
    </>
  )
}

/// The person's onboarding or separation steps, as head office and the shop
/// share them. Read here; the shop completes its own in *Onboarding & exit*.
function Checklist({ employeeId }: { employeeId: string }) {
  const tasks = useQuery({
    queryKey: hrKeys.lifecycle(),
    queryFn: ({ signal }) => lifecycleTasks(signal),
  })
  if (tasks.isPending)
    return <LoadingState>Reading the checklist…</LoadingState>
  if (tasks.isError)
    return <Quiet>{describeCentre(tasks.error, "the checklist")}</Quiet>
  const rows = tasks.data.filter((one) => one.employee_id === employeeId)
  if (rows.length === 0) return <Quiet>No checklist yet.</Quiet>
  return (
    <div className="flex flex-col gap-4">
      {(["ONBOARDING", "SEPARATION"] as const)
        .filter((kind) => rows.some((one) => one.kind === kind))
        .map((kind) => {
          const mine = rows
            .filter((one) => one.kind === kind)
            .sort((left, right) => left.position - right.position)
          return (
            <div key={kind}>
              <div className="mb-1 text-[0.9375rem] font-medium text-ink">
                {label(kind)}
              </div>
              <Rows
                head={[
                  { label: "Step" },
                  { label: "Owner" },
                  { label: "State" },
                ]}
              >
                {mine.map((one) => (
                  <Row
                    key={one.id}
                    cells={[
                      { content: one.label },
                      { content: label(one.owner) },
                      {
                        content:
                          one.state === "DONE" ? (
                            <span className="text-ok-fg">Done</span>
                          ) : (
                            <span className="text-warn-fg">Open</span>
                          ),
                      },
                    ]}
                  />
                ))}
              </Rows>
            </div>
          )
        })}
    </div>
  )
}

// ── Time ────────────────────────────────────────────────────────────────────

export function TimeGroup({
  employeeId,
  scope,
}: {
  employeeId: string
  scope: StoreScope
}) {
  return (
    <>
      <Block title="Leave">
        <Leave employeeId={employeeId} />
      </Block>
      <Block title="Claims">
        <Claims employeeId={employeeId} scope={scope} />
      </Block>
    </>
  )
}

function Leave({ employeeId }: { employeeId: string }) {
  const balances = useQuery({
    queryKey: hrKeys.balancesOf(employeeId),
    queryFn: ({ signal }) => leaveBalancesOf(employeeId, signal),
  })
  const requests = useQuery(leaveRequestsQuery(employeeId))

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="mb-1 text-[0.9375rem] font-medium text-ink">
          Balances
        </div>
        {balances.isPending ? (
          <LoadingState>Reading the ledger…</LoadingState>
        ) : balances.isError ? (
          <Quiet>{describeCentre(balances.error, "the leave balances")}</Quiet>
        ) : balances.data.length === 0 ? (
          <Quiet>
            No kind of leave draws on a balance yet, so there is none to report.
          </Quiet>
        ) : (
          <Rows
            head={[
              { label: "Kind" },
              { label: "Pending", right: true },
              { label: "Left", right: true },
            ]}
          >
            {balances.data.map((row) => (
              <Row
                key={row.leave_type}
                cells={[
                  { content: row.name },
                  {
                    content:
                      row.pending_centidays === 0
                        ? "—"
                        : `${readCentidays(row.pending_centidays)} days`,
                    right: true,
                  },
                  {
                    content: `${readCentidays(row.centidays)} days`,
                    right: true,
                  },
                ]}
              />
            ))}
          </Rows>
        )}
      </div>

      <div>
        <div className="mb-1 text-[0.9375rem] font-medium text-ink">
          Requests
        </div>
        {requests.isPending ? (
          <LoadingState>Reading the requests…</LoadingState>
        ) : requests.isError ? (
          <Quiet>{describeCentre(requests.error, "the leave requests")}</Quiet>
        ) : requests.data.length === 0 ? (
          <Quiet>Never asked for a day off.</Quiet>
        ) : (
          <Rows
            head={[
              { label: "Kind" },
              { label: "From" },
              { label: "Charged", right: true },
            ]}
          >
            {requests.data.map((row) => (
              <Row
                key={row.id}
                cells={[
                  {
                    content: (
                      <>
                        <span className="block">{row.leave_type_name}</span>
                        <span className="block text-mute">
                          {requestState(row.state).label}
                        </span>
                      </>
                    ),
                  },
                  { content: readDate(row.from_date) },
                  { content: row.chargeable_days, right: true },
                ]}
              />
            ))}
          </Rows>
        )}
      </div>
    </div>
  )
}

/// What this person has asked the petty cash for. Read only: deciding a claim
/// is head office's, and the shop's queue is *Expenses*.
function Claims({
  employeeId,
  scope,
}: {
  employeeId: string
  scope: StoreScope
}) {
  const claims = useQuery(claimsQuery(scope.unit_id))
  if (claims.isPending) return <LoadingState>Reading the claims…</LoadingState>
  if (claims.isError) {
    return <Quiet>{describeCentre(claims.error, "this shop's claims")}</Quiet>
  }
  const rows = claims.data.filter((one) => one.employee_id === employeeId)
  if (rows.length === 0) {
    return <Quiet>Never asked the petty cash for anything.</Quiet>
  }
  return (
    <Rows
      head={[
        { label: "Claim" },
        { label: "Filed" },
        { label: "Claimed", right: true },
        { label: "Sanctioned", right: true },
      ]}
    >
      {rows.map((row) => (
        <Row
          key={row.claim_id}
          cells={[
            {
              content: (
                <>
                  <span className="block font-mono">{row.claim_number}</span>
                  <span className="block text-mute">{label(row.state)}</span>
                </>
              ),
            },
            { content: readDate(row.posted_on) },
            { content: money(row.claimed_minor), right: true },
            {
              content:
                row.sanctioned_minor === null
                  ? "—"
                  : money(row.sanctioned_minor),
              right: true,
            },
          ]}
        />
      ))}
    </Rows>
  )
}

// ── Access ──────────────────────────────────────────────────────────────────

export function AccessGroup({ person }: { person: EmployeeView }) {
  return (
    <Block title="Login">
      <Facts>
        <Fact term="Username">
          {person.account === null ? (
            "None"
          ) : person.account.active ? (
            person.account.username
          ) : (
            <span className="text-mute">
              {person.account.username} · closed
            </span>
          )}
        </Fact>
      </Facts>
    </Block>
  )
}

// ── the aside: papers and activity ──────────────────────────────────────────

const PAPER_ICON: Readonly<Record<string, LucideIcon>> = {
  PHOTO: User,
  KTP: IdCard,
  KK: UsersRound,
  SKCK: Paperclip,
  CONTRACT: FileSignature,
  NPWP: IdCard,
  BPJS: HeartPulse,
}

/// The papers on file, and whether the required two are there. A shop sees
/// which are on file and which are waiting on head office; it does not open
/// them.
export function Papers({
  dossier,
}: {
  dossier: EmployeeDossierView | undefined
}) {
  const missing = dossier?.missing.length ?? 0
  return (
    <Card>
      <CardHeader>
        <CardTitle>Papers</CardTitle>
        {dossier && (
          <span
            className={cn(
              "text-[0.9375rem]",
              missing > 0 ? "text-bad-fg" : "text-ok-fg",
            )}
          >
            {missing > 0 ? `${missing} required missing` : "Complete"}
          </span>
        )}
      </CardHeader>
      <div className="flex flex-col px-4 pb-3">
        {PAPER_KINDS.map((kind) => {
          const inForce = dossier?.documents.find(
            (one) => one.kind === kind.kind && one.state === "ACTIVE",
          )
          const waiting = dossier?.documents.find(
            (one) => one.kind === kind.kind && one.state === "PENDING",
          )
          const Icon = PAPER_ICON[kind.kind] ?? Paperclip
          return (
            <div
              key={kind.kind}
              className="flex items-center gap-3 border-t border-hairline py-3 first:border-t-0"
            >
              <div className="grid size-10 shrink-0 place-items-center rounded-inner bg-soft-2 text-body">
                <Icon className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 text-[0.9375rem] text-ink">
                  {kind.label}
                  {kind.required && <span className="text-mute">Required</span>}
                </div>
                <div className="text-[0.9375rem] [overflow-wrap:anywhere] text-body">
                  {inForce ? (
                    inForce.file_name
                  ) : dossier !== undefined && !waiting ? (
                    <span
                      className={kind.required ? "text-bad-fg" : "text-mute"}
                    >
                      {kind.required ? "Missing" : "Not on file"}
                    </span>
                  ) : null}
                  {waiting && (
                    <span className="block text-info-fg">
                      {inForce ? "New " : ""}
                      {waiting.file_name} · waiting on head office
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

export function Activity({ person }: { person: EmployeeView }) {
  const recent = [...person.history].reverse().slice(0, 4)
  if (recent.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-3 px-4 pb-4">
        {recent.map((event, index) => (
          <div key={`${event.transition}-${event.at}-${index}`}>
            <div className="text-[0.9375rem] text-ink">
              {event.transition} — {event.from} → {event.to}
            </div>
            <div className="text-[0.9375rem] text-body">
              {readDate(event.effective_on)} · {event.actor}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
