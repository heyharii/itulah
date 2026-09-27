import {
  CalendarCheck,
  CalendarRange,
  ChartColumn,
  Clock4,
  Fingerprint,
  LayoutGrid,
  MessageSquareWarning,
  Receipt,
  ReceiptText,
  ScanFace,
  Settings,
  Timer,
  UserPlus,
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
          label: "Overview",
          icon: LayoutGrid,
          badge: "warn",
          useCount: usePeopleWaitingCount,
        },
        {
          path: "/people",
          label: "Employees",
          icon: Users,
          alsoLights: ["/people/hire"],
        },
        {
          /// Asking for somebody, and head office answering. The front of the
          /// lifecycle Employees holds the rest of, so it is opened from there
          /// — `APPROVED` here is not a person yet: the employment record is
          /// opened afterwards and starts as a candidate. A shop asks and head
          /// office decides, so both faces reach it.
          path: "/people/hire",
          label: "New employees",
          icon: UserPlus,
          hidden: true,
        },
      ],
    },
    {
      /// Time: the plan and what the days amounted to. A place manager
      /// decides here and head office reads, which is why nothing in this
      /// group carries an `audience`.
      items: [
        {
          /// The week, per person: a place builds its roster and head office
          /// reads it, one screen serving two readings. Overtime is ordered
          /// from here, because extra hours are part of the plan.
          path: "/people/roster",
          label: "Roster",
          icon: CalendarRange,
          alsoLights: ["/people/overtime"],
        },
        {
          /// What the days amounted to. The path is `/people/attendance-days`
          /// because the rules a month is judged against were once at
          /// `/people/attendance`, and a link to the old address should not
          /// quietly land on a different question.
          path: "/people/attendance-days",
          label: "Attendance",
          icon: Fingerprint,
          alsoLights: ["/people/periods"],
        },
        {
          /// Ordering extra hours, and the orders' answers. Opened from the
          /// Roster; the ones nobody has answered are on the Overview.
          path: "/people/overtime",
          label: "Overtime",
          icon: Clock4,
          hidden: true,
        },
        {
          /// Signing the month off: the place closes, head office reopens.
          /// Once a month, so it is a button on Attendance — the days it signs
          /// off — rather than a row read every morning.
          path: "/people/periods",
          label: "Period close",
          icon: CalendarCheck,
          hidden: true,
        },
      ],
    },
    {
      /// Money.
      items: [
        {
          /// Money waiting on a decision — petty-cash claims are filed by a
          /// place and decided by the manager who did not file them. Both
          /// faces use it; head office also names the kinds of expense a claim
          /// may be filed against, on the screen's own Types tab.
          path: "/people/claims",
          label: "Claims",
          icon: ReceiptText,
        },
        {
          /// **No `audience`.** Hari's decision of 2026-09-13: a place opens
          /// its own payroll, reads the figures, and submits the batch;
          /// approving, reopening and handing to Finance stay head office's,
          /// enforced on the server and reflected by the screen.
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
          /// The confidential channel. Head office's queue alone: a grievance
          /// against a store manager cannot be investigated by that store
          /// manager, and in a thirteen-store estate the only place that is
          /// nobody's posting is head office. Reading it is its own key, finer
          /// than the ladder, so `audience` keeps the row off a place
          /// manager's sidebar entirely.
          ///
          /// A bounded caller who pastes the URL anyway gets the screen's own
          /// face: the same route answers them with their own filings.
          path: "/people/grievances",
          label: "Grievances",
          icon: MessageSquareWarning,
          audience: "employer",
        },
        {
          /// Attendance tolerances, shifts, leave kinds and holidays — the
          /// time rules, as tabs — with Punch stations and the Scheduler
          /// opened from its header. See `policy.tsx`.
          path: "/people/settings",
          label: "Settings",
          icon: Settings,
          audience: "employer",
          alsoLights: ["/people/terminals", "/people/scheduler"],
        },
        {
          /// The fingerprint stations, and whose fingers each unit's station
          /// knows. Head office's, because binding a biometric to an
          /// employment record is the employer's act even though the finger
          /// is on a reader in the shop. Opened from Settings.
          path: "/people/terminals",
          label: "Punch stations",
          icon: ScanFace,
          audience: "employer",
          hidden: true,
        },
        {
          /// What the clock does when nobody is looking: accruals, the
          /// carry-forward a cap put a deadline on, next week's roster, the
          /// nudges. Opened from Settings.
          path: "/people/scheduler",
          label: "Scheduler",
          icon: Timer,
          audience: "employer",
          hidden: true,
        },
      ],
    },
  ],
}
