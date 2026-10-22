import { DocStamp } from "@/components/ui/doc-stamp"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronRight, Search } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ConfirmButton } from "@/components/ui/dialog"
import { Input, Select } from "@/components/ui/field"
import { ChoiceMenu } from "@/components/ui/list-chrome"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Segmented } from "@/components/ui/segmented"
import { Fab } from "@/components/ui/fab"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Collapsible } from "@base-ui/react/collapsible"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Tag } from "@/components/ui/tag"
import { EmptyState, Problem } from "@/components/ui/states"
import { Timeline, type TimelineEvent } from "@/components/ui/timeline"
import { count, day, money, quantity, sku as skuNumber } from "@/lib/format"
import { useAppNavigate } from "@/lib/navigate"
import { pullIn, useSaid } from "@/lib/pull-in"
import {
  fleetPools,
  idempotencyKey,
  inventoryKeys,
  poolAvailability,
} from "@/lib/queries/inventory"
import {
  procurementKeys,
  purchaseDestinations,
  purchaseOrderPage,
  purchaseReturns,
} from "@/lib/queries/procurement"
import {
  REASON_LABEL,
  SETTLE_LABEL,
  STATUS_LABEL,
  closeShort,
  createSupplierReturn,
  expectsReplacement,
  isReplacementPo,
  raiseReplacementOrder,
  returnProof,
  skuSuppliers,
  supplierReturnKeys,
  supplierReturns,
  type SettleBy,
  type SupplierReturn,
  type SupplierReturnReason,
} from "@/lib/queries/supplier-returns"
import { queryState } from "@/lib/query-state"
import { useNameOfLogin } from "@/lib/queries/hr-employees"
import { useSheet } from "@/lib/sheets"
import { cn } from "@/lib/utils"
import { sourcePoolsFor } from "@/screens/inventory/shared"
import { titled, type Paper } from "@/screens/procurement/po-print"
import { PrintMenu } from "@/screens/procurement/print-menu"
import { openPrintWindow, printInto } from "@/screens/procurement/print"
import {
  groupBySupplier,
  type Group,
  ReturnGroups,
  usePoDates,
} from "@/screens/procurement/supplier-return-groups"
import { downloadReturnPdf } from "@/screens/procurement/return-pdf"
import {
  useReturnNoteLink,
  withNoteLink,
} from "@/screens/procurement/return-note-link"
import {
  supplierReturnHtml,
  type PrintableNote,
} from "@/screens/procurement/return-print"
import {
  foldLines,
  NOT_AS_ORDERED_ROW,
  returnLineParts,
  UNKNOWN_NOTE,
} from "@/screens/procurement/return-lines"
import { useActor } from "@/screens/procurement/shared"
import {
  useSupplierContact,
  useSupplierName,
} from "@/screens/procurement/supplier-name"

/// Buying › Return PO.
///
/// Two books in one list: returns out of HO return stock (over-delivery,
/// items that don't match the order — the supplier owes something back,
/// tracked in rupiah until nothing is owed) and over-delivery returns raised
/// from a PO (nothing comes back; they close when the warehouse hands the goods
/// over). Confirming a return of the first book issues its surat — the
/// numbered return delivery note, QR-tracked, the supplier signs against.

/// Where a return stands (owner, 16 Oct 2026): To be returned → In progress
/// (its delivery note is generated) → Completed.
type Tab = "todo" | "progress" | "closed"
function stageOf(row: Row): Tab {
  if (!row.open) return "closed"
  return row.noteAt !== null ? "progress" : "todo"
}
type Tone = "ok" | "warn" | "bad" | "info" | "accent" | "neutral" | "done"

/// One line of the list, whichever book it came from.
export interface Row {
  readonly id: string
  readonly number: string
  readonly supplier: string
  readonly reason: string
  readonly reference: string | null
  /// Where the supplier is and how to reach them, for the delivery note's
  /// "Kepada"; null where the supplier book has neither.
  readonly address: string | null
  readonly phone: string | null
  /// The order's id, for the link into its sheet; null where the book has none.
  readonly poId: string | null
  readonly pcs: number
  readonly settleBy: SettleBy | null
  readonly valueMinor: number
  readonly settledMinor: number
  readonly owedMinor: number
  readonly byKind: Readonly<Partial<Record<SettleBy, number>>>
  readonly status: string
  readonly tone: Tone
  readonly open: boolean
  readonly raisedAt: string
  readonly raisedBy: string
  readonly handedOverAt: string | null
  readonly lines: readonly {
    sku: string
    name: string | null
    qty: number
    cost: number
    /// Pieces that are not the order's article: nobody can name them.
    unknown?: boolean
  }[]
  readonly settlements: SupplierReturn["settlements"]
  readonly closedShortReason: string | null
  readonly canCloseShort: boolean
  /// The surat issued when the return was confirmed, if the row is a
  /// cloud-book return — over-delivery rows raised from a PO have none.
  readonly letterId: string | null
  readonly letterNumber: string | null
  /// The warehouse's person in charge of the hand-over, and when the delivery note
  /// was generated — both null until it is. Only an over-delivery return has
  /// them; the register's problem-goods returns leave through the picklist.
  readonly pic: string | null
  readonly noteAt: string | null
  /// A few words per item on the note, by article code (`UNKNOWN_NOTE` for
  /// the not-as-ordered pieces), written when it was generated.
  readonly lineNotes: Readonly<Record<string, string>>
  /// The return itself, for the actions that raise something from it.
  readonly raw: SupplierReturn | null
}

