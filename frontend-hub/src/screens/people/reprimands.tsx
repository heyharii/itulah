import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { useState, Suspense } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { useLayout } from "@/lib/layout"
import { Fab } from "@/components/ui/fab"
import { DockChoice } from "@/components/shell/dock-tools"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Day } from "@/components/ui/day"
import { Field, Input, Textarea } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { PickOne } from "@/components/ui/pick"
import { Pill, Status } from "@/components/ui/pill"
import { KeyValue, MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { EmptyState, LoadingState, Problem } from "@/components/ui/states"
import { count, day } from "@/lib/format"
import {
  hrEmployeeKeys,
  LETTER_LEVEL_LABEL,
  allWarningLettersQuery,
  useNameOfLogin,
} from "@/lib/queries/hr-employees"
import {
  issueWarningLetter,
  letterKeys,
  revokeWarningLetter,
} from "@/lib/queries/people"
import { useCanWrite } from "@/lib/session"
import { EmployeePick } from "@/screens/people/employee-pick"
import {
  CardButton,
  CardFigure,
  CardName,
  PhoneCards,
} from "@/components/ui/phone-cards"
import type { WarningLetterView } from "@itulah/contract"

type Slice = "ACTIVE" | "ALL"

const LEVELS = [
  { value: "TEGURAN", label: "Reprimand (on record)" },
  { value: "SP1", label: "SP 1" },
  { value: "SP2", label: "SP 2" },
  { value: "SP3", label: "SP 3" },
]

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/// Where a letter stands, as a tone and a word.
function letterState(letter: WarningLetterView): {
  tone: "neutral" | "warn" | "bad"
  label: string
} {
  if (letter.revoked) return { tone: "neutral", label: "Revoked" }
  if (!letter.active) return { tone: "neutral", label: "Lapsed" }
  return { tone: letter.level === "SP3" ? "bad" : "warn", label: "In force" }
}

/// Every warning letter ever issued — teguran and SP 1 to 3 — whether still in
/// force, lapsed or revoked. A letter is in force six months by default
/// (UU 13/2003 pasal 161), and what the person did is on the letter itself.
export function Reprimands() {
  const canWrite = useCanWrite()
  const phone = useLayout() === "phone"
  const [slice, setSlice] = useState<Slice>("ACTIVE")
  const [openId, setOpenId] = useState<string | null>(null)
  const [issuing, setIssuing] = useState(false)

  return (
    <PageContent>
      <PageHeader
        title="Reprimands"
        actions={
          !phone &&
          canWrite && (
            <Button variant="primary" onClick={() => setIssuing(true)}>
              Issue letter
            </Button>
          )
        }
      />

      {/* On a phone the slice is the chip over the bottom bar and issuing a
          letter is the round +. */}
      {phone ? (
        <>
          <DockChoice
            value={slice}
            onChange={(next) => setSlice(next as Slice)}
            options={[
              { value: "ACTIVE", label: "In force", short: "In force" },
              { value: "ALL", label: "All", short: "All" },
            ]}
          />
          {canWrite && (
            <Fab label="Issue letter" onClick={() => setIssuing(true)} />
          )}
        </>
      ) : (
        <Toolbar>
          <Segmented<Slice>
            options={[
              { value: "ACTIVE", label: "In force" },
              { value: "ALL", label: "All" },
            ]}
            value={slice}
            onChange={setSlice}
          />
          <Toolbar.Spacer />
          <Suspense fallback={null}>
            <LetterCount slice={slice} />
          </Suspense>
        </Toolbar>
      )}

      <Card className="overflow-hidden px-4 py-3 max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:p-0 max-md:shadow-none">
        <Suspense fallback={<LoadingState>Reading the letters…</LoadingState>}>
          <Letters slice={slice} onOpen={setOpenId} />
        </Suspense>
      </Card>

      {/* The sheet finds its letter in the list, so it reads the list itself. */}
      <Suspense fallback={null}>
        <LetterSheetFromList
          openId={openId}
          canWrite={canWrite}
          onClose={() => setOpenId(null)}
        />
      </Suspense>
      <IssueSheet open={issuing} onClose={() => setIssuing(false)} />
    </PageContent>
  )
}

/// What the slice shows: the letters in force, or all of them, newest first.
function shownLetters(
  all: readonly WarningLetterView[],
  slice: Slice
): WarningLetterView[] {
  return (slice === "ACTIVE" ? all.filter((one) => one.active) : [...all]).sort(
    (a, b) => b.issued_on.localeCompare(a.issued_on)
  )
}

/// How many letters the slice shows, at the right of the toolbar.
function LetterCount({ slice }: { slice: Slice }) {
  const letters = useSuspenseQuery(allWarningLettersQuery())
  const rows = shownLetters(letters.data, slice)
  return (
    <span className="text-[0.9375rem] text-mute tabular-nums">
      {count(rows.length)} {rows.length === 1 ? "letter" : "letters"}
    </span>
  )
}

/// The letters, as cards or a table. Here and not in the screen so the head
/// paints at once and this waits alone for its answer.
function Letters({
  slice,
  onOpen,
}: {
  slice: Slice
  onOpen: (id: string) => void
}) {
  const phone = useLayout() === "phone"
  const letters = useSuspenseQuery(allWarningLettersQuery())
  const rows = shownLetters(letters.data, slice)
  const setOpenId = onOpen
  return rows.length === 0 ? (
    <EmptyState>
      {slice === "ACTIVE"
        ? "No letter is in force."
        : "No letter has been issued yet."}
    </EmptyState>
  ) : phone ? (
    <PhoneCards
      rows={rows}
      onOpen={(letter) => setOpenId(letter.id)}
      rowId={(letter) => letter.id}
      spec={{
        title: (letter) => (
          <CardName
            name={letter.full_name ?? letter.employee_code}
            line={`Issued ${day(letter.issued_on)}${
              letter.revoked ? "" : ` · to ${day(letter.valid_until)}`
            }`}
          />
        ),
        lead: (letter) => (
          <CardFigure
            value={LETTER_LEVEL_LABEL[letter.level] ?? letter.level}
            caption={
              letter.acknowledged_at === null
                ? "not acknowledged"
                : `acknowledged ${day(letter.acknowledged_at)}`
            }
            tone={letter.active && !letter.revoked ? undefined : "quiet"}
          />
        ),
        foot: (letter) => {
          const state = letterState(letter)
          return <Status tone={state.tone}>{state.label}</Status>
        },
        action: (letter) => (
          <CardButton
            label="Open"
            ariaLabel={`Open the letter to ${letter.full_name ?? letter.employee_code}`}
            onClick={() => setOpenId(letter.id)}
          />
        ),
      }}
    />
  ) : (
    <MiniTable
      head={[
        "Employee",
        "Letter",
        "Issued",
        "In force to",
        "Acknowledged",
        "State",
      ]}
    >
      {rows.map((letter) => {
        const state = letterState(letter)
        return (
          <MiniRow key={letter.id}>
            <MiniCell>
              <button
                type="button"
                onClick={() => setOpenId(letter.id)}
                className="font-medium text-ink hover:underline"
              >
                {letter.full_name ?? letter.employee_code}
              </button>
            </MiniCell>
            <MiniCell align="right">
              {LETTER_LEVEL_LABEL[letter.level] ?? letter.level}
            </MiniCell>
            <MiniCell align="right">{day(letter.issued_on)}</MiniCell>
            <MiniCell align="right">
              {letter.revoked ? "—" : day(letter.valid_until)}
            </MiniCell>
            <MiniCell align="right">
              {letter.acknowledged_at === null ? (
                <span className="text-mute">Not yet</span>
              ) : (
                day(letter.acknowledged_at)
              )}
            </MiniCell>
            <MiniCell align="right">
              <Status tone={state.tone}>{state.label}</Status>
            </MiniCell>
          </MiniRow>
        )
      })}
    </MiniTable>
  )
}

function LetterSheetFromList({
  openId,
  canWrite,
  onClose,
}: {
  openId: string | null
  canWrite: boolean
  onClose: () => void
}) {
  const letters = useSuspenseQuery(allWarningLettersQuery())
  const open = letters.data.find((one) => one.id === openId) ?? null
  return <LetterSheet letter={open} canWrite={canWrite} onClose={onClose} />
}

function useRefresh() {
  const client = useQueryClient()
  return (employeeId?: string) => {
    void client.invalidateQueries({ queryKey: hrEmployeeKeys.letters() })
    void client.invalidateQueries({ queryKey: letterKeys.active() })
    if (employeeId !== undefined)
      void client.invalidateQueries({ queryKey: letterKeys.of(employeeId) })
  }
}

/// One letter in full, and the one thing that can still be done to it.
function LetterSheet({
  letter,
  canWrite,
  onClose,
}: {
  letter: WarningLetterView | null
  canWrite: boolean
  onClose: () => void
}) {
  const refresh = useRefresh()
  const nameOfLogin = useNameOfLogin()
  const [why, setWhy] = useState("")
  const revoke = useMutation({
    mutationFn: (id: string) => revokeWarningLetter(id, why.trim()),
    onSuccess: () => {
      refresh(letter?.employee_id)
      setWhy("")
      onClose()
    },
  })
  const close = () => {
    revoke.reset()
    setWhy("")
    onClose()
  }

  return (
    <Sheet
      open={letter !== null}
      onOpenChange={(next) => !next && close()}
      id={letter?.employee_code}
      title={
        letter === null
          ? "Letter"
          : `${LETTER_LEVEL_LABEL[letter.level] ?? letter.level} · ${letter.full_name ?? letter.employee_code}`
      }
      badge={
        letter === null ? undefined : (
          <Pill tone={letterState(letter).tone}>
            {letterState(letter).label}
          </Pill>
        )
      }
      footer={
        letter !== null && canWrite && letter.active && !letter.revoked ? (
          <div className="flex justify-end gap-2">
            <Button variant="quiet" onClick={close}>
              Close
            </Button>
            <Button
              variant="danger"
              disabled={why.trim() === ""}
              pending={revoke.isPending}
              onClick={() => revoke.mutate(letter.id)}
            >
              {revoke.isPending ? "Revoking…" : "Revoke letter"}
            </Button>
          </div>
        ) : undefined
      }
    >
      {letter !== null && (
        <div className="flex flex-col gap-4">
          <div>
            <KeyValue term="Employee">
              <AppLink
                to="/people"
                sheet={{ key: "employee", value: letter.employee_id }}
                className="hover:underline"
              >
                {letter.full_name ?? letter.employee_code}
              </AppLink>
            </KeyValue>
            <KeyValue term="Letter">
              {LETTER_LEVEL_LABEL[letter.level] ?? letter.level}
            </KeyValue>
            <KeyValue term="Issued">{day(letter.issued_on)}</KeyValue>
            <KeyValue term="Issued by">
              {nameOfLogin(letter.issued_by)}
            </KeyValue>
            <KeyValue term="In force to">{day(letter.valid_until)}</KeyValue>
            <KeyValue term="Acknowledged">
              {letter.acknowledged_at === null
                ? "Not yet"
                : day(letter.acknowledged_at)}
            </KeyValue>
          </div>
          <div>
            <p className="mb-1 text-[0.9375rem] text-mute">What was done</p>
            <p className="text-[0.9375rem] whitespace-pre-wrap text-body">
              {letter.violation}
            </p>
          </div>
          {canWrite && letter.active && !letter.revoked && (
            <Field label="Why revoke it" required>
              <Input
                value={why}
                onChange={(event) => setWhy(event.target.value)}
              />
            </Field>
          )}
          <Problem error={revoke.error} />
        </div>
      )}
    </Sheet>
  )
}

function IssueSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const refresh = useRefresh()
  const [who, setWho] = useState<string | null>(null)
  const [level, setLevel] = useState<string | null>(null)
  const [issuedOn, setIssuedOn] = useState(today)
  const [months, setMonths] = useState("6")
  const [violation, setViolation] = useState("")
  const [reason, setReason] = useState("")

  const reset = () => {
    setWho(null)
    setLevel(null)
    setIssuedOn(today())
    setMonths("6")
    setViolation("")
    setReason("")
  }
  const issue = useMutation({
    mutationFn: () =>
      issueWarningLetter(who ?? "", {
        level: level ?? "",
        issued_on: issuedOn,
        valid_months: months.trim() === "" ? null : Number(months),
        violation: violation.trim(),
        reason: reason.trim(),
      }),
    onSuccess: () => {
      refresh(who ?? undefined)
      reset()
      onClose()
    },
  })
  const close = () => {
    issue.reset()
    reset()
    onClose()
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && close()}
      title="Issue a letter"
      footer={
        <div className="flex justify-end gap-2">
          <Button data-cancel variant="quiet" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            pending={issue.isPending}
            disabled={
              who === null ||
              level === null ||
              issuedOn === "" ||
              violation.trim() === "" ||
              reason.trim() === ""
            }
            onClick={() => issue.mutate()}
          >
            {issue.isPending ? "Submitting…" : "Submit"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3.5">
        <Field label="Employee" required>
          <EmployeePick value={who} onChange={setWho} />
        </Field>
        <Field label="Level" required>
          <PickOne
            label="Level"
            choices={LEVELS}
            value={level}
            onChange={setLevel}
            required
          />
        </Field>
        <Field label="Issued on" required>
          <Day value={issuedOn} onChange={setIssuedOn} clearable={false} />
        </Field>
        <Field label="In force for" aside="months, 1–12">
          <Input
            inputMode="numeric"
            value={months}
            onChange={(event) =>
              setMonths(event.target.value.replace(/\D/g, ""))
            }
          />
        </Field>
        <Field label="What was done" required>
          <Textarea
            rows={3}
            value={violation}
            onChange={(event) => setViolation(event.target.value)}
          />
        </Field>
        <Field label="Why" required>
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <Problem error={issue.error} />
      </div>
    </Sheet>
  )
}
