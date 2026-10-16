import { lazyScreen, type ScreenMap } from "@/screens/registry"
import { gated } from "@/screens/me/data/ess"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
///
/// Each screen of a module is gated by the company's module setting (0813).
export const screens: ScreenMap = {
  "/me": lazyScreen(
    "me/profile",
    () => import("@/screens/me/profile"),
    (m) => m.Profile
  ),
  "/me/attendance": lazyScreen(
    "me/attendance",
    () => import("@/screens/me/attendance"),
    (m) => gated(m.Attendance, "/me/attendance")
  ),
  "/me/attendance/correction": lazyScreen(
    "me/correction",
    () => import("@/screens/me/correction"),
    (m) => gated(m.Correction, "/me/attendance/correction")
  ),
  "/me/attendance/swap": lazyScreen(
    "me/swap",
    () => import("@/screens/me/swap"),
    (m) => gated(m.Swap, "/me/attendance/swap")
  ),
  "/me/leave": lazyScreen(
    "me/leave",
    () => import("@/screens/me/leave"),
    (m) => gated(m.Leave, "/me/leave")
  ),
  "/me/leave/new": lazyScreen(
    "me/leave-new",
    () => import("@/screens/me/leave-new"),
    (m) => gated(m.LeaveNew, "/me/leave/new")
  ),
  "/me/overtime": lazyScreen(
    "me/overtime",
    () => import("@/screens/me/overtime"),
    (m) => gated(m.Overtime, "/me/overtime")
  ),
  "/me/pay": lazyScreen(
    "me/pay",
    () => import("@/screens/me/pay"),
    (m) => gated(m.Pay, "/me/pay")
  ),
  "/me/pay/slip": lazyScreen(
    "me/payslip",
    () => import("@/screens/me/payslip"),
    (m) => gated(m.Payslip, "/me/pay/slip")
  ),
  "/me/pay/claims": lazyScreen(
    "me/claims",
    () => import("@/screens/me/claims"),
    (m) => gated(m.Claims, "/me/pay/claims")
  ),
  "/me/details": lazyScreen(
    "me/details",
    () => import("@/screens/me/details"),
    (m) => m.Me
  ),
}
