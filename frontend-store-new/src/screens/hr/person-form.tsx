import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { SheetSection } from "@/components/ui/people-sheet"
import { GENDERS, MARITAL, PAPER_KINDS, RELIGIONS } from "@/lib/queries/papers"
import { BLOOD_TYPES, type PersonalDraft } from "@/screens/hr/person-draft"
import type { EmployeeDetails } from "@itulah/contract"

/// The person's file as a form — the hub's *Edit* sheet (`employee-page.tsx`)
/// and *Add employee* (`add-employee.tsx`), one set of fields: **Personal ·
/// Family · Address on the KTP · Contact**, and the **Papers** that ride with
/// them.
///
/// A shop keys in what head office will check; nothing here writes the file.
/// *New Employee* sends it as the dossier of a hire proposal, *Change Data* as
/// a data update, and head office takes or refuses either.
///
/// `problems` is the red line under a field, by key, drawn when somebody has
/// pressed Send on a form that is not right yet.
export function PersonalFields({
  draft,
  onDraft,
  problems = {},
  strict = false,
}: {
  draft: PersonalDraft
  onDraft: (next: PersonalDraft) => void
  problems?: Readonly<Record<string, string>>
  /// The card's own fields are asked for, not offered: a new employee has no
  /// file to start from. A change leaves them optional until the detail set
  /// itself changes.
  strict?: boolean
}) {
  const d = draft.details
  const set = <K extends keyof PersonalDraft>(
    key: K,
    value: PersonalDraft[K],
  ) => onDraft({ ...draft, [key]: value })
  const detail = <K extends keyof EmployeeDetails>(
    key: K,
    value: EmployeeDetails[K],
  ) => onDraft({ ...draft, details: { ...draft.details, [key]: value } })
  /// A blank optional is none, not an empty string.
  const text = (key: keyof EmployeeDetails) => (value: string) =>
    detail(key, (value === "" ? null : value) as never)

  return (
    <>
      <SheetSection title="Personal">
        <div className="flex flex-col gap-3">
          <Field label="Full Name" required problem={problems.full_name}>
            <Input
              value={draft.full_name}
              placeholder="As on the ID card"
              autoComplete="off"
              onChange={(event) => set("full_name", event.target.value)}
            />
          </Field>
          <Field label="NIK" required={strict} problem={problems.nik}>
            <Input
              keyboard
              inputMode="numeric"
              value={draft.nik}
              onChange={(event) => set("nik", event.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            <Field
              label="Place of Birth"
              required={strict}
              problem={problems.birth_place}
            >
              <Input
                value={d.birth_place}
                onChange={(event) => detail("birth_place", event.target.value)}
              />
            </Field>
            <Field
              label="Date of Birth"
              required={strict}
              problem={problems.birth_date}
            >
              <Input
                type="date"
                value={draft.birth_date}
                onChange={(event) => set("birth_date", event.target.value)}
              />
            </Field>
            <Field label="Gender" required={strict} problem={problems.gender}>
              <Select
                value={d.gender}
                onChange={(value) => detail("gender", value)}
              >
                <option value="">Choose…</option>
                {GENDERS.map((one) => (
                  <option key={one.value} value={one.value}>
                    {one.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Religion"
              required={strict}
              problem={problems.religion}
            >
              <Select
                value={d.religion}
                onChange={(value) => detail("religion", value)}
              >
                <option value="">Choose…</option>
                {RELIGIONS.map((one) => (
                  <option key={one.value} value={one.value}>
                    {one.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Blood Type">
              <Select
                value={d.blood_type ?? ""}
                onChange={(value) => detail("blood_type", value || null)}
              >
                <option value="">Not on the card</option>
                {BLOOD_TYPES.map((one) => (
                  <option key={one} value={one}>
                    {one}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Nationality">
              <Select
                value={d.nationality}
                onChange={(value) => detail("nationality", value)}
              >
                <option value="WNI">WNI</option>
                <option value="WNA">WNA</option>
              </Select>
            </Field>
          </div>
        </div>
      </SheetSection>

      <SheetSection title="Family">
        <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          <Field
            label="Marital Status"
            required={strict}
            problem={problems.marital_status}
          >
            <Select
              value={d.marital_status}
              onChange={(value) => detail("marital_status", value)}
            >
              <option value="">Choose…</option>
              {MARITAL.map((one) => (
                <option key={one.value} value={one.value}>
                  {one.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Children">
            <Select
              value={String(d.children)}
              onChange={(value) => detail("children", Number(value))}
            >
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </SheetSection>

      <SheetSection title="Address on the KTP">
        <div className="flex flex-col gap-3">
          <Field label="Street" required={strict} problem={problems.address}>
            <Textarea
              rows={2}
              value={draft.address}
              onChange={(event) => set("address", event.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            <Field label="RT/RW">
              <Input
                value={d.rt_rw ?? ""}
                onChange={(event) => text("rt_rw")(event.target.value)}
              />
            </Field>
            <Field label="Village">
              <Input
                value={d.village ?? ""}
                onChange={(event) => text("village")(event.target.value)}
              />
            </Field>
            <Field label="District">
              <Input
                value={d.district ?? ""}
                onChange={(event) => text("district")(event.target.value)}
              />
            </Field>
            <Field label="City">
              <Input
                value={d.city ?? ""}
                onChange={(event) => text("city")(event.target.value)}
              />
            </Field>
            <Field label="Province">
              <Input
                value={d.province ?? ""}
                onChange={(event) => text("province")(event.target.value)}
              />
            </Field>
          </div>
        </div>
      </SheetSection>

      <SheetSection title="Contact">
        <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          <Field label="Phone" problem={problems.phone}>
            <Input
              inputMode="tel"
              value={draft.phone}
              onChange={(event) => set("phone", event.target.value)}
            />
          </Field>
          <Field label="Email" problem={problems.email}>
            <Input
              inputMode="email"
              value={draft.email}
              onChange={(event) => set("email", event.target.value)}
            />
          </Field>
          <Field label="Emergency Contact" problem={problems.emergency}>
            <Input
              value={d.emergency_name ?? ""}
              onChange={(event) => text("emergency_name")(event.target.value)}
            />
          </Field>
          <Field label="Relation">
            <Input
              value={d.emergency_relation ?? ""}
              onChange={(event) =>
                text("emergency_relation")(event.target.value)
              }
            />
          </Field>
          <Field label="Their Phone">
            <Input
              inputMode="tel"
              value={d.emergency_phone ?? ""}
              onChange={(event) => text("emergency_phone")(event.target.value)}
            />
          </Field>
        </div>
      </SheetSection>
    </>
  )
}

/// The scans that ride with a filing. `strict` marks the two head office
/// insists on (KTP and KK) and draws their red line when one is missing.
export function PapersFields({
  draft,
  onDraft,
  problems = {},
  strict = false,
}: {
  draft: PersonalDraft
  onDraft: (next: PersonalDraft) => void
  problems?: Readonly<Record<string, string>>
  strict?: boolean
}) {
  return (
    <SheetSection title="Papers">
      <div className="flex flex-col gap-3">
        {PAPER_KINDS.map((kind) => (
          <Field
            key={kind.kind}
            label={kind.label}
            required={strict && kind.required}
            problem={problems[`paper_${kind.kind}`]}
          >
            <input
              type="file"
              accept={kind.accept}
              className="text-[0.9375rem] text-body file:mr-3 file:rounded-inner file:border file:border-hairline-2 file:bg-canvas file:px-3 file:py-1.5 file:text-[0.9375rem] file:text-ink"
              onChange={(event) =>
                onDraft({
                  ...draft,
                  papers: {
                    ...draft.papers,
                    [kind.kind]: event.target.files?.[0],
                  },
                })
              }
            />
          </Field>
        ))}
      </div>
    </SheetSection>
  )
}
