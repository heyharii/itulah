import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQueries,
} from "@tanstack/react-query"
import { Suspense, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Day } from "@/components/ui/day"
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { SHEET_ROW } from "@/components/ui/list-chrome"
import { BottomSheet } from "@/components/ui/picker-sheet"
import { Toolbar } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
import { count, day, money } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  clearGiro,
  giroBoardQueries,
  listPayments,
} from "@/lib/queries/finance"
import {
  candidateCashDocuments,
  rejectGiro,
  replaceGiro,
  unclearGiro,
} from "@/lib/queries/giros"
import { problemOf } from "@/lib/problem"
import { useDebounced } from "@/lib/use-debounced"
import { cn } from "@/lib/utils"
import { todayIso } from "@/screens/finance/chart"
import { useSupplierName } from "@/screens/finance/hooks"
import { CardFigure } from "@/components/ui/phone-cards"
import { PhoneChoice, PhoneFigures, UnitSelect } from "@/screens/finance/parts"
import { ScreenPending } from "@/screens/finance/pending"

import type { GiroRow } from "@itulah/contract"

/// The Giro Board — the owner's picked prototype (design 9, "Papan giro"),
/// matched card for card: two boards by direction, four summary cards, four
/// columns, and every move a button on the card itself. See
/// `bkm-bkk-prototype.html` around line 1007 for the shape this follows.
///
/// The ladder underneath is still `domain::giro`'s own — ISSUED, DELIVERED,
/// DUE, CLEARED, REJECTED — but the board no longer reads it as five columns.
/// A giro not yet settled sorts into "Waiting" or "Due within 7 days" by its
/// own `days_overdue`; CLEARED and REJECTED are their own columns. Skipping a
/// rung is normal (a giro handed over and cleared the same week never sits in
/// DELIVERED or DUE), so this board does not ask anyone to click through
/// states that did not happen — there is no "Mark delivered" / "Mark due"
/// button here, on purpose, matching the prototype.
///
/// No drag, still: every move posts to the ledger, and a card sliding under
/// the mouse must not be what starts that.

type Bucket = "DUE_SOON" | "WAITING" | "CLEARED" | "BOUNCED"

const UI_COLUMNS: readonly { readonly key: Bucket; readonly label: string }[] =
  [
    { key: "WAITING", label: "Waiting" },
    { key: "DUE_SOON", label: "Due within 7 days" },
    { key: "CLEARED", label: "Cleared" },
    { key: "BOUNCED", label: "Bounced" },
  ]

/// Not cleared, not bounced, and due within a week (or already overdue) is
/// "Due within 7 days"; everything else still outstanding is "Waiting".
function bucketOf(row: GiroRow): Bucket {
  if (row.status === "CLEARED") return "CLEARED"
  if (row.status === "REJECTED") return "BOUNCED"
  return row.days_overdue >= -7 ? "DUE_SOON" : "WAITING"
}

export function GiroBoard() {
  return (
    <Suspense
      fallback={
        <ScreenPending
          crumb="Finance · Banking"
          title="Giro Board"
          className="max-md:hidden"
        >
          Reading the giros…
        </ScreenPending>
      }
    >
      <GiroBoardScreen />
    </Suspense>
  )
}

