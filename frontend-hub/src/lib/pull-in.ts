import { useRef, useState } from "react"

import { toast } from "@/lib/toast"

/// A save, answered three times (owner, 2026-10-10 — `recount-feedback-
/// options.html`, option 7 "Pull in + toast"):
///
///  1. the button that was pressed says it, in place ("✓ Sent to count") —
///     `useSaid` below, read by `<Button said>`;
///  2. the sheet closes and a small pill is pulled from that button into the
///     row the save changed, which glows as it lands — `pullIn`;
///  3. a toast at the bottom left keeps the number on screen for a few
///     seconds, held while the pointer rests on it.
///
/// It replaces the centred `SavedDialog` for PO, supplier and count actions:
/// that dialog covered the list the reader wanted to look at, for a step that
/// only moved work along.

/// How long the button holds its "done" words before the sheet closes.
const SAID_MS = 650

/// The sheet's own exit (`--t-exit`), and a breath: the pill leaves once the
/// sheet is out of the way, or it would fly behind it.
const SHEET_GONE_MS = 220

const reduced = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

/// The button's "done" words, held for a moment before the caller moves on.
///
/// `say("Sent to count")` resolves once the words have been seen; the caller
/// then closes its sheet. `said` goes to `<Button said={said}>`; `mark` takes
/// the pressed button in its click, `start` gives it back to `pullIn`.
export function useSaid() {
  const [said, setSaid] = useState<string | null>(null)
  /// The button that was pressed, for `pullIn` to start from.
  const from = useRef<HTMLElement | null>(null)
  const say = async (words: string) => {
    setSaid(words)
    await wait(reduced() ? 0 : SAID_MS)
  }
  const reset = () => setSaid(null)
  /// Remember the pressed button: `onClick={(e) => { mark(e.currentTarget); … }}`.
  const mark = (node: HTMLElement | null) => {
    from.current = node
  }
  /// The button marked last, for `pullIn({ from: start() })`.
  const start = () => from.current
  return { said, say, reset, mark, start }
}

export interface PullIn {
  /// Where the pill starts: the button that was pressed. Read at once, before
  /// the sheet holding it closes.
  readonly from: HTMLElement | null
  /// The row it lands on: the `getRowId` of a `DataTable` row on screen. When
  /// no such row is in view (another screen, filtered out, scrolled away) the
  /// pill is skipped and only the toast is said.
  readonly rowId?: string | null
  /// The pill's words — "1 item", "PO-101026-003".
  readonly pill: string
  /// The toast.
  readonly title: string
  readonly description?: string
  readonly action?: { readonly label: string; readonly onClick: () => void }
}

/// The row a `DataTable` drew for `id`, brought into view when it is in the
/// list but scrolled away — the reader sees where the work went.
async function rowOnScreen(id: string): Promise<HTMLElement | null> {
  const node = document.querySelector<HTMLElement>(
    `[data-row-id="${CSS.escape(id)}"]`
  )
  if (node === null) return null
  const box = node.getBoundingClientRect()
  if (box.height === 0) return null
  if (box.top < 0 || box.bottom > window.innerHeight) {
    node.scrollIntoView({ block: "center", behavior: "smooth" })
    await wait(380)
  }
  return node
}

/// The pill, drawn on the body so no sheet or card clips it.
function pillAt(words: string, x: number, y: number): HTMLElement {
  const pill = document.createElement("div")
  pill.textContent = words
  pill.setAttribute("aria-hidden", "true")
  Object.assign(pill.style, {
    position: "fixed",
    left: "0",
    top: "0",
    zIndex: "100",
    height: "28px",
    padding: "0 10px",
    display: "flex",
    alignItems: "center",
    borderRadius: "999px",
    background: "var(--info-bg)",
    color: "var(--info-fg)",
    font: "500 14px/1 var(--font-sans, inherit)",
    whiteSpace: "nowrap",
    pointerEvents: "none",
    willChange: "transform",
    transform: `translate(${x}px, ${y}px)`,
  })
  document.body.appendChild(pill)
  return pill
}

/// Pull a pill from the pressed button into the changed row, then say it in a
/// toast. Call it right after closing the sheet; it never throws.
export async function pullIn({
  from,
  rowId,
  pill: words,
  title,
  description,
  action,
}: PullIn): Promise<void> {
  const say = () =>
    toast.success(title, {
      description,
      action:
        action === undefined
          ? undefined
          : { label: action.label, onClick: action.onClick },
    })

  const start = from?.getBoundingClientRect() ?? null
  if (reduced() || start === null || rowId === undefined || rowId === null) {
    say()
    return
  }
  const pill = pillAt(words, start.left, start.top + (start.height - 28) / 2)
  await wait(SHEET_GONE_MS)
  const row = await rowOnScreen(rowId)
  if (row === null) {
    // The row left the list (a counted order leaves Receiving): the pill goes
    // into the corner the toast rises from, and the toast takes over.
    const flight = pill.animate(
      [
        {
          transform: `translate(${start.left}px, ${start.top + (start.height - 28) / 2}px) scale(1)`,
          opacity: 1,
        },
        {
          transform: `translate(20px, ${window.innerHeight - 64}px) scale(0.9)`,
          opacity: 0,
        },
      ],
      {
        duration: 420,
        easing: "cubic-bezier(0.23, 1, 0.32, 1)",
        fill: "forwards",
      }
    )
    await Promise.race([flight.finished.catch(() => undefined), wait(700)])
    flight.cancel()
    pill.remove()
    say()
    return
  }
  const box = row.getBoundingClientRect()
  // Into the row's right part, where its status stands.
  const toX = box.left + box.width * 0.72
  const toY = box.top + (box.height - 28) / 2
  const fromX = start.left
  const fromY = start.top + (start.height - 28) / 2
  // Out and up, then down into the row: a pull, not a slide.
  const midX = (fromX + toX) / 2
  const midY = Math.min(fromY, toY) - 120
  const flight = pill.animate(
    [
      { transform: `translate(${fromX}px, ${fromY}px) scale(1)`, opacity: 1 },
      {
        transform: `translate(${midX}px, ${midY}px) scale(1.04)`,
        opacity: 1,
        offset: 0.45,
      },
      {
        transform: `translate(${toX}px, ${toY}px) scale(0.9)`,
        opacity: 1,
        offset: 0.92,
      },
      { transform: `translate(${toX}px, ${toY}px) scale(0.9)`, opacity: 0 },
    ],
    {
      duration: 620,
      easing: "cubic-bezier(0.77, 0, 0.175, 1)",
      fill: "forwards",
    }
  )
  // A hidden tab never finishes an animation; the toast must not wait for it.
  await Promise.race([flight.finished.catch(() => undefined), wait(900)])
  flight.cancel()
  pill.remove()
  // The row glows as the pill lands — the same glow a new row gets.
  row.classList.remove("row-fresh")
  void row.offsetWidth
  row.classList.add("row-fresh")
  window.setTimeout(() => row.classList.remove("row-fresh"), 3300)
  say()
}
