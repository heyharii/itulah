import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Camera } from "lucide-react"
import { useMemo, useRef, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Field, Input } from "@/components/ui/field"
import { ExpandingSearch } from "@/components/ui/list-chrome"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Banner, EmptyState, LoadingState } from "@/components/ui/states"
import {
  dcPurchaseReturns,
  generatePurchaseReturnNote,
  handOverPurchaseReturn,
  type PurchaseReturnWork,
} from "@/lib/api"
import { useEdgeActor } from "@/lib/edge-session"
import { asJpeg } from "@/lib/image"
import { count, quantity } from "@/lib/format"
import { keys } from "@/lib/operations/keys"
import { useNameOfLogin } from "@/lib/queries/hr-employees"
import { problemOf } from "@/lib/problem"
import { procurementKeys, uploadOrderPhoto } from "@/lib/queries/procurement"
import {
  putReturnProof,
  supplierReturnKeys,
} from "@/lib/queries/supplier-returns"
import { pullIn } from "@/lib/pull-in"
import { useSheet } from "@/lib/sheets"
import { idempotencyKey } from "@itulah/contract/client"
import { BoardHeader } from "@/screens/operations/board/parts"
import { titled } from "@/screens/procurement/po-print"
import {
  groupBySupplier,
  ReturnGroups,
  usePoDates,
} from "@/screens/procurement/supplier-return-groups"
import {
  useReturnNoteLink,
  withNoteLink,
} from "@/screens/procurement/return-note-link"
import { titleCaseTyping } from "@/screens/procurement/supplier-format"
import type { PrintableNote } from "@/screens/procurement/return-print"
import {
  useSupplierContact,
  useSupplierName,
} from "@/screens/procurement/supplier-name"
import { returnLineParts } from "@/screens/procurement/return-lines"
import {
  noteOf,
  ReturnPrintMenu,
  ReturnSheet,
  useReturnRows,
  type Row,
} from "@/screens/procurement/supplier-returns"

/// Print and Download for a note already generated. The note's public link (the
/// QR on the paper) is made as soon as its card shows them, so the clicks stay
/// synchronous — a window opened after an await is blocked as a pop-up.
function NoteButtons({ note }: { note: PrintableNote }) {
  const linked = withNoteLink(note, useReturnNoteLink(note))
  return <ReturnPrintMenu note={linked} />
}

/// **Return PO** — everything going back to a supplier, a card per
/// supplier (the owner, 2026-10-04: a list, not a board, and the delivery note is
/// per supplier, not per order). Each card's band carries the supplier, what is
/// going back to them in total, and the next step: **Generate Delivery Note**
/// names the person in charge and makes the note — kept on the returns
/// themselves, so Procurement reads the same — then **Print**, **Download** and
/// **Confirm**, which is when the hand-over is done.
///
/// A row opens its return in a sheet over the list. It reads two sources at
/// once: this node's purchase returns and head office's register.
/// A return is done once it has been handed over; one with no note of its own
/// (problem goods leave through the picklist) is done when the register says so.
const isDone = (row: Row) =>
  row.reference === null ? !row.open : row.handedOverAt !== null

/// Where a return stands (owner, 16 Oct 2026): To be returned → In progress
/// (its delivery note is generated) → Completed (handed over).
type Stage = "todo" | "progress" | "completed"
const stageOf = (row: Row): Stage =>
  isDone(row) ? "completed" : row.noteAt !== null ? "progress" : "todo"

