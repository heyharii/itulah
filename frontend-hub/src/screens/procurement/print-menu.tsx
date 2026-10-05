import { Menu } from "@base-ui/react/menu"
import { Check, ChevronDown, Download, Printer } from "lucide-react"
import { useState } from "react"

import { button } from "@/components/ui/button-style"
import { PANEL } from "@/lib/filter-chrome"
import { cn } from "@/lib/utils"
import type { Paper } from "@/screens/procurement/po-print"

/// What the print menu hands back: the paper chosen, and whether the job is
/// for a PDF file rather than a printer.
export interface PrintChoice {
  readonly paper: Paper
  readonly pdf: boolean
}

const PAPERS: readonly { readonly value: Paper; readonly label: string }[] = [
  { value: "A5", label: "A5 landscape" },
  { value: "A4", label: "A4 landscape" },
  { value: "A5-portrait", label: "A5 portrait" },
  { value: "A4-portrait", label: "A4 portrait" },
]

/// The paper last chosen, kept for the next order printed.
let remembered: Paper = "A5"

const ITEM =
  "flex min-h-8 cursor-default items-center gap-2 rounded-inner px-2 text-[0.875rem] text-ink outline-none select-none data-[highlighted]:bg-soft-2"

/// Print, as a menu: print, or download a PDF, on the paper chosen below them.
///
/// A print goes to the browser's printer dialog. A PDF is written directly —
/// `downloadOrdersPdf` — and lands in the downloads, no dialog (owner,
/// 2026-10-04).
export function PrintMenu({
  onChoose,
  pending,
  label = "Print",
}: {
  onChoose: (choice: PrintChoice) => void
  pending?: boolean
  label?: string
}) {
  const [paper, setPaper] = useState<Paper>(remembered)
  const choose = (pdf: boolean) => onChoose({ paper, pdf })
  return (
    <Menu.Root>
      <Menu.Trigger
        disabled={pending}
        className={cn(button({ variant: "ghost", size: "sm" }))}
      >
        <Printer />
        {label}
        <ChevronDown className="size-3.5" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          side="bottom"
          align="end"
          sideOffset={4}
          className="z-50"
        >
          <Menu.Popup className={PANEL}>
            <Menu.Item className={ITEM} onClick={() => choose(false)}>
              <Printer className="size-3.5" />
              Print
            </Menu.Item>
            <Menu.Item className={ITEM} onClick={() => choose(true)}>
              <Download className="size-3.5" />
              Download PDF
            </Menu.Item>
            <span className="block px-2 pt-2 pb-1 text-eyebrow font-semibold tracking-[0.05em] text-mute uppercase">
              Paper
            </span>
            {PAPERS.map((one) => (
              <Menu.Item
                key={one.value}
                closeOnClick={false}
                className={ITEM}
                onClick={() => {
                  remembered = one.value
                  setPaper(one.value)
                }}
              >
                <span className="grid w-3.5 shrink-0 place-items-center text-accent">
                  {paper === one.value && <Check className="size-3.5" />}
                </span>
                {one.label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
