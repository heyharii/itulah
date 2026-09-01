/// The employee's half of the wire, written here rather than generated.
///
/// Every other type this browser sends or receives comes from
/// `@itulah/contract`, generated from the Rust struct the server actually
/// serialises. These cannot be: the server has no HR routes yet — no
/// `/api/v1/employees`, no leave, no attendance, no payroll — so there is no
/// struct to generate from.
///
/// So this file is a proposal, not a record. It is the shape the phone app
/// already asks for, and the shape these screens are built against. When the
/// Rust side lands, these names become `contract/` files and this file is
/// deleted rather than kept in parallel — a second hand-written copy of the
/// wire is exactly the drift that `make contract-check` exists to prevent.
///
/// Two conventions carried over from the rest of the system: money is a whole
/// number of rupiah (no minor unit — Indonesia does not use sen), and a plain
/// date is `YYYY-MM-DD` in the site's own timezone, while an instant is RFC
/// 3339 with an offset. A payslip period is a date; a notification is an
/// instant.

export type IsoDate = string
export type IsoInstant = string

/// Who the person is, as HR holds them.
///
/// `employee_id` is not the `app_user` id. One person can lose and regain a
/// login, and a contractor can exist in HR before any login is issued — the
/// two identities are joined, not merged. The join is what `/employees/me`
/// answers.
export interface EmployeeProfile {
  readonly employee_id: string
  readonly employee_number: string
  readonly full_name: string
  readonly preferred_name: string
  readonly job_title: string
  readonly department: string
  readonly place_id: string
  readonly place_name: string
  readonly manager_name: string | null
  readonly joined_on: IsoDate
  readonly status: "ACTIVE" | "ON_LEAVE" | "SUSPENDED" | "EXITED"
  readonly work_email: string | null
  readonly phone: string | null
}

/// The contract the person is working under.
///
/// Indonesian employment law makes the distinction load-bearing rather than
/// decorative: a PKWT is fixed-term and has an end date, a PKWTT does not, and
/// which one you are on decides notice, severance and whether an end date
/// approaching is news. A screen that showed "contract" as one word would hide
/// the only part anybody checks.
export interface EmploymentContract {
  readonly contract_id: string
  readonly kind: "PKWT" | "PKWTT" | "PROBATION" | "INTERNSHIP"
  readonly started_on: IsoDate
  readonly ends_on: IsoDate | null
  readonly weekly_hours: number
  readonly place_name: string
  readonly signed_on: IsoDate | null
}

/// The identifiers payroll needs, as the employee should see them.
///
/// Bank account arrives already masked from the server. Not a display choice
/// made here: an unmasked account number that reached the browser would be in
/// a response body, a cache and a screenshot, and this screen exists so
/// somebody can check the last four digits are theirs, which the mask leaves
/// intact.
export interface PayrollIdentity {
  readonly npwp: string | null
  readonly bpjs_kesehatan: string | null
  readonly bpjs_ketenagakerjaan: string | null
  readonly bank_name: string | null
  readonly bank_account_masked: string | null
  readonly account_holder: string | null
  readonly ptkp_status: string | null
}

export interface PayLine {
  readonly label: string
  readonly kind: "EARNING" | "DEDUCTION"
  readonly amount_idr: number
}

/// One payslip.
///
/// `net_idr` is sent rather than derived from the lines. The server's total is
/// the one that was actually paid into the bank, and a browser that recomputed
/// it would eventually disagree with a bank statement over a rounding rule it
/// invented.
export interface PaySlip {
  readonly pay_id: string
  readonly period_start: IsoDate
  readonly period_end: IsoDate
  readonly paid_on: IsoDate | null
  readonly gross_idr: number
  readonly deductions_idr: number
  readonly net_idr: number
  readonly lines: readonly PayLine[]
}

/// A kind of leave, with this person's own balance already applied.
///
/// The balance travels with the type because they are only ever read
/// together: "annual leave" without "you have 6 days left" is not an answer to
/// anything anybody opens this screen to ask.
export interface LeaveType {
  readonly leave_type_id: string
  readonly name: string
  readonly paid: boolean
  readonly requires_document: boolean
  readonly entitled_days: number
  readonly taken_days: number
  readonly pending_days: number
  readonly remaining_days: number
  /// Annual leave expires; sick leave does not. Null means it does not.
  readonly expires_on: IsoDate | null
}

