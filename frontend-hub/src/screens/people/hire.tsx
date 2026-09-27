import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Day } from "@/components/ui/day"
import { Field, Input, Money } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { Choices, Stepper } from "@/components/ui/form"
import { PageHeader } from "@/components/ui/page-header"
import { PickOne } from "@/components/ui/pick"
import { Pill } from "@/components/ui/pill"
import { KeyValue, SubHead } from "@/components/ui/rows"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Timeline } from "@/components/ui/timeline"
import { useFilters } from "@/lib/filters"
import { count, day, money, moment } from "@/lib/format"
import {
  decideHire,
  hireKeys,
  listHireProposals,
  openHiredEmployment,
  peopleKeys,
  proposeHire,
  readHireProposal,
  reviseHire,
  type HireAsk,
  type PlaceChoice,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useIdentity } from "@/lib/session"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useUnit } from "@/screens/people/parts"
import type {
  HireProposalVersionView,
  HireProposalView,
} from "@itulah/contract"

/// **New employees** — a shop asks head office for somebody; head office
/// answers.
///
/// One screen, two faces, and each is offered only the acts it may take. The
/// shop states a case for a person and revises it when it comes back; head
/// office decides, and afterwards opens the employment record an approval
/// permits. Nothing about the module's other screens changes: this is the front
/// of the lifecycle the Directory holds the rest of.
///
/// # Why a decision control is hidden rather than merely refused
///
/// `payroll.tsx` argues the other way for its own approve button — offer it and
/// let the server answer, because the screen cannot know who is reading it.
/// That argument does not hold here, and the difference is worth stating rather
/// than reading as an inconsistency: **this screen CAN know.** The proposal
/// carries every actor who ever filed a version of it, and `/auth/me` names the
/// person reading. So the two rules the server enforces — head office decides,
/// and the proposer never decides their own — are both answerable in the
/// browser, from facts already on the page.
///
/// Hiding is not the permission. The server re-checks the rung on the way in
/// and compares the actors in the domain, on the live path and again when a
/// stored row is decoded. What hiding buys is that the screen stops promising
/// something that will answer 403 — and, in the self-decision case, stops
/// inviting somebody to approve their own request and then telling them off for
/// it.
///
/// # "Approved" is never "hired", anywhere on this screen
///
/// An approval is permission to open an employment record. The record that gets
/// opened is a **candidate**; the `HIRE` event is recorded on the day the person
/// actually starts, from the Directory, by whoever sees them start. So no state
/// here renders as "hired", `FILLED` reads as *Record opened*, and the sentence
/// is repeated beside the two controls where somebody could otherwise believe
/// otherwise: the Approve button and the form that opens the record.
///
/// # No NIK, no address, no contact detail, no document upload
///
/// The schema has no column for any of them and this form has no field for one.
/// A candidate is somebody who may never work here, and under UU PDP their
/// identity documents have no business sitting on a request that may be
/// refused. Personal data starts existing when somebody is actually employed,
/// on the surface that already owns it.
///
/// # Every write states a reason, including a return and a reject
///
/// Four writes, four required reasons. The server refuses a blank one before it
/// reaches the domain, so the button stays dead until there is something to
/// record. A rejection nobody explained is a rejection somebody can later
/// characterise however they like — and a *return* with no reason is worse
/// still, because the shop is being asked to guess what to change.
///
/// # A revision is a new version, and the old one stays readable
///
/// That trail is the point of the record: a request returned because the base
/// pay was above band, revised, and then approved is a three-line record of a
/// negotiation. An in-place edit would leave only its last line. So the
/// Versions tab is not a log — it is the document, and each version is shown
/// with what head office answered and why.

// ── the words ──────────────────────────────────────────────────────────────

/// What a state means in a pill.
///
/// `FILLED` is *Record opened* and not "Hired" or "Filled": what happened is
/// that an employment record now exists for everybody asked for. Whether any of
/// them has started is a different fact, recorded somewhere else, on a day
/// nobody here has observed yet.
function stateLabel(state: string): string {
  switch (state) {
    case "PROPOSED":
      return "Proposed"
    case "RETURNED":
      return "Sent back"
    case "APPROVED":
      return "Approved"
    case "REJECTED":
      return "Rejected"
    case "FILLED":
      return "Record opened"
    default:
      return state
  }
}

function stateTone(state: string) {
  switch (state) {
    case "APPROVED":
      return "ok" as const
    case "REJECTED":
      return "bad" as const
    /// `info` is *in motion*, which is exactly what this is: the records are
    /// open and the people are candidates on their way to a start date.
    case "FILLED":
      return "info" as const
    /// `PROPOSED` and `RETURNED` — somebody is blocked either way.
    default:
      return "warn" as const
  }
}

/// Whose desk this is on, derived rather than stored.
///
/// A column DESIGN.md would allow: it is the question a reader of this list
/// actually has, and neither the state code nor the place answers it on its
/// own. `APPROVED` is head office's because an approval with nobody's record
/// opened is an approval nothing has been done with.
function waitingOn(state: string): string {
  switch (state) {
    case "PROPOSED":
    case "APPROVED":
      return "Head office"
    case "RETURNED":
      return "The shop"
    default:
      return "Nobody"
  }
}

