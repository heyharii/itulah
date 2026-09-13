import { Printer } from "lucide-react"
import type { ReactNode } from "react"

import { Button } from "@/kit/button"
import { cn } from "@/lib/cn"

/// A document, on screen and on paper.
///
/// ## Why there is no PDF library here
///
/// Because the browser already is one. Every print dialog on every platform
/// offers "Save as PDF", using the same engine that lays this document out — so
/// a library would be a SECOND renderer to keep in step with the first, and the
/// day they disagree is the day a printed voucher does not match its preview.
///
/// It also keeps one design system. The document below is drawn with the app's
/// own tokens and type scale; a `@react-pdf/renderer` document is a separate
/// stylesheet in a separate language, and the two drift by the second month.
///
/// ## What this does NOT solve, and it matters
///
/// **Reproducibility.** A browser render depends on the browser, the fonts it
/// found and the scale in the print dialog, so the same voucher printed next
/// year is not guaranteed to be the same sheet of paper. For an instrument that
/// is signed and archived — a Bukti Kas Keluar carries three signatures — that
/// is a real gap, and the answer is server-side generation next to the ledger
/// that owns the numbers, not a client library. It is a decision to take, not a
/// package to install; see the module map.
///
/// ## The preview is the document
///
/// Not a smaller version of it. What is on screen is what prints, at the same
/// proportions, so nobody has to press Print to find out what they will get.
export function Printable({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      data-print
      className={cn(
        // A4 at a readable size on screen. `mx-auto` and the shadow make it
        // read as a sheet lying on the desk rather than as a panel in the app —
        // which is the whole point: the reader should recognise the thing they
        // are about to hold.
        "bg-canvas text-ink shadow-pop mx-auto w-[210mm] max-w-full p-[14mm]",
        className,
      )}
    >
      {children}
    </div>
  )
}

/// Something that belongs to the screen and not to the sheet.
///
/// The Print button itself, a close control, a tab strip over a preview. Marked
/// rather than positioned outside the document, because several of them read
/// better inside it — a "Print" beside the document's own heading is where
/// somebody looks for it.
export function ScreenOnly({ children }: { children: ReactNode }) {
  return <span data-screen-only>{children}</span>
}

/// The one control that puts it on paper.
///
/// `window.print()` and nothing else. There is no state to manage — the dialog
/// is the browser's, cancelling it is the browser's, and "Save as PDF" inside it
/// is what makes a file.
export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <ScreenOnly>
      <Button
        variant="primary"
        icon={<Printer className="size-4" />}
        onClick={() => window.print()}
      >
        {label}
      </Button>
    </ScreenOnly>
  )
}

/// A block that must not be split across two sheets.
///
/// A signature panel with a name under a line, a total under the rows it
/// totals. Breaking either across the fold produces a document that is not
/// merely ugly — a signature on a page whose figures are overleaf is a
/// signature on nothing.
export function KeepTogether({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div data-keep-together className={className}>
      {children}
    </div>
  )
}
