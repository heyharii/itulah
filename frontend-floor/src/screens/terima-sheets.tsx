import { useQuery } from "@tanstack/react-query"
import { Check, ChevronRight } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { NamaPetugas } from "@/components/petugas"
import { Button } from "@/components/ui/button"
import { CountPad } from "@/components/ui/count-pad"
import { Field, Input } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { BottomSheet, MorphHeight } from "@/components/ui/picker-sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { confirm } from "@/lib/confirm"
import { useDraft } from "@/lib/draft"
import { ago, count, signed } from "@/lib/format"
import { notice } from "@/lib/notice"
import { enqueue } from "@/lib/outbox"
import { usePetugas } from "@/lib/petugas"
import { queryState } from "@/lib/query-state"
import { reads } from "@/lib/queries"
import { useActor, useSignInOff } from "@/lib/session"
import { cn } from "@/lib/utils"
import { groupByOrder, type Order } from "@/lib/work"
import type {
  PurchaseCountAwaitingVerification,
  PurchaseWorkLine,
} from "@itulah/contract"

// The bay's two sheets — the blind count and the verification — and the two
// status pills that let the bay list say a sheet was left half-done.
//
// Both rise over the list on `/terima` rather than being pushed as screens of
// their own. The list stays under the sheet, a swipe down puts it away, and the
// next lorry is one tap away instead of a back arrow and a tap. Which order a
// sheet is about is `?po=` in the URL; what has been typed into it is a draft on
// the phone's disk, so neither a swipe nor a reload loses it.

// ─────────────────────────────────────────────────────────────────────────────
// Drafts

/// What has been typed against each line of one order, by `po_line_id`, as the
/// digits the pad shows. Text rather than numbers because `""` is a line nobody
/// has counted yet and `"0"` is a line counted and found empty — and a number
/// has no way to say the first.
type Counts = Readonly<Record<string, string>>
const NO_COUNTS: Counts = {}
const countKey = (po: string) => `count:${po}`

/// A verification somebody has started reading: the note, and the lines they
/// have taken out of the decision.
interface Check {
  readonly note: string
  readonly dropped: readonly string[]
}
const NO_CHECK: Check = { note: "", dropped: [] }
const checkKey = (po: string) => `check:${po}`

/// The order a sheet was last opened on, still there while it slides away.
///
/// The sheet's `po` goes the moment it is told to close, and the sheet takes a
/// fifth of a second to leave. Read straight from the prop, what slid down the
/// glass would be "order not found" rather than the order just saved.
function useLast(value: string | undefined): string | undefined {
  const [last, setLast] = useState(value)
  if (value !== undefined && value !== last) setLast(value)
  return value ?? last
}

// ─────────────────────────────────────────────────────────────────────────────
// Hitung

