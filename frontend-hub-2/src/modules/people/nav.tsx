import {
  Award,
  BadgeDollarSign,
  CalendarCheck,
  CalendarClock,
  CalendarCog,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  Clock4,
  HandCoins,
  Inbox,
  ListChecks,
  Receipt,
  ScrollText,
  UserPlus,
  Users,
} from "lucide-react"

import { lazy } from "react"

import type { Module, NavItem } from "@/lib/nav"
import { date, listParams, oneOf, str } from "@/lib/search-schema"
import { today } from "@/lib/format"
import { Gap } from "@/modules/people/gap"

/// People — who works here, what is waiting on somebody, and what they are paid.
///
/// ## One module, two faces
///
/// The draft this replaced had three menus: one for head office, one for a
/// store manager, one for the DC. It was wrong about the work. A store manager
/// and a DC manager do the *same* HR job — build the roster, see who is in,
/// approve the leave that breaks it, order overtime, close the month — and only
/// their data differs. Two menus with the same eight entries are one menu.
///
/// Head office is not a third variant of that manager. It is the **employer**:
/// contracts, moving somebody between places, ending employment, pay, and every
/// rule the places are measured against. So there is one module, and
/// `audience` decides which rows a caller is offered. See `lib/reach.ts` for
/// where that answer comes from and why it is not a permission.
///
/// Employees themselves are not here at all. They ask for their own leave and
/// read their own payslip on `frontend-employee`; a second place to do that is
/// a second place to get a different answer.
///
/// ## Why the module's own screen is the Directory
///
/// It is the front door and both faces open it daily, which is what Overview is
/// to Finance. It is also neither "what is on my desk this week" nor a filing
/// cabinet, so putting it inside Work or Records would file the one screen
/// everybody uses under a heading half of them do not read.
///
/// ## Two kinds of row, and the difference is stated on the screen
///
/// A row here is one of two things, and a reader is entitled to know which:
///
///   **written** — it reads a real endpoint. Twelve of them.
///   **`Gap`**   — there is no endpoint at all, and the placeholder says what
///                 is missing rather than implying a port is pending. Five.
///
/// There was a third — `Soon`, for a screen that existed in `frontend-hub` and
/// had not been rewritten here. All seven have been, so `kit/soon.tsx` has no
/// caller in this module any more and the helper that wrapped it is gone rather
/// than left standing with nothing in it.
///
/// The five that remain were each checked against the backend before being left
/// alone, and every one of them is still true: there is no punch source
/// anywhere in the cloud (`unrostered_punch_days` is `None` by construction —
/// see `postgres/roster.rs`), `http/performance.rs` is COMMERCIAL performance
/// and has nothing to do with a person, and claims, advances and recruitment
/// have no table, no route and no migration between them. `Gap` exists beside
/// `kit/soon.tsx` for exactly this: telling somebody their screen is merely
/// un-ported, when in fact the data it would read does not exist, sends them to
/// the other app to look for it.

/// Each written screen in its own chunk, fetched when somebody opens it.
const DirectoryScreen = lazy(() =>
  import("@/modules/people/directory").then((m) => ({
    default: m.DirectoryScreen,
  })),
)
const RequestsScreen = lazy(() =>
  import("@/modules/people/requests").then((m) => ({
    default: m.RequestsScreen,
  })),
)
const OvertimeScreen = lazy(() =>
  import("@/modules/people/overtime").then((m) => ({
    default: m.OvertimeScreen,
  })),
)
const ContractsScreen = lazy(() =>
  import("@/modules/people/contracts").then((m) => ({
    default: m.ContractsScreen,
  })),
)
const PayrollScreen = lazy(() =>
  import("@/modules/people/payroll").then((m) => ({
    default: m.PayrollScreen,
  })),
)
const RosterScreen = lazy(() =>
  import("@/modules/people/roster").then((m) => ({ default: m.RosterScreen })),
)
const PeriodsScreen = lazy(() =>
  import("@/modules/people/periods").then((m) => ({
    default: m.PeriodsScreen,
  })),
)
const PayScreen = lazy(() =>
  import("@/modules/people/pay").then((m) => ({ default: m.PayScreen })),
)
const AttendancePolicyScreen = lazy(() =>
  import("@/modules/people/attendance-policy").then((m) => ({
    default: m.AttendancePolicyScreen,
  })),
)
const ShiftsScreen = lazy(() =>
  import("@/modules/people/shifts").then((m) => ({ default: m.ShiftsScreen })),
)
const LeaveTypesScreen = lazy(() =>
  import("@/modules/people/leave-types").then((m) => ({
    default: m.LeaveTypesScreen,
  })),
)
const HolidaysScreen = lazy(() =>
  import("@/modules/people/holidays").then((m) => ({
    default: m.HolidaysScreen,
  })),
)