/// A decision recorded against one version.
function decisionLabel(decision: string): string {
  switch (decision) {
    case "APPROVED":
      return "Approved"
    case "RETURNED":
      return "Sent back"
    case "REJECTED":
      return "Rejected"
    default:
      return decision
  }
}

/// One recorded step, for the activity panel. `OPENED` is spelled out because
/// it is the step people misread: it created a record, not an employee.
function stepLabel(step: string): string {
  switch (step) {
    case "PROPOSED":
      return "Asked for"
    case "REVISED":
      return "Revised"
    case "OPENED":
      return "Employment record opened"
    default:
      return decisionLabel(step)
  }
}

function contractLabel(version: HireProposalVersionView): string {
  return version.contract_kind === "PKWT"
    ? `PKWT until ${day(version.contract_ends_on)}`
    : "PKWTT · permanent"
}

function needLabel(need: string): string {
  return need === "ADDITION" ? "Addition" : "Replacement"
}

/// The version in force — the one being decided, or the one that was.
///
/// `current_version` is one-based and the array is oldest first. A proposal with
/// neither is not representable on the wire, but the fallback keeps a malformed
/// row from taking the screen down with it.
function inForce(
  proposal: HireProposalView | null
): HireProposalVersionView | null {
  if (proposal === null) return null
  const versions = proposal.versions
  return (
    versions[proposal.current_version - 1] ??
    versions[versions.length - 1] ??
    null
  )
}

/// Did this actor file **any** version of this proposal?
///
/// The server's rule exactly (`HireProposal::proposed_by`), and deliberately
/// wider than the `proposed_by` field beside it: a manager who filed version 1,
/// had a colleague revise it, and then decided version 2 would have decided
/// their own proposal with one step in between. The owner's rule is about the
/// proposal, not about one of its drafts.
///
/// An unknown reader counts as the proposer. `/auth/me` has not answered yet, so
/// we cannot say this is not their own request — and offering a decision we may
/// have to take away is the flicker that teaches people not to trust a control.
function filedBy(
  proposal: HireProposalView,
  actor: string | undefined
): boolean {
  if (actor === undefined) return true
  return proposal.history.some(
    (step) =>
      (step.step === "PROPOSED" || step.step === "REVISED") &&
      step.actor === actor
  )
}

// ── the terms a request states ─────────────────────────────────────────────

type HiringNeed = "REPLACEMENT" | "ADDITION"
type ContractKind = "PKWT" | "PKWTT"

/// The owner's field list of 2026-09-13 and nothing else. There is no NIK, no
/// address, no date of birth and no contact detail: `hire_proposal_version` has
/// no column for one, so a field here would have nowhere to go.
interface Terms {
  readonly position: string
  /// Held as text because `<Stepper>` does, and because empty is reachable —
  /// and empty is not one.
  readonly headcount: string
  readonly need: HiringNeed
  readonly candidateName: string
  readonly startOn: string
  readonly contractKind: ContractKind
  readonly contractEndsOn: string
  /// Whole rupiah as digits, exactly as `<Money>` hands them back. Never a
  /// float and never divided: `base_pay_minor` is an integer on the wire, and a
  /// rupiah that has been through a float is a rupiah that can disagree with a
  /// ledger.
  readonly basePay: string
  readonly reason: string
}

const BLANK: Terms = {
  position: "",
  headcount: "1",
  need: "REPLACEMENT",
  candidateName: "",
  startOn: "",
  contractKind: "PKWT",
  contractEndsOn: "",
  basePay: "",
  reason: "",
}

/// A version, back into the form, so a revision starts from what was asked for
/// rather than from nothing. The reason does not carry over: a new version
/// states its own case, and the last one's reason is the argument that was
/// already answered.
function termsOf(version: HireProposalVersionView): Terms {
  return {
    position: version.position,
    headcount: String(version.headcount),
    need: version.need === "ADDITION" ? "ADDITION" : "REPLACEMENT",
    candidateName: version.candidate_name,
    startOn: version.start_on,
    contractKind: version.contract_kind === "PKWTT" ? "PKWTT" : "PKWT",
    contractEndsOn: version.contract_ends_on ?? "",
    basePay: String(version.base_pay_minor),
    reason: "",
  }
}

/// Whether the server would accept this shape at all.
///
/// The PKWT clause is the one worth naming: UU 13/2003 art. 59 says a fixed term
/// that does not say when it ends is not a fixed term, and the server refuses
/// that body rather than storing an open-ended PKWT. So the button is dead
/// instead, beside a field that says why.
function complete(terms: Terms): boolean {
  const headcount = Number(terms.headcount)
  return (
    terms.candidateName.trim() !== "" &&
    terms.position.trim() !== "" &&
    Number.isInteger(headcount) &&
    headcount >= 1 &&
    terms.startOn !== "" &&
    terms.basePay !== "" &&
    terms.reason.trim() !== "" &&
    (terms.contractKind === "PKWTT" || terms.contractEndsOn !== "")
  )
}

