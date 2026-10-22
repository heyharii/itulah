import { Dialog as BaseDialog } from "@base-ui/react/dialog"
import { Drawer } from "@base-ui/react/drawer"
import { Download, Printer, X } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { button } from "@/components/ui/button-style"
import { PhoneDrawer } from "@/components/ui/phone-drawer"
import { useLayout } from "@/lib/layout"
import { cn } from "@/lib/utils"
import { paperShape, type Paper } from "@/screens/procurement/po-print"

/// What the print sheet hands back: the paper chosen, and whether the job is
/// for a PDF file rather than a printer.
export interface PrintChoice {
  readonly paper: Paper
  readonly pdf: boolean
}

type Size = "A5" | "A4"
type Way = "landscape" | "portrait"

const SIZES: readonly { readonly value: Size; readonly label: string }[] = [
  { value: "A5", label: "A5" },
  { value: "A4", label: "A4" },
]
const WAYS: readonly { readonly value: Way; readonly label: string }[] = [
  { value: "landscape", label: "Landscape" },
  { value: "portrait", label: "Portrait" },
]

const paperOf = (size: Size, way: Way): Paper =>
  way === "portrait" ? `${size}-portrait` : size

/// Two choices side by side: the one on has a blue border and ink text, the
/// other is faded, so it is plain which is picked (owner, 2026-10-18).
function Choice<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { readonly value: T; readonly label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="flex gap-2 justify-self-end">
      {options.map((one) => {
        const on = one.value === value
        return (
          <button
            key={one.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(one.value)}
            className={cn(
              "h-9 rounded-inner border px-4 text-[0.9375rem] transition-colors duration-150 ease-(--ease-out)",
              on
                ? "border-accent font-semibold text-accent"
                : "border-transparent text-mute hover:text-ink"
            )}
          >
            {one.label}
          </button>
        )
      })}
    </div>
  )
}

/// The paper last chosen for each kind of document, kept for the next one
/// printed. Orders and packing lists keep their own: a landscape order must not
/// turn the next carton's list on its side.
const remembered = new Map<string, Paper>()

/// The page drawn to scale: A4 landscape 220×156, A5 is A4 × 0.707.
function pageBox(size: Size, way: Way) {
  const long = size === "A4" ? 220 : 156
  const short = size === "A4" ? 156 : 110
  return way === "landscape"
    ? { width: long, height: short }
    : { width: short, height: long }
}

