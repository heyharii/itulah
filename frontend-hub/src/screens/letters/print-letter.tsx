import { Dialog as BaseDialog } from "@base-ui/react/dialog"
import { Drawer } from "@base-ui/react/drawer"
import { Download, Printer, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { button } from "@/components/ui/button-style"
import { PhoneDrawer } from "@/components/ui/phone-drawer"
import { Segmented } from "@/components/ui/segmented"
import { useLayout } from "@/lib/layout"
import { cn } from "@/lib/utils"
import { COPY_NAMES } from "@/screens/letters/written"

export type LetterPaperSize = "A4" | "A5"

export interface LetterPrintChoice {
  readonly paper: LetterPaperSize
  readonly copies: number
}

const SIZES = [
  { value: "A4", label: "A4" },
  { value: "A5", label: "A5" },
] as const

const COPIES = [
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
] as const

/// Print a written letter, as a preview first — the PO's print sheet (option D,
/// owner 2026-10-17) with the letter's own question added: how many copies.
/// A goods letter goes in three (Asli · Pembawa · Arsip), each page named.
/// Blue Print goes to the printer; red Download PDF is a file.
///
/// It opens by itself the moment a letter is issued (prototype step 5): the
/// paper has just got its number, and printing it is the next thing to do.
export function LetterPrintSheet({
  open,
  onOpenChange,
  number,
  choice,
  onChoice,
  page,
  onPrint,
  onPdf,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  number: string
  choice: LetterPrintChoice
  onChoice: (choice: LetterPrintChoice) => void
  /// The first page as it will come out, at full size; drawn here to scale.
  page: React.ReactNode
  onPrint: () => void
  onPdf: () => void
}) {
  const phone = useLayout() === "phone"
  const Parts: { Title: React.ElementType; Close: React.ElementType } = phone
    ? Drawer
    : BaseDialog
  // The page to scale: A4 794 px wide drawn 260 px wide, A5 at 0.707 of that.
  const width = choice.paper === "A4" ? 260 : 184
  const scale = width / 794
  const height = Math.round(width * 1.414)

  const body = (
    <>
      <div className="flex items-start gap-3">
        <div className="min-w-0">
          <Parts.Title className="text-card-title font-semibold text-ink">
            Print
          </Parts.Title>
          <div className="font-mono text-[0.9375rem] text-body">{number}</div>
        </div>
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

      <div className="mt-4 grid gap-6 md:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="grid h-[25rem] place-items-center overflow-hidden rounded-inner bg-soft-3 max-md:h-[19rem]">
          <div
            aria-hidden
            className="relative isolate transition-[width,height] duration-(--t-panel) ease-(--ease-out) motion-reduce:transition-none"
            style={{ width, height }}
          >
            {/* The copies under it, a step up and to the right each. */}
            {Array.from({ length: choice.copies - 1 }, (_, index) => (
              <div
                key={index}
                className="absolute inset-0 bg-canvas shadow-soft"
                style={{
                  transform: `translate(${(index + 1) * 8}px, ${(index + 1) * -8}px)`,
                  zIndex: -index - 1,
                }}
              />
            ))}
            <div className="absolute inset-0 overflow-hidden bg-canvas shadow-soft">
              <div
                className="pointer-events-none origin-top-left"
                style={{ transform: `scale(${scale})`, width: 794 }}
              >
                {page}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-5 text-[0.9375rem] text-ink">
          <div>
            <div className="mb-2 font-medium">Paper</div>
            <Segmented
              options={SIZES}
              value={choice.paper}
              onChange={(paper) => onChoice({ ...choice, paper })}
            />
          </div>
          <div>
            <div className="mb-2 font-medium">Copies</div>
            <Segmented
              options={COPIES}
              value={String(choice.copies) as "1" | "2" | "3"}
              onChange={(copies) =>
                onChoice({ ...choice, copies: Number(copies) })
              }
            />
            {choice.copies > 1 && (
              <div className="mt-2.5 leading-6 text-body">
                {COPY_NAMES.slice(0, choice.copies).map((name) => (
                  <div key={name}>{name}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-2 border-t border-hairline pt-4 max-md:[&>*]:h-11">
        <Button
          variant="quiet"
          className="btn-to-file font-semibold text-bad-fg hover:text-bad-fg [&_svg]:text-bad-fg"
          onClick={onPdf}
        >
          <Download />
          Download PDF
        </Button>
        <Button variant="primary" className="ml-auto px-5" onClick={onPrint}>
          <Printer />
          Print
        </Button>
      </div>
    </>
  )

  return phone ? (
    <PhoneDrawer open={open} onOpenChange={onOpenChange}>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-5">
        {body}
      </div>
    </PhoneDrawer>
  ) : (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop
          forceRender
          className="fixed inset-0 z-50 bg-[var(--scrim)] backdrop-blur-[2px] transition-opacity duration-(--t-panel) ease-(--ease-out) data-[ending-style]:opacity-0 data-[starting-style]:opacity-0"
        />
        <BaseDialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[44rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-hairline-2 bg-canvas p-5 shadow-float transition-[opacity,scale] duration-(--t-panel) ease-(--ease-out) data-[ending-style]:scale-[0.96] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0 motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100">
          {body}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}