function askOf(terms: Terms, placeId: string): HireAsk {
  return {
    placeId,
    position: terms.position.trim(),
    headcount: Number(terms.headcount),
    need: terms.need,
    candidateName: terms.candidateName.trim(),
    startOn: terms.startOn,
    contractKind: terms.contractKind,
    /// Absent for a PKWTT rather than blank. The domain has nowhere to put an
    /// end date on a permanent contract and the server refuses one that names
    /// it — so the shape that cannot be sent is the shape that is not built.
    contractEndsOn:
      terms.contractKind === "PKWT" ? terms.contractEndsOn : undefined,
    basePayMinor: Number(terms.basePay),
    reason: terms.reason.trim(),
  }
}

// ── the list ───────────────────────────────────────────────────────────────

const columns: ColumnDef<TableSetup, HireProposalView>[] = [
  {
    id: "candidate",
    accessorFn: (row) => inForce(row)?.candidate_name ?? "",
    header: "Candidate",
    size: 190,
    /// A name, so `contains` is the useful question — unlike the employee uuid
    /// on the Requests queue, which nobody could narrow by without already
    /// knowing whose row they wanted.
    meta: { filter: { kind: "text" }, card: "title", priority: 1 },
  },
  {
    id: "position",
    accessorFn: (row) => inForce(row)?.position ?? "",
    header: "Position",
    size: 150,
    /// Faceted off the list itself: positions repeat across shops, so "just the
    /// cashier requests" is one click and the options are exactly the words
    /// somebody actually filed.
    meta: { filter: { kind: "option" }, priority: 2 },
  },
  {
    id: "unit",
    /// The unit's own name, falling back to its id. `store-07` is a primary key
    /// and the server sends `Store 07` beside it; a screen showing the key is an
    /// identifier that has escaped into the interface.
    accessorFn: (row) => row.place_name ?? row.place_id,
    header: "Unit",
    size: 140,
    meta: { filter: { kind: "option" }, priority: 2 },
  },
  {
    accessorKey: "state",
    header: "State",
    size: 140,
    /// `format` so the facet offers the words the pills wear rather than the
    /// wire codes. Nobody narrows a list by `FILLED`.
    meta: {
      filter: { kind: "option", format: stateLabel },
      card: "status",
      priority: 1,
    },
    cell: ({ row }) => (
      <Pill tone={stateTone(row.original.state)}>
        {stateLabel(row.original.state)}
      </Pill>
    ),
  },
  {
    id: "waiting",
    accessorFn: (row) => waitingOn(row.state),
    header: "Waiting on",
    size: 130,
    /// Derived, and the reason this column exists: "whose move is it" is the
    /// question somebody opens this screen with, and the state code answers it
    /// only for people who have learned the state machine.
    meta: { filter: { kind: "option" }, priority: 2 },
  },
  {
    id: "pay",
    accessorFn: (row) => inForce(row)?.base_pay_minor ?? 0,
    header: "Base pay",
    size: 130,
    /// No `scale`. IDR has no minor unit in practice, so the server's minor is
    /// already whole rupiah and a hundred here would turn "over 3 juta" into a
    /// question about 300 juta that matches nothing.
    meta: {
      align: "right",
      filter: { kind: "number", unit: "Rp" },
      card: "metric",
      priority: 2,
    },
    cell: ({ row }) => money(inForce(row.original)?.base_pay_minor),
  },
  {
    id: "asked",
    accessorFn: (row) => inForce(row)?.headcount ?? 1,
    header: "Asked for",
    size: 120,
    meta: {
      align: "right",
      filter: { kind: "number", unit: "people" },
      priority: 3,
    },
    /// The ask, and what is left of it. A request for two is filled by the
    /// second employment record and not the first, so a bare `2` beside an
    /// approved row would hide the half of the work still outstanding.
    cell: ({ row }) => {
      const asked = inForce(row.original)?.headcount ?? 1
      const outstanding = row.original.outstanding
      return outstanding > 0 && outstanding < asked
        ? `${count(asked)} · ${count(outstanding)} to open`
        : count(asked)
    },
  },
  {
    id: "contract",
    accessorFn: (row) => inForce(row)?.contract_kind ?? "",
    header: "Contract",
    size: 110,
    /// A term of the offer rather than a metric, but head office genuinely
    /// narrows by it: a permanent contract is a different size of commitment
    /// from a fixed term, and the two are decided differently.
    meta: { filter: { kind: "option" }, priority: 3 },
  },
  {
    id: "starts",
    accessorFn: (row) => inForce(row)?.start_on ?? "",
    header: "Starts",
    size: 120,
    meta: { filter: { kind: "date" }, priority: 3 },
    cell: ({ row }) => day(inForce(row.original)?.start_on),
  },
  {
    id: "moved",
    accessorKey: "updated_at",
    header: "Last moved",
    size: 120,
    /// The decision metric, and the default sort ASCENDING: the request nobody
    /// has touched for longest is the one somebody has to act on, and it should
    /// be the first row on the screen rather than something you scroll to.
    meta: { filter: { kind: "date" }, priority: 3 },
    cell: ({ row }) => day(row.original.updated_at),
  },
]

/// Which slice of the book. Not a bound and not a permission — the server has
/// already decided which units these rows come from — so it is a `<Segmented>`
/// over what is already held rather than a second request.
const SLICES = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
] as const

type Slice = (typeof SLICES)[number]["value"]