const KIND_BAR: Record<SettleBy, string> = {
  REPLACEMENT: "bg-accent",
  REFUND: "bg-ok",
  CREDIT_NOTE: "bg-info",
}

const STATUS_TONE: Record<SupplierReturn["status"], Tone> = {
  TO_HAND_OVER: "neutral",
  WAITING: "warn",
  PARTLY_SETTLED: "accent",
  SETTLED: "ok",
  CLOSED_SHORT: "bad",
}

function fromSupplierReturn(
  r: SupplierReturn,
  supplierName: ReturnType<typeof useSupplierName>,
  contact: ReturnType<typeof useSupplierContact>,
  person: (login: string) => string
): Row {
  const byKind: Partial<Record<SettleBy, number>> = {}
  for (const s of r.settlements) {
    byKind[s.kind] = (byKind[s.kind] ?? 0) + s.amount_minor
  }
  return {
    id: r.allotment_id,
    number: r.allotment_number,
    supplier: supplierName(r.supplier_id, r.supplier_name),
    reason: REASON_LABEL[r.reason],
    reference: null,
    ...contact(r.supplier_id, r.supplier_name),
    poId: null,
    pcs: r.quantity,
    settleBy: r.settle_by,
    valueMinor: r.value_minor,
    settledMinor: r.settled_minor,
    owedMinor: r.owed_minor,
    byKind,
    status: STATUS_LABEL[r.status],
    tone: STATUS_TONE[r.status],
    open: !["SETTLED", "CLOSED_SHORT"].includes(r.status),
    raisedAt: r.raised_at,
    raisedBy: person(r.raised_by),
    handedOverAt: r.handed_over_at,
    lines: r.lines.map((l) => ({
      sku: l.sku_code,
      name: l.article_name,
      qty: l.quantity,
      cost: l.unit_cost_minor,
    })),
    settlements: r.settlements,
    closedShortReason: r.closed_short_reason,
    canCloseShort: ["WAITING", "PARTLY_SETTLED"].includes(r.status),
    letterId: r.letter_id,
    pic: null,
    noteAt: null,
    lineNotes: {},
    letterNumber: r.letter_number,
    raw: r,
  }
}

/// Rupiah settled, one colour per kind, and what is still owed.
function Settled({ row, wide }: { row: Row; wide?: boolean }) {
  if (row.settleBy === null) {
    return <span className="text-mute">None needed</span>
  }
  if (row.handedOverAt === null || row.valueMinor === 0) {
    return <span className="text-mute">—</span>
  }
  const kinds = Object.entries(row.byKind) as [SettleBy, number][]
  return (
    <span className={wide ? "block" : "block py-1"}>
      <span className="flex h-1.5 w-full max-w-48 overflow-hidden rounded-full bg-soft-2">
        {kinds.map(([kind, amount]) => (
          <span
            key={kind}
            className={KIND_BAR[kind]}
            style={{
              width: `${Math.min(100, (amount / row.valueMinor) * 100)}%`,
            }}
          />
        ))}
      </span>
      <span className="mt-1.5 block tabular-nums">
        <span className="text-ink">{money(row.settledMinor)}</span>
        {row.owedMinor > 0 && (
          <span className="text-warn-fg"> · {money(row.owedMinor)} owed</span>
        )}
      </span>
    </span>
  )
}

/// Every return the warehouse and head office know of, as one list of rows: the
/// register of supplier returns and the over-delivery returns raised from a PO.
/// Shared with the Return to supplier board, whose cards open the same sheet.
export function useReturnRows() {
  const returns = useQuery({
    queryKey: supplierReturnKeys.list(),
    queryFn: ({ signal }) => supplierReturns(signal),
  })
  const over = useQuery({
    queryKey: procurementKeys.returns(),
    queryFn: ({ signal }) => purchaseReturns(undefined, signal),
  })

  const supplierName = useSupplierName()
  const contact = useSupplierContact()
  const nameOfLogin = useNameOfLogin()
  /// A person as the screens write one: the full name, in Title Case — never the
  /// login ("candra") the server keeps.
  const person = (login: string) => titled(nameOfLogin(login))
  const all = useMemo<Row[]>(() => {
    const own = (returns.data ?? []).map((r) =>
      fromSupplierReturn(r, supplierName, contact, person)
    )
    const excess = (over.data ?? []).map<Row>((r) => ({
      id: r.return_id,
      number: r.return_number,
      supplier: supplierName(r.supplier_id, r.supplier_name),
      reason: r.lines.every((l) => (l.wrong_quantity ?? 0) >= l.quantity)
        ? "Not as ordered"
        : r.lines.some((l) => (l.wrong_quantity ?? 0) > 0)
          ? "Over-delivery · Not as ordered"
          : "Over-delivery",
      reference: r.po_number,
      ...contact(r.supplier_id, r.supplier_name),
      poId: r.purchase_order_id,
      pcs: r.quantity,
      settleBy: null,
      valueMinor: 0,
      settledMinor: 0,
      owedMinor: 0,
      byKind: {},
      status: r.status === "OPEN" ? "To hand over" : "Completed",
      tone: r.status === "OPEN" ? "neutral" : "done",
      open: r.status === "OPEN",
      raisedAt: r.raised_at,
      raisedBy: person(r.raised_by),
      handedOverAt: r.handed_over_at,
      lines: r.lines.flatMap((l) =>
        returnLineParts(l).map((part) => ({
          sku: part.sku,
          name: part.name,
          qty: part.qty,
          cost: 0,
          unknown: part.unknown,
        }))
      ),
      settlements: [],
      closedShortReason: null,
      canCloseShort: false,
      letterId: null,
      pic: r.note_pic ?? null,
      noteAt: r.note_generated_at ?? null,
      lineNotes: r.line_notes ?? {},
      letterNumber: null,
      raw: null,
    }))
    return [...own, ...excess]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returns.data, over.data, supplierName, contact, nameOfLogin])
  return { all, returns, over }
}

