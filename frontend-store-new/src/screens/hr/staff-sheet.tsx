import { PeopleSheet, SheetSection } from "@/components/ui/people-sheet"
import { Pill } from "@/components/ui/pill"
import { label, toneFor } from "@/lib/format"
import { readCentidays, readDate } from "@/lib/queries/hr"
import type { useStaffReads } from "@/lib/queries/staff"
import { Facts } from "@/screens/hr/parts"
import { contractLine, hoursText } from "@/screens/hr/staff-words"
import type { EmployeeSummary } from "@itulah/contract"

/// One person of the shop, opened — the prototype's staff sheet: the job, the
/// leave they have left, the last seven days.
///
/// # What is not on it
///
/// **Pay.** Nowhere in a store: not on this sheet, not in the table behind it.
/// Pay is head office's, and a counter tablet is the last place it should be
/// read from.
///
/// **A warning letter, and the personal block** (phone, email, date of birth,
/// address). The prototype has both; the relay does not. Personal data is its
/// own route under its own grant (`/employees/{id}/personal-data`) that a till
/// is refused on purpose, and warning letters (SP) are not on the allowlist at
/// all. They come back the day head office opens a store-readable route for
/// them. **Reports to** and the prototype's *Staff / Supervisor* level are
/// missing for the same reason: the centre does not say who a person reports
/// to, and the rung is deliberately kept off a workforce read.
export function StaffSheet({
  person,
  reads,
  onClose,
}: {
  person: EmployeeSummary
  reads: ReturnType<typeof useStaffReads>
  onClose: () => void
}) {
  const profile = reads.profile(person.employee_id)
  const balances = reads.balances(person.employee_id)
  const recent = reads.recent(person.employee_id)
  // Still coming, or nothing that could have seen anybody: a dash either way.
  const seen = recent ?? null
  const name = person.full_name ?? person.employee_code
  const position = person.position ?? profile?.job_title ?? null

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={person.full_name ? person.employee_code : undefined}
      crumb="Staff"
      title={name}
      sub={position ?? undefined}
      status={<Pill tone={toneFor(person.status)}>{label(person.status)}</Pill>}
    >
      <SheetSection title="Job">
        <Facts
          rows={[
            [
              "Position",
              [position, profile?.grade].filter(Boolean).join(" · ") || "—",
            ],
            ["Posted to", profile?.unit_name ?? profile?.unit_id ?? "—"],
            [
              "Contract",
              contractLine(person.contract_kind, person.contract_ends_on),
            ],
            ["Joined", profile?.joined_on ? readDate(profile.joined_on) : "—"],
            [
              "Login",
              person.username === null ? (
                <span className="text-mute">None issued</span>
              ) : (
                <span className="font-mono">{person.username}</span>
              ),
            ],
          ]}
        />
      </SheetSection>

      <SheetSection title="Leave left">
        {balances === undefined ? (
          <p className="text-meta text-body">—</p>
        ) : balances.length === 0 ? (
          <p className="text-meta text-body">No leave balances yet.</p>
        ) : (
          <Facts
            rows={balances.map((row) => [
              row.name,
              `${readCentidays(row.centidays)} days${
                row.pending_centidays > 0
                  ? ` · ${readCentidays(row.pending_centidays)} asked for`
                  : ""
              }`,
            ])}
          />
        )}
      </SheetSection>

      <SheetSection title="Last 7 days">
        <Facts
          rows={[
            ["Worked", seen === null ? "—" : hoursText(seen.worked)],
            ["Late", seen === null ? "—" : `${seen.late}×`],
            ["Absent", seen === null ? "—" : `${seen.absent}×`],
          ]}
        />
        {recent === null && (
          <p className="mt-3 text-meta text-body">
            Not assessed — nothing has clocked this shop in yet.
          </p>
        )}
      </SheetSection>
    </PeopleSheet>
  )
}
