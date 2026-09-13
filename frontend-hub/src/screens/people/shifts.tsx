import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, Input } from "@/components/ui/field"
import { Toggle } from "@/components/ui/form"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Banner, EmptyState } from "@/components/ui/states"
import {
  defineShift,
  listShifts,
  retireShift,
  rosterKeys,
  type NewShift,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"

/// The patterns a roster is built out of.
///
/// # Why this is a screen at all
///
/// It was not one. `POST /attendance-shifts` and its retirement route have been
/// live since the roster landed, and `defineShift`/`retireShift` have been
/// sitting in `queries/people.ts` the whole time — but the only screen that
/// ever touched shifts was **Roster**, and it only ever *read* them. So head
/// office could schedule people onto patterns it had no way to create, and the
/// seed's patterns were the only patterns the company would ever have.
///
/// A route with no caller is not a feature waiting to be used. It is a feature
/// nobody can reach, and it looks identical from the outside to one that was
/// never built.
///
/// # Why it belongs to head office and not to the shop
///
/// A shop that could invent its own idea of "Pagi" is a shop whose attendance
/// cannot be compared with the shop beside it: two stores would both report
/// somebody on the morning shift and mean different hours, and every figure
/// folded over both — lateness, planned cost, coverage — would be an average of
/// two different questions. The pattern is the unit the whole company measures
/// in, so it is set once, centrally, exactly like the attendance policy and the
/// holiday calendar it sits beside.
///
/// # Retire, never delete
///
/// A roster day names its shift. Deleting a pattern would leave last March's
/// roster pointing at nothing, and a schedule that cannot be read back is a
/// schedule that cannot answer "was this person supposed to be here". Retiring
/// takes the pattern out of tomorrow's choices and leaves yesterday legible.
export function ShiftPatterns() {
  const shifts = useQuery({
    queryKey: rosterKeys.shifts(),
    queryFn: ({ signal }) => listShifts(signal),
  })

  return (
    <>

      <Card className="mb-4 overflow-hidden">
        <CardHeader>
          <CardTitle>In use</CardTitle>
        </CardHeader>
        {queryState(shifts, {
          loading: "Loading the patterns…",
          render: (patterns) =>
            patterns.length === 0 ? (
              <EmptyState>
                No pattern is defined. A roster cannot be built until at least
                one exists — every scheduled day names the pattern it is worth.
              </EmptyState>
            ) : (
              <div className="overflow-x-auto px-4 pb-4">
                <MiniTable
                  head={[
                    "Pattern",
                    "Starts",
                    "Ends",
                    { label: "Break", align: "right" },
                    { label: "Paid", align: "right" },
                    "",
                  ]}
                >
                  {patterns.map((pattern) => (
                    <Row key={pattern.id} pattern={pattern} />
                  ))}
                </MiniTable>
              </div>
            ),
        })}
      </Card>

      <DefinePattern />
    </>
  )
}

/// `planned_work_minutes` as hours and minutes. The server computes it — the
/// span less the break — and the screen never recomputes it: two arithmetics
/// for one number is one number that will eventually disagree with itself.
function paidTime(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

function Row({
  pattern,
}: {
  pattern: { readonly id: string } & Awaited<
    ReturnType<typeof listShifts>
  >[number]
}) {
  const client = useQueryClient()
  // Retiring is confirmed in the row rather than in a dialog. The question is
  // about the one line you are pointing at, and a modal that repeats the name
  // back at you is a modal you learn to dismiss without reading.
  const [asked, setAsked] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  const retire = useMutation({
    mutationFn: () => retireShift(pattern.id),
    onSuccess: () => {
      setFailed(null)
      setAsked(false)
      void client.invalidateQueries({ queryKey: rosterKeys.shifts() })
    },
    onError: (error: Error) => setFailed(error.message),
  })

  return (
    <MiniRow>
      <MiniCell>
        <span className="text-ink">{pattern.name}</span>
        <span className="ml-2 font-mono text-id text-mute">{pattern.id}</span>
        {failed !== null && (
          <span className="mt-0.5 block text-[0.6875rem] text-bad-fg">
            {failed}
          </span>
        )}
      </MiniCell>
      <MiniCell>
        <span className="font-mono text-id">{pattern.starts_at}</span>
      </MiniCell>
      <MiniCell>
        <span className="font-mono text-id">{pattern.ends_at}</span>
        {/* Stated on the row, because it is the difference between an eight
            hour night and a sixteen hour mistake. */}
        {pattern.crosses_midnight && (
          <Pill tone="info" className="ml-1.5">
            Overnight
          </Pill>
        )}
      </MiniCell>
      <MiniCell align="right">
        {pattern.unpaid_break_minutes === 0
          ? "—"
          : `${pattern.unpaid_break_minutes}m`}
      </MiniCell>
      <MiniCell align="right">
        {paidTime(pattern.planned_work_minutes)}
      </MiniCell>
      <MiniCell align="right">
        {asked ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="text-[0.6875rem] text-body">
              Retire it? Rosters keep it.
            </span>
            <Button size="sm" onClick={() => setAsked(false)}>
              No
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={retire.isPending}
              onClick={() => retire.mutate()}
            >
              Retire
            </Button>
          </span>
        ) : (
          <Button size="sm" onClick={() => setAsked(true)}>
            Retire
          </Button>
        )}
      </MiniCell>
    </MiniRow>
  )
}

const BLANK: NewShift = {
  id: "",
  name: "",
  startsAt: "",
  endsAt: "",
  crossesMidnight: false,
  unpaidBreakMinutes: 60,
}

/// `HH:MM`, the way a rota is read off a wall. Checked here as well as on the
/// server so the refusal arrives before the round trip, not because the check
/// here is the one that counts.
function isClockTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

function DefinePattern() {
  const client = useQueryClient()
  const [draft, setDraft] = useState<NewShift>(BLANK)
  const [failed, setFailed] = useState<string | null>(null)
  const [written, setWritten] = useState(false)

  const define = useMutation({
    mutationFn: () => defineShift(draft),
    onSuccess: () => {
      setFailed(null)
      setWritten(true)
      setDraft(BLANK)
      void client.invalidateQueries({ queryKey: rosterKeys.shifts() })
    },
    onError: (error: Error) => {
      setWritten(false)
      setFailed(error.message)
    },
  })

  const timesRead = isClockTime(draft.startsAt) && isClockTime(draft.endsAt)
  const ready = draft.id.trim() !== "" && draft.name.trim() !== "" && timesRead

  // Ending before it starts is either an overnight shift or a typo, and the two
  // are one keystroke apart. The form says which reading it is taking rather
  // than inferring it, and offers the switch beside the sentence.
  const wrapsAround =
    timesRead && draft.endsAt <= draft.startsAt && !draft.crossesMidnight

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Define a pattern</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-3 px-4 pb-4">
        {written && (
          <Banner tone="ok">
            Defined. Rosters can be built on it from the next week you open.
          </Banner>
        )}
        {failed !== null && <Banner tone="bad">{failed}</Banner>}
        {wrapsAround && (
          <Banner tone="warn">
            This pattern ends at or before it starts. That is an overnight shift
            — switch “Runs past midnight” on — or it is a typo. It is not
            guessed at: 09:00 to 09:00 is either nothing or a full day.
          </Banner>
        )}

        <Field label="Code" hint="What a roster day names. It never changes.">
          <Input
            value={draft.id}
            onChange={(event) => setDraft({ ...draft, id: event.target.value })}
            placeholder="PAGI"
          />
        </Field>
        <Field label="Name">
          <Input
            value={draft.name}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
            placeholder="Pagi"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts" hint="24-hour clock, HH:MM.">
            <Input
              value={draft.startsAt}
              onChange={(event) =>
                setDraft({ ...draft, startsAt: event.target.value })
              }
              placeholder="09:00"
            />
          </Field>
          <Field label="Ends">
            <Input
              value={draft.endsAt}
              onChange={(event) =>
                setDraft({ ...draft, endsAt: event.target.value })
              }
              placeholder="17:00"
            />
          </Field>
        </div>
        <Field
          label="Unpaid break, in minutes"
          hint="Taken out of the paid span. Zero is a pattern with no break, which is a decision rather than an omission."
        >
          <Input
            type="number"
            min={0}
            value={draft.unpaidBreakMinutes}
            onChange={(event) =>
              setDraft({
                ...draft,
                unpaidBreakMinutes: Math.max(
                  0,
                  Number(event.target.value) || 0
                ),
              })
            }
          />
        </Field>
        <Toggle
          on={draft.crossesMidnight}
          onToggle={() =>
            setDraft({ ...draft, crossesMidnight: !draft.crossesMidnight })
          }
          label="Runs past midnight"
          note={
            draft.crossesMidnight
              ? "The shift ends on the following day. The DC's night pattern is the one that needs this."
              : "The shift starts and ends on the same day."
          }
        />

        <div>
          <Button
            variant="primary"
            disabled={!ready || define.isPending}
            onClick={() => define.mutate()}
          >
            Define
          </Button>
        </div>
      </div>
    </Card>
  )
}