export type LeaveStatus =
  "SUBMITTED" | "APPROVED" | "REJECTED" | "CANCELLED" | "TAKEN"

export interface LeaveRequest {
  readonly request_id: string
  readonly leave_type_id: string
  readonly leave_type_name: string
  readonly from_date: IsoDate
  readonly to_date: IsoDate
  /// Working days, counted by the server against the site's holiday calendar.
  /// A browser counting weekends would get the joint leave days wrong.
  readonly days: number
  readonly reason: string
  readonly status: LeaveStatus
  readonly submitted_at: IsoInstant
  readonly decided_by: string | null
  readonly decided_at: IsoInstant | null
  readonly decision_note: string | null
}

export interface NewLeaveRequest {
  readonly leave_type_id: string
  readonly from_date: IsoDate
  readonly to_date: IsoDate
  readonly reason: string
}

/// Overtime the employee was *ordered* to work.
///
/// Ordered, not claimed: an order is issued by a supervisor and the employee
/// acknowledges it. That direction is the law's — overtime is instructed and
/// consented to — and it is why this screen has an "Acknowledge" button and no
/// "Add overtime" one.
export interface OvertimeOrder {
  readonly order_id: string
  readonly date: IsoDate
  readonly planned_from: string
  readonly planned_to: string
  readonly hours: number
  readonly reason: string
  readonly ordered_by: string
  readonly status: "ORDERED" | "ACKNOWLEDGED" | "DECLINED" | "WORKED"
  readonly acknowledged_at: IsoInstant | null
}

export type AttendanceStatus =
  "PRESENT" | "LATE" | "INCOMPLETE" | "ABSENT" | "LEAVE" | "HOLIDAY" | "REST"

/// One day, as attendance has it.
///
/// Called "basis" by the phone app because it is the basis payroll works from,
/// not a raw clock log: the day already carries its schedule, its leave and
/// its holiday, so a missing punch on a public holiday reads as a holiday
/// rather than an absence.
export interface AttendanceDay {
  readonly date: IsoDate
  readonly status: AttendanceStatus
  readonly scheduled_from: string | null
  readonly scheduled_to: string | null
  readonly first_in: IsoInstant | null
  readonly last_out: IsoInstant | null
  readonly worked_minutes: number
  readonly late_minutes: number
  readonly place_name: string | null
  readonly source: "KIOSK" | "RFID" | "MANUAL" | null
  /// True when a correction for this day is already waiting on a decision, so
  /// the screen offers to show it rather than to file a second one.
  readonly correction_pending: boolean
}

export interface AttendanceCorrection {
  readonly correction_id: string
  readonly date: IsoDate
  readonly claimed_in: string | null
  readonly claimed_out: string | null
  readonly reason: string
  readonly status: "SUBMITTED" | "APPROVED" | "REJECTED"
  readonly decided_by: string | null
  readonly decided_at: IsoInstant | null
}

export interface NewAttendanceCorrection {
  readonly date: IsoDate
  readonly claimed_in: string | null
  readonly claimed_out: string | null
  readonly reason: string
}

export interface Holiday {
  readonly date: IsoDate
  readonly name: string
  /// `JOINT_LEAVE` is *cuti bersama*: a national day off that is deducted from
  /// annual leave. It is neither an ordinary holiday nor ordinary leave, and
  /// showing it as either would misstate somebody's balance.
  readonly kind: "NATIONAL" | "COMPANY" | "JOINT_LEAVE"
}

export interface HolidayCalendar {
  readonly calendar_id: string
  readonly name: string
  readonly year: number
  readonly days: readonly Holiday[]
}

export interface Notification {
  readonly notification_id: string
  readonly kind: "LEAVE" | "OVERTIME" | "PAY" | "ATTENDANCE" | "GENERAL"
  readonly subject: string
  readonly body: string
  readonly created_at: IsoInstant
  readonly read_at: IsoInstant | null
  /// Where reading it should take you, as a route in this app.
  readonly link: string | null
}

/// A signed-in browser or phone, as the server holds it.
///
/// `auth_session` already stores exactly this (see migration 0015); the route
/// to read your own is what is missing. Being able to see and end a session on
/// a device you no longer have is the point.
export interface DeviceSession {
  readonly session_id: string
  readonly created_at: IsoInstant
  readonly last_seen_at: IsoInstant
  readonly expires_at: IsoInstant
  readonly current: boolean
  readonly user_agent: string | null
}
