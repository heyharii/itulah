import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState, Suspense } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { useLayout } from "@/lib/layout"
import { Fab } from "@/components/ui/fab"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input } from "@/components/ui/field"
import { Toggle } from "@/components/ui/form"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Sheet, Fact, Facts } from "@/components/ui/sheet"
import {
  Banner,
  EmptyState,
  Problem,
  LoadingState,
} from "@/components/ui/states"
import {
  defineShift,
  retireShift,
  rosterKeys,
  type NewShift,
  shiftsQuery,
} from "@/lib/queries/people"
import { useCanWrite } from "@/lib/session"
import { CardFigure, CardFoot, CardName } from "@/components/ui/phone-cards"
import { tableSetup, type TableSetup } from "@/lib/table"
import { SheetFooter } from "@/screens/people/settings-kit"
import { useOpener } from "@/screens/people/settings-lib"
import type { ShiftView } from "@itulah/contract"

const columns: ColumnDef<TableSetup, ShiftView>[] = [
  {
    id: "pattern",
    accessorFn: (row) => row.name,
    header: "Pattern",
    size: 280,
    meta: { card: "hide" },
    cell: ({ row }) => (
      <>
        {row.original.name}
        <span className="ml-2 font-mono text-id font-normal text-mute">
          {row.original.id}
        </span>
      </>
    ),
  },
  {
    accessorKey: "starts_at",
    header: "Starts",
    size: 140,
    meta: { card: "hide" },
    cell: ({ row }) => (
      <span className="font-mono text-id">{row.original.starts_at}</span>
    ),
  },
  {
    accessorKey: "ends_at",
    header: "Ends",
    size: 200,
    meta: { card: "hide" },
    cell: ({ row }) => (
      <>
        <span className="font-mono text-id">{row.original.ends_at}</span>
        {row.original.crosses_midnight && (
          <Pill tone="info" className="ml-1.5">
            Overnight
          </Pill>
        )}
      </>
    ),
  },
  {
    id: "break",
    accessorFn: (row) => row.unpaid_break_minutes,
    header: "Break",
    size: 160,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) => breakText(row.original),
  },
  {
    id: "paid",
    accessorFn: (row) => row.planned_work_minutes,
    header: "Paid",
    size: 120,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) => paidTime(row.original.planned_work_minutes),
  },
  // Three columns that exist only on a card (`cardLead`; a phone): the name
  // over its code, the paid time as the figure, and the hours under it.
  {
    id: "head",
    accessorFn: (row) => row.name,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "title" },
    cell: ({ row }) => (
      <CardName name={row.original.name} code={row.original.id} />
    ),
  },
  {
    id: "lead",
    accessorFn: (row) => row.planned_work_minutes,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "lead" },
    cell: ({ row }) => (
      <CardFigure
        value={paidTime(row.original.planned_work_minutes)}
        caption="paid"
      />
    ),
  },
  {
    id: "foot",
    accessorFn: (row) => row.starts_at,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) => (
      <CardFoot
        status={
          row.original.crosses_midnight ? (
            <Pill tone="info">Overnight</Pill>
          ) : undefined
        }
      >
        {row.original.starts_at} – {row.original.ends_at}
        {row.original.unpaid_break_minutes !== 0 &&
          ` · break ${breakText(row.original)}`}
      </CardFoot>
    ),
  },
]