/// How the Completed tab is ordered.
interface ClosedOrder {
  readonly by: "completed" | "po"
  readonly desc: boolean
}

const CLOSED_ORDERS = [
  { value: "completed:desc", label: "Completed date, newest" },
  { value: "completed:asc", label: "Completed date, oldest" },
  { value: "po:desc", label: "PO number, Z–A" },
  { value: "po:asc", label: "PO number, A–Z" },
]

/// The returns in one order across suppliers; a supplier's run of rows stays
/// one group so a phone card still names whose they are.
function inOrder(groups: readonly Group[], order: ClosedOrder): Group[] {
  const key = (row: Group["rows"][number]) =>
    order.by === "po" ? (row.reference ?? row.number) : (row.handedOverAt ?? "")
  const rows = groups
    .flatMap((group) => group.rows)
    .sort((left, right) => {
      const said = key(left).localeCompare(key(right), undefined, {
        numeric: true,
      })
      return order.desc ? -said : said
    })
  const out: { supplier: string; rows: Group["rows"][number][] }[] = []
  for (const row of rows) {
    const last = out[out.length - 1]
    if (last?.supplier === row.supplier) last.rows.push(row)
    else out.push({ supplier: row.supplier, rows: [row] })
  }
  return out
}

export function SupplierReturns() {
  const [tab, setTab] = useState<Tab>("todo")
  const [asking, setAsking] = useState(false)
  const sheet = useSheet("allotment")
  /// What was typed in the search, in the URL like the order list's: a supplier,
  /// a return's number or the order it came from.
  const search = useSheet("q")
  const needle = (search.value ?? "").trim().toLowerCase()

  const { all, returns, over } = useReturnRows()

  const owed = all.reduce((sum, row) => sum + row.owedMinor, 0)
  const rows = useMemo(
    () =>
      all.filter(
        (row) =>
          stageOf(row) === tab &&
          (needle === "" ||
            [row.supplier, row.number, row.reference ?? ""].some((text) =>
              text.toLowerCase().includes(needle)
            ))
      ),
    [all, tab, needle]
  )
  const opened = all.find((row) => row.id === sheet.value) ?? null

  const poDates = usePoDates()
  /// Completed reads as a register (owner, 18 Oct 2026): by PO number or by
  /// the day it was completed, newest first until someone asks otherwise.
  const [order, setOrder] = useState<ClosedOrder>({
    by: "completed",
    desc: true,
  })
  const groups = useMemo(
    () =>
      tab === "closed"
        ? inOrder(groupBySupplier(rows, poDates), order)
        : groupBySupplier(rows, poDates),
    [rows, poDates, tab, order]
  )

  if (asking) return <NewReturn onDone={() => setAsking(false)} />

  const byStage = (stage: Tab) => all.filter((row) => stageOf(row) === stage)
  const todo = byStage("todo")
  const progress = byStage("progress")
  const closed = byStage("closed")
  const pcsOf = (list: readonly Row[]) =>
    list.reduce((sum, row) => sum + row.pcs, 0)

  return (
    <PageContent>
      <PageHeader title="Return PO" />

      {/* The book at a glance, as Allotments reads it (owner, 16 Oct 2026). */}
      <KpiStrip className="grid-cols-2 md:grid-cols-4 xl:grid-cols-4">
        <Kpi label="To be returned" value={`${quantity(pcsOf(todo))}`} />
        <Kpi label="In progress" value={`${quantity(pcsOf(progress))}`} />
        <Kpi label="Completed" value={`${quantity(pcsOf(closed))}`} />
        <Kpi label="Suppliers owe" value={money(owed)} />
      </KpiStrip>

      <div className="flex flex-wrap items-end justify-between gap-x-6">
        <SubTabs
          // Hidden on a phone: the status is the button in the drawer over the
          // bottom bar (`DockTools`), as on the order list (owner, 2026-10-05).
          className="max-md:hidden"
          value={tab}
          onChange={(next) => setTab(next as Tab)}
          tabs={[
            { value: "todo", label: `To be returned ${count(todo.length)}` },
            {
              value: "progress",
              label: "In progress",
              alert: progress.length,
            },
            { value: "closed", label: `Completed ${count(closed.length)}` },
          ]}
        />
      </div>

      {/* The same search and the same New return as every list: a field and a
          button here, the dock's field and round "+" on a phone. */}
      <div className="mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2 max-md:hidden md:flex-nowrap">
        <span className="relative min-w-[11rem] flex-1 lg:max-w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-line-ico" />
          <input
            value={search.value ?? ""}
            onChange={(event) =>
              event.target.value
                ? search.open(event.target.value)
                : search.close()
            }
            aria-label="Search returns"
            className="h-[2.125rem] w-full rounded-inner border border-hairline-2 bg-canvas pr-2.5 pl-8 text-[0.9375rem] text-ink shadow-soft outline-none placeholder:text-body focus:border-accent"
          />
        </span>
        <span className="flex-1" />
        {tab === "closed" && (
          <ChoiceMenu
            heading="Sort by"
            value={`${order.by}:${order.desc ? "desc" : "asc"}`}
            options={CLOSED_ORDERS}
            onChange={(next) => {
              const [by, way] = (next ?? "completed:desc").split(":")
              setOrder({ by: by as ClosedOrder["by"], desc: way === "desc" })
            }}
          />
        )}
        <Button variant="primary" onClick={() => setAsking(true)}>
          New return
        </Button>
      </div>
      <Fab label="New Return" onClick={() => setAsking(true)} />
      <DockTools
        search={{
          value: search.value ?? "",
          onChange: (next) => (next ? search.open(next) : search.close()),
          label: "Search Returns",
        }}
        status={{
          value: tab,
          options: [
            { value: "todo", label: "To be returned", count: todo.length },
            { value: "progress", label: "In progress", count: progress.length },
            { value: "closed", label: "Completed", count: closed.length },
          ],
          onChange: (next) => setTab(next as Tab),
        }}
        sort={
          tab === "closed"
            ? {
                label: order.by === "po" ? "PO number" : "Completed date",
                choices: {
                  options: [
                    { value: "completed", label: "Completed date" },
                    { value: "po", label: "PO number" },
                  ],
                  value: order.by,
                  desc: order.desc,
                  onChange: (by, desc) =>
                    setOrder({ by: by as ClosedOrder["by"], desc }),
                },
              }
            : undefined
        }
      />

      {queryState(returns, {
        loading: "Reading the returns…",
        render: () =>
          groups.length === 0 ? (
            <EmptyState>Nothing here.</EmptyState>
          ) : (
            // A card per supplier, as Operations draws it (owner, 2026-10-05),
            // with who is in charge and where each return stands. Reading
            // only: the delivery note is made and confirmed in Operations.
            <ReturnGroups
              groups={groups}
              selected={sheet.value}
              onOpen={sheet.open}
              showPic={false}
              refresh={[returns, over]}
            />
          ),
      })}

      <ReturnSheet row={opened} onClose={sheet.close} />
    </PageContent>
  )
}

