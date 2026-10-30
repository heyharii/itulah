import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  FileSignature,
  HeartPulse,
  Hourglass,
  IdCard,
  Inbox,
  Paperclip,
  Upload,
  User,
  UsersRound,
  type LucideIcon,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Day } from "@/components/ui/day"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { SubHead } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Banner, ErrorState } from "@/components/ui/states"
import { Timeline } from "@/components/ui/timeline"
import { day, dayIndonesian } from "@/lib/format"
import {
  BLOOD_TYPES,
  GENDERS,
  MARITAL,
  PAPER_KINDS,
  RELIGIONS,
  blankDetails,
  decideDataUpdate,
  fileDataUpdate,
  fileDocuments,
  paperBlob,
  papersKeys,
  saveDetails,
  uploadPaper,
  uploadPapers,
  useDossier,
  withdrawDataUpdate,
  wordFor,
} from "@/lib/queries/papers"
import {
  amendPersonalData,
  leaveBalances,
  leaveKeys,
  peopleKeys,
  readContracts,
  readDays,
  readEmployee,
  statusLabel,
  type AmendableField,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { setLetterPreset } from "@/screens/letters/preset"
import { BenefitPanel } from "@/screens/people/benefit-page"
import { ChecklistPanel } from "@/screens/people/checklist"
import {
  Changes,
  ClaimsTab,
  Contracts,
  ExitTab,
  LeaveTab,
  statusTone,
} from "@/screens/people/directory"
import { DisciplinePanel } from "@/screens/people/discipline"
import { FingerprintsPanel } from "@/screens/people/fingerprints"
import { LoansPanel } from "@/screens/people/loans"
import { Quiet } from "@/screens/people/parts"
import { PayPanel } from "@/screens/people/pay"
import { PlacementPanel } from "@/screens/people/placement"
import { usePeopleAudience } from "@/screens/people/scope"
import type {
  EmployeeDataUpdateView,
  EmployeeDetails,
  EmployeeDocumentView,
  EmployeeDossierView,
  EmployeeView,
  PersonalChanges,
} from "@itulah/contract"

/// One person, as a page: five groups — Profile · Work · Time · Pay · Access
/// (owner, 2026-10-26, from `hr-profile-prototype.html`, "Five groups").
///
/// It was a sheet of thirteen tabs over the Directory. A person is the thing
/// HR works on all day, and the client's own list (information, user,
/// fingerprint, password, attendance, remuneration) is six doors of one
/// record, not thirteen. Five groups hold all of it and still fit a phone
/// without a picker.
///
/// Reached from the Directory at `/people/employee?employee={id}`; the old
/// `/people?employee=` link lands here too (`Directory`).
///
/// **Head office** writes the file straight away. **A store** can only ask:
/// its change waits as one banner on the page until head office takes it or
/// sends it back, and the person's file is unchanged until then. Pay is head
/// office's alone, as before.

const GROUPS = [
  { value: "profile", label: "Profile" },
  { value: "work", label: "Work" },
  { value: "time", label: "Time" },
  { value: "pay", label: "Pay" },
  { value: "access", label: "Access" },
] as const

type Group = (typeof GROUPS)[number]["value"]

/// Where a link that named a section of the old sheet now lands
/// (`/people/employee?employee=…#change`).
const LANDING: Readonly<Record<string, Group>> = {
  profile: "profile",
  record: "work",
  contracts: "work",
  position: "work",
  checklist: "work",
  discipline: "work",
  exit: "work",
  change: "work",
  work: "work",
  leave: "time",
  claims: "time",
  time: "time",
  pay: "pay",
  loans: "pay",
  benefit: "pay",
  fingerprints: "access",
  access: "access",
}

export function EmployeePage() {
  const employee = useSheet("employee")
  const id = employee.value ?? null
  const employer = usePeopleAudience() === "employer"
  const navigate = useNavigate()

  const person = useQuery({
    queryKey: peopleKeys.employee(id ?? ""),
    queryFn: ({ signal }) => readEmployee(id!, signal),
    enabled: id !== null,
  })
  const dossier = useDossier(id)

  const [group, setGroup] = useState<Group>("profile")
  useEffect(() => {
    if (id === null) return
    const wanted = window.location.hash.slice(1)
    setGroup(LANDING[wanted] ?? "profile")
    if (wanted !== "")
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + window.location.search
      )
  }, [id])

  const [editing, setEditing] = useState(false)
  const [reviewing, setReviewing] = useState(false)

  if (id === null)
    return (
      <PageContent>
        <Quiet>Pick a person from the Directory.</Quiet>
      </PageContent>
    )

  const tabs = GROUPS.filter((one) => employer || one.value !== "pay")
  const waiting = dossier.data?.updates.find((one) => one.state === "PENDING")
  const name =
    dossier.data?.personal?.full_name ??
    person.data?.employee_code ??
    "Employee"

  return (
    <PageContent>
      <div className="flex flex-col gap-5">
        <nav className="flex items-center gap-2 text-[0.9375rem] text-mute">
          <button
            type="button"
            className="record-link"
            onClick={() => void navigate({ to: "/people" })}
          >
            {employer ? "Employees" : "Staff"}
          </button>
          <span aria-hidden>›</span>
          <span className="text-ink">{name}</span>
        </nav>

        {queryState(person, {
          loading: "Loading the record…",
          render: (view) => (
            <>
              <Head
                person={view}
                name={name}
                dossier={dossier.data}
                employer={employer}
                waiting={waiting}
                onEdit={() => setEditing(true)}
              />
              <Figures
                person={view}
                dossier={dossier.data}
                employeeId={view.employee_id}
              />

              {waiting && (
                <WaitingBanner
                  update={waiting}
                  employer={employer}
                  onReview={() => setReviewing(true)}
                />
              )}

              <SubTabs
                dock={false}
                tabs={tabs}
                value={group}
                onChange={(next) => setGroup(next as Group)}
              />

              <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
                <div className="flex min-w-0 flex-col gap-5">
                  {group === "profile" && (
                    <ProfileGroup
                      dossier={dossier.data}
                      loading={dossier.isPending}
                      error={dossier.error}
                    />
                  )}
                  {group === "work" && (
                    <WorkGroup person={view} employer={employer} />
                  )}
                  {group === "time" && <TimeGroup employeeId={id} />}
                  {group === "pay" && employer && (
                    <PayGroup person={view} name={name} />
                  )}
                  {group === "access" && (
                    <AccessGroup
                      person={view}
                      name={name}
                      employer={employer}
                    />
                  )}
                </div>
                <aside className="flex min-w-0 flex-col gap-5 lg:sticky lg:top-20">
                  <Papers
                    employeeId={id}
                    dossier={dossier.data}
                    employer={employer}
                  />
                  <Activity person={view} />
                </aside>
              </div>

              <EditSheet
                open={editing}
                onClose={() => setEditing(false)}
                employeeId={id}
                dossier={dossier.data}
                employer={employer}
              />
              {waiting && (
                <ReviewSheet
                  open={reviewing}
                  onClose={() => setReviewing(false)}
                  update={waiting}
                />
              )}
            </>
          ),
        })}
      </div>
    </PageContent>
  )
}

