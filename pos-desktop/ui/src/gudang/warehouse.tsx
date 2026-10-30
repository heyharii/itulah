/// Central Gudang: what the person in the store's back room does all day, as the
/// till's own screen (client, 25 Oct 2026; `warehouse-app-prototype.html`).
///
/// One list and one save key. Each shift key is a kind of move — ⇧1 Terima a
/// delivery, ⇧2 Gudang → Toko, ⇧3 Toko → Gudang, ⇧4 Reject, ⇧5 Kirim HO — and
/// each keeps its own draft, so switching keys loses nothing. ⇧9 and ⇧0 turn
/// the list itself into the stock or the moves already made; there is no dialog
/// and no sheet anywhere (the item list is the whole screen). Esc goes back one
/// step, ⇧7 saves.
///
/// # The scan field is never taken away
///
/// A barcode scanner types into whatever has the caret, so after a scan, a
/// click on a chip or a tile, a save, the caret is in the scan field. The one
/// way into a quantity box is Tab from an empty scan field, or a click on the
/// number: it selects what is there, digits replace it, ↑ ↓ walk the rows and
/// Enter hands the caret back. The numpad's + and − nudge the picked row, and
/// Delete takes it off.
///
/// # What a save is
///
/// One request that the node writes as one numbered move (PB-0042). A save
/// that was refused is the same save when ⇧7 is pressed again: the keys of one
/// try are held until it is done or the list changes (`signature`).

import { useEffect, useRef, useState, type KeyboardEvent } from "react"

import { NOTHING_HEARD, inShell, readerProblem, sentence } from "@/edge"
import * as api from "@/gudang/api"
import { useBook } from "@/gudang/book"
import { useReader, useStock } from "@/gudang/live"
import { CheckMode, HistoryMode } from "@/gudang/lists"
import {
  MODES,
  emptyDraft,
  emptyDrafts,
  fold,
  have,
  isMode,
  pieces,
  problemOf,
  readCode,
  roomOf,
  routeText,
  signature,
  sourceWord,
  type Draft,
  type ListId,
  type ModeId,
} from "@/gudang/model"
import {
  EntryFoot,
  EntryGrid,
  Header,
  ModeRow,
  Note,
  ScanRow,
  Status,
  ItemCard,
  OpenItem,
  QtyAsk,
  Toasts,
  keepCaret,
  type Toast,
} from "@/gudang/views"
import { useApproval } from "@/approval"
import { useNodeConfig, useSession } from "@/session"
import { useShortcuts } from "@/shortcuts"
import { readScan } from "@epc"
import "@/till-d.css"
import "@/gudang/gudang.css"

/// What a node that did not answer is told as.
const SILENT = "Server toko tidak menjawab."

