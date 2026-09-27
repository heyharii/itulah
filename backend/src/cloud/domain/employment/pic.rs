//! Who may be put in charge of a unit.
//!
//! Every unit has a PIC — the one person answerable for it, with an
//! effective-dated history (0602, `unit_pic`). The appointment itself is a row;
//! the rule for who may hold it is here, in one function, because it is the
//! same rule whoever asks: the hub setting a store's manager, a backfill, the
//! next route somebody adds. The database checks it again in a trigger for the
//! writers that never come through here.
//!
//! The rule is two facts about the person on the day the appointment starts:
//!
//! * **employed** — [`EmploymentStatus::is_selectable`], the question the rest
//!   of the system asks before giving somebody new work. A candidate who has
//!   not started, a suspended manager and a leaver are all refused;
//! * **posted at that unit** — on that very day, by the posting timeline. A
//!   store answered for by somebody who works at another store is the mistake
//!   this exists to prevent, and it is also what keeps a PIC's reach inside
//!   their own unit: reach is read off the posting (see `reach`).
//!
//! [`EmploymentStatus::is_selectable`]: super::EmploymentStatus::is_selectable

use super::assignment::AssignmentTimeline;
use super::employee::Employee;
use super::error::EmployeeError;
use super::ids::UnitId;
use chrono::NaiveDate;

/// May this person be appointed PIC of `unit` from `from`?
pub fn require_pic_eligible(
    employee: &Employee,
    postings: &AssignmentTimeline,
    unit: &UnitId,
    from: NaiveDate,
) -> Result<(), EmployeeError> {
    let status = employee.status();
    if !status.is_selectable() {
        return Err(EmployeeError::PicNotEmployed {
            status: status.code(),
        });
    }
    if postings.unit_on(from) != Some(unit) {
        return Err(EmployeeError::PicNotPostedAtUnit {
            unit: unit.to_string(),
            on: from,
        });
    }
    Ok(())
}