/// The count sheet: what is physically on the pallet, written down by somebody
/// who has not been told what was ordered.
///
/// The order is read out of the URL rather than handed over in state, because a
/// phone on a bay sleeps, gets killed by the OS, and is reloaded by somebody who
/// thought the wifi had stuck — and a sheet that lost which lorry it was about
/// each time would be counted twice. What has been counted so far is a draft
/// (`count:<po>`) for the same reason, and because a swipe down is "let me look
/// at the list", not "throw this away".
///
/// Two pages in one sheet (`MorphHeight`): the lines of the order, and a pad on
/// one line. The pad is the whole of the second page on purpose — the phone's
/// keyboard never rises for a count, and the next line is the button under the
/// thumb rather than a field further down a list the keyboard has covered.
///
/// **Saving does not send.** It writes the count into the outbox and the sheet
/// closes onto the bay list; the sending is a durable job that survives the
/// gangway, the locked screen and the reload. What the person did is recorded
/// the moment they press the button, which is the only guarantee worth making to
/// somebody standing next to a pallet.
export function HitungSheet({
  po,
  onClose,
}: {
  /// The order the sheet is open on; `undefined` is closed.
  po: string | undefined
  /// Puts the sheet away, back through the entry its card pushed — the swipe,
  /// the save and the phone's back button all land on the same list.
  onClose: () => void
}) {
  const open = po !== undefined
  const subject = useLast(po)
  const actor = useActor()
  const work = useQuery(reads.purchaseWork())
  const [draft, setDraft, clearDraft] = useDraft<Counts>(
    countKey(subject ?? ""),
    NO_COUNTS,
  )

  // Which line the pad is on; `null` is the list of lines.
  const [at, setAt] = useState<number | null>(null)
  const [back, setBack] = useState(false)
  // The line the pad was last on, so the list comes back scrolled to it.
  const [left, setLeft] = useState<number | null>(null)
  // What the sheet showed at the press that closed it. The draft is cleared in
  // that same press, and without this the lines would blank to dashes while the
  // sheet slid away — the count looking lost at the moment it was saved.
  const [leaving, setLeaving] = useState<Counts | null>(null)

  // Each opening starts on the list of lines with nothing held over from the
  // last one. Adjusted during render rather than in an effect, so the first
  // frame of the sheet is already the right page.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setAt(null)
      setBack(false)
      setLeft(null)
      setLeaving(null)
    }
  }

  const order = useMemo(() => {
    const orders = groupByOrder(work.data ?? [])
    return orders.find((row) => row.po_number === subject) ?? null
  }, [work.data, subject])
  const lines = order?.lines ?? []
  const counts = leaving ?? draft
  const typed = (line: PurchaseWorkLine) =>
    (counts[line.po_line_id] ?? "").trim()

  // Only lines somebody actually typed a number into. A blank is "I did not
  // count this", which is a different statement from zero — and zero is a real
  // count that has to be sendable, so it cannot be filtered out here.
  const entries = lines.flatMap((line) => {
    const written = typed(line)
    if (written === "") return []
    const quantity = Number(written)
    if (!Number.isInteger(quantity) || quantity < 0) return []
    return [
      {
        po_line_id: line.po_line_id,
        article_code: line.article_code,
        quantity,
      },
    ]
  })

  // Clamped, because the node can close a line while the pad is on it.
  const index =
    at === null || lines.length === 0 ? null : Math.min(at, lines.length - 1)
  const line = index === null ? null : (lines[index] ?? null)
  const last = index !== null && index === lines.length - 1

  const toLine = (next: number, backwards: boolean) => {
    setBack(backwards)
    setAt(next)
  }
  const toLines = () => {
    setBack(true)
    setLeft(index)
    setAt(null)
  }
  const next = () => {
    if (index === null) return
    if (last) toLines()
    else toLine(index + 1, false)
  }

  const put = (id: string, value: string) =>
    setDraft((current) => {
      const copy = { ...current }
      if (value === "") delete copy[id]
      else copy[id] = value
      return copy
    })

  // Back on the list, the line just left is in view. `MorphHeight` keeps one
  // scroll box for both pages, and the pad's page — shorter than a long order —
  // leaves it scrolled to the top: a count corrected on line 14 of 20 came back
  // to line 1.
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (index !== null || left === null) return
    list.current
      ?.querySelector(`[data-line="${left}"]`)
      ?.scrollIntoView({ block: "nearest" })
  }, [index, left])

  const save = () => {
    // Not while the sheet is on its way down: it still holds the count it just
    // saved (`leaving`), so the button is still live for the fifth of a second
    // it takes to leave, and a second tap there queued the same lorry twice.
    if (!open || order === null || entries.length === 0) return
    enqueue(
      {
        kind: "hitung",
        po_number: order.po_number,
        supplier_id: order.supplier_id,
        lines: entries,
      },
      actor,
    )
    // The draft goes in the same press that queued the count: one left behind
    // is the same lorry waiting to be saved a second time.
    setLeaving(counts)
    clearDraft()
    // The sheet closes onto the bay, with the counting half showing: the next
    // thing this person does is either the next order or nothing, and neither
    // is on this sheet. Back through the card's entry rather than over it, so
    // no stale one is left behind the list for the back button to reopen.
    onClose()
    notice(`Hitungan ${order.po_number} disimpan.`)
  }

  const discard = async () => {
    if (
      !(await confirm({
        title: "Kosongkan hitungan ini?",
        body: "Angka yang sudah ditulis di HP ini dihapus. Belum ada yang terkirim.",
        yes: "Kosongkan",
        danger: true,
      }))
    ) {
      return
    }
    clearDraft()
  }

  const title =
    line !== null && index !== null
      ? `Baris ${count(index + 1)} dari ${count(lines.length)}`
      : order !== null
        ? (order.supplier_name ?? order.supplier_id)
        : (subject ?? "Hitung")

  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={title}
      onBack={line === null ? undefined : toLines}
      action={
        line === null && entries.length > 0 ? (
          <Button
            variant="quiet"
            className="-mr-2"
            onClick={() => void discard()}
          >
            Kosongkan
          </Button>
        ) : undefined
      }
    >
      <MorphHeight
        page={order === null ? "state" : line === null ? "lines" : "count"}
        back={back}
      >
        {order === null ? (
          queryState(work, {
            loading: "Menanyakan order…",
            render: () => (
              <EmptyState>
                Order itu tidak menunggu apa-apa lagi — sudah diterima, atau
                nomornya keliru.
              </EmptyState>
            ),
          })
        ) : line === null || index === null ? (
          <>
            <div className="px-4 pb-3">
              <p className="-mt-1 font-mono text-[0.6875rem] text-mute">
                {order.po_number}
              </p>
              <NamaPetugas className="mt-3" />
              <p className="mt-3 text-meta leading-relaxed text-body">
                Tulis yang benar-benar ada di pallet. Jumlah pesanan tidak
                ditampilkan — orang lain yang membandingkannya.
              </p>
            </div>
            <div ref={list} className="px-2 pb-2">
              {lines.map((one, position) => (
                <LineRow
                  key={one.po_line_id}
                  line={one}
                  position={position}
                  typed={typed(one)}
                  onPress={() => toLine(position, false)}
                />
              ))}
            </div>
          </>
        ) : (
          // On a short glass the gaps step down with `CountPad`'s keys: at
          // 640px the sheet is capped at 544, and the page's own air was the
          // last few pixels between the pad and a scroll that carries it off
          // the thumb.
          <div className="flex flex-col gap-3 px-4 pb-4 [@media(max-height:700px)]:gap-2 [@media(max-height:700px)]:pb-3">
            <Progress lines={lines} counts={counts} at={index} />
            {/* Keyed by line, so a step to the next one slides in from the
                side it came from — MorphHeight's own fade and 6px — while the
                pad and the buttons stay still under the thumb. */}
            <div
              key={line.po_line_id}
              className={cn(
                "transition-[opacity,translate] duration-(--t-panel) ease-(--ease-out) starting:opacity-0 motion-reduce:starting:translate-none",
                back ? "starting:-translate-x-1.5" : "starting:translate-x-1.5",
              )}
            >
              <p className="truncate text-[1rem] font-semibold text-ink">
                {line.article_name}
              </p>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-mono text-[0.6875rem] text-mute">
                  {line.article_code} · baris {line.line_number}
                </span>
                {/* What has already come in against the line — a partial
                    delivery, not the order. */}
                {line.received_stock_units > 0 && (
                  <Pill tone="ok">
                    {count(line.received_stock_units)} sudah masuk
                  </Pill>
                )}
              </span>
            </div>
            <CountPad
              label={`Jumlah dihitung untuk ${line.article_code}`}
              value={typed(line)}
              onChange={(value) => put(line.po_line_id, value)}
              onEnter={next}
              // The empty pad shows the same faint dash as the list: nothing
              // counted yet. A faint "0" read as a zero somebody had typed.
              placeholder="—"
              unit="potong"
            />
          </div>
        )}
      </MorphHeight>

      {/* The two footers are one height at every size: they swap without
          easing, so a difference between them would jump the sheet's top edge
          while `MorphHeight` eased the rest. On a short glass they lose
          padding, not button — the 56px bar is the press made without
          looking, once per line. */}
      {order !== null &&
        (line === null || index === null ? (
          <div className="flex shrink-0 items-center gap-3 border-t border-hairline px-4 py-3 [@media(max-height:700px)]:py-2">
            <span className="min-w-0 text-meta text-mute">
              {entries.length === 0
                ? "Belum ada yang ditulis"
                : `${count(entries.length)} dari ${count(lines.length)} baris`}
            </span>
            <div className="flex-1" />
            <Button
              variant="primary"
              size="lg"
              disabled={entries.length === 0}
              onClick={save}
            >
              Simpan hitungan
            </Button>
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-2.5 border-t border-hairline px-4 py-3 [@media(max-height:700px)]:py-2">
            <Button
              variant="soft"
              size="lg"
              disabled={index === 0}
              onClick={() => toLine(index - 1, true)}
            >
              Sebelumnya
            </Button>
            <Button
              variant="primary"
              size="lg"
              block
              className="min-w-0 shrink"
              onClick={next}
            >
              {last ? "Selesai" : "Berikutnya"}
            </Button>
          </div>
        ))}
    </BottomSheet>
  )
}

