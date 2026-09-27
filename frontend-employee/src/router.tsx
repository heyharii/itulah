import {
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router"

import { AppShell } from "@/components/app-shell"
import { Attendance } from "@/screens/attendance"
import { Correction } from "@/screens/correction"
import { Home } from "@/screens/home"
import { Leave } from "@/screens/leave"
import { LeaveNew } from "@/screens/leave-new"
import { Me } from "@/screens/me"
import { Notifications } from "@/screens/notifications"
import { Overtime } from "@/screens/overtime"
import { Pay } from "@/screens/pay"
import { Payslip } from "@/screens/payslip"
import { Claims } from "@/screens/claims"
import { Swap } from "@/screens/swap"
import { Team } from "@/screens/team"
import { Voice } from "@/screens/voice"

/// Where the employee is, in the URL rather than in a variable.
///
/// Same reasoning as the buying surface next door, and one more that only
/// applies here: this is a phone. The browser's back gesture is how people
/// leave a screen, and a half-filled leave form that a back swipe dropped out
/// of the app entirely would be filled in twice.
///
/// The root renders the shell rather than a bare `Outlet`, so the tab bar and
/// the header are mounted once and do not flicker between screens — which on a
/// phone is the difference between an app and a website.
///
/// Code-based rather than file-based routes: ten routes do not need a codegen
/// step, and the tree reads in one screenful.
const rootRoute = createRootRoute({ component: AppShell })

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Home,
})

const leaveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/leave",
  component: Leave,
})

const leaveNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/leave/new",
  component: LeaveNew,
})

const attendanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/attendance",
  component: Attendance,
})

/// The day being disputed is in the path, so the request is about the row that
/// was tapped and can be linked to from a notification later.
const correctionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/attendance/correction/$date",
  component: Correction,
})

const overtimeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/overtime",
  component: Overtime,
})

/// Swapping a day lives in the Hours family: the person arrives from a
/// schedule they were reading.
const swapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/attendance/swap",
  component: Swap,
})

/// The store head's desk. Reachable from Home, only useful to somebody with
/// a queue; the screen says so when the queue is empty.
const teamRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/team",
  component: Team,
})

/// Claims: what you filed and the form for the next one. The Pay family.
const claimsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pay/claims",
  component: Claims,
})

/// The confidential channel, reached from Me.
const voiceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/me/voice",
  component: Voice,
})

const payRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pay",
  component: Pay,
})

const payslipRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pay/$payId",
  component: Payslip,
})

const notificationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/notifications",
  component: Notifications,
})

const meRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/me",
  component: Me,
})

const routeTree = rootRoute.addChildren([
  homeRoute,
  leaveRoute,
  leaveNewRoute,
  attendanceRoute,
  correctionRoute,
  overtimeRoute,
  swapRoute,
  teamRoute,
  claimsRoute,
  voiceRoute,
  payRoute,
  payslipRoute,
  notificationsRoute,
  meRoute,
])

export const router = createRouter({ routeTree })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
