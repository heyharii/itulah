import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Day } from "@/components/ui/day"
import { Field, Input, Textarea } from "@/components/ui/field"
import { PickOne } from "@/components/ui/pick"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { Banner, EmptyState } from "@/components/ui/states"
import { day } from "@/lib/format"
import {
  activeWarningLetters,
  issueWarningLetter,
  letterKeys,
  revokeWarningLetter,
  warningLetters,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { usePeopleAudience } from "@/screens/people/scope"
import type { WarningLetterView } from "@itulah/contract"

const LEVELS = [
  { value: "TEGURAN", label: "Reprimand (on record)" },
  { value: "SP1", label: "SP 1" },
  { value: "SP2", label: "SP 2" },
  { value: "SP3", label: "SP 3" },
]

const LEVEL_LABEL: Record<string, string> = {
  TEGURAN: "Reprimand",
  SP1: "SP 1",
  SP2: "SP 2",
  SP3: "SP 3",
}

function LetterState({ letter }: { letter: WarningLetterView }) {
  if (letter.revoked) return <Pill tone="neutral">Revoked</Pill>
  if (!letter.active) return <Pill tone="neutral">Lapsed</Pill>
  return (
    <Pill tone={letter.level === "SP3" ? "bad" : "warn"}>
      In force to {day(letter.valid_until)}
    </Pill>
  )
}

/// Teguran / SP on one person's sheet: the letters, each in force six months
/// (UU 13/2003 pasal 161), whether they acknowledged it from their phone, and
/// the form for the next one.
export function DisciplinePanel({ employeeId }: { employeeId: string }) {
  const client = useQueryClient()
  const letters = useQuery({
    queryKey: letterKeys.of(employeeId),
    queryFn: ({ signal }) => warningLetters(employeeId, signal),
  })
  const [level, setLevel] = useState<string | null>(null)
  const [issuedOn, setIssuedOn] = useState(() =>
    new Date().toISOString().slice(0, 10)
  )
  const [months, setMonths] = useState("6")
  const [violation, setViolation] = useState("")
  const [reason, setReason] = useState("")
  const [revokeWhy, setRevokeWhy] = useState("")
  const refresh = () => {
    void client.invalidateQueries({ queryKey: letterKeys.of(employeeId) })
    void client.invalidateQueries({ queryKey: letterKeys.active() })
  }
  const issue = useMutation({
    mutationFn: () =>
      issueWarningLetter(employeeId, {
        level: level ?? "",
        issued_on: issuedOn,
        valid_months: months.trim() === "" ? null : Number(months),
        violation: violation.trim(),
        reason: reason.trim(),
      }),
    onSuccess: () => {
      setLevel(null)
      setViolation("")
      setReason("")
      refresh()
    },
  })
  const revoke = useMutation({
    mutationFn: (id: string) => revokeWarningLetter(id, revokeWhy.trim()),
    onSuccess: () => {
      setRevokeWhy("")
      refresh()
    },
  })

  return (
    <div className="flex flex-col gap-4">
      {queryState(letters, {
        loading: "Reading the letters…",
        render: (rows) =>
          rows.length === 0 ? (
            <EmptyState>No warning on record.</EmptyState>
          ) : (
            <div className="flex flex-col gap-3">
              {rows.map((letter) => (
                <div
                  key={letter.id}
                  className="rounded-card border border-hairline p-3"
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="text-card-title font-semibold text-ink">
                      {LEVEL_LABEL[letter.level] ?? letter.level}
                    </span>
                    <span className="text-[0.875rem] text-mute">
                      {day(letter.issued_on)} · {letter.issued_by}
                    </span>
                    <LetterState letter={letter} />
                  </div>
                  <p className="text-[0.875rem] text-body">
                    {letter.violation}
                  </p>
                  <p className="mt-1 text-[0.875rem] text-mute">
                    {letter.acknowledged_at === null
                      ? "Not yet acknowledged by them."
                      : `Acknowledged ${day(letter.acknowledged_at)}.`}
                  </p>
                  {!letter.revoked && letter.active && (
                    <div className="mt-2">
                      <Button
                        variant="quiet"
                        disabled={revokeWhy.trim() === ""}
                        pending={revoke.isPending}
                        onClick={() => revoke.mutate(letter.id)}
                      >
                        Revoke
                      </Button>
                    </div>
                  )}
                </div>
              ))}
              <Field label="Why revoke one" aside="asked before Revoke">
                <Input
                  value={revokeWhy}
                  onChange={(e) => setRevokeWhy(e.target.value)}
                />
              </Field>
            </div>
          ),
      })}

      <div>
        <SubHead>Issue a letter</SubHead>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Level" required>
            <PickOne
              label="Level"
              choices={LEVELS}
              value={level}
              onChange={setLevel}
            />
          </Field>
          <Field label="Issued on" required>
            <Day value={issuedOn} onChange={setIssuedOn} />
          </Field>
          <Field label="In force for" aside="months, 1–12">
            <Input
              inputMode="numeric"
              value={months}
              onChange={(e) => setMonths(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <Field label="Why" required>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="What was done" required>
            <Textarea
              rows={3}
              value={violation}
              onChange={(e) => setViolation(e.target.value)}
            />
          </Field>
        </div>
        {(issue.error ?? revoke.error) !== null && (
          <Banner tone="bad" className="mt-2">
            {(issue.error ?? revoke.error)?.message}
          </Banner>
        )}
        <div className="mt-3">
          <Button
            variant="primary"
            pending={issue.isPending}
            disabled={
              level === null ||
              issuedOn === "" ||
              violation.trim() === "" ||
              reason.trim() === ""
            }
            onClick={() => issue.mutate()}
          >
            Issue letter
          </Button>
        </div>
      </div>
    </div>
  )
}

/// Every letter in force today, for head office — a manager is not shown it.
export function ActiveLettersCard() {
  const employer = usePeopleAudience() === "employer"
  const letters = useQuery({
    queryKey: letterKeys.active(),
    queryFn: ({ signal }) => activeWarningLetters(signal),
    enabled: employer,
  })
  if (!employer) return null
  return (
    <Card className="mb-4 overflow-hidden">
      <CardHeader>
        <CardTitle>Warning letters in force</CardTitle>
      </CardHeader>
      {queryState(letters, {
        loading: "Reading the letters…",
        render: (rows) =>
          rows.length === 0 ? (
            <EmptyState>No warning letter is in force.</EmptyState>
          ) : (
            <MiniTable head={["Who", "Letter", "In Force to", ""]}>
              {rows.map((letter) => (
                <MiniRow key={letter.id}>
                  <MiniCell>
                    <AppLink
                      to="/people"
                      sheet={{ key: "employee", value: letter.employee_id }}
                      className="text-ink hover:underline"
                    >
                      {letter.full_name ?? letter.employee_code}
                    </AppLink>
                  </MiniCell>
                  <MiniCell>
                    {LEVEL_LABEL[letter.level] ?? letter.level}
                  </MiniCell>
                  <MiniCell>{day(letter.valid_until)}</MiniCell>
                  <MiniCell>
                    {letter.acknowledged_at === null && (
                      <Pill tone="warn">Not acknowledged</Pill>
                    )}
                  </MiniCell>
                </MiniRow>
              ))}
            </MiniTable>
          ),
      })}
    </Card>
  )
}
