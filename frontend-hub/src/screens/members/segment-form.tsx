import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { Choices, type Tile } from "@/components/ui/form"
import { Button } from "@/components/ui/button"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { Meter } from "@/components/ui/meter"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { Banner, ErrorState } from "@/components/ui/states"
import { count, day, money } from "@/lib/format"
import {
  arity,
  operatorLabel,
  OPERATORS,
  type FilterKind,
  type Operator,
} from "@/lib/filters"
import {
  clauseOf,
  isComplete,
  isMoney,
  numeric,
  SERVER,
  toSpec,
  type Clause,
} from "@/screens/members/definition"
import {
  createSegment,
  reviseSegment,
  previewSegment,
  savedSegmentKeys,
  SEGMENT_ORDER,
  describeSegment,
  memberKeys,
  type SavedSegment,
  type SegmentDefinition,
  type SegmentMatch,
} from "@/lib/queries/members"
import { useCatalogue } from "@/lib/queries/reports"

/// Writing a segment.
///
/// **The form's shape is the stored definition**, the same way the promotion
/// form's shape is the pricing engine's `Rule`. A segment is one document —
/// name, reason, and a list of clauses — and a form that invented its own
/// shape would be a second author of what "has spent at least five million"
/// means. Every control below writes one field of that document.
///
/// **The columns come from the server**, out of the report catalogue's `member`
/// dataset. Not a list typed out here: the server is what decides which columns
/// are filterable and what kind of question each can be asked, and a second
/// list in the browser is the one that still offers a column after it is gone.
///
/// **The count is the server's too, and it is the point of the screen.** It is
/// what turns "lapsing and paired" from a sentence into a decision — four
/// hundred people is a campaign, four is a phone call. Counting in the browser
/// would count the page the directory happens to have loaded, and would then
/// disagree with the card this form is about to create.
///
/// What this form deliberately does **not** offer:
///
///  - **Nested groups.** `match` is one switch over the whole list. A tree
///    needs an editor and a way of explaining itself to whoever inherits it,
///    and the two segments a year that would need one can be written as two.
///  - **Aiming a promotion at the result.** A till holds no member directory —
///    only the customer number a cashier wrote on the sale — so a shop cannot
///    answer "has spent five million across the estate" while offline. A
///    control for it here would be a promise the counter cannot keep.

/// The value editors, by the kind the catalogue gave the column. One clause row
/// asks for as many boxes as its operator takes — none, one, or two — because a
/// box that is ignored is a value somebody believes they have set.
/// How the conditions combine — the whole meaning of a segment, in two tiles.
const MATCHES = [
  {
    value: "ALL",
    label: "Every condition holds",
    note: "Narrower with each one you add.",
  },
  {
    value: "ANY",
    label: "Any one of them holds",
    note: "Wider with each one you add.",
  },
] as const satisfies readonly Tile<SegmentMatch>[]

function ValueEditor({
  column,
  kind,
  operator,
  values,
  onChange,
}: {
  column: string
  kind: FilterKind
  operator: Operator
  values: readonly string[]
  onChange: (next: string[]) => void
}) {
  const width = arity(operator)
  if (width === "none") return null

  const at = (index: number) => values[index] ?? ""
  const set = (index: number, value: string) => {
    const next = [...values]
    while (next.length <= index) next.push("")
    next[index] = value
    onChange(next)
  }

  // The six, by name, when the column is the derived segment. Typing "LAPSING"
  // from memory is how a segment silently matches nobody.
  if (column === "segment" && (width === "one" || width === "many")) {
    return (
      <Select
        value={at(0)}
        onChange={(next) => onChange(next === "" ? [] : [next])}
      >
        <option value="">Choose…</option>
        {SEGMENT_ORDER.map((key) => (
          <option key={key} value={key}>
            {describeSegment(key, { active_days: 90, lapsing_days: 180 }).label}
          </option>
        ))}
      </Select>
    )
  }

  if (kind === "boolean") {
    return (
      <Select
        value={at(0)}
        onChange={(next) => onChange(next === "" ? [] : [next])}
      >
        <option value="">Choose…</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </Select>
    )
  }

  if (width === "many") {
    return (
      <Input
        value={values.join(", ")}
        placeholder="Separated by commas"
        onChange={(event) =>
          onChange(
            event.target.value
              .split(",")
              .map((one) => one.trim())
              .filter((one) => one !== "")
          )
        }
      />
    )
  }

  const box = (index: number) => (
    <Input
      key={index}
      value={at(index)}
      type={kind === "date" ? "date" : "text"}
      inputMode={kind === "number" ? "numeric" : undefined}
      placeholder={isMoney(column) ? "5.000.000" : undefined}
      onChange={(event) =>
        set(
          index,
          kind === "number" ? numeric(event.target.value) : event.target.value
        )
      }
    />
  )

  return width === "two" ? (
    <div className="flex items-center gap-2">
      {box(0)}
      <span className="shrink-0 text-[0.71875rem] text-mute">and</span>
      {box(1)}
    </div>
  ) : (
    box(0)
  )
}

