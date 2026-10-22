import { useRef } from "react"

import { toast } from "@/lib/toast"

/// A save, answered once: a toast at the bottom right (owner, 2026-10-17 —
/// "ga mau animasi pull in, cukup save toast saja"). The pill pulled from the
/// button into the row (2026-10-10, option 7) and the button's held "done"
/// words are gone; the names stay so no screen had to change.

/// Kept for its callers: `say` no longer holds words on the button, it
/// resolves at once and the sheet closes straight away.
export function useSaid() {
  const from = useRef<HTMLElement | null>(null)
  const say = (words: string) => Promise.resolve(void words)
  const reset = () => {}
  const mark = (node: HTMLElement | null) => {
    from.current = node
  }
  const start = () => from.current
  return { said: null as string | null, say, reset, mark, start }
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

/// Say the save in a toast. `from`, `rowId` and `pill` are no longer drawn.
export async function pullIn({
  title,
  description,
  action,
}: PullIn): Promise<void> {
  toast.success(title, {
    description,
    action:
      action === undefined
        ? undefined
        : { label: action.label, onClick: action.onClick },
  })
}