/// The two terminal states. `APPROVED` is not one of them: somebody still has to
/// open the employment record it permits.
const CLOSED = new Set(["REJECTED", "FILLED"])

export function NewEmployees() {
  const unit = useUnit()
  const proposal = useSheet("hireProposal")
  const [slice, setSlice] = useState<Slice>("open")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "moved", desc: false },
  ])

  /// One read, bounded on the server. `hireKeys.list()` with no unit because
  /// `listHireProposals` asks for no unit: a shop is served its own requests and
  /// head office every shop's, and a key naming a place would claim this answer
  /// held only that place's rows.
  const book = useQuery({
    queryKey: hireKeys.list(),
    queryFn: ({ signal }) => listHireProposals(signal),
  })

  const rows = useMemo(() => {
    const all = book.data ?? []
    if (slice === "all") return all
    return all.filter((row) => CLOSED.has(row.state) === (slice === "closed"))
  }, [book.data, slice])

  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: HireProposalView) => row.id,
        state: { columnFilters: filters.columnFilters, sorting },
        onSortingChange: setSorting,
      }),
      [rows, filters.columns, filters.columnFilters, sorting]
    )
  )

  return (
    <PageContent>
      <PageHeader
        crumb="People · Employees"
        title="New employees"
        sub={
          unit.employer
            ? "What the shops are asking for, and head office's answer."
            : `Asking head office for somebody at ${unit.name ?? "your place"}, and reading the answer.`
        }
      />

      {/* The one thing that must be read before any state on this screen. It is
          a banner rather than a note beside the pill because somebody who has
          learned "approved" wrongly has learned it for every row. */}
      <Banner tone="info" className="mb-4">
        Approving a request does not hire anybody. An approval is permission to
        open an employment record, and that record starts as a{" "}
        <em>candidate</em> — somebody is hired on the day they actually start,
        recorded against their record in the{" "}
        <AppLink to="/people">Directory</AppLink>.
      </Banner>

      {unit.place === null && !unit.choosing && (
        <Banner tone="bad" className="mb-4">
          You are not posted anywhere, so there is no unit whose hiring is yours
          to ask about.
        </Banner>
      )}

      <Toolbar>
        <Segmented options={SLICES} value={slice} onChange={setSlice} />
        <Toolbar.Spacer />
        <FilterPanel model={filters} table={table} />
      </Toolbar>

      <Card className="mb-4 overflow-hidden">
        {queryState(book, {
          loading: "Reading the requests…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {/* Three different emptinesses, and they mean three different
                    things. "Nothing is open" beside a book full of rejections
                    is a different day from "nobody has ever asked". */}
                {(book.data ?? []).length === 0
                  ? unit.employer
                    ? "No shop has asked for anybody yet."
                    : "You have not asked for anybody yet. The form is below."
                  : slice === "open"
                    ? "Nothing is waiting on anybody. Every request on file has been answered and acted on."
                    : "Nothing has been rejected, and no employment record has been opened against a request."}
              </EmptyState>
            ) : (
              <DataTable<HireProposalView>
                table={table}
                onRowClick={(row) => proposal.open(row.id)}
                isSelected={(row) => row.id === proposal.value}
                empty={
                  <>
                    {count(rows.length)} requests are in this slice, and none of
                    them match the filters in force.
                  </>
                }
              />
            ),
        })}
      </Card>

      <Ask place={unit.place} places={unit.places} choosing={unit.choosing} />

      <ProposalSheet
        id={proposal.value ?? null}
        mayDecide={unit.employer}
        onClose={proposal.close}
      />
    </PageContent>
  )
}

// ── the form both writes share ─────────────────────────────────────────────

/// A labelled group that is deliberately **not** a `<label>`.
///
/// `<Field>` wraps its children in one, and a `<label>` round a radio group or a
/// stepper hands every click on the heading to the first control inside it —
/// which for a stepper is the minus button. `commercial/rule-form.tsx` names the
/// same trap for the same reason.
function Group({
  label,
  hint,
  children,
}: {
  label: string
  hint?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[0.875rem] font-medium text-text">{label}</span>
      {children}
      {hint !== undefined && (
        <span className="text-[0.875rem] text-mute">{hint}</span>
      )}
    </div>
  )
}