/// Returns as one note for their supplier, made today. Prepared by whoever
/// raised the first of them.
export function noteOf(
  returns: readonly Row[],
  pic?: string | null
): PrintableNote {
  return {
    supplier: returns[0]?.supplier ?? "",
    address: returns[0]?.address ?? null,
    phone: returns[0]?.phone ?? null,
    date: returns[0]?.noteAt ?? new Date().toISOString(),
    pic,
    returns: returns.map((one) => ({
      number: one.number,
      reason: one.reason,
      reference: one.reference,
      lines: one.lines,
      notes: one.lineNotes,
    })),
    // One finished return: the note wears the stamp its sheet does.
    stamp:
      returns.length === 1 && !returns[0].open
        ? {
            word:
              returns[0].status === "Closed short"
                ? "CLOSED SHORT"
                : "COMPLETED",
            at:
              [
                ...returns[0].settlements.map((one) => one.recorded_at),
                returns[0].handedOverAt ?? "",
              ]
                .sort()
                .at(-1) || null,
          }
        : undefined,
  }
}

/// Print the note. Call it straight from the click: a window opened after an
/// await is blocked as a pop-up.
export function printReturnNote(note: PrintableNote, paper?: Paper) {
  const view = openPrintWindow()
  if (view !== null) printInto(view, supplierReturnHtml(note, paper))
}

/// Print or Download PDF from the Print sheet, as the PO's (owner, 2026-10-18).
export function ReturnPrintMenu({
  note,
  iconOnly,
}: {
  note: PrintableNote
  iconOnly?: boolean
}) {
  return (
    <PrintMenu
      title={note.number ?? undefined}
      iconOnly={iconOnly}
      onChoose={({ paper, pdf }) =>
        pdf ? downloadReturnPdf(note, paper) : printReturnNote(note, paper)
      }
    />
  )
}