/// A placeholder is not worth a chunk of its own: it is a dozen lines and every
/// one of the five shares it.
const gap = (name: string, missing: React.ReactNode) => () => (
  <Gap name={name} missing={missing} />
)

/// The rows below carry `audience`, and the shell now reads it: a manager at
/// one shop is not offered contracts, transfers, pay or the employer's rules —
/// see `visibleSections` in `src/lib/nav.ts`.
///
/// Nothing is protected by it. Every route re-checks the rung and the reach,
/// and a caller who reaches a payroll URL — by ⌘K, by a link, or from a
/// bookmark made before a transfer — gets the server's refusal, which the
/// screen draws as `NoAccess`. A filtered menu is a convenience; the route that
/// refuses is the control.

const sections: readonly {
  readonly label?: string
  readonly items: readonly NavItem[]
}[] = [
  {
    items: [
      {
        path: "/people",
        label: "Directory",
        icon: Users,
        screen: DirectoryScreen,
        // `status` is a real server parameter; `person` is which record is
        // open. Neither `q` nor `sort` is declared, because `GET /employees`
        // honours neither — a screen that accepted them in its URL would be
        // promising a narrowing it cannot perform.
        /// `sort` overrides `listParams`' `"default"` with the key the server
        /// actually orders by when asked for nothing — so the header strip
        /// opens showing which column the rows are already in, rather than
        /// claiming an order named "default" that no column can be.
        search: {
          ...listParams,
          sort: oneOf(
            ["code", "name", "contract_end", "place"] as const,
            "code",
          ),
          status: oneOf(
            ["", "CANDIDATE", "ACTIVE", "SUSPENDED", "TERMINATED"] as const,
            "",
          ),
          person: str(),
        },
      },
    ],
  },
  {
    /// What is on somebody's desk this week. A place manager decides here and
    /// head office reads, which is why nothing in this group carries an
    /// `audience`: the work is the shop's, and the employer watches it.
    label: "Work",
    items: [
      {
        /// One queue, not three. A manager has five minutes and a list of
        /// things waiting on them, not a leave task and a correction task and
        /// an overtime task.
        path: "/people/requests",
        label: "Requests",
        icon: Inbox,
        screen: RequestsScreen,
        search: { request: str() },
      },
      {
        /// Its own screen rather than a section of the queue, because what is
        /// on it is not waiting on the manager at all — it is waiting on the
        /// worker, and a queue of things somebody else must answer teaches
        /// people to ignore the queue.
        path: "/people/overtime",
        label: "Overtime",
        icon: Clock4,
        screen: OvertimeScreen,
        search: { order: str() },
      },
      {
        path: "/people/attendance",
        label: "Attendance today",
        icon: CalendarCheck,
        screen: gap(
          "Attendance today",
          <>
            There is no punch source anywhere in the cloud — no clock, no
            terminal, no route that records somebody arriving. Nothing can say
            who is in, and a roster drawn as attendance would report everybody
            absent.
          </>,
        ),
      },
      {
        path: "/people/corrections",
        label: "Attendance corrections",
        icon: ClipboardCheck,
        screen: gap(
          "Attendance corrections",
          <>
            A correction amends a punch, and there are no punches to amend. This
            joins the Requests queue on the day there is an attendance source to
            correct against.
          </>,
        ),
      },
      {
        /// The week, per person. No `audience`: a place builds its roster and
        /// head office reads it — one screen serving two readings.
        path: "/people/roster",
        label: "Roster",
        icon: CalendarRange,
        screen: RosterScreen,
        /// `place` because `GET /roster` refuses to answer without one and
        /// there is no places endpoint to pick from — see `places.ts`. `week`
        /// is the Monday, snapped by the screen whatever the URL said, so a
        /// pasted Wednesday still opens a whole week. `person` is whose week is
        /// open in the panel.
        ///
        /// `week` defaults to today rather than to this Monday: `date()` takes
        /// a fallback, not a transform, and the screen snaps it either way —
        /// putting the snap in both places would be two spellings of one rule.
        search: { place: str(), week: date(today), person: str() },
      },
      {
        /// Signing the month off. The place closes; head office reopens — the
        /// screen offers whichever the caller may actually do.
        path: "/people/periods",
        label: "Period close",
        icon: CalendarClock,
        screen: PeriodsScreen,
        /// `period` is the month being asked about — `YYYY-MM`, which is how
        /// the server spells one — and `month` is which month's sign-off record
        /// is open in the panel. Two parameters that both look like a month and
        /// are not the same question: one asks the server, the other opens a
        /// sheet over the answer.
        search: { place: str(), period: str(), month: str() },
      },
    ],
  },
  {
    label: "Records",
    items: [
      {
        /// The module's exception queue: a fixed term that lapses unnoticed is
        /// somebody working without a contract.
        path: "/people/contracts",
        label: "Contracts expiring",
        icon: ScrollText,
        screen: ContractsScreen,
        search: {
          as_of: date(today),
          within: oneOf(["14", "30", "60", "90"] as const, "30"),
        },
      },
    ],
  },
  {
    /// Money. Head office's entirely: a place manager's whole contribution to
    /// payroll is closing their attendance period, and they never see a run.
    label: "Pay",
    items: [
      {
        path: "/people/pay",
        label: "Pay agreements",
        icon: BadgeDollarSign,
        screen: PayScreen,
        audience: "employer",
        /// The workforce's own narrowings, because the list underneath is the
        /// workforce: `GET /employees` honours `q`, `sort` and `dir` on the
        /// server. No `status` tab — somebody who has left still has agreements
        /// on record and a tab that hid them would hide the history somebody
        /// came to read — and no `panel`, so `listParams` is not spread.
        search: {
          q: str(),
          sort: oneOf(["code", "name", "place"] as const, "code"),
          dir: oneOf(["asc", "desc"] as const, "asc"),
          person: str(),
        },
      },
      {
        path: "/people/payroll",
        label: "Payroll runs",
        icon: Receipt,
        screen: PayrollScreen,
        audience: "employer",
        search: { place: str(), run: str() },
      },
      {
        path: "/people/claims",
        label: "Claims & advances",
        icon: HandCoins,
        screen: gap(
          "Claims & advances",
          <>
            Nothing on this backend records a claim, an advance or a
            reimbursement against a person. What exists is store cash and
            supplier bills, in Finance — a staff advance is neither, and filing
            it as either would put a personal debt in the wrong ledger.
          </>,
        ),
      },
    ],
  },
  {
    /// The rules every place is measured against. Head office's, all of them —
    /// a shop that could set its own idea of "late", or of what a day off
    /// costs, is a shop whose attendance means nothing next to the shop beside
    /// it.
    label: "Rules",
    items: [
      {
        path: "/people/attendance-policy",
        label: "Attendance policy",
        icon: CalendarClock,
        screen: AttendancePolicyScreen,
        /// `audience` is right even though the READ needs no key at all: a
        /// tolerance kept from the people it governs is a trap, so anybody who
        /// lands here may read it. The row is offered to whoever may CHANGE the
        /// rule, and `ATTENDANCE_POLICY_SET` is head office's.
        audience: "employer",
        /// A real server parameter: it decides which version the `in_force`
        /// flags are computed against, so "what was the tolerance in March" is
        /// a link somebody can send.
        search: { as_of: date(today) },
      },
      {
        /// The hours a rostered day is worth. Two shops that each name their
        /// own "Pagi" report the same word for different hours, and every
        /// figure folded over both becomes an average of two questions.
        path: "/people/shifts",
        label: "Shift patterns",
        icon: CalendarCog,
        screen: ShiftsScreen,
        audience: "employer",
        // No `search`. The endpoint takes no parameters at all — not even one
        // that would show a retired pattern — so there is nothing for a URL to
        // carry. An absent schema is a real answer rather than an oversight.
      },
      {
        path: "/people/leave-types",
        label: "Leave types",
        icon: ListChecks,
        screen: LeaveTypesScreen,
        /// Set at head office — `LEAVE_TYPE_SET` — though both routes behind
        /// this screen are readable by anybody signed in: somebody whose days
        /// are counted under a rule is entitled to read it.
        audience: "employer",
        // Neither route takes a parameter, so there is nothing to declare.
      },
      {
        path: "/people/holidays",
        label: "Holiday calendar",
        icon: CalendarDays,
        screen: HolidaysScreen,
        /// Publishing and amending share one key and both are head office's:
        /// adding a cuti bersama in March changes what people are owed exactly
        /// as much as publishing the year in January did. Reading needs no key,
        /// because somebody planning leave has to know which days are red
        /// before they can ask for any.
        audience: "employer",
        /// A string rather than an `int`, because the fallback is not a fixed
        /// number: it is the most recently PUBLISHED year, which only the
        /// server's answer knows. The screen ignores a year that is not on that
        /// list rather than fetching a 404 to find out.
        search: { year: str() },
      },
    ],
  },
  {
    label: "Hiring & growth",
    items: [
      {
        path: "/people/recruitment",
        label: "Recruitment",
        icon: UserPlus,
        screen: gap(
          "Recruitment",
          <>
            Employment begins at `CANDIDATE` — somebody already taken on and not
            yet started. Everything before that, an applicant and a vacancy, has
            no table, no route and no record on this backend.
          </>,
        ),
      },
      {
        path: "/people/performance",
        label: "Performance",
        icon: Award,
        screen: gap(
          "Performance",
          <>
            There is no review, no objective and no rating anywhere on this
            backend. A grade is carried on a contract and is pay, not
            performance.
          </>,
        ),
      },
    ],
  },
]

export const peopleNav: Module = {
  id: "people",
  label: "People",
  icon: Users,
  base: "/people",
  sections,
}
