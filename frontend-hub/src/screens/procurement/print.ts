import { toast } from "@/lib/toast"

/// Printing a procurement record on paper — a supplier's card, an order —
/// from a window of its own.
///
/// Its own document rather than a print stylesheet over the app: the record
/// sits in a sheet, which is a portal over a list over a shell, and hiding all
/// of that for the printer is a fight with every layer. Non-components only,
/// so the screens beside it stay fast-refreshable.

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/// A blank window to print into, opened NOW — inside the click that asked
/// for it. Opened after an `await` it is no longer the click's, and the
/// browser blocks it as a pop-up. Null, with the reason said, when blocked
/// anyway.
export function openPrintWindow(): Window | null {
  const view = window.open("", "_blank", "width=820,height=960")
  if (view === null)
    toast.error("The print window was blocked. Allow pop-ups and try again.")
  return view
}

/// Write a whole document into a window opened by `openPrintWindow`, and
/// print it once it has been laid out.
export function printInto(view: Window, html: string) {
  view.document.open()
  view.document.write(html)
  view.document.close()
  view.focus()
  // After layout, so the printer is handed a page that has been drawn.
  setTimeout(() => view.print(), 300)
}