/// Hold a value still until somebody stops typing.
///
/// The preview is a database read, and a read per keystroke would both hammer
/// the server and flicker a number somebody is trying to read.
function useSettled<T>(value: T, delay = 400): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return settled
}

export function SegmentForm({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean
  /// The segment being edited, or `undefined` to write a new one.
  editing?: SavedSegment
  onClose: () => void
  onSaved: (saved: SavedSegment) => void
}) {
  const client = useQueryClient()
  const catalogue = useCatalogue()

  const [name, setName] = useState(editing?.name ?? "")
  const [purpose, setPurpose] = useState(editing?.purpose ?? "")
  const [match, setMatch] = useState<SegmentMatch>(
    editing?.definition.match ?? "ALL"
  )
  const [clauses, setClauses] = useState<Clause[]>(
    editing ? editing.definition.filters.map(clauseOf) : []
  )

  /// What may be filtered on, from the server's own declaration.
  const columns = useMemo(
    () =>
      catalogue.data?.datasets.find((one) => one.name === "member")
        ?.dimensions ?? [],
    [catalogue.data]
  )
  const kindOf = (column: string): FilterKind =>
    columns.find((one) => one.key === column)?.kind ?? "text"

  const definition: SegmentDefinition = useMemo(
    () => ({
      match,
      filters: clauses
        .filter((clause) => isComplete(toSpec(clause), clause.operator))
        .map(toSpec),
    }),
    [match, clauses]
  )

  /// The count, over the whole directory, as somebody types. Keyed on the
  /// settled definition so a half-typed number does not become a query.
  const settled = useSettled(definition)
  const preview = useQuery({
    queryKey: savedSegmentKeys.preview(settled),
    queryFn: ({ signal }) => previewSegment(settled, signal),
    enabled: open && settled.filters.length > 0,
    retry: false,
  })

  const save = useMutation({
    mutationFn: () => {
      const input = {
        name: name.trim(),
        purpose: purpose.trim() === "" ? undefined : purpose.trim(),
        definition,
      }
      return editing
        ? reviseSegment(editing.segment_id, input)
        : createSegment(input)
    },
    onSuccess: (saved) => {
      void client.invalidateQueries({ queryKey: savedSegmentKeys.all })
      void client.invalidateQueries({ queryKey: memberKeys.all })
      onSaved(saved)
    },
  })

  const problem =
    name.trim() === ""
      ? "A segment needs a name — it is what a campaign will be described by later."
      : definition.filters.length === 0
        ? "Add at least one condition. A segment with none is the whole directory."
        : clauses.length !== definition.filters.length
          ? "One of the conditions is not finished."
          : undefined

  const share =
    preview.data && preview.data.member_count > 0
      ? preview.data.members / preview.data.member_count
      : 0

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={editing ? "Edit segment" : "New segment"}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-[0.71875rem] text-mute">
            {editing
              ? "Saving writes a new version. The old one still explains what was sent against it."
              : "The conditions are kept, never the list. Who is in it is worked out on every read."}
          </span>
          <Button
            variant="primary"
            disabled={problem !== undefined || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : editing ? "Save version" : "Create"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {save.isError && <ErrorState error={save.error} />}

        <Field
          label="What it is called"
          hint="What a campaign and a report will both call this list."
        >
          <Input
            value={name}
            autoFocus
            placeholder="Lapsing big spenders"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        <Field
          label="Why it exists"
          hint="Optional, and the one thing the conditions cannot say for themselves."
        >
          <Textarea
            value={purpose}
            rows={2}
            placeholder="People worth a message before they are gone for good."
            onChange={(event) => setPurpose(event.target.value)}
          />
        </Field>

        {/* Tiles, not a dropdown. This is the difference between a segment of
            forty people and a segment of four thousand, and a closed dropdown
            shows one word of it. */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[0.78125rem] font-medium text-text">
            A member is in this segment when
          </span>
          <Choices
            options={MATCHES}
            value={match}
            onChange={setMatch}
            label="How the conditions below are combined"
          />
        </div>

        {catalogue.isError && (
          <Banner tone="bad">
            The list of columns could not be read, so nothing here can be
            checked against what the server will accept.
          </Banner>
        )}

        <div className="flex flex-col gap-2">
          {clauses.map((clause, index) => {
            const kind = kindOf(clause.column)
            const allowed = OPERATORS[kind]
            return (
              <div
                key={index}
                // The operator gets the widest share of the row. It is the
                // part that cannot be guessed from context: a truncated
                // column name is still recognisable, but "is at le…" and
                // "is at mo…" are the two opposite readings of the same
                // clause.
                className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.15fr)_minmax(0,0.95fr)_auto] items-center gap-2"
              >
                <Select
                  value={clause.column}
                  onChange={(column) => {
                    const next = OPERATORS[kindOf(column)]
                    setClauses((all) =>
                      all.map((one, at) =>
                        at === index
                          ? {
                              column,
                              // The operator has to be one this kind offers, and
                              // the values go: "contains" on a date is not a
                              // question, and keeping the old value would carry
                              // a number into a text box.
                              operator: next.includes(one.operator)
                                ? one.operator
                                : next[0],
                              values: [],
                            }
                          : one
                      )
                    )
                  }}
                >
                  {columns.map((column) => (
                    <option key={column.key} value={column.key}>
                      {column.label}
                    </option>
                  ))}
                </Select>

                <Select
                  value={clause.operator}
                  onChange={(next) =>
                    setClauses((all) =>
                      all.map((one, at) =>
                        at === index
                          ? {
                              ...one,
                              operator: next as Operator,
                              values: [],
                            }
                          : one
                      )
                    )
                  }
                >
                  {allowed
                    .filter((operator) => SERVER[operator] !== undefined)
                    .map((operator) => (
                      <option key={operator} value={operator}>
                        {operatorLabel(operator)}
                      </option>
                    ))}
                </Select>

                <ValueEditor
                  column={clause.column}
                  kind={kind}
                  operator={clause.operator}
                  values={clause.values}
                  onChange={(values) =>
                    setClauses((all) =>
                      all.map((one, at) =>
                        at === index ? { ...one, values } : one
                      )
                    )
                  }
                />

                <button
                  type="button"
                  aria-label="Remove this condition"
                  onClick={() =>
                    setClauses((all) => all.filter((_, at) => at !== index))
                  }
                  className="grid size-8 shrink-0 place-items-center rounded-inner text-line-ico transition-colors hover:bg-soft-2 hover:text-ink"
                >
                  <X className="size-4" />
                </button>
              </div>
            )
          })}

          <Button
            variant="soft"
            className="self-start"
            disabled={columns.length === 0}
            onClick={() =>
              setClauses((all) => [
                ...all,
                {
                  column: columns[0]?.key ?? "",
                  operator: OPERATORS[kindOf(columns[0]?.key ?? "")][0],
                  values: [],
                },
              ])
            }
          >
            <Plus className="size-3.5" />
            Add a condition
          </Button>
        </div>

        {/* What it matches, from the server, over the whole directory. Under
            the conditions rather than beside them because it is the answer to
            them — and because a number that moves as you type is the fastest
            way to find out that a clause said something other than you meant. */}
        <div className="bg-soft-1 rounded-inner p-4">
          {definition.filters.length === 0 ? (
            <p className="text-[0.78125rem] leading-relaxed text-mute">
              Add a condition and this will say how many members match it.
            </p>
          ) : preview.isError ? (
            <ErrorState error={preview.error} />
          ) : (
            <>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="text-[1.375rem] leading-none font-semibold tracking-[-0.02em] text-ink tabular-nums">
                    {preview.isPending
                      ? "…"
                      : count(preview.data?.members ?? 0)}
                  </div>
                  <div className="mt-1.5 text-[0.71875rem] text-mute">
                    of {count(preview.data?.member_count ?? 0)} members
                  </div>
                </div>
                <div className="flex w-24 shrink-0 flex-col items-end gap-1.5">
                  <span className="text-[0.71875rem] text-mute tabular-nums">
                    {Math.round(share * 100)}%
                  </span>
                  <Meter value={share} tone="accent" />
                </div>
              </div>

              {preview.data && preview.data.members > 0 && (
                <MiniTable
                  className="mt-3"
                  head={[
                    { label: "Measure", align: "left" },
                    { label: "Value", align: "right" },
                  ]}
                >
                  <MiniRow>
                    <MiniCell>Spent</MiniCell>
                    <MiniCell align="right">
                      {money(preview.data.spent_minor)}
                    </MiniCell>
                  </MiniRow>
                  <MiniRow>
                    <MiniCell>Average each</MiniCell>
                    <MiniCell align="right">
                      {money(preview.data.average_spend_minor)}
                    </MiniCell>
                  </MiniRow>
                  <MiniRow>
                    <MiniCell>Last purchase</MiniCell>
                    <MiniCell align="right">
                      {day(preview.data.last_purchase_at)}
                    </MiniCell>
                  </MiniRow>
                </MiniTable>
              )}
            </>
          )}
        </div>

        {problem !== undefined && (
          <p className="text-[0.71875rem] text-mute">{problem}</p>
        )}
      </div>
    </Sheet>
  )
}
