import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRef, useState } from "react"

import { node } from "@/lib/api"
import { readScan } from "@/lib/epc"
import { inventoryKey } from "@/lib/queries"
import { useIdentity, useNodeIdentity } from "@/lib/session"
import {
  placeCodeOf,
  skuOf,
  useLedger,
  type PlaceCode,
} from "@/screens/stock/shared"
import type { MoveRequest, MovementView } from "@itulah/contract"
import { idempotencyKey } from "@itulah/contract/client"

/// The state behind On hand's one write — moving a garment between the shop's
/// three places. Drawn by `move-sheet.tsx`; held here, by the screen, so that a
/// scan on the page and a pool's "Move a piece from here" can both start one.
///
/// `POST /store/movements` accepts only `NORMAL_MOVE` here, on purpose:
/// receiving, selling and counting each write their own cause through their
/// own endpoint, so a move can never be dressed up as a sale.

interface Piece {
  readonly epc: string
  readonly sku_code: string
}

interface Moved extends Piece {
  readonly from: PlaceCode
  readonly to: PlaceCode
  readonly at: string
}

/// The move's whole state.
export function useMover() {
  const client = useQueryClient()
  const identity = useIdentity()
  const where = useNodeIdentity()
  const site = where.data?.site_id ?? null
  const ledger = useLedger()

  const [open, setOpen] = useState(false)
  const [piece, setPiece] = useState<Piece | null>(null)
  const [from, setFrom] = useState<PlaceCode>("warehouse")
  const [to, setTo] = useState<PlaceCode>("floor")
  const [reason, setReason] = useState("")
  const [note, setNote] = useState<string | null>(null)
  const [moved, setMoved] = useState<readonly Moved[]>([])

  /// One key per piece, minted when its tag is read and held until it is
  /// moved or dropped — so a double tap, or a retry after the wifi blinked,
  /// lands on the same movement instead of walking the garment twice.
  const key = useRef<string>(idempotencyKey())

  const move = useMutation({
    mutationFn: (request: MoveRequest) =>
      node.post<unknown>("/api/v1/store/movements", request, {
        headers: { "Idempotency-Key": request.idempotency_key },
      }),
    onSuccess: (_answer, request) => {
      // Built from the request, not from what is on screen: the next tag may
      // already have been scanned while this one was in flight.
      const fromCode = placeCodeOf(request.from)
      const toCode = placeCodeOf(request.to)
      if (fromCode !== null && toCode !== null) {
        setMoved((current) => [
          {
            epc: request.epc,
            sku_code: skuOf(request.epc) ?? "",
            from: fromCode,
            to: toCode,
            at: new Date().toISOString(),
          },
          ...current,
        ])
      }
      // The balances moved and the ledger grew — the whole `inventory`
      // namespace, and nothing outside it.
      void client.invalidateQueries({ queryKey: inventoryKey() })
      setPiece((current) => (current?.epc === request.epc ? null : current))
      setReason("")
      setNote(null)
      key.current = idempotencyKey()
    },
  })

  /// Where the ledger last put this tag, if the newest page of it says.
  ///
  /// Only ever a hint: the ledger in hand is the newest hundred movements, and
  /// a garment that has not moved since last week is simply not in it. When
  /// it is, the move starts from where the piece actually is — a node that is
  /// asked to move it out of somewhere else refuses, and the person holding
  /// it should not have to learn that from a refusal.
  function lastSeen(epc: string): MovementView | null {
    return ledger.data?.find((row) => row.epc === epc) ?? null
  }

  function scan(raw: string) {
    setOpen(true)
    move.reset()
    const read = readScan(raw)
    if (read.kind !== "epc") {
      setNote(
        read.kind === "sku"
          ? "Moving stock needs the garment's own tag — a barcode names the article, not the piece in your hand."
          : `“${read.raw}” is not a tag this shop can read. Scan the RFID tag sewn into the garment.`,
      )
      return
    }
    setNote(null)
    setPiece({ epc: read.epc, sku_code: read.sku_code })
    const seen = lastSeen(read.epc)
    const here = seen === null ? null : placeCodeOf(seen.to)
    if (here !== null && seen?.to.endsWith(":on_hand") === true) setFrom(here)
    key.current = idempotencyKey()
  }

  /// Open the sheet with a direction already chosen — a pool's own "Move from
  /// here". The destination is the obvious other place: the floor from the
  /// back, the back from anywhere else.
  function start(origin?: PlaceCode) {
    if (origin !== undefined) {
      setFrom(origin)
      setTo(origin === "floor" ? "warehouse" : "floor")
    }
    move.reset()
    setOpen(true)
  }

  function drop() {
    setPiece(null)
    setReason("")
    setNote(null)
    move.reset()
    key.current = idempotencyKey()
  }

  function submit() {
    if (site === null || piece === null || from === to) return
    move.mutate({
      epc: piece.epc,
      quantity: 1,
      // `<site>.<pool>:<state>` — `edge/domain/inventory/place.rs`. Built here
      // rather than typed by a person: a place id is a wire format, and a
      // shop assistant has no business knowing it.
      from: `${site}.${from}:on_hand`,
      to: `${site}.${to}:on_hand`,
      // The node accepts nothing else on this endpoint, and says so plainly if
      // asked: receiving, selling and counting each have their own cause and
      // their own route.
      cause: "NORMAL_MOVE",
      reason:
        reason.trim() === ""
          ? `Moved from ${from} to ${to} at the counter`
          : reason.trim(),
      actor_id: identity.data?.username ?? "",
      idempotency_key: key.current,
      reference_type: null,
      reference_id: null,
    })
  }

  return {
    open,
    setOpen,
    piece,
    from,
    setFrom,
    to,
    setTo,
    reason,
    setReason,
    note,
    moved,
    move,
    site,
    siteKnown: !where.isPending,
    lastSeen,
    scan,
    start,
    drop,
    submit,
  }
}

export type Mover = ReturnType<typeof useMover>
