import {
  BadgeDollarSign,
  CalendarCheck,
  CalendarClock,
  CalendarRange,
  ChartColumn,
  Clock4,
  Fingerprint,
  HeartHandshake,
  Inbox,
  Layers,
  LayoutGrid,
  MessageSquareWarning,
  Receipt,
  ReceiptText,
  ScanFace,
  SlidersHorizontal,
  Sun,
  Timer,
  UserPlus,
  Users,
} from "lucide-react"

import type { AppModule } from "@/lib/navigation"
import { usePeopleAudience } from "@/screens/people/scope"

/// This module's row in the sidebar and the sub-items under it.
/// Owned by the module, composed by `lib/navigation.ts` — so adding a screen
/// here never touches another module's file.
///
/// # One module, two faces
///
/// The draft this replaced had three menus: one for head office, one for a
/// store manager, one for the DC. It was wrong about the work. A store manager
/// and a DC manager do the *same* HR job — build the roster, see who is in
/// today, approve leave, order overtime, close the month — and only their data
/// differs. Two menus with the same eight entries are one menu.
///
/// Head office is not a third variant of that manager. It is the **employer**:
/// contracts, moving somebody between places, ending employment, pay, and every
/// rule the places are measured against. So one module, and `audience` decides
/// which rows a caller is offered. See `PEOPLE-BRIEF.md`.
///
/// Employees themselves are not here at all. They are on `frontend-employee`,
/// where they ask for their own leave and read their own payslip; a second
/// place to do that is a second place to get a different answer.
///
/// # Why Directory sits above the groups
///
/// It is the module's front door and both faces open it daily, which is what
/// Finance's Overview is and where Finance puts it. It is also neither "what is
/// on my desk this week" nor a filing cabinet, so putting it inside Work or
/// Records would file the one screen everybody uses under a heading half of
/// them do not read.
///
/// # Groups appear as their screens do
///
/// The approved shape is Work · Records · Pay · Setup. A group is declared here
/// when it has a screen with an endpoint behind it and not before — `IA-GAP.md`
/// is the standing argument for that: a nav entry whose endpoint does not exist
/// is worse than a missing entry, because it is a screen somebody opens once,
/// finds empty, and stops trusting the app over.
export const peopleNav: AppModule = {
  id: "people",
  base: "/people",
  label: "People",
  icon: Users,
  home: "/people/overview",
  useAudience: usePeopleAudience,
  sections: [
    {
      items: [
        {
          /// The front door, above the groups, because it is what somebody
          /// opens when they do not yet know what they are looking for. Both
          /// HR prototypes lead with it and Finance puts its own Overview in
          /// exactly this position.
          ///
          /// It does not displace the Directory's claim to being opened daily
          /// — it answers a different question. The Directory is "tell me
          /// about this person"; this is "tell me what is waiting".
          path: "/people/overview",
          label: "Overview",
          icon: LayoutGrid,
        },
        { path: "/people", label: "Employees", icon: Users },
        {
          /// Ungrouped, beside the other front doors. It sat under **Setup**
          /// and was the only row there without an `audience`, which dragged
          /// that whole heading into a place manager's sidebar for the sake of
          /// one report — a group label promising rules they may not set.
          /// Reading is not setup.
          path: "/people/reports",
          label: "Reports",
          icon: ChartColumn,
        },
        {
          /// The confidential channel, beside Reports — the third of the
          /// front doors that is nobody's posting. Head office's queue alone:
          /// a grievance against a store manager cannot be investigated by
          /// that store manager, and in a thirteen-store estate the only place
          /// that is nobody's posting is head office. Reading it is its own
          /// key, finer than the ladder, so `audience` keeps the row off a
          /// place manager's sidebar entirely — the accused supervisor holds
          /// `people.employee.read` and must not therefore read the queue.
          /// It deliberately does not join the Requests queue, whose rows a
          /// place manager reads.
          ///
          /// A bounded caller who pastes the URL anyway gets the screen's own
          /// face: the same route answers them with their own filings, and
          /// the raise form files for themselves or their staff.
          path: "/people/grievances",
          label: "Grievances",
          icon: MessageSquareWarning,
          audience: "employer",
        },
        {
          /// Asking for somebody, and head office answering. Beside the
          /// Directory rather than in Work, because it is the front of the
          /// same lifecycle the Directory holds the rest of — and because
          /// `APPROVED` here is not a person yet: the employment record is
          /// opened afterwards and starts as a candidate.
          ///
          /// No `audience`: a shop asks and head office decides, so both
          /// faces open it and each is offered only the acts it may take.
          path: "/people/hire",
          label: "New employees",
          icon: UserPlus,
        },
      ],
    },
    {
      /// What is on somebody's desk this week. A place manager decides here
      /// and head office reads, which is why nothing in this group carries an
      /// `audience`: the work is the shop's, and the employer watches it.
      label: "Work",
      items: [
        {
          /// One queue, not three. A manager has five minutes and a list of
          /// things waiting on them, not a leave task and a correction task
          /// and an overtime task — three screens each holding two rows is how
          /// all three stop being opened.
          path: "/people/requests",
          label: "Requests",
          icon: Inbox,
        },
        {
          /// Money waiting on a decision, beside the time already in the
          /// queue above — petty-cash claims are the same shape of work: filed
          /// by a place, waiting on the manager who did not file them.
          ///
          /// No `audience`: both faces use it. A place manager files for
          /// their staff and decides what waits on them; head office reads
          /// every place's queue and names the kinds of expense a claim may
          /// be filed against, on that screen's own Types tab.
          path: "/people/claims",
          label: "Claims",
          icon: ReceiptText,
        },
        {
          /// Its own screen as well as a section of the queue, because
          /// *ordering* overtime is a thing a manager sets out to do — the
          /// queue is what is waiting on them, and this is what they start.
          path: "/people/overtime",
          label: "Overtime",
          icon: Clock4,
        },
        {
          /// Balances and the calendar — the half of leave that is read
          /// rather than decided. The deciding is Requests'; a second screen
          /// that offered an approve button would be a second place to get a
          /// different answer.
          path: "/people/leave",
          label: "Leave",
          icon: Sun,
        },
        {
          /// The week, per person. No `audience`: a place builds its roster
          /// and head office reads it, which is one screen serving two
          /// readings rather than two screens.
          path: "/people/roster",
          label: "Roster",
          icon: CalendarRange,
        },
        {
          /// What the days amounted to. Between the roster and the close, in
          /// the order the work happens: the plan is written, the days are
          /// worked, the month is signed off.
          ///
          /// The path is `/people/attendance-days` and not `/people/attendance`
          /// because the second now names the *policy* panel inside Time
          /// policy. Two screens cannot share an address, and the rules a
          /// month is judged against are a different question from what a
          /// month contained.
          path: "/people/attendance-days",
          label: "Attendance",
          icon: Fingerprint,
        },
        {
          /// Signing the month off. The place closes; head office reopens —
          /// the screen offers whichever the caller may actually do.
          path: "/people/periods",
          label: "Period close",
          icon: CalendarCheck,
        },
      ],
    },
    {
      /// Money. Head office's entirely, by Hari's decision: a place manager's
      /// whole contribution to payroll is closing their attendance period, and
      /// they never see a run.
      label: "Pay",
      items: [
        {
          path: "/people/pay",
          label: "Pay agreements",
          icon: BadgeDollarSign,
          audience: "employer",
        },
        {
          /// **No `audience`.** Hari's decision of 2026-09-13 reversed the one
          /// this module was built to: a place no longer merely closes its
          /// attendance period — it opens its own payroll, reads the figures,
          /// and submits the batch. `domain::employment::audit` says so in as
          /// many words and puts `people.payroll.{open,submit}` and
          /// `people.pay.read` at the Supervisor rung, bounded by `Reach`.
          ///
          /// So hiding this row from a place manager was not a cautious
          /// default — it was the app withholding the one screen that decision
          /// gave them. Approving, reopening and handing to Finance stay head
          /// office's, enforced on the server and reflected by the screen,
          /// which offers a place only the step it may take.
          path: "/people/payroll",
          label: "Payroll runs",
          icon: Receipt,
        },
        {
          /// What the company hands over, and the rules it hands it out by:
          /// the uniform ledger the store records, the rates and ceilings
          /// head office sets. Both halves, one screen, because the count is
          /// meaningless without the entitlement beside it.
          path: "/people/benefits",
          label: "Benefits",
          icon: HeartHandshake,
        },
      ],
    },
    {
      /// The rules every place is measured against. Head office's, all of
      /// them — a shop that could set its own idea of "late", or of what a
      /// day off costs, is a shop whose attendance and leave mean nothing next
      /// to the shop beside it.
      label: "Setup",
      items: [
        {
          /// Four rows became one, 2026-09-13, on the owner's decision and
          /// with both HR prototypes arguing for it independently. The
          /// reasoning — and the fact that the four old addresses no longer
          /// resolve — is in `policy.tsx`.
          path: "/people/policy",
          label: "Time policy",
          icon: CalendarClock,
          audience: "employer",
        },
        {
          /// The rule numbers in one place: tolerance, entitlements, overtime
          /// multipliers, claim ceilings, the statutory percentages. Reading
          /// is everybody's; setting is head office's, with a reason.
          path: "/people/policies",
          label: "Rule numbers",
          icon: SlidersHorizontal,
          audience: "employer",
        },
        {
          /// Structures, positions and grade bands. Head office's vocabulary,
          /// shipped seeded and read-only in this generation.
          path: "/people/structures",
          label: "Salary structures",
          icon: Layers,
          audience: "employer",
        },
        {
          /// The fingerprint stations, and whose fingers each unit's station
          /// knows. Head office's, because binding a biometric to an
          /// employment record is the employer's act even though the finger
          /// is on a reader in the shop — and because a template held
          /// centrally is what lets somebody transfer without enrolling
          /// again.
          path: "/people/terminals",
          label: "Punch stations",
          icon: ScanFace,
          audience: "employer",
        },
        {
          /// What the clock does when nobody is looking: the accrual a policy
          /// earned, the carry-forward a cap put a deadline on, next week's
          /// roster, and the nudges. Read-only evidence plus a deliberate
          /// "run now" — the worker itself is `bin/cloud.rs`.
          path: "/people/scheduler",
          label: "Scheduler",
          icon: Timer,
          audience: "employer",
        },
      ],
    },
  ],
}