/// Print, as a preview first (owner, 2026-10-17, option D of
/// po-print-buttons-prototype.html): a tinted blue button opens a sheet showing
/// the page as it will come out, the paper and the way up beside it, and one
/// solid button — Print. Download PDF is the red tinted button next to it: blue
/// goes to the printer, red is a file.
///
/// A print goes to the browser's printer dialog; `onChoose` runs inside the
/// click so the print window is not a blocked pop-up. A PDF is written
/// directly — `downloadOrdersPdf` — and lands in the downloads, no dialog
/// (owner, 2026-10-04).
export function PrintMenu({
  onChoose,
  pending,
  label = "Print",
  title,
  iconOnly = false,
  open: openProp,
  onOpenChange,
  hideTrigger = false,
  defaultPaper = "A5",
  paperKey = "default",
}: {
  onChoose: (choice: PrintChoice) => void
  pending?: boolean
  label?: string
  /// What is printed, for the sheet's title — "PO-2026-0412".
  title?: string
  /// The printer alone, square, with the word for a screen reader: where the
  /// room is wanted for the actions beside it.
  iconOnly?: boolean
  /// Opened from outside (Seal & print): controlled when given.
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /// No button of its own: something else opens the sheet.
  hideTrigger?: boolean
  /// The paper the sheet opens on until one has been chosen: A5 landscape, as
  /// an order goes out. A carton's packing list is "A5-portrait".
  defaultPaper?: Paper
  /// Whose last choice is remembered: documents sharing a key share a paper.
  paperKey?: string
}) {
  const [own, setOwn] = useState(false)
  const open = openProp ?? own
  const setOpen = (next: boolean) => {
    setOwn(next)
    onOpenChange?.(next)
  }
  const [paper, setPaper] = useState<Paper>(
    () => remembered.get(paperKey) ?? defaultPaper
  )
  const { size, portrait } = paperShape(paper)
  const way: Way = portrait ? "portrait" : "landscape"
  const pick = (next: Paper) => {
    remembered.set(paperKey, next)
    setPaper(next)
  }
  const choose = (pdf: boolean) => {
    onChoose({ paper, pdf })
    setOpen(false)
  }
  const phone = useLayout() === "phone"
  const Parts: { Title: React.ElementType; Close: React.ElementType } = phone
    ? Drawer
    : BaseDialog
  const box = pageBox(size, way)

  const body = (
    <>
      <div className="flex items-center gap-3">
        <Parts.Title className="text-card-title font-semibold text-ink">
          {title ? `${label} ${title}` : label}
        </Parts.Title>
        <Parts.Close
          aria-label="Close"
          className={cn(
            button({ variant: "quiet", size: "icon" }),
            "ml-auto rounded-full"
          )}
        >
          <X />
        </Parts.Close>
      </div>
      {/* The page as it will come out; its size eases to the paper picked. */}
      <div className="mt-4 grid h-[15.5rem] place-items-center rounded-inner bg-soft-3">
        <div
          aria-hidden
          className="flex flex-col gap-1.5 bg-canvas p-3 shadow-soft transition-[width,height] duration-(--t-panel) ease-(--ease-out) motion-reduce:transition-none"
          style={box}
        >
          <span className="h-2 w-2/5 rounded-sm bg-hairline-strong" />
          <span className="h-1.5 w-3/4 rounded-sm bg-hairline" />
          <span className="mt-1 h-1.5 rounded-sm bg-hairline" />
          <span className="h-1.5 rounded-sm bg-hairline" />
          <span className="h-1.5 rounded-sm bg-hairline" />
          <span className="h-1.5 w-3/4 rounded-sm bg-hairline" />
          <span className="h-1.5 rounded-sm bg-hairline" />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 text-[0.9375rem] text-ink">
        <span>Paper</span>
        <Choice
          options={SIZES}
          value={size}
          onChange={(next) => pick(paperOf(next, way))}
        />
        <span>Layout</span>
        <Choice
          options={WAYS}
          value={way}
          onChange={(next) => pick(paperOf(size, next))}
        />
      </div>
      <div className="mt-5 flex items-center gap-2 max-md:[&>*]:h-11">
        {/* Blue goes to the printer, red is a file. */}
        <Button
          variant="quiet"
          className="btn-to-file border border-bad-fg/40! bg-canvas! font-semibold"
          onClick={() => choose(true)}
        >
          <Download />
          Download PDF
        </Button>
        <Button
          variant="primary"
          className="ml-auto px-5"
          onClick={() => choose(false)}
        >
          <Printer />
          {label}
        </Button>
      </div>
    </>
  )

  return (
    <>
      {!hideTrigger && (
        // White with the word in blue (owner, 20 Oct 2026): the same Print
        // on an order, a packing list and a picklist.
        <Button
          variant="quiet"
          disabled={pending}
          title={label}
          onClick={() => setOpen(true)}
          className={cn(
            "btn-to-printer border border-hairline-2! bg-canvas! font-semibold",
            iconOnly && "w-9 px-0 pointer-coarse:w-11"
          )}
        >
          <Printer />
          {iconOnly ? <span className="sr-only">{label}</span> : label}
        </Button>
      )}
      {phone ? (
        <PhoneDrawer open={open} onOpenChange={setOpen}>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-5">
            {body}
          </div>
        </PhoneDrawer>
      ) : (
        <BaseDialog.Root open={open} onOpenChange={setOpen}>
          <BaseDialog.Portal>
            <BaseDialog.Backdrop
              forceRender
              className="fixed inset-0 z-50 bg-[var(--scrim)] backdrop-blur-[2px] transition-opacity duration-(--t-panel) ease-(--ease-out) data-[ending-style]:opacity-0 data-[starting-style]:opacity-0"
            />
            <BaseDialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[28rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-hairline-2 bg-canvas p-5 shadow-float transition-[opacity,scale] duration-(--t-panel) ease-(--ease-out) data-[ending-style]:scale-[0.96] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0 motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100">
              {body}
            </BaseDialog.Popup>
          </BaseDialog.Portal>
        </BaseDialog.Root>
      )}
    </>
  )
}
