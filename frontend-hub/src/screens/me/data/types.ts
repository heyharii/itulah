/// The few shapes these screens read that are not the wire itself.
///
/// Every request and response is typed from `@itulah/contract`, generated
/// from the Rust struct the server actually serialises. What is left here is
/// the handful of *view* shapes `api.ts` adapts a response into, because the
/// screens want it in a form the wire deliberately is not — never a second
/// hand-written copy of a wire type, which is exactly the drift
/// `make contract-check` exists to prevent.
///
/// Two conventions carried over from the rest of the system: money is a whole
/// number of rupiah, and a plain date is `YYYY-MM-DD` in the site's own
/// timezone, while an instant is RFC 3339 with an offset.

import type { HolidayView } from "@itulah/contract"

export type IsoDate = string
export type IsoInstant = string

/// A correction as this person's own list reads one — the queue's
/// `CorrectionRow`, narrowed to what the filer needs.
export interface AttendanceCorrection {
  readonly correction_id: string
  readonly date: IsoDate
  readonly claimed_in: string | null
  readonly claimed_out: string | null
  readonly reason: string
  readonly status: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN"
  readonly decided_by: string | null
  readonly decided_at: IsoInstant | null
}

export interface NewAttendanceCorrection {
  readonly date: IsoDate
  readonly claimed_in: string | null
  readonly claimed_out: string | null
  readonly reason: string
}

/// One year's days off that apply at this person's place. `HolidayView` is
/// the server's; only the regional days for other places have been dropped.
/// `consumes_annual_leave` marks *cuti bersama*: a national day off that is
/// deducted from annual leave, and neither an ordinary holiday nor ordinary
/// leave.
export interface HolidayCalendar {
  readonly year: number
  readonly days: readonly HolidayView[]
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
