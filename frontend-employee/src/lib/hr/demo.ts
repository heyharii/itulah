import { longDate } from "@/lib/format"
import type {
  AttendanceCorrection,
  AttendanceDay,
  DeviceSession,
  EmployeeProfile,
  EmploymentContract,
  HolidayCalendar,
  IsoDate,
  LeaveRequest,
  LeaveType,
  Notification,
  OvertimeOrder,
  PayrollIdentity,
  PaySlip,
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

export const demoProfile: EmployeeProfile = {
  employee_id: "emp_01H8Q",
  employee_number: "IT-0142",
  full_name: "Siti Rahmawati",
  preferred_name: "Siti",
  job_title: "Senior Sales Associate",
  department: "Retail Operations",
  place_id: "store-1",
  place_name: "Itulah Kemang",
  manager_name: "Bagus Prakoso",
  joined_on: "2023-02-13",
  status: "ACTIVE",
  work_email: "siti.rahmawati@itulah.example",
  phone: "+62 812-1000-0142",
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

export const demoPayrollIdentity: PayrollIdentity = {
  npwp: "09.254.***.*-***.000",
  bpjs_kesehatan: "0001****4471",
  bpjs_ketenagakerjaan: "23****8810",
  bank_name: "Bank Mandiri",
  bank_account_masked: "•••• •••• 4417",
  account_holder: "SITI RAHMAWATI",
  ptkp_status: "TK/0",
}

export const demoPaySlips: readonly PaySlip[] = [
  {
    pay_id: "pay_2026_08",
    period_start: dayOffset(-32),
    period_end: dayOffset(-2),
    paid_on: dayOffset(-1),
    gross_idr: 7_450_000,
    deductions_idr: 612_500,
    net_idr: 6_837_500,
    lines: [
      { label: "Base salary", kind: "EARNING", amount_idr: 6_200_000 },
      { label: "Attendance allowance", kind: "EARNING", amount_idr: 450_000 },
      { label: "Overtime (6.5 h)", kind: "EARNING", amount_idr: 500_000 },
      { label: "Sales incentive", kind: "EARNING", amount_idr: 300_000 },
      { label: "BPJS Kesehatan (1%)", kind: "DEDUCTION", amount_idr: 74_500 },
      { label: "BPJS JHT (2%)", kind: "DEDUCTION", amount_idr: 149_000 },
      { label: "BPJS JP (1%)", kind: "DEDUCTION", amount_idr: 74_500 },
      { label: "PPh 21", kind: "DEDUCTION", amount_idr: 314_500 },
    ],
  },
  {
    pay_id: "pay_2026_07",
    period_start: dayOffset(-63),
    period_end: dayOffset(-33),
    paid_on: dayOffset(-32),
    gross_idr: 7_100_000,
    deductions_idr: 583_000,
    net_idr: 6_517_000,
    lines: [
      { label: "Base salary", kind: "EARNING", amount_idr: 6_200_000 },
      { label: "Attendance allowance", kind: "EARNING", amount_idr: 450_000 },
      { label: "Sales incentive", kind: "EARNING", amount_idr: 450_000 },
      { label: "BPJS Kesehatan (1%)", kind: "DEDUCTION", amount_idr: 71_000 },
      { label: "BPJS JHT (2%)", kind: "DEDUCTION", amount_idr: 142_000 },
      { label: "BPJS JP (1%)", kind: "DEDUCTION", amount_idr: 71_000 },
      { label: "PPh 21", kind: "DEDUCTION", amount_idr: 299_000 },
    ],
  },
]

export const demoLeaveTypes: LeaveType[] = [
  {
    leave_type_id: "annual",
    name: "Annual leave",
    paid: true,
    requires_document: false,
    entitled_days: 12,
    taken_days: 5,
    pending_days: 0,
    remaining_days: 7,
    expires_on: `${today().getFullYear()}-12-31`,
  },
  {
    leave_type_id: "sick",
    name: "Sick leave",
    paid: true,
    requires_document: true,
    entitled_days: 14,
    taken_days: 2,
    pending_days: 0,
    remaining_days: 12,
    expires_on: null,
  },
  {
    leave_type_id: "unpaid",
    name: "Unpaid leave",
    paid: false,
    requires_document: false,
    entitled_days: 0,
    taken_days: 0,
    pending_days: 0,
    remaining_days: 0,
    expires_on: null,
  },
]

export const demoLeaveRequests: LeaveRequest[] = [
  {
    request_id: "lv_0031",
    leave_type_id: "annual",
    leave_type_name: "Annual leave",
    from_date: dayOffset(21),
    to_date: dayOffset(23),
    days: 3,
    reason: "Family wedding in Solo.",
    status: "SUBMITTED",
    submitted_at: instantOffset(-3, 10, 12),
    decided_by: null,
    decided_at: null,
    decision_note: null,
  },
  {
    request_id: "lv_0027",
    leave_type_id: "sick",
    leave_type_name: "Sick leave",
    from_date: dayOffset(-19),
    to_date: dayOffset(-18),
    days: 2,
    reason: "Fever, clinic note attached.",
    status: "TAKEN",
    submitted_at: instantOffset(-20, 7, 40),
    decided_by: "Bagus Prakoso",
    decided_at: instantOffset(-20, 8, 15),
    decision_note: null,
  },
  {
    request_id: "lv_0022",
    leave_type_id: "annual",
    leave_type_name: "Annual leave",
    from_date: dayOffset(-44),
    to_date: dayOffset(-44),
    days: 1,
    reason: "Personal errand.",
    status: "REJECTED",
    submitted_at: instantOffset(-47, 16, 5),
    decided_by: "Bagus Prakoso",
    decided_at: instantOffset(-46, 9, 30),
    decision_note: "Stocktake day — please pick another date.",
  },
]

export const demoOvertimeOrders: OvertimeOrder[] = [
  {
    order_id: "ot_0114",
    date: dayOffset(2),
    planned_from: "18:00",
    planned_to: "21:00",
    hours: 3,
    reason: "New season floor set.",
    ordered_by: "Bagus Prakoso",
    status: "ORDERED",
    acknowledged_at: null,
  },
  {
    order_id: "ot_0109",
    date: dayOffset(-6),
    planned_from: "18:00",
    planned_to: "20:30",
    hours: 2.5,
    reason: "Stock count.",
    ordered_by: "Bagus Prakoso",
    status: "WORKED",
    acknowledged_at: instantOffset(-8, 11, 2),
  },
]

/// Fourteen days back from today, with the shape of a real fortnight in it:
/// a rest day a week, one late morning, one missing clock-out, one national
/// holiday.
export const demoAttendance: AttendanceDay[] = Array.from(
  { length: 14 },
  (_, index) => {
    const back = 13 - index
    const date = new Date(today().getTime() - back * MS_DAY)
    const weekday = date.getDay()
    const day = isoDate(date)

    if (weekday === 1) {
      return {
        date: day,
        status: "REST",
        scheduled_from: null,
        scheduled_to: null,
        first_in: null,
        last_out: null,
        worked_minutes: 0,
        late_minutes: 0,
        place_name: null,
        source: null,
        correction_pending: false,
      } satisfies AttendanceDay
    }

    const common = {
      date: day,
      scheduled_from: "09:00",
      scheduled_to: "18:00",
      place_name: "Itulah Kemang",
      source: "KIOSK",
    } as const

    if (back === 4) {
      return {
        ...common,
        status: "INCOMPLETE",
        first_in: instantOffset(-back, 8, 56),
        last_out: null,
        worked_minutes: 0,
        late_minutes: 0,
        correction_pending: false,
      } satisfies AttendanceDay
    }
    if (back === 8) {
      return {
        ...common,
        status: "LATE",
        first_in: instantOffset(-back, 9, 34),
        last_out: instantOffset(-back, 18, 6),
        worked_minutes: 512,
        late_minutes: 34,
        correction_pending: false,
      } satisfies AttendanceDay
    }
    return {
      ...common,
      status: "PRESENT",
      first_in: instantOffset(-back, 8, 52),
      last_out: instantOffset(-back, 18, 4),
      worked_minutes: 552,
      late_minutes: 0,
      correction_pending: false,
    } satisfies AttendanceDay
  }
)

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
