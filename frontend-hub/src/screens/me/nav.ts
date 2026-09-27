import {
  CalendarDays,
  Clock,
  FileText,
  Hourglass,
  IdCard,
  MessageCircleWarning,
  Receipt,
  UserRound,
  Wallet,
} from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// The employee's own records — the Profile tab of the phone's bottom bar.
///
/// This was a separate app (`frontend-employee`) on the same cloud node and the
/// same account; it moved in on the owner's plan (2026-09-26) so a phone needs
/// one app, not two. Unlisted like the launcher: on a desk it is reached from
/// the account row at the foot of the sidebar, not from a department's list.
///
/// The screens an employee opens from another one — a payslip from the pay
/// list, a correction from a day — are `hidden`: routed and titled, but not
/// rows of their own.
export const meNav: AppModule = {
  id: "me",
  label: "Profile",
  icon: UserRound,
  home: "/me",
  sections: [
    {
      items: [
        { path: "/me", label: "Profile", icon: UserRound },
        { path: "/me/attendance", label: "Attendance", icon: Clock },
        {
          path: "/me/attendance/correction",
          label: "Correct a day",
          icon: Clock,
          hidden: true,
        },
        {
          path: "/me/attendance/swap",
          label: "Swap a day",
          icon: Clock,
          hidden: true,
        },
        { path: "/me/leave", label: "Leave", icon: CalendarDays },
        {
          path: "/me/leave/new",
          label: "Request leave",
          icon: CalendarDays,
          hidden: true,
        },
        { path: "/me/overtime", label: "Overtime", icon: Hourglass },
        { path: "/me/pay", label: "Pay", icon: Wallet },
        {
          path: "/me/pay/slip",
          label: "Payslip",
          icon: FileText,
          hidden: true,
        },
        { path: "/me/pay/claims", label: "Claims", icon: Receipt },
        { path: "/me/details", label: "My details", icon: IdCard },
        {
          path: "/me/voice",
          label: "Speak up",
          icon: MessageCircleWarning,
          // Off the menu on the owner's word (2026-09-26); still reached from
          // "Raise a concern with HR" on My details.
          hidden: true,
        },
      ],
    },
  ],
}
