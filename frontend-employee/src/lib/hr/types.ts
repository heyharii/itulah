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

/// The employment profile now comes from the server.
///
/// It used to be declared here, and the shape written down was not the shape
/// that landed: this file guessed at `department`, `preferred_name`,
/// `manager_name` and `work_email`, none of which the employment record
/// actually holds, and it called the badge number `employee_number` where the
/// server calls it `employee_code`.
///
/// That is exactly what a hand-written wire type is for — a proposal to argue
/// with — and the argument is over. `EmploymentProfileView` is generated from
/// the Rust struct the server serialises, so the fields below are the fields
/// there are. The rest of this file is still a proposal, and goes the same way
/// as each route lands.
///
/// One thing worth knowing while reading the screens: the server has TWO
/// routes that sound like this one. `/profile` is who somebody is at work —
/// what this type carries. `/personal-data` is NIK, address and date of birth,
/// behind a grant most people do not hold. They are deliberately not the same
/// request.

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


/// The derived day now comes from the server, and this file no longer names it.
///
/// It used to declare an `AttendanceDay` with a `status` of PRESENT / LATE /
/// INCOMPLETE / ABSENT / LEAVE / HOLIDAY / REST, a `worked_minutes`, and a
/// `source` of KIOSK / RFID / MANUAL. Every one of those three guesses was
/// wrong in a way worth recording, because each of them is the sort of thing a
/// hand-written wire type gets wrong:
///
/// * **a day has no single status.** The server derives an outcome *set* —
///   `LATE` and `AGREED_OVERTIME` are both true of the same evening — and
///   contradictory ones are not representable. One field could not hold that,
///   so it would have had to pick, and the one it picked would be the one the
///   screen showed.
/// * **a day can be underivable**, and that is not an outcome. "No policy
///   covers this date" is a statement about the inputs and head office's to
///   fix; as a status it would read as something the employee did.
/// * **the sources were invented.** There was never a kiosk and never an RFID
///   punch. There are exactly two real ones — a registered fingerprint station,
///   and this app — and the difference between them is the difference between a
///   reading and a claim.
///
/// So the screens read `AttendanceRangeView`, `AttendanceDayView` and
/// `UnderivableDay` from `@itulah/contract`, generated from the structs the
/// server actually serialises. This is what the note at the top of the file
/// meant by these names becoming `contract/` files as each route lands.

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