/// The terms, as fields. One component for proposing and for revising, because
/// a revision is the same act done again with better terms — and two copies of
/// this form would be two places for the PKWT rule to be forgotten.
function TermsFields({
  terms,
  onChange,
}: {
  terms: Terms
  onChange: (next: Terms) => void
}) {
  const set = (patch: Partial<Terms>) => onChange({ ...terms, ...patch })
  const fixed = terms.contractKind === "PKWT"

  return (
    <>
      <Field
        label="Candidate"
        required
        hint="A name, and nothing else about them. No NIK, no address, no contact detail — and no document to upload."
      >
        <Input
          value={terms.candidateName}
          onChange={(event) => set({ candidateName: event.target.value })}
          placeholder="nama calon"
        />
      </Field>

      <Field label="Position" required>
        <Input
          value={terms.position}
          onChange={(event) => set({ position: event.target.value })}
          placeholder="Kasir"
        />
      </Field>

      <Group label="Why the job exists">
        <Choices<HiringNeed>
          label="Why the job exists"
          value={terms.need}
          onChange={(need) => set({ need })}
          options={[
            {
              value: "REPLACEMENT",
              label: "Replacement",
              note: "Somebody left and the job is still there.",
            },
            {
              value: "ADDITION",
              label: "Addition",
              note: "A job that did not exist before.",
            },
          ]}
        />
      </Group>

      <Group
        label="How many"
        hint="One is the normal case. A request for two is filled by the second employment record, not the first."
      >
        <Stepper
          label="How many"
          value={terms.headcount}
          onChange={(headcount) => set({ headcount })}
          min={1}
          suffix="people"
        />
      </Group>

      <Field label="Starts on" required>
        <Day
          value={terms.startOn}
          onChange={(startOn) => set({ startOn })}
          placeholder="tanggal mulai"
          clearable={false}
        />
      </Field>

      <Group label="Contract">
        <Choices<ContractKind>
          label="Contract"
          value={terms.contractKind}
          /// Switching to permanent clears the end date rather than leaving it
          /// in state: a stale day nobody can see is a day that gets sent, and
          /// the server refuses a PKWTT that names one.
          onChange={(contractKind) =>
            set({
              contractKind,
              contractEndsOn:
                contractKind === "PKWT" ? terms.contractEndsOn : "",
            })
          }
          options={[
            {
              value: "PKWT",
              label: "PKWT",
              note: "Fixed term. It has to say when it ends.",
            },
            {
              value: "PKWTT",
              label: "PKWTT",
              note: "Permanent. There is nowhere to put an end date.",
            },
          ]}
        />
      </Group>

      {/* Dead rather than absent, which is what `<Day disabled>` exists for: a
          field that vanishes reads as an option nobody thought of, and somebody
          goes looking for it. A dead box beside the sentence says why. */}
      <Field
        label="Fixed term ends on"
        required={fixed}
        hint={
          fixed
            ? "UU 13/2003 art. 59: a fixed term that does not say when it ends is not a fixed term."
            : "A PKWTT is permanent, so there is no end date to state."
        }
      >
        <Day
          value={terms.contractEndsOn}
          onChange={(contractEndsOn) => set({ contractEndsOn })}
          notBefore={terms.startOn === "" ? null : terms.startOn}
          placeholder={fixed ? "tanggal berakhir" : "—"}
          disabled={!fixed}
          clearable={false}
        />
      </Field>

      <Field
        label="Base pay"
        hint="Gaji pokok, whole rupiah, per month."
        required
      >
        <Money
          value={terms.basePay}
          onChange={(basePay) => set({ basePay })}
          prefix="Rp"
          placeholder="gaji pokok"
          label="Base pay"
        />
      </Field>

      <Field
        label="Why"
        hint="Recorded against the request, and required."
        required
      >
        <Input
          value={terms.reason}
          onChange={(event) => set({ reason: event.target.value })}
          placeholder="kasir resign akhir bulan"
        />
      </Field>
    </>
  )
}

/// Asking for somebody.
///
/// The place manager's act, and head office's own HR files one too — which is
/// exactly why the rule against deciding your own proposal is stated on the
/// actor and not on the rung. So this card is offered to both faces; what
/// differs is whether there is a unit to choose.
function Ask({
  place,
  places,
  choosing,
}: {
  place: string | null
  places: readonly PlaceChoice[]
  choosing: boolean
}) {
  const client = useQueryClient()
  const [chosen, setChosen] = useState<string | null>(null)
  const [terms, setTerms] = useState<Terms>(BLANK)
  const [failed, setFailed] = useState<string | null>(null)

  /// Their own posting, until they pick another. A bounded caller is served no
  /// places by the server and therefore never picks — they were not choosing.
  const unitId = chosen ?? place ?? ""

  const ask = useMutation({
    mutationFn: () => proposeHire(askOf(terms, unitId)),
    onSuccess: () => {
      setFailed(null)
      setTerms(BLANK)
      // The whole feature's prefix, and it genuinely is all of it: a new
      // proposal adds a list row and mints a record the sheet reads by id.
      void client.invalidateQueries({ queryKey: hireKeys.all })
    },
    onError: (error: Error) => setFailed(error.message),
  })

  const ready = unitId !== "" && complete(terms) && !ask.isPending

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Ask for somebody</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-3 px-4 pb-4">
        {failed !== null && <Banner tone="bad">{failed}</Banner>}

        <Banner tone="info">
          This states a case, not a hire. Head office answers it, and an
          approval is permission to open an employment record afterwards.
        </Banner>

        {/* Chosen, never typed, and only when there is a choice. A bounded
            caller may name their own unit and nothing else — the server refuses
            another — so the honest control for them is the sentence below. */}
        {choosing ? (
          <Field label="Unit" required>
            <PickOne
              label="Unit"
              placeholder="Choose a unit…"
              choices={places.map((one) => ({
                value: one.id,
                label: `${one.name} · ${one.employees}`,
              }))}
              value={unitId === "" ? null : unitId}
              onChange={(next) => setChosen(next ?? "")}
            />
          </Field>
        ) : (
          <KeyValue term="Unit">
            {places.find((one) => one.id === unitId)?.name ??
              (unitId === "" ? "—" : unitId)}
          </KeyValue>
        )}

        <TermsFields terms={terms} onChange={setTerms} />

        <div>
          <Button
            variant="primary"
            disabled={!ready}
            onClick={() => ask.mutate()}
          >
            File the request
          </Button>
        </div>
      </div>
    </Card>
  )
}