export function SuppliersBoard() {
  const client = useQueryClient()
  const open = useQuery({
    queryKey: keys.purchaseReturns(),
    queryFn: ({ signal }) => dcPurchaseReturns(signal),
  })
  const confirm = useConfirmReturn()
  const supplierName = useSupplierName()
  const contact = useSupplierContact()
  const nameOfLogin = useNameOfLogin()
  const sheet = useSheet("allotment")
  const register = useReturnRows()
  const poDates = usePoDates()
  const [typed, setTyped] = useState("")
  /// Active: not handed over yet. Completed: handed over, and never mixed with
  /// the ones whose surat jalan is not made (owner, 10 Oct 2026).
  const [tab, setTab] = useState<Stage>("todo")
  /// What has been typed into Person in Charge, by return, before the note
  /// is generated.
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({})
  /// Each item's note, by return then article code, before the note is
  /// generated.
  const [lineDrafts, setLineDrafts] = useState<
    Readonly<Record<string, Readonly<Record<string, string>>>>
  >({})
  /// The return whose note was just generated in this sheet: it shows the
  /// note to print, not Confirm, until the sheet is closed (owner, 16 Oct
  /// 2026).
  const [justMade, setJustMade] = useState<string | null>(null)

  const edge = open.data ?? []

  // Head office's register where it has the return; this node's own copy
  // where it has not arrived there yet.
  const all = useMemo(() => {
    const known = new Set(register.all.map((one) => one.id))
    return [
      ...register.all,
      ...edge
        .filter((one) => !known.has(one.return_id))
        .map((one) =>
          fromEdge(one, supplierName, contact, (login) =>
            titled(nameOfLogin(login))
          )
        ),
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register.all, edge, supplierName, contact, nameOfLogin])

  const groups = useMemo(() => {
    const needle = typed.trim().toLowerCase()
    return groupBySupplier(
      all.filter(
        (one) =>
          stageOf(one) === tab &&
          `${one.supplier} ${one.number} ${one.reference ?? ""}`
            .toLowerCase()
            .includes(needle)
      ),
      poDates
    )
  }, [all, poDates, typed, tab])
  const inStage = (stage: Stage) => all.filter((one) => stageOf(one) === stage)
  const stages = {
    todo: inStage("todo"),
    progress: inStage("progress"),
    completed: inStage("completed"),
  }
  const pcsOf = (list: readonly Row[]) =>
    list.reduce((sum, one) => sum + one.pcs, 0)

  const pending = open.isPending || register.returns.isPending
  const opened = all.find((one) => one.id === sheet.value) ?? null

  /// The opened return as this node holds it, while it waits to be handed
  /// over: its note is generated and confirmed here.
  const work =
    opened === null
      ? undefined
      : edge.find((one) => one.return_id === opened.id && one.status === "OPEN")
  const made = work?.note_generated_at != null
  /// Starts empty: whoever hands the goods over types their own name (owner,
  /// 16 Oct 2026).
  const typedPic = opened === null ? "" : (drafts[opened.id] ?? "")
  const typedNotes = opened === null ? {} : (lineDrafts[opened.id] ?? {})
  const generate = useMutation({
    mutationFn: (id: string) =>
      generatePurchaseReturnNote({
        return_ids: [id],
        pic: typedPic.trim(),
        notes: typedNotes,
      }),
    onSuccess: (_, id) => {
      // The sheet closes at once, so the next time it opens it offers
      // Confirm: `justMade` would hide it for good.
      void id
      setJustMade(null)
      // Generated, the sheet goes away (owner, 2026-10-16: "hide saja
      // sheetnya"); the row moves to In progress with its Confirm.
      sheet.close()
      // The list reads this node's returns AND head office's register: both
      // are asked again, so the row says "Generated" without a reload.
      void client.invalidateQueries({ queryKey: keys.purchaseReturns() })
      void client.invalidateQueries({ queryKey: procurementKeys.returns() })
      void client.invalidateQueries({ queryKey: supplierReturnKeys.all })
    },
  })

  return (
    <PageContent fill>
      <BoardHeader board="suppliers" />
      {/* The book at a glance, as Allotments reads it (owner, 16 Oct 2026). */}
      <KpiStrip className="shrink-0 grid-cols-3">
        <Kpi label="To be returned" value={quantity(pcsOf(stages.todo))} />
        <Kpi label="In progress" value={quantity(pcsOf(stages.progress))} />
        <Kpi label="Completed" value={quantity(pcsOf(stages.completed))} />
      </KpiStrip>
      <SubTabs
        // `fill` makes the page a flex column: a long Completed list squeezed
        // the strip to nothing (owner, 2026-10-10).
        className="shrink-0"
        value={tab}
        onChange={(next) => setTab(next as Stage)}
        tabs={[
          {
            value: "todo",
            label: `To be returned ${count(stages.todo.length)}`,
          },
          {
            value: "progress",
            label: "In progress",
            alert: stages.progress.length,
          },
          {
            value: "completed",
            label: `Completed ${count(stages.completed.length)}`,
          },
        ]}
      />
      {/* The search stands in the bar under the tabs; a phone's is the dock's,
          as on every list. */}
      <div className="group/bar mb-3.5 flex min-h-[2.25rem] shrink-0 flex-wrap items-center gap-2 max-md:hidden">
        <ExpandingSearch
          value={typed}
          onChange={setTyped}
          label="Search returns"
        />
      </div>
      <DockTools
        search={{
          value: typed,
          onChange: setTyped,
          label: "Search Returns",
        }}
      />
      {confirm.dialog}
      {pending ? (
        <LoadingState>Reading the returns…</LoadingState>
      ) : all.length === 0 ? (
        <EmptyState>Nothing going back.</EmptyState>
      ) : groups.length === 0 ? (
        <EmptyState>
          {typed.trim() !== ""
            ? "Nothing matches."
            : tab === "completed"
              ? "Nothing completed yet."
              : tab === "progress"
                ? "Nothing in progress."
                : "Nothing to return."}
        </EmptyState>
      ) : (
        <ReturnGroups
          groups={groups}
          selected={sheet.value}
          onOpen={sheet.open}
          refresh={[open, register.returns, register.over]}
          confirm={{
            can: (id) =>
              edge.some(
                (one) =>
                  one.return_id === id &&
                  one.status === "OPEN" &&
                  one.note_generated_at != null
              ),
            start: (id) => {
              const row = all.find((one) => one.id === id)
              const held = edge.find(
                (one) => one.return_id === id && one.status === "OPEN"
              )
              if (row && held) confirm.start(row.supplier, [held])
            },
          }}
        />
      )}

      <ReturnSheet
        row={opened}
        onClose={() => {
          sheet.close()
          generate.reset()
          setJustMade(null)
        }}
        form={
          // No banner after Generate (owner, 16 Oct 2026: "jangan ada itu"):
          // the footer simply holds Print and Download until it is reopened.
          work !== undefined && made && justMade === opened?.id
            ? null
            : work !== undefined &&
              !made && (
                <>
                  {generate.isError && (
                    <Banner tone="bad">{problemOf(generate.error)}</Banner>
                  )}
                  <Field label="Person in Charge" required>
                    <Input
                      value={typedPic}
                      onChange={(event) =>
                        setDrafts((was) => ({
                          ...was,
                          // A name, as names are typed elsewhere: Title Case.
                          [opened!.id]: titleCaseTyping(event.target.value),
                        }))
                      }
                      className="h-11"
                    />
                  </Field>
                </>
              )
        }
        notes={
          work !== undefined && !made
            ? {
                value: typedNotes,
                onChange: (sku, text) =>
                  setLineDrafts((was) => ({
                    ...was,
                    // Title Case as it is typed (owner, 2026-10-16).
                    [opened!.id]: {
                      ...(was[opened!.id] ?? {}),
                      [sku]: titleCaseTyping(text),
                    },
                  })),
              }
            : undefined
        }
        extra={
          work === undefined || opened === null ? undefined : made ? (
            <>
              <NoteButtons note={noteOf([opened], work.note_pic)} />
              {justMade !== opened.id && (
                <Button
                  variant="primary"
                  onClick={() => confirm.start(opened.supplier, [work])}
                >
                  Confirm
                </Button>
              )}
            </>
          ) : (
            <Button
              variant="primary"
              disabled={typedPic.trim() === ""}
              pending={generate.isPending}
              onClick={() => generate.mutate(opened.id)}
            >
              Generate Delivery Note
            </Button>
          )
        }
      />
    </PageContent>
  )
}

/// This node's own copy of an over-delivery return, as the sheet's row, for the
/// moment head office's register has not got it yet.
function fromEdge(
  row: PurchaseReturnWork,
  supplierName: ReturnType<typeof useSupplierName>,
  contact: ReturnType<typeof useSupplierContact>,
  person: (login: string) => string
): Row {
  const open = row.status === "OPEN"
  return {
    id: row.return_id,
    number: row.return_number,
    supplier: supplierName(row.supplier_id, row.supplier_name),
    reason: "Over-delivery",
    reference: row.po_number,
    ...contact(row.supplier_id, row.supplier_name),
    poId: null,
    pcs: row.quantity,
    settleBy: null,
    valueMinor: 0,
    settledMinor: 0,
    owedMinor: 0,
    byKind: {},
    status: open ? "To hand over" : "Closed",
    tone: open ? "neutral" : "done",
    open,
    raisedAt: row.received_at,
    raisedBy: person(row.raised_by),
    handedOverAt: row.handed_over_at,
    lines: row.lines.flatMap((line) =>
      returnLineParts(line).map((part) => ({
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
    pic: row.note_pic ?? null,
    noteAt: row.note_generated_at ?? null,
    lineNotes: row.line_notes ?? {},
    letterNumber: null,
    raw: null,
  }
}

/// Confirms that a supplier's over-delivery returns have left for them, with
/// a photo as proof the supplier received the goods (owner, 2026-10-16: the
/// surat jalan signed as Penerima, or the goods in the supplier's hands).
/// Submit waits for the photo. Owned by the screen, so the dialog stays
/// mounted across the moment its own write empties the open list.
function useConfirmReturn() {
  const client = useQueryClient()
  const actor = useEdgeActor()
  const [target, setTarget] = useState<{
    supplier: string
    returns: readonly PurchaseReturnWork[]
  } | null>(null)
  const [photo, setPhoto] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  // One key per return, minted once per attempt and kept across a retry, so a
  // second press on bad wifi cannot confirm the same return twice.
  const attempt = useRef(new Map<string, string>())
  const keyFor = (id: string) => {
    const found = attempt.current.get(id)
    if (found !== undefined) return found
    const minted = idempotencyKey()
    attempt.current.set(id, minted)
    return minted
  }
  /// The photo's link once stored, kept across a retry so a failed hand-over
  /// does not upload it twice.
  const stored = useRef<string | null>(null)

  const confirm = useMutation({
    mutationFn: async (returns: readonly PurchaseReturnWork[]) => {
      if (photo === null) throw new Error("Add a photo first.")
      stored.current ??= await uploadOrderPhoto(await asJpeg(photo))
      for (const row of returns) {
        await putReturnProof(row.return_id, stored.current)
        await handOverPurchaseReturn(row.return_id, {
          actor_id: actor,
          handed_to: null,
          idempotency_key: keyFor(row.return_id),
        })
      }
    },
    onSuccess: (_, returns) => {
      // Confirm hands the goods over: the node's returns and the register are
      // both asked again, so the row moves to Completed without a reload.
      void client.invalidateQueries({ queryKey: keys.purchaseReturns() })
      void client.invalidateQueries({ queryKey: procurementKeys.returns() })
      void client.invalidateQueries({ queryKey: supplierReturnKeys.all })
      for (const row of returns)
        void client.invalidateQueries({
          queryKey: supplierReturnKeys.proof(row.return_id),
        })
      // Done means done: the dialog goes and a toast says it (owner,
      // 2026-10-18: "ngapain ada done lagi, langsung toast").
      void pullIn({
        from: null,
        pill: "Returned",
        title: `Returned to ${target?.supplier ?? "the supplier"}`,
      })
      close()
    },
  })

  const choose = (file: File | null) => {
    if (preview !== null) URL.revokeObjectURL(preview)
    setPhoto(file)
    setPreview(file === null ? null : URL.createObjectURL(file))
    stored.current = null
  }
  const close = () => {
    setTarget(null)
    choose(null)
    attempt.current = new Map()
    confirm.reset()
  }

  const pieces =
    target?.returns.reduce((sum, one) => sum + one.quantity, 0) ?? 0
  const numbers = target?.returns.map((one) => one.return_number).join(", ")
  const dialog = (
    <Dialog
      open={target !== null}
      onOpenChange={(next) => {
        if (!next) close()
      }}
      title="Confirm Return"
      confirm="Submit"
      pending={confirm.isPending}
      ready={photo !== null}
      problem={confirm.error}
      onConfirm={() => {
        if (target) confirm.mutate(target.returns)
      }}
    >
      <div className="flex flex-col gap-4">
        <p>
          {target
            ? `${numbers} · ${target.supplier} · ${quantity(pieces)}`
            : ""}
        </p>
        <div className="flex flex-col gap-2">
          <p className="font-medium text-ink">
            Photo proof of receipt <span className="text-bad-fg">*</span>
          </p>
          <input
            ref={picker}
            type="file"
            accept="image/*"
            // A phone opens its camera; a laptop, its files.
            capture="environment"
            className="hidden"
            onChange={(event) => {
              choose(event.target.files?.[0] ?? null)
              event.target.value = ""
            }}
          />
          <button
            type="button"
            onClick={() => picker.current?.click()}
            className="relative grid h-48 w-full place-items-center overflow-hidden rounded-card border border-dashed border-hairline bg-soft text-body transition-colors hover:border-accent hover:text-accent"
          >
            {preview === null ? (
              <span className="flex flex-col items-center gap-2">
                <Camera className="size-6 stroke-[1.6]" />
                Take or upload a photo
              </span>
            ) : (
              <>
                <img
                  src={preview}
                  alt="Proof of receipt"
                  className="absolute inset-0 size-full object-contain"
                />
                <span className="absolute right-2 bottom-2 rounded-full bg-canvas/90 px-3 py-1 text-[0.9375rem] text-ink shadow-soft">
                  Change
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </Dialog>
  )
  return {
    dialog,
    start: (supplier: string, returns: readonly PurchaseReturnWork[]) =>
      setTarget({ supplier, returns }),
  }
}
