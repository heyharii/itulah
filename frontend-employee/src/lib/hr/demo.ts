import { longDate } from "@/lib/format"
import type { EmploymentProfileView } from "@itulah/contract"
import type {
  AttendanceCorrection,
  DeviceSession,
  EmploymentContract,
  HolidayCalendar,
  IsoDate,
  Notification,
} from "./types"

/// A stand-in employee, for the days before the server has one.
///
/// This exists because the HR routes do not, and a set of screens with nothing
/// behind them cannot be reviewed, laid out or argued with. It is deliberately
/// one person's plausible year — a leave request that was refused, a day with
/// a missing clock-out, a payslip with a real deduction — rather than tidy
/// placeholder rows, because the awkward cases are the ones the layout has to
/// survive.
///
/// It is reached only when the server answers 404 for the route, so it cannot
/// quietly stand in for a real answer: the moment the backend grows the route,
/// nothing here is read again. `api.ts` says so on the screen while it is
/// being used, and this file goes when the route lands.

const MS_DAY = 86_400_000

function today(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

/// `YYYY-MM-DD` in local time.
///
/// Not `toISOString().slice(0, 10)`, which converts to UTC first and so hands
/// back yesterday for anybody east of Greenwich — which is everybody using
/// this.
export function isoDate(date: Date): IsoDate {
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

function dayOffset(days: number): IsoDate {
  return isoDate(new Date(today().getTime() + days * MS_DAY))
}

function instantOffset(days: number, hour = 9, minute = 0): string {
  const at = new Date(today().getTime() + days * MS_DAY)
  at.setHours(hour, minute, 0, 0)
  return at.toISOString()
}

export const demoProfile: EmploymentProfileView = {
  employee_id: "emp_01H8Q",
  employee_code: "IT-0142",
  full_name: "Siti Rahmawati",
  status: "ACTIVE",
  job_title: "Senior Sales Associate",
  grade: "G2",
  place_id: "store-1",
  place_name: "Itulah Kemang",
  joined_on: "2023-02-13",
}


export const demoContract: EmploymentContract = {
  contract_id: "ctr_2026_02",
  kind: "PKWT",
  started_on: "2026-02-13",
  ends_on: "2027-02-12",
  weekly_hours: 40,
  place_name: "Itulah Kemang",
  signed_on: "2026-02-06",
}



/// The fortnight used to be here, and it is gone.
///
/// `/api/v1/employees/{id}/attendance` exists, so the screens read it. A
/// stand-in kept behind a live route is how a wrong shape reaches a render — it
/// never fires when the route answers, and it rots silently until the day it
/// does fire and shows somebody a fortnight nobody worked.
export const demoCorrections: AttendanceCorrection[] = []

export const demoHolidays: HolidayCalendar = {
  calendar_id: "id-national",
  name: "Indonesia — national",
  year: today().getFullYear(),
  days: [
    { date: dayOffset(12), name: "Maulid Nabi Muhammad", kind: "NATIONAL" },
    { date: dayOffset(41), name: "Company anniversary", kind: "COMPANY" },
    { date: dayOffset(96), name: "Hari Natal", kind: "NATIONAL" },
    { date: dayOffset(97), name: "Cuti bersama Natal", kind: "JOINT_LEAVE" },
  ],
}

export const demoNotifications: Notification[] = [
  {
    notification_id: "ntf_0091",
    kind: "OVERTIME",
    subject: `Overtime order for ${longDate(dayOffset(2))}`,
    body: "Bagus Prakoso ordered 3 hours of overtime for the new season floor set. Please acknowledge.",
    created_at: instantOffset(-1, 17, 20),
    read_at: null,
    link: "/overtime",
  },
  {
    notification_id: "ntf_0088",
    kind: "PAY",
    subject: "Payslip available",
    body: "Your payslip for last period has been released.",
    created_at: instantOffset(-1, 9, 0),
    read_at: null,
    link: "/pay",
  },
  {
    notification_id: "ntf_0081",
    kind: "LEAVE",
    subject: "Leave request submitted",
    body: "Your annual leave request is waiting on Bagus Prakoso.",
    created_at: instantOffset(-3, 10, 12),
    read_at: instantOffset(-3, 12, 0),
    link: "/leave",
  },
]

export const demoSessions: DeviceSession[] = [
  {
    session_id: "ses_current",
    created_at: instantOffset(0, 7, 55),
    last_seen_at: new Date().toISOString(),
    expires_at: instantOffset(7, 7, 55),
    current: true,
    user_agent: "This device",
  },
  {
    session_id: "ses_kiosk",
    created_at: instantOffset(-5, 8, 2),
    last_seen_at: instantOffset(-5, 18, 10),
    expires_at: instantOffset(2, 8, 2),
    current: false,
    user_agent: "Kiosk — Itulah Kemang",
  },
]

/// The next id for something created on this device, which only has to be
/// unique among the handful of rows this demo holds.
let sequence = 1
export function demoId(prefix: string): string {
  sequence += 1
  return `${prefix}_local_${sequence}`
}