/// One line of the order. Name and code so it can be found on the pallet, and
/// what has been counted against it so far — or a faint dash, which is "not
/// counted yet" and is not the same as a zero.
///
/// The number is not typed here: the whole row opens the pad on that line. A
/// box in the row raised the phone's keyboard over the rest of the order, and
/// the alternative the browser offers — a spinner — is two 12px arrows beside a
/// field being tapped by somebody wearing gloves.
function LineRow({
  line,
  position,
  typed,
  onPress,
}: {
  line: PurchaseWorkLine
  position: number
  typed: string
  onPress: () => void
}) {
  return (
    <button
      type="button"
      data-line={position}
      onClick={onPress}
      className="pressable flex min-h-14 w-full items-center gap-3 rounded-inner px-3 py-2 text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-ink">
          {line.article_name}
        </span>
        <span className="block truncate font-mono text-[0.65625rem] text-mute">
          {line.article_code} · baris {line.line_number}
        </span>
      </span>
      <span
        className={cn(
          "shrink-0 text-[1.0625rem] font-semibold tabular-nums",
          typed === "" ? "text-faint" : "text-ink",
        )}
      >
        {typed === "" ? "—" : count(Number(typed))}
      </span>
      <ChevronRight className="size-4 shrink-0 text-faint" />
    </button>
  )
}