/// Settings › Shifts — the patterns a roster is built out of.
///
/// A shop that could invent its own idea of "Pagi" is a shop whose attendance
/// cannot be compared with the shop beside it, so patterns are set once, by
/// head office. A pattern is retired, never deleted: a roster day names its
/// shift, and last March's roster must still read back.
export function ShiftSettings() {
  const canWrite = useCanWrite()
  const phone = useLayout() === "phone"
  const create = useOpener()
  const detail = useOpener<ShiftView>()

  return (
    <PageContent>
      {canWrite && <Fab label="New shift" onClick={() => create.show()} />}
      <PageHeader
        crumb="People"
        title="Shifts"
        sub="The hours a rostered day is worth. Set once for every place, so one shop's Morning means the same as the next."
        actions={
          !phone &&
          canWrite && (
            <Button variant="primary" onClick={() => create.show()}>
              New shift
            </Button>
          )
        }
      />

      <Card className="mb-4 overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        <Suspense fallback={<LoadingState>Loading the patterns…</LoadingState>}>
          <Patterns detail={detail} />
        </Suspense>
      </Card>

      <NewShiftSheet
        key={`new-${create.n}`}
        open={create.isOpen}
        onClose={create.hide}
      />
      <ShiftSheet
        key={`one-${detail.n}`}
        open={detail.isOpen}
        onClose={detail.hide}
        shift={detail.item}
        canWrite={canWrite}
      />
    </PageContent>
  )
}

/// The patterns, as a table. Here and not in the screen so the head paints at
/// once and this waits alone for its answer.
function Patterns({
  detail,
}: {
  detail: ReturnType<typeof useOpener<ShiftView>>
}) {
  const shifts = useSuspenseQuery(shiftsQuery())
  const phone = useLayout() === "phone"
  const patterns = shifts.data
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: patterns,
        columns,
        getRowId: (row: ShiftView) => row.id,
        // The card's own columns are drawn on a phone and never on a desk.
        state: { columnVisibility: { head: phone, lead: phone, foot: phone } },
      }),
      [patterns, phone]
    )
  )
  return patterns.length === 0 ? (
    <EmptyState>
      No pattern is defined. A roster cannot be built until one exists — add the
      first with New shift.
    </EmptyState>
  ) : (
    <DataTable<ShiftView>
      refresh={[shifts]}
      table={table}
      onRowClick={(pattern) => detail.show(pattern)}
      isSelected={(pattern) => detail.isOpen && pattern.id === detail.item?.id}
      cardsApart
      cardLead
      cardSort={false}
    />
  )
}

/// `planned_work_minutes` as hours and minutes. The server computes it — the
/// span less the break — and the screen never recomputes it.
function paidTime(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

function breakText(pattern: ShiftView): string {
  if (pattern.unpaid_break_minutes === 0) return "—"
  return pattern.break_starts_at === null
    ? `${pattern.unpaid_break_minutes}m`
    : `${pattern.unpaid_break_minutes}m from ${pattern.break_starts_at}`
}

/// One pattern: what it is worth, and the one thing that can be done to it.
function ShiftSheet({
  open,
  onClose,
  shift,
  canWrite,
}: {
  open: boolean
  onClose: () => void
  shift: ShiftView | null
  canWrite: boolean
}) {
  const client = useQueryClient()
  const [asked, setAsked] = useState(false)
  const retire = useMutation({
    mutationFn: () => retireShift(shift?.id ?? ""),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: rosterKeys.shifts() })
      onClose()
    },
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      id={shift?.id}
      title={shift?.name ?? "Shift"}
      footer={
        <SheetFooter
          onCancel={onClose}
          danger={
            canWrite &&
            shift &&
            (asked ? (
              <Button
                variant="danger"
                pending={retire.isPending}
                onClick={() => retire.mutate()}
              >
                Yes, retire it
              </Button>
            ) : (
              <Button variant="danger" onClick={() => setAsked(true)}>
                Retire
              </Button>
            ))
          }
        />
      }
    >
      {shift && (
        <div className="flex flex-col gap-4">
          <Facts>
            <Fact term="Starts">{shift.starts_at}</Fact>
            <Fact term="Ends">
              {shift.ends_at}
              {shift.crosses_midnight ? " (next day)" : ""}
            </Fact>
            <Fact term="Unpaid break">{breakText(shift)}</Fact>
            <Fact term="Paid time">{paidTime(shift.planned_work_minutes)}</Fact>
          </Facts>
          {asked && (
            <Banner tone="warn">
              Retiring takes this pattern out of tomorrow&rsquo;s choices.
              Rosters that already use it keep it, so past months stay legible.
            </Banner>
          )}
          <Problem error={retire.error} />
        </div>
      )}
    </Sheet>
  )
}