// ── the head and the four figures ───────────────────────────────────────────

function Head({
  person,
  name,
  dossier,
  employer,
  waiting,
  onEdit,
}: {
  person: EmployeeView
  name: string
  dossier: EmployeeDossierView | undefined
  employer: boolean
  waiting: EmployeeDataUpdateView | undefined
  onEdit: () => void
}) {
  const contracts = useQuery({
    queryKey: peopleKeys.contracts(person.employee_id),
    queryFn: ({ signal }) => readContracts(person.employee_id, signal),
  })
  const inForce = contracts.data?.contracts.find((one) => one.in_force)
  const position = inForce?.position
  const navigate = useNavigate()
  /// Their contract, drafted in Letters from what the record already says and
  /// edited on the paper there. Fixed-term when the agreement has an end.
  const writeContract = () => {
    const long = (iso: string) => dayIndonesian(new Date(`${iso}T00:00:00`))
    setLetterPreset({
      form: inForce?.ends_on ? "pkwt" : "pkwtt",
      values: {
        employee: name,
        role: position ?? "",
        place_to: person.current_unit_name ?? "",
        ...(inForce ? { start_date: long(inForce.starts_on) } : {}),
        ...(inForce?.ends_on ? { end_date: long(inForce.ends_on) } : {}),
      },
    })
    void navigate({ to: "/letters" })
  }
  const photo = dossier?.documents.find(
    (one) => one.kind === "PHOTO" && one.state === "ACTIVE"
  )

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-5">
      <div className="flex min-w-0 items-center gap-4">
        <Avatar name={name} photo={photo} />
        <div className="min-w-0">
          <h1 className="text-[1.375rem] leading-7 font-semibold text-ink [overflow-wrap:anywhere]">
            {name}
          </h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.9375rem] text-body">
            <span className="font-mono">{person.employee_code}</span>
            {position && <span>· {position}</span>}
            {person.current_unit_name && (
              <span>· {person.current_unit_name}</span>
            )}
            <Pill tone={statusTone(person.status)}>
              {statusLabel(person.status)}
            </Pill>
          </div>
        </div>
      </div>
      {/* One action: head office edits, a store asks. While a change waits
          there is nothing to add to it — it is reviewed or withdrawn first. */}
      <div className="flex gap-2">
        {employer && (
          <Button variant="ghost" onClick={writeContract}>
            Write contract
          </Button>
        )}
        {!waiting && (
          <Button variant="primary" onClick={onEdit}>
            {employer ? "Edit" : "Change data"}
          </Button>
        )}
      </div>
    </div>
  )
}