export function ReturnSheet({
  row,
  onClose,
  extra,
  form,
  notes,
}: {
  row: Row | null
  onClose: () => void
  /// A step this return can take where the sheet is opened — the board's
  /// "Confirm handed over" — standing in the foot beside Close short.
  extra?: React.ReactNode
  /// A form at the head of the sheet's body — the board's Person in Charge,
  /// asked before the note can be generated.
  form?: React.ReactNode
  /// Each item's note being written before the note is generated (the
  /// board's); without it the sheet reads the notes the return was given.
  notes?: {
    readonly value: Readonly<Record<string, string>>
    readonly onChange: (sku: string, text: string) => void
  }
}) {
  const client = useQueryClient()
  // The photo taken when the return was confirmed, once it is done.
  const proof = useQuery({
    queryKey: supplierReturnKeys.proof(row?.id ?? ""),
    queryFn: ({ signal }) => returnProof(row!.id, signal),
    enabled: row !== null && (row.handedOverAt !== null || !row.open),
    staleTime: 60_000,
  })
  // The note's public link (its QR) is made as soon as the sheet shows the
  // note, so Print and Download below stay synchronous. A sheet that leaves
  // the note to its own step (`extra`) makes it there.
  const link = useReturnNoteLink(
    row && extra === undefined ? noteOf([row], row.pic) : null
  )
  const expectSaid = useSaid()
  const short = useMutation({
    mutationFn: (reason: string) => closeShort(row!.id, reason),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: supplierReturnKeys.all })
      // A confirm dialog has no plain button to say it from: toast only.
      void pullIn({
        from: null,
        pill: "Closed short",
        title: `${row!.number} closed short`,
      })
    },
  })

  const raw = row?.raw ?? null
  const go = useAppNavigate()
  const destinations = useQuery({
    queryKey: procurementKeys.destinations(),
    queryFn: ({ signal }) => purchaseDestinations(signal),
    enabled: raw !== null && expectsReplacement(raw),
  })
  const actor = useActor()
  // The orders raised for this return's replacement, found by their number.
  const replacements = useQuery({
    queryKey: procurementKeys.ordersPage({ q: raw?.allotment_number }),
    queryFn: ({ signal }) =>
      purchaseOrderPage({ q: raw!.allotment_number }, signal),
    enabled: raw !== null,
    select: (page) =>
      page.rows.filter((one) =>
        isReplacementPo(one.po_number, raw!.allotment_number)
      ),
  })
  const onOrder = replacements.data ?? []
  const waitingOn = onOrder.some(
    (one) =>
      one.lifecycle === "ACTIVE" || one.lifecycle === "PARTIALLY_RECEIVED"
  )
  const expect = useMutation({
    mutationFn: () => {
      const site =
        destinations.data?.find((one) => one.node_role === "DC") ??
        destinations.data?.[0]
      if (site === undefined) throw new Error("No warehouse to deliver to.")
      return raiseReplacementOrder(raw!, site.site_id, actor, onOrder.length)
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: procurementKeys.orders() })
      // The button says it, the sheet closes, the toast keeps it (owner,
      // 2026-10-10: pull in + toast).
      void expectSaid.say("Expected").then(() => {
        onClose()
        expectSaid.reset()
        void pullIn({
          from: expectSaid.start(),
          pill: "Replacement",
          title: `${row?.number ?? "Return"} replacement expected`,
        })
      })
    },
  })

  /// The items as the delivery note lists them, so the sheet and the paper
  /// read the same: one row per item, the not-as-ordered pieces on one row.
  const folded = foldLines(row?.lines ?? [])
  const history: TimelineEvent[] = []
  if (row) {
    history.push({
      id: "raised",
      title: "Raised",
      detail: row.raisedBy,
      at: day(row.raisedAt),
      state: "done",
    })
    if (row.letterId) {
      history.push({
        id: "surat",
        title: `Surat ${row.letterNumber ?? "issued"}`,
        detail: "Return delivery note for the supplier to sign",
        at: day(row.raisedAt),
        state: "done",
      })
    }
    history.push(
      row.handedOverAt
        ? {
            id: "handed",
            title: "Handed over",
            at: day(row.handedOverAt),
            state: "done",
          }
        : { id: "handed", title: "To hand over", state: "current" }
    )
    onOrder.forEach((one) => {
      history.push({
        id: one.purchase_order_id,
        title: `Replacement on PO ${one.po_number}`,
        at: day(one.issued_at),
        state:
          one.lifecycle === "ACTIVE" || one.lifecycle === "PARTIALLY_RECEIVED"
            ? "current"
            : "done",
      })
    })
    row.settlements.forEach((s, index) => {
      history.push({
        id: `s${index}`,
        title:
          s.kind === "REPLACEMENT"
            ? `Replacement · ${count(s.quantity)} pcs · ${money(s.amount_minor)}`
            : `${SETTLE_LABEL[s.kind]} · ${money(s.amount_minor)}`,
        detail: [s.reference, s.recorded_by].filter(Boolean).join(" · "),
        at: day(s.recorded_at),
        state: "done",
      })
    })
    if (row.settleBy === null && row.handedOverAt) {
      history.push({ id: "end", title: "Closed", state: "done" })
    } else if (row.status === "Settled") {
      history.push({ id: "end", title: "Settled", state: "done" })
    } else if (row.status === "Closed short") {
      history.push({
        id: "end",
        title: "Closed short",
        detail: row.closedShortReason,
        state: "done",
      })
    }
  }

  return (
    <>
      <Sheet
        open={row !== null}
        onOpenChange={(next) => !next && onClose()}
        title={row?.supplier ?? "Return"}
        id={row?.number}
        // Number over supplier, and the kind of return as a tag under them
        // (owner, 2026-10-05; under, not beside, 2026-10-10: beside, it and the
        // Print / Download buttons squeezed the supplier's name to "Garmen
        // Nusantar…" on the rail). The status is the stamp in the body and the
        // pieces and value are in the table, so neither is said again here.
        caption={
          row && (
            <Tag tone={row.reason === "Over-delivery" ? "warn" : "bad"}>
              {titled(row.reason.replace(/-/g, " "))}
            </Tag>
          )
        }
        actions={
          // With a step of its own in the foot (the board's Generate / Print /
          // Download / Confirm) the note's buttons live there instead.
          row &&
          extra === undefined && (
            <ReturnPrintMenu
              note={withNoteLink(noteOf([row], row.pic), link)}
            />
          )
        }
        footer={
          extra !== undefined && !row?.canCloseShort ? (
            <div className="flex items-center justify-end gap-3">{extra}</div>
          ) : row?.canCloseShort ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-body tabular-nums">
                {money(row.owedMinor)} owed
              </span>
              <span className="flex items-center gap-3">
                {((raw !== null && expectsReplacement(raw) && !waitingOn) ||
                  expectSaid.said !== null) && (
                  <Button
                    variant="ghost"
                    pending={expect.isPending}
                    said={expectSaid.said}
                    disabled={replacements.isPending || destinations.isPending}
                    onClick={(event) => {
                      expectSaid.mark(event.currentTarget)
                      expect.mutate()
                    }}
                  >
                    Expect replacement
                  </Button>
                )}
                <ConfirmButton
                  label="Close Short"
                  variant="danger"
                  tone="danger"
                  title={`Close ${row.number} Short?`}
                  description={`${money(row.owedMinor)} owed is written off.`}
                  confirmLabel="Close Short"
                  reason={{ label: "Reason", optional: true }}
                  pending={short.isPending}
                  onConfirm={(reason) =>
                    short.mutateAsync(
                      reason.trim() === "" ? "Closed short" : reason
                    )
                  }
                />
              </span>
            </div>
          ) : undefined
        }
        width="rail"
      >
        {row && (
          <div className="relative flex flex-col gap-6">
            {/* The stamp the order sheet wears, over the corner once the return
                is done, with the day: the last settlement, or the hand-over. */}
            {!row.open && (
              <DocStamp
                word={
                  row.status === "Closed short" ? "Closed short" : "Completed"
                }
                at={
                  [
                    ...row.settlements.map((one) => one.recorded_at),
                    row.handedOverAt ?? "",
                  ]
                    .sort()
                    .at(-1) || null
                }
                tone={row.status === "Closed short" ? "bad" : "ok"}
              />
            )}
            {form}
            <Problem error={expect.error} />
            <Facts>
              {row.noteAt && <Fact term="Note Date">{day(row.noteAt)}</Fact>}
              {row.address && <Fact term="Address">{row.address}</Fact>}
              {row.phone && <Fact term="Phone">{row.phone}</Fact>}
              <Fact term="Person in Charge">
                {row.pic === null ? "—" : titled(row.pic)}
              </Fact>
              {/* How the supplier settles, said only where one was chosen: a
                  "None" under it told nobody anything. */}
              {row.settleBy && (
                <Fact term="Settle by">{SETTLE_LABEL[row.settleBy]}</Fact>
              )}
              {row.reference && (
                <Fact term="PO">
                  {row.poId ? (
                    <button
                      type="button"
                      onClick={() =>
                        go("/procurement/orders", {
                          key: "order",
                          value: row.poId!,
                        })
                      }
                      className="font-mono text-accent underline-offset-2 hover:underline"
                    >
                      {row.reference}
                    </button>
                  ) : (
                    row.reference
                  )}
                </Fact>
              )}
              {row.letterId && (
                <Fact term="Surat">
                  <button
                    type="button"
                    onClick={() =>
                      go("/letters", { key: "letter", value: row.letterId! })
                    }
                    className="font-mono text-accent underline-offset-2 hover:underline"
                  >
                    {row.letterNumber ?? "Open surat"}
                  </button>
                </Fact>
              )}
              {/* The photo taken on Confirm, proof the supplier received the
                  goods (owner, 2026-10-16). */}
              {proof.data && (
                <Fact term="Proof of Receipt">
                  <a
                    href={proof.data.photo_url}
                    target="_blank"
                    rel="noreferrer"
                    className="block w-40 overflow-hidden rounded-inner border border-hairline"
                  >
                    <img
                      src={proof.data.photo_url}
                      alt="Proof of receipt"
                      className="aspect-[4/3] w-full object-cover"
                    />
                  </a>
                </Fact>
              )}
              {row.settleBy !== null && row.handedOverAt !== null && (
                <Fact term="Settled">
                  <Settled row={row} wide />
                </Fact>
              )}
            </Facts>

            <div>
              <h4 className="mb-3 text-card-title font-semibold text-ink">
                Items
              </h4>
              <Card className="overflow-hidden">
                <table className="w-full border-collapse text-[0.9375rem]">
                  <thead>
                    <tr className="h-11 bg-soft text-left text-[0.9375rem] font-medium text-body">
                      <th className="pl-4">Item</th>
                      <th className="w-[40%] px-3">Notes</th>
                      <th className="pr-4 text-right">Quantity</th>
                    </tr>
                  </thead>
                  <tbody className="[&_td]:py-3.5">
                    {folded.items.map((one) => (
                      <tr key={one.sku} className="border-t border-hairline">
                        <td className="pl-4 leading-snug font-medium text-ink">
                          {one.name}
                          <span className="block font-mono text-[0.9375rem] font-normal text-mute">
                            {one.sku}
                          </span>
                        </td>
                        <NoteCell sku={one.sku} row={row} notes={notes} />
                        <td className="pr-4 text-right tabular-nums">
                          {count(one.qty)}
                        </td>
                      </tr>
                    ))}
                    {folded.unknown > 0 && (
                      <tr className="border-t border-hairline">
                        <td className="pl-4 leading-snug">
                          <span className="block font-medium text-ink">
                            {NOT_AS_ORDERED_ROW.title}
                          </span>
                          <span className="block text-mute">
                            {NOT_AS_ORDERED_ROW.sub}
                          </span>
                        </td>
                        <NoteCell sku={UNKNOWN_NOTE} row={row} notes={notes} />
                        <td className="pr-4 text-right tabular-nums">
                          {count(folded.unknown)}
                        </td>
                      </tr>
                    )}
                    <tr className="border-t border-ink font-semibold text-ink">
                      <td className="pl-4" colSpan={2}>
                        Total
                      </td>
                      <td className="pr-4 text-right tabular-nums">
                        {count(folded.total)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </Card>
            </div>

            <ActivityFold events={history} />
          </div>
        )}
      </Sheet>
    </>
  )
}