/// Where the pad is in the order: one segment per line, dark once a number is
/// on it, accent on the line the pad is on. It counts lines and never units — a
/// total of pieces would be a figure to count towards.
function Progress({
  lines,
  counts,
  at,
}: {
  lines: readonly PurchaseWorkLine[]
  counts: Counts
  at: number
}) {
  return (
    <div aria-hidden className="flex gap-[3px]">
      {lines.map((line, position) => (
        <span
          key={line.po_line_id}
          className={cn(
            "h-1 min-w-0 flex-1 rounded-full transition-colors duration-(--t-panel) ease-(--ease-out)",
            position === at
              ? "bg-accent"
              : (counts[line.po_line_id] ?? "") !== ""
                ? "bg-body"
                : "bg-hairline-2",
          )}
        />
      ))}
    </div>
  )
}

/// The status on an order's card in the bay list: how many lines it has, or —
/// once somebody has started counting it on this phone — how far that count
/// got. Lines, never units: the counting half of the bay shows no quantity.
export function CountStatus({ order }: { order: Order }) {
  const [draft] = useDraft<Counts>(countKey(order.po_number), NO_COUNTS)
  const written = order.lines.filter(
    (line) => (draft[line.po_line_id] ?? "").trim() !== "",
  ).length
  return written === 0 ? (
    <Pill tone="info">{count(order.lines.length)} baris</Pill>
  ) : (
    <Pill tone="warn">
      Draf · {count(written)} dari {count(order.lines.length)} baris
    </Pill>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Periksa

/// The second pair of eyes.
///
/// Here everything is shown: what was ordered, what was counted, and the
/// difference between them. Accepting is what turns the goods into stock — it is
/// the only step on the bay that moves anything — so it is a deliberate press
/// against a list somebody has read, not a swipe on a row.
///
/// **A person cannot verify their own count.** The node refuses it outright
/// (`edge/sqlite.rs`: "counted this delivery and cannot also approve it"), and
/// this sheet says so before the press rather than after: an outbox job that
/// was refused an hour later, on a phone in somebody's pocket, is a delivery
/// nobody knows is stuck.
///
/// The note and the lines taken out are a draft (`check:<po>`), so swiping the
/// sheet away to look something up on the list does not unread the delivery.
export function PeriksaSheet({
  po,
  onClose,
}: {
  /// The order the sheet is open on; `undefined` is closed.
  po: string | undefined
  /// Puts the sheet away — see `HitungSheet`.
  onClose: () => void
}) {
  const open = po !== undefined
  const subject = useLast(po)
  const actor = useActor()
  const queue = useQuery(reads.verifyQueue())
  const [draft, setDraft, clearDraft] = useDraft<Check>(
    checkKey(subject ?? ""),
    NO_CHECK,
  )

  // What the sheet showed at the press that decided it — see `HitungSheet`.
  const [leaving, setLeaving] = useState<Check | null>(null)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setLeaving(null)
  }
  const check = leaving ?? draft

  const rows = useMemo(
    () => (queue.data ?? []).filter((row) => row.po_number === subject),
    [queue.data, subject],
  )

  // Everything is chosen until somebody un-chooses it. A verifier goes through a
  // delivery agreeing with it; the exceptions are what they touch.
  const dropped = new Set(check.dropped)
  const picked = rows.filter((row) => !dropped.has(row.count_id))
  const mine = rows.some((row) => row.counted_by === actor)
  // Without sign-in everybody is `development` until they say otherwise, and
  // a verification nobody put a name to is not a second pair of eyes.
  const signInOff = useSignInOff()
  const petugas = usePetugas()
  const unnamed = signInOff && petugas === null
  const countedBy = rows[0]?.counted_by ?? "—"
  const blocked = mine || unnamed || picked.length === 0

  const toggle = (id: string) =>
    setDraft((current) => ({
      ...current,
      dropped: current.dropped.includes(id)
        ? current.dropped.filter((one) => one !== id)
        : [...current.dropped, id],
    }))

  const decide = (decision: "Accept" | "Recount") => {
    // Not while the sheet is on its way down — see `HitungSheet`'s save.
    if (!open || subject === undefined || blocked) return
    const note = check.note.trim()
    enqueue(
      {
        kind: "periksa",
        po_number: subject,
        decision,
        note: note === "" ? null : note,
        count_ids: picked.map((row) => row.count_id),
      },
      actor,
    )
    setLeaving(check)
    clearDraft()
    onClose()
    notice(
      decision === "Accept"
        ? "Diterima jadi stok."
        : "Dikembalikan untuk dihitung ulang.",
    )
  }

  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={subject ?? "Periksa"}
    >
      <MorphHeight page={rows.length === 0 ? "state" : "rows"}>
        {queryState(queue, {
          loading: "Menanyakan hitungan…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                Tidak ada hitungan yang menunggu di order itu. Mungkin sudah
                diperiksa orang lain.
              </EmptyState>
            ) : (
              <div className="px-4 pb-4">
                <p className="-mt-1 text-meta text-body">
                  Dihitung {countedBy} · {ago(rows[0]?.counted_at ?? null)}
                </p>

                <NamaPetugas className="mt-3" />

                {unnamed ? (
                  <Banner tone="warn" className="mt-3">
                    Node ini tanpa login. Tulis nama Anda di atas — pemeriksa
                    harus orang yang berbeda dari penghitung.
                  </Banner>
                ) : mine ? (
                  <Banner tone="bad" className="mt-3">
                    Anda yang menghitung kiriman ini, jadi Anda tidak boleh
                    memeriksanya. Panggil orang kedua
                    {signInOff
                      ? " — atau serahkan HP ini dan ganti nama petugas."
                      : "."}
                  </Banner>
                ) : (
                  <Banner tone="info" className="mt-3">
                    Terima berarti barang ini jadi stok. Hitung ulang
                    mengembalikannya ke bay untuk dihitung lagi.
                  </Banner>
                )}

                <div className="-mx-2 mt-3">
                  {rows.map((row) => (
                    <Row
                      key={row.count_id}
                      row={row}
                      chosen={!dropped.has(row.count_id)}
                      onToggle={() => toggle(row.count_id)}
                    />
                  ))}
                </div>

                {/* The node takes a recount only with a reason
                    (`verify_purchase_impl`: a Recount with a blank note is a
                    validation error), so the field says so rather than letting
                    the job be refused out of the outbox later, on a phone in a
                    pocket. An accept may leave it blank. */}
                <Field
                  label="Catatan"
                  hint="Wajib untuk Hitung ulang: tulis kenapa dihitung lagi. Untuk Terima boleh kosong."
                  className="mt-4"
                >
                  <Input
                    value={check.note}
                    onChange={(event) => {
                      const note = event.target.value
                      setDraft((current) => ({ ...current, note }))
                    }}
                    placeholder="mis. dua karton basah"
                  />
                </Field>
              </div>
            ),
        })}
      </MorphHeight>

      {rows.length > 0 && (
        // Two buttons on a 375px screen, and the label is what decides whether
        // they fit: `Button` is `shrink-0` everywhere in this kit, so a
        // sentence in the primary one pushes the secondary off the glass rather
        // than wrapping. The count is a number, not "N baris".
        <div className="flex shrink-0 items-center gap-2.5 border-t border-hairline px-4 py-3">
          <Button
            variant="ghost"
            size="lg"
            disabled={blocked || check.note.trim() === ""}
            onClick={() => decide("Recount")}
          >
            Hitung ulang
          </Button>
          <Button
            variant="primary"
            size="lg"
            block
            className="min-w-0 shrink"
            disabled={blocked}
            onClick={() => decide("Accept")}
          >
            Terima {count(picked.length)}
          </Button>
        </div>
      )}
    </BottomSheet>
  )
}