// ── one request ────────────────────────────────────────────────────────────

/// The record, its versions, and whatever this reader may do to it.
///
/// It fetches its own read rather than taking the row: the list carries the
/// whole view today, but a sheet opened from a pasted URL or a notification has
/// no list behind it, and `?hireProposal=…` is meant to survive both.
function ProposalSheet({
  id,
  mayDecide,
  onClose,
}: {
  id: string | null
  mayDecide: boolean
  onClose: () => void
}) {
  const detail = useQuery({
    queryKey: hireKeys.one(id ?? ""),
    queryFn: ({ signal }) => readHireProposal(id ?? "", signal),
    enabled: id !== null,
  })

  if (id === null) return null
  const proposal = detail.data ?? null
  const version = inForce(proposal)

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={id}
      title={version?.candidate_name ?? "Request for a new employee"}
      badge={
        proposal === null ? undefined : (
          <Pill tone={stateTone(proposal.state)}>
            {stateLabel(proposal.state)}
          </Pill>
        )
      }
      caption={
        proposal === null
          ? undefined
          : `${proposal.place_name ?? proposal.place_id} · version ${proposal.current_version} of ${proposal.versions.length} · last moved ${moment(proposal.updated_at)}`
      }
      tabs={
        proposal === null
          ? undefined
          : [
              {
                value: "request",
                label: "Request",
                content: (
                  <Request
                    proposal={proposal}
                    mayDecide={mayDecide}
                    onDecided={onClose}
                  />
                ),
              },
              {
                value: "versions",
                label: `Versions · ${proposal.versions.length}`,
                content: <Versions proposal={proposal} />,
              },
              {
                value: "history",
                label: "History",
                content: <History proposal={proposal} />,
              },
            ]
      }
    >
      {proposal === null &&
        queryState(detail, {
          loading: "Reading the request…",
          render: () => null,
        })}
    </Sheet>
  )
}

/// What is being asked for, and what this reader may do about it.
function Request({
  proposal,
  mayDecide,
  onDecided,
}: {
  proposal: HireProposalView
  mayDecide: boolean
  onDecided: () => void
}) {
  const version = inForce(proposal)
  /// The version this one answers, and the reason it came back. The single most
  /// load-bearing fact when reading a revision, so it is above the terms rather
  /// than a tab away.
  const previous =
    proposal.current_version > 1
      ? (proposal.versions[proposal.current_version - 2] ?? null)
      : null

  if (version === null) {
    return (
      <Banner tone="bad">
        This request has no version recorded, which should not be possible. Its
        history is under History.
      </Banner>
    )
  }

  return (
    <>
      {previous !== null && previous.decided_reason !== null && (
        <Banner tone="warn" className="mb-4">
          Version {previous.version} was{" "}
          {decisionLabel(previous.decision ?? "RETURNED").toLowerCase()} by{" "}
          {previous.decided_by ?? "head office"} — {previous.decided_reason}
        </Banner>
      )}

      <Facts>
        <Fact term="Unit">{proposal.place_name ?? proposal.place_id}</Fact>
        <Fact term="Position">{version.position}</Fact>
        <Fact term="Why the job exists">{needLabel(version.need)}</Fact>
        <Fact term="Asked for">{count(version.headcount)}</Fact>
        <Fact term="Starts on">{day(version.start_on)}</Fact>
        <Fact term="Contract">{contractLabel(version)}</Fact>
        <Fact term="Base pay">{money(version.base_pay_minor)}</Fact>
        <Fact term="Still to open">{count(proposal.outstanding)}</Fact>
        <Fact term="Asked by">{proposal.proposed_by}</Fact>
        <Fact term="Because">{version.filed_reason ?? "—"}</Fact>
      </Facts>

      {proposal.employee_ids.length > 0 && <Opened proposal={proposal} />}

      {proposal.state === "PROPOSED" && (
        <Decide
          proposal={proposal}
          mayDecide={mayDecide}
          onDecided={onDecided}
        />
      )}

      {proposal.state === "RETURNED" && (
        <Revise proposal={proposal} version={version} />
      )}

      {/* The same flag as the decision, and not by accident: deciding a request
          and creating an employee are both at head office's rung, so "is this
          the employer" answers both. They are still two different keys on the
          server, and either could be narrowed without the other. */}
      {proposal.state === "APPROVED" && (
        <OpenRecord proposal={proposal} mayOpen={mayDecide} />
      )}

      {proposal.state === "REJECTED" && (
        <p className="mt-5 text-meta text-body">
          Rejected, and terminal. Asking again is a new request rather than a
          revision of this one — what was refused stays on the record with the
          reason it was refused.
        </p>
      )}
    </>
  )
}