function GiroBoardScreen() {
  const client = useQueryClient()
  // Issued only (owner, 2026-10-01): the client is a cash-and-card retailer
  // and is not paid by giro. The backend still keeps both directions.
  const direction = "OUT" as "IN" | "OUT"
  const [bank, setBank] = useState("")
  const [unit, setUnit] = useState("")
  const [lateOnly, setLateOnly] = useState(false)
  // A phone shows one lane at a time, the one that wants somebody.
  const [lane, setLane] = useState<Bucket>("DUE_SOON")
  const phone = useLayout() === "phone"
  // The card being dragged, and the move a drop has asked for. A drop never
  // posts anything: it opens the card's own form (the statement's date, the
  // reason), because a clearing is dated by the bank, not by the drop.
  const [dragging, setDragging] = useState<GiroRow | null>(null)
  const [active, setActive] = useState<{ id: string; kind: Acting } | null>(
    null
  )

  // One request per backend status, so a bank or direction the board is not
  // showing does not cost a page of giros the columns would only throw away.
  const reads = useSuspenseQueries({
    queries: giroBoardQueries(),
    combine: (results) => ({
      rows: results.flatMap((result) => result.data),
    }),
  })

  const banks = useMemo(
    () => [...new Set(reads.rows.map((row) => row.bank))].sort(),
    [reads.rows]
  )

  const filtered = useMemo(
    () =>
      reads.rows.filter(
        (row) =>
          row.direction === direction &&
          (bank === "" || row.bank === bank) &&
          (unit === "" || row.unit_id === unit) &&
          (!lateOnly ||
            (row.days_overdue > 0 &&
              bucketOf(row) !== "CLEARED" &&
              bucketOf(row) !== "BOUNCED"))
      ),
    [reads.rows, direction, bank, unit, lateOnly]
  )

  const buckets = useMemo(() => {
    const groups: Record<Bucket, GiroRow[]> = {
      WAITING: [],
      DUE_SOON: [],
      CLEARED: [],
      BOUNCED: [],
    }
    for (const row of filtered) groups[bucketOf(row)].push(row)
    // The latest first, so what has gone furthest past its date is at the top
    // of the lane (owner, 2026-10-01); the closed lanes read newest first.
    for (const key of ["WAITING", "DUE_SOON"] as const)
      groups[key].sort((a, b) => b.days_overdue - a.days_overdue)
    return groups
  }, [filtered])

  const onChanged = () => {
    void client.invalidateQueries({ queryKey: ["finance", "giros"] })
    void client.invalidateQueries({ queryKey: ["finance", "money"] })
  }

  return (
    <PageContent>
      <PageHeader
        className="max-md:hidden"
        crumb="Finance · Banking"
        title="Giro Board"
        actions={
          <Button variant="ghost" disabled title="Not available yet.">
            Opening giro
          </Button>
        }
      />
      {/* A phone: the four lanes are one chip in the dock and a list of the
          lane it names — four columns do not fit, and nothing scrolls
          sideways. */}
      <PhoneChoice
        title="Lane"
        value={lane}
        onChange={(next) => setLane(next as Bucket)}
        options={UI_COLUMNS.map(({ key, label }) => ({
          value: key,
          label,
          short: key === "DUE_SOON" ? "Due soon" : label,
          note: count(buckets[key].length),
        }))}
      />

      <Toolbar>
        <span className="inline-flex w-40 shrink-0">
          <Select
            value={bank}
            onChange={setBank}
            className="h-control w-40"
            aria-label="Bank"
          >
            <option value="">All banks</option>
            {banks.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </span>
        <UnitSelect
          value={unit}
          onChange={setUnit}
          className="h-control w-44"
          aria-label="Unit"
        />
        <Checkbox label="Late only" checked={lateOnly} onChange={setLateOnly} />
      </Toolbar>

      <>
        {filtered.length === 0 ? (
          <EmptyState>No giro yet.</EmptyState>
        ) : phone ? (
          <>
            <PhoneFigures
              items={[
                {
                  label: "Giros",
                  value: buckets[lane].length,
                  unit: "count",
                },
                {
                  label: "Total",
                  value: buckets[lane].reduce(
                    (sum, row) => sum + row.amount_minor,
                    0
                  ),
                },
              ]}
            />
            <div className="flex flex-col gap-2.5">
              {buckets[lane].length === 0 ? (
                <EmptyState>Nothing here.</EmptyState>
              ) : (
                buckets[lane].map((row) => (
                  <GiroCard
                    key={row.giro_id}
                    row={row}
                    onChanged={onChanged}
                    setDragging={setDragging}
                    acting={active?.id === row.giro_id ? active.kind : null}
                    setActing={(kind) =>
                      setActive(
                        kind === null ? null : { id: row.giro_id, kind }
                      )
                    }
                  />
                ))
              )}
            </div>
          </>
        ) : (
          <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {UI_COLUMNS.map(({ key, label }) => (
              <GiroColumn
                key={key}
                column={key}
                label={label}
                rows={buckets[key]}
                onChanged={onChanged}
                dragging={dragging}
                setDragging={setDragging}
                active={active}
                setActive={setActive}
              />
            ))}
          </div>
        )}
      </>
    </PageContent>
  )
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

/// What dropping a card of this bucket on that column asks for. Waiting and
/// Due soon are one state seen by date, so a move between them is not a move;
/// Bounced has no way out but Replace, which makes a new giro.
function dropAction(from: Bucket, to: Bucket): Acting {
  const open = (b: Bucket) => b === "DUE_SOON" || b === "WAITING"
  if (open(from) && to === "CLEARED") return "clear"
  if (open(from) && to === "BOUNCED") return "reject"
  if (from === "CLEARED" && open(to)) return "unclear"
  return null
}

function GiroColumn({
  column,
  label,
  rows,
  onChanged,
  dragging,
  setDragging,
  active,
  setActive,
}: {
  column: Bucket
  label: string
  rows: readonly GiroRow[]
  onChanged: () => void
  dragging: GiroRow | null
  setDragging: (row: GiroRow | null) => void
  active: { id: string; kind: Acting } | null
  setActive: (next: { id: string; kind: Acting } | null) => void
}) {
  const total = rows.reduce((sum, row) => sum + row.amount_minor, 0)
  const move = dragging === null ? null : dropAction(bucketOf(dragging), column)
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col rounded-inner transition-shadow",
        move !== null &&
          "ring-2 ring-accent/30 ring-offset-4 ring-offset-soft-3"
      )}
      onDragOver={(event) => {
        if (move !== null) event.preventDefault()
      }}
      onDrop={(event) => {
        if (dragging === null || move === null) return
        event.preventDefault()
        setActive({ id: dragging.giro_id, kind: move })
        setDragging(null)
      }}
    >
      <div className="border-b border-hairline pb-2">
        <div className="flex items-center gap-2">
          <span className="text-[0.9375rem] font-medium text-ink">{label}</span>
          <span className="text-[0.9375rem] text-mute tabular-nums">
            {count(rows.length)}
          </span>
        </div>
        <div className="mt-0.5 text-[0.9375rem] text-body tabular-nums">
          {money(total)}
        </div>
      </div>
      {/* Each lane scrolls on its own, so fifty late giros do not make the
          page fifty cards long. */}
      <div className="mt-3 flex max-h-[calc(100dvh-16rem)] [scrollbar-width:thin] flex-col gap-3 overflow-y-auto pr-1">
        {rows.length === 0 ? (
          <p className="py-6 text-center text-[0.9375rem] text-faint">
            Nothing here
          </p>
        ) : (
          rows.map((row) => (
            <GiroCard
              key={row.giro_id}
              row={row}
              onChanged={onChanged}
              setDragging={setDragging}
              acting={active?.id === row.giro_id ? active.kind : null}
              setActing={(kind) =>
                setActive(kind === null ? null : { id: row.giro_id, kind })
              }
            />
          ))
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// One card — every move it can make lives on it, per the prototype's `gcard`
// ---------------------------------------------------------------------------

type Acting = "clear" | "reject" | "unclear" | "replace" | null

function GiroCard({
  row,
  onChanged,
  setDragging,
  acting,
  setActing,
}: {
  row: GiroRow
  onChanged: () => void
  setDragging: (row: GiroRow | null) => void
  acting: Acting
  setActing: (next: Acting) => void
}) {
  const supplierName = useSupplierName()
  const toggle = (which: Acting) => setActing(acting === which ? null : which)
  const done = () => {
    setActing(null)
    onChanged()
  }

  const bucket = bucketOf(row)
  const received = row.direction === "IN"
  const phone = useLayout() === "phone"
  const [choosing, setChoosing] = useState(false)

  if (phone) {
    // What the desk does by dragging a card, a phone does by tapping it: the
    // moves this giro can make, each opening the same form the drop opens.
    const moves: { kind: Acting; label: string }[] =
      bucket === "WAITING" || bucket === "DUE_SOON"
        ? [
            { kind: "clear", label: "Cleared by the bank" },
            { kind: "reject", label: "Bounced" },
          ]
        : bucket === "CLEARED"
          ? [{ kind: "unclear", label: "Undo clearing" }]
          : []
    return (
      <div className="rounded-card border border-hairline bg-canvas shadow-soft">
        <div
          className={cn(
            "flex items-start gap-3 p-4",
            moves.length > 0 && "cursor-pointer active:bg-soft"
          )}
          onClick={moves.length > 0 ? () => setChoosing(true) : undefined}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-card-title font-semibold break-words text-ink">
              {row.party_name === null ? (
                <span className="font-normal text-faint">No party</span>
              ) : (
                supplierName(row.party_name, row.party_name)
              )}
            </span>
            <span className="truncate font-mono text-[0.9375rem] text-mute">
              {row.number}
            </span>
          </div>
          <CardFigure value={money(row.amount_minor)} />
        </div>
        <div className="flex items-center justify-between gap-3 rounded-b-card border-t border-hairline px-4 py-3">
          <div className="min-w-0 text-[0.9375rem]">
            <DueTag row={row} bucket={bucket} />
            {bucket === "BOUNCED" && row.rejected_reason !== null && (
              <div className="truncate text-mute">{row.rejected_reason}</div>
            )}
          </div>
          {bucket === "BOUNCED" &&
            (row.replaced_by !== null ? (
              <Pill tone="ok">
                Replaced by {row.replacement_number ?? row.replaced_by}
              </Pill>
            ) : (
              <Button
                variant="tint"
                size="card"
                onClick={() => toggle("replace")}
              >
                Replace
              </Button>
            ))}
        </div>
        {acting !== null && (
          <div className="rounded-b-card border-t border-hairline p-3">
            {acting === "clear" && (
              <ClearForm
                giro={row}
                onDone={done}
                onCancel={() => setActing(null)}
              />
            )}
            {acting === "reject" && (
              <RejectForm
                giro={row}
                onDone={done}
                onCancel={() => setActing(null)}
              />
            )}
            {acting === "unclear" && (
              <UnclearForm
                giro={row}
                onDone={done}
                onCancel={() => setActing(null)}
              />
            )}
            {acting === "replace" && (
              <ReplaceForm
                giro={row}
                onDone={done}
                onCancel={() => setActing(null)}
              />
            )}
          </div>
        )}
        <BottomSheet
          open={choosing}
          onOpenChange={setChoosing}
          title={`Giro ${row.number}`}
        >
          <div className="min-h-0 overflow-y-auto overscroll-contain px-2 pb-3">
            {moves.map((move) => (
              <button
                key={move.kind}
                type="button"
                className={SHEET_ROW}
                onClick={() => {
                  setChoosing(false)
                  setActing(move.kind)
                }}
              >
                {move.label}
              </button>
            ))}
          </div>
        </BottomSheet>
      </div>
    )
  }

  return (
    <Card
      // Bounced has one way on, Replace, which is a button: a new giro has to
      // be written, not dropped.
      draggable={bucket !== "BOUNCED"}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move"
        event.dataTransfer.setData("text/plain", row.giro_id)
        setDragging(row)
      }}
      onDragEnd={() => setDragging(null)}
      className={cn(
        "flex flex-col gap-1.5 px-4 py-3.5",
        bucket !== "BOUNCED" && "cursor-grab active:cursor-grabbing"
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-[1rem] text-ink">
          {row.party_name === null ? (
            <span className="text-faint">No party</span>
          ) : (
            supplierName(row.party_name, row.party_name)
          )}
        </span>
        <span className="shrink-0 text-[1rem] font-medium text-ink tabular-nums">
          {money(row.amount_minor)}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <DueTag row={row} bucket={bucket} />
        <span className="min-w-0 truncate font-mono text-[0.9375rem] text-mute">
          {row.number}
        </span>
      </div>
      {bucket === "BOUNCED" && row.rejected_reason !== null && (
        <div className="truncate text-[0.9375rem] text-mute">
          {row.rejected_reason}
        </div>
      )}

      {bucket === "BOUNCED" &&
        (row.replaced_by !== null ? (
          <Pill tone="ok">
            Replaced by {row.replacement_number ?? row.replaced_by}
          </Pill>
        ) : (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Button
              variant={acting === "replace" ? "soft" : "tint"}
              size="sm"
              onClick={() => toggle("replace")}
            >
              Replace
            </Button>
            <span className="text-[0.9375rem] text-mute">
              {received
                ? "its invoices are open again"
                : "its bills are open again"}
            </span>
          </div>
        ))}

      {acting === "clear" && (
        <ClearForm giro={row} onDone={done} onCancel={() => setActing(null)} />
      )}
      {acting === "reject" && (
        <RejectForm giro={row} onDone={done} onCancel={() => setActing(null)} />
      )}
      {acting === "unclear" && (
        <UnclearForm
          giro={row}
          onDone={done}
          onCancel={() => setActing(null)}
        />
      )}
      {acting === "replace" && (
        <ReplaceForm
          giro={row}
          onDone={done}
          onCancel={() => setActing(null)}
        />
      )}
    </Card>
  )
}

/// The due tag: red when late or due today, a quiet neutral pill counting
/// down otherwise, and the settled date once the giro is Cleared or Bounced.
function DueTag({ row, bucket }: { row: GiroRow; bucket: Bucket }) {
  // A line of text, not a pill: colour only where somebody has to act.
  const line = (tone: "mute" | "bad" | "ok", text: string) => (
    <span
      className={
        tone === "bad"
          ? "text-[0.9375rem] text-bad-fg"
          : tone === "ok"
            ? "text-[0.9375rem] text-ok-fg"
            : "text-[0.9375rem] text-mute"
      }
    >
      {text}
    </span>
  )
  if (bucket === "CLEARED") {
    return line("ok", `Cleared ${day(row.cleared_on)}`)
  }
  if (bucket === "BOUNCED")
    return line("bad", `Bounced ${day(row.rejected_on)}`)
  const overdue = row.days_overdue
  if (overdue > 0)
    return line(
      "bad",
      `${count(overdue)} ${overdue === 1 ? "day" : "days"} late`
    )
  if (overdue === 0) return line("bad", "Due today")
  return line(
    "mute",
    `Due ${day(row.due_date)} · in ${count(-overdue)} ${-overdue === 1 ? "day" : "days"}`
  )
}

// ---------------------------------------------------------------------------
// The inline forms — unchanged in substance from the earlier panel, only
// moved onto the card
// ---------------------------------------------------------------------------

/// The bank took it, on the day the statement shows — never "today" by
/// default, since a statement read on Monday carries Friday's clearings.
function ClearForm({
  giro,
  onDone,
  onCancel,
}: {
  giro: GiroRow
  onDone: () => void
  onCancel: () => void
}) {
  const [on, setOn] = useState("")
  const clear = useMutation({
    mutationFn: () => clearGiro(giro.giro_id, on),
    onSuccess: onDone,
  })
  return (
    <div className="flex flex-col gap-3 rounded-inner bg-soft p-3">
      {clear.isError && (
        <Banner tone="bad">
          {problemOf(clear.error) ?? "The clearance could not be posted."}
        </Banner>
      )}
      <Field label="Into" hint="Fixed by the giro's own bank.">
        <Input value={giro.bank} disabled />
      </Field>
      <Field
        label="Cleared on"
        required
        hint="The day the bank took it, off the statement — not today."
      >
        <Day value={on} onChange={setOn} notAfter={todayIso()} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button data-cancel variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          pending={clear.isPending}
          disabled={on === ""}
          onClick={() => clear.mutate()}
        >
          Clear {money(giro.amount_minor)}
        </Button>
      </div>
    </div>
  )
}

/// It bounced, or we stopped it — from any state the bank has not already
/// taken it in, and also from Cleared (a bounce the statement shows after the
/// fact). Valid from Cleared per `giro_reject`, which takes the clearing back
/// first and then bounces it the ordinary way.
function RejectForm({
  giro,
  onDone,
  onCancel,
}: {
  giro: GiroRow
  onDone: () => void
  onCancel: () => void
}) {
  const [on, setOn] = useState("")
  const [reason, setReason] = useState("")
  const reject = useMutation({
    mutationFn: () => rejectGiro(giro.giro_id, on, reason.trim()),
    onSuccess: onDone,
  })
  const ready = on !== "" && reason.trim() !== ""
  return (
    <div className="flex flex-col gap-3 rounded-inner bg-soft p-3">
      {reject.isError && (
        <Banner tone="bad">
          {problemOf(reject.error) ?? "The bounce could not be recorded."}
        </Banner>
      )}
      <Field
        label="Bounce date"
        required
        hint="The day the bank returned it, or the day we stopped it."
      >
        <Day value={on} onChange={setOn} notAfter={todayIso()} />
      </Field>
      <Field label="Reason" required hint="The supplier is going to ask.">
        <Textarea
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button data-cancel variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="danger"
          size="sm"
          pending={reject.isPending}
          disabled={!ready}
          onClick={() => reject.mutate()}
        >
          Bounce
        </Button>
      </div>
    </div>
  )
}

/// Batal Cair: the clearing was wrong and is taken back into an open month —
/// only ever from Cleared.
function UnclearForm({
  giro,
  onDone,
  onCancel,
}: {
  giro: GiroRow
  onDone: () => void
  onCancel: () => void
}) {
  const [on, setOn] = useState("")
  const [reason, setReason] = useState("")
  const unclear = useMutation({
    mutationFn: () => unclearGiro(giro.giro_id, { on, reason: reason.trim() }),
    onSuccess: onDone,
  })
  const ready = on !== "" && reason.trim() !== ""
  return (
    <div className="flex flex-col gap-3 rounded-inner bg-soft p-3">
      {unclear.isError && (
        <Banner tone="bad">
          {problemOf(unclear.error) ?? "The clearing could not be taken back."}
        </Banner>
      )}
      <Field label="Taken back on" required hint="Into an open month.">
        <Day value={on} onChange={setOn} notBefore={giro.cleared_on} />
      </Field>
      <Field
        label="Reason"
        required
        hint="The bank balance moves by this — the next person to read the statement will ask why."
      >
        <Textarea
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button data-cancel variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="danger"
          size="sm"
          pending={unclear.isPending}
          disabled={!ready}
          onClick={() => unclear.mutate()}
        >
          Undo clearing
        </Button>
      </div>
    </div>
  )
}

/// Say which later payment or cash document settled what a bounced giro did
/// not — a short, own-drawn picker rather than a reach into the BKM/BKK
/// register, which is still being built.
function ReplaceForm({
  giro,
  onDone,
  onCancel,
}: {
  giro: GiroRow
  onDone: () => void
  onCancel: () => void
}) {
  const supplierName = useSupplierName()
  const [chosen, setChosen] = useState<string | null>(null)
  const [needle, setNeedle] = useState("")
  const q = useDebounced(needle.trim(), 300)
  const byPayment = giro.supplier_payment_id !== null

  const payments = useQuery({
    queryKey: [
      "finance",
      "giros",
      "replace-candidates",
      "payments",
      giro.unit_id,
      q,
    ],
    queryFn: ({ signal }) =>
      listPayments(
        { status: "POSTED", unit: giro.unit_id, q: q || undefined, limit: 20 },
        signal
      ),
    enabled: byPayment,
  })
  const documents = useQuery({
    queryKey: [
      "finance",
      "giros",
      "replace-candidates",
      "cash-documents",
      giro.direction,
      giro.unit_id,
    ],
    queryFn: ({ signal }) =>
      candidateCashDocuments(
        {
          kind: giro.direction === "OUT" ? "PAY" : "RECEIVE",
          unitId: giro.unit_id,
        },
        signal
      ),
    enabled: !byPayment,
  })

  const replace = useMutation({
    mutationFn: () =>
      replaceGiro(
        giro.giro_id,
        byPayment
          ? { payment_id: chosen ?? undefined }
          : { cash_document_id: chosen ?? undefined }
      ),
    onSuccess: onDone,
  })

  const paymentRows = payments.data?.rows ?? []
  const needleLower = needle.trim().toLowerCase()
  const documentRows = (documents.data ?? []).filter(
    (document) =>
      needleLower === "" ||
      (document.number ?? "").toLowerCase().includes(needleLower) ||
      document.party_name.toLowerCase().includes(needleLower)
  )

  return (
    <div className="flex flex-col gap-3 rounded-inner bg-soft p-3">
      {replace.isError && (
        <Banner tone="bad">
          {problemOf(replace.error) ?? "The replacement was refused."}
        </Banner>
      )}
      <Field
        label={byPayment ? "Replacing payment" : "Replacing cash document"}
        hint="Posted, and settling the same debt this giro did not."
      >
        <Input
          value={needle}
          onChange={(event) => setNeedle(event.target.value)}
        />
      </Field>
      <div className="max-h-48 overflow-y-auto rounded-inner border border-hairline">
        {byPayment ? (
          payments.isPending ? (
            <p className="p-3 text-[0.9375rem] text-mute">Reading payments…</p>
          ) : paymentRows.length === 0 ? (
            <p className="p-3 text-[0.9375rem] text-mute">
              No posted payment matches.
            </p>
          ) : (
            paymentRows.map((row) => (
              <button
                key={row.payment_id}
                type="button"
                onClick={() => setChosen(row.payment_id)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 border-b border-hairline px-3 py-2 text-left text-[0.9375rem] last:border-b-0 hover:bg-soft-2",
                  chosen === row.payment_id && "bg-soft-2"
                )}
              >
                <span className="min-w-0 truncate">
                  <span className="font-mono">{row.payment_number}</span>
                  <span className="ml-1.5 text-mute">
                    {day(row.payment_date)}
                  </span>
                </span>
                <span className="shrink-0 font-medium tabular-nums">
                  {money(row.total_minor)}
                </span>
              </button>
            ))
          )
        ) : documents.isPending ? (
          <p className="p-3 text-[0.9375rem] text-mute">
            Reading cash documents…
          </p>
        ) : documentRows.length === 0 ? (
          <p className="p-3 text-[0.9375rem] text-mute">
            No posted cash document matches.
          </p>
        ) : (
          documentRows.map((document) => (
            <button
              key={document.document_id}
              type="button"
              onClick={() => setChosen(document.document_id)}
              className={cn(
                "flex w-full items-center justify-between gap-2 border-b border-hairline px-3 py-2 text-left text-[0.9375rem] last:border-b-0 hover:bg-soft-2",
                chosen === document.document_id && "bg-soft-2"
              )}
            >
              <span className="min-w-0 truncate">
                <span className="font-mono">{document.number ?? "—"}</span>
                <span className="ml-1.5 text-mute">
                  {supplierName(document.party_name, document.party_name)}
                </span>
              </span>
              <span className="shrink-0 font-medium tabular-nums">
                {money(document.amount_minor)}
              </span>
            </button>
          ))
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button data-cancel variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          pending={replace.isPending}
          disabled={chosen === null}
          onClick={() => replace.mutate()}
        >
          Replace
        </Button>
      </div>
    </div>
  )
}