export function Warehouse({
  name,
  terminalId,
  onSignOut,
}: {
  /// The person signed in, by their full name when the node has one.
  name: string
  /// This PC as the node named it: "Gudang 1".
  terminalId: string
  onSignOut: () => void
}) {
  const node = useNodeConfig()
  const session = useSession()
  const approval = useApproval()
  const { items, learn, knows } = useBook()
  const { stock, online, refresh } = useStock()
  const reader = useReader()

  const [mode, setMode] = useState<ModeId>("floor")
  // The list that takes the item list's place, and the move opened in Riwayat.
  const [list, setList] = useState<ListId | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<ModeId, Draft>>(emptyDrafts)
  const [fromBy, setFromBy] = useState<Partial<Record<ModeId, api.Place>>>({})
  const [scanVal, setScanVal] = useState("")
  const [scanErr, setScanErr] = useState<string | null>(null)
  const [note, setNote] = useState<{ readonly bad: boolean; readonly text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  // A SKU typed on its own, waiting for how many (QtyAsk).
  const [asking, setAsking] = useState<string | null>(null)
  // An article's card, opened by a click on its photo or name.
  const [card, setCard] = useState<string | null>(null)
  const [printing, setPrinting] = useState(false)
  const [toasts, setToasts] = useState<readonly Toast[]>([])
  const [now, setNow] = useState(() => new Date())

  const scanRef = useRef<HTMLInputElement>(null)
  // The quantity boxes by row, for ↑ ↓.
  const inputs = useRef(new Map<number, HTMLInputElement>())
  // The drafts as they are now, ahead of the render: two scans in a row, or a
  // read of the pad, must each see what the one before left.
  const current = useRef(drafts)
  // The keys of the save being tried, kept until it is done.
  const attempt = useRef<{
    readonly sig: string
    readonly keys: api.SendKeys
    /// ⇧5: which steps of the send are done (the move, the return), so the next
    /// try goes on from the one that failed.
    readonly progress: api.Progress
  } | null>(null)
  const toastId = useRef(0)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 10_000)
    return () => window.clearInterval(timer)
  }, [])
  // The approval sheet takes the caret; when it goes, the scan field has it again.
  useEffect(() => {
    if (!approval.open) scanRef.current?.focus()
  }, [approval.open])
  // ⇧9 names every SKU the shop holds, which the price book may not.
  useEffect(() => {
    if (list === "check" && stock !== null) void learn([...stock.keys()])
  }, [list, stock, learn])

  // A Kepala toko or an Admin signed in is the approval a Kirim HO needs;
  // staff ask for a Kepala toko's finger, and a Reject asks for it always.
  const role = (session.me?.role ?? "").toUpperCase()
  const isHead = role === "SUPERVISOR" || role === "ADMIN"
  const draft = drafts[mode]
  const from = fromBy[mode] ?? MODES[mode].from[0]
  const held = (sku: string) => have(stock, sku, from)

  // ⇧5 pressed again after a step failed: its move is already written, and from
  // Gudang or Toko the goods have left their room, so the stock is no longer
  // what it was.
  const resuming =
    mode === "ho" &&
    attempt.current !== null &&
    attempt.current.sig === signature(mode, from, draft) &&
    attempt.current.progress.moved !== null
  const need = draft.lines.filter((line) => problemOf(mode, line, resuming ? Infinity : held(line.sku)) !== null).length
  const canSave =
    !busy &&
    draft.lines.length > 0 &&
    pieces(draft.lines) > 0 &&
    need === 0 &&
    (mode !== "in" || draft.delivery !== null)

  // ── drafts ────────────────────────────────────────────────────────────

  const commit = (id: ModeId, next: Draft) => {
    current.current = { ...current.current, [id]: next }
    setDrafts(current.current)
  }
  const edit = (id: ModeId, change: (was: Draft) => Draft) => commit(id, change(current.current[id]))
  const pick = (index: number) => edit(mode, (was) => (was.sel === index ? was : { ...was, sel: index }))
  const focusScan = () => scanRef.current?.focus()

  const setQty = (index: number, qty: number) =>
    edit(mode, (was) => ({
      ...was,
      sel: index,
      lines: was.lines.map((line, at) => (at === index ? { ...line, qty } : line)),
    }))
  const nudge = (by: 1 | -1) =>
    mode !== "in" &&
    edit(mode, (was) => ({
      ...was,
      lines: was.lines.map((line, at) =>
        at === was.sel ? { ...line, qty: Math.max(0, Math.min(9999, line.qty + by)) } : line,
      ),
    }))
  const setWhy = (index: number, why: api.Reason) =>
    edit(mode, (was) => ({
      ...was,
      sel: index,
      lines: was.lines.map((line, at) => (at === index ? { ...line, why } : line)),
    }))
  const remove = (index: number) => {
    edit(mode, (was) => {
      const lines = was.lines.filter((_, at) => at !== index)
      return { ...was, lines, sel: Math.max(0, Math.min(was.sel, lines.length - 1)) }
    })
    focusScan()
  }
  const clear = () => {
    commit(mode, emptyDraft)
    setNote(null)
    setScanErr(null)
    focusScan()
  }

  /// A quantity box is the way in by hand: select it, digits replace it.
  const editQty = (index: number) => {
    if (current.current[mode].lines[index] === undefined) return
    edit(mode, (was) => ({ ...was, sel: index }))
    inputs.current.get(index)?.focus()
  }

  // ── keys ──────────────────────────────────────────────────────────────

  const toast = (tone: Toast["tone"], title: string, desc?: string) => {
    toastId.current += 1
    const id = toastId.current
    setToasts((was) => [...was.slice(-2), { id, tone, title, desc }])
    window.setTimeout(() => setToasts((was) => was.filter((one) => one.id !== id)), 3200)
  }

  const leaveList = () => {
    setList(null)
    setOpen(null)
  }
  const pickMode = (id: ModeId) => {
    leaveList()
    setMode(id)
    setScanErr(null)
    setNote(null)
    focusScan()
  }
  /// Esc: from a move's lines to the list, from the list to the move being made.
  const back = () => {
    if (open !== null) {
      setOpen(null)
      return
    }
    leaveList()
    focusScan()
  }
  /// A key or its tile: a move, or a list that opens, and closes when pressed again.
  const press = (id: ModeId | ListId) => {
    if (isMode(id)) pickMode(id)
    else if (list === id) back()
    else {
      setList(id)
      setOpen(null)
    }
  }

  useShortcuts({
    "Shift+1": () => press("in"),
    "Shift+2": () => press("floor"),
    "Shift+3": () => press("back"),
    "Shift+4": () => press("reject"),
    "Shift+5": () => press("ho"),
    "Shift+6": () => {
      if (list === null && draft.lines.length > 0 && !busy) clear()
    },
    "Shift+9": () => press("check"),
    "Shift+0": () => press("history"),
    "Shift+7": () => {
      if (list === null) save()
    },
  }, !approval.open && asking === null && card === null)

  /// The scan field's own keys: Tab goes to the picked row's number, ↑ ↓ pick a
  /// row, the numpad's + and − nudge it (and the main row's, while the field is
  /// empty), Delete takes it off, Esc clears the field. The window hears the
  /// rest (Shift and a digit, and Esc and ↑ ↓ over a list).
  const onScanKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (list !== null) return
    const empty = event.currentTarget.value.trim() === ""
    const lines = draft.lines
    const key = event.key
    if (key === "Escape") {
      event.preventDefault()
      setScanVal("")
      setScanErr(null)
      return
    }
    if (key === "Tab" && !event.shiftKey && empty && lines[draft.sel] !== undefined) {
      event.preventDefault()
      editQty(draft.sel)
      return
    }
    if ((key === "ArrowDown" || key === "ArrowUp") && lines.length > 0) {
      event.preventDefault()
      edit(mode, (was) => ({
        ...was,
        sel: Math.max(0, Math.min(was.lines.length - 1, was.sel + (key === "ArrowDown" ? 1 : -1))),
      }))
      return
    }
    if (lines[draft.sel] === undefined) return
    if (event.code === "NumpadAdd" || (empty && key === "+")) {
      event.preventDefault()
      nudge(1)
    } else if (event.code === "NumpadSubtract" || (empty && (key === "-" || key === "−"))) {
      event.preventDefault()
      nudge(-1)
    } else if (empty && key === "Delete") {
      event.preventDefault()
      remove(draft.sel)
    }
  }

  /// A quantity box's keys: Enter or Tab hand the caret back to the scan field,
  /// ↑ ↓ go to the row above or below, and only digits type.
  const onQtyKey = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    const key = event.key
    if (key === "Enter" || key === "Tab") {
      event.preventDefault()
      focusScan()
    } else if (key === "Escape") {
      event.preventDefault()
      setScanVal("")
      setScanErr(null)
      focusScan()
    } else if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault()
      const last = current.current[mode].lines.length - 1
      editQty(Math.max(0, Math.min(last, index + (key === "ArrowDown" ? 1 : -1))))
    } else if (key.length === 1 && !/\d/.test(key) && !event.ctrlKey && !event.metaKey) {
      event.preventDefault()
    }
  }

  // ── scanning ──────────────────────────────────────────────────────────

  /// Terima: a surat jalan number or a koli label opens its delivery, and the
  /// list fills with what was packed — counted as sent, not blind (owner,
  /// 23 Oct 2026); the receiver changes only what differs.
  async function openDelivery(code: string) {
    const found = await api.inboundScan(code)
    if (!found.ok) {
      setScanErr(found.status === 404 ? `${code} tidak dikenal` : api.said(found.problem, SILENT))
      return
    }
    const got = await api.inboundDelivery(found.body.delivery_id)
    if (!got.ok) {
      setScanErr(api.said(got.problem, SILENT))
      return
    }
    const { delivery, lines } = got.body
    const no = delivery.shipment_reference ?? code
    if (delivery.status !== "IN_TRANSIT") {
      setScanErr(`${no} sudah diterima`)
      return
    }
    const packed = lines.filter((line) => line.expected > 0)
    void learn(packed.map((line) => line.sku_code))
    commit("in", {
      lines: packed.map((line) => ({ sku: line.sku_code, qty: line.expected, sent: line.expected, why: null })),
      sel: 0,
      epcs: new Set(),
      tallied: new Set(),
      delivery: {
        id: delivery.delivery_id,
        no,
        from: sourceWord(delivery.source_site_id),
        koli: delivery.koli_count,
      },
    })
  }

  /// One code from the field: a SKU, `3*SKU`, a tag — or, in Terima, the surat
  /// jalan. Scanning from a list comes back to the move being made.
  async function scan(raw: string) {
    const text = raw.trim()
    setScanVal("")
    setScanErr(null)
    setNote(null)
    if (text === "") return
    leaveList()
    const at = mode
    // Terima takes the surat jalan number and nothing else: its lines are
    // what was sent, received as they stand (Hari, 30 Oct 2026).
    if (at === "in") {
      await openDelivery(text.toUpperCase())
      return
    }
    const read = readCode(text)
    if (read.kind === "other") {
      setScanErr(`${text} tidak dikenal`)
      return
    }
    if (!knows(read.sku)) {
      await learn([read.sku])
      if (!knows(read.sku)) {
        setScanErr(`${text} tidak dikenal`)
        return
      }
    }
    // A SKU typed with no quantity asks for one; a tag is one piece.
    if (read.epc === null && read.count === null) {
      setAsking(read.sku)
      return
    }
    const folded = fold(current.current[at], at, [{ sku: read.sku, epc: read.epc, count: read.count }])
    commit(at, folded.draft)
    if (folded.skipped > 0) setScanErr("Tag itu sudah dihitung")
  }

  /// Pressing the RFID chip: every tag of this shop on the R3's pad becomes a
  /// piece of its SKU, once per tag.
  async function readPad() {
    const at = mode
    setScanErr(null)
    setNote(null)
    if (at === "in" && current.current.in.delivery === null) {
      setScanErr("Scan surat jalan dulu")
      return
    }
    leaveList()
    try {
      const read = await reader.read()
      const ours: { readonly sku: string; readonly epc: string }[] = []
      for (const tag of read.tags) {
        const scanned = readScan(tag.epc)
        if (scanned.kind === "epc") ours.push({ sku: scanned.sku_code, epc: scanned.epc })
      }
      if (read.attention !== null) setNote({ bad: true, text: sentence(read.attention) })
      if (read.tags.length === 0) {
        setScanErr(sentence({ ...NOTHING_HEARD, detail: "" }))
        return
      }
      if (ours.length === 0) {
        setScanErr("Tidak ada tag toko ini di pad")
        return
      }
      await learn(ours.map((one) => one.sku))
      const known = ours.filter((one) => knows(one.sku))
      const folded = fold(
        current.current[at],
        at,
        known.map((one) => ({ sku: one.sku, epc: one.epc, count: null })),
      )
      commit(at, folded.draft)
      if (known.length < ours.length) setScanErr(`${ours.length - known.length} tag tidak dikenal`)
      else if (known.length > 0 && folded.skipped === known.length) setScanErr("Tag di pad sudah dihitung")
    } catch (error) {
      setScanErr(readerProblem(error))
    } finally {
      focusScan()
    }
  }

  // ── saving ────────────────────────────────────────────────────────────

  /// ⇧7: Terima, Pindahkan or Kirim, by the key. Staff do the first three
  /// kinds on their own; a Reject and a Kirim HO are the Kepala toko's finger
  /// (Hari, 25 Oct 2026), asked for once per save with the till's own approval
  /// sheet. A Kirim HO by a Kepala toko signed in needs none; a Reject always
  /// does, her own finger when she is the one signed in (Hari, 30 Oct 2026).
  function save() {
    if (!canSave) return
    if (mode === "reject" || (mode === "ho" && !isHead)) {
      const lines = draft.lines.filter((line) => line.qty > 0)
      approval.ask({
        // `perform` spends the proof itself, so this is never filed as one of
        // the till's own basket approvals.
        action: "EDIT_CART",
        title: mode === "reject" ? "Reject" : "Kirim HO",
        detail: `${pieces(lines).toLocaleString("id-ID")} pcs · ${routeText(from, MODES[mode].to)}`,
        perform: (supervisor) => run(supervisor),
        onApproved: () => undefined,
      })
      return
    }
    void run(undefined)
  }

  /// The save itself: the node answers with the move it wrote down; what it
  /// refused is said above the list in its words. Answers the sentence to put
  /// to the supervisor when it is her proof that was refused (the approval sheet
  /// then asks for her finger again), and null otherwise.
  async function run(supervisor: api.Supervisor | undefined): Promise<string | null> {
    const at = mode
    const target = MODES[at].to
    const sig = signature(at, from, draft)
    if (attempt.current === null || attempt.current.sig !== sig) {
      attempt.current = { sig, keys: api.newSendKeys(), progress: api.newProgress() }
    }
    const tried = attempt.current
    const lines = draft.lines.filter((line) => line.qty > 0)
    const count = pieces(lines)
    const proof = supervisor === undefined ? {} : { supervisor }
    setBusy(true)
    setNote(null)
    setScanErr(null)

    let move: api.Moved | null = null
    let problem: string | null = null
    // The move that already put the goods in Return HO, when a later step failed.
    let tucked: string | null = null
    // The refusal was of the supervisor's proof, not of the move.
    let again = false
    if (at === "in" && draft.delivery !== null) {
      const reply = await api.receive({
        delivery_id: draft.delivery.id,
        counts: lines.map((line) => ({ sku_code: line.sku, quantity: line.qty })),
        idempotency_key: tried.keys.move,
      })
      if (reply.ok) move = reply.body.move
      else problem = api.said(reply.problem, SILENT)
    } else if (at === "ho") {
      const room = roomOf(from)
      if (room === null) problem = `${routeText(from, target)} bukan kiriman ke HO.`
      else {
        const sent = await api.sendToHo(
          room,
          lines.map((line) => ({ sku_code: line.sku, quantity: line.qty })),
          tried.keys,
          tried.progress,
          supervisor,
        )
        if (sent.ok) move = sent.move
        else {
          problem = sent.problem
          again = sent.again
          if (tried.progress.moved !== null) tucked = tried.progress.moved.number
        }
      }
    } else {
      const source = roomOf(from)
      const room = roomOf(target)
      if (source === null || room === null) problem = `${routeText(from, target)} bukan pindahan gudang.`
      else {
        const reply = await api.makeMove({
          from: source,
          to: room,
          lines: lines.map((line) => ({
            sku_code: line.sku,
            quantity: line.qty,
            ...(line.why === null ? {} : { reason: line.why }),
          })),
          idempotency_key: tried.keys.move,
          ...proof,
        })
        if (reply.ok) move = reply.body
        else {
          problem = api.said(reply.problem, SILENT)
          again = api.askAgain(reply.status, reply.problem)
        }
      }
    }

    setBusy(false)
    // What the node holds now, whether or not the save went through: a step of
    // a send may have moved the goods already.
    refresh()
    if (move === null) {
      // Her finger was refused: the sheet says so and listens again, and the
      // screen has nothing to add.
      if (again && supervisor !== undefined) return problem ?? SILENT
      const said = problem ?? SILENT
      setNote({
        bad: true,
        text: tucked === null ? said : `${said} ${tucked} sudah tercatat; tekan Shift+7 lagi untuk meneruskan.`,
      })
      focusScan()
      return null
    }
    commit(at, emptyDraft)
    attempt.current = null
    toast(
      "ok",
      at === "in" ? "Barang diterima" : at === "ho" ? "Dikirim ke HO" : "Barang dipindah",
      `${count.toLocaleString("id-ID")} pcs · ${routeText(move.from, move.to)} · ${move.number}`,
    )
    focusScan()
    return null
  }

  /// Cetak surat jalan on an open move.
  async function print(number: string) {
    if (printing) return
    setPrinting(true)
    const sent = await api.printSlip(node.config, number)
    setPrinting(false)
    if (sent === null) toast("bad", "Belum ada printer untuk komputer ini")
    else if (sent.ok) toast("ok", "Mencetak surat jalan", number)
    else toast("bad", sent.text)
  }

  // ── what the screen says ──────────────────────────────────────────────

  const state = reader.status?.state ?? null
  const readerWords = reader.reading
    ? "Membaca…"
    : reader.status === null
      ? "Memeriksa…"
      : state === "not_connected"
        ? "Tidak terhubung"
        : state === "attention"
          ? "Perlu dicek"
          : state === "busy"
            ? "Sibuk"
            : "Siap"
  const readerTone = reader.reading
    ? " on"
    : state === "not_connected"
      ? " bad"
      : state === "attention"
        ? " warn"
        : ""
  const readerTitle =
    reader.status === null
      ? "Menanyakan R3…"
      : reader.status.fault !== null
        ? `${sentence(reader.status.fault)} ${reader.status.fault.detail}`
        : reader.status.detail
  const joined = node.config?.joined
  const site = [joined?.site_code, joined?.site_name].filter((word) => word !== undefined && word !== null && word !== "")

  return (
    <OpenItem.Provider value={setCard}>
    <div id="app" data-screen="gudang">
      <div className="tilld gud">
        <Header
          active={list ?? mode}
          onKey={press}
          onNudge={nudge}
          canNudge={list === null && mode !== "in" && draft.lines[draft.sel] !== undefined}
          who={name}
          device={terminalId}
          onSignOut={onSignOut}
        />
        <main className="t-main">
          <section className="t-page" onMouseDown={keepCaret}>
            <ScanRow
              hint={
                mode === "in" && list === null
                  ? "No. surat jalan"
                  : "SKU (3*SKU untuk jumlah)"
              }
              value={scanVal}
              error={scanErr}
              reading={reader.reading}
              readerWords={readerWords}
              readerTone={readerTone}
              readerTitle={readerTitle}
              canRead={inShell() && mode !== "in"}
              inputRef={scanRef}
              onChange={(value) => {
                setScanVal(value)
                if (scanErr !== null) setScanErr(null)
              }}
              onSubmit={() => void scan(scanRef.current?.value ?? scanVal)}
              onKeyDown={onScanKey}
              onRead={() => void readPad()}
            />
            {list === "check" ? (
              <CheckMode stock={stock} items={items} live onBack={back} />
            ) : list === "history" ? (
              <HistoryMode
                open={open}
                live
                items={items}
                printing={printing}
                learn={learn}
                onOpen={setOpen}
                onBack={back}
                onPrint={(number) => void print(number)}
              />
            ) : (
              <>
                <ModeRow
                  mode={mode}
                  from={from}
                  delivery={draft.delivery}
                  onFrom={(place) => {
                    setFromBy((was) => ({ ...was, [mode]: place }))
                    focusScan()
                  }}
                />
                {note !== null && <Note bad={note.bad}>{note.text}</Note>}
                <EntryGrid
                  mode={mode}
                  draft={draft}
                  from={from}
                  items={items}
                  held={held}
                  inputs={inputs}
                  onPick={pick}
                  onQty={setQty}
                  onWhy={(index, why) => {
                    setWhy(index, why)
                    focusScan()
                  }}
                  onRemove={remove}
                  onQtyKey={onQtyKey}
                />
                <EntryFoot
                  mode={mode}
                  from={from}
                  draft={draft}
                  need={need}
                  busy={busy}
                  canSave={canSave}
                  onClear={clear}
                  onSave={save}
                />
              </>
            )}
          </section>
        </main>
        <Status
          online={online}
          who={name}
          where={[terminalId, ...(site.length > 0 ? [site.join(" ")] : [])].join(" · ")}
          now={now}
        />
        <Toasts toasts={toasts} />
        {asking !== null && (
          <QtyAsk
            sku={asking}
            item={items.get(asking)}
            from={from}
            held={held(asking)}
            onDone={(qty) => {
              commit(mode, fold(current.current[mode], mode, [{ sku: asking, epc: null, count: qty }]).draft)
              setAsking(null)
              focusScan()
            }}
            onCancel={() => {
              setAsking(null)
              focusScan()
            }}
          />
        )}
      </div>
      {approval.sheet}
      {card !== null && (
        <ItemCard
          sku={card}
          item={items.get(card)}
          held={stock?.get(card)}
          onClose={() => {
            setCard(null)
            focusScan()
          }}
        />
      )}
    </div>
    </OpenItem.Provider>
  )
}
