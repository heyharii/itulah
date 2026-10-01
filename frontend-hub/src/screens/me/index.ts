import type { ScreenMap } from "@/screens/registry"
import { Attendance } from "@/screens/me/attendance"
import { Claims } from "@/screens/me/claims"
import { Correction } from "@/screens/me/correction"
import { Me } from "@/screens/me/details"
import { Leave } from "@/screens/me/leave"
import { LeaveNew } from "@/screens/me/leave-new"
import { Overtime } from "@/screens/me/overtime"
import { Pay } from "@/screens/me/pay"
import { Payslip } from "@/screens/me/payslip"
import { Profile } from "@/screens/me/profile"
import { Swap } from "@/screens/me/swap"
import { gated } from "@/screens/me/data/ess"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
///
/// Each screen of a module is gated by the company's module setting (0813).
export const screens: ScreenMap = {
  "/me": Profile,
  "/me/attendance": gated(Attendance, "/me/attendance"),
  "/me/attendance/correction": gated(Correction, "/me/attendance/correction"),
  "/me/attendance/swap": gated(Swap, "/me/attendance/swap"),
  "/me/leave": gated(Leave, "/me/leave"),
  "/me/leave/new": gated(LeaveNew, "/me/leave/new"),
  "/me/overtime": gated(Overtime, "/me/overtime"),
  "/me/pay": gated(Pay, "/me/pay"),
  "/me/pay/slip": gated(Payslip, "/me/pay/slip"),
  "/me/pay/claims": gated(Claims, "/me/pay/claims"),
  "/me/details": Me,
}
