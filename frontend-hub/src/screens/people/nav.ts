import {
  BadgeDollarSign,
  CalendarCheck,
  CalendarClock,
  CalendarRange,
  Clock4,
  Inbox,
  Receipt,
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
  label: "People",
  icon: Users,
  home: "/people",
  useAudience: usePeopleAudience,
  sections: [
    {
      items: [{ path: "/people", label: "Directory", icon: Users }],
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
          /// Its own screen as well as a section of the queue, because
          /// *ordering* overtime is a thing a manager sets out to do — the
          /// queue is what is waiting on them, and this is what they start.
          path: "/people/overtime",
          label: "Overtime",
          icon: Clock4,
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
          path: "/people/payroll",
          label: "Payroll runs",
          icon: Receipt,
          audience: "employer",
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
      ],
    },
  ],
}
