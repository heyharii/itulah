import { lazyScreen, type ScreenMap } from "@/screens/registry"
import { gated } from "@/screens/me/data/ess"
import { framed } from "@/screens/me/frame"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
///
/// Each screen of a module is gated by the company's module setting (0813),
/// and stands in the hub's page frame (`framed`).
export const screens: ScreenMap = {
  "/me": lazyScreen(
    "me/profile",
    () => import("@/screens/me/profile"),
    (m) => m.Profile
  ),
  "/me/attendance": lazyScreen(
    "me/attendance",
    () => import("@/screens/me/attendance"),
    (m) => framed(gated(m.Attendance, "/me/attendance"), "/me/attendance")
  ),
  "/me/attendance/correction": lazyScreen(
    "me/correction",
    () => import("@/screens/me/correction"),
    (m) =>
      framed(
        gated(m.Correction, "/me/attendance/correction"),
        "/me/attendance/correction"
      )
  ),
  "/me/attendance/swap": lazyScreen(
    "me/swap",
    () => import("@/screens/me/swap"),
    (m) => framed(gated(m.Swap, "/me/attendance/swap"), "/me/attendance/swap")
  ),
  "/me/leave": lazyScreen(
    "me/leave",
    () => import("@/screens/me/leave"),
    (m) => framed(gated(m.Leave, "/me/leave"), "/me/leave")
  ),
  "/me/leave/new": lazyScreen(
    "me/leave-new",
    () => import("@/screens/me/leave-new"),
    (m) => framed(gated(m.LeaveNew, "/me/leave/new"), "/me/leave/new")
  ),
  "/me/overtime": lazyScreen(
    "me/overtime",
    () => import("@/screens/me/overtime"),
    (m) => framed(gated(m.Overtime, "/me/overtime"), "/me/overtime")
  ),
  "/me/pay": lazyScreen(
    "me/pay",
    () => import("@/screens/me/pay"),
    (m) => framed(gated(m.Pay, "/me/pay"), "/me/pay")
  ),
  "/me/pay/slip": lazyScreen(
    "me/payslip",
    () => import("@/screens/me/payslip"),
    (m) => framed(gated(m.Payslip, "/me/pay/slip"), "/me/pay/slip")
  ),
  "/me/pay/claims": lazyScreen(
    "me/claims",
    () => import("@/screens/me/claims"),
    (m) => framed(gated(m.Claims, "/me/pay/claims"), "/me/pay/claims")
  ),
  "/me/details": lazyScreen(
    "me/details",
    () => import("@/screens/me/details"),
    (m) => framed(m.Me, "/me/details")
  ),
}