/// Head office's answer: approve, send back, or reject.
///
/// Drawn only for somebody who may actually give one, and never for anybody who
/// filed a version of it. Neither condition is the permission — the server
/// checks the rung on the way in and compares the actors in the domain — but a
/// button that answers 403 is a screen making a promise it cannot keep.
function Decide({
  proposal,
  mayDecide,
  onDecided,
}: {
  proposal: HireProposalView
  mayDecide: boolean
  onDecided: () => void
}) {
  const client = useQueryClient()
  const identity = useIdentity()
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const decide = useMutation({
    mutationFn: (decision: "APPROVE" | "RETURN" | "REJECT") =>
      decideHire(proposal.id, decision, reason.trim()),
    onSuccess: () => {
      setReason("")
      setFailed(null)
      // The prefix: a decision moves the list row's state and rewrites the
      // version in force's decision half, and both keys hold one of those.
      void client.invalidateQueries({ queryKey: hireKeys.all })
      onDecided()
    },
    onError: (error: Error) => setFailed(error.message),
  })

  if (!mayDecide) {
    return (
      <p className="mt-5 text-meta text-body">
        Waiting on head office. Deciding a request is the employer's act — a
        shop that could grant its own would not be asking.
      </p>
    )
  }

  if (filedBy(proposal, identity.data?.username)) {
    return (
      <Banner tone="info" className="mt-5">
        You filed a version of this request, so answering it is somebody else's.
        The server refuses a decision by anybody who filed any version of a
        proposal — including head office's own HR, which is why the rule is
        stated on the person and not on the rung.
      </Banner>
    )
  }

  const ready = reason.trim() !== "" && !decide.isPending

  return (
    <div className="mt-5 flex flex-col gap-3">
      {failed !== null && <Banner tone="bad">{failed}</Banner>}

      <Field
        label="Why"
        required
        hint="Recorded against the decision, and required — on a return and a rejection as much as on an approval."
      >
        <Input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="band gaji kasir maksimal 3,2 juta"
        />
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={!ready}
          onClick={() => decide.mutate("APPROVE")}
        >
          Approve
        </Button>
        <Button
          variant="soft"
          disabled={!ready}
          onClick={() => decide.mutate("RETURN")}
        >
          Send back for revision
        </Button>
        <Button
          variant="danger"
          disabled={!ready}
          onClick={() => decide.mutate("REJECT")}
        >
          Reject
        </Button>
      </div>

      <p className="text-meta text-body">
        Approving permits an employment record to be opened. It does not hire
        anybody, and nobody is on a payroll until the day they start is
        recorded. Sending it back asks for a new version — say what to change,
        because the reason is all the shop gets.
      </p>
    </div>
  )
}

/// A new version of a request that came back.
///
/// Offered to anybody who can see the proposal: filing and revising are one key
/// at the place's rung, and the caller's reach is what got them this record in
/// the first place. Head office holds the same key, so HR may revise their own.
function Revise({
  proposal,
  version,
}: {
  proposal: HireProposalView
  version: HireProposalVersionView
}) {
  const client = useQueryClient()
  const [terms, setTerms] = useState<Terms>(() => termsOf(version))
  const [failed, setFailed] = useState<string | null>(null)

  const revise = useMutation({
    /// The unit does not travel. A revision may change the pay or the start
    /// date; a proposal that changed shops would be a different proposal, and
    /// the server has no field for one.
    mutationFn: () => reviseHire(proposal.id, askOf(terms, proposal.place_id)),
    onSuccess: () => {
      setFailed(null)
      void client.invalidateQueries({ queryKey: hireKeys.all })
    },
    onError: (error: Error) => setFailed(error.message),
  })

  const next = proposal.current_version + 1
  const ready = complete(terms) && !revise.isPending

  return (
    <div className="mt-5 flex flex-col gap-3">
      <SubHead>File a new version</SubHead>
      <p className="text-meta text-body">
        This becomes version {next}. Version {proposal.current_version} stays
        readable under Versions with the reason it was sent back — a request
        returned, revised and then approved is a record of a negotiation, and an
        edit in place would leave only its last line.
      </p>

      {failed !== null && <Banner tone="bad">{failed}</Banner>}

      <TermsFields terms={terms} onChange={setTerms} />

      <div>
        <Button
          variant="primary"
          disabled={!ready}
          onClick={() => revise.mutate()}
        >
          File version {next}
        </Button>
      </div>
    </div>
  )
}

