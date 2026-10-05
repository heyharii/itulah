import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Download, Printer, Search } from "lucide-react"
import { useMemo, useRef, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Dialog } from "@/components/ui/dialog"
import { Field, Input } from "@/components/ui/field"
import { Sheet } from "@/components/ui/sheet"
import {
  Banner,
  EmptyState,
  LoadingState,
  Receipt,
} from "@/components/ui/states"
import {
  dcPurchaseReturns,
  generatePurchaseReturnNote,
  handOverPurchaseReturn,
  type PurchaseReturnWork,
} from "@/lib/api"
import { useEdgeActor } from "@/lib/edge-session"
import { count } from "@/lib/format"
import { keys } from "@/lib/operations/keys"
import { useNameOfLogin } from "@/lib/queries/hr-employees"
import { problemOf } from "@/lib/problem"
import { procurementKeys } from "@/lib/queries/procurement"
import { useSheet } from "@/lib/sheets"
import { idempotencyKey } from "@itulah/contract/client"
import { BoardHeader } from "@/screens/operations/board/parts"
import { titled } from "@/screens/procurement/po-print"
import {
  groupBySupplier,
  ReturnGroups,
  usePoDates,
  type Group,
} from "@/screens/procurement/supplier-return-groups"
import { downloadReturnPdf } from "@/screens/procurement/return-pdf"
import { useSupplierName } from "@/screens/procurement/supplier-name"
import {
  noteOf,
  printReturnNote,
  ReturnSheet,
  useReturnRows,
  type Row,
} from "@/screens/procurement/supplier-returns"