/// An item's note in the sheet: a field while the note is being generated,
/// the words it was given after; not required.
function NoteCell({
  sku,
  row,
  notes,
}: {
  sku: string
  row: Row
  notes?: {
    readonly value: Readonly<Record<string, string>>
    readonly onChange: (sku: string, text: string) => void
  }
}) {
  if (notes === undefined)
    return (
      <td className="px-3 leading-snug break-words text-ink">
        {row.lineNotes[sku] ?? ""}
      </td>
    )
  return (
    <td className="px-3 !py-2">
      <Input
        value={notes.value[sku] ?? ""}
        onChange={(event) => notes.onChange(sku, event.target.value)}
        aria-label="Notes"
        className="h-9"
      />
    </td>
  )
}

// ---------------------------------------------------------------------------
// New return
// ---------------------------------------------------------------------------

/// Items out of HO return stock, for one supplier. Over-delivery is raised
/// from the PO sheet and is not offered here.
function NewReturn({ onDone }: { onDone: () => void }) {
  const said = useSaid()
  const client = useQueryClient()
  const [supplier, setSupplier] = useState("")
  const [reason, setReason] = useState<SupplierReturnReason>("OVER_DELIVERY")
  const [settleBy, setSettleBy] = useState<SettleBy>("REPLACEMENT")
  const [poolId, setPoolId] = useState("")
  const [quantities, setQuantities] = useState<Record<string, string>>({})

  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })
  // HO return stock; if the site keeps none apart, whatever may be returned.
  const sources = useMemo(() => {
    const usable = sourcePoolsFor("RETURN_TO_SUPPLIER", fleet.data?.items ?? [])
    const returns = usable.filter((p) => p.pool_code === "RETURN")
    return returns.length > 0 ? returns : usable
  }, [fleet.data])
  const pool = sources.find((p) => p.id === poolId) ?? sources[0] ?? null

  const stock = useQuery({
    queryKey: inventoryKeys.poolAvailability(pool?.id ?? ""),
    queryFn: ({ signal }) => poolAvailability(pool!.id, {}, signal),
    enabled: pool !== null,
  })
  const items = useMemo(
    () => (stock.data?.items ?? []).filter((item) => item.on_hand_qty > 0),
    [stock.data]
  )
  const codes = useMemo(
    () => items.map((item) => item.sku_code).sort(),
    [items]
  )
  const suppliers = useQuery({
    queryKey: supplierReturnKeys.skuSuppliers(codes),
    queryFn: ({ signal }) => skuSuppliers(codes, signal),
    enabled: codes.length > 0,
  })

  const nameOf = useSupplierName()
  const owners =
    suppliers.data ?? new Map<string, { id: string; name: string }>()
  const supplierList = useMemo(() => {
    const seen = new Map<string, string>()
    for (const item of items) {
      const owner = owners.get(item.sku_code)
      if (owner) seen.set(owner.id, nameOf(owner.id, owner.name))
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, suppliers.data, nameOf])
  const goods = items.filter(
    (item) => owners.get(item.sku_code)?.id === supplier
  )

  const lines = goods
    .map((item) => ({
      item,
      qty: Math.floor(Number(quantities[item.sku_code] ?? 0)),
    }))
    .filter((one) => one.qty > 0 && one.qty <= one.item.on_hand_qty)
  const total = lines.reduce((sum, one) => sum + one.qty, 0)

  const create = useMutation({
    mutationFn: () =>
      createSupplierReturn(
        {
          supplier_id: supplier,
          reason,
          settle_by: settleBy,
          source_pool_id: pool!.id,
          lines: lines.map((one) => ({
            sku_code: one.item.sku_code,
            quantity: one.qty,
          })),
        },
        idempotencyKey()
      ),
    onSuccess: (raised) => {
      void client.invalidateQueries({ queryKey: supplierReturnKeys.all })
      void client.invalidateQueries({ queryKey: inventoryKeys.fleet() })
      // Confirming IS the act of issuing the surat: the number on the
      // receipt is the paper the supplier will sign.
      // The button says it, the page walks back to the book, the toast keeps
      // the number (owner, 2026-10-10: pull in + toast).
      void said.say("Confirmed").then(() => {
        onDone()
        void pullIn({
          from: said.start(),
          pill: quantity(total),
          title: `${raised.allotment_number} confirmed`,
          description:
            raised.letter_number !== null
              ? `Surat ${raised.letter_number} · ${quantity(total)}`
              : quantity(total),
        })
      })
    },
  })

  const pcsBySupplier = new Map<string, number>()
  for (const item of items) {
    const owner = owners.get(item.sku_code)
    if (owner) {
      pcsBySupplier.set(
        owner.id,
        (pcsBySupplier.get(owner.id) ?? 0) + item.on_hand_qty
      )
    }
  }

  return (
    <PageContent>
      <PageHeader
        title="New Return PO"
        actions={
          <Button variant="quiet" onClick={onDone}>
            Back
          </Button>
        }
      />

      <Problem error={create.error} className="mb-3" />

      <div className="grid items-start gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <Card className="flex flex-col gap-1 p-1.5">
          {supplierList.length === 0 && (
            <EmptyState>
              {stock.isPending || suppliers.isPending
                ? "Reading the stock…"
                : "Nothing in return stock."}
            </EmptyState>
          )}
          {supplierList.map(([id, name]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setSupplier(id)
                setQuantities({})
              }}
              className={cn(
                "flex flex-col rounded-inner px-3 py-3 text-left transition-colors",
                id === supplier ? "bg-accent-bg" : "hover:bg-soft"
              )}
            >
              <span
                className={cn(
                  "font-medium",
                  id === supplier ? "text-accent" : "text-ink"
                )}
              >
                {name}
              </span>
              <span className="mt-1 text-mute">
                {count(pcsBySupplier.get(id) ?? 0)} in return stock
              </span>
            </button>
          ))}
        </Card>

        <div className="min-w-0">
          {supplier !== "" && (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
                <span className="text-body">Why</span>
                <Segmented
                  value={reason}
                  onChange={setReason}
                  options={[
                    { value: "OVER_DELIVERY", label: "Over-delivery" },
                    {
                      value: "ITEM_MISMATCH",
                      label: "Items don't match the order",
                    },
                  ]}
                />
                {sources.length > 1 && (
                  <div className="w-56">
                    <Select
                      aria-label="Taken from"
                      value={pool?.id ?? ""}
                      onChange={(next) => {
                        setPoolId(next)
                        setQuantities({})
                      }}
                    >
                      {sources.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
              </div>

              <Card className="overflow-hidden">
                {goods.length === 0 ? (
                  <EmptyState>
                    Nothing of this supplier in return stock.
                  </EmptyState>
                ) : (
                  <table className="w-full border-collapse text-body">
                    <thead>
                      <tr className="h-12 border-b border-hairline bg-soft text-left text-[0.9375rem] font-medium text-body">
                        <th className="pl-4">Items</th>
                        <th className="text-right">Available</th>
                        <th className="pr-4 text-right">To Return</th>
                      </tr>
                    </thead>
                    <tbody className="[&_td]:py-3.5">
                      {goods.map((item) => (
                        <tr
                          key={item.sku_id}
                          className="h-16 border-b border-hairline last:border-b-0"
                        >
                          <td className="pl-4">
                            <span className="block leading-snug font-medium text-ink">
                              {item.article_name}
                            </span>
                            <span className="mt-1 block font-mono text-[0.9375rem] text-mute">
                              {skuNumber(item.sku_code)}
                            </span>
                          </td>
                          <td className="text-right tabular-nums">
                            {count(item.on_hand_qty)}
                          </td>
                          <td className="w-36 pr-4">
                            <Input
                              inputMode="numeric"
                              className="text-right"
                              aria-label={`Return ${skuNumber(item.sku_code)}`}
                              value={quantities[item.sku_code] ?? ""}
                              onChange={(event) =>
                                setQuantities((was) => ({
                                  ...was,
                                  [item.sku_code]: event.target.value.replace(
                                    /\D/g,
                                    ""
                                  ),
                                }))
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>

              <h4 className="mt-6 mb-3 text-card-title font-semibold text-ink">
                Settle by
              </h4>
              <Segmented
                value={settleBy}
                onChange={setSettleBy}
                options={[
                  { value: "REPLACEMENT", label: "Replacement" },
                  { value: "REFUND", label: "Refund" },
                  { value: "CREDIT_NOTE", label: "Credit note" },
                ]}
              />
            </>
          )}
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between gap-4">
        <span className="text-body tabular-nums">{quantity(total)}</span>
        <Button
          variant="primary"
          pending={create.isPending}
          disabled={total === 0 || pool === null}
          said={said.said}
          onClick={(event) => {
            said.mark(event.currentTarget)
            create.mutate()
          }}
        >
          {create.isPending ? "Confirming…" : "Confirm"}
        </Button>
      </div>
    </PageContent>
  )
}

/// What was done to the return, folded away until it is asked for — the same
/// "Activity" line every record sheet ends with, closed when the sheet opens
/// (owner, 2026-10-05).
function ActivityFold({ events }: { events: TimelineEvent[] }) {
  return (
    <Collapsible.Root>
      <Collapsible.Trigger className="group flex w-full items-center gap-1.5 border-t border-hairline pt-3.5 text-left text-[0.9375rem] font-medium text-body transition-colors hover:text-ink">
        <ChevronRight className="size-3.5 text-line-ico transition-transform duration-150 group-data-[panel-open]:rotate-90" />
        Activity
        {events.length > 0 && (
          <span className="text-mute tabular-nums">{events.length}</span>
        )}
      </Collapsible.Trigger>
      <Collapsible.Panel className="fold-panel">
        <div className="pt-3">
          <Timeline events={events} />
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}
