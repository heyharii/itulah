import { Printer } from "lucide-react"
import { useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Sheet } from "@/components/ui/sheet"
import { moment } from "@/lib/format"
import type { ShopPeople } from "@/lib/queries/shop-people"
import {
  counterOf,
  readCount,
  standing,
} from "@/screens/money/cash-count-model"
import { CountPaper } from "@/screens/money/cash-count-paper"
import { CountReport } from "@/screens/money/cash-count-report"
import { dayTick } from "@/screens/money/format"
import { Stamp } from "@/screens/money/petty-parts"
import { printNode } from "@/screens/money/petty-printing"
import type { CashCountRow } from "@itulah/contract"

/// A past count, as it was counted: the same two halves as the answer given when
/// it was made, with the note under them and Print in the foot. Print opens the
/// Berita Acara as it will come out, with Back to the record.
export function CountRecord({
  row,
  shop,
  people,
  open,
  onClose,
}: {
  row: CashCountRow
  shop: string
  people: ShopPeople
  open: boolean
  onClose: () => void
}) {
  const [view, setView] = useState<"record" | "print">("record")
  // Reopened, it opens on the record again — not on the paper it was closed on.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setView("record")
  }

  const paper = useRef<HTMLDivElement>(null)
  const count = readCount(row)
  const counter = counterOf(row, people)
  const { word, tone } = standing(count.countedMinor - count.booksMinor)

  if (view === "print") {
    return (
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next) onClose()
        }}
        id="Print preview"
        title="Berita Acara Pemeriksaan Kas Kecil"
        width="wide"
        footer={
          <div className="flex items-center justify-between gap-3">
            <Button onClick={() => setView("record")}>Back</Button>
            <Button
              variant="primary"
              onClick={() => {
                if (paper.current !== null)
                  printNode(paper.current, "Berita Acara Pemeriksaan Kas Kecil")
              }}
            >
              <Printer />
              Print
            </Button>
          </div>
        }
      >
        <div className="overflow-hidden rounded-[0.25rem] border border-hairline bg-white shadow-[0_2px_14px_rgb(0_0_0/6%)]">
          <CountPaper
            ref={paper}
            count={count}
            on={row.counted_on}
            shop={shop}
            by={counter.name}
            position={counter.position}
          />
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={moment(row.created_at)}
      title="Cash count"
      badge={
        <Stamp tone={tone} sub={dayTick(row.counted_on).toUpperCase()}>
          {word}
        </Stamp>
      }
      width="wide"
      className="md:w-[min(73.75rem,calc(100vw-2.5rem))]"
      footer={
        <div className="flex justify-end">
          <Button onClick={() => setView("print")}>
            <Printer />
            Print
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <CountReport count={count} by={counter.name} />
        {count.note !== "" && (
          <div className="flex flex-col gap-2.5">
            <h3 className="text-card-title font-semibold text-ink">Notes</h3>
            <p className="rounded-card border border-hairline px-4 py-3.5 text-cell break-words whitespace-pre-line text-body">
              {count.note}
            </p>
          </div>
        )}
      </div>
    </Sheet>
  )
}