/// **Return PO** — everything going back to a supplier, a card per
/// supplier (the owner, 2026-10-04: a list, not a board, and the surat jalan is
/// per supplier, not per order). Each card's band carries the supplier, what is
/// going back to them in total, and the next step: **Generate Surat Jalan**
/// names the person in charge and makes the note — kept on the returns
/// themselves, so Procurement reads the same — then **Print**, **Download** and
/// **Confirm**, which is when the hand-over is done.
///
/// A row opens its return in a sheet over the list. It reads two sources at
/// once: this node's purchase returns and head office's register.
export function SuppliersBoard() {
  const client = useQueryClient()
  const open = useQuery({
    queryKey: keys.purchaseReturns(),
    queryFn: ({ signal }) => dcPurchaseReturns(signal),
  })
  const confirm = useConfirmReturn()
  const supplierName = useSupplierName()
  const nameOfLogin = useNameOfLogin()
  const actor = useEdgeActor()
  const sheet = useSheet("allotment")
  const register = useReturnRows()
  const poDates = usePoDates()
  const [typed, setTyped] = useState("")
  /// What has been typed into Person in Charge, by supplier, before the note
  /// is generated.
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({})
  /// The supplier whose note is being made.
  const [making, setMaking] = useState<string | null>(null)

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
          fromEdge(one, supplierName, (login) => titled(nameOfLogin(login)))
        ),
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register.all, edge, supplierName, nameOfLogin])

  const groups = useMemo(() => {
    const needle = typed.trim().toLowerCase()
    return groupBySupplier(
      all.filter((one) =>
        `${one.supplier} ${one.number} ${one.reference ?? ""}`
          .toLowerCase()
          .includes(needle)
      ),
      poDates
    )
  }, [all, poDates, typed])

  /// The returns of a supplier still waiting to be handed over — the ones one
  /// note covers and one Confirm completes — as this node holds them.
  const waitingOf = (group: Group) =>
    edge.filter(
      (one) =>
        one.status === "OPEN" &&
        group.rows.some((row) => row.id === one.return_id)
    )

  const pending = open.isPending || register.returns.isPending
  const opened = all.find((one) => one.id === sheet.value) ?? null

  const makingGroup = groups.find((one) => one.supplier === making) ?? null
  const typedPic =
    making === null ? "" : (drafts[making] ?? titled(nameOfLogin(actor)))
  const generate = useMutation({
    mutationFn: (group: Group) =>
      generatePurchaseReturnNote({
        return_ids: waitingOf(group).map((one) => one.return_id),
        pic: typedPic.trim(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.purchaseReturns() })
      void client.invalidateQueries({ queryKey: procurementKeys.returns() })
      setMaking(null)
    },
  })
  /// The note for a supplier: the returns waiting to be handed over, as one.
  const noteFor = (group: Group) => {
    const waiting = waitingOf(group)
    return noteOf(
      group.rows.filter((row) =>
        waiting.some((one) => one.return_id === row.id)
      ),
      waiting[0]?.note_pic
    )
  }

  const search = (
    <label className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-mute" />
      <Input
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        aria-label="Search returns"
        className="h-11 w-80 pl-9"
      />
    </label>
  )

  return (
    <PageContent fill>
      <BoardHeader board="suppliers" actions={search} />
      {confirm.dialog}
      {pending ? (
        <LoadingState>Reading the returns…</LoadingState>
      ) : all.length === 0 ? (
        <EmptyState>Nothing going back.</EmptyState>
      ) : groups.length === 0 ? (
        <EmptyState>Nothing matches.</EmptyState>
      ) : (
        <ReturnGroups
          groups={groups}
          selected={sheet.value}
          onOpen={sheet.open}
          actions={(group) => {
            const waiting = waitingOf(group)
            if (waiting.length === 0) return undefined
            const made = waiting.every((one) => one.note_generated_at)
            return made ? (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Print"
                  title="Print"
                  onClick={() => printReturnNote(noteFor(group))}
                >
                  <Printer />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Download"
                  title="Download"
                  onClick={() => downloadReturnPdf(noteFor(group))}
                >
                  <Download />
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => confirm.start(group.supplier, waiting)}
                >
                  Confirm
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setMaking(group.supplier)}
              >
                Generate Surat Jalan
              </Button>
            )
          }}
        />
      )}

      <ReturnSheet row={opened} onClose={sheet.close} />

      <Sheet
        open={making !== null}
        onOpenChange={(next) => {
          if (!next) {
            setMaking(null)
            generate.reset()
          }
        }}
        title="Generate Surat Jalan"
        caption={making ?? undefined}
        footer={
          <div className="flex justify-end">
            <Button
              variant="primary"
              disabled={typedPic.trim() === ""}
              pending={generate.isPending}
              onClick={() => makingGroup && generate.mutate(makingGroup)}
            >
              Generate Surat Jalan
            </Button>
          </div>
        }
      >
        {makingGroup && (
          <div className="flex flex-col gap-6">
            {generate.isError && (
              <Banner tone="bad">{problemOf(generate.error)}</Banner>
            )}
            <Field label="Person in Charge" required>
              <Input
                value={typedPic}
                onChange={(event) =>
                  setDrafts((was) => ({
                    ...was,
                    [makingGroup.supplier]: event.target.value,
                  }))
                }
                className="h-11"
              />
            </Field>
            <div>
              <h4 className="mb-3 text-card-title font-semibold text-ink">
                In this note
              </h4>
              <Card className="overflow-hidden">
                <table className="w-full border-collapse text-[0.9375rem]">
                  <thead>
                    <tr className="h-11 bg-soft text-left text-[0.875rem] font-medium text-body">
                      <th className="pl-4">PO</th>
                      <th className="text-right">Items</th>
                      <th className="pr-4 text-right">Quantity</th>
                    </tr>
                  </thead>
                  <tbody className="[&_td]:py-3">
                    {noteFor(makingGroup).returns.map((one) => (
                      <tr key={one.number} className="border-t border-hairline">
                        <td className="pl-4 font-mono text-id">
                          {one.reference ?? one.number}
                        </td>
                        <td className="text-right tabular-nums">
                          {count(one.lines.length)}
                        </td>
                        <td className="pr-4 text-right tabular-nums">
                          {count(
                            one.lines.reduce((sum, line) => sum + line.qty, 0)
                          )}{" "}
                          pcs
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          </div>
        )}
      </Sheet>
    </PageContent>
  )
}

/// This node's own copy of an over-delivery return, as the sheet's row, for the
/// moment head office's register has not got it yet.
function fromEdge(
  row: PurchaseReturnWork,
  supplierName: ReturnType<typeof useSupplierName>,
  person: (login: string) => string
): Row {
  const open = row.status === "OPEN"
  return {
    id: row.return_id,
    number: row.return_number,
    supplier: supplierName(row.supplier_id, row.supplier_name),
    reason: "Over-delivery",
    reference: row.po_number,
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
    lines: row.lines.map((line) => ({
      sku: line.article_code,
      name: line.article_name,
      qty: line.quantity,
      cost: 0,
    })),
    settlements: [],
    closedShortReason: null,
    canCloseShort: false,
    letterId: null,
    pic: row.note_pic ?? null,
    noteAt: row.note_generated_at ?? null,
    letterNumber: null,
    raw: null,
  }
}

/// Confirms that a supplier's over-delivery returns have left for them. One
/// question, one press: no driver to name (owner, 2 Oct 2026) — the note's
/// person in charge is already on paper. Owned by the screen, so the dialog
/// stays mounted across the moment its own write empties the open list.
function useConfirmReturn() {
  const client = useQueryClient()
  const actor = useEdgeActor()
  const [target, setTarget] = useState<{
    supplier: string
    returns: readonly PurchaseReturnWork[]
  } | null>(null)
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

  const confirm = useMutation({
    mutationFn: async (returns: readonly PurchaseReturnWork[]) => {
      for (const row of returns) {
        await handOverPurchaseReturn(row.return_id, {
          actor_id: actor,
          handed_to: null,
          idempotency_key: keyFor(row.return_id),
        })
      }
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.purchaseReturns() })
    },
  })

  const close = () => {
    setTarget(null)
    attempt.current = new Map()
    confirm.reset()
  }

  const pieces =
    target?.returns.reduce((sum, one) => sum + one.quantity, 0) ?? 0
  const dialog = (
    <Dialog
      open={target !== null}
      onOpenChange={(next) => {
        if (!next) close()
      }}
      title={target ? `Confirm ${target.supplier}?` : "Confirm"}
      confirm={confirm.isSuccess ? "Done" : "Confirm"}
      cancel={confirm.isSuccess ? "Close" : "Cancel"}
      pending={confirm.isPending}
      problem={confirm.isSuccess ? null : confirm.error}
      onConfirm={() => {
        if (confirm.isSuccess) close()
        else if (target) confirm.mutate(target.returns)
      }}
    >
      {confirm.isSuccess ? (
        <Receipt>{`Sent back to ${target?.supplier}.`}</Receipt>
      ) : (
        <p className="text-body">
          {target
            ? `${count(target.returns.length)} ${target.returns.length === 1 ? "return" : "returns"}, ${count(pieces)} pcs go back to ${target.supplier}.`
            : ""}
        </p>
      )}
    </Dialog>
  )
  return {
    dialog,
    start: (supplier: string, returns: readonly PurchaseReturnWork[]) =>
      setTarget({ supplier, returns }),
  }
}
