import {
  BadgeCheck,
  CalendarDays,
  CalendarRange,
  ChartColumn,
  Clock4,
  Fingerprint,
  LayoutGrid,
  Link2,
  Network,
  Receipt,
  ReceiptText,
  Settings,
  Users,
} from "lucide-react"

import type { AppModule } from "@/lib/navigation"
import { usePeopleWaitingCount } from "@/screens/people/badges"
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
/// # Nine rows, not twenty
///
/// The menu had grown to twenty rows by 2026-09-27 and no longer fitted an
/// 800px screen: the whole Setup group sat below the fold, and the sidebar
/// hides its scrollbar. The owner asked for it simplified that day, by one
/// rule — a row is a place somebody opens at least weekly. So:
///
///  - the Overview is the one queue: what was the Requests screen is drawn on
///    it, and the claims, hire requests and payroll runs waiting on the caller
///    are rows in its attention list;
///  - what belongs to one person is reached from where people are: a hire
///    request from Employees;
///  - a plan act is a button on the plan: Overtime from the Roster;
///  - monthly work is a button on the screen it closes: Period close from
///    Attendance;
///  - a fact about one person is a tab on that person's sheet: their pay
///    agreement and their uniforms, under Employees;
///  - setup opened a few times a year is one Settings row, with Punch
///    stations and the Scheduler opened from its header;
///  - and Leave, Rule numbers and Salary structures were removed as
///    duplicates — Leave's balances are on the employee's sheet and its kinds
///    and holidays in Settings; Rule numbers repeated numbers the policies
///    hold, and nothing but the dropped bonus tiers read it; Salary structures
///    was a read-only seed the owner dropped with the grade masters.
///
/// # Ten rows (2026-09-30)
///
/// Compared line by line with Talenta and Frappe HRMS, the owner struck what
/// this company does not use: recruitment and the hire request, grievances,
/// period close, training, performance, uniforms, and the punch-station and
/// scheduler screens (the stations keep working and the scheduler keeps
/// running; neither has a screen now). Grievances left the sidebar and the
/// Speak up page left `/me`. What remains is ten rows — see
/// `hr-talenta-prototype/MENU-COMPARISON.md`.
///
/// Every screen that stopped being a row is `hidden`, not gone: routed, in ⌘K,
/// and lighting the row it now lives under through `alsoLights`. The four
/// groups are hairlines rather than words — the front doors, time, money, then
/// reading and rules — because every word tried for them named a category of
/// table.
///
/// Employees themselves use `/me` (and `frontend-employee`) to ask for their
/// own leave and read their own payslip; a second place to do that here would
/// be a second place to get a different answer.
///
/// # Groups appear as their screens do
///
/// A row is declared here when it has a screen with an endpoint behind it and
/// not before — `IA-GAP.md` is the standing argument for that: a nav entry
/// whose endpoint does not exist is worse than a missing entry, because it is
/// a screen somebody opens once, finds empty, and stops trusting the app over.
export const peopleNav: AppModule = {
  id: "people",
  base: "/people",
  label: "People",
  icon: Users,
  home: "/people/overview",
  useAudience: usePeopleAudience,
  sections: [
    {
      /// The front doors: what is waiting, and who works here.
      items: [
        {
          /// What is waiting on the caller, and what is about to go wrong:
          /// the attention list, then the leave, corrections and swaps they
          /// decide, on one screen. The count is how many of those decisions
          /// are theirs — the badge is the reason to open it.
          path: "/people/overview",
          // The queue lives on this screen, so make it discoverable by the
          // word managers use when they are looking for approvals.
          label: "Overview & requests",
          icon: LayoutGrid,
          badge: "warn",
          useCount: usePeopleWaitingCount,
        },
        {
          /// Everybody, and each person's sheet. Adding somebody is a button
          /// here (Add employee), not a screen of its own.
          path: "/people",
          label: "Employees",
          icon: Users,
        },
        {
          /// Who reports to whom, by department and level (0805).
          path: "/people/org-chart",
          label: "Org chart",
          icon: Network,
        },
        {
          /// Who has been sent a link to set their own password, and whether
          /// they have used it.
          path: "/people/invitations",
          label: "Invitations",
          icon: Link2,
        },
        {
          /// The job roles people are invited as, and which sections of
          /// Central each sees. Moved here from System on 2026-09-29.
          path: "/people/job-roles",
          label: "Job roles",
          icon: BadgeCheck,
        },
      ],
    },
    {
      /// Time: the plan and what the days amounted to. A place manager
      /// decides here and head office reads, which is why nothing in this
      /// group carries an `audience`.
      items: [
        {
          /// The week, per person. Overtime is ordered from here, because
          /// extra hours are part of the plan.
          path: "/people/roster",
          label: "Roster",
          icon: CalendarRange,
          alsoLights: ["/people/overtime"],
        },
        {
          /// Who is away when, a month at a time (0809).
          path: "/people/calendar",
          label: "Team calendar",
          icon: CalendarDays,
        },
        {
          /// What the days amounted to. The path is `/people/attendance-days`
          /// because the rules a month is judged against were once at
          /// `/people/attendance`, and a link to the old address should not
          /// quietly land on a different question.
          path: "/people/attendance-days",
          label: "Attendance",
          icon: Fingerprint,
        },
        {
          /// Ordering extra hours, and the orders' answers. Opened from the
          /// Roster; the ones nobody has answered are on the Overview.
          path: "/people/overtime",
          label: "Overtime",
          icon: Clock4,
          hidden: true,
        },
      ],
    },
    {
      /// Money.
      items: [
        {
          /// Reimbursement claims and loans: filed by a place, decided by a
          /// manager who did not file them; head office names the kinds.
          path: "/people/claims",
          label: "Claims",
          icon: ReceiptText,
        },
        {
          /// **No `audience`.** A place opens its own payroll, reads the
          /// figures, and submits the batch; approving, reopening and handing
          /// to Finance stay head office's, enforced on the server.
          path: "/people/payroll",
          label: "Payroll",
          icon: Receipt,
        },
      ],
    },
    {
      /// Reading, and the rules every place is measured against.
      items: [
        {
          /// Reading is not setup: a place manager reads their own figures
          /// here, so it carries no `audience`.
          path: "/people/reports",
          label: "Reports",
          icon: ChartColumn,
        },
        {
          /// The rules, as tabs: attendance tolerances, shifts, leave kinds,
          /// holidays, payroll. See `policy.tsx`.
          path: "/people/settings",
          label: "Settings",
          icon: Settings,
          audience: "employer",
        },
      ],
    },
  ],
}