function Avatar({
  name,
  photo,
}: {
  name: string
  photo: EmployeeDocumentView | undefined
}) {
  const scan = useQuery({
    queryKey: ["people", "papers", "blob", photo?.id ?? ""],
    queryFn: async () => URL.createObjectURL(await paperBlob(photo!.id)),
    enabled: photo !== undefined,
    staleTime: Infinity,
  })
  const initials = name
    .split(" ")
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
  return scan.data ? (
    <img
      src={scan.data}
      alt=""
      className="size-14 shrink-0 rounded-full object-cover"
    />
  ) : (
    <div
      aria-hidden
      className="grid size-14 shrink-0 place-items-center rounded-full bg-soft-2 text-[1.125rem] font-semibold text-body"
    >
      {initials}
    </div>
  )
}

function Figures({
  person,
  dossier,
  employeeId,
}: {
  person: EmployeeView
  dossier: EmployeeDossierView | undefined
  employeeId: string
}) {
  const contracts = useQuery({
    queryKey: peopleKeys.contracts(employeeId),
    queryFn: ({ signal }) => readContracts(employeeId, signal),
  })
  const balances = useQuery({
    queryKey: leaveKeys.balances(employeeId),
    queryFn: ({ signal }) => leaveBalances(employeeId, signal),
  })

  const joined = person.history.find((event) => event.transition === "HIRE")
  const inForce = contracts.data?.contracts.find((one) => one.in_force)
  const left = balances.data?.reduce((sum, row) => sum + row.centidays, 0)
  const missing = dossier?.missing ?? []

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Figure label="Joined">{joined ? day(joined.effective_on) : "—"}</Figure>
      <Figure label="Contract ends">
        {inForce
          ? inForce.ends_on
            ? `${day(inForce.ends_on)} · ${inForce.kind}`
            : `No end · ${inForce.kind}`
          : "—"}
      </Figure>
      <Figure label="Leave left">
        {left === undefined ? "—" : readDays(left)}
      </Figure>
      <Figure
        label="Papers"
        tone={dossier === undefined ? undefined : missing.length > 0 ? "bad" : "ok"}
      >
        {dossier === undefined
          ? "—"
          : missing.length > 0
            ? `${missing.join(", ")} missing`
            : "Complete"}
      </Figure>
    </div>
  )
}

function Figure({
  label,
  tone,
  children,
}: {
  label: string
  tone?: "ok" | "bad"
  children: React.ReactNode
}) {
  return (
    <Card className="px-4 py-3">
      <div className="text-[0.9375rem] text-body">{label}</div>
      <div
        className={
          "mt-0.5 text-[1.0625rem] font-semibold tabular-nums " +
          (tone === "bad"
            ? "text-bad-fg"
            : tone === "ok"
              ? "text-ok-fg"
              : "text-ink")
        }
      >
        {children}
      </div>
    </Card>
  )
}

// ── a store's change, waiting ───────────────────────────────────────────────

function WaitingBanner({
  update,
  employer,
  onReview,
}: {
  update: EmployeeDataUpdateView
  employer: boolean
  onReview: () => void
}) {
  const client = useQueryClient()
  const [problem, setProblem] = useState<unknown>(null)
  const touched = changedLabels(update)

  async function withdraw() {
    setProblem(null)
    try {
      await withdrawDataUpdate(update.id, "Withdrawn by the store")
      await client.invalidateQueries({ queryKey: papersKeys.all() })
    } catch (error) {
      setProblem(error)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Banner tone={employer ? "warn" : "info"}>
        <span className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            {employer ? (
              <Inbox className="size-4" />
            ) : (
              <Hourglass className="size-4" />
            )}
            {employer
              ? `${update.filed_by} asks to change ${touched}`
              : `Waiting on head office · ${touched}`}
          </span>
          {employer ? (
            <Button variant="primary" onClick={onReview}>
              Review
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void withdraw()}>
              Withdraw
            </Button>
          )}
        </span>
      </Banner>
      {problem !== null && <ErrorState error={problem} />}
    </div>
  )
}