/// Opening the employment record an approval permits.
///
/// Head office's, under the same key that creates a candidate directly in the
/// Directory: two ways in, one employee record out. One call per person asked
/// for — a request for two is not closed by the first.
function OpenRecord({
  proposal,
  mayOpen,
}: {
  proposal: HireProposalView
  mayOpen: boolean
}) {
  const client = useQueryClient()
  const [code, setCode] = useState("")
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const open = useMutation({
    mutationFn: () =>
      openHiredEmployment(proposal.id, code.trim(), reason.trim()),
    onSuccess: () => {
      setFailed(null)
      setCode("")
      setReason("")
      void client.invalidateQueries({ queryKey: hireKeys.all })
      // And the module's own prefix: this minted an employee and posted them to
      // a unit, so the Directory, the headcounts and the unit facets are all a
      // row out of date.
      void client.invalidateQueries({ queryKey: peopleKeys.all })
    },
    onError: (error: Error) => setFailed(error.message),
  })

  if (!mayOpen) {
    return (
      <p className="mt-5 text-meta text-body">
        Approved. Head office opens the employment record —{" "}
        {count(proposal.outstanding)} still to open — and it starts as a
        candidate, not as somebody on the payroll.
      </p>
    )
  }

  const ready = code.trim() !== "" && reason.trim() !== "" && !open.isPending

  return (
    <div className="mt-5 flex flex-col gap-3">
      <SubHead aside={`${count(proposal.outstanding)} still to open`}>
        Open an employment record
      </SubHead>

      <Banner tone="info">
        This creates a <em>candidate</em>, and nothing more. No contract, no pay
        agreement, and no <code>HIRE</code> event — that one is recorded on the
        day the person actually starts, from the{" "}
        <AppLink to="/people">Directory</AppLink>, by whoever sees them start.
        The unit and the start date come from the approved version rather than
        from this form, because what was approved is what may be acted on.
      </Banner>

      {failed !== null && <Banner tone="bad">{failed}</Banner>}

      <Field
        label="Badge number"
        required
        hint="HR's own numbering. A code somebody already has is refused."
      >
        <Input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="KAR-0421"
        />
      </Field>

      <Field
        label="Why"
        hint="Recorded against the record, and required."
        required
      >
        <Input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="mulai kerja 1 Oktober"
        />
      </Field>

      <div>
        <Button
          variant="primary"
          disabled={!ready}
          onClick={() => open.mutate()}
        >
          Open the record
        </Button>
      </div>
    </div>
  )
}

/// The records this request has already produced, and what they are not.
function Opened({ proposal }: { proposal: HireProposalView }) {
  return (
    <div className="mt-5">
      <SubHead>Records opened</SubHead>
      {proposal.employee_ids.map((employeeId, index) => (
        <KeyValue key={employeeId} term={`Record ${index + 1}`}>
          {/* No dead ends: the record this request produced is one click away,
              open in its own sheet on the Directory. */}
          <AppLink to="/people" sheet={{ key: "employee", value: employeeId }}>
            {employeeId}
          </AppLink>
        </KeyValue>
      ))}
      <p className="mt-2 text-meta text-body">
        Each of these is a candidate. None of them is hired until the day they
        start is recorded against their own record.
      </p>
    </div>
  )
}

/// The version trail — the point of the record rather than a log of it.
///
/// Oldest first, as the server sends them, because that is the order the
/// negotiation happened in: what was asked for, what head office said about it,
/// what was asked for instead.
function Versions({ proposal }: { proposal: HireProposalView }) {
  return (
    <div className="flex flex-col gap-5">
      {proposal.versions.map((version) => (
        <div
          key={version.version}
          className="border-b border-hairline pb-5 last:border-0 last:pb-0"
        >
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-card-title font-semibold text-ink">
              Version {version.version}
            </span>
            {version.version === proposal.current_version && (
              <Pill tone="accent">In force</Pill>
            )}
            {version.decision !== null ? (
              <Pill tone={stateTone(version.decision)}>
                {decisionLabel(version.decision)}
              </Pill>
            ) : (
              <Pill tone="warn">Waiting on an answer</Pill>
            )}
          </div>

          <div className="mt-3">
            <KeyValue term="Candidate">{version.candidate_name}</KeyValue>
            <KeyValue term="Position">{version.position}</KeyValue>
            <KeyValue term="Why the job exists">
              {needLabel(version.need)}
            </KeyValue>
            <KeyValue term="Asked for">{count(version.headcount)}</KeyValue>
            <KeyValue term="Starts on">{day(version.start_on)}</KeyValue>
            <KeyValue term="Contract">{contractLabel(version)}</KeyValue>
            <KeyValue term="Base pay">{money(version.base_pay_minor)}</KeyValue>
          </div>

          {version.filed_by !== null && (
            <p className="mt-3 text-meta text-body">
              Filed by {version.filed_by} {moment(version.filed_at)} —{" "}
              {version.filed_reason ?? "no reason recorded"}
            </p>
          )}

          {/* The half that makes a returned version worth keeping. Without the
              reason beside it, an earlier version is just a shape somebody
              replaced. */}
          {version.decision !== null && (
            <p className="mt-1 text-meta text-body">
              {decisionLabel(version.decision)} by{" "}
              {version.decided_by ?? "head office"} {moment(version.decided_at)}{" "}
              — {version.decided_reason ?? "no reason recorded"}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

/// Every recorded step, newest at the bottom, each with its actor and reason.
function History({ proposal }: { proposal: HireProposalView }) {
  return (
    <Timeline
      events={proposal.history.map((step, index) => ({
        id: `${step.step}-${step.version}-${index}`,
        title: `${stepLabel(step.step)} · version ${step.version}`,
        detail:
          step.employee_id === null ? (
            `${step.actor} · ${step.reason}`
          ) : (
            <>
              {step.actor} · {step.reason} ·{" "}
              <AppLink
                to="/people"
                sheet={{ key: "employee", value: step.employee_id }}
              >
                {step.employee_id}
              </AppLink>
            </>
          ),
        at: moment(step.at),
        state: index === proposal.history.length - 1 ? "current" : "done",
      }))}
    />
  )
}

/// The screen, under the name its path suggests as well as the one the owner
/// gave it. `index.ts` is another lane's file and either spelling resolves.
export const Hire = NewEmployees
