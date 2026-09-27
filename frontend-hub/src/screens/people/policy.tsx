import { ScanFace, Timer } from "lucide-react"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { PageHeader } from "@/components/ui/page-header"
import { SubTabs } from "@/components/ui/sub-tabs"
import { AttendancePolicy } from "@/screens/people/attendance"
import { Holidays } from "@/screens/people/holidays"
import { LeaveTypes } from "@/screens/people/leave-types"
import { ShiftPatterns } from "@/screens/people/shifts"

/// HR's settings: the rules every place is measured against, behind one door.
///
/// # One Settings row (2026-09-27)
///
/// This was "Time policy", with Punch stations, Scheduler, Rule numbers and
/// Salary structures as rows of their own beside it. The owner asked for a
/// shorter menu, and all five are setup somebody opens a few times a year, so
/// the sidebar has one Settings row: the four time rules are the tabs here,
/// and the two heavier screens — the stations, with tabs of their own, and the
/// scheduler's run ledger — open from the header rather than nesting a tab
/// strip inside a tab. Rule numbers and Salary structures were removed: the
/// first repeated numbers the policies below already hold, the second was a
/// read-only seed the owner had dropped with the grade masters.
///
/// # Why these four are one menu and not four
///
/// They were four sidebar rows — Attendance policy, Shift patterns, Leave
/// types, Holiday calendar — and both HR design prototypes independently put
/// them behind a single entry. The owner agreed on 2026-09-13.
///
/// The argument is that they are one decision wearing four shapes. Each is
/// effective-dated, each is head office's alone, each is opened a handful of
/// times a year, and every one of them is a rule that a month of attendance is
/// later judged against: what "late" means, what a rostered day is worth, what
/// kinds of absence exist, and which days are red. A sidebar that spends four
/// of its rows on things nobody opens weekly is a sidebar where the things
/// people *do* open weekly are harder to find.
///
/// # The tabs are state, not a URL
///
/// The owner also decided, the same day, that People stays flat: one screen,
/// one address. So the tab is `useState`, the way `system/access.tsx` and
/// `finance/reports.tsx` already hold theirs — not a fifth entry in
/// `lib/sheets.ts`. The cost is honest and small: a tab cannot be sent to a
/// colleague. The thing worth sending is a policy version, and that is a
/// question the screens below answer from the server rather than from the
/// address bar.
///
/// # The four old addresses are gone
///
/// `/people/attendance`, `/people/shifts`, `/people/leave-types` and
/// `/people/holidays` no longer resolve. Keeping them as hidden routes was the
/// obvious kindness and it would have meant every panel carrying two page
/// headers — one for standing alone and one for standing in a tab — which is
/// two things to keep in agreement for the sake of links that only exist on
/// this laptop. The screens have never been committed, let alone shared.
///
/// # Each panel keeps its own controls
///
/// A tab cannot own the page title, so the two panels that had page-header
/// actions — the attendance policy's "as at" date, the calendar's year — now
/// carry them in a toolbar of their own. That is the only change to what any
/// of the four panels does.
const TABS = [
  { value: "attendance", label: "Attendance" },
  { value: "shifts", label: "Shifts" },
  { value: "leave", label: "Leave types" },
  { value: "holidays", label: "Holidays" },
] as const

/// One sentence per tab, in the page header, because the four answer four
/// different questions and a single sentence covering all of them would say
/// nothing. Each is the sentence that panel's own header used to carry.
const SUB: Record<string, string> = {
  attendance:
    "The tolerances a month of arrivals is judged against. Anybody signed in may read them; only head office may change them.",
  shifts:
    "The hours a rostered day is worth. Set once for every place, because a shop that names its own shifts cannot be compared with the shop beside it.",
  leave:
    "What kinds of leave exist, what each draws on, and the rules a balance folds under.",
  holidays:
    "Which days are red, and which of them come out of somebody's annual leave.",
}

export function PeopleSettings() {
  const [tab, setTab] = useState<string>("attendance")

  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="Settings"
        sub={SUB[tab]}
        actions={
          // The two setup screens too big to be a tab: the stations (which
          // have tabs of their own) and what the clock does with these rules
          // when nobody is looking. Both were sidebar rows until 2026-09-27.
          <>
            <AppLink to="/people/terminals" variant="ghost">
              <ScanFace />
              Punch stations
            </AppLink>
            <AppLink to="/people/scheduler" variant="ghost">
              <Timer />
              Scheduler
            </AppLink>
          </>
        }
      />

      <SubTabs tabs={TABS} value={tab} onChange={setTab} />

      {tab === "attendance" && <AttendancePolicy />}
      {tab === "shifts" && <ShiftPatterns />}
      {tab === "leave" && <LeaveTypes />}
      {tab === "holidays" && <Holidays />}
    </PageContent>
  )
}