/// One counted line, and the tap target that drops it out of the decision.
///
/// The whole row toggles rather than a checkbox in a column: a checkbox sized
/// for a mouse is 16px, and this is read by a thumb over a pallet.
///
/// A row rather than the four-column mini-table the pushed screen had: in a
/// sheet 375px wide, three number columns leave the article name a sliver. The
/// ordered and counted figures sit under the name, and the variance — the
/// figure the verifier is here to judge — keeps the trailing edge to itself.
function Row({
  row,
  chosen,
  onToggle,
}: {
  row: PurchaseCountAwaitingVerification
  chosen: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={chosen}
      onClick={onToggle}
      className="pressable flex min-h-14 w-full items-center rounded-inner px-3 py-2.5 text-left"
    >
      {/* The fade is on what the row holds, not on the row: on the row it
          dimmed the press's own grey too, so a line taken out answered the
          thumb at 40%. Eased, so taking one out reads as a change rather than
          a flicker. */}
      <span
        className={cn(
          "flex min-w-0 flex-1 items-center gap-3 transition-opacity duration-(--t-press) ease-(--ease-out)",
          !chosen && "opacity-40",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "grid size-5 shrink-0 place-items-center rounded-[0.3125rem] border transition-colors duration-(--t-press) ease-(--ease-out)",
            chosen
              ? "border-accent bg-accent text-on-dark"
              : "border-hairline-2 bg-canvas",
          )}
        >
          {chosen && <Check className="size-3.5" strokeWidth={3} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-cell font-medium text-ink">
            {row.article_name}
          </span>
          <span className="block truncate font-mono text-[0.65625rem] text-mute">
            {row.article_code}
          </span>
          <span className="mt-0.5 block text-meta text-body tabular-nums">
            Pesan {count(row.expected_stock_units)} · Hitung{" "}
            {count(row.counted_quantity)}
          </span>
        </span>
        {row.variance === 0 ? (
          <Pill tone="ok">0</Pill>
        ) : (
          <Pill tone={row.variance > 0 ? "warn" : "bad"}>
            {signed(row.variance)}
          </Pill>
        )}
      </span>
    </button>
  )
}

/// The status on a count's card in the bay list: whether it matched, and —
/// when somebody has started reading it on this phone — that there is a draft
/// waiting.
export function CheckStatus({ po, off }: { po: string; off: number }) {
  const [draft] = useDraft<Check>(checkKey(po), NO_CHECK)
  const verdict =
    off === 0 ? (
      <Pill tone="ok">Cocok</Pill>
    ) : (
      <Pill tone="warn">{count(off)} selisih</Pill>
    )
  if (draft.note.trim() === "" && draft.dropped.length === 0) return verdict
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <Pill tone="warn">Draf</Pill>
      {verdict}
    </span>
  )
}
