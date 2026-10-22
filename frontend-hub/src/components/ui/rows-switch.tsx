import { Menu } from "@base-ui/react/menu"
import { Check, Rows3 } from "lucide-react"

import { CHIP, PANEL } from "@/lib/filter-chrome"
import { money, moneyFigure } from "@/lib/format"
import {
  setTableRows,
  TABLE_ROWS,
  useCompactRows,
  useRowsOffered,
  useRowsTables,
  useTableRows,
} from "@/lib/table-rows"
import { cn } from "@/lib/utils"

/// Rows: Comfortable or Compact, at the right end of a list's bar
/// (`Toolbar`), on a page whose tables offer the choice and only while one is
/// on screen. The choice is the reader's and every table follows it
/// (`lib/table-rows.ts`).
export function RowsSwitch() {
  const offered = useRowsOffered()
  const tables = useRowsTables()
  const rows = useTableRows()
  if (!offered || tables === 0) return null
  return (
    <Menu.Root>
      <Menu.Trigger
        className={cn(
          CHIP,
          "ml-auto items-center gap-1.5 border border-hairline-strong px-2.5 text-body transition-colors hover:bg-soft-2 hover:text-ink data-[popup-open]:bg-soft-2 data-[popup-open]:text-ink"
        )}
      >
        <Rows3 className="size-3.5" />
        Rows
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          side="bottom"
          align="end"
          sideOffset={4}
          className="z-50"
        >
          <Menu.Popup className={PANEL}>
            {TABLE_ROWS.map((one) => {
              const on = one.value === rows
              return (
                <Menu.Item
                  key={one.value}
                  onClick={() => setTableRows(one.value)}
                  className={cn(
                    "flex min-h-9 cursor-default items-center gap-2 rounded-inner px-2 text-[0.9375rem] outline-none select-none data-[highlighted]:bg-soft-2",
                    on ? "text-ink" : "text-text"
                  )}
                >
                  <span className="flex-1">{one.label}</span>
                  <Check
                    className={cn(
                      "size-3.5 shrink-0 text-accent",
                      !on && "opacity-0"
                    )}
                  />
                </Menu.Item>
              )
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

/// An amount in a table cell: with its "Rp" in a comfortable table, the bare
/// figure in a compact one, where the column's heading already says what it
/// is in (`finance-compact-tables.html` B).
export function CellMoney({ minor }: { minor: number | null | undefined }) {
  const compact = useCompactRows()
  return <>{compact ? moneyFigure(minor) : money(minor)}</>
}