/// What a change touches, in words: "Address, Phone and KK scan".
function changedLabels(update: EmployeeDataUpdateView): string {
  const parts: string[] = []
  for (const [key, label] of PERSONAL_LABELS)
    if (update.personal[key] !== null) parts.push(label)
  if (update.details !== null) parts.push("Personal details")
  for (const paper of update.documents)
    parts.push(
      PAPER_KINDS.find((kind) => kind.kind === paper.kind)?.label ?? paper.kind
    )
  if (parts.length < 2) return parts.join("").toLowerCase() || "the file"
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`.replace(
    /^(\w)/,
    (c) => c.toLowerCase()
  )
}

const PERSONAL_LABELS: readonly [keyof PersonalChanges, string][] = [
  ["full_name", "Full name"],
  ["nik", "NIK"],
  ["birth_date", "Date of birth"],
  ["address", "Address"],
  ["phone", "Phone"],
  ["email", "Email"],
]

// ── Profile ─────────────────────────────────────────────────────────────────

function Block({
  title,
  aside,
  children,
}: {
  title: React.ReactNode
  aside?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {aside}
      </CardHeader>
      <div className="px-4 pt-1 pb-5">{children}</div>
    </Card>
  )
}

function ProfileGroup({
  dossier,
  loading,
  error,
}: {
  dossier: EmployeeDossierView | undefined
  loading: boolean
  error: unknown
}) {
  if (loading) return <Quiet>Loading the file…</Quiet>
  if (dossier === undefined) return <ErrorState error={error} />
  const personal = dossier.personal
  const details = dossier.details?.details
  const blank = <span className="text-mute">—</span>
  const or = (value: string | null | undefined) =>
    value === null || value === undefined || value === "" ? blank : value

  return (
    <>
      <Block title="Personal">
        <Facts>
          <Fact term="Full name">{or(personal?.full_name)}</Fact>
          <Fact term="NIK">{or(personal?.nik)}</Fact>
          <Fact term="Place of birth">{or(details?.birth_place)}</Fact>
          <Fact term="Date of birth">
            {personal ? day(personal.birth_date) : blank}
          </Fact>
          <Fact term="Gender">{or(wordFor(GENDERS, details?.gender))}</Fact>
          <Fact term="Religion">
            {or(wordFor(RELIGIONS, details?.religion))}
          </Fact>
          <Fact term="Blood type">{or(details?.blood_type)}</Fact>
          <Fact term="Nationality">{or(details?.nationality)}</Fact>
        </Facts>
      </Block>

      <Block title="Family">
        <Facts>
          <Fact term="Marital status">
            {or(wordFor(MARITAL, details?.marital_status))}
          </Fact>
          <Fact term="Children">
            {details
              ? details.children === 0
                ? "None"
                : details.children === 1
                  ? "1 child"
                  : `${details.children} children`
              : blank}
          </Fact>
          <Fact term="Reads as">
            {dossier.details ? (
              <>
                {dossier.details.ptkp_hint}{" "}
                <span className="text-mute">PTKP</span>
              </>
            ) : (
              blank
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
          <Fact term="Emergency contact">{or(details?.emergency_name)}</Fact>
          <Fact term="Relation">{or(details?.emergency_relation)}</Fact>
          <Fact term="Their phone">{or(details?.emergency_phone)}</Fact>
        </Facts>
      </Block>
    </>
  )
}

// ── Work ────────────────────────────────────────────────────────────────────

function WorkGroup({
  person,
  employer,
}: {
  person: EmployeeView
  employer: boolean
}) {
  return (
    <>
      <Block title="Job">
        <Facts>
          <Fact term="Posted to">
            {person.current_unit_name ?? person.current_unit_id ?? "—"}
          </Fact>
          <Fact term="Registered">{day(person.created_at)}</Fact>
        </Facts>
      </Block>

      <Block title="Contracts">
        <Contracts employeeId={person.employee_id} />
      </Block>

      {employer && (
        <Block title="Position">
          <PlacementPanel employeeId={person.employee_id} />
        </Block>
      )}

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
              at: day(event.effective_on),
              state: index === person.history.length - 1 ? "current" : "done",
            }))}
          />
        )}
      </Block>

      <Block title="Checklist">
        <ChecklistPanel employeeId={person.employee_id} />
      </Block>

      {employer && (
        <Block title="Discipline">
          <DisciplinePanel employeeId={person.employee_id} />
        </Block>
      )}

      {person.status === "TERMINATED" && (
        <Block title="Exit">
          <ExitTab employeeId={person.employee_id} employer={employer} />
        </Block>
      )}

      {employer && (
        <Block title="Change">
          <Changes
            employeeId={person.employee_id}
            account={person.account}
          />
        </Block>
      )}
    </>
  )
}

// ── Time ────────────────────────────────────────────────────────────────────

function TimeGroup({ employeeId }: { employeeId: string }) {
  return (
    <>
      <Block title="Leave">
        <LeaveTab employeeId={employeeId} />
      </Block>
      <Block title="Claims">
        <ClaimsTab employeeId={employeeId} />
      </Block>
    </>
  )
}

// ── Pay (head office) ───────────────────────────────────────────────────────

function PayGroup({ person, name }: { person: EmployeeView; name: string }) {
  return (
    <>
      <Block title="Remuneration">
        <PayPanel employeeId={person.employee_id} />
      </Block>
      <Block title="Loans">
        <LoansPanel employeeId={person.employee_id} />
      </Block>
      <Block title="Benefit">
        <BenefitPanel
          employeeId={person.employee_id}
          name={name}
          code={person.employee_code}
        />
      </Block>
    </>
  )
}

// ── Access ──────────────────────────────────────────────────────────────────

function AccessGroup({
  person,
  name,
  employer,
}: {
  person: EmployeeView
  name: string
  employer: boolean
}) {
  return (
    <>
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
          {person.status !== "ACTIVE" &&
            person.status !== "CANDIDATE" &&
            person.account !== null &&
            person.account.active && (
              // Ending or suspending employment closes the login as part of
              // the same act, so this is either a binding made before that
              // was true or a close that failed.
              <Fact term="Warning">
                <Pill tone="bad">Login still open</Pill>
              </Fact>
            )}
        </Facts>
      </Block>
      <Block title="Fingerprints">
        <FingerprintsPanel
          employeeId={person.employee_id}
          name={name}
          employer={employer}
          leaver={person.status === "TERMINATED"}
        />
      </Block>
    </>
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

function Papers({
  employeeId,
  dossier,
  employer,
}: {
  employeeId: string
  dossier: EmployeeDossierView | undefined
  employer: boolean
}) {
  const missing = dossier?.missing.length ?? 0
  return (
    <Card>
      <CardHeader>
        <CardTitle>Papers</CardTitle>
        {dossier && (
          <span
            className={
              "text-[0.9375rem] " + (missing > 0 ? "text-bad-fg" : "text-ok-fg")
            }
          >
            {missing > 0 ? `${missing} required missing` : "Complete"}
          </span>
        )}
      </CardHeader>
      <div className="flex flex-col px-4 pb-3">
        {PAPER_KINDS.map((kind) => (
          <PaperRow
            key={kind.kind}
            employeeId={employeeId}
            kind={kind}
            inForce={dossier?.documents.find(
              (one) => one.kind === kind.kind && one.state === "ACTIVE"
            )}
            waiting={dossier?.documents.find(
              (one) => one.kind === kind.kind && one.state === "PENDING"
            )}
            employer={employer}
            ready={dossier !== undefined}
          />
        ))}
      </div>
    </Card>
  )
}

function PaperRow({
  employeeId,
  kind,
  inForce,
  waiting,
  employer,
  ready,
}: {
  employeeId: string
  kind: (typeof PAPER_KINDS)[number]
  inForce: EmployeeDocumentView | undefined
  waiting: EmployeeDocumentView | undefined
  employer: boolean
  ready: boolean
}) {
  const client = useQueryClient()
  const picker = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<unknown>(null)
  const Icon = PAPER_ICON[kind.kind] ?? Paperclip

  async function open(document: EmployeeDocumentView) {
    const blob = await paperBlob(document.id)
    window.open(URL.createObjectURL(blob), "_blank", "noopener")
  }

  async function put(file: File) {
    setBusy(true)
    setProblem(null)
    try {
      const stored = await uploadPaper(file)
      await fileDocuments(employeeId, {
        documents: [{ kind: kind.kind, file_id: stored.file_id }],
        reason: `${kind.label} filed on the person's page`,
      })
      await client.invalidateQueries({ queryKey: papersKeys.all() })
    } catch (error) {
      setProblem(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-3 border-t border-hairline py-3 first:border-t-0">
      <div className="grid size-10 shrink-0 place-items-center rounded-inner bg-soft-2 text-body">
        <Icon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 text-[0.9375rem] text-ink">
          {kind.label}
          {kind.required && <span className="text-mute">Required</span>}
        </div>
        <div className="text-[0.9375rem] text-body [overflow-wrap:anywhere]">
          {inForce ? (
            <button
              type="button"
              className="record-link text-left"
              onClick={() => void open(inForce)}
            >
              {inForce.file_name}
            </button>
          ) : ready && !waiting ? (
            <span className={kind.required ? "text-bad-fg" : "text-mute"}>
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
        {problem !== null && <ErrorState error={problem} />}
      </div>
      {employer && ready && (
        <>
          <input
            ref={picker}
            type="file"
            hidden
            accept={kind.accept}
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ""
              if (file) void put(file)
            }}
          />
          <Button
            variant="primary"
            size="sm"
            pending={busy}
            onClick={() => picker.current?.click()}
          >
            {inForce ? (
              "Replace"
            ) : (
              <>
                <Upload />
                Upload
              </>
            )}
          </Button>
        </>
      )}
    </div>
  )
}