const BLANK: NewShift = {
  id: "",
  name: "",
  startsAt: "",
  endsAt: "",
  crossesMidnight: false,
  unpaidBreakMinutes: 60,
  breakStartsAt: "",
}

/// `HH:MM`, the way a rota is read off a wall. Checked here as well as on the
/// server so the refusal arrives before the round trip.
function isClockTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

function NewShiftSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const [draft, setDraft] = useState<NewShift>(BLANK)
  const set = (patch: Partial<NewShift>) =>
    setDraft((prev) => ({ ...prev, ...patch }))

  const define = useMutation({
    mutationFn: () => defineShift(draft),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: rosterKeys.shifts() })
      onClose()
    },
  })

  const timesRead = isClockTime(draft.startsAt) && isClockTime(draft.endsAt)
  const breakRead =
    draft.breakStartsAt.trim() === "" || isClockTime(draft.breakStartsAt.trim())
  const ready =
    draft.id.trim() !== "" && draft.name.trim() !== "" && timesRead && breakRead
  // Ending before it starts is either an overnight shift or a typo, and the two
  // are one keystroke apart. The form says which reading it is taking.
  const wrapsAround =
    timesRead && draft.endsAt <= draft.startsAt && !draft.crossesMidnight

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="New shift"
      footer={
        <SheetFooter
          onCancel={onClose}
          onSave={() => define.mutate()}
          saveLabel="Define"
          pendingLabel="Defining…"
          pending={define.isPending}
          disabled={!ready}
        />
      }
    >
      <div className="flex flex-col gap-3.5">
        <Problem error={define.error} />
        {wrapsAround && (
          <Banner tone="warn">
            This pattern ends at or before it starts. That is an overnight shift
            — switch &ldquo;Runs past midnight&rdquo; on — or it is a typo. It
            is not guessed at.
          </Banner>
        )}
        <Field
          label="Code"
          hint="What a roster day names. It never changes."
          required
        >
          <Input
            value={draft.id}
            onChange={(event) => set({ id: event.target.value })}
          />
        </Field>
        <Field label="Name" required>
          <Input
            value={draft.name}
            onChange={(event) => set({ name: event.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts" hint="24-hour clock, HH:MM." required>
            <Input
              value={draft.startsAt}
              onChange={(event) => set({ startsAt: event.target.value })}
            />
          </Field>
          <Field label="Ends" required>
            <Input
              value={draft.endsAt}
              onChange={(event) => set({ endsAt: event.target.value })}
            />
          </Field>
        </div>
        <Field
          label="Unpaid break, in minutes"
          hint="Taken out of the paid span. Zero is a pattern with no break."
        >
          <Input
            type="number"
            min={0}
            value={draft.unpaidBreakMinutes}
            onChange={(event) =>
              set({
                unpaidBreakMinutes: Math.max(
                  0,
                  Number(event.target.value) || 0
                ),
              })
            }
          />
        </Field>
        <Field
          label="Break starts"
          hint="HH:MM, inside the shift. Leave empty when the break is taken whenever the floor allows."
        >
          <Input
            value={draft.breakStartsAt}
            onChange={(event) => set({ breakStartsAt: event.target.value })}
          />
        </Field>
        <Toggle
          on={draft.crossesMidnight}
          onToggle={() => set({ crossesMidnight: !draft.crossesMidnight })}
          label="Runs past midnight"
          note={
            draft.crossesMidnight
              ? "The shift ends on the following day."
              : "The shift starts and ends on the same day."
          }
        />
      </div>
    </Sheet>
  )
}
