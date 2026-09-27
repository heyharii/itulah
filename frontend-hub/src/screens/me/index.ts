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
import { Voice } from "@/screens/me/voice"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
export const screens: ScreenMap = {
  "/me": Profile,
  "/me/attendance": Attendance,
  "/me/attendance/correction": Correction,
  "/me/attendance/swap": Swap,
  "/me/leave": Leave,
  "/me/leave/new": LeaveNew,
  "/me/overtime": Overtime,
  "/me/pay": Pay,
  "/me/pay/slip": Payslip,
  "/me/pay/claims": Claims,
  "/me/details": Me,
  "/me/voice": Voice,
}