function Activity({ person }: { person: EmployeeView }) {
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
              {day(event.effective_on)} · {event.actor}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ── Edit (head office) and Change data (a store) ────────────────────────────

interface Draft {
  full_name: string
  nik: string
  birth_date: string
  address: string
  phone: string
  email: string
  details: EmployeeDetails
  reason: string
  papers: Record<string, File | undefined>
}

function draftOf(dossier: EmployeeDossierView | undefined): Draft {
  return {
    full_name: dossier?.personal?.full_name ?? "",
    nik: dossier?.personal?.nik ?? "",
    birth_date: dossier?.personal?.birth_date ?? "",
    address: dossier?.personal?.address ?? "",
    phone: dossier?.personal?.phone ?? "",
    email: dossier?.personal?.email ?? "",
    details: dossier?.details?.details ?? blankDetails(),
    reason: "",
    papers: {},
  }
}

const AMEND: readonly [keyof PersonalChanges, AmendableField][] = [
  ["full_name", "name"],
  ["nik", "nik"],
  ["birth_date", "birth_date"],
  ["address", "address"],
  ["phone", "phone"],
  ["email", "email"],
]

function EditSheet({
  open,
  onClose,
  employeeId,
  dossier,
  employer,
}: {
  open: boolean
  onClose: () => void
  employeeId: string
  dossier: EmployeeDossierView | undefined
  employer: boolean
}) {
  const client = useQueryClient()
  const [draft, setDraft] = useState<Draft>(() => draftOf(dossier))
  const [pending, setPending] = useState(false)
  const [problem, setProblem] = useState<unknown>(null)

  // Each time the sheet opens it starts from the file as it stands now.
  useEffect(() => {
    if (open) {
      setDraft(draftOf(dossier))
      setProblem(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const original = useMemo(() => draftOf(dossier), [dossier])
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((now) => ({ ...now, [key]: value }))
  const setDetail = <K extends keyof EmployeeDetails>(
    key: K,
    value: EmployeeDetails[K]
  ) => setDraft((now) => ({ ...now, details: { ...now.details, [key]: value } }))

  const personal: PersonalChanges = {
    full_name: null,
    nik: null,
    birth_date: null,
    address: null,
    phone: null,
    email: null,
  }
  let touched = 0
  for (const [key] of AMEND) {
    if (draft[key] !== original[key]) {
      personal[key] = draft[key]
      touched += 1
    }
  }
  const detailsChanged =
    JSON.stringify(draft.details) !== JSON.stringify(original.details)
  const picked = Object.entries(draft.papers).filter(
    (entry): entry is [string, File] => entry[1] !== undefined
  )
  // The detail set is one revision: the card's own four and the birth place
  // are all asked for together, and a contact is a name with a number.
  const dd = draft.details
  const detailsMissing =
    detailsChanged &&
    (dd.birth_place.trim() === "" ||
      dd.gender === "" ||
      dd.religion === "" ||
      dd.marital_status === "" ||
      (dd.emergency_name ?? "").trim() === "" !==
        ((dd.emergency_phone ?? "").trim() === ""))
  const ready =
    (touched > 0 || detailsChanged || picked.length > 0) &&
    !detailsMissing &&
    draft.reason.trim() !== ""

  async function submit() {
    setPending(true)
    setProblem(null)
    const reason = draft.reason.trim()
    try {
      if (employer) {
        // Head office writes the file: one amendment per personal field, the
        // detail set as one revision, each paper straight onto the file.
        for (const [key, field] of AMEND) {
          if (personal[key] === null) continue
          await amendPersonalData(employeeId, {
            field,
            value: field === "birth_date" ? undefined : draft[key],
            birthDate: field === "birth_date" ? draft[key] : undefined,
            reason,
          })
        }
        if (detailsChanged)
          await saveDetails(employeeId, { details: draft.details, reason })
        if (picked.length > 0)
          await fileDocuments(employeeId, {
            documents: await uploadPapers(
              picked.map(([kind, file]) => ({ kind, file }))
            ),
            reason,
          })
      } else {
        await fileDataUpdate(employeeId, {
          personal,
          details: detailsChanged ? draft.details : null,
          documents: await uploadPapers(
            picked.map(([kind, file]) => ({ kind, file }))
          ),
          reason,
        })
      }
      await client.invalidateQueries({ queryKey: papersKeys.all() })
      await client.invalidateQueries({ queryKey: peopleKeys.all })
      onClose()
    } catch (error) {
      setProblem(error)
      // Whatever was written before the refusal stands; show it.
      await client.invalidateQueries({ queryKey: papersKeys.all() })
    } finally {
      setPending(false)
    }
  }

  const d = draft.details
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={employer ? "Edit" : "Change data"}
      context="Profile"
      dirty={pending}
      footer={
        <SheetFooter
          error={problem}
          onCancel={onClose}
          note={
            detailsMissing
              ? "Place of birth, gender, religion and marital status go together, and an emergency contact needs a name and a number."
              : undefined
          }
          primary={{
            label: employer ? "Save" : "Send to head office",
            pending,
            disabled: !ready,
            onClick: () => void submit(),
          }}
        />
      }
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <SubHead>Personal</SubHead>
          <Field label="Full name">
            <Input
              value={draft.full_name}
              onChange={(e) => set("full_name", e.target.value)}
            />
          </Field>
          <Field label="NIK">
            <Input
              keyboard
              inputMode="numeric"
              value={draft.nik}
              onChange={(e) => set("nik", e.target.value)}
            />
          </Field>
          <Field label="Place of birth" required={detailsChanged}>
            <Input
              value={d.birth_place}
              onChange={(e) => setDetail("birth_place", e.target.value)}
            />
          </Field>
          <Field label="Date of birth">
            <Day
              value={draft.birth_date}
              onChange={(value) => set("birth_date", value)}
            />
          </Field>
          <Field label="Gender" required={detailsChanged}>
            <Select
              value={d.gender}
              onChange={(value) => setDetail("gender", value)}
            >
              <option value="">Choose…</option>
              {GENDERS.map((one) => (
                <option key={one.value} value={one.value}>
                  {one.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Religion" required={detailsChanged}>
            <Select
              value={d.religion}
              onChange={(value) => setDetail("religion", value)}
            >
              <option value="">Choose…</option>
              {RELIGIONS.map((one) => (
                <option key={one.value} value={one.value}>
                  {one.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Blood type">
            <Select
              value={d.blood_type ?? ""}
              onChange={(value) => setDetail("blood_type", value || null)}
            >
              <option value="">Not on the card</option>
              {BLOOD_TYPES.map((one) => (
                <option key={one} value={one}>
                  {one}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Nationality">
            <Select
              value={d.nationality}
              onChange={(value) => setDetail("nationality", value)}
            >
              <option value="WNI">WNI</option>
              <option value="WNA">WNA</option>
            </Select>
          </Field>
        </div>

        <div className="flex flex-col gap-3">
          <SubHead>Family</SubHead>
          <Field label="Marital status" required={detailsChanged}>
            <Select
              value={d.marital_status}
              onChange={(value) => setDetail("marital_status", value)}
            >
              <option value="">Choose…</option>
              {MARITAL.map((one) => (
                <option key={one.value} value={one.value}>
                  {one.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Children">
            <Select
              value={String(d.children)}
              onChange={(value) => setDetail("children", Number(value))}
            >
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="flex flex-col gap-3">
          <SubHead>Address on the KTP</SubHead>
          <Field label="Street">
            <Textarea
              rows={2}
              value={draft.address}
              onChange={(e) => set("address", e.target.value)}
            />
          </Field>
          <Field label="RT/RW">
            <Input
              value={d.rt_rw ?? ""}
              onChange={(e) => setDetail("rt_rw", e.target.value || null)}
            />
          </Field>
          <Field label="Village">
            <Input
              value={d.village ?? ""}
              onChange={(e) => setDetail("village", e.target.value || null)}
            />
          </Field>
          <Field label="District">
            <Input
              value={d.district ?? ""}
              onChange={(e) => setDetail("district", e.target.value || null)}
            />
          </Field>
          <Field label="City">
            <Input
              value={d.city ?? ""}
              onChange={(e) => setDetail("city", e.target.value || null)}
            />
          </Field>
          <Field label="Province">
            <Input
              value={d.province ?? ""}
              onChange={(e) => setDetail("province", e.target.value || null)}
            />
          </Field>
        </div>

        <div className="flex flex-col gap-3">
          <SubHead>Contact</SubHead>
          <Field label="Phone">
            <Input
              inputMode="tel"
              value={draft.phone}
              onChange={(e) => set("phone", e.target.value)}
            />
          </Field>
          <Field label="Email">
            <Input
              inputMode="email"
              value={draft.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </Field>
          <Field label="Emergency contact">
            <Input
              value={d.emergency_name ?? ""}
              onChange={(e) =>
                setDetail("emergency_name", e.target.value || null)
              }
            />
          </Field>
          <Field label="Relation">
            <Input
              value={d.emergency_relation ?? ""}
              onChange={(e) =>
                setDetail("emergency_relation", e.target.value || null)
              }
            />
          </Field>
          <Field label="Their phone">
            <Input
              inputMode="tel"
              value={d.emergency_phone ?? ""}
              onChange={(e) =>
                setDetail("emergency_phone", e.target.value || null)
              }
            />
          </Field>
        </div>

        {/* A store attaches the scans here and they ride with the change;
            head office puts them on the file from the Papers card. */}
        {!employer && (
          <div className="flex flex-col gap-3">
            <SubHead>Papers</SubHead>
            {PAPER_KINDS.map((kind) => (
              <Field key={kind.kind} label={kind.label}>
                <input
                  type="file"
                  accept={kind.accept}
                  className="text-[0.9375rem] text-body"
                  onChange={(event) =>
                    set("papers", {
                      ...draft.papers,
                      [kind.kind]: event.target.files?.[0],
                    })
                  }
                />
              </Field>
            ))}
          </div>
        )}

        <Field label="Reason" required>
          <Textarea
            rows={2}
            value={draft.reason}
            onChange={(e) => set("reason", e.target.value)}
          />
        </Field>
      </div>
    </Sheet>
  )
}

// ── Review (head office) ────────────────────────────────────────────────────

function ReviewSheet({
  open,
  onClose,
  update,
}: {
  open: boolean
  onClose: () => void
  update: EmployeeDataUpdateView
}) {
  const client = useQueryClient()
  const [reason, setReason] = useState("")
  const [pending, setPending] = useState<"approve" | "reject" | null>(null)
  const [problem, setProblem] = useState<unknown>(null)

  const rows: { label: string; before: string; after: string }[] = []
  for (const [key, label] of PERSONAL_LABELS) {
    const after = update.personal[key]
    if (after !== null)
      rows.push({
        label,
        before: update.before_personal[key] ?? "",
        after,
      })
  }
  if (update.details !== null) {
    const was = update.before_details
    for (const [key, label] of DETAIL_LABELS) {
      const after = String(update.details[key] ?? "")
      const before = String(was?.[key] ?? "")
      if (after !== before) rows.push({ label, before, after })
    }
  }

  async function decide(approve: boolean) {
    setPending(approve ? "approve" : "reject")
    setProblem(null)
    try {
      await decideDataUpdate(update.id, {
        approve,
        reason: reason.trim() || "Approved",
      })
      await client.invalidateQueries({ queryKey: papersKeys.all() })
      await client.invalidateQueries({ queryKey: peopleKeys.all })
      onClose()
    } catch (error) {
      setProblem(error)
    } finally {
      setPending(null)
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Review"
      context="Profile"
      caption={`${update.filed_by} · ${day(update.filed_at)}`}
      footer={
        <SheetFooter
          error={problem}
          onCancel={onClose}
          cancelLabel="Close"
          danger={
            <Button
              variant="destructive"
              pending={pending === "reject"}
              disabled={pending !== null || reason.trim() === ""}
              onClick={() => void decide(false)}
            >
              Send back
            </Button>
          }
          primary={{
            label: "Approve",
            pending: pending === "approve",
            disabled: pending !== null,
            onClick: () => void decide(true),
          }}
          note={
            reason.trim() === "" ? "Sending a change back needs a reason." : undefined
          }
        />
      }
    >
      <div className="flex flex-col gap-5">
        <div>
          <SubHead>Why</SubHead>
          <p className="text-[0.9375rem] text-ink">{update.reason}</p>
        </div>
        {rows.length > 0 && (
          <div className="flex flex-col gap-3">
            <SubHead>Change</SubHead>
            {rows.map((row) => (
              <div key={row.label}>
                <div className="text-[0.9375rem] text-body">{row.label}</div>
                <div className="text-[0.9375rem] text-mute line-through [overflow-wrap:anywhere]">
                  {row.before || "—"}
                </div>
                <div className="text-[0.9375rem] text-ink [overflow-wrap:anywhere]">
                  {row.after || "—"}
                </div>
              </div>
            ))}
          </div>
        )}
        {update.documents.length > 0 && (
          <div className="flex flex-col gap-2">
            <SubHead>Papers</SubHead>
            {update.documents.map((paper) => (
              <button
                key={paper.id}
                type="button"
                className="record-link text-left text-[0.9375rem]"
                onClick={async () =>
                  window.open(
                    URL.createObjectURL(await paperBlob(paper.id)),
                    "_blank",
                    "noopener"
                  )
                }
              >
                {PAPER_KINDS.find((kind) => kind.kind === paper.kind)?.label ??
                  paper.kind}{" "}
                · {paper.file_name}
              </button>
            ))}
          </div>
        )}
        <Field label="Reason">
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </div>
    </Sheet>
  )
}

const DETAIL_LABELS: readonly [keyof EmployeeDetails, string][] = [
  ["birth_place", "Place of birth"],
  ["gender", "Gender"],
  ["religion", "Religion"],
  ["marital_status", "Marital status"],
  ["children", "Children"],
  ["blood_type", "Blood type"],
  ["nationality", "Nationality"],
  ["rt_rw", "RT/RW"],
  ["village", "Village"],
  ["district", "District"],
  ["city", "City"],
  ["province", "Province"],
  ["emergency_name", "Emergency contact"],
  ["emergency_relation", "Relation"],
  ["emergency_phone", "Their phone"],
]
